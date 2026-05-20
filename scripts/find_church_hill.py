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

overpass_data = json.loads(overpass_file.read_text())
geojson_data = json.loads(geojson_file.read_text())
existing_ids = {f['id'] for f in geojson_data['features']}

print("Searching for shops on Church Hill, Loughton...")
print("="*80)

church_hill_shops = []
for element in overpass_data.get('elements', []):
    tags = element.get('tags', {})
    addr_street = tags.get('addr:street', '').lower()
    
    # Check if on Church Hill
    if 'church hill' not in addr_street:
        continue
    
    name = tags.get('name', 'Unnamed')
    shop = tags.get('shop', 'N/A')
    amenity = tags.get('amenity', 'N/A')
    
    lon = element.get('lon') or element.get('center', {}).get('lon')
    lat = element.get('lat') or element.get('center', {}).get('lat')
    
    if not lon or not lat:
        continue
    
    # Calculate distance from forest
    px, py = to_local_xy(lon, lat, ref_lat_rad)
    min_dist = float('inf')
    for ax, ay, bx, by in projected_segments:
        d = point_to_segment_distance_m(px, py, ax, ay, bx, by)
        min_dist = min(min_dist, d)
        if min_dist <= 500:
            break
    
    eid = f"{element.get('type')}/{element.get('id')}"
    in_final = eid in existing_ids
    
    church_hill_shops.append({
        'name': name,
        'shop': shop,
        'amenity': amenity,
        'lon': lon,
        'lat': lat,
        'distance': min_dist,
        'in_final': in_final,
        'eid': eid
    })

if church_hill_shops:
    print(f"Found {len(church_hill_shops)} shops on Church Hill:")
    for shop in sorted(church_hill_shops, key=lambda x: x['distance']):
        status = "✓ IN DATA" if shop['in_final'] else "✗ MISSING"
        print(f"\n  {status}")
        print(f"    Name: {shop['name']}")
        print(f"    Type: shop={shop['shop']}, amenity={shop['amenity']}")
        print(f"    Location: ({shop['lon']:.6f}, {shop['lat']:.6f})")
        print(f"    Distance from forest: {shop['distance']:.1f}m")
        if shop['distance'] > 467:
            print(f"    ⚠️  BEYOND 8min WALK LIMIT (467m)")
else:
    print("No shops found with 'Church Hill' in addr:street tag")
    print("\nSearching for Sainsbury's near Loughton (51.645-51.650, 0.064-0.070)...")
    
    for element in overpass_data.get('elements', []):
        tags = element.get('tags', {})
        name = tags.get('name', '')
        
        if 'sainsbury' not in name.lower():
            continue
        
        lon = element.get('lon') or element.get('center', {}).get('lon')
        lat = element.get('lat') or element.get('center', {}).get('lat')
        
        if not lon or not lat:
            continue
        
        # Check if near Loughton Church Hill area
        if 51.645 < lat < 51.650 and 0.064 < lon < 0.070:
            px, py = to_local_xy(lon, lat, ref_lat_rad)
            min_dist = float('inf')
            for ax, ay, bx, by in projected_segments:
                d = point_to_segment_distance_m(px, py, ax, ay, bx, by)
                min_dist = min(min_dist, d)
                if min_dist <= 1000:
                    break
            
            eid = f"{element.get('type')}/{element.get('id')}"
            in_final = eid in existing_ids
            status = "✓ IN DATA" if in_final else "✗ MISSING"
            
            print(f"\n  {status} {name}")
            print(f"    Type: {tags.get('shop', 'N/A')}")
            print(f"    Location: ({lon:.6f}, {lat:.6f})")
            print(f"    Street: {tags.get('addr:street', 'N/A')}")
            print(f"    Distance from forest: {min_dist:.1f}m")
            if min_dist > 467:
                print(f"    ⚠️  BEYOND CURRENT WALK LIMIT (467m)")
