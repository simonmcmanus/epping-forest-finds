#!/usr/bin/env python3
"""Unit tests for scripts/find_duplicates.py. Run: python3 scripts/test_find_duplicates.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import find_duplicates as fd  # noqa: E402


def place(name, lon=0.05, lat=51.65, category="cafe", feature_id=None, address=None):
    return {
        "id": feature_id or f"node/{abs(hash(name)) % 100000}",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {"name": name, "category": category, "address": address},
    }


class FindTests(unittest.TestCase):
    def find(self, features, radius=fd.DUPLICATE_RADIUS_M):
        return fd.find_duplicates({"food.geojson": features}, radius)

    def test_the_same_name_on_the_same_corner_is_a_candidate(self):
        pairs = self.find([place("The Bell", 0.05, 51.65), place("The Bell", 0.0501, 51.6501)])
        self.assertEqual(len(pairs), 1)

    def test_a_name_differing_only_by_trade_words_still_matches(self):
        # Pairs like this predate the check in apply_weekly_changeset.py,
        # which only ever compared exact lowercased names, so the ones already
        # in the datasets are the ones spelled slightly differently.
        pairs = self.find([place("The Bell", 0.05, 51.65), place("Bell Inn", 0.0501, 51.6501)])
        self.assertEqual(len(pairs), 1)

    def test_a_name_typed_differently_still_matches(self):
        # The pair this sweep missed until it bucketed under both keys:
        # name_key() splits on whitespace, so "chapter 21" and "chapter21"
        # are two different keys and the pair was never measured.
        pairs = self.find([place("CHAPTER 21", 0.05, 51.65), place("Chapter21", 0.0502, 51.65)])
        self.assertEqual(len(pairs), 1)

    def test_an_ampersand_written_out_still_matches(self):
        pairs = self.find([place("Bobo & Wild", 0.05, 51.65), place("Bobo and Wild", 0.0501, 51.6501)])
        self.assertEqual(len(pairs), 1)

    def test_a_pair_matching_on_both_keys_is_reported_once(self):
        # It lands in two buckets; it is still one duplicate.
        pairs = self.find([
            place("The Bell", 0.05, 51.65, feature_id="node/1"),
            place("The Bell", 0.0501, 51.6501, feature_id="node/2"),
        ])
        self.assertEqual(len(pairs), 1)

    def test_two_branches_of_a_chain_apart_are_not_duplicates(self):
        pairs = self.find([place("Costa", 0.05, 51.65), place("Costa", 0.112, 51.700)])
        self.assertEqual(pairs, [])

    def test_different_places_side_by_side_are_not_duplicates(self):
        pairs = self.find([place("The Bell", 0.05, 51.65), place("The Crown", 0.0501, 51.6501)])
        self.assertEqual(pairs, [])

    def test_a_duplicate_across_two_datasets_is_found(self):
        pairs = fd.find_duplicates({
            "food.geojson": [place("Stone Mini Market", 0.05, 51.65)],
            "misc.geojson": [place("Stone Mini Market", 0.0500, 51.6500, category="alcohol")],
        })
        self.assertEqual(len(pairs), 1)
        self.assertEqual({p["dataset"] for p in pairs[0]["places"]}, {"food.geojson", "misc.geojson"})

    def test_the_closest_pairs_come_first(self):
        pairs = self.find([
            place("The Bell", 0.05, 51.65),
            place("The Bell", 0.0503, 51.65),
            place("The Crown", 0.05, 51.65),
            place("The Crown", 0.05001, 51.65),
        ])
        self.assertEqual(len(pairs), 2)
        self.assertLess(pairs[0]["metresApart"], pairs[1]["metresApart"])

    def test_a_place_with_no_name_is_skipped(self):
        pairs = self.find([place(None, 0.05, 51.65), place(None, 0.05, 51.65)])
        self.assertEqual(pairs, [])

    def test_a_place_with_no_position_cannot_be_measured(self):
        nowhere = {"id": "manual/x", "properties": {"name": "The Bell"}}
        pairs = self.find([place("The Bell", 0.05, 51.65), nowhere])
        self.assertEqual(pairs, [])

    def test_the_report_carries_enough_to_decide_with(self):
        pairs = self.find([
            place("The Bell", 0.05, 51.65, feature_id="node/1", address="1 High Road"),
            place("Bell Inn", 0.0501, 51.6501, feature_id="node/2", address="1a High Road"),
        ])
        text = fd.render(pairs)
        for expected in ("node/1", "node/2", "1 High Road", "1a High Road"):
            self.assertIn(expected, text)

    def test_a_clean_sweep_says_so(self):
        self.assertIn("No likely duplicates", fd.render([]))

    def test_nothing_is_ever_removed(self):
        # This reports only: two different shops can share a name and a
        # corner, so the call belongs to a person.
        features = [place("The Bell", 0.05, 51.65), place("The Bell", 0.0501, 51.6501)]
        before = len(features)
        self.find(features)
        self.assertEqual(len(features), before)


if __name__ == "__main__":
    unittest.main()
