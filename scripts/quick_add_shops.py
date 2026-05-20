#!/usr/bin/env python3
import json
from pathlib import Path

# Quick processing of existing overpass data
overpass_file = Path('data/local-landmarks.overpass.json')
geojson_file = Path('data/local-landmarks.geojson')

# Read existing geojson to preserve filtering
existing_geojson = json.loads(geojson_file.read_text())
overpass_data = json.loads(overpass_file.read_text())

# Create a map of elements by ID
elements_map = {}
for e in overpass_data.get('elements', []):
    eid = f"{e.get('type')}/{e.get('id')}"
    elements_map[eid] = e

# Update properties to include shop field and fix category
updated_features = []
for f in existing_geojson.get('features', []):
    fid = f.get('id')
    if fid in elements_map:
        element = elements_map[fid]
        tags = element.get('tags', {})
        shop_tag = tags.get('shop')
        
        # Add shop property if it doesn't exist
        if 'shop' not in f['properties']:
            f['properties']['shop'] = shop_tag
        
        # Fix category if shop tag exists - prioritize shop over amenity
        if shop_tag:
            f['properties']['category'] = shop_tag
            # Update category label
            labels = {
                'convenience': 'Convenience Store',
                'supermarket': 'Supermarket',
                'grocery': 'Grocery Store',
                'general': 'General Store',
                'greengrocer': 'Greengrocer',
                'butcher': 'Butcher',
                'bakery': 'Bakery',
                'deli': 'Deli',
                'farm': 'Farm Shop',
            }
            f['properties']['categoryLabel'] = labels.get(shop_tag, shop_tag.replace('_', ' ').title())
    updated_features.append(f)

existing_geojson['features'] = updated_features
import datetime
existing_geojson['generatedAt'] = datetime.datetime.utcnow().isoformat() + 'Z'

geojson_file.write_text(json.dumps(existing_geojson, indent=2) + '\n')
print(f"Updated {len(updated_features)} features with shop data")

# Count shops
shop_count = sum(1 for f in updated_features if f['properties'].get('shop'))
print(f"Features with shop property: {shop_count}")
