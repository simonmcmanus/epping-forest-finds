#!/usr/bin/env python3
"""
Cross-checks the map's food places against the councils' own food-hygiene
register, to catch the openings OpenStreetMap has not heard about yet.

Why this source, when there is already an OpenStreetMap check
-------------------------------------------------------------
OpenStreetMap only knows what a volunteer has been along and mapped. A cafe
that opened last month may not be there for a year. The food-hygiene register
is the other way round: a food business has to register with its council
before it may trade, and the council publishes it. So a new cafe appears here
within weeks of opening, with an address and coordinates, whether or not
anybody has mapped it. Loughton has had places trading for some time that this
map has never carried; this is the source that knows about them.

What it does and does not do
----------------------------
Openings only. This check never proposes a removal, and that is deliberate
rather than an omission: the register lists businesses under the name their
owner registered, which is often not the name over the door, so "on our map,
not in the register" is far more often a naming difference than a closure.
That mistake would be systematic -- it would repeat every week and so clear
any patience threshold -- and it removes places walkers rely on. Closures are
left to the OpenStreetMap check, which has explicit closure tags to go on:
somebody recording a fact rather than a silence.

Findings go to scripts/business_watch.py, the same watchlist the
OpenStreetMap check feeds, so an opening both sources agree on simply reaches
confidence sooner.

Usage:
    python3 scripts/fsa_business_diff.py [--dataset PATH] [--out PATH]
                                         [--ledger PATH] [--today YYYY-MM-DD]
                                         [--no-record]

Network: the Food Standards Agency's public Food Hygiene Rating Scheme API.
No key or registration, but every request must carry `x-api-version: 2` or it
returns nothing. Authorities are looked up by name at run time rather than by
hard-coded id, so the check keeps working when the agency renumbers them. The
diffing itself takes plain Python data and has no network dependency -- see
scripts/test_fsa_business_diff.py.
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

from scripts import business_watch  # noqa: E402
from scripts import forest_boundary  # noqa: E402
from scripts.place_matching import name_key, same_place  # noqa: E402

API_BASE = "https://api.ratings.food.gov.uk"
API_HEADERS = {"x-api-version": "2", "accept": "application/json"}
REQUEST_TIMEOUT_S = 45
PAGE_SIZE = 200
MAX_PAGES = 40

SOURCE = "fsa"

# The councils covering the settlements the weekly report covers: Loughton,
# Chingford, Buckhurst Hill, Chigwell, Theydon Bois, Epping, Woodford Green
# and Waltham Abbey. Matched against the register's own authority names, so a
# renumbering on their side changes nothing here.
COVERAGE_AUTHORITIES = (
    "Epping Forest",
    "Waltham Forest",
    "Redbridge",
    "Broxbourne",
)

# The register covers school kitchens, care homes, caterers and food
# manufacturers as well as places a walker can buy lunch. Only the ones the
# map is for are worth a pin.
MAPPABLE_BUSINESS_TYPES = (
    "restaurant", "cafe", "canteen", "takeaway", "sandwich",
    "pub", "bar", "nightclub", "retailer", "supermarket", "hypermarket",
    "bakers", "farmers", "mobile caterer",
)

# The register's business type, mapped onto the map's own food categories.
# Checked in order, so the longer, more specific strings come first.
#
# The register files restaurants, cafes and canteens under one type and cannot
# tell them apart, so anything from that group is proposed as a restaurant and
# may want correcting to a cafe by whoever reviews the week's changes. That
# ambiguity is the price of the source: it knows a place exists and where,
# some weeks before anyone maps it, but not what it calls itself.
CATEGORY_BY_BUSINESS_TYPE = (
    ("restaurant/cafe/canteen", "restaurant"),
    ("takeaway/sandwich", "restaurant"),
    ("pub", "pub"),
    ("nightclub", "bar"),
    ("bar", "bar"),
    ("supermarket", "supermarket"),
    ("hypermarket", "supermarket"),
    ("bakers", "bakery"),
    ("takeaway", "restaurant"),
    ("sandwich", "cafe"),
    ("canteen", "cafe"),
    ("cafe", "cafe"),
    ("restaurant", "restaurant"),
    ("farmers", "farm"),
    ("retailer", "convenience"),
)

DEFAULT_CATEGORY = "restaurant"

# The register holds the name a business registered under, which is often the
# company rather than the sign over the door: "Lidl Great Britain Limited"
# belongs on the map as "Lidl". Stripped from the end only, so a name that
# genuinely contains one of these words keeps it.
# Held without trailing punctuation; the trimming below strips that first, so
# "Ltd." and "Ltd" are the same entry.
COMPANY_SUFFIXES = (
    "limited", "ltd", "plc", "llp", "uk", "gb",
    "great britain", "england", "holdings", "group",
)

# A concession trades inside somebody else's premises -- a sushi counter in a
# supermarket, a coffee bar in a garden centre. The register lists it as its
# own business; the map would gain a second pin on a shop it already has. The
# giveaway is the host's name sitting in the address, which is how the
# register records them.
HOST_PREMISES_MARKERS = (
    "sainsbury", "tesco", "asda", "morrison", "waitrose", "aldi", "lidl",
    "marks and spencer", "m&s", "garden centre", "retail park", "service station",
    "petrol", "hospital", "golf club", "leisure centre", "hotel",
)

# Members' clubs register as licensed premises and land in the pub bucket. A
# cricket club with a bar is not somewhere a walker can drop in for a pint,
# and putting it on the map as a pub misleads.
MEMBERS_CLUB_MARKERS = ("cricket club", "football club", "rugby club", "bowls club",
                        "social club", "working men", "british legion", "golf club")


def _get_json(url):
    request = urllib.request.Request(url, headers=API_HEADERS)
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_authority_ids(names=COVERAGE_AUTHORITIES):
    """Network call. Resolves council names to the register's own ids."""
    payload = _get_json(f"{API_BASE}/Authorities/basic")
    wanted = [n.lower() for n in names]
    ids = []
    for authority in payload.get("authorities", []) or []:
        name = (authority.get("Name") or "").lower()
        if any(w in name for w in wanted):
            ids.append({"id": authority.get("LocalAuthorityId"), "name": authority.get("Name")})
    return ids


