#!/usr/bin/env python3
"""Unit tests for scripts/cow_boundary_tracker.py. Run: python3 scripts/test_cow_boundary_tracker.py"""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from scripts import cow_boundary_tracker as cbt  # noqa: E402

PASTURE_A = {"id": 1, "geometry": {"type": "Polygon", "coordinates": [[
    [0.020, 51.640], [0.024, 51.640], [0.024, 51.644], [0.020, 51.644], [0.020, 51.640],
]]}}
PASTURE_B = {"id": 2, "geometry": {"type": "Polygon", "coordinates": [[
    [0.100, 51.690], [0.104, 51.690], [0.104, 51.694], [0.100, 51.694], [0.100, 51.690],
]]}}


class DefaultCowCenterMatchesAppTests(unittest.TestCase):
    def test_matches_index_html_default_cow_center(self):
        index_html = (ROOT / "index.html").read_text()
        m = re.search(
            r"DEFAULT_COW_CENTER\s*=\s*\{\s*longitude:\s*([-\d.]+)\s*,\s*latitude:\s*([-\d.]+)\s*\}",
            index_html,
        )
        self.assertIsNotNone(m, "Could not find DEFAULT_COW_CENTER in index.html -- update the regex or the script")
        self.assertAlmostEqual(float(m.group(1)), cbt.DEFAULT_COW_CENTER["longitude"], places=9)
        self.assertAlmostEqual(float(m.group(2)), cbt.DEFAULT_COW_CENTER["latitude"], places=9)


class ExtractPasturesTests(unittest.TestCase):
    def test_extracts_polygon_ring(self):
        payload = {"pastures": [PASTURE_A]}
        pastures = cbt.extract_pastures(payload)
        self.assertEqual(len(pastures), 1)
        self.assertEqual(pastures[0]["id"], 1)
        self.assertEqual(len(pastures[0]["ring"]), 5)

    def test_ignores_pastures_without_geometry(self):
        payload = {"pastures": [{"id": 1, "geometry": None}]}
        self.assertEqual(cbt.extract_pastures(payload), [])

    def test_empty_payload(self):
        self.assertEqual(cbt.extract_pastures({}), [])


class CombinedCentroidTests(unittest.TestCase):
    def test_averages_all_vertices(self):
        pastures = cbt.extract_pastures({"pastures": [PASTURE_A]})
        centroid = cbt.combined_centroid(pastures)
        self.assertAlmostEqual(centroid[0], 0.022, places=3)
        self.assertAlmostEqual(centroid[1], 51.642, places=3)

    def test_none_for_no_pastures(self):
        self.assertIsNone(cbt.combined_centroid([]))


class DetectChangeTests(unittest.TestCase):
    def test_first_run_is_never_moved(self):
        pastures = cbt.extract_pastures({"pastures": [PASTURE_A]})
        change = cbt.detect_change(None, pastures)
        self.assertTrue(change["first_run"])
        self.assertFalse(change["moved"])
        self.assertIsNotNone(change["centroid"])

    def test_same_pasture_id_and_position_is_not_moved(self):
        pastures = cbt.extract_pastures({"pastures": [PASTURE_A]})
        centroid = cbt.combined_centroid(pastures)
        previous = {"pastureIds": [1], "centroid": list(centroid)}
        change = cbt.detect_change(previous, pastures)
        self.assertFalse(change["moved"])
        self.assertFalse(change["first_run"])

    def test_different_pasture_id_is_moved(self):
        pastures = cbt.extract_pastures({"pastures": [PASTURE_B]})
        previous = {"pastureIds": [1], "centroid": [0.022, 51.642]}
        change = cbt.detect_change(previous, pastures)
        self.assertTrue(change["moved"])

    def test_large_position_shift_with_same_id_is_moved(self):
        # Same id, but the pasture has clearly been redrawn somewhere else --
        # the distance fallback should still catch this.
        pastures = cbt.extract_pastures({"pastures": [{"id": 1, "geometry": PASTURE_B["geometry"]}]})
        previous = {"pastureIds": [1], "centroid": [0.022, 51.642]}
        change = cbt.detect_change(previous, pastures)
        self.assertTrue(change["moved"])
        self.assertGreater(change["distance_from_previous_m"], cbt.MOVE_DISTANCE_THRESHOLD_M)

    def test_tiny_shift_within_threshold_is_not_moved(self):
        pastures = cbt.extract_pastures({"pastures": [PASTURE_A]})
        centroid = cbt.combined_centroid(pastures)
        # Nudge the previous centroid by ~10m, well under the threshold.
        previous = {"pastureIds": [1], "centroid": [centroid[0] + 0.0001, centroid[1]]}
        change = cbt.detect_change(previous, pastures)
        self.assertFalse(change["moved"])


class DescribeLocationTests(unittest.TestCase):
    PLACES = [{"name": "Loughton", "lat": 51.6421, "lon": 0.0537}]

    def test_no_centroid_gives_empty_description(self):
        name, sentence = cbt.describe_location(None, self.PLACES)
        self.assertIsNone(name)
        self.assertEqual(sentence, "")

    def test_names_nearest_place(self):
        name, sentence = cbt.describe_location((0.0540, 51.6425), self.PLACES)
        self.assertEqual(name, "Loughton")
        self.assertIn("Loughton", sentence)

    def test_distance_phrase_buckets(self):
        self.assertEqual(cbt._distance_phrase(100), "right by")
        self.assertEqual(cbt._distance_phrase(1000), "close to")
        self.assertEqual(cbt._distance_phrase(2000), "not far from")
        self.assertIn("km from", cbt._distance_phrase(8000))


class BuildGrazingReportDataTests(unittest.TestCase):
    PLACES = [{"name": "High Beach", "lat": 51.6580, "lon": 0.0247}]

    def test_moved_shape(self):
        change = {"moved": True, "first_run": False, "centroid": (0.0247, 51.6580), "distance_from_previous_m": 900}
        grazing = cbt.build_grazing_report_data(change, self.PLACES)
        self.assertTrue(grazing["moved"])
        self.assertEqual(grazing["place"], "High Beach")
        self.assertIn("moved", grazing["body"])
        self.assertEqual(grazing["lon"], 0.0247)

    def test_unmoved_shape(self):
        change = {"moved": False, "first_run": False, "centroid": (0.0247, 51.6580), "distance_from_previous_m": 10}
        grazing = cbt.build_grazing_report_data(change, self.PLACES)
        self.assertFalse(grazing["moved"])
        self.assertIn("haven't moved", grazing["body"])

    def test_first_run_shape_never_claims_moved(self):
        change = {"moved": False, "first_run": True, "centroid": (0.0247, 51.6580), "distance_from_previous_m": None}
        grazing = cbt.build_grazing_report_data(change, self.PLACES)
        self.assertFalse(grazing["moved"])


class SnapshotRoundTripTests(unittest.TestCase):
    def test_save_then_load(self):
        pastures = cbt.extract_pastures({"pastures": [PASTURE_A]})
        centroid = cbt.combined_centroid(pastures)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cow-grazing-history.json"
            cbt.save_snapshot(path, pastures, centroid)
            loaded = cbt.load_snapshot(path)
            self.assertEqual(loaded["pastureIds"], [1])
            self.assertAlmostEqual(loaded["centroid"][0], centroid[0])

    def test_load_missing_file_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(cbt.load_snapshot(Path(tmp) / "nope.json"))


if __name__ == "__main__":
    unittest.main()
