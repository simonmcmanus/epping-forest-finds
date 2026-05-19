#!/usr/bin/env python3
import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
DATA = ROOT / "data"
QUERY_PATH = DATA / "local-roads.overpassql"
OVERPASS_JSON_PATH = DATA / "local-roads.overpass.json"
GEOJSON_PATH = DATA / "local-roads.geojson"

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

def fetch_overpass_data():
    """Fetch road data from Overpass API"""
    with open(QUERY_PATH, 'r') as f:
        query = f.read()
    
    data = urllib.parse.urlencode({'data': query}).encode('utf-8')
    
    for url in OVERPASS_URLS:
        try:
            print(f"Trying {url}...")
            req = urllib.request.Request(url, data=data)
            with urllib.request.urlopen(req, timeout=120) as response:
                result = json.loads(response.read().decode('utf-8'))
                print(f"✓ Fetched {len(result.get('elements', []))} roads")
                return result
        except Exception as e:
            print(f"✗ Failed: {e}")
            continue
    
    raise Exception("All Overpass API endpoints failed")

def convert_to_geojson(overpass_data):
    """Convert Overpass JSON to GeoJSON"""
    features = []
    
    for element in overpass_data.get('elements', []):
        if element['type'] != 'way':
            continue
        
        geometry = element.get('geometry', [])
        if not geometry:
            continue
        
        coords = [[point['lon'], point['lat']] for point in geometry]
        
        tags = element.get('tags', {})
        highway_type = tags.get('highway', 'unknown')
        name = tags.get('name', tags.get('ref', ''))
        
        feature = {
            'type': 'Feature',
            'id': f"way/{element['id']}",
            'geometry': {
                'type': 'LineString',
                'coordinates': coords
            },
            'properties': {
                'id': f"way/{element['id']}",
                'osmType': 'way',
                'osmId': element['id'],
                'name': name,
                'highway': highway_type,
                'service': tags.get('service'),
                'ref': tags.get('ref'),
                'maxspeed': tags.get('maxspeed'),
                'surface': tags.get('surface'),
                'lanes': tags.get('lanes'),
                'oneway': tags.get('oneway'),
            }
        }
        
        features.append(feature)
    
    return {
        'type': 'FeatureCollection',
        'features': features,
        'metadata': {
            'generated': datetime.now(timezone.utc).isoformat(),
            'source': 'OpenStreetMap via Overpass API',
            'count': len(features)
        }
    }

def main():
    print("Fetching road data from Overpass API...")
    overpass_data = fetch_overpass_data()
    
    print(f"Saving raw Overpass response to {OVERPASS_JSON_PATH}...")
    with open(OVERPASS_JSON_PATH, 'w') as f:
        json.dump(overpass_data, f, indent=2)
    
    print("Converting to GeoJSON...")
    geojson = convert_to_geojson(overpass_data)
    
    print(f"Saving GeoJSON to {GEOJSON_PATH}...")
    with open(GEOJSON_PATH, 'w') as f:
        json.dump(geojson, f, indent=2)
    
    print(f"✓ Done! Generated {geojson['metadata']['count']} road features")

if __name__ == '__main__':
    main()
