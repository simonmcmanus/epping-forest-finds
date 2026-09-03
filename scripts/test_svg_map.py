#!/usr/bin/env python3
"""
Unit tests for scripts/report/svg_map.py.

Run with:  python3 scripts/test_svg_map.py
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report import svg_map  # noqa: E402
from scripts.report.categories import CATEGORY_STYLES  # noqa: E402
from scripts.report.geo import MapProjection  # noqa: E402

SQUARE_GEOJSON = {
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

TINY_SLIVER_GEOJSON = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            # A sub-pixel sliver at this map's scale -- should be dropped.
            "coordinates": [[
                [0.0500000, 51.6300000], [0.0500001, 51.6300000],
                [0.0500001, 51.6300001], [0.0500000, 51.6300000],
            ]],
        },
        "properties": {},
    }],
}


class BuildForestPathTests(unittest.TestCase):
    def setUp(self):
        self.proj = MapProjection()

    def test_square_becomes_closed_path(self):
        d = svg_map.build_forest_path(SQUARE_GEOJSON, self.proj, simplify_tolerance=0)
        self.assertTrue(d.startswith("M "))
        self.assertTrue(d.rstrip().endswith("Z"))
        self.assertEqual(d.count("L"), 4)  # 5 points, first repeated as last -> 4 L segments

    def test_tiny_sliver_is_dropped(self):
        d = svg_map.build_forest_path(TINY_SLIVER_GEOJSON, self.proj)
        self.assertEqual(d, "")

    def test_empty_geojson_produces_empty_path(self):
        d = svg_map.build_forest_path({"features": []}, self.proj)
        self.assertEqual(d, "")


class BuildSearchAreaPathTests(unittest.TestCase):
    def test_produces_closed_four_point_rectangle(self):
        proj = MapProjection()
        d = svg_map.build_search_area_path(proj)
        self.assertTrue(d.startswith("M "))
        self.assertTrue(d.rstrip().endswith("Z"))
        self.assertEqual(d.count("L"), 3)


class BuildTownsMarkupTests(unittest.TestCase):
    def test_every_town_gets_a_dot_and_label(self):
        proj = MapProjection()
        towns = [{"name": "Testville", "lat": 51.62, "lon": 0.05}]
        markup = svg_map.build_towns_markup(proj, towns=towns)
        self.assertIn('class="town-dot"', markup)
        self.assertIn("Testville", markup)

    def test_escapes_town_names(self):
        proj = MapProjection()
        towns = [{"name": "A & B", "lat": 51.62, "lon": 0.05}]
        markup = svg_map.build_towns_markup(proj, towns=towns)
        self.assertIn("A &amp; B", markup)
        self.assertNotIn("A & B<", markup)


class BuildPinsMarkupTests(unittest.TestCase):
    def setUp(self):
        self.proj = MapProjection()

    def test_every_category_has_a_defined_style(self):
        for category in CATEGORY_STYLES:
            findings = [{"number": 1, "lon": 0.05, "lat": 51.62, "category": category, "title": "Test"}]
            markup = svg_map.build_pins_markup(findings, self.proj)
            expected_var = CATEGORY_STYLES[category]["css_var"]
            self.assertIn(f"fill:var({expected_var})", markup)

    def test_finding_without_coordinates_is_skipped(self):
        findings = [{"number": 1, "category": "opening", "title": "No location"}]
        markup = svg_map.build_pins_markup(findings, self.proj)
        self.assertEqual(markup, "")

    def test_pin_number_appears_in_markup(self):
        findings = [{"number": 7, "lon": 0.05, "lat": 51.62, "category": "event", "title": "Test event"}]
        markup = svg_map.build_pins_markup(findings, self.proj)
        self.assertIn(">7<", markup)

    def test_title_is_escaped(self):
        findings = [{"number": 1, "lon": 0.05, "lat": 51.62, "category": "event", "title": "Fish & Chips"}]
        markup = svg_map.build_pins_markup(findings, self.proj)
        self.assertIn("Fish &amp; Chips", markup)


class RenderMapSvgTests(unittest.TestCase):
    def test_end_to_end_smoke(self):
        findings = [
            {"number": 1, "lon": 0.0537, "lat": 51.6421, "category": "opening", "title": "New cafe"},
            {"number": 2, "lon": 0.0247, "lat": 51.6580, "category": "grazing", "title": "Cattle near High Beach"},
        ]
        svg = svg_map.render_map_svg(SQUARE_GEOJSON, findings)
        self.assertTrue(svg.startswith("<svg"))
        self.assertTrue(svg.rstrip().endswith("</svg>"))
        self.assertIn('viewBox="0 480', svg.replace("viewBox=\"0 0 480", "viewBox=\"0 480"))  # sanity: width is 480
        self.assertIn("class=\"search-area\"", svg)
        self.assertIn("class=\"forest-fill\"", svg)

    def test_svg_has_no_unescaped_ampersands_outside_entities(self):
        findings = [{"number": 1, "lon": 0.0537, "lat": 51.6421, "category": "event", "title": "R&D open day"}]
        svg = svg_map.render_map_svg(SQUARE_GEOJSON, findings)
        # Every literal "&" must start a valid entity reference.
        for m in re.finditer(r"&(?!amp;|lt;|gt;|quot;|#)", svg):
            self.fail(f"Unescaped & at position {m.start()}")


if __name__ == "__main__":
    unittest.main()
