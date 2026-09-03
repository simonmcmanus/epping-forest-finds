#!/usr/bin/env python3
"""
Unit tests for scripts/report/geo.py.

Run with:  python3 scripts/test_geo.py
       or (as part of the whole suite): python3 -m unittest discover -s scripts -p 'test_*.py'
"""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report import geo  # noqa: E402


class MercatorTests(unittest.TestCase):
    def test_equator_has_zero_y(self):
        x, y = geo.mercator_xy(0.0, 0.0)
        self.assertEqual(x, 0.0)
        self.assertAlmostEqual(y, 0.0, places=9)

    def test_longitude_passes_through_unchanged(self):
        x, _ = geo.mercator_xy(1.2345, 51.6)
        self.assertEqual(x, 1.2345)

    def test_north_is_more_negative_than_south(self):
        _, y_north = geo.mercator_xy(0.0, 51.9)
        _, y_south = geo.mercator_xy(0.0, 51.5)
        self.assertLess(y_north, y_south)


class MapProjectionTests(unittest.TestCase):
    def setUp(self):
        self.proj = geo.MapProjection(width=480)

    def test_north_projects_above_south(self):
        _, y_north = self.proj.project(0.05, geo.SEARCH_BBOX["north"])
        _, y_south = self.proj.project(0.05, geo.SEARCH_BBOX["south"])
        self.assertLess(y_north, y_south)

    def test_west_projects_left_of_east(self):
        x_west, _ = self.proj.project(geo.SEARCH_BBOX["west"], 51.6)
        x_east, _ = self.proj.project(geo.SEARCH_BBOX["east"], 51.6)
        self.assertLess(x_west, x_east)

    def test_width_matches_configured_value(self):
        self.assertEqual(self.proj.width, 480)

    def test_search_area_is_inset_from_svg_edges(self):
        corners = self.proj.search_area_corners()
        xs = [c[0] for c in corners]
        ys = [c[1] for c in corners]
        # Padded bbox means the search-area rectangle never touches the
        # viewBox edges (0 or width/height).
        self.assertGreater(min(xs), 0)
        self.assertLess(max(xs), self.proj.width)
        self.assertGreater(min(ys), 0)
        self.assertLess(max(ys), self.proj.height)

    def test_search_area_is_a_closed_rectangle(self):
        corners = self.proj.search_area_corners()
        self.assertEqual(len(corners), 4)
        xs = sorted({c[0] for c in corners})
        ys = sorted({c[1] for c in corners})
        self.assertEqual(len(xs), 2)
        self.assertEqual(len(ys), 2)

    def test_custom_bbox_is_respected(self):
        small_bbox = {"south": 51.60, "west": 0.0, "north": 51.62, "east": 0.02}
        proj = geo.MapProjection(bbox=small_bbox, width=200)
        x, y = proj.project(0.01, 51.61)
        self.assertTrue(0 <= x <= 200)
        self.assertTrue(0 <= y <= proj.height)


class SimplifyPointsTests(unittest.TestCase):
    def test_collinear_points_collapse(self):
        points = [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)]
        simplified = geo.simplify_points(points, tolerance=0.5)
        self.assertEqual(simplified, [(0, 0), (4, 0)])

    def test_far_off_line_point_survives(self):
        points = [(0, 0), (2, 10), (4, 0)]
        simplified = geo.simplify_points(points, tolerance=0.5)
        self.assertIn((2, 10), simplified)

    def test_short_input_is_returned_unchanged(self):
        points = [(0, 0), (1, 1)]
        self.assertEqual(geo.simplify_points(points, tolerance=5), points)


class HaversineAndNearestPlaceTests(unittest.TestCase):
    def test_haversine_known_short_distance(self):
        # Roughly 1 degree of longitude at ~51.6N is about 69.4km.
        dist = geo.haversine_metres(0.0, 51.6, 1.0, 51.6)
        self.assertAlmostEqual(dist, 69400, delta=2000)

    def test_haversine_zero_for_same_point(self):
        self.assertEqual(geo.haversine_metres(0.05, 51.6, 0.05, 51.6), 0.0)

    def test_nearest_place_picks_the_closest(self):
        places = [
            {"name": "Far", "lon": 1.0, "lat": 52.0},
            {"name": "Near", "lon": 0.051, "lat": 51.601},
            {"name": "Mid", "lon": 0.2, "lat": 51.8},
        ]
        place, dist = geo.nearest_place(0.05, 51.6, places)
        self.assertEqual(place["name"], "Near")
        self.assertGreater(dist, 0)


if __name__ == "__main__":
    unittest.main()
