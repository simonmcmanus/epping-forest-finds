#!/usr/bin/env python3
"""
Further split the access file into smaller chunks
"""
import json
from pathlib import Path
from datetime import datetime, timezone

DATA_DIR = Path('data')
ACCESS_FILE = DATA_DIR / 'local-landmarks-access.geojson'

# Split access into smaller groups
ACCESS_GROUPS = {
    'gates': {
        'filename': 'local-landmarks-gates.geojson',
        'name': 'Gates & Barriers',
        'categories': ['gate', 'stile', 'kissing_gate', 'cattle_grid', 
                      'lift_gate', 'swing_gate', 'cycle_barrier', 'entrance']
    },
    'facilities': {
        'filename': 'local-landmarks-facilities.geojson',
        'name': 'Facilities',
        'categories': ['parking', 'bicycle_parking', 'bench', 'toilets', 'drinking_water']
    }
}

# Load access data
print(f"Loading {ACCESS_FILE}...")
access_data = json.loads(ACCESS_FILE.read_text())
print(f"Total features: {len(access_data['features'])}")

# Group features
grouped_features = {key: [] for key in ACCESS_GROUPS.keys()}

for feature in access_data['features']:
    category = feature['properties'].get('category', 'unknown')
    assigned = False
    
    for group_key, group_info in ACCESS_GROUPS.items():
        if category in group_info['categories']:
            grouped_features[group_key].append(feature)
            assigned = True
            break
    
    if not assigned:
        print(f"Warning: Uncategorized: {category}")

# Write separate files
print("\nWriting split access files:")
for group_key, features in grouped_features.items():
    if not features:
        continue
    
    group_info = ACCESS_GROUPS[group_key]
    output_file = DATA_DIR / group_info['filename']
    
    geojson = {
        'type': 'FeatureCollection',
        'name': group_info['name'],
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'source': access_data.get('source', {}),
        'features': features
    }
    
    output_file.write_text(json.dumps(geojson, indent=2) + '\n')
    file_size = output_file.stat().st_size / (1024 * 1024)
    
    print(f"  {group_key}: {len(features)} features -> {group_info['filename']} ({file_size:.2f} MB)")

# Remove the old access file
print(f"\nRemoving {ACCESS_FILE}...")
ACCESS_FILE.unlink()

print(f"\n✓ Access split complete!")
