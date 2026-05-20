#!/usr/bin/env python3
import json
import math
from pathlib import Path

overpass_file = Path('data/local-landmarks.overpass.json')
geojson_file = Path('data/local-landmarks.geojson')
forest_boundary_file = Path('data/epping-forest-land.geojson')

def to_local_xy(lon, lat, ref_lat_rad):
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    R = 6371000
    x = R * lon_rad * math.cos(ref_lat_rad)
    y = R * lat_rad
    return x, y

def point_to_segment_distance_m(px, py, ax, ay, bx, by):
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    nearest_x = ax + t * dx
    nearest_y = ay + t * dy
    return math.sqrt((px - nearest_x) ** 2 + (py - nearest_y) ** 2)

def polygon_rings(geometry):
    if not geometry:
        return []
    geom_type = geometry.get('type')
    coords = geometry.get('coordinates', [])
    if geom_type == 'Polygon':
        return coords
    elif geom_type == 'MultiPolygon':
        rings = []
        for polygon in coords:
            rings.extend(polygon)
        return rings
    return []

# Load boundary
forest_data = json.loads(forest_boundary_file.read_text())
boundary_segments = []
for feature in forest_data.get('features', []):
    for ring in polygon_rings(feature.get('geometry')):
        for i in range(len(ring) - 1):
            boundary_segments.append([ring[i][0], ring[i][1], ring[i+1][0], ring[i+1][1]])

lat_values = [seg[1] for seg in boundary_segments] + [seg[3] for seg in boundary_segments]
ref_lat_rad = math.radians(sum(lat_values) / len(lat_values))

# Project boundary segments
projected_segments = []
for lon1, lat1, lon2, lat2 in boundary_segments:
    x1, y1 = to_local_xy(lon1, lat1, ref_lat_rad)
    x2, y2 = to_local_xy(lon2, lat2, ref_lat_rad)
    projected_segments.append([x1, y1, x2, y2])

# Load data
overpass_data = json.loads(overpass_file.read_text())
existing_geojson = json.loads(geojson_file.read_text())
existing_ids = {f['id'] for f in existing_geojson['features']}

# Check all supermarkets
print("Checking all supermarkets in OSM data for distance from forest:")
print("="*80)

missing_supermarkets = []
for element in overpass_data.get('elements', []):
    tags = element.get('tags', {})
    if tags.get('shop') != 'supermarket':
        continue
    
    name = tags.get('name', 'Unnamed')    
    lon = element.get('lon') or element.get('center', {}).get('lon')
    lat = element.get('lat') or element.get('center', {}).get('lat')
    
    if not lon or not lat:
        continue
    
    # Calculate distance
    px, py = to_local_xy(lon, lat, ref_lat_rad)
    min_dist = float('inf')
    for ax, ay, bx, by in projected_segments:
        d = point_to_segment_distance_m(px, py, ax, ay, bx, by)
        min_dist = min(min_dist, d)
        if min_dist <= 300:  # Quick exit if close enough
            break
    
    eid = f"{element.get('type')}/{element.get('id')}"
    in_final = eid in existing_ids
    
    if min_dist <= 500:  # Show all within 500m
        status = "✓ IN DATA" if in_final else "✗ MISSING"
        print(f"{status:12} {name:45} {min_dist:6.0f}m from forest")
        
        if not in_final and min_dist <= 400:
            missing_supermarkets.append((name, lon, lat, min_dist, eid, element))

print(f"\n\nMissing supermarkets within 400m: {len(missing_supermarkets)}")
for name, lon, lat, dist, eid, element in missing_supermarkets:
    print(f"  {name:45} {dist:6.0f}m")
