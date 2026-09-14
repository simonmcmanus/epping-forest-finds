#!/usr/bin/env python3
"""
Unit tests for scripts/report/render_report.py.

Run with:  python3 scripts/test_render_report.py
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report import render_report as rr  # noqa: E402

TINY_FOREST_GEOJSON = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [0.02, 51.60], [0.06, 51.60], [0.06, 51.64], [0.02, 51.64], [0.02, 51.60],
            ]],
        },
        "properties": {},
    }],
}


def make_food_geojson(entries):
    """entries: list of (categoryLabel) strings, one feature per entry."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [0.05, 51.62]},
                "properties": {"categoryLabel": label},
            }
            for label in entries
        ],
    }


def make_repo_root(tmp_path, food_entries):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "epping-forest-land.geojson").write_text(json.dumps(TINY_FOREST_GEOJSON))
    (data_dir / "local-landmarks-food.geojson").write_text(json.dumps(make_food_geojson(food_entries)))
    return tmp_path


BASE_REPORT_DATA = {
    "date": "2026-09-03",
    "date_display": "Wednesday, 3 September 2026",
    "findings": [
        {
            "category": "opening",
            "title": "The Hair of the Dog",
            "place": "Loughton",
            "status_label": "New",
            "body": "A new pub has opened.",
            "lon": 0.0537,
            "lat": 51.6421,
            "sources": [{"label": "Tripadvisor", "url": "https://example.com/a"}],
        },
        {
            "category": "closing",
            "title": "Zizzi",
            "place": "Loughton",
            "status_label": "Closed",
            "body": "This branch has closed.",
            "lon": 0.0530,
            "lat": 51.6415,
            "sources": [],
        },
        {
            "category": "road",
            "title": "Bakers Lane",
            "place": "Epping",
            "status_label": "Closing soon",
            "body": "Closing for resurfacing.",
            "lon": 0.06,
            "lat": 51.63,
            "sources": [],
        },
        {
            "category": "event",
            "title": "Skylark Event",
            "place": "Wanstead Flats",
            "status_label": "Sat",
            "body": "A free event.",
            "lon": 0.03,
            "lat": 51.61,
            "sources": [],
        },
    ],
}


class ComputeFoodStatsTests(unittest.TestCase):
    def test_counts_by_label(self):
        geojson = make_food_geojson(["Pub", "Pub", "Café"])
        stats = rr.compute_food_stats(geojson)
        self.assertEqual(stats["total"], 3)
        self.assertIn(("Pub", 2), stats["by_label"])
        self.assertIn(("Café", 1), stats["by_label"])

    def test_empty_geojson(self):
        stats = rr.compute_food_stats({"features": []})
        self.assertEqual(stats["total"], 0)
        self.assertEqual(stats["by_label"], [])


class FoodStatsSentenceTests(unittest.TestCase):
    def test_singular_count_uses_singular_label(self):
        stats = {"total": 1, "by_label": [("Farm Shop", 1)]}
        sentence = rr.food_stats_sentence(stats)
        self.assertIn("1 farm shop", sentence)
        self.assertNotIn("1 farm shops", sentence)

    def test_plural_count_uses_plural_label(self):
        stats = {"total": 3, "by_label": [("Pub", 3)]}
        sentence = rr.food_stats_sentence(stats)
        self.assertIn("3 pubs", sentence)

    def test_empty_stats_gives_empty_sentence(self):
        self.assertEqual(rr.food_stats_sentence({"total": 0, "by_label": []}), "")


class NormalizeFindingsTests(unittest.TestCase):
    def test_numbers_assigned_sequentially(self):
        findings, grazing = rr.normalize_findings(BASE_REPORT_DATA)
        self.assertEqual([f["number"] for f in findings], list(range(1, len(findings) + 1)))

    def test_businesses_ordered_before_road_and_events(self):
        findings, _ = rr.normalize_findings(BASE_REPORT_DATA)
        categories_in_order = [f["category"] for f in findings]
        self.assertLess(categories_in_order.index("opening"), categories_in_order.index("road"))
        self.assertLess(categories_in_order.index("road"), categories_in_order.index("event"))

    def test_grazing_added_only_when_moved_with_coords(self):
        data = dict(BASE_REPORT_DATA)
        data["grazing"] = {"moved": True, "lon": 0.05, "lat": 51.62, "place": "High Beach", "body": "Moved."}
        findings, grazing_finding = rr.normalize_findings(data)
        self.assertIsNotNone(grazing_finding)
        self.assertEqual(findings[-1]["category"], "grazing")

    def test_grazing_not_added_when_unmoved(self):
        data = dict(BASE_REPORT_DATA)
        data["grazing"] = {"moved": False, "lon": 0.05, "lat": 51.62, "place": "High Beach", "body": "Same spot."}
        findings, grazing_finding = rr.normalize_findings(data)
        self.assertIsNone(grazing_finding)
        self.assertNotIn("grazing", [f["category"] for f in findings])

    def test_grazing_not_added_when_missing_coords(self):
        data = dict(BASE_REPORT_DATA)
        data["grazing"] = {"moved": True, "place": "High Beach", "body": "Moved but no pin."}
        findings, grazing_finding = rr.normalize_findings(data)
        self.assertIsNone(grazing_finding)


