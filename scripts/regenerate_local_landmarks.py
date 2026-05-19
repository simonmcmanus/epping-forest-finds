import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
import math

ROOT = Path.cwd()
DATA = ROOT / "data"
QUERY_PATH = DATA / "local-landmarks.overpassql"
OVERPASS_JSON_PATH = DATA / "local-landmarks.overpass.json"
GEOJSON_PATH = DATA / "local-landmarks.geojson"
FOREST_BOUNDARY_PATH = DATA / "epping-forest-land.geojson"
WALKING_SPEED_M_PER_MIN = 3500 / 60  # 3.5 km/h
MAX_WALK_MINUTES_FROM_BOUNDARY = 25
MAX_DISTANCE_FROM_BOUNDARY_METRES = WALKING_SPEED_M_PER_MIN * MAX_WALK_MINUTES_FROM_BOUNDARY
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
    "parking": "Car Park",
    "toilets": "Toilets",
    "bicycle_parking": "Cycle Parking",
    "bench": "Bench",
    "drinking_water": "Drinking Water",
    "bus_station": "Bus Station",
    "bus_stop": "Bus Stop",
    "taxi": "Taxi",
    "train_station": "Train Station",
    "station": "Train Station",
    "halt": "Rail Halt",
    "tram_stop": "Tram Stop",
    "gate": "Gate",
    "stile": "Stile",
    "kissing_gate": "Kissing Gate",
    "cattle_grid": "Cattle Grid",
    "lift_gate": "Lift Gate",
    "swing_gate": "Swing Gate",
    "cycle_barrier": "Cycle Barrier",
    "entrance": "Entrance",
    "attraction": "Attraction",
    "viewpoint": "Viewpoint",
    "museum": "Museum",
    "picnic_site": "Picnic Site",
    "information": "Information",
    "camp_site": "Camp Site",
    "caravan_site": "Caravan Site",
    "historic": "Historic Site",
    "monument": "Monument",
    "archaeological_site": "Archaeological Site",
    "memorial": "Memorial",
    "ruins": "Ruins",
    "castle": "Castle",
}

def category_label(key: str) -> str:
    if key in LABELS:
        return LABELS[key]
    return (key or "place").replace("_", " ").title()


def polygon_rings(geometry):
    if not geometry:
        return []
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if not isinstance(coords, list):
        return []
    if geom_type == "Polygon":
        return coords
    if geom_type == "MultiPolygon":
        rings = []
        for polygon in coords:
            if isinstance(polygon, list):
                rings.extend(polygon)
        return rings
    return []


def load_boundary_segments(path):
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    features = data.get("features") if isinstance(data, dict) else []
    if not isinstance(features, list):
        return []
    segments = []
    for feature in features:
        geometry = (feature or {}).get("geometry") or {}
        for ring in polygon_rings(geometry):
            if not isinstance(ring, list) or len(ring) < 2:
                continue
            for i in range(1, len(ring)):
                a = ring[i - 1]
                b = ring[i]
                if isinstance(a, list) and isinstance(b, list) and len(a) >= 2 and len(b) >= 2:
                    segments.append((float(a[0]), float(a[1]), float(b[0]), float(b[1])))
            first = ring[0]
            last = ring[-1]
            if first != last and len(first) >= 2 and len(last) >= 2:
                segments.append((float(last[0]), float(last[1]), float(first[0]), float(first[1])))
    return segments


def to_local_xy(lon, lat, ref_lat_rad):
    x = lon * 111320.0 * math.cos(ref_lat_rad)
    y = lat * 110574.0
    return x, y


def point_to_segment_distance_m(px, py, ax, ay, bx, by):
    abx = bx - ax
    aby = by - ay
    length_sq = abx * abx + aby * aby
    if length_sq <= 1e-12:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * abx + (py - ay) * aby) / length_sq
    t = max(0.0, min(1.0, t))
    cx = ax + t * abx
    cy = ay + t * aby
    return math.hypot(px - cx, py - cy)


def nearest_boundary_distance_m(lon, lat, segments, ref_lat_rad):
    px, py = to_local_xy(lon, lat, ref_lat_rad)
    best = float("inf")
    for ax, ay, bx, by in segments:
        d = point_to_segment_distance_m(px, py, ax, ay, bx, by)
        if d < best:
            best = d
    return best


def project_segments(segments, ref_lat_rad):
    projected = []
    for lon1, lat1, lon2, lat2 in segments:
        ax, ay = to_local_xy(lon1, lat1, ref_lat_rad)
        bx, by = to_local_xy(lon2, lat2, ref_lat_rad)
        projected.append((ax, ay, bx, by))
    return projected


def within_boundary_distance(lon, lat, projected_segments, ref_lat_rad, threshold_m):
    px, py = to_local_xy(lon, lat, ref_lat_rad)
    best = float("inf")
    for ax, ay, bx, by in projected_segments:
        d = point_to_segment_distance_m(px, py, ax, ay, bx, by)
        if d < best:
            best = d
            if best <= threshold_m:
                return True, best
    return best <= threshold_m, best

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
boundary_segments = load_boundary_segments(FOREST_BOUNDARY_PATH)
if not boundary_segments:
    raise RuntimeError(f"No usable boundary segments in {FOREST_BOUNDARY_PATH}")

lat_values = [seg[1] for seg in boundary_segments] + [seg[3] for seg in boundary_segments]
ref_lat_rad = math.radians(sum(lat_values) / max(1, len(lat_values)))
projected_boundary_segments = project_segments(boundary_segments, ref_lat_rad)

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
        or tags.get("barrier")
        or ("entrance" if tags.get("entrance") else None)
        or tags.get("highway")
        or tags.get("railway")
        or tags.get("tourism")
        or tags.get("historic")
        or ("historic" if tags.get("heritage") else None)
        or "place"
    )
    address = ", ".join(
        part for part in [
            " ".join(p for p in [tags.get("addr:housenumber"), tags.get("addr:street")] if p),
            " ".join(p for p in [tags.get("addr:city"), tags.get("addr:postcode")] if p),
        ]
        if part
    ) or None

    is_within_limit, boundary_distance_m = within_boundary_distance(
        lon,
        lat,
        projected_boundary_segments,
        ref_lat_rad,
        MAX_DISTANCE_FROM_BOUNDARY_METRES,
    )
    if not is_within_limit:
        continue

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
            "barrier": tags.get("barrier"),
            "entrance": tags.get("entrance"),
            "heritage": tags.get("heritage"),
            "website": tags.get("website") or tags.get("contact:website"),
            "phone": tags.get("phone") or tags.get("contact:phone"),
            "address": address,
            "distanceToForestBoundaryMetres": round(boundary_distance_m, 1),
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
        "distanceFilter": {
            "maxMinutesFromForestBoundary": MAX_WALK_MINUTES_FROM_BOUNDARY,
            "walkingSpeedMPerMin": WALKING_SPEED_M_PER_MIN,
            "maxDistanceMetres": round(MAX_DISTANCE_FROM_BOUNDARY_METRES, 1),
            "boundaryFile": "data/epping-forest-land.geojson",
        },
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
