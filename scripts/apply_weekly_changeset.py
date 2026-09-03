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
checkout, e.g. the weekly-ledger GitHub Actions workflow -- this repo's
weekly automation only ever touches the food category), this script
edits data/local-landmarks-food.geojson directly instead and skips the
split step, since there's no master to re-split from.
"""
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
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

PROPERTY_KEYS = [
    "id", "osmType", "osmId", "name", "category", "categoryLabel", "amenity", "shop",
    "highway", "tourism", "historic", "railway", "barrier", "entrance", "heritage",
    "website", "phone", "address", "distanceToForestBoundaryMetres",
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
    if category not in VALID_FOOD_CATEGORIES:
        raise ValueError(
            f"Unknown category {category!r} - add it to VALID_FOOD_CATEGORIES first "
            f"(known: {sorted(VALID_FOOD_CATEGORIES)})"
        )
    tag_kind, default_label = VALID_FOOD_CATEGORIES[category]
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
    log = {"added": [], "removed": [], "skipped": []}

    for entry in changeset.get("remove", []):
        target_id = entry.get("id")
        target_name = entry.get("name")
        matches = [
            f for f in features
            if (target_id and f.get("id") == target_id)
            or (not target_id and target_name and f["properties"].get("name") == target_name)
        ]
        if not matches:
            log["skipped"].append({"op": "remove", "entry": entry, "reason": "no match found in dataset"})
            continue
        for m in matches:
            features.remove(m)
        log["removed"].append({"id": target_id or target_name, "name": target_name, "reason": entry.get("reason")})

    existing_names_lower = {(f["properties"].get("name") or "").lower() for f in features}
    for entry in changeset.get("add", []):
        name_lower = entry["name"].lower()
        if name_lower in existing_names_lower:
            log["skipped"].append({"op": "add", "entry": entry, "reason": "a feature with this name already exists - possible duplicate"})
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
        existing_names_lower.add(name_lower)
        log["added"].append({"id": feature["id"], "name": feature["properties"]["name"], "category": feature["properties"]["category"]})

    return log


def resolve_target_file():
    """Master file if we have one (local/laptop path); otherwise fall back
    to editing the food split file directly (CI path -- see module docstring)."""
    if MASTER_FILE.exists():
        return MASTER_FILE, True
    return DATA / "local-landmarks-food.geojson", False


def main():
    if len(sys.argv) != 2:
        print("Usage: apply_weekly_changeset.py <changeset.json>", file=sys.stderr)
        sys.exit(1)

    changeset = json.loads(Path(sys.argv[1]).read_text())
    target_file, has_master = resolve_target_file()
    target = json.loads(target_file.read_text())
    forest_geojson = json.loads(FOREST_BOUNDARY_FILE.read_text())
    segments, ref_lat_rad = load_boundary_segments(forest_geojson)

    log = apply_changeset(target, changeset, segments, ref_lat_rad)

    target["generatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    target_file.write_text(json.dumps(target, indent=2) + "\n")

    print(json.dumps(log, indent=2))
    if not has_master:
        print(
            f"\nNo {MASTER_FILE.name} found (it's gitignored, local-only) -- applied directly "
            f"to {target_file.name} instead. This is the expected path in CI: split_landmarks.py "
            f"was NOT run, since there's no master to re-derive the other category files from.",
            file=sys.stderr,
        )
    if log["skipped"]:
        print(f"\n{len(log['skipped'])} entr(y/ies) skipped - review before treating this changeset as fully applied.", file=sys.stderr)


if __name__ == "__main__":
    main()
