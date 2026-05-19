import json
import math
from pathlib import Path

ROOT = Path.cwd()
landmarks_path = ROOT / "data" / "local-landmarks.geojson"
boundary_path = ROOT / "data" / "epping-forest-land.geojson"

WALKING_SPEED_M_PER_MIN = 3500 / 60
MAX_MINUTES = 8
THRESHOLD_M = WALKING_SPEED_M_PER_MIN * MAX_MINUTES

landmarks = json.loads(landmarks_path.read_text(encoding="utf-8"))
boundary = json.loads(boundary_path.read_text(encoding="utf-8"))


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


segments = []
for feature in boundary.get("features", []):
    for ring in polygon_rings((feature or {}).get("geometry") or {}):
        if not isinstance(ring, list) or len(ring) < 2:
            continue
        for i in range(1, len(ring)):
            a = ring[i - 1]
            b = ring[i]
            if len(a) >= 2 and len(b) >= 2:
                segments.append((float(a[0]), float(a[1]), float(b[0]), float(b[1])))
        first = ring[0]
        last = ring[-1]
        if first != last and len(first) >= 2 and len(last) >= 2:
            segments.append((float(last[0]), float(last[1]), float(first[0]), float(first[1])))

if not segments:
    raise RuntimeError("No boundary segments found")

ref_lat = sum([segment[1] + segment[3] for segment in segments]) / (2 * len(segments))
ref_lat_rad = math.radians(ref_lat)


def to_xy(lon, lat):
    return lon * 111320.0 * math.cos(ref_lat_rad), lat * 110574.0


projected_segments = []
for lon1, lat1, lon2, lat2 in segments:
    ax, ay = to_xy(lon1, lat1)
    bx, by = to_xy(lon2, lat2)
    projected_segments.append((ax, ay, bx, by))

CELL_SIZE_M = 250.0
segment_grid = {}

for index, (ax, ay, bx, by) in enumerate(projected_segments):
    min_x = min(ax, bx)
    max_x = max(ax, bx)
    min_y = min(ay, by)
    max_y = max(ay, by)
    gx1 = int(math.floor(min_x / CELL_SIZE_M))
    gx2 = int(math.floor(max_x / CELL_SIZE_M))
    gy1 = int(math.floor(min_y / CELL_SIZE_M))
    gy2 = int(math.floor(max_y / CELL_SIZE_M))
    for gx in range(gx1, gx2 + 1):
        for gy in range(gy1, gy2 + 1):
            segment_grid.setdefault((gx, gy), []).append(index)


def point_to_segment_distance(px, py, ax, ay, bx, by):
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


def nearest_distance_m(lon, lat):
    px, py = to_xy(float(lon), float(lat))
    gx = int(math.floor(px / CELL_SIZE_M))
    gy = int(math.floor(py / CELL_SIZE_M))
    radius_cells = int(math.ceil(THRESHOLD_M / CELL_SIZE_M)) + 1

    candidate_indices = set()
    for dx in range(-radius_cells, radius_cells + 1):
        for dy in range(-radius_cells, radius_cells + 1):
            candidate_indices.update(segment_grid.get((gx + dx, gy + dy), []))

    best = float("inf")
    for index in candidate_indices:
        ax, ay, bx, by = projected_segments[index]
        d = point_to_segment_distance(px, py, ax, ay, bx, by)
        if d < best:
            best = d
            if best <= THRESHOLD_M:
                return best
    return best


original_features = landmarks.get("features", [])
filtered_features = []
for feature in original_features:
    geometry = (feature or {}).get("geometry") or {}
    coords = geometry.get("coordinates") if isinstance(geometry.get("coordinates"), list) else None
    if not coords or len(coords) < 2:
        continue
    lon, lat = coords[0], coords[1]
    if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
        continue
    distance_m = nearest_distance_m(lon, lat)
    if distance_m > THRESHOLD_M:
        continue

    properties = dict(feature.get("properties") or {})
    properties["distanceToForestBoundaryMetres"] = round(distance_m, 1)
    feature["properties"] = properties
    filtered_features.append(feature)

landmarks["features"] = filtered_features
source = landmarks.get("source") if isinstance(landmarks.get("source"), dict) else {}
source["distanceFilter"] = {
    "maxMinutesFromForestBoundary": MAX_MINUTES,
    "walkingSpeedMPerMin": WALKING_SPEED_M_PER_MIN,
    "maxDistanceMetres": round(THRESHOLD_M, 1),
    "boundaryFile": "data/epping-forest-land.geojson",
}
landmarks["source"] = source

landmarks_path.write_text(json.dumps(landmarks, indent=2) + "\n", encoding="utf-8")

print("original", len(original_features))
print("kept", len(filtered_features))
print("removed", len(original_features) - len(filtered_features))
