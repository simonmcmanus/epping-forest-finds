#!/usr/bin/env python3
"""
Unit tests for scripts/report/render_report.py.

Run with:  python3 scripts/test_render_report.py
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report import render_report as rr  # noqa: E402

REAL_COW_ICON = Path(__file__).resolve().parent.parent / "data" / "icons" / "cow.png"

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


class EventsSectionTests(unittest.TestCase):
    """A reader shouldn't have to guess whether a quiet week means "nothing
    on" or "nobody looked"."""

    def test_events_section_still_appears_when_there_are_no_events(self):
        findings, _ = rr.normalize_findings({"findings": []})
        html = rr.render_category_section("event", "event", findings)
        self.assertIn("Events in the forest", html)
        self.assertIn("No events listed this week", html)

    def test_road_section_still_appears_when_there_are_no_closures(self):
        findings, _ = rr.normalize_findings({"findings": []})
        html = rr.render_category_section("road", "road", findings)
        self.assertIn("Road closures &amp; access", html)
        self.assertIn("No closures to report this week", html)

    def test_events_section_lists_the_events_when_there_are_some(self):
        findings, _ = rr.normalize_findings(BASE_REPORT_DATA)
        html = rr.render_category_section("event", "event", findings)
        self.assertIn("Skylark Event", html)
        self.assertNotIn("No events listed this week", html)


class CowIconTests(unittest.TestCase):
    """Cattle are shown with the app's own cow icon, not a numbered dot."""

    GRAZING = {
        "category": "grazing",
        "title": "Where the cattle are grazing",
        "place": "High Beach",
        "number": 5,
        "lon": 0.0247,
        "lat": 51.6580,
    }

    ICON = "data:image/png;base64,AAAA"

    def test_map_pin_for_cattle_uses_the_cow_icon(self):
        svg = rr.svg_map.build_pins_markup(
            [self.GRAZING], rr.svg_map.MapProjection(), cow_icon_url=self.ICON
        )
        self.assertIn(self.ICON, svg)
        self.assertIn("cow-pin-body", svg)
        self.assertNotIn("pin-num", svg)

    def test_other_findings_keep_their_numbered_dot(self):
        finding = {"category": "opening", "title": "A pub", "number": 1, "lon": 0.05, "lat": 51.62}
        svg = rr.svg_map.build_pins_markup(
            [finding], rr.svg_map.MapProjection(), cow_icon_url=self.ICON
        )
        self.assertIn("pin-num", svg)
        self.assertNotIn(self.ICON, svg)

    def test_legend_shows_a_cow_for_the_cattle_category(self):
        html = rr.render_map_legend()
        self.assertIn("cow-marker", html)
        self.assertIn("Cattle grazing", html)

    def test_list_beside_the_map_shows_a_cow_for_the_cattle_entry(self):
        html = rr.render_map_side_list([self.GRAZING])
        self.assertIn("cow-marker", html)
        self.assertNotIn(">5<", html)

    def test_the_icon_travels_with_the_page_rather_than_being_linked(self):
        """A report is read with no signal, saved and emailed on -- a linked
        image is a broken-image box in all three."""
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo_root(Path(tmp), ["Pub"])
            icons = root / "data" / "icons"
            icons.mkdir(parents=True, exist_ok=True)
            shutil.copy(REAL_COW_ICON, icons / "cow.png")
            data = json.loads(json.dumps(BASE_REPORT_DATA))
            data["grazing"] = {"moved": True, "lon": 0.05, "lat": 51.62,
                               "place": "High Beach", "body": "Moved."}
            html = rr.render_report(data, root)
            self.assertIn("--cow-icon:url(\"data:image/png;base64,", html)
            self.assertNotIn("/data/icons/cow.png", html)

    def test_falls_back_to_the_icons_address_when_it_cannot_be_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(rr.cow_icon_uri(Path(tmp)), rr.COW_ICON_FALLBACK_URL)


