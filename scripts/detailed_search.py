#!/usr/bin/env python3
import json
import math

overpass = json.load(open('data/local-landmarks.overpass.json'))
geojson = json.load(open('data/local-landmarks.geojson'))

# Get all shops with "sainsbury" in the Loughton area
print("All Sainsbury's in Loughton/Church Hill area (51.64-51.66, 0.06-0.08):")
print("="*80)

for e in overpass.get('elements', []):
    tags = e.get('tags', {})
    name = tags.get('name', '')
    if 'sainsbury' not in name.lower():
        continue
        
    lon = e.get('lon') or e.get('center', {}).get('lon')
    lat = e.get('lat') or e.get('center', {}).get('lat')
    
    if not lon or not lat:
        continue
        
    # Check if in L oughton area
    if 51.64 < lat < 51.66 and 0.06 < lon < 0.08:
        shop = tags.get('shop', 'N/A')
        amenity = tags.get('amenity', 'N/A')
        addr = tags.get('addr:street', '')
        
        # Check if in final data
        eid = f"{e.get('type')}/{e.get('id')}"
        in_final = any(f['id'] == eid for f in geojson['features'])
        
        print(f"  Name: {name}")
        print(f"    Location: ({lon:.6f}, {lat:.6f})")
        print(f"    Street: {addr}")
        print(f"    Tags: shop={shop}, amenity={amenity}")
        print(f"    In final data: {'YES' if in_final else 'NO'}")
        print()

# Check for "newbox"  
print("\n" + "="*80)
print("Searching for 'Newbox' anywhere in OSM data:")
print("="*80)

found_newbox = False
for e in overpass.get('elements', []):
    tags = e.get('tags', {})
    name = tags.get('name', '').lower()
    
    if 'newbox' in name or 'new box' in name:
        found_newbox = True
        lon = e.get('lon') or e.get('center', {}).get('lon')
        lat = e.get('lat') or e.get('center', {}).get('lat')
        print(f"  Found: {tags.get('name')}")
        print(f"  Location: ({lon}, {lat})")
        print(f"  Tags: {tags}")
        print()

if not found_newbox:
    print("  No 'Newbox' found in the current OSM data.")
    print("  This shop may not be in OpenStreetMap yet.")
