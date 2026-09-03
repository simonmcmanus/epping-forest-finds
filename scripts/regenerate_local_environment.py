import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
DATA = ROOT / "data"
QUERY_PATH = DATA / "local-environment.overpassql"
OVERPASS_JSON_PATH = DATA / "local-environment.overpass.json"
GEOJSON_PATH = DATA / "local-environment.geojson"
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]


def is_area_way(coords):
    return len(coords) >= 4 and coords[0] == coords[-1]


def classify_feature(tags):
    designation = str(tags.get("designation") or "").lower()
    if tags.get("waterway"):
        return "hydrology_line"
    if tags.get("natural") in {"water", "wetland"} or tags.get("water") or tags.get("landuse") == "reservoir":
        return "hydrology_area"
    if tags.get("leisure") == "nature_reserve" or tags.get("boundary") == "protected_area" or "sssi" in designation or "nature reserve" in designation or "ancient woodland" in designation:
        return "nature_designation"
    if tags.get("leisure") in {"garden", "park"}:
        return "garden"
    if tags.get("railway") in {"rail", "light_rail", "subway", "tram"}:
        return "railway"
    if tags.get("building"):
        return "building"
    return "environment"


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

    feature_type = classify_feature(tags)
    geometry_type = "Polygon" if is_area_way(coords) else "LineString"
    geometry_value = [coords] if geometry_type == "Polygon" else coords

    features.append({
        "type": "Feature",
        "id": key,
        "geometry": {
            "type": geometry_type,
            "coordinates": geometry_value,
        },
        "properties": {
            "id": key,
            "osmType": "way",
            "osmId": element.get("id"),
            "name": tags.get("name"),
            "featureType": feature_type,
            "designation": tags.get("designation"),
            "waterway": tags.get("waterway"),
            "natural": tags.get("natural"),
            "water": tags.get("water"),
            "landuse": tags.get("landuse"),
            "leisure": tags.get("leisure"),
            "boundary": tags.get("boundary"),
            "railway": tags.get("railway"),
            # Retained for building features so the 3D-buildings extrusion view (see
            # js/normalize.js: estimateBuildingHeightMetres) can use a real OSM height over
            # its footprint-area fallback whenever it's tagged. Harmless no-ops for every
            # other feature type, which just carry these through as null.
            "height": tags.get("height"),
            "building:levels": tags.get("building:levels"),
            "operator": tags.get("operator"),
            "service": tags.get("service"),
            "usage": tags.get("usage"),
            "gauge": tags.get("gauge"),
            "electrified": tags.get("electrified"),
            "voltage": tags.get("voltage"),
            "frequency": tags.get("frequency"),
        },
    })

geojson = {
    "type": "FeatureCollection",
    "name": "Epping Forest hydrology and nature designations",
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "source": {
        "name": "OpenStreetMap via Overpass API",
        "license": "Open Data Commons Open Database License (ODbL)",
        "queryFile": "data/local-environment.overpassql",
        "bbox": [-0.035, 51.595, 0.145, 51.745],
    },
    "features": features,
}

GEOJSON_PATH.write_text(json.dumps(geojson, indent=2) + "\n", encoding="utf-8")

counts = {}
for feature in features:
    key = feature["properties"].get("featureType") or "environment"
    counts[key] = counts.get(key, 0) + 1

print(f"Wrote {len(features)} environment features")
for key in sorted(counts, key=lambda k: counts[k], reverse=True):
    print(f"{key}: {counts[key]}")