class AppPromoTests(unittest.TestCase):
    def test_promo_sells_the_app_rather_than_just_linking_to_it(self):
        html = rr.render_app_promo("https://www.eppingforestfinds.uk/app", {"total": 1130})
        self.assertIn("Works with no signal", html)
        self.assertIn("1,130", html)
        self.assertIn('href="https://www.eppingforestfinds.uk/app"', html)

    def test_promo_copes_without_an_inventory_total(self):
        html = rr.render_app_promo("https://www.eppingforestfinds.uk/app", None)
        self.assertIn("Everything in this report is on it", html)

    def test_report_defaults_to_the_app_route(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo_root(Path(tmp), ["Pub"])
            html = rr.render_report(BASE_REPORT_DATA, root)
            self.assertIn('class="app-link" href="https://www.eppingforestfinds.uk/app"', html)

    def test_promo_sits_after_the_weeks_news_not_in_the_masthead(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo_root(Path(tmp), ["Pub"])
            html = rr.render_report(BASE_REPORT_DATA, root)
            self.assertLess(html.index('id="businesses"'), html.index('id="app"'))
            self.assertLess(html.index("</header>"), html.index('id="app"'))


class AiNoteTests(unittest.TestCase):
    def test_says_plainly_that_it_was_written_by_ai_and_may_be_wrong(self):
        html = rr.render_ai_note("https://www.eppingforestfinds.uk/app", "Monday, 15 September 2026")
        self.assertIn("automatically by AI", html)
        self.assertIn("can get things wrong", html)

    def test_links_into_the_apps_own_report_screen_naming_this_report(self):
        html = rr.render_ai_note("https://www.eppingforestfinds.uk/app", "Monday, 15 September 2026")
        self.assertIn("https://www.eppingforestfinds.uk/app#report=", html)
        self.assertIn("Monday%2C%2015%20September%202026", html)

    def test_is_the_last_thing_on_the_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo_root(Path(tmp), ["Pub"])
            html = rr.render_report(BASE_REPORT_DATA, root)
            self.assertLess(html.index('class="about-note"'), html.index('class="ai-note"'))


class SearchEngineTests(unittest.TestCase):
    """The report is a way for people to find the app, so each page has to be
    indexable and describe itself honestly -- without padding the page."""

    def render(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo_root(Path(tmp), ["Pub", "Café"])
            return rr.render_report(BASE_REPORT_DATA, root)

    def test_title_names_the_week(self):
        self.assertIn("<title>Epping Forest Ledger — Wednesday, 3 September 2026</title>", self.render())

    def test_has_a_description_built_from_this_weeks_findings(self):
        html = self.render()
        self.assertIn('<meta name="description"', html)
        self.assertIn("1 opening", html)

    def test_description_lists_no_changes_when_the_week_was_quiet(self):
        text = rr.meta_description({}, [], ["Loughton"], "Monday, 15 September 2026")
        self.assertIn("no changes of note", text)

    def test_has_a_canonical_address_on_the_official_domain(self):
        self.assertIn(
            '<link rel="canonical" href="https://www.eppingforestfinds.uk/reports/'
            'epping-forest-ledger-2026-09-03.html">',
            self.render(),
        )

    def test_is_open_to_search_engines(self):
        self.assertIn('content="index, follow', self.render())

    def test_has_link_preview_and_structured_data(self):
        html = self.render()
        self.assertIn('property="og:title"', html)
        self.assertIn('"@type": "NewsArticle"', html)


class RenderReportEndToEndTests(unittest.TestCase):
    def test_smoke_renders_valid_looking_html(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo_root(Path(tmp), ["Pub", "Café", "Café"])
            html = rr.render_report(BASE_REPORT_DATA, root)
            self.assertTrue(html.strip().startswith("<!doctype html>"))
            self.assertIn("<svg", html)
            self.assertIn("https://www.eppingforestfinds.uk", html)
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
