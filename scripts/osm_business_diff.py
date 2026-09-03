#!/usr/bin/env python3
"""
Diffs the food/shop map data (data/local-landmarks-food.geojson) against a
fresh OpenStreetMap query, to catch the small independent business turnover
that a general news search misses entirely (the exact gap the sample report
flagged: "small independent turnover... won't show up this way").

Deliberately does NOT touch the map data itself -- it only produces a list
of candidates for the weekly research step (a person, or the LLM in
weekly-ledger.yml) to look at, the same "skip anything you're not confident
about" spirit as the rest of that workflow. OSM being silent on a name is
not proof of closure (OSM data can simply lag reality), so "missing"
candidates are always phrased as "worth checking", never as confirmed.

Usage:
    python3 scripts/osm_business_diff.py [--dataset PATH] [--out PATH]

Network: queries the public Overpass API (no key needed). The diffing
logic itself (diff_pois) takes plain Python data and has no network
dependency, so it's fully unit-testable -- see scripts/test_osm_business_diff.py.
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

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


def build_overpass_query(bbox=SEARCH_BBOX, timeout=OVERPASS_TIMEOUT_S):
    south, west, north, east = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    box = f"{south},{west},{north},{east}"
    amenity_pattern = "|".join(AMENITY_CATEGORIES)
    shop_pattern = "|".join(SHOP_CATEGORIES)
    return (
        f"[out:json][timeout:{timeout}];\n"
        "(\n"
        f'  nwr["amenity"~"^({amenity_pattern})$"]["name"]({box});\n'
        f'  nwr["shop"~"^({shop_pattern})$"]["name"]({box});\n'
        ");\n"
        "out center tags;\n"
    )


def _category_from_tags(tags):
    amenity = tags.get("amenity")
    if amenity in AMENITY_CATEGORIES:
        return AMENITY_CATEGORIES[amenity]
    shop = tags.get("shop")
    if shop in SHOP_CATEGORIES:
        return SHOP_CATEGORIES[shop]
    return None


def normalize_overpass_elements(elements):
    """Turns raw Overpass JSON elements into the flat shape diff_pois()
    expects: {osmType, osmId, name, category, lon, lat, address}."""
    out = []
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name")
        if not name:
            continue
        category = _category_from_tags(tags)
        if not category:
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
            "lon": round(float(lon), 7),
            "lat": round(float(lat), 7),
            "address": address,
            "website": tags.get("website") or tags.get("contact:website"),
            "phone": tags.get("phone") or tags.get("contact:phone"),
        })
    return out


def fetch_overpass_food_pois(bbox=SEARCH_BBOX, timeout=OVERPASS_TIMEOUT_S):
    """Network call. Returns the normalized POI list (see normalize_overpass_elements)."""
    query = build_overpass_query(bbox, timeout)
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        OVERPASS_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=timeout + 15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return normalize_overpass_elements(payload.get("elements", []))


def _normalize_name(name):
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def _dataset_key(feature):
    props = feature.get("properties") or {}
    osm_type, osm_id = props.get("osmType"), props.get("osmId")
    if osm_type and osm_id:
        return (osm_type, osm_id)
    return None


def diff_pois(osm_pois, dataset_geojson):
    """Pure diff: no network. Returns {"new_candidates": [...], "missing_candidates": [...]}.

    - new_candidates: OSM POIs not represented in the dataset by id or name
      -- possible openings/gaps worth a human look.
    - missing_candidates: dataset entries that came from OSM (have a
      recorded osmType/osmId) but weren't seen in this fresh OSM query --
      *possibly* closed, but OSM lagging reality is common, so always
      "worth checking", never a confirmed closure.
    """
    dataset_features = dataset_geojson.get("features", [])
    dataset_by_key = {}
    dataset_names = set()
    for feature in dataset_features:
        key = _dataset_key(feature)
        if key:
            dataset_by_key[key] = feature
        name = (feature.get("properties") or {}).get("name")
        if name:
            dataset_names.add(_normalize_name(name))

    new_candidates = []
    seen_osm_keys = set()
    for poi in osm_pois:
        key = (poi.get("osmType"), poi.get("osmId"))
        seen_osm_keys.add(key)
        if key in dataset_by_key:
            continue
        if _normalize_name(poi.get("name")) in dataset_names:
            continue
        new_candidates.append(poi)

    missing_candidates = []
    for key, feature in dataset_by_key.items():
        if key not in seen_osm_keys:
            props = feature.get("properties") or {}
            missing_candidates.append({
                "osmType": key[0],
                "osmId": key[1],
                "name": props.get("name"),
                "category": props.get("category"),
            })

    return {"new_candidates": new_candidates, "missing_candidates": missing_candidates}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default=str(ROOT / "data" / "local-landmarks-food.geojson"))
    parser.add_argument("--out", default=None, help="Write JSON here instead of stdout")
    args = parser.parse_args()

    dataset = json.loads(Path(args.dataset).read_text())
    try:
        osm_pois = fetch_overpass_food_pois()
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Overpass query failed ({exc}) -- skipping the OSM cross-check this run.", file=sys.stderr)
        sys.exit(2)

    result = diff_pois(osm_pois, dataset)
    result["checked_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result["osm_poi_count"] = len(osm_pois)
    result["dataset_count"] = len(dataset.get("features", []))

    output = json.dumps(result, indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n")
        print(f"Wrote {args.out}: {len(result['new_candidates'])} new candidate(s), "
              f"{len(result['missing_candidates'])} possibly-missing entr(y/ies).", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
