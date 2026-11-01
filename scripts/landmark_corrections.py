"""Preserve plaque tags and reapply reviewed corrections after an OSM refresh."""
import json


def load_corrections(data_dir):
    path = data_dir / 'landmark-corrections.json'
    return json.loads(path.read_text())['corrections'] if path.exists() else {}


def corrected_properties(properties, tags, corrections):
    result = {**properties, **{key: tags[key] for key in ('memorial', 'memorial:type', 'colour') if key in tags}}
    result.update(corrections.get(properties['id'], {}).get('properties', {}))
    kinds = {str(result.get(key) or '').strip().lower().replace(' ', '_') for key in ('memorial', 'memorial:type', 'historic', 'category')}
    blue = 'blue_plaque' in kinds or ('plaque' in kinds and str(result.get('colour', '')).strip().lower() == 'blue')
    if blue or 'plaque' in kinds:
        result.update(category='plaque', categoryLabel='Blue plaque' if blue else 'Plaque')
    return result
