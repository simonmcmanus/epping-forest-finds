#!/usr/bin/env python3
"""
Split local-landmarks.geojson into smaller category-based files
to avoid GitHub's large file warnings.
"""
import json
from pathlib import Path
from datetime import datetime, timezone

DATA_DIR = Path('data')
SOURCE_FILE = DATA_DIR / 'local-landmarks.geojson'

# Define category groupings
CATEGORY_GROUPS = {
    'food': {
        'filename': 'local-landmarks-food.geojson',
        'name': 'Food & Drink',
        'categories': ['pub', 'bar', 'cafe', 'tea', 'restaurant', 'convenience', 'supermarket', 
                      'grocery', 'general', 'greengrocer', 'butcher', 'bakery', 'deli', 
                      'farm', 'pastry', 'kiosk', 'confectionery']
    },
    'transport': {
        'filename': 'local-landmarks-transport.geojson',
        'name': 'Transport',
        'categories': ['bus_stop', 'bus_station', 'taxi', 'train_station', 'station', 
                      'halt', 'tram_stop']
    },
    'access': {
        'filename': 'local-landmarks-access.geojson',
        'name': 'Access & Facilities',
        'categories': ['gate', 'entrance', 'stile', 'kissing_gate', 'cattle_grid', 
                      'lift_gate', 'swing_gate', 'cycle_barrier', 'parking', 
                      'bicycle_parking', 'bench', 'toilets', 'drinking_water']
    },
    'historic': {
        'filename': 'local-landmarks-historic.geojson',
        'name': 'Historic & Heritage',
        'categories': ['historic', 'memorial', 'monument', 'archaeological_site', 
                      'ruins', 'castle', 'boundary_stone', 'roman_road', 'plaque']
    },
    'tourism': {
        'filename': 'local-landmarks-tourism.geojson',
        'name': 'Tourism & Information',
        'categories': ['information', 'attraction', 'viewpoint', 'museum', 'picnic_site',
                      'camp_site', 'caravan_site']
    },
    'misc': {
        'filename': 'local-landmarks-misc.geojson',
        'name': 'Other Landmarks',
        'categories': []  # Will catch everything else
    }
}

def categorize_feature(feature):
    """Determine which group a feature belongs to"""
    category = feature['properties'].get('category', 'unknown')
    
    for group_key, group_info in CATEGORY_GROUPS.items():
        if group_key == 'misc':
            continue
        if category in group_info['categories']:
            return group_key
    
    return 'misc'

# Load source data
print(f"Loading {SOURCE_FILE}...")
source_data = json.loads(SOURCE_FILE.read_text())
print(f"Total features: {len(source_data['features'])}")

# Group features by category
grouped_features = {key: [] for key in CATEGORY_GROUPS.keys()}

for feature in source_data['features']:
    group = categorize_feature(feature)
    grouped_features[group].append(feature)

# Write separate files
print("\nWriting category files:")
for group_key, features in grouped_features.items():
    if not features:
        print(f"  {group_key}: 0 features (skipping)")
        continue
    
    group_info = CATEGORY_GROUPS[group_key]
    output_file = DATA_DIR / group_info['filename']
    
    geojson = {
        'type': 'FeatureCollection',
        'name': group_info['name'],
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'source': source_data.get('source', {}),
        'features': features
    }
    
    output_file.write_text(json.dumps(geojson, indent=2) + '\n')
    file_size = output_file.stat().st_size / (1024 * 1024)
    
    print(f"  {group_key}: {len(features)} features -> {group_info['filename']} ({file_size:.2f} MB)")

print(f"\n✓ Split complete!")
print(f"\nOriginal file: {SOURCE_FILE.stat().st_size / (1024 * 1024):.2f} MB")
print(f"Total in split files: {sum(len(f) for f in grouped_features.values())} features")
