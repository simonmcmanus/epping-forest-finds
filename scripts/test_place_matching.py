#!/usr/bin/env python3
"""Unit tests for scripts/place_matching.py. Run: python3 scripts/test_place_matching.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import place_matching as pm  # noqa: E402


def feature(name, lon=None, lat=None):
    out = {"properties": {"name": name}}
    if lon is not None:
        out["geometry"] = {"type": "Point", "coordinates": [lon, lat]}
    return out


class NameKeyTests(unittest.TestCase):
    def test_punctuation_and_case_do_not_matter(self):
        self.assertEqual(pm.name_key("Green's Steakhouse"), pm.name_key("GREENS STEAKHOUSE"))

    def test_words_describing_the_trade_are_ignored(self):
        self.assertEqual(pm.name_key("The Bell Public House"), pm.name_key("Bell"))

    def test_a_name_made_only_of_those_words_is_still_a_name(self):
        self.assertEqual(pm.name_key("The Bar"), "the bar")

    def test_different_businesses_do_not_collide(self):
        self.assertNotEqual(pm.name_key("Organico"), pm.name_key("Chapter 21"))


class CompactNameTests(unittest.TestCase):
    """name_key() splits on whitespace, so a space is meaningful to it. These
    are the near-misses that survive it -- both real, both from one weekly
    run."""

    def test_spacing_does_not_matter(self):
        self.assertEqual(pm.compact_name("CHAPTER 21"), pm.compact_name("Chapter21"))

    def test_an_ampersand_reads_as_the_word(self):
        self.assertEqual(pm.compact_name("Bobo & Wild"), pm.compact_name("Bobo and Wild"))
        self.assertEqual(pm.compact_name("Avenue Food And Wine"), pm.compact_name("Avenue Food & Wine"))

    def test_different_businesses_do_not_collide(self):
        self.assertNotEqual(pm.compact_name("Organico"), pm.compact_name("Chapter 21"))

    def test_a_name_that_is_not_one_has_no_key(self):
        self.assertEqual(pm.compact_name(None), "")
        self.assertEqual(pm.compact_name("  "), "")


class NamesLookLikeOnePlaceTests(unittest.TestCase):
    def test_a_name_described_differently_is_one_place(self):
        self.assertTrue(pm.names_look_like_one_place("The Bell Public House", "The Bell"))

    def test_a_name_typed_differently_is_one_place(self):
        self.assertTrue(pm.names_look_like_one_place("CHAPTER 21", "Chapter21"))
        self.assertTrue(pm.names_look_like_one_place("Bobo & Wild", "Bobo and Wild"))

    def test_two_different_businesses_are_not(self):
        self.assertFalse(pm.names_look_like_one_place("The Bell", "The Crown"))

    def test_a_missing_name_matches_nothing(self):
        # Otherwise every unnamed feature would look like every other one.
        self.assertFalse(pm.names_look_like_one_place(None, None))
        self.assertFalse(pm.names_look_like_one_place("", "The Bell"))


class SamePremisesTests(unittest.TestCase):
    """Asked before adding: have we got this already? Answered on both name
    keys, and only within a short walk."""

    def test_a_name_typed_differently_nearby_is_already_on_the_map(self):
        # Real: "CHAPTER 21" arrived 24 metres from the mapped "Chapter21"
        # and only a person spotted it.
        record = {"name": "CHAPTER 21", "lon": 0.05, "lat": 51.65}
        self.assertTrue(pm.same_premises(record, feature("Chapter21", 0.0502, 51.65)))

    def test_a_name_described_differently_nearby_is_already_on_the_map(self):
        record = {"name": "The Bell Public House", "lon": 0.05, "lat": 51.65}
        self.assertTrue(pm.same_premises(record, feature("The Bell", 0.0501, 51.6501)))

    def test_the_same_name_across_town_is_a_new_branch_and_addable(self):
        # The other half of the same bug: a global name check kept a genuinely
        # new branch of a chain off the map forever.
        record = {"name": "Costa", "lon": 0.05, "lat": 51.65}
        self.assertFalse(pm.same_premises(record, feature("Costa", 0.12, 51.70)))

    def test_a_different_business_next_door_is_not_the_same_premises(self):
        record = {"name": "Chapter 21", "lon": 0.05, "lat": 51.65}
        self.assertFalse(pm.same_premises(record, feature("Wildwood", 0.05, 51.65)))

    def test_without_coordinates_the_name_has_to_carry_it(self):
        self.assertTrue(pm.same_premises({"name": "Bobo & Wild"}, feature("Bobo and Wild")))


class SamePlaceTests(unittest.TestCase):
    def test_the_same_name_a_few_metres_apart_is_the_same_place(self):
        record = {"name": "The Bell", "lon": 0.05, "lat": 51.65}
        self.assertTrue(pm.same_place(record, feature("The Bell", 0.0501, 51.6501)))

    def test_the_same_name_in_the_next_town_is_a_different_place(self):
        # The old check matched on name alone, anywhere in the area, so a new
        # branch of a chain was treated as one the map already had and never
        # got added.
        record = {"name": "Costa", "lon": 0.05, "lat": 51.65}
        self.assertFalse(pm.same_place(record, feature("Costa", 0.12, 51.70)))

    def test_a_record_without_coordinates_falls_back_to_the_name(self):
        self.assertTrue(pm.same_place({"name": "Manual Cafe"}, feature("Manual Cafe")))

    def test_a_different_name_is_never_the_same_place(self):
        record = {"name": "Chapter 21", "lon": 0.05, "lat": 51.65}
        self.assertFalse(pm.same_place(record, feature("Wildwood", 0.05, 51.65)))

    def test_fuzzy_matching_forgives_a_registered_name(self):
        record = {"name": "The Bell Public House", "lon": 0.05, "lat": 51.65}
        self.assertFalse(pm.same_place(record, feature("The Bell", 0.05, 51.65)))
        self.assertTrue(pm.same_place(record, feature("The Bell", 0.05, 51.65), fuzzy=True))

    def test_fuzzy_matching_still_respects_distance(self):
        record = {"name": "The Bell Public House", "lon": 0.05, "lat": 51.65}
        self.assertFalse(pm.same_place(record, feature("The Bell", 0.12, 51.70), fuzzy=True))


class GeometryTests(unittest.TestCase):
    def test_distance_is_about_right(self):
        # One thousandth of a degree of latitude is roughly 111 metres.
        self.assertAlmostEqual(pm.metres_between((0.05, 51.65), (0.05, 51.651)), 111, delta=2)

    def test_a_feature_without_point_geometry_has_no_position(self):
        self.assertIsNone(pm.feature_lonlat({"geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}}))
        self.assertIsNone(pm.feature_lonlat({}))

    def test_the_search_area_excludes_what_is_outside_it(self):
        bbox = {"south": 51.545, "west": -0.035, "north": 51.745, "east": 0.145}
        self.assertTrue(pm.within_bbox(0.05, 51.65, bbox))
        self.assertFalse(pm.within_bbox(0.5, 51.65, bbox))
        self.assertFalse(pm.within_bbox(None, 51.65, bbox))


if __name__ == "__main__":
    unittest.main()
