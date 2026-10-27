"""Compact GeoJSON writing for the large generated map datasets.

The app downloads and parses these files on every first visit and keeps them in the
offline cache, and pretty-printing (indent=2) more than doubled their size: half of the
44 MB local-environment.geojson was whitespace. One feature per line is nearly as small
as fully minified JSON while keeping git diffs per feature, so a regeneration stays
reviewable. scripts/geojson-format.js is the same format for the Node writers.
"""

import json
from pathlib import Path


def dumps_feature_lines(geojson):
    """Serialise a FeatureCollection with every top-level member on the first line and one feature per line."""
    head = {key: value for key, value in geojson.items() if key != "features"}
    head_json = json.dumps(head, separators=(",", ":"), ensure_ascii=False)
    features = ",\n".join(
        json.dumps(feature, separators=(",", ":"), ensure_ascii=False)
        for feature in geojson.get("features", [])
    )
    opening = head_json[:-1] + ("," if head else "")
    return f'{opening}"features":[\n{features}\n]}}\n'


def write_feature_lines(path, geojson):
    Path(path).write_text(dumps_feature_lines(geojson), encoding="utf-8")
