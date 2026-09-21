#!/usr/bin/env python3
"""
Apply a weekly changeset (additions/removals) to the master landmarks
dataset and regenerate the split category files.

Written for the weekly "Epping Forest Ledger" report (see reports/) to turn
its research findings into a review-ready diff. Always run this inside an
isolated git worktree/branch -- never against a dirty `main` checkout. See
scripts/prepare_weekly_branch.sh for the wrapper that does that safely.

Usage:
    python3 scripts/apply_weekly_changeset.py <changeset.json>

Changeset schema:
{
  "add": [
    {
      "name": "The Hair of the Dog",
      "category": "pub",                 // must be a known food category
      "lon": 0.0573766, "lat": 51.6521913,
      "address": "15 York Hill, Loughton, IG10 1RL",   // optional
      "website": "https://...",                          // optional
      "phone": "020 ...",                                 // optional
      "categoryLabel": "Pub",             // optional, defaults per category
      "osmType": "node", "osmId": 123456  // optional, when sourced from OSM
    }
  ],
  "remove": [
    {"name": "Morrisons Cafe", "reason": "reported closed - Yelp, Aug 2026"}
  ]
}

Prints a JSON log of what was added / removed / skipped. Anything skipped
(duplicate name, no match to remove, implausible distance from the forest
boundary) needs a human look -- this script deliberately refuses to guess.

Target file: data/local-landmarks.geojson (the master) is gitignored --
it only exists on a machine that has run the regenerate/split scripts
locally. When it's present (the normal local/laptop path, via
prepare_weekly_branch.sh), this script edits it and split_landmarks.py
re-derives the category files from it. When it's absent (a fresh CI
checkout, e.g. the weekly-ledger GitHub Actions workflow), this script
edits the split files directly instead and skips the split step, since
there's no master to re-split from: food categories go to
data/local-landmarks-food.geojson and venue categories (a hall, library
or arts centre -- see VALID_VENUE_CATEGORIES) to
data/local-landmarks-misc.geojson, which is where split_landmarks.py
would put them. A removal is applied to whichever file currently holds
it.

Homepage counts: data/local-landmarks-food.geojson's size is quoted as
copy on the marketing homepage and held to the real data by
test/home-counts.test.js, so any change here needs
`node scripts/sync-homepage-counts.js` run afterwards or CI fails.
"""
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.place_matching import same_premises  # noqa: E402
DATA = ROOT / "data"
MASTER_FILE = DATA / "local-landmarks.geojson"
FOREST_BOUNDARY_FILE = DATA / "epping-forest-land.geojson"

# Matches scripts/regenerate_local_landmarks.py / add_missing_shops.py
WALKING_SPEED_M_PER_MIN = 3500 / 60  # 3.5 km/h
MAX_WALK_MINUTES_FROM_BOUNDARY = 8
MAX_DISTANCE_FROM_BOUNDARY_METRES = WALKING_SPEED_M_PER_MIN * MAX_WALK_MINUTES_FROM_BOUNDARY

# category -> (OSM tag kind, default label), matches scripts/split_landmarks.py's food group
VALID_FOOD_CATEGORIES = {
    "pub": ("amenity", "Pub"),
    "bar": ("amenity", "Bar"),
    "cafe": ("amenity", "Café"),
    "tea": ("amenity", "Tea Hut"),
    "restaurant": ("amenity", "Restaurant"),
    "convenience": ("shop", "Convenience Store"),
    "supermarket": ("shop", "Supermarket"),
    "grocery": ("shop", "Grocery Store"),
    "general": ("shop", "General Store"),
    "greengrocer": ("shop", "Greengrocer"),
    "butcher": ("shop", "Butcher"),
    "bakery": ("shop", "Bakery"),
    "deli": ("shop", "Deli"),
    "farm": ("shop", "Farm Shop"),
    "pastry": ("shop", "Pastry Shop"),
    "kiosk": ("shop", "Kiosk"),
    "confectionery": ("shop", "Confectionery"),
}

# The places a town uses that are not food: the village hall, the library, the
# arts centre. They were out of the weekly run's reach entirely -- it only
# ever touched the food file -- so one closing or opening could never reach
# the map however plainly a source said so. They belong to the "misc" split
# file (see scripts/split_landmarks.py, which routes anything uncategorised
# there).
VALID_VENUE_CATEGORIES = {
    "community_centre": ("amenity", "Community Centre"),
    "public_hall": ("amenity", "Public Hall"),
    "arts_centre": ("amenity", "Arts Centre"),
    "theatre": ("amenity", "Theatre"),
    "cinema": ("amenity", "Cinema"),
    "townhall": ("amenity", "Town Hall"),
    "library": ("amenity", "Library"),
    "social_centre": ("amenity", "Social Club"),
}

VALID_CATEGORIES = {**VALID_FOOD_CATEGORIES, **VALID_VENUE_CATEGORIES}

FOOD_FILE = DATA / "local-landmarks-food.geojson"
MISC_FILE = DATA / "local-landmarks-misc.geojson"

