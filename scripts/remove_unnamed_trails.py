#!/usr/bin/env python3
"""
Remove unnamed trails from the paths geojson, keeping only features with names.
"""

import json
from pathlib import Path

def remove_unnamed_trails(input_path, output_path):
    """Remove trails without names from the geojson file."""
    
    # Load existing geojson
    with open(input_path, 'r') as f:
        geojson = json.load(f)
    
    original_count = len(geojson["features"])
    
    # Filter to keep only features with names
    named_features = [
        feature for feature in geojson["features"]
        if feature.get("properties", {}).get("name") is not None
    ]
    
    geojson["features"] = named_features
    
    # Write updated geojson
    with open(output_path, 'w') as f:
        json.dump(geojson, f, indent=2)
    
    removed_count = original_count - len(named_features)
    print(f"Removed {removed_count} unnamed trails")
    print(f"Kept {len(named_features)} named trails")
    print(f"Total: {original_count} → {len(named_features)}")

if __name__ == "__main__":
    root = Path(__file__).parent.parent
    data_dir = root / "data"
    input_file = data_dir / "local-paths.geojson"
    
    if input_file.exists():
        remove_unnamed_trails(str(input_file), str(input_file))
    else:
        print(f"Error: {input_file} not found")
