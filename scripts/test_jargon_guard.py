#!/usr/bin/env python3
"""Unit tests for scripts/report/jargon_guard.py. Run: python3 scripts/test_jargon_guard.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report.jargon_guard import assert_reader_friendly, find_jargon, strip_html_tags  # noqa: E402


class StripHtmlTagsTests(unittest.TestCase):
    def test_removes_tags_keeps_text(self):
        self.assertEqual(strip_html_tags("<p>Hello <b>world</b></p>"), "Hello world")

    def test_ignores_style_and_script_contents(self):
        html = "<style>.x{color:red}</style><p>Visible</p><script>var x=1;</script>"
        self.assertEqual(strip_html_tags(html), "Visible")

    def test_does_not_scan_attribute_values(self):
        # A URL path segment inside an href should not itself be scanned as
        # visible text (it isn't -- strip_html_tags drops all tags,
        # attributes included).
        html = '<a href="https://example.com/node/foo">Read more</a>'
        self.assertNotIn("node/", strip_html_tags(html))


class FindJargonTests(unittest.TestCase):
    def test_flags_raw_osm_ids(self):
        hits = find_jargon("We removed way/450058980 from the map.")
        self.assertTrue(any("way/450058980" == h[0] for h in hits))

    def test_flags_file_paths(self):
        hits = find_jargon("Edited data/local-landmarks-food.geojson directly.")
        self.assertTrue(hits)

    def test_flags_git_talk(self):
        hits = find_jargon("Prepared on a new git branch and opened a pull request.")
        self.assertTrue(hits)

    def test_plain_english_has_no_hits(self):
        text = (
            "The Hair of the Dog has opened on York Hill in Loughton. "
            "Zizzi in Loughton has closed. Cross-checked against OpenStreetMap."
        )
        self.assertEqual(find_jargon(text), [])

    def test_mentioning_openstreetmap_is_not_flagged(self):
        hits = find_jargon("This week's businesses were checked against OpenStreetMap.")
        self.assertEqual(hits, [])


class AssertReaderFriendlyTests(unittest.TestCase):
    def test_raises_on_jargon(self):
        with self.assertRaises(ValueError):
            assert_reader_friendly("<p>Removed way/123 from data/local-landmarks-food.geojson.</p>")

    def test_passes_on_clean_html(self):
        assert_reader_friendly("<p>The Hair of the Dog has opened in Loughton.</p>")


if __name__ == "__main__":
    unittest.main()
