#!/usr/bin/env python3
"""Unit tests for scripts/report/text_utils.py. Run: python3 scripts/test_text_utils.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report.text_utils import oxford_comma_join, pluralize_label  # noqa: E402


class PluralizeLabelTests(unittest.TestCase):
    def test_known_food_categories(self):
        cases = {
            "Pub": "Pubs",
            "Bar": "Bars",
            "Café": "Cafés",
            "Tea Hut": "Tea Huts",
            "Restaurant": "Restaurants",
            "Convenience Store": "Convenience Stores",
            "Supermarket": "Supermarkets",
            "Grocery Store": "Grocery Stores",
            "General Store": "General Stores",
            "Greengrocer": "Greengrocers",
            "Butcher": "Butchers",
            "Bakery": "Bakeries",
            "Deli": "Delis",
            "Farm Shop": "Farm Shops",
            "Pastry Shop": "Pastry Shops",
            "Kiosk": "Kiosks",
            "Confectionery": "Confectioneries",
        }
        for singular, expected in cases.items():
            self.assertEqual(pluralize_label(singular), expected, singular)


class OxfordCommaJoinTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(oxford_comma_join([]), "")

    def test_one(self):
        self.assertEqual(oxford_comma_join(["a"]), "a")

    def test_two(self):
        self.assertEqual(oxford_comma_join(["a", "b"]), "a and b")

    def test_three_plus(self):
        self.assertEqual(oxford_comma_join(["a", "b", "c"]), "a, b, and c")


if __name__ == "__main__":
    unittest.main()
