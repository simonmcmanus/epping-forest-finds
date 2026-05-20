#!/usr/bin/env python3
import json

data = json.load(open('data/local-landmarks.overpass.json'))

# Search for Sainsbury's
print("Searching for Sainsbury's...")
sainsburys = [e for e in data.get('elements', []) if 'sainsbury' in str(e.get('tags', {}).get('name', '')).lower()]
print(f'Found {len(sainsburys)} Sainsbury\'s locations in Overpass data:')
for s in sainsburys[:10]:
    tags = s.get('tags', {})
    lon = s.get('lon') or s.get('center', {}).get('lon')
    lat = s.get('lat') or s.get('center', {}).get('lat')
    shop = tags.get('shop', 'N/A')
    amenity = tags.get('amenity', 'N/A')
    print(f'  {tags.get("name", "Unnamed"):50} shop={shop:20} amenity={amenity:15} at ({lon}, {lat})')

print()

# Search for Newbox
print("Searching for Newbox...")
newbox = [e for e in data.get('elements', []) if 'newbox' in str(e.get('tags', {}).get('name', '')).lower()]
print(f'Found {len(newbox)} Newbox locations:')
for n in newbox:
    tags = n.get('tags', {})
    lon = n.get('lon') or n.get('center', {}).get('lon')
    lat = n.get('lat') or n.get('center', {}).get('lat')
    shop = tags.get('shop', 'N/A')
    amenity = tags.get('amenity', 'N/A')
    print(f'  {tags.get("name", "Unnamed"):50} shop={shop:20} amenity={amenity:15} at ({lon}, {lat})')