PROPERTY_KEYS = [
    "id", "osmType", "osmId", "name", "category", "categoryLabel", "amenity", "shop",
    "highway", "tourism", "historic", "railway", "barrier", "entrance", "heritage",
    "website", "phone", "address", "openingHours", "distanceToForestBoundaryMetres",
    "distanceLimitFromForestBoundaryMetres",
]


def slugify(name):
    slug = "".join(c.lower() if c.isalnum() else "-" for c in name)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")


def load_boundary_segments(forest_geojson):
    segments = []
    for feature in forest_geojson.get("features", []):
        geom = feature.get("geometry") or {}
        gtype = geom.get("type")
        coords = geom.get("coordinates", [])
        rings = []
        if gtype == "Polygon":
            rings = coords
        elif gtype == "MultiPolygon":
            for poly in coords:
                rings.extend(poly)
        for ring in rings:
            for i in range(len(ring) - 1):
                segments.append((ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]))
    lats = [s[1] for s in segments] + [s[3] for s in segments]
    ref_lat_rad = math.radians(sum(lats) / len(lats)) if lats else math.radians(51.65)
    return segments, ref_lat_rad


def to_local_xy(lon, lat, ref_lat_rad):
    R = 6371000
    x = R * math.radians(lon) * math.cos(ref_lat_rad)
    y = R * math.radians(lat)
    return x, y


