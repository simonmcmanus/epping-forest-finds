import argparse
import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
DATA = ROOT / "data"
QUERY_PATH = DATA / "local-paths.overpassql"
OVERPASS_JSON_PATH = DATA / "local-paths.overpass.json"
GEOJSON_PATH = DATA / "local-paths.geojson"
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]


def fetch_overpass(query_text):
    last_error = None
    for endpoint in OVERPASS_URLS:
        try:
            request = urllib.request.Request(
                endpoint,
                data=query_text.encode("utf-8"),
                headers={"Content-Type": "text/plain; charset=utf-8"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                print(f"Fetched from {endpoint} via POST")
                return response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            last_error = error
            try:
                encoded = urllib.parse.urlencode({"data": query_text})
                with urllib.request.urlopen(f"{endpoint}?{encoded}", timeout=120) as response:
                    print(f"Fetched from {endpoint} via GET")
                    return response.read().decode("utf-8")
            except Exception as inner_error:
                last_error = inner_error
                continue
        except Exception as error:
            last_error = error
            continue
    raise RuntimeError(f"Failed to fetch Overpass data: {last_error}")


# Converts one raw Overpass "elements" list into this app's paths GeoJSON. Deliberately keeps
# every walkable way regardless of whether it has a `name` tag -- most real footpaths (especially
# official Public Rights of Way, tagged designation=public_footpath + prow_ref rather than name)
# have no name at all, and js/routing.js routes across this same file, so dropping unnamed ways
# doesn't just declutter the map, it deletes real shortcuts from the walking router. (This is
# exactly what scripts/remove_unnamed_trails.py did on 2026-05-20, silently -- see git history
# and /routing-pedestrian-bias.md in project memory. That script is gone; don't recreate it. If
# unnamed trails ever need hiding for visual clarity, do it at render time in js/renderer.js,
# keyed on `pathType`/`name`, not by deleting them from the data routing depends on.)
def build_geojson(elements):
    features = []
    seen = set()
    for element in elements:
        if element.get("type") != "way":
            continue

        tags = element.get("tags") or {}
        geometry = element.get("geometry") if isinstance(element.get("geometry"), list) else None
        if not geometry or len(geometry) < 2:
            continue

        coords = []
        for c in geometry:
            lon = c.get("lon")
            lat = c.get("lat")
            if isinstance(lon, (int, float)) and isinstance(lat, (int, float)):
                coords.append([lon, lat])

        if len(coords) < 2:
            continue

        key = f"way/{element.get('id')}"
        if key in seen:
            continue
        seen.add(key)

        highway = tags.get("highway")
        designation = str(tags.get("designation") or "").lower()
        horse = tags.get("horse")
        foot = tags.get("foot")
        access = tags.get("access")
        if (
            highway == "bridleway"
            or "bridleway" in designation
            or horse == "designated"
        ):
            path_type = "bridleway"
        elif "byway" in designation or highway == "byway":
            path_type = "byway"
        elif access == "permissive" or foot == "permissive" or horse == "permissive":
            path_type = "permissive"
        elif tags.get("osmc:symbol") or tags.get("trail_visibility"):
            path_type = "waymarked_trail"
        elif highway == "cycleway":
            path_type = "cycleway"
        elif highway == "footway":
            path_type = "footway"
        elif highway == "track":
            path_type = "track"
        else:
            path_type = "trail"

        features.append({
            "type": "Feature",
            "id": key,
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "id": key,
                "osmType": "way",
                "osmId": element.get("id"),
                "name": tags.get("name"),
                "ref": tags.get("ref"),
                "highway": highway,
                "designation": tags.get("designation"),
                "foot": tags.get("foot"),
                "horse": tags.get("horse"),
                "bicycle": tags.get("bicycle"),
                "surface": tags.get("surface"),
                "osmcSymbol": tags.get("osmc:symbol"),
                "trailVisibility": tags.get("trail_visibility"),
                "pathType": path_type,
            },
        })

    return {
        "type": "FeatureCollection",
        "name": "Epping Forest paths and bridleways",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "name": "OpenStreetMap via Overpass API",
            "license": "Open Data Commons Open Database License (ODbL)",
            "queryFile": "data/local-paths.overpassql",
            "bbox": [-0.035, 51.545, 0.145, 51.745],
        },
        "features": features,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-cache", action="store_true",
        help=(
            "Skip the Overpass fetch and rebuild local-paths.geojson from the already-downloaded "
            "local-paths.overpass.json instead. Useful when Overpass isn't reachable but you just "
            "need to re-run this script's own conversion logic (e.g. after a bug fix here) against "
            "data that was already fetched -- note this will NOT pick up any query/bbox change "
            "since the cached response reflects whatever query was live when it was fetched."
        ),
    )
    args = parser.parse_args()

    if args.from_cache:
        if not OVERPASS_JSON_PATH.exists():
            raise SystemExit(f"{OVERPASS_JSON_PATH} does not exist -- run without --from-cache first.")
        raw = OVERPASS_JSON_PATH.read_text(encoding="utf-8")
    else:
        query_text = QUERY_PATH.read_text(encoding="utf-8")
        raw = fetch_overpass(query_text)
        OVERPASS_JSON_PATH.write_text(raw, encoding="utf-8")

    parsed = json.loads(raw)
    geojson = build_geojson(parsed.get("elements", []))
    GEOJSON_PATH.write_text(json.dumps(geojson, indent=2) + "\n", encoding="utf-8")

    counts = {}
    for feature in geojson["features"]:
        key = feature["properties"].get("pathType") or "trail"
        counts[key] = counts.get(key, 0) + 1
    unnamed = sum(1 for f in geojson["features"] if not f["properties"].get("name"))

    print(f"Wrote {len(geojson['features'])} path features ({unnamed} unnamed)")
    for key in sorted(counts, key=lambda k: counts[k], reverse=True):
        print(f"{key}: {counts[key]}")


if __name__ == "__main__":
    main()
