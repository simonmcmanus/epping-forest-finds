#!/usr/bin/env python3
import json
from pathlib import Path
import math

# Fast script to add shops that passed initial bbox but need distance check
overpass_file = Path('data/local-landmarks.overpass.json')
geojson_file = Path('data/local-landmarks.geojson')
forest_boundary_file = Path('data/epping-forest-land.geojson')

WALKING_SPEED_M_PER_MIN = 3500 / 60
MAX_WALK_MINUTES = 8
MAX_DISTANCE_METRES = WALKING_SPEED_M_PER_MIN * MAX_WALK_MINUTES

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
print("Loading boundary...")
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

print(f"Boundary segments: {len(projected_segments)}")

# Load existing data
print("Loading existing landmarks...")
existing_geojson = json.loads(geojson_file.read_text())
existing_ids = {f['id'] for f in existing_geojson['features']}

# Load overpass data
print("Loading Overpass data...")
overpass_data = json.loads(overpass_file.read_text())

# Labels for categories
LABELS = {
    'convenience': 'Convenience Store',
    'supermarket': 'Supermarket',
    'grocery': 'Grocery Store',
    'general': 'General Store',
    'greengrocer': 'Greengrocer',
    'butcher': 'Butcher',
    'bakery': 'Bakery',
    'deli': 'Deli',
    'farm': 'Farm Shop',
    'pastry': 'Pastry Shop',
    'confectionery': 'Confectionery',
    'kiosk': 'Kiosk',
}

# Process shops that aren't already in the dataset
new_features = []
# Expand to include all supermarkets in the area
shop_types = ['convenience', 'supermarket', 'grocery', 'general', 'greengrocer', 
              'butcher', 'bakery', 'deli', 'farm', 'pastry', 'confectionery', 'kiosk']
# Also check for any shop we might have missed
process_all_shops = True

print("Processing shop elements...")
for element in overpass_data.get('elements', []):
    eid = f"{element.get('type')}/{element.get('id')}"
    if eid in existing_ids:
        continue
    
    tags = element.get('tags', {})
    shop_tag = tags.get('shop')
    
    # Only process shops of types we care about (or all supermarkets)
    if not shop_tag:
        continue
    if shop_tag not in shop_types and shop_tag != 'supermarket':
        continue
    
    # Get coordinates
    lon = element.get('lon')
    lat = element.get('lat')
    if lon is None or lat is None:
        center = element.get('center', {})
        lon = center.get('lon')
        lat = center.get('lat')
    
    if lon is None or lat is None:
        continue
    
    # Check distance to boundary
    px, py = to_local_xy(lon, lat, ref_lat_rad)
    min_dist = float('inf')
    for ax, ay, bx, by in projected_segments:
        d = point_to_segment_distance_m(px, py, ax, ay, bx, by)
        min_dist = min(min_dist, d)
        if min_dist <= MAX_DISTANCE_METRES:
            break
    
    if min_dist > MAX_DISTANCE_METRES:
        continue
    
    # Build address
    address_parts = []
    if tags.get('addr:housenumber') or tags.get('addr:street'):
        addr_line1 = ' '.join(filter(None, [tags.get('addr:housenumber'), tags.get('addr:street')]))
        if addr_line1:
            address_parts.append(addr_line1)
    if tags.get('addr:city') or tags.get('addr:postcode'):
        addr_line2 = ' '.join(filter(None, [tags.get('addr:city'), tags.get('addr:postcode')]))
        if addr_line2:
            address_parts.append(addr_line2)
    address = ', '.join(address_parts) if address_parts else None
    
    # Create feature
    feature = {
        'type': 'Feature',
        'id': eid,
        'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
        'properties': {
            'id': eid,
            'osmType': element.get('type'),
            'osmId': element.get('id'),
            'name': tags.get('name'),
            'category': shop_tag,
            'categoryLabel': LABELS.get(shop_tag, shop_tag.replace('_', ' ').title()),
            'amenity': tags.get('amenity'),
            'shop': shop_tag,
            'highway': tags.get('highway'),
            'tourism': tags.get('tourism'),
            'historic': tags.get('historic'),
            'railway': tags.get('railway'),
            'barrier': tags.get('barrier'),
            'entrance': tags.get('entrance'),
            'heritage': tags.get('heritage'),
            'website': tags.get('website') or tags.get('contact:website'),
            'phone': tags.get('phone') or tags.get('contact:phone'),
            'address': address,
            'distanceToForestBoundaryMetres': round(min_dist, 1),
        }
    }
    new_features.append(feature)

print(f"Found {len(new_features)} new shops within {MAX_WALK_MINUTES}min walk")

# Add to existing features
existing_geojson['features'].extend(new_features)
import datetime
existing_geojson['generatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')

# Write back
geojson_file.write_text(json.dumps(existing_geojson, indent=2) + '\n')

print(f"Total features: {len(existing_geojson['features'])}")
print(f"\nNew shops added:")
for f in new_features[:20]:
    props = f['properties']
    print(f"  {props.get('name', 'Unnamed'):40} - {props['category']:15} ({props['distanceToForestBoundaryMetres']:.0f}m from boundary)")
if len(new_features) > 20:
    print(f"  ... and {len(new_features) - 20} more")
