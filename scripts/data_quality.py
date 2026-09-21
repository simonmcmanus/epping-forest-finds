#!/usr/bin/env python3
"""
Says how good the map's data actually is, so a week of work has a number
attached rather than a feeling.

The weekly pull request has always said what changed. It has never said
whether the map is getting better, which is why four of its seven datasets
could sit untouched since the day they were generated without anyone
noticing. A slow regression looks exactly like a quiet week.

This reports, per dataset: how many places there are, how many a source has
confirmed recently (see scripts/verification.py), how many have never been
confirmed at all, and how thin the useful fields are. Run it before and after
a change and the difference is the week's real result.

Usage:
    python3 scripts/data_quality.py [--root DIR] [--today YYYY-MM-DD]
                                    [--json] [--compare PATH]

`--compare` takes a previously saved `--json` run and prints the movement
since, which is the form the weekly pull request quotes.

No network. See scripts/test_data_quality.py.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts import verification  # noqa: E402

# Every dataset of places the map draws pins for. Paths, roads and the
# environment layers are lines and polygons rather than places, and trees come
# from a register rather than a survey, so neither is measured here.
PLACE_DATASETS = [
    "data/local-landmarks-food.geojson",
    "data/local-landmarks-transport.geojson",
    "data/local-landmarks-facilities.geojson",
    "data/local-landmarks-gates.geojson",
    "data/local-landmarks-historic.geojson",
    "data/local-landmarks-tourism.geojson",
    "data/local-landmarks-misc.geojson",
]

# Fields worth having on a place a walker is trying to find. A pin with no
# address is still a pin, but it is far less use standing on a high street,
# and it makes the place much harder to match against any other source.
USEFUL_FIELDS = ("address", "website", "phone")


def _feature_key(feature):
    props = feature.get("properties") or {}
    osm_type, osm_id = props.get("osmType"), props.get("osmId")
    if osm_type and osm_id:
        return f"{osm_type}/{osm_id}"
    return feature.get("id") or props.get("id")


def measure_dataset(path, record, today):
    data = json.loads(Path(path).read_text())
    features = data.get("features", [])
    keys = [k for k in (_feature_key(f) for f in features) if k]

    summary = verification.summarise(record, keys, today)
    summary["dataset"] = Path(path).name
    summary["generatedAt"] = (data.get("generatedAt") or "")[:10] or None
    summary["fields"] = {
        field: sum(1 for f in features if (f.get("properties") or {}).get(field))
        for field in USEFUL_FIELDS
    }
    # A place with no id of any kind cannot be confirmed, matched or removed
    # by anything automated -- it can only ever be found by name.
    summary["withoutKey"] = len(features) - len(keys)
    return summary


def measure(root=ROOT, today=None, verification_path=None):
    today = today or verification.today_iso()
    record = verification.load(verification_path or (Path(root) / "data" / "verification.json"))
    datasets = [
        measure_dataset(Path(root) / rel, record, today)
        for rel in PLACE_DATASETS
        if (Path(root) / rel).exists()
    ]
    totals = {
        "total": sum(d["total"] for d in datasets),
        "fresh": sum(d["fresh"] for d in datasets),
        "stale": sum(d["stale"] for d in datasets),
        "neverConfirmed": sum(d["neverConfirmed"] for d in datasets),
    }
    for field in USEFUL_FIELDS:
        totals[field] = sum(d["fields"][field] for d in datasets)
    return {"measuredOn": today, "totals": totals, "datasets": datasets}


def _pct(part, whole):
    return f"{(100 * part / whole):.0f}%" if whole else "--"


def render(result, previous=None):
    lines = []
    totals = result["totals"]
    lines.append(
        f"{totals['total']} places on the map. "
        f"{totals['fresh']} confirmed in the last {verification.STALE_AFTER_DAYS} days "
        f"({_pct(totals['fresh'], totals['total'])}); "
        f"{totals['neverConfirmed']} never confirmed by any source."
    )

    if previous:
        before = previous.get("totals", {})
        moved = []
        for label, key in (("places", "total"), ("confirmed", "fresh"), ("never confirmed", "neverConfirmed")):
            delta = totals.get(key, 0) - before.get(key, 0)
            if delta:
                moved.append(f"{label} {delta:+d}")
        lines.append("Since the last check: " + (", ".join(moved) if moved else "no change") + ".")

    lines.append("")
    lines.append(f"{'dataset':38} {'places':>7} {'fresh':>7} {'never':>7} {'address':>8} {'website':>8}")
    for d in result["datasets"]:
        lines.append(
            f"{d['dataset']:38} {d['total']:7} {d['fresh']:7} {d['neverConfirmed']:7} "
            f"{_pct(d['fields']['address'], d['total']):>8} {_pct(d['fields']['website'], d['total']):>8}"
        )

    unchecked = [d for d in result["datasets"] if d["fresh"] == 0 and d["total"]]
    if unchecked:
        lines.append("")
        lines.append("No source has confirmed anything in these, so they are only as good as the day they were made:")
        for d in unchecked:
            lines.append(f"  {d['dataset']} ({d['total']} places, generated {d['generatedAt'] or 'unknown'})")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--today", default=None)
    parser.add_argument("--json", action="store_true", help="Emit the measurements as JSON")
    parser.add_argument("--compare", default=None, help="A previously saved --json run, to show the movement since")
    args = parser.parse_args()

    result = measure(Path(args.root), args.today)
    previous = json.loads(Path(args.compare).read_text()) if args.compare and Path(args.compare).exists() else None
    print(json.dumps(result, indent=2) if args.json else render(result, previous))


if __name__ == "__main__":
    main()
