#!/usr/bin/env python3
"""
Tracks the Nofence virtual-fence grazing boundary ("pasture") for Epping
Forest's conservation-grazing cattle, so the weekly report can say when
they've moved and roughly where to -- not just show a live dot on the map.

Compares this run's pasture boundary against the last one recorded in
data/cow-grazing-history.json and, if it changed, describes the new area in
plain English using the nearest well-known place (scripts/report/places.py).

Usage:
    python3 scripts/cow_boundary_tracker.py [--history PATH] [--out PATH] [--dry-run]

Network: calls the same public Nofence endpoint the app's own
netlify/functions/cows.js proxies (js/app.js's DEFAULT_COW_CENTER). The
comparison/description logic (detect_change, describe_location) takes plain
Python data and has no network dependency -- see
scripts/test_cow_boundary_tracker.py.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.report.geo import haversine_metres, nearest_place  # noqa: E402
from scripts.report.places import NAMED_PLACES  # noqa: E402

# Must match js/app.js's DEFAULT_COW_CENTER -- the point the live app
# centres its own Nofence lookup on. Kept here rather than parsed out of
# js/app.js because that file isn't meant to be machine-read by scripts;
# scripts/test_cow_boundary_tracker.py pins this exact value so a change to
# the app's constant without updating this one fails loudly instead of
# silently drifting.
DEFAULT_COW_CENTER = {"longitude": 0.06371428038973509, "latitude": 51.656022523996725}

NOFENCE_URL_BASE = "https://account.nofence.no/api/open/data/?center="
REQUEST_TIMEOUT_S = 30

DEFAULT_HISTORY_PATH = ROOT / "data" / "cow-grazing-history.json"

# A pasture move smaller than this (in the combined-centroid position) is
# treated as noise/re-drawing the same area, not a real move -- the pasture
# id set changing is the primary signal; this is a fallback for when ids
# happen to repeat.
MOVE_DISTANCE_THRESHOLD_M = 150


def fetch_cow_data(center=None, timeout=REQUEST_TIMEOUT_S):
    """Network call. Returns the raw Nofence payload: {collars, pastures, owner}."""
    center = center or DEFAULT_COW_CENTER
    url = f"{NOFENCE_URL_BASE}{center['longitude']},{center['latitude']}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_pastures(payload):
    """Normalizes the raw payload's pastures into [{id, ring}], where ring
    is a flat list of (lon, lat) tuples from the (first/outer) ring of each
    pasture's polygon."""
    pastures = []
    for pasture in (payload or {}).get("pastures", []) or []:
        geometry = pasture.get("geometry") or {}
        coords = geometry.get("coordinates")
        if geometry.get("type") == "Polygon" and coords:
            ring = coords[0]
        elif geometry.get("type") == "MultiPolygon" and coords:
            ring = coords[0][0]
        else:
            continue
        points = [(pt[0], pt[1]) for pt in ring if len(pt) >= 2]
        if points:
            pastures.append({"id": pasture.get("id"), "ring": points})
    return pastures


def combined_centroid(pastures):
    """Simple (unweighted) average of every vertex across every pasture --
    a schematic "roughly here", not a precise area-weighted centroid."""
    points = [pt for p in pastures for pt in p["ring"]]
    if not points:
        return None
    lon = sum(p[0] for p in points) / len(points)
    lat = sum(p[1] for p in points) / len(points)
    return (lon, lat)


def pasture_ids(pastures):
    return sorted(p["id"] for p in pastures if p.get("id") is not None)