def fetch_establishments(authority_id, page_size=PAGE_SIZE, max_pages=MAX_PAGES):
    """Network call. Pages through one council's register."""
    out = []
    for page in range(1, max_pages + 1):
        query = urllib.parse.urlencode({
            "localAuthorityId": authority_id,
            "pageNumber": page,
            "pageSize": page_size,
        })
        payload = _get_json(f"{API_BASE}/Establishments?{query}")
        batch = payload.get("establishments") or []
        out.extend(batch)
        if len(batch) < page_size:
            break
    return out


def is_mappable(establishment):
    business_type = (establishment.get("BusinessType") or "").lower()
    return any(word in business_type for word in MAPPABLE_BUSINESS_TYPES)


def category_for(establishment):
    business_type = (establishment.get("BusinessType") or "").lower()
    for word, category in CATEGORY_BY_BUSINESS_TYPE:
        if word in business_type:
            return category
    return DEFAULT_CATEGORY


def clean_name(name):
    """The name over the door, as far as the register allows.

    Trailing punctuation is trimmed before each comparison, so "Ltd." and
    "Ltd" are one case, and the slice is taken from the trimmed text -- doing
    otherwise turns "Costa Coffee Ltd." into "Costa Coffee L".
    """
    original = " ".join((name or "").split())
    cleaned = original
    while cleaned:
        trimmed = cleaned.rstrip(" .,-")
        lowered = trimmed.lower()
        for suffix in COMPANY_SUFFIXES:
            if lowered.endswith(" " + suffix):
                cleaned = trimmed[: len(trimmed) - len(suffix)].rstrip(" .,-")
                break
        else:
            return trimmed or original
    return original


def is_concession(establishment):
    """Trading inside somebody else's premises, so the map already has a pin
    there and does not want a second one."""
    address = " ".join(
        str(establishment.get(f"AddressLine{n}") or "") for n in (1, 2, 3, 4)
    ).lower()
    name = (establishment.get("BusinessName") or "").lower()
    return any(marker in address and marker not in name for marker in HOST_PREMISES_MARKERS)


def is_members_club(establishment):
    name = (establishment.get("BusinessName") or "").lower()
    return any(marker in name for marker in MEMBERS_CLUB_MARKERS)


def _address_of(establishment):
    parts = [establishment.get(f"AddressLine{n}") for n in (1, 2, 3, 4)]
    parts.append(establishment.get("PostCode"))
    return ", ".join(p.strip() for p in parts if p and p.strip()) or None


def _coordinates_of(establishment):
    """The register returns coordinates as strings, and leaves them out
    entirely for businesses it has not geocoded -- a mobile caterer, or a new
    registration. Without a position there is nothing to put on a map, so
    those are dropped rather than guessed at."""
    geocode = establishment.get("geocode") or {}
    try:
        return float(geocode.get("longitude")), float(geocode.get("latitude"))
    except (TypeError, ValueError):
        return None


_SCOPE = None


