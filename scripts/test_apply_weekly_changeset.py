#!/usr/bin/env python3
"""
Unit tests for scripts/apply_weekly_changeset.py.

Run with:  python3 -m unittest scripts.test_apply_weekly_changeset -v
       or:  python3 scripts/test_apply_weekly_changeset.py
"""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_weekly_changeset as awc  # noqa: E402

# A simple 1km x 1km square boundary centred near Loughton, in plain lon/lat,
# small enough that distance-to-boundary is easy to reason about by hand.
SQUARE_BOUNDARY = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [0.050, 51.645], [0.065, 51.645], [0.065, 51.655],
                [0.050, 51.655], [0.050, 51.645],
            ]],
        },
        "properties": {},
    }],
}


def make_master(features=None):
    return {"type": "FeatureCollection", "features": features or []}


def make_existing_feature(name, lon=0.057, lat=51.650, category="pub"):
    return {
        "type": "Feature",
        "id": f"node/{abs(hash(name)) % 10**8}",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "id": f"node/{abs(hash(name)) % 10**8}", "osmType": "node",
            "osmId": abs(hash(name)) % 10**8, "name": name, "category": category,
            "categoryLabel": "Pub", "amenity": category, "shop": None,
            "distanceToForestBoundaryMetres": 100.0,
            "distanceLimitFromForestBoundaryMetres": 466.7,
        },
    }


class TestBuildFeature(unittest.TestCase):
    def setUp(self):
        self.segments, self.ref_lat_rad = awc.load_boundary_segments(SQUARE_BOUNDARY)

    def test_builds_expected_schema(self):
        entry = {"name": "The Hair of the Dog", "category": "pub", "lon": 0.057, "lat": 51.652}
        feature = awc.build_feature(entry, self.segments, self.ref_lat_rad)
        self.assertEqual(feature["type"], "Feature")
        self.assertEqual(feature["geometry"], {"type": "Point", "coordinates": [0.057, 51.652]})
        props = feature["properties"]
        self.assertEqual(set(props.keys()), set(awc.PROPERTY_KEYS))
        self.assertEqual(props["name"], "The Hair of the Dog")
        self.assertEqual(props["category"], "pub")
        self.assertEqual(props["amenity"], "pub")
        self.assertIsNone(props["shop"])
        self.assertEqual(props["categoryLabel"], "Pub")
        self.assertEqual(props["osmType"], "manual")
        self.assertIsNone(props["osmId"])
        self.assertEqual(props["id"], "manual/the-hair-of-the-dog")

    def test_shop_category_sets_shop_not_amenity(self):
        entry = {"name": "Test Bakery", "category": "bakery", "lon": 0.057, "lat": 51.652}
        feature = awc.build_feature(entry, self.segments, self.ref_lat_rad)
        self.assertEqual(feature["properties"]["shop"], "bakery")
        self.assertIsNone(feature["properties"]["amenity"])

    def test_unknown_category_rejected(self):
        entry = {"name": "Mystery Spot", "category": "haunted_house", "lon": 0.057, "lat": 51.652}
        with self.assertRaises(ValueError):
            awc.build_feature(entry, self.segments, self.ref_lat_rad)

    def test_distance_to_boundary_is_zero_on_the_line(self):
        # A point sitting exactly on the square's western edge.
        entry = {"name": "On The Line", "category": "cafe", "lon": 0.050, "lat": 51.650}
        feature = awc.build_feature(entry, self.segments, self.ref_lat_rad)
        self.assertAlmostEqual(feature["properties"]["distanceToForestBoundaryMetres"], 0.0, delta=1.0)

    def test_explicit_osm_ids_are_preserved(self):
        entry = {"name": "Known Pub", "category": "pub", "lon": 0.057, "lat": 51.652, "osmType": "node", "osmId": 999}
        feature = awc.build_feature(entry, self.segments, self.ref_lat_rad)
        self.assertEqual(feature["properties"]["osmType"], "node")
        self.assertEqual(feature["properties"]["osmId"], 999)
        self.assertEqual(feature["id"], "manual/known-pub")  # id is independent of osmId unless entry sets "id" too


class TestApplyChangeset(unittest.TestCase):
    def setUp(self):
        self.segments, self.ref_lat_rad = awc.load_boundary_segments(SQUARE_BOUNDARY)

    def test_add_appends_new_feature(self):
        master = make_master()
        changeset = {"add": [{"name": "The Hair of the Dog", "category": "pub", "lon": 0.057, "lat": 51.652}]}
        log = awc.apply_changeset(master, changeset, self.segments, self.ref_lat_rad)
        self.assertEqual(len(master["features"]), 1)
        self.assertEqual(len(log["added"]), 1)
        self.assertEqual(log["added"][0]["name"], "The Hair of the Dog")
        self.assertEqual(log["skipped"], [])

    def test_add_skips_case_insensitive_duplicate(self):
        master = make_master([make_existing_feature("The Hair Of The Dog")])
        changeset = {"add": [{"name": "the hair of the dog", "category": "pub", "lon": 0.057, "lat": 51.652}]}
        log = awc.apply_changeset(master, changeset, self.segments, self.ref_lat_rad)
        self.assertEqual(len(master["features"]), 1)  # unchanged
        self.assertEqual(log["added"], [])
        self.assertEqual(len(log["skipped"]), 1)
        self.assertIn("duplicate", log["skipped"][0]["reason"])

    def test_add_skips_point_far_outside_forest(self):
        master = make_master()
        # ~50km east - nowhere near the square boundary.
        changeset = {"add": [{"name": "Far Away Cafe", "category": "cafe", "lon": 0.75, "lat": 51.650}]}
        log = awc.apply_changeset(master, changeset, self.segments, self.ref_lat_rad)
        self.assertEqual(master["features"], [])
        self.assertEqual(len(log["skipped"]), 1)
        self.assertIn("forest boundary", log["skipped"][0]["reason"])

    def test_remove_by_name(self):
        master = make_master([make_existing_feature("Morrisons Cafe")])
        changeset = {"remove": [{"name": "Morrisons Cafe", "reason": "reported closed"}]}
        log = awc.apply_changeset(master, changeset, self.segments, self.ref_lat_rad)
        self.assertEqual(master["features"], [])
        self.assertEqual(len(log["removed"]), 1)

    def test_remove_by_id_takes_precedence_over_name(self):
        feature = make_existing_feature("Morrisons Cafe")
        master = make_master([feature])
        changeset = {"remove": [{"id": feature["id"], "reason": "reported closed"}]}
        log = awc.apply_changeset(master, changeset, self.segments, self.ref_lat_rad)
        self.assertEqual(master["features"], [])
        self.assertEqual(len(log["removed"]), 1)

    def test_remove_skips_when_no_match(self):
        master = make_master([make_existing_feature("Still Open Cafe")])
        changeset = {"remove": [{"name": "Nonexistent Cafe", "reason": "reported closed"}]}
        log = awc.apply_changeset(master, changeset, self.segments, self.ref_lat_rad)
        self.assertEqual(len(master["features"]), 1)  # unchanged
        self.assertEqual(log["removed"], [])
        self.assertEqual(len(log["skipped"]), 1)

    def test_does_not_mutate_input_changeset(self):
        master = make_master()
        changeset = {"add": [{"name": "The Hair of the Dog", "category": "pub", "lon": 0.057, "lat": 51.652}]}
        changeset_copy = copy.deepcopy(changeset)
        awc.apply_changeset(master, changeset, self.segments, self.ref_lat_rad)
        self.assertEqual(changeset, changeset_copy)


if __name__ == "__main__":
    unittest.main()