class RenderStatStripTests(unittest.TestCase):
    def test_no_grazing_uses_five_columns(self):
        findings, _ = rr.normalize_findings(BASE_REPORT_DATA)
        html = rr.render_stat_strip(findings, 100, None)
        self.assertNotIn("cols-6", html)

    def test_grazing_uses_six_columns(self):
        findings, _ = rr.normalize_findings(BASE_REPORT_DATA)
        html = rr.render_stat_strip(findings, 100, {"moved": True})
        self.assertIn("cols-6", html)


SAMPLE_INVENTORY = {
    "generatedAt": "2026-09-14",
    "total": 1130,
    "groups": [
        {
            "key": "food",
            "label": "Food",
            "count": 30,
            "subfilters": [
                {"key": "pubs", "label": "Pubs & bars", "count": 10},
                {"key": "cafes", "label": "Cafés", "count": 20},
            ],
        },
        {
            "key": "nature",
            "label": "Nature",
            "count": 1000,
            "subfilters": [{"key": "trees", "label": "Trees", "count": 1000}],
        },
    ],
    "alwaysShown": {"label": "Gates, benches & other facilities", "count": 100},
}


class RenderInventorySectionTests(unittest.TestCase):
    def test_shows_the_whole_map_total_not_just_one_dataset(self):
        html = rr.render_inventory_section(SAMPLE_INVENTORY)
        self.assertIn("1,130", html)
        self.assertIn("things you can find on the map today", html)

    def test_breaks_the_total_down_by_the_apps_own_filter_groups(self):
        html = rr.render_inventory_section(SAMPLE_INVENTORY)
        for label in ("Food", "Nature", "Pubs &amp; bars", "Cafés", "Trees"):
            self.assertIn(label, html)

    def test_counts_the_always_shown_features_that_have_no_filter(self):
        html = rr.render_inventory_section(SAMPLE_INVENTORY)
        self.assertIn("Gates, benches &amp; other facilities", html)
        self.assertIn("100", html)

    def test_says_the_cattle_are_tracked_live_rather_than_counted(self):
        html = rr.render_inventory_section(SAMPLE_INVENTORY)
        self.assertIn("tracked live", html)

    def test_omitted_entirely_when_no_inventory_is_available(self):
        self.assertEqual(rr.render_inventory_section(None), "")
        self.assertEqual(rr.render_inventory_section({"total": 0, "groups": []}), "")


class StatStripLabellingTests(unittest.TestCase):
    def test_food_count_is_labelled_as_food_not_as_the_whole_map(self):
        """The old "Places on the map" label read as a total for everything
        the app draws, when it only ever counted the food/drink/shop data."""
        findings, _ = rr.normalize_findings(BASE_REPORT_DATA)
        html = rr.render_stat_strip(findings, 689, None)
        self.assertIn("Places to eat, drink &amp; shop", html)
        self.assertNotIn("Places on the map", html)


class RenderReportEndToEndTests(unittest.TestCase):
    def test_smoke_renders_valid_looking_html(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo_root(Path(tmp), ["Pub", "Café", "Café"])
            html = rr.render_report(BASE_REPORT_DATA, root)
            self.assertTrue(html.strip().startswith("<!doctype html>"))
            self.assertIn("<svg", html)
            self.assertIn("epping-forest.netlify.app", html)
            self.assertIn("The Hair of the Dog", html)

    def test_jargon_in_finding_body_blocks_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo_root(Path(tmp), ["Pub"])
            data = json.loads(json.dumps(BASE_REPORT_DATA))  # deep copy
            data["findings"][0]["body"] = "Removed way/450058980 from data/local-landmarks-food.geojson."
            with self.assertRaises(ValueError):
                rr.render_report(data, root)

    def test_write_report_creates_file_named_by_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo_root(Path(tmp), ["Pub"])
            path = rr.write_report(BASE_REPORT_DATA, root)
            self.assertTrue(path.exists())
            self.assertEqual(path.name, "epping-forest-ledger-2026-09-03.html")


if __name__ == "__main__":
    unittest.main()
