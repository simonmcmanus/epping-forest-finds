#!/usr/bin/env python3
"""
Finds the same place mapped twice.

scripts/apply_weekly_changeset.py now refuses an addition that matches a
mapped place by either name key within a short walk, which stops most of this
at the door. This is the sweep behind that door: for the pairs already in the
datasets from before the check existed, and for anything a future source adds
by a route the check does not cover.

A pair is a candidate when the two are near each other and look like one
place -- the same name once punctuation and the words describing a trade are
stripped out ("The Bell Inn" / "The Bell"), or the same name once spacing and
ampersands are closed up ("CHAPTER 21" / "Chapter21"). See
scripts/place_matching.py; both keys are needed, and bucketing under only the
first is how a real near-duplicate got past this sweep and was caught by a
person instead.

It reports; it never deletes. Two genuinely different shops can share a name
and a corner -- a chain with a kiosk inside a supermarket, say -- so the call
belongs to a person, and the pair is printed with enough detail to make it.

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

from scripts.place_matching import (  # noqa: E402
    compact_name, feature_lonlat, metres_between, name_key, names_look_like_one_place,
)

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
    # Bucketed under both keys, because they catch different mistakes: one a
    # name described differently ("Bell Inn" / "The Bell"), the other a name
    # typed differently ("CHAPTER 21" / "Chapter21"). Bucketing under only the
    # first missed the second entirely -- which is how a real near-duplicate
    # got past this sweep and was caught by a person instead.
    grouped = {}
    for dataset, features in features_by_dataset.items():
        for feature in features:
            props = feature.get("properties") or {}
            for key in {name_key(props.get("name")), compact_name(props.get("name"))}:
                if key:
                    grouped.setdefault(key, []).append((dataset, feature))

    pairs, seen = [], set()
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
                if not names_look_like_one_place(
                    (feature.get("properties") or {}).get("name"),
                    (other.get("properties") or {}).get("name"),
                ):
                    continue
                # A pair can land in both buckets; report it once.
                identity = tuple(sorted((
                    str(feature.get("id") or id(feature)),
                    str(other.get("id") or id(other)),
                )))
                if identity in seen:
                    continue
                seen.add(identity)
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
