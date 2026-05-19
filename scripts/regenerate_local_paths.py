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

query_text = QUERY_PATH.read_text(encoding="utf-8")
raw = None
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
            raw = response.read().decode("utf-8")
            print(f"Fetched from {endpoint} via POST")
            break
    except urllib.error.HTTPError as error:
        last_error = error
        try:
            encoded = urllib.parse.urlencode({"data": query_text})
            with urllib.request.urlopen(f"{endpoint}?{encoded}", timeout=120) as response:
                raw = response.read().decode("utf-8")
                print(f"Fetched from {endpoint} via GET")
                break
        except Exception as inner_error:
            last_error = inner_error
            continue
    except Exception as error:
        last_error = error
        continue

if raw is None:
    raise RuntimeError(f"Failed to fetch Overpass data: {last_error}")

OVERPASS_JSON_PATH.write_text(raw, encoding="utf-8")
parsed = json.loads(raw)

features = []
seen = set()
for element in parsed.get("elements", []):
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

geojson = {
    "type": "FeatureCollection",
    "name": "Epping Forest paths and bridleways",
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "source": {
        "name": "OpenStreetMap via Overpass API",
        "license": "Open Data Commons Open Database License (ODbL)",
        "queryFile": "data/local-paths.overpassql",
        "bbox": [-0.035, 51.595, 0.145, 51.745],
    },
    "features": features,
}

GEOJSON_PATH.write_text(json.dumps(geojson, indent=2) + "\n", encoding="utf-8")

counts = {}
for feature in features:
    key = feature["properties"].get("pathType") or "trail"
    counts[key] = counts.get(key, 0) + 1

print(f"Wrote {len(features)} path features")
for key in sorted(counts, key=lambda k: counts[k], reverse=True):
    print(f"{key}: {counts[key]}")
