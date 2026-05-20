#!/usr/bin/env python3
import json

# Check final geojson
geojson = json.load(open('data/local-landmarks.geojson'))
sainsburys = [f for f in geojson['features'] if 'sainsbury' in str(f['properties'].get('name', '')).lower()]

print(f"Found {len(sainsburys)} Sainsbury's in final landmarks data:")
for s in sainsburys:
    props = s['properties']
    coords = s['geometry']['coordinates']
    dist = props.get('distanceToForestBoundaryMetres', 'N/A')
    print(f"  {props.get('name', 'Unnamed'):45} category={props.get('category', 'N/A'):15} dist={dist}m  at {coords}")

# Also check overpass for Church Hill, Loughton specifically
print("\n\nSearching for Church Hill area shops (Loughton)...")
overpass = json.load(open('data/local-landmarks.overpass.json'))

# Loughton is around 51.647, 0.073
loughton_shops = []
for e in overpass.get('elements', []):
    lon = e.get('lon') or e.get('center', {}).get('lon')
    lat = e.get('lat') or e.get('center', {}).get('lat')
    if not lon or not lat:
        continue
    # Check if near Loughton (approximate area)
    if 51.64 < lat < 51.66 and 0.06 < lon < 0.08:
        tags = e.get('tags', {})
        shop = tags.get('shop')
        if shop and shop in ['supermarket', 'convenience']:
            loughton_shops.append((tags.get('name'), shop, lon, lat))

print(f"Found {len(loughton_shops)} supermarkets/convenience in Loughton area:")
for name, shop, lon, lat in sorted(loughton_shops)[:15]:
    print(f"  {name:45} {shop:15} at ({lon:.6f}, {lat:.6f})")
    
# Check what the walk distance limit is
print(f"\n\nCurrent filter: 5 minutes walk = {3500/60 * 5:.0f}m from forest boundary")
