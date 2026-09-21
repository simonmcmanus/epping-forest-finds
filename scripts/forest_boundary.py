#!/usr/bin/env python3
"""
Is this place close enough to the forest for the map to carry it?

The map is not a map of north-east London. It carries what somebody walking
in Epping Forest could reach: everything on it sits within about eight
minutes' walk of the forest boundary (`MAX_DISTANCE_FROM_BOUNDARY_METRES`),
which is why the food dataset holds 684 places and not many thousands.

The search box the sources are queried with is far larger than that -- about
22km by 12km, taking in Leytonstone, Walthamstow and most of Epping Forest
district. Filtering candidates by that box alone lets in every pub in inner
London. The first weekly run to reach the food-hygiene register found 2,949
"new" places out of 3,204, nearly all of them miles from any tree: they would
have been banked on the watchlist, grown confident over two weeks, and then
been rejected one at a time by the distance check in
apply_weekly_changeset.py -- after burying the week's three real findings.

So candidates are filtered here, at the point they are found, against the
same rule the map itself uses.

Why the grid
------------
The boundary is 74,579 segments. Measuring one point against all of them
takes 0.07s, which is four minutes for a single source's candidate list and
more than the whole weekly run can spare. The segments are bucketed into
roughly kilometre-wide cells, and a query measures only the segments in the
cells that could possibly hold the nearest one. Same answer, thousands of
times faster.

No network. See scripts/test_forest_boundary.py.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FOREST_BOUNDARY_FILE = ROOT / "data" / "epping-forest-land.geojson"

# Matches scripts/regenerate_local_landmarks.py and apply_weekly_changeset.py:
# the map's own definition of "near enough to walk to".
WALKING_SPEED_M_PER_MIN = 3500 / 60
MAX_WALK_MINUTES_FROM_BOUNDARY = 8
MAX_DISTANCE_FROM_BOUNDARY_METRES = WALKING_SPEED_M_PER_MIN * MAX_WALK_MINUTES_FROM_BOUNDARY

# Roughly 1.1km of latitude and 0.7km of longitude at this latitude -- comfortably
# wider than the distance ever asked about, so the nearest segment to any point
# is always in that point's cell or one touching it.
CELL_DEGREES = 0.01

EARTH_RADIUS_M = 6371000


def _cell(lon, lat):
    return (math.floor(lon / CELL_DEGREES), math.floor(lat / CELL_DEGREES))


def _to_local_xy(lon, lat, ref_lat_rad):
    x = EARTH_RADIUS_M * math.radians(lon) * math.cos(ref_lat_rad)
    y = EARTH_RADIUS_M * math.radians(lat)
    return x, y


def _point_to_segment_m(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _rings(geojson):
    for feature in geojson.get("features", []):
        geometry = feature.get("geometry") or {}
        kind, coords = geometry.get("type"), geometry.get("coordinates", [])
        if kind == "Polygon":
            yield from coords
        elif kind == "MultiPolygon":
            for polygon in coords:
                yield from polygon


def build_index(geojson):
    """Buckets every boundary segment into the cells its extent touches."""
    cells = {}
    lats = []
    for ring in _rings(geojson):
        for i in range(len(ring) - 1):
            (ax, ay), (bx, by) = ring[i][:2], ring[i + 1][:2]
            lats.extend((ay, by))
            segment = (ax, ay, bx, by)
            lo, hi = _cell(min(ax, bx), min(ay, by)), _cell(max(ax, bx), max(ay, by))
            for cx in range(lo[0], hi[0] + 1):
                for cy in range(lo[1], hi[1] + 1):
                    cells.setdefault((cx, cy), []).append(segment)
    ref_lat_rad = math.radians(sum(lats) / len(lats)) if lats else math.radians(51.65)
    return {"cells": cells, "ref_lat_rad": ref_lat_rad, "segments": sum(len(v) for v in cells.values())}


def load_index(path=FOREST_BOUNDARY_FILE):
    return build_index(json.loads(Path(path).read_text()))


def distance_m(lon, lat, index):
    """Metres to the nearest boundary segment, or None when nothing is near
    enough to be in the neighbouring cells -- which already means far outside
    anything this map carries."""
    cx, cy = _cell(lon, lat)
    ref = index["ref_lat_rad"]
    px, py = _to_local_xy(lon, lat, ref)
    best = None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for ax_lon, ax_lat, bx_lon, bx_lat in index["cells"].get((cx + dx, cy + dy), ()):
                ax, ay = _to_local_xy(ax_lon, ax_lat, ref)
                bx, by = _to_local_xy(bx_lon, bx_lat, ref)
                d = _point_to_segment_m(px, py, ax, ay, bx, by)
                if best is None or d < best:
                    best = d
    return best


def within_walk(lon, lat, index, max_m=MAX_DISTANCE_FROM_BOUNDARY_METRES):
    if lon is None or lat is None:
        return False
    distance = distance_m(lon, lat, index)
    return distance is not None and distance <= max_m
