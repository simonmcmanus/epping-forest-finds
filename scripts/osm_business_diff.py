#!/usr/bin/env python3
"""
Watches OpenStreetMap for the business turnover the map would otherwise never
hear about, and -- once a signal has held up week after week -- turns it into a
changeset the weekly run can actually apply.

What this used to do, and why it was not enough
-----------------------------------------------
The first version asked OpenStreetMap for every food and shop point in the
area and compared the names against our own. That catches two things and
misses three, and the three it missed are the common ones:

1. A site that changes hands keeps its OpenStreetMap element. When a Loughton
   restaurant closed and another opened in the same unit, the point was edited
   in place: same element, new name. Nothing went missing and nothing was new,
   so the old comparison saw absolutely nothing to report -- while the map went
   on showing a restaurant that had closed years earlier.
2. OpenStreetMap records closures explicitly, with disused:/was:/vacant tags
   left on the spot. That is somebody stating a closure outright, which is far
   better evidence than silence, and the old query never asked for it.
3. A name already used anywhere in the area suppressed a genuinely new place
   with that name -- so a new branch of a chain was invisible, because the
   chain was already on the map a few miles away.

It also only ever looked at food and shops, so a village hall or an arts
centre changing was out of scope entirely, and its output was advice rather
than a change: a list of "worth checking" candidates with no memory from one
week to the next, and nothing obliging anybody to act on them.

What it does now
----------------
Four signals per run:

- new      -- in OpenStreetMap, not on our map (an opening, or a gap)
- missing  -- on our map, absent from this week's OpenStreetMap data
- closed   -- OpenStreetMap marks the very element closed (disused:/was:/vacant)
- changed  -- the element we already know now carries a different name or
              category: the site has changed hands

Each is fed into scripts/business_watch.py, which remembers what it saw last
week. A signal that repeats often enough stops being "worth checking" and
becomes a changeset entry -- see that module for the thresholds and for the
cap on how much one unattended run may remove.

Usage:
    python3 scripts/osm_business_diff.py [--dataset PATH ...] [--out PATH]
                                         [--scope food|venue|all]
                                         [--ledger PATH] [--changeset PATH]
                                         [--today YYYY-MM-DD] [--no-record]

The defaults are what the weekly run wants: every scope, both datasets the
scope covers, the committed watchlist. Adding --changeset is what turns a
report into a change.

Network: the public Overpass API (no key needed). Everything that decides
anything -- diff_pois, the escalation rules -- takes plain Python data and has
no network dependency, so it is fully unit-testable. See
scripts/test_osm_business_diff.py.
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts import business_watch, verification  # noqa: E402
from scripts.place_matching import (  # noqa: E402
    NAME_MATCH_RADIUS_M, feature_lonlat, normalize_name, same_place,
)
from scripts.report.geo import SEARCH_BBOX  # noqa: E402

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_TIMEOUT_S = 90

# Mirrors the amenity/shop tag patterns in data/local-landmarks.overpassql's
# food-related lines, so this diff checks against exactly the same OSM
# categories the app's own food dataset is built from.
AMENITY_CATEGORIES = {
    "pub": "pub", "bar": "bar", "cafe": "cafe", "tea": "tea", "restaurant": "restaurant",
}
SHOP_CATEGORIES = {
    "convenience": "convenience", "supermarket": "supermarket", "grocery": "grocery",
    "general": "general", "greengrocer": "greengrocer", "butcher": "butcher",
    "bakery": "bakery", "deli": "deli", "farm": "farm", "pastry": "pastry",
    "confectionery": "confectionery",
}

# The places a town actually uses that are not food: the village hall, the
# arts centre, the library. They sit outside the food dataset, so nothing
# checked them at all and nothing could add one that was never mapped --
# Loughton's own Lopping Hall being the example that prompted this. They land
# in data/local-landmarks-misc.geojson; see apply_weekly_changeset.py.
VENUE_CATEGORIES = {
    "community_centre": "community_centre", "public_hall": "public_hall",
    "arts_centre": "arts_centre", "theatre": "theatre", "cinema": "cinema",
    "townhall": "townhall", "library": "library", "social_centre": "social_centre",
}

# What a walker needs that is not a business at all: where the bus goes from,
# where the car park and the toilets are. These datasets were generated once
# and never looked at again -- four months by the time anyone checked -- and
# they go stale in ways that matter: a stop gets suspended, a car park closes,
# a toilet block shuts for the winter.
TRANSPORT_CATEGORIES = {
    "bus_station": "bus_station", "taxi": "taxi", "train_station": "train_station",
}
FACILITY_CATEGORIES = {
    "parking": "parking", "toilets": "toilets", "drinking_water": "drinking_water",
    "bicycle_parking": "bicycle_parking", "bench": "bench",
}

SCOPES = {
    "food": {"amenity": AMENITY_CATEGORIES, "shop": SHOP_CATEGORIES},
    "venue": {"amenity": VENUE_CATEGORIES},
    "transport": {"amenity": TRANSPORT_CATEGORIES},
    "facilities": {"amenity": FACILITY_CATEGORIES},
    "all": {
        "amenity": {**AMENITY_CATEGORIES, **VENUE_CATEGORIES},
        "shop": SHOP_CATEGORIES,
    },
    # Deliberately separate from "all". A bus stop has no name to match on and
    # there are thousands of them, so sweeping them in alongside the shops
    # would swamp a week's real findings and put the removal cap under
    # constant pressure. Ask for them on purpose.
    "everything": {
        "amenity": {**AMENITY_CATEGORIES, **VENUE_CATEGORIES, **TRANSPORT_CATEGORIES, **FACILITY_CATEGORIES},
        "shop": SHOP_CATEGORIES,
    },
}

# How OpenStreetMap says "this closed". A mapper who bothers to leave one of
# these has been to the door, which makes it the strongest closure evidence
# there is -- stronger than a point merely being absent.
CLOSED_TAG_PREFIXES = ("disused", "was", "closed", "abandoned", "demolished", "removed")
VACANT_VALUES = {"vacant", "disused", "closed"}

# Fields worth copying from the source when our own record has a blank.
# Never used to overwrite something already there -- a value on the map may
# have been put there by a person who checked, and the source may simply be
# older or wrong.
ENRICHABLE_FIELDS = ("address", "website", "phone", "openingHours")

SOURCE = "osm"


def build_overpass_query(bbox=SEARCH_BBOX, timeout=OVERPASS_TIMEOUT_S, scope="all"):
    south, west, north, east = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    box = f"{south},{west},{north},{east}"
    tags = SCOPES[scope]
    lines = []
    for key, categories in tags.items():
        pattern = "|".join(sorted(categories))
        lines.append(f'  nwr["{key}"~"^({pattern})$"]["name"]({box});')
    # Closure markers are asked for by tag key rather than by value: a mapper
    # writes disused:amenity=restaurant, disused:shop=bakery, was:amenity=pub
    # and so on, and we want all of them whatever the old use was.
    for prefix in CLOSED_TAG_PREFIXES:
        for key in ("amenity", "shop"):
            lines.append(f'  nwr["{prefix}:{key}"]({box});')
    for key in ("amenity", "shop"):
        lines.append(f'  nwr["{key}"="vacant"]({box});')
    return (
        f"[out:json][timeout:{timeout}];\n"
        "(\n" + "\n".join(lines) + "\n"
        ");\n"
        "out center tags;\n"
    )


def _known_categories(scope="all"):
    known = {}
    for key, categories in SCOPES[scope].items():
        known[key] = categories
    return known


def _category_from_tags(tags, scope="all"):
    """The category this element counts as, live or closed. A closed element
    carries its old use under a prefixed key (disused:amenity=cafe), which is
    exactly what we need to know which of our points it refers to."""
    known = _known_categories(scope)
    for key, categories in known.items():
        value = tags.get(key)
        if value in categories:
            return categories[value]
    for prefix in CLOSED_TAG_PREFIXES:
        for key, categories in known.items():
            value = tags.get(f"{prefix}:{key}")
            if value in categories:
                return categories[value]
    return None


def _closure_status(tags, scope="all"):
    """"closed" when the element says so itself, otherwise "open".

    A live tag wins over a historical one. Mappers routinely leave the old use
    behind when a unit is relet -- a restaurant in a former bakery keeps
    disused:shop=bakery alongside amenity=restaurant -- and reading that as a
    closure would take a trading business off the map on the strength of a
    note about its previous tenant. A stated closure only counts when there is
    nothing live to contradict it.
    """
    known = _known_categories(scope)
    for key, categories in known.items():
        if tags.get(key) in categories:
            return "open"
    for key in ("amenity", "shop"):
        if tags.get(key) in VACANT_VALUES:
            return "closed"
    for prefix in CLOSED_TAG_PREFIXES:
        if any(tags.get(f"{prefix}:{key}") for key in ("amenity", "shop")):
            return "closed"
    return "open"


def _name_from_tags(tags):
    for key in ("name", "was:name", "old_name", "disused:name"):
        if tags.get(key):
            return tags[key]
    return None


def normalize_overpass_elements(elements, scope="all"):
    """Turns raw Overpass JSON elements into the flat shape diff_pois()
    expects: {osmType, osmId, name, category, status, lon, lat, address}."""
    out = []
    for el in elements:
        tags = el.get("tags") or {}
        name = _name_from_tags(tags)
        if not name:
            continue
        category = _category_from_tags(tags, scope)
        status = _closure_status(tags, scope)
        # A vacant unit says nothing about what used to trade there, so it has
        # no category of its own. It is still worth reporting -- it is a
        # closure at a known spot -- so it is kept with category None and
        # matched to our point by id.
        if not category and status != "closed":
            continue
        lat = el.get("lat")
        lon = el.get("lon")
        if lat is None or lon is None:
            center = el.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        address_parts = [
            tags.get("addr:housenumber"), tags.get("addr:street"),
            tags.get("addr:city"), tags.get("addr:postcode"),
        ]
        address = " ".join(p for p in address_parts if p) or None
        out.append({
            "osmType": el.get("type"),
            "osmId": el.get("id"),
            "name": name,
            "category": category,
            "status": status,
            "lon": round(float(lon), 7),
            "lat": round(float(lat), 7),
            "address": address,
            "website": tags.get("website") or tags.get("contact:website"),
            "phone": tags.get("phone") or tags.get("contact:phone"),
            # "Is it open right now" is the thing somebody standing outside in
            # the rain actually wants, and the map has never carried it.
            "openingHours": tags.get("opening_hours"),
        })
    return out


def fetch_overpass_pois(bbox=SEARCH_BBOX, timeout=OVERPASS_TIMEOUT_S, scope="all"):
    """Network call. Returns the normalized POI list (see normalize_overpass_elements)."""
    query = build_overpass_query(bbox, timeout, scope)
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        OVERPASS_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=timeout + 15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return normalize_overpass_elements(payload.get("elements", []), scope)


# Kept under its original name: the weekly workflow and the report tooling
# both refer to it.
fetch_overpass_food_pois = fetch_overpass_pois


def _dataset_key(feature):
    props = feature.get("properties") or {}
    osm_type, osm_id = props.get("osmType"), props.get("osmId")
    if osm_type and osm_id:
        return (osm_type, osm_id)
    return None


def diff_pois(osm_pois, dataset_geojson, radius_m=NAME_MATCH_RADIUS_M):
    """Pure diff: no network. Returns the four candidate lists.

    - new_candidates: in OpenStreetMap, not on our map by id or by name-and-place.
    - missing_candidates: our points, sourced from OpenStreetMap, that this
      week's data does not contain -- possibly closed, but a source can lag,
      so never treated as closed on one sighting.
    - closed_candidates: our points whose OpenStreetMap element is tagged as
      closed outright. Evidence, not absence.
    - changed_candidates: our points whose OpenStreetMap element now carries a
      different name or category -- the site has changed hands, which is the
      case that used to be completely invisible.
    """
    dataset_features = dataset_geojson.get("features", [])
    dataset_by_key = {}
    # Grouped by name so the "is this already on the map" check only compares
    # a candidate against the handful of points sharing its name, rather than
    # against all seven hundred of them.
    dataset_by_name = {}
    for feature in dataset_features:
        key = _dataset_key(feature)
        if key:
            dataset_by_key[key] = feature
        name = normalize_name((feature.get("properties") or {}).get("name"))
        if name:
            dataset_by_name.setdefault(name, []).append(feature)

    new_candidates, changed_candidates, closed_candidates, enrich_candidates = [], [], [], []
    seen_osm_keys = set()

    for poi in osm_pois:
        key = (poi.get("osmType"), poi.get("osmId"))
        known = dataset_by_key.get(key)

        if known is not None:
            props = known.get("properties") or {}
            if poi.get("status") == "closed":
                closed_candidates.append({
                    "osmType": key[0], "osmId": key[1],
                    "id": known.get("id") or props.get("id"),
                    "name": props.get("name"),
                    "category": props.get("category"),
                    "reason": "marked closed in OpenStreetMap",
                })
                continue
            seen_osm_keys.add(key)

            # Fields the source has and we do not. Filling a blank is not a
            # change of fact, so it needs none of the patience a closure does
            # -- and blanks are the norm outside the food data, where the
            # transport dataset carries twelve addresses across 1,106 places.
            missing_fields = {
                field: poi.get(field)
                for field in ENRICHABLE_FIELDS
                if poi.get(field) and not props.get(field)
            }
            if missing_fields:
                enrich_candidates.append({
                    "id": known.get("id") or props.get("id"),
                    "osmType": key[0], "osmId": key[1],
                    "name": props.get("name"),
                    "fields": missing_fields,
                })

            renamed = normalize_name(poi.get("name")) != normalize_name(props.get("name"))
            recategorised = bool(poi.get("category")) and poi.get("category") != props.get("category")
            if renamed or recategorised:
                changed_candidates.append({
                    **poi,
                    "id": known.get("id") or props.get("id"),
                    "previousName": props.get("name"),
                    "previousCategory": props.get("category"),
                    "reason": "now trading as " + str(poi.get("name")) if renamed else "listed under a different type now",
                })
            continue

        if poi.get("status") == "closed":
            # A closed element we have never had a point for is nothing to do.
            continue
        if not poi.get("category"):
            continue
        candidates = dataset_by_name.get(normalize_name(poi.get("name")), ())
        if any(same_place(poi, feature, radius_m) for feature in candidates):
            continue
        new_candidates.append(poi)

    closed_keys = {(c["osmType"], c["osmId"]) for c in closed_candidates}
    missing_candidates = []
    for key, feature in dataset_by_key.items():
        if key in seen_osm_keys or key in closed_keys:
            continue
        props = feature.get("properties") or {}
        missing_candidates.append({
            "osmType": key[0],
            "osmId": key[1],
            "id": feature.get("id") or props.get("id"),
            "name": props.get("name"),
            "category": props.get("category"),
            "address": props.get("address"),
            "lon": (feature_lonlat(feature) or (None, None))[0],
            "lat": (feature_lonlat(feature) or (None, None))[1],
        })

    return {
        "new_candidates": new_candidates,
        "missing_candidates": missing_candidates,
        "closed_candidates": closed_candidates,
        "changed_candidates": changed_candidates,
        "enrich_candidates": enrich_candidates,
        # Everything the source still lists, which is a confirmation that the
        # place is there -- free, as a side effect of the diff, and previously
        # thrown away. scripts/verification.py keeps them so "how stale is
        # this map?" stops being a question only a walk can answer.
        "verified": sorted(f"{t}/{i}" for t, i in seen_osm_keys),
    }


def observations_from_diff(diff, source=SOURCE):
    """Flattens a diff into the observation shape scripts/business_watch.py
    records. The key has to identify the same place from one week to the next,
    which the OpenStreetMap element id does exactly."""
    signals = [
        ("new_candidates", "new"),
        ("missing_candidates", "missing"),
        ("closed_candidates", "closed"),
        ("changed_candidates", "changed"),
    ]
    observations = []
    for list_key, signal in signals:
        for candidate in diff.get(list_key, []):
            observations.append({
                "key": f"{candidate.get('osmType')}/{candidate.get('osmId')}",
                "signal": signal,
                "source": source,
                "detail": candidate,
            })
    return observations


# A run that comes back with far fewer points than last week is a bad query,
# not a mass extinction. Below this share of the previous run's population the
# diff is reported but never allowed to escalate anything.
MIN_POPULATION_RATIO = 0.75


def population_is_plausible(current, previous, min_ratio=MIN_POPULATION_RATIO):
    if not previous:
        return True
    return current >= previous * min_ratio


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    # Both files, because the scope covers both: the food points live in one
    # and the halls and libraries in the other. Diffing against only the food
    # file would report every hall already on the map as a new one, every week.
    parser.add_argument(
        "--dataset", nargs="+",
        default=[str(ROOT / "data" / "local-landmarks-food.geojson"),
                 str(ROOT / "data" / "local-landmarks-misc.geojson")],
        help="Map data to compare against. Must between them cover everything --scope asks for.",
    )
    parser.add_argument("--out", default=None, help="Write JSON here instead of stdout")
    parser.add_argument("--scope", default="all", choices=sorted(SCOPES))
    parser.add_argument("--ledger", default=str(business_watch.DEFAULT_LEDGER_PATH))
    parser.add_argument("--changeset", default=None, help="Write the confident changes here, ready for apply_weekly_changeset.py")
    parser.add_argument("--verification", default=str(verification.DEFAULT_PATH),
                        help="Where to record which places this run confirmed are still there")
    parser.add_argument("--today", default=None, help="Date to record this run under (defaults to today)")
    parser.add_argument("--no-record", action="store_true", help="Report only; leave the watchlist untouched")
    args = parser.parse_args()

    today = args.today or datetime.now(timezone.utc).date().isoformat()
    features = []
    for path in args.dataset:
        path = Path(path)
        if path.exists():
            features.extend(json.loads(path.read_text()).get("features", []))
    dataset = {"type": "FeatureCollection", "features": features}
    try:
        osm_pois = fetch_overpass_pois(scope=args.scope)
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Overpass query failed ({exc}) -- skipping the OSM cross-check this run.", file=sys.stderr)
        sys.exit(2)

    result = diff_pois(osm_pois, dataset)
    result["checked_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result["osm_poi_count"] = len(osm_pois)
    result["dataset_count"] = len(dataset.get("features", []))

    ledger = business_watch.load_ledger(args.ledger)
    previous_population = ((ledger.get("sources") or {}).get(SOURCE) or {}).get("population")
    plausible = population_is_plausible(len(osm_pois), previous_population)
    result["population_plausible"] = plausible

    if not plausible:
        result["notes"] = [
            f"OpenStreetMap returned {len(osm_pois)} places, well short of last run's "
            f"{previous_population}. That reads as a bad query rather than real change, so "
            "nothing was escalated or applied this run."
        ]
    elif not args.no_record:
        business_watch.record_run(ledger, observations_from_diff(result), today, sources={SOURCE})
        business_watch.link_agreements(ledger)
        ledger.setdefault("sources", {})[SOURCE] = {"population": len(osm_pois), "checkedAt": today}
        business_watch.save_ledger(ledger, args.ledger)

        record = verification.load(args.verification)
        verification.record_confirmations(record, result["verified"], SOURCE, today)
        verification.save(record, args.verification)

    result["confident"] = business_watch.confident_entries(ledger) if plausible else {}
    result["pending"] = business_watch.pending_entries(ledger)

    if args.changeset:
        # Written even when nothing is confident, and even when the run was
        # not trustworthy: whatever runs next expects the file to be there,
        # and "there is nothing to apply" is an answer. A missing file would
        # read as a crash.
        changeset, notes = business_watch.build_changeset(ledger) if plausible else ({"add": [], "remove": []}, [])
        Path(args.changeset).write_text(json.dumps(changeset, indent=2) + "\n")
        result.setdefault("notes", []).extend(notes)
        print(
            f"Wrote {args.changeset}: {len(changeset['add'])} addition(s), "
            f"{len(changeset['remove'])} removal(s) confident enough to apply.",
            file=sys.stderr,
        )

    output = json.dumps(result, indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n")
        print(f"Wrote {args.out}: {len(result['new_candidates'])} new, "
              f"{len(result['missing_candidates'])} missing, "
              f"{len(result['closed_candidates'])} marked closed, "
              f"{len(result['changed_candidates'])} changed hands.", file=sys.stderr)
        # The whole watchlist, one line each, so the run's own log says what
        # is being watched and how close each thing is -- otherwise the only
        # record is a JSON file nobody opens.
        summary = business_watch.summarise(ledger)
        if summary:
            print("\nWatchlist:\n" + summary, file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
