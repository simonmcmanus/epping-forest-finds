#!/usr/bin/env python3
"""Unit tests for scripts/forest_boundary.py. Run: python3 scripts/test_forest_boundary.py"""
import json
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import forest_boundary as fb  # noqa: E402
from scripts.apply_weekly_changeset import (  # noqa: E402
    distance_to_boundary_m, load_boundary_segments,
)

# A 1km-ish square near Loughton, small enough to reason about by hand.
SQUARE = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [[
            [0.050, 51.645], [0.065, 51.645], [0.065, 51.655],
            [0.050, 51.655], [0.050, 51.645],
        ]]},
        "properties": {},
    }],
}


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.index = fb.build_index(SQUARE)

    def test_a_point_on_the_boundary_is_no_distance_from_it(self):
        self.assertAlmostEqual(fb.distance_m(0.050, 51.650, self.index), 0, delta=1)

    def test_a_point_just_inside_is_close_to_it(self):
        self.assertLess(fb.distance_m(0.0505, 51.650, self.index), 60)

    def test_a_point_far_outside_has_nothing_near(self):
        # Nothing in the neighbouring cells at all, which already means far
        # outside anything this map carries.
        self.assertIsNone(fb.distance_m(1.5, 52.5, self.index))

    def test_multipolygon_boundaries_are_read(self):
        multi = {"type": "FeatureCollection", "features": [{
            "type": "Feature",
            "geometry": {"type": "MultiPolygon",
                         "coordinates": [SQUARE["features"][0]["geometry"]["coordinates"]]},
            "properties": {},
        }]}
        self.assertAlmostEqual(fb.distance_m(0.050, 51.650, fb.build_index(multi)), 0, delta=1)


class WithinWalkTests(unittest.TestCase):
    def setUp(self):
        self.index = fb.build_index(SQUARE)

    def test_a_place_beside_the_forest_is_in_scope(self):
        self.assertTrue(fb.within_walk(0.0505, 51.650, self.index))

    def test_a_place_miles_away_is_not(self):
        # The gap this closes: the search box the sources are queried with
        # takes in most of north-east London, and the map does not.
        self.assertFalse(fb.within_walk(1.5, 52.5, self.index))

    def test_a_place_with_no_position_is_not_in_scope(self):
        self.assertFalse(fb.within_walk(None, 51.650, self.index))
        self.assertFalse(fb.within_walk(0.05, None, self.index))

    def test_the_cutoff_is_the_maps_own_eight_minute_walk(self):
        self.assertAlmostEqual(fb.MAX_DISTANCE_FROM_BOUNDARY_METRES, 3500 / 60 * 8, places=6)


class AgainstTheRealBoundaryTests(unittest.TestCase):
    """The grid exists only to be fast. It has to give the same answer as
    measuring against all 74,579 segments, or it is just wrong quickly."""

    @classmethod
    def setUpClass(cls):
        cls.index = fb.load_index()
        cls.geojson = json.loads(fb.FOREST_BOUNDARY_FILE.read_text())
        cls.segments, cls.ref = load_boundary_segments(cls.geojson)

    def test_it_agrees_with_measuring_against_every_segment(self):
        food = json.loads((fb.ROOT / "data" / "local-landmarks-food.geojson").read_text())
        random.seed(11)
        for feature in random.sample(food["features"], 8):
            lon, lat = feature["geometry"]["coordinates"]
            fast = fb.distance_m(lon, lat, self.index)
            slow = distance_to_boundary_m(lon, lat, self.segments, self.ref)
            self.assertIsNotNone(fast, f"{feature['properties'].get('name')} should be near the forest")
            self.assertAlmostEqual(fast, slow, delta=0.5)

    def test_every_place_already_on_the_map_is_in_scope(self):
        # If this fails, the filter would start rejecting places the map
        # already carries, and the weekly run would propose removing them.
        food = json.loads((fb.ROOT / "data" / "local-landmarks-food.geojson").read_text())
        for feature in food["features"]:
            lon, lat = feature["geometry"]["coordinates"]
            recorded = (feature["properties"] or {}).get("distanceToForestBoundaryMetres")
            if recorded is not None and recorded > fb.MAX_DISTANCE_FROM_BOUNDARY_METRES:
                continue  # grandfathered in by an older, looser run
            self.assertTrue(
                fb.within_walk(lon, lat, self.index),
                f"{(feature['properties'] or {}).get('name')} is on the map but reads as out of scope",
            )

    def test_somewhere_well_outside_is_rejected(self):
        # Leytonstone High Road: inside the search box, nowhere near the forest.
        self.assertFalse(fb.within_walk(0.0075, 51.5683, self.index))


if __name__ == "__main__":
    unittest.main()
