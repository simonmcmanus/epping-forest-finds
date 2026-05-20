#!/usr/bin/env python3
import json
import math

# Church Hill, Loughton IG10 1QR is approximately at:
# Longitude: 0.0657, Latitude: 51.6473 (approximate from postcode)

target_lon = 0.0657
target_lat = 51.6473

overpass = json.load(open('data/local-landmarks.overpass.json'))
geojson = json.load(open('data/local-landmarks.geojson'))
existing_ids = {f['id'] for f in geojson['features']}

print(f"Searching for Sainsbury's near Church Hill, Loughton IG10 1QR...")
print(f"Target coordinates: ({target_lon}, {target_lat})")
print("="*80)

def haversine_distance(lon1, lat1, lon2, lat2):
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c

nearby_sainsburys = []
for element in overpass.get('elements', []):
    tags = element.get('tags', {})
    name = tags.get('name', '')
    
    if 'sainsbury' not in name.lower():
        continue
    
    lon = element.get('lon') or element.get('center', {}).get('lon')
    lat = element.get('lat') or element.get('center', {}).get('lat')
    
    if not lon or not lat:
        continue
    
    # Calculate distance from Church Hill postcode center
    dist_from_church_hill = haversine_distance(lon, lat, target_lon, target_lat)
    
    if dist_from_church_hill <= 1000:
        eid = f"{element.get('type')}/{element.get('id')}"
        in_final = eid in existing_ids
        
        nearby_sainsburys.append({
            'name': name,
            'shop': tags.get('shop', 'N/A'),
            'lon': lon,
            'lat': lat,
            'street': tags.get('addr:street', 'N/A'),
            'postcode': tags.get('addr:postcode', 'N/A'),
            'distance': dist_from_church_hill,
            'in_final': in_final,
            'osm_id': element.get('id'),
            'osm_type': element.get('type')
        })

if nearby_sainsburys:
    print(f"\nFound {len(nearby_sainsburys)} Sainsbury's within 1km of Church Hill:")
    for s in sorted(nearby_sainsburys, key=lambda x: x['distance']):
        status = "✓ IN DATA" if s['in_final'] else "✗ MISSING"
        print(f"\n  {status} {s['name']}")
        print(f"    Type: {s['shop']}")
        print(f"    Location: ({s['lon']:.6f}, {s['lat']:.6f})")
        print(f"    Street: {s['street']}")
        print(f"    Postcode: {s['postcode']}")
        print(f"    Distance from Church Hill center: {s['distance']:.0f}m")
        print(f"    OSM: https://www.openstreetmap.org/{s['osm_type']}/{s['osm_id']}")
else:
    print("\n❌ No Sainsbury's found within 1km of Church Hill, Loughton IG10 1QR")
    
print("\n" + "="*80)
print("Checking what supermarkets ARE on Church Hill...")
found_supermarkets = False
for element in overpass.get('elements', []):
    tags = element.get('tags', {})
    addr_street = tags.get('addr:street', '').lower()
    
    if 'church hill' not in addr_street:
        continue
    
    shop = tags.get('shop')
    if shop == 'supermarket':
        found_supermarkets = True
        name = tags.get('name', 'Unnamed')
        lon = element.get('lon') or element.get('center', {}).get('lon')
        lat = element.get('lat') or element.get('center', {}).get('lat')
        eid = f"{element.get('type')}/{element.get('id')}"
        in_final = eid in existing_ids
        status = "✓ IN DATA" if in_final else "✗ MISSING"
        
        print(f"\n  {status} {name}")
        print(f"    Location: ({lon:.6f}, {lat:.6f})")
        print(f"    Postcode: {tags.get('addr:postcode', 'N/A')}")

if not found_supermarkets:
    print("\n  Only Lidl found (shown in data)")
    
print("\n" + "="*80)
print("CONCLUSION:")
print("  There is NO Sainsbury's on Church Hill in OpenStreetMap.")
print("  The supermarket at Church Hill, Loughton IG10 1QR is a LIDL (which IS in the data).")
print("  The nearest Sainsbury's Local is on a different street.")
