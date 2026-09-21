#!/usr/bin/env python3
"""
Finds the same place mapped twice.

scripts/apply_weekly_changeset.py refuses to add a place whose name already
exists, which stops the obvious duplicate. It does not stop the likely one: a
weekly run adding "The Bell Inn" beside an existing "The Bell" on the same
corner, or "Costa Coffee" beside "Costa". Nothing matched those, so nothing
blocked them -- and now that the run adds places automatically every week,
that is a slow leak rather than a hypothetical.

This sweeps the datasets for pairs that are almost certainly one place: near
each other, and the same name once the punctuation and the words describing
a trade are stripped out (see scripts/place_matching.py). It reports; it never
deletes. Two genuinely different shops can share a name and a corner -- a
chain with a kiosk inside a supermarket, say -- so the call belongs to a
person, and the pair is printed with enough detail to make it.

Usage:
    python3 scripts/find_duplicates.py [--root DIR] [--radius METRES] [--json]

No network. See scripts/test_find_duplicates.py.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.place_matching import feature_lonlat, metres_between, name_key  # noqa: E402

# Tighter than the radius used to decide whether a source is describing a
# place we already have. That question tolerates a point nudged across a
# street; this one is "are these two records the same shop", and a hundred
# metres is already most of a high street block.
DUPLICATE_RADIUS_M = 120

DATASETS = [
    "data/local-landmarks-food.geojson",
    "data/local-landmarks-misc.geojson",
    "data/local-landmarks-tourism.geojson",
    "data/local-landmarks-historic.geojson",
]


def _describe(feature, dataset):
    props = feature.get("properties") or {}
    return {
        "dataset": dataset,
        "id": feature.get("id") or props.get("id"),
        "name": props.get("name"),
        "category": props.get("category"),
        "address": props.get("address"),
    }


def find_duplicates(features_by_dataset, radius_m=DUPLICATE_RADIUS_M):
    """Pure. Takes {dataset name: [features]} and returns candidate pairs.

    Grouped by comparison key first so this stays cheap: only places that
    could be the same are ever measured against each other.
    """
    grouped = {}
    for dataset, features in features_by_dataset.items():
        for feature in features:
            props = feature.get("properties") or {}
            key = name_key(props.get("name"))
            if not key:
                continue
            grouped.setdefault(key, []).append((dataset, feature))

    pairs = []
    for members in grouped.values():
        if len(members) < 2:
            continue
        for index, (dataset, feature) in enumerate(members):
            here = feature_lonlat(feature)
            for other_dataset, other in members[index + 1:]:
                there = feature_lonlat(other)
                if here is None or there is None:
                    continue
                gap = metres_between(here, there)
                if gap > radius_m:
                    continue
                pairs.append({
                    "metresApart": round(gap, 1),
                    "places": [_describe(feature, dataset), _describe(other, other_dataset)],
                })
    return sorted(pairs, key=lambda p: p["metresApart"])


def load_datasets(root=ROOT, datasets=DATASETS):
    out = {}
    for rel in datasets:
        path = Path(root) / rel
        if path.exists():
            out[Path(rel).name] = json.loads(path.read_text()).get("features", [])
    return out


def render(pairs):
    if not pairs:
        return "No likely duplicates found."
    lines = [f"{len(pairs)} pair(s) that look like the same place mapped twice:", ""]
    for pair in pairs:
        a, b = pair["places"]
        lines.append(f"  {pair['metresApart']}m apart")
        for place in (a, b):
            lines.append(f"    {place['name']} ({place['category']}) {place['id']} in {place['dataset']}")
            if place["address"]:
                lines.append(f"      {place['address']}")
        lines.append("")
    lines.append("Nothing has been changed. Two different shops can share a name and a corner,")
    lines.append("so which of a pair to keep -- if either -- is a person's call.")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--radius", type=float, default=DUPLICATE_RADIUS_M)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    pairs = find_duplicates(load_datasets(Path(args.root)), args.radius)
    print(json.dumps(pairs, indent=2) if args.json else render(pairs))


if __name__ == "__main__":
    main()