def point_to_segment_distance_m(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def distance_to_boundary_m(lon, lat, segments, ref_lat_rad):
    if not segments:
        return 0.0
    px, py = to_local_xy(lon, lat, ref_lat_rad)
    best = None
    for ax_lon, ax_lat, bx_lon, bx_lat in segments:
        ax, ay = to_local_xy(ax_lon, ax_lat, ref_lat_rad)
        bx, by = to_local_xy(bx_lon, bx_lat, ref_lat_rad)
        d = point_to_segment_distance_m(px, py, ax, ay, bx, by)
        if best is None or d < best:
            best = d
    return best


def build_feature(entry, segments, ref_lat_rad):
    category = entry["category"]
    if category not in VALID_CATEGORIES:
        raise ValueError(
            f"Unknown category {category!r} - add it to VALID_FOOD_CATEGORIES or "
            f"VALID_VENUE_CATEGORIES first (known: {sorted(VALID_CATEGORIES)})"
        )
    tag_kind, default_label = VALID_CATEGORIES[category]
    lon, lat = float(entry["lon"]), float(entry["lat"])
    feature_id = entry.get("id") or f"manual/{slugify(entry['name'])}"
    dist = distance_to_boundary_m(lon, lat, segments, ref_lat_rad)

    props = {k: None for k in PROPERTY_KEYS}
    props.update({
        "id": feature_id,
        "osmType": entry.get("osmType", "manual"),
        "osmId": entry.get("osmId"),
        "name": entry["name"],
        "category": category,
        "categoryLabel": entry.get("categoryLabel", default_label),
        "amenity": category if tag_kind == "amenity" else None,
        "shop": category if tag_kind == "shop" else None,
        "website": entry.get("website"),
        "phone": entry.get("phone"),
        "address": entry.get("address"),
        "openingHours": entry.get("openingHours"),
        "distanceToForestBoundaryMetres": round(dist, 1),
        "distanceLimitFromForestBoundaryMetres": round(MAX_DISTANCE_FROM_BOUNDARY_METRES, 1),
    })
    return {
        "type": "Feature",
        "id": feature_id,
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": props,
    }


def apply_changeset(master, changeset, segments, ref_lat_rad):
    """Mutates master['features'] in place. Returns a log dict."""
    features = master["features"]
    log = {"added": [], "removed": [], "enriched": [], "skipped": []}

    for entry in changeset.get("remove", []):
        target_name = entry.get("name")
        matches = [f for f in features if _matches(f, entry)]
        if not matches:
            log["skipped"].append({"op": "remove", "entry": entry, "reason": "no match found in dataset"})
            continue
        for m in matches:
            features.remove(m)
        log["removed"].append({"id": entry.get("id") or target_name, "name": target_name, "reason": entry.get("reason")})

    for entry in changeset.get("enrich", []):
        matches = [f for f in features if _matches(f, entry)]
        if not matches:
            log["skipped"].append({"op": "enrich", "entry": entry, "reason": "no match found in dataset"})
            continue
        filled = {}
        for feature in matches:
            props = feature["properties"]
            for field, value in (entry.get("fields") or {}).items():
                # Only ever fills a blank. A value already on the map may have
                # been put there by somebody who went and looked, and the
                # source may simply be older, or wrong.
                if value and not props.get(field):
                    props[field] = value
                    filled[field] = value
        if filled:
            log["enriched"].append({"id": entry.get("id") or entry.get("name"), "name": entry.get("name"), "fields": filled})

    for entry in changeset.get("add", []):
        # Matched on the name as typed AND as described, within a short walk
        # -- not on an exact lowercased string, which is all this used to do.
        # A run adding a hundred places a week meets both kinds of near-miss:
        # "CHAPTER 21" arrived beside the mapped "Chapter21" 24 metres away
        # and only a person spotted it. Distance-scoped rather than global, so
        # a genuinely new branch of a chain across town is still addable --
        # that was the other half of the same bug.
        duplicate = next((f for f in features if same_premises(entry, f)), None)
        if duplicate is not None:
            log["skipped"].append({
                "op": "add", "entry": entry,
                "reason": "already on the map as "
                          f"{(duplicate['properties'].get('name') or '?')!r} "
                          f"({duplicate.get('id') or duplicate['properties'].get('id')}) - possible duplicate",
            })
            continue
        feature = build_feature(entry, segments, ref_lat_rad)
        dist = feature["properties"]["distanceToForestBoundaryMetres"]
        if dist > MAX_DISTANCE_FROM_BOUNDARY_METRES * 1.5:
            log["skipped"].append({
                "op": "add", "entry": entry,
                "reason": f"{dist}m from the forest boundary - well outside the usual "
                          f"{MAX_DISTANCE_FROM_BOUNDARY_METRES:.0f}m cutoff, needs a human look before adding",
            })
            continue
        features.append(feature)
        log["added"].append({"id": feature["id"], "name": feature["properties"]["name"], "category": feature["properties"]["category"]})

    return log


def resolve_target_file():
    """Master file if we have one (local/laptop path); otherwise fall back
    to editing the food split file directly (CI path -- see module docstring)."""
    if MASTER_FILE.exists():
        return MASTER_FILE, True
    return FOOD_FILE, False


def file_for_category(category):
    """Which split file an addition belongs in when there is no master to
    re-split from. Food goes to the food file; a hall, library or arts centre
    goes to the misc file, which is where split_landmarks.py would have put
    it anyway."""
    return MISC_FILE if category in VALID_VENUE_CATEGORIES else FOOD_FILE


def _matches(feature, entry):
    target_id, target_name = entry.get("id"), entry.get("name")
    if target_id:
        return feature.get("id") == target_id
    return bool(target_name) and (feature["properties"].get("name") == target_name)


def file_holding(entry, datasets):
    """Which loaded file currently contains the thing a removal names. Looking
    it up beats applying every removal to every file: a removal that matched
    nowhere is a finding worth a human's time, and it would be buried if each
    one also produced a 'no match' against the files it was never in."""
    for path, dataset in datasets.items():
        if any(_matches(feature, entry) for feature in dataset["features"]):
            return path
    return None


def split_changeset_by_file(changeset, datasets):
    """Routes each entry to the file it belongs in. Removals whose target is
    in none of them are left on the food file, so apply_changeset() reports
    them as skipped in the usual way rather than dropping them silently."""
    per_file = {path: {"add": [], "remove": [], "enrich": []} for path in datasets}
    for entry in changeset.get("add", []):
        per_file[file_for_category(entry.get("category"))]["add"].append(entry)
    for op in ("remove", "enrich"):
        for entry in changeset.get(op, []):
            per_file[file_holding(entry, datasets) or FOOD_FILE][op].append(entry)
    return per_file


def main():
    if len(sys.argv) != 2:
        print("Usage: apply_weekly_changeset.py <changeset.json>", file=sys.stderr)
        sys.exit(1)

    raw = json.loads(Path(sys.argv[1]).read_text())
    changeset = {k: raw.get(k) or [] for k in ("add", "remove", "enrich")}
    forest_geojson = json.loads(FOREST_BOUNDARY_FILE.read_text())
    segments, ref_lat_rad = load_boundary_segments(forest_geojson)

    master_file, has_master = resolve_target_file()
    if has_master:
        datasets = {master_file: json.loads(master_file.read_text())}
        per_file = {master_file: changeset}
    else:
        datasets = {
            path: json.loads(path.read_text()) if path.exists()
            else {"type": "FeatureCollection", "features": []}
            for path in (FOOD_FILE, MISC_FILE)
        }
        per_file = split_changeset_by_file(changeset, datasets)

    log = {"added": [], "removed": [], "enriched": [], "skipped": []}
    written = []
    for path, dataset in datasets.items():
        part = per_file[path]
        if not any(part.get(op) for op in ("add", "remove", "enrich")):
            continue
        file_log = apply_changeset(dataset, part, segments, ref_lat_rad)
        for key in log:
            log[key].extend(file_log[key])
        dataset["generatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        path.write_text(json.dumps(dataset, indent=2) + "\n")
        written.append(path.name)

    print(json.dumps(log, indent=2))
    if not has_master:
        print(
            f"\nNo {MASTER_FILE.name} found (it's gitignored, local-only) -- applied directly "
            f"to {', '.join(written) or 'nothing'} instead. This is the expected path in CI: "
            "split_landmarks.py was NOT run, since there's no master to re-derive the other "
            "category files from.",
            file=sys.stderr,
        )
    if log["skipped"]:
        print(f"\n{len(log['skipped'])} entr(y/ies) skipped - review before treating this changeset as fully applied.", file=sys.stderr)


if __name__ == "__main__":
    main()
