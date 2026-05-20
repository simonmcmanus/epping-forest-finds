#!/usr/bin/env python3
import json

data = json.load(open('data/local-landmarks.geojson'))

# Count features by category that should match shops filter
shop_types = ['convenience', 'supermarket', 'grocery', 'general', 'greengrocer', 'butcher', 'bakery', 'deli', 'farm', 'pastry', 'kiosk', 'confectionery']

print('Shop features in geojson:')
from collections import Counter
shops = [f for f in data['features'] if f['properties'].get('category') in shop_types or f['properties'].get('shop') in shop_types]
by_cat = Counter(f['properties'].get('category') for f in shops)
print(f'Total: {len(shops)}')
for cat, count in sorted(by_cat.items(), key=lambda x: -x[1]):
    print(f'  {cat}: {count}')

# Check the Lidl specifically
lidl = [f for f in data['features'] if f['properties'].get('name') == 'Lidl' and 51.655 < f['geometry']['coordinates'][1] < 51.656]
if lidl:
    print(f'\nLidl on Church Hill:')
    props = lidl[0]['properties']
    print(f'  category: {props.get("category")}')
    print(f'  shop: {props.get("shop")}')
    print(f'  amenity: {props.get("amenity")}')
    print(f'  Should match filter: category in shop_types = {props.get("category") in shop_types}')
