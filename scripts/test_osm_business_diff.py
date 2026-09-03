#!/usr/bin/env python3
"""Unit tests for scripts/osm_business_diff.py. Run: python3 scripts/test_osm_business_diff.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import osm_business_diff as obd  # noqa: E402


class BuildOverpassQueryTests(unittest.TestCase):
    def test_query_includes_bbox_and_categories(self):
        bbox = {"south": 51.5, "west": -0.1, "north": 51.8, "east": 0.2}
        query = obd.build_overpass_query(bbox)
        self.assertIn("51.5,-0.1,51.8,0.2", query)
        self.assertIn("pub", query)
        self.assertIn("butcher", query)
        self.assertIn("out center tags;", query)


class NormalizeOverpassElementsTests(unittest.TestCase):
    def test_skips_elements_without_name(self):
        elements = [{"type": "node", "id": 1, "lat": 51.6, "lon": 0.05, "tags": {"amenity": "pub"}}]
        self.assertEqual(obd.normalize_overpass_elements(elements), [])

    def test_skips_elements_without_recognized_category(self):
        elements = [{"type": "node", "id": 1, "lat": 51.6, "lon": 0.05, "tags": {"name": "X", "amenity": "hospital"}}]
        self.assertEqual(obd.normalize_overpass_elements(elements), [])

    def test_uses_center_for_ways(self):
        elements = [{
            "type": "way", "id": 42, "center": {"lat": 51.6, "lon": 0.05},
            "tags": {"name": "The Bell", "amenity": "pub"},
        }]
        out = obd.normalize_overpass_elements(elements)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["lat"], 51.6)
        self.assertEqual(out[0]["category"], "pub")

    def test_builds_address_from_tags(self):
        elements = [{
            "type": "node", "id": 1, "lat": 51.6, "lon": 0.05,
            "tags": {
                "name": "The Bell", "shop": "butcher",
                "addr:housenumber": "3", "addr:street": "High Street",
                "addr:city": "Loughton", "addr:postcode": "IG10 1AA",
            },
        }]
        out = obd.normalize_overpass_elements(elements)
        self.assertEqual(out[0]["address"], "3 High Street Loughton IG10 1AA")


class DiffPoisTests(unittest.TestCase):
    def make_dataset(self, features):
        return {"type": "FeatureCollection", "features": features}

    def test_new_poi_not_in_dataset_by_id_or_name(self):
        osm = [{"osmType": "node", "osmId": 999, "name": "Brand New Cafe", "category": "cafe", "lon": 0.05, "lat": 51.6}]
        dataset = self.make_dataset([])
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(len(result["new_candidates"]), 1)
        self.assertEqual(result["missing_candidates"], [])

    def test_poi_matched_by_osm_id_is_not_new(self):
        osm = [{"osmType": "node", "osmId": 100, "name": "The Bell", "category": "pub", "lon": 0.05, "lat": 51.6}]
        dataset = self.make_dataset([{
            "properties": {"osmType": "node", "osmId": 100, "name": "The Bell", "category": "pub"},
        }])
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(result["new_candidates"], [])

    def test_poi_matched_by_name_when_no_id_recorded(self):
        # A manually-added dataset entry with no osmType/osmId, but the same
        # name -- should not be flagged as "new" just because it lacks an id.
        osm = [{"osmType": "node", "osmId": 555, "name": "Manual Cafe", "category": "cafe", "lon": 0.05, "lat": 51.6}]
        dataset = self.make_dataset([{"properties": {"name": "Manual Cafe", "category": "cafe"}}])
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(result["new_candidates"], [])

    def test_name_match_is_case_insensitive(self):
        osm = [{"osmType": "node", "osmId": 1, "name": "the bell", "category": "pub", "lon": 0.05, "lat": 51.6}]
        dataset = self.make_dataset([{"properties": {"name": "The Bell", "category": "pub"}}])
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(result["new_candidates"], [])

    def test_dataset_entry_missing_from_fresh_osm_is_flagged(self):
        osm = []
        dataset = self.make_dataset([{
            "properties": {"osmType": "node", "osmId": 100, "name": "Closed Cafe", "category": "cafe"},
        }])
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(len(result["missing_candidates"]), 1)
        self.assertEqual(result["missing_candidates"][0]["name"], "Closed Cafe")

    def test_manual_dataset_entries_are_never_flagged_as_missing(self):
        # No osmType/osmId recorded -- there's no reliable way to check
        # these against OSM, so diff_pois must leave them alone.
        osm = []
        dataset = self.make_dataset([{"properties": {"name": "Manual Only", "category": "cafe"}}])
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(result["missing_candidates"], [])

    def test_dataset_entry_still_present_in_osm_is_not_flagged(self):
        osm = [{"osmType": "node", "osmId": 100, "name": "Still Open", "category": "cafe", "lon": 0.05, "lat": 51.6}]
        dataset = self.make_dataset([{
            "properties": {"osmType": "node", "osmId": 100, "name": "Still Open", "category": "cafe"},
        }])
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(result["missing_candidates"], [])


if __name__ == "__main__":
    unittest.main()
