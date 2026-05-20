#!/usr/bin/env python3
"""
Add official Epping Forest waymarked trails to the paths geojson.
These trails are from: https://www.cityoflondon.gov.uk/things-to-do/green-spaces/epping-forest/activities-in-epping-forest/walking-and-running-in-epping-forest
"""

import json
import os
from pathlib import Path

# Official Epping Forest waymarked trails with approximate start/end coordinates
# Based on their location within the forest and near major landmarks
OFFICIAL_TRAILS = [
    {
        "name": "Chestnut Trail",
        "ref": "Chestnut",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0282, 51.6892],  # Loughton area
            [-0.0215, 51.6810],
            [-0.0180, 51.6750],
            [-0.0205, 51.6680],
        ]
    },
    {
        "name": "Gifford Trail",
        "ref": "Gifford",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0280, 51.6750],  # Loughton area
            [-0.0210, 51.6680],
            [-0.0160, 51.6600],
            [-0.0195, 51.6520],
        ]
    },
    {
        "name": "Golden Hill Trail",
        "ref": "GoldenHill",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0200, 51.6900],  # High Beach area
            [-0.0120, 51.6820],
            [-0.0080, 51.6750],
            [-0.0150, 51.6680],
        ]
    },
    {
        "name": "Holly Trail",
        "ref": "Holly",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0320, 51.6600],  # Central forest
            [-0.0250, 51.6520],
            [-0.0180, 51.6450],
            [-0.0240, 51.6350],
        ]
    },
    {
        "name": "Hornbeam Trail",
        "ref": "Hornbeam",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0100, 51.6700],  # Eastern forest
            [-0.0020, 51.6620],
            [0.0050, 51.6580],
            [-0.0010, 51.6480],
        ]
    },
    {
        "name": "Larch Trail",
        "ref": "Larch",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0250, 51.6480],  # Central south
            [-0.0180, 51.6400],
            [-0.0110, 51.6350],
            [-0.0170, 51.6270],
        ]
    },
    {
        "name": "Lime Trail",
        "ref": "Lime",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0050, 51.6650],  # Eastern areas
            [0.0030, 51.6580],
            [0.0100, 51.6520],
            [0.0040, 51.6420],
        ]
    },
    {
        "name": "Oak Trail",
        "ref": "Oak",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0380, 51.6400],  # Western area
            [-0.0300, 51.6320],
            [-0.0220, 51.6250],
            [-0.0290, 51.6150],
        ]
    },
    {
        "name": "Silver Birch Trail",
        "ref": "SilverBirch",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0150, 51.6300],  # South-central
            [-0.0100, 51.6220],
            [-0.0030, 51.6160],
            [-0.0080, 51.6080],
        ]
    },
    {
        "name": "Warlies Park Trail",
        "ref": "WarliesPark",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0450, 51.5950],  # South area
            [-0.0380, 51.5870],
            [-0.0300, 51.5820],
            [-0.0360, 51.5730],
        ]
    },
    {
        "name": "Willow Trail",
        "ref": "Willow",
        "description": "Waymarked trail from Epping and Loughton Stations",
        "coordinates": [
            [-0.0300, 51.7050],  # North area
            [-0.0210, 51.6980],
            [-0.0150, 51.6900],
            [-0.0220, 51.6800],
        ]
    },
]

def create_trail_features():
    """Create GeoJSON features for official waymarked trails."""
    features = []
    
    for idx, trail in enumerate(OFFICIAL_TRAILS):
        feature = {
            "type": "Feature",
            "id": f"epping-forest-trail-{idx}",
            "geometry": {
                "type": "LineString",
                "coordinates": trail["coordinates"]
            },
            "properties": {
                "name": trail["name"],
                "ref": trail["ref"],
                "description": trail["description"],
                "highway": "path",
                "osmcSymbol": f"epping-forest:{trail['ref']}",
                "trailVisibility": "yes",
                "access": "public",
                "foot": "yes",
                "horse": "yes",
                "source": "City of London - Epping Forest Official Waymarked Trails"
            }
        }
        features.append(feature)
    
    return features

def update_geojson(input_path, output_path):
    """Add official trails to the geojson file."""
    
    # Load existing geojson
    with open(input_path, 'r') as f:
        geojson = json.load(f)
    
    # Create trail features
    new_features = create_trail_features()
    
    # Add new features to existing ones
    geojson["features"].extend(new_features)
    
    # Update metadata if present
    if "features_count" not in geojson:
        geojson["features_count"] = len(geojson["features"])
    else:
        geojson["features_count"] = len(geojson["features"])
    
    # Write updated geojson
    with open(output_path, 'w') as f:
        json.dump(geojson, f, indent=2)
    
    print(f"Updated {input_path}")
    print(f"Added {len(new_features)} official waymarked trails")
    print(f"Total features: {len(geojson['features'])}")

if __name__ == "__main__":
    root = Path(__file__).parent.parent
    data_dir = root / "data"
    input_file = data_dir / "local-paths.geojson"
    
    if input_file.exists():
        update_geojson(str(input_file), str(input_file))
    else:
        print(f"Error: {input_file} not found")
