import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
DATA = ROOT / "data"
QUERY_PATH = DATA / "local-landmarks.overpassql"
OVERPASS_JSON_PATH = DATA / "local-landmarks.overpass.json"
GEOJSON_PATH = DATA / "local-landmarks.geojson"
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

LABELS = {
    "pub": "Pub",
    "bar": "Bar",
    "cafe": "Café",
    "tea": "Tea Hut",
    "restaurant": "Restaurant",
    "bus_station": "Bus Station",
    "bus_stop": "Bus Stop",
    "taxi": "Taxi",
    "train_station": "Train Station",
    "station": "Train Station",
    "halt": "Rail Halt",
    "tram_stop": "Tram Stop",
    "attraction": "Attraction",
    "viewpoint": "Viewpoint",
    "museum": "Museum",
    "picnic_site": "Picnic Site",
    "historic": "Historic Site",
}

def category_label(key: str) -> str:
    if key in LABELS:
        return LABELS[key]
    return (key or "place").replace("_", " ").title()

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
for element in parsed.get("elements", []):
    tags = element.get("tags", {})
    lon = element.get("lon")
    lat = element.get("lat")
    if lon is None or lat is None:
        center = element.get("center") or {}
        lon = center.get("lon")
        lat = center.get("lat")

    if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
        continue

    category = (
        tags.get("amenity")
        or tags.get("highway")
        or tags.get("railway")
        or tags.get("tourism")
        or ("historic" if tags.get("historic") else "place")
    )
    address = ", ".join(
        part for part in [
            " ".join(p for p in [tags.get("addr:housenumber"), tags.get("addr:street")] if p),
            " ".join(p for p in [tags.get("addr:city"), tags.get("addr:postcode")] if p),
        ]
        if part
    ) or None

    features.append({
        "type": "Feature",
        "id": f"{element.get('type')}/{element.get('id')}",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "id": f"{element.get('type')}/{element.get('id')}",
            "osmType": element.get("type"),
            "osmId": element.get("id"),
            "name": tags.get("name"),
            "category": category,
            "categoryLabel": category_label(category),
            "amenity": tags.get("amenity"),
            "highway": tags.get("highway"),
            "tourism": tags.get("tourism"),
            "historic": tags.get("historic"),
            "railway": tags.get("railway"),
            "website": tags.get("website") or tags.get("contact:website"),
            "phone": tags.get("phone") or tags.get("contact:phone"),
            "address": address,
        },
    })

geojson = {
    "type": "FeatureCollection",
    "name": "Local landmarks around Epping Forest",
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "source": {
        "name": "OpenStreetMap via Overpass API",
        "license": "Open Data Commons Open Database License (ODbL)",
        "queryFile": "data/local-landmarks.overpassql",
        "bbox": [-0.035, 51.595, 0.145, 51.745],
    },
    "features": features,
}

GEOJSON_PATH.write_text(json.dumps(geojson, indent=2) + "\n", encoding="utf-8")

counts = {}
for feature in features:
    key = feature["properties"].get("category") or "unknown"
    counts[key] = counts.get(key, 0) + 1

print(f"Wrote {len(features)} features")
for key in sorted(counts, key=lambda k: counts[k], reverse=True):
    print(f"{key}: {counts[key]}")