def _scope_index():
    """Loaded once and kept: the boundary is 3MB of geometry and every
    candidate is measured against it."""
    global _SCOPE
    if _SCOPE is None:
        _SCOPE = forest_boundary.load_index()
    return _SCOPE


def normalize_establishments(establishments, scope=None):
    """Turns the register's records into the flat shape diff_establishments()
    expects, dropping everything without a position, of a kind the map does
    not show, or too far from the forest for the map to carry.

    That last rule is the one that matters here. The register covers whole
    council areas -- the first run to reach it found 3,204 food businesses,
    of which 2,949 were not on the map, nearly all of them miles from any
    tree. Filtering by the search box alone would have banked every one of
    them on the watchlist. The map's rule is eight minutes' walk from the
    forest boundary, and so is this."""
    scope = scope or _scope_index()
    out = []
    for establishment in establishments:
        if not is_mappable(establishment):
            continue
        if is_concession(establishment) or is_members_club(establishment):
            continue
        coordinates = _coordinates_of(establishment)
        if coordinates is None:
            continue
        lon, lat = coordinates
        if not forest_boundary.within_walk(lon, lat, scope):
            continue
        name = clean_name(establishment.get("BusinessName"))
        if not name:
            continue
        out.append({
            "fhrsId": establishment.get("FHRSID"),
            "name": name,
            "category": category_for(establishment),
            "businessType": establishment.get("BusinessType"),
            "authority": establishment.get("LocalAuthorityName"),
            "lon": round(lon, 7),
            "lat": round(lat, 7),
            "address": _address_of(establishment),
            "ratingDate": establishment.get("RatingDate"),
        })
    return out


def diff_establishments(establishments, dataset_geojson):
    """Pure diff: no network. Returns {"new_candidates": [...]} -- registered
    and trading, but nowhere on our map. Matching is deliberately forgiving
    about names (see scripts/place_matching.py): the register holds registered
    names, the map holds the name over the door, and treating those as
    different businesses would propose adding a duplicate pin every week."""
    # Indexed on the same forgiving key the comparison uses, so each
    # registered business is only weighed against the map points that could
    # plausibly be it rather than against every point on the map.
    by_key = {}
    for feature in dataset_geojson.get("features", []):
        by_key.setdefault(name_key((feature.get("properties") or {}).get("name")), []).append(feature)

    new_candidates = []
    for establishment in establishments:
        candidates = by_key.get(name_key(establishment.get("name")), ())
        if any(same_place(establishment, feature, fuzzy=True) for feature in candidates):
            continue
        new_candidates.append(establishment)
    return {"new_candidates": new_candidates}


def observations_from_diff(diff, source=SOURCE):
    return [
        {
            "key": f"fsa/{candidate.get('fhrsId')}",
            "signal": "new",
            "source": source,
            "detail": candidate,
        }
        for candidate in diff.get("new_candidates", [])
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default=str(ROOT / "data" / "local-landmarks-food.geojson"))
    parser.add_argument("--out", default=None, help="Write JSON here instead of stdout")
    parser.add_argument("--ledger", default=str(business_watch.DEFAULT_LEDGER_PATH))
    parser.add_argument("--today", default=None, help="Date to record this run under (defaults to today)")
    parser.add_argument("--no-record", action="store_true", help="Report only; leave the watchlist untouched")
    args = parser.parse_args()

    today = args.today or datetime.now(timezone.utc).date().isoformat()
    dataset = json.loads(Path(args.dataset).read_text())

    try:
        authorities = fetch_authority_ids()
        raw = []
        for authority in authorities:
            raw.extend(fetch_establishments(authority["id"]))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(
            f"The food-hygiene register could not be reached ({exc}) -- skipping this "
            "cross-check. The OpenStreetMap check is unaffected.",
            file=sys.stderr,
        )
        sys.exit(2)

    establishments = normalize_establishments(raw)
    result = diff_establishments(establishments, dataset)
    result["checked_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result["authorities"] = [a["name"] for a in authorities]
    result["establishment_count"] = len(establishments)
    result["dataset_count"] = len(dataset.get("features", []))

    if not args.no_record:
        ledger = business_watch.load_ledger(args.ledger)
        business_watch.record_run(ledger, observations_from_diff(result), today, sources={SOURCE})
        ledger.setdefault("sources", {})[SOURCE] = {"population": len(establishments), "checkedAt": today}
        business_watch.save_ledger(ledger, args.ledger)

    output = json.dumps(result, indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n")
        print(
            f"Wrote {args.out}: {len(result['new_candidates'])} registered food business(es) "
            f"not on the map, out of {len(establishments)} in the area.",
            file=sys.stderr,
        )
    else:
        print(output)


if __name__ == "__main__":
    main()