def detect_change(previous_snapshot, current_pastures, distance_threshold_m=MOVE_DISTANCE_THRESHOLD_M):
    """previous_snapshot: the dict last written by save_snapshot (or None on
    a first-ever run). current_pastures: from extract_pastures().

    Returns {"moved": bool, "first_run": bool, "centroid": (lon, lat) or None,
    "distance_from_previous_m": float or None}.
    """
    centroid = combined_centroid(current_pastures)
    if previous_snapshot is None:
        return {"moved": False, "first_run": True, "centroid": centroid, "distance_from_previous_m": None}

    previous_ids = previous_snapshot.get("pastureIds", [])
    current_ids = pasture_ids(current_pastures)
    ids_changed = previous_ids != current_ids

    previous_centroid = previous_snapshot.get("centroid")
    distance = None
    distance_exceeded = False
    if centroid and previous_centroid:
        distance = haversine_metres(centroid[0], centroid[1], previous_centroid[0], previous_centroid[1])
        distance_exceeded = distance > distance_threshold_m

    return {
        "moved": bool(ids_changed or distance_exceeded),
        "first_run": False,
        "centroid": centroid,
        "distance_from_previous_m": round(distance, 1) if distance is not None else None,
    }


def _distance_phrase(distance_m):
    km = distance_m / 1000
    if distance_m < 500:
        return "right by"
    if distance_m < 1500:
        return "close to"
    if distance_m < 4000:
        return "not far from"
    return f"roughly {km:.1f}km from"


def describe_location(centroid, places=None):
    """Returns (place_name, plain_english_sentence) for a centroid, or
    (None, "") if there's no centroid to describe."""
    if not centroid:
        return None, ""
    places = places if places is not None else NAMED_PLACES
    place, distance_m = nearest_place(centroid[0], centroid[1], places)
    if not place:
        return None, ""
    phrase = _distance_phrase(distance_m)
    sentence = f"The forest's grazing cattle have moved to a new area {phrase} {place['name']}."
    return place["name"], sentence


def build_grazing_report_data(change, places=None):
    """Builds the exact `grazing` dict shape render_report.py expects (see
    scripts/report/report-data.schema.md)."""
    if change["first_run"] or not change["moved"] or not change["centroid"]:
        place_name, _ = describe_location(change["centroid"], places) if change["centroid"] else (None, "")
        body = (
            f"The forest's grazing cattle haven't moved paddocks this week — "
            f"they're still in the same area, close to {place_name}."
            if place_name else ""
        )
        return {
            "moved": False,
            "place": place_name or "",
            "body": body,
            "lon": change["centroid"][0] if change["centroid"] else None,
            "lat": change["centroid"][1] if change["centroid"] else None,
            "sources": [],
        }

    place_name, sentence = describe_location(change["centroid"], places)
    return {
        "moved": True,
        "place": place_name or "",
        "body": sentence,
        "lon": change["centroid"][0],
        "lat": change["centroid"][1],
        "sources": [],
    }


def load_snapshot(history_path):
    path = Path(history_path)
    if not path.exists():
        return None
    return json.loads(path.read_text())


def save_snapshot(history_path, pastures, centroid):
    snapshot = {
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "pastureIds": pasture_ids(pastures),
        "centroid": list(centroid) if centroid else None,
        "pastures": [{"id": p["id"], "ring": p["ring"]} for p in pastures],
    }
    path = Path(history_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, indent=2) + "\n")
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", default=str(DEFAULT_HISTORY_PATH))
    parser.add_argument("--out", default=None, help="Write the grazing report-data JSON here instead of stdout")
    parser.add_argument("--dry-run", action="store_true", help="Don't update the stored history snapshot")
    args = parser.parse_args()

    try:
        payload = fetch_cow_data()
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Nofence lookup failed ({exc}) -- skipping the grazing update this run.", file=sys.stderr)
        sys.exit(2)

    pastures = extract_pastures(payload)
    previous = load_snapshot(args.history)
    change = detect_change(previous, pastures)
    grazing = build_grazing_report_data(change)

    if not args.dry_run:
        save_snapshot(args.history, pastures, change["centroid"])

    output = json.dumps(grazing, indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n")
        print(f"Wrote {args.out}: moved={grazing['moved']}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
