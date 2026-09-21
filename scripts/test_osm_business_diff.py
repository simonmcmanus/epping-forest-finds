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


class ClosureTagTests(unittest.TestCase):
    """OpenStreetMap records a closure on the spot, with a disused:/was:/vacant
    tag. The first version of this check never asked for those, so the best
    evidence there is went unread and the only closure signal was silence."""

    def test_the_query_asks_for_closure_markers(self):
        query = obd.build_overpass_query({"south": 51.5, "west": -0.1, "north": 51.8, "east": 0.2})
        self.assertIn('"disused:amenity"', query)
        self.assertIn('"was:shop"', query)
        self.assertIn('"amenity"="vacant"', query)

    def test_a_closed_element_keeps_the_name_it_traded_under(self):
        elements = [{
            "type": "node", "id": 1, "lat": 51.6, "lon": 0.05,
            "tags": {"was:name": "Organico", "disused:amenity": "cafe"},
        }]
        out = obd.normalize_overpass_elements(elements)
        self.assertEqual(out[0]["name"], "Organico")
        self.assertEqual(out[0]["category"], "cafe")
        self.assertEqual(out[0]["status"], "closed")

    def test_a_trading_business_in_a_former_shop_is_not_read_as_closed(self):
        # Mappers leave the previous tenant's tags behind when a unit is
        # relet. Reading that as a closure would take a business that is open
        # today off the map, at the one confidence level that needs no
        # patience.
        elements = [{
            "type": "node", "id": 1, "lat": 51.6, "lon": 0.05,
            "tags": {"name": "Chapter 21", "amenity": "cafe", "disused:shop": "bakery"},
        }]
        out = obd.normalize_overpass_elements(elements)
        self.assertEqual(out[0]["status"], "open")
        self.assertEqual(out[0]["category"], "cafe")

    def test_a_vacant_unit_is_reported_even_with_no_trade_recorded(self):
        elements = [{
            "type": "node", "id": 1, "lat": 51.6, "lon": 0.05,
            "tags": {"name": "Unit 4", "shop": "vacant"},
        }]
        out = obd.normalize_overpass_elements(elements)
        self.assertEqual(out[0]["status"], "closed")
        self.assertIsNone(out[0]["category"])

    def test_a_point_marked_closed_is_a_closure_not_a_disappearance(self):
        osm = [{"osmType": "node", "osmId": 100, "name": "Organico", "category": "cafe",
                "status": "closed", "lon": 0.05, "lat": 51.6}]
        dataset = {"features": [{
            "id": "node/100",
            "properties": {"osmType": "node", "osmId": 100, "name": "Organico", "category": "cafe"},
        }]}
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(len(result["closed_candidates"]), 1)
        self.assertEqual(result["closed_candidates"][0]["id"], "node/100")
        self.assertEqual(result["missing_candidates"], [], "a stated closure must not also read as absence")

    def test_a_closed_element_we_never_had_is_nothing_to_do(self):
        osm = [{"osmType": "node", "osmId": 100, "name": "Long Gone", "category": "cafe",
                "status": "closed", "lon": 0.05, "lat": 51.6}]
        result = obd.diff_pois(osm, {"features": []})
        self.assertEqual(result["new_candidates"], [])
        self.assertEqual(result["closed_candidates"], [])


class ChangedHandsTests(unittest.TestCase):
    """The gap that let a restaurant sit on the map for two years after it
    closed: the unit changed hands, so the map element was edited in place.
    Nothing went missing and nothing was new."""

    def test_a_renamed_element_is_reported_as_having_changed_hands(self):
        osm = [{"osmType": "node", "osmId": 100, "name": "Chapter 21", "category": "cafe",
                "status": "open", "lon": 0.0564, "lat": 51.6484}]
        dataset = {"features": [{
            "id": "node/100",
            "geometry": {"type": "Point", "coordinates": [0.0564, 51.6484]},
            "properties": {"osmType": "node", "osmId": 100, "name": "Organico", "category": "cafe"},
        }]}
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(len(result["changed_candidates"]), 1)
        changed = result["changed_candidates"][0]
        self.assertEqual(changed["previousName"], "Organico")
        self.assertEqual(changed["name"], "Chapter 21")
        self.assertEqual(result["missing_candidates"], [])
        self.assertEqual(result["new_candidates"], [])

    def test_a_place_listed_under_a_different_type_is_reported(self):
        osm = [{"osmType": "node", "osmId": 100, "name": "The Bell", "category": "restaurant",
                "status": "open", "lon": 0.05, "lat": 51.6}]
        dataset = {"features": [{
            "id": "node/100",
            "properties": {"osmType": "node", "osmId": 100, "name": "The Bell", "category": "pub"},
        }]}
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(len(result["changed_candidates"]), 1)
        self.assertEqual(result["changed_candidates"][0]["previousCategory"], "pub")

    def test_an_unchanged_element_is_not_reported(self):
        osm = [{"osmType": "node", "osmId": 100, "name": "The Bell", "category": "pub",
                "status": "open", "lon": 0.05, "lat": 51.6}]
        dataset = {"features": [{
            "properties": {"osmType": "node", "osmId": 100, "name": "The Bell", "category": "pub"},
        }]}
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(result["changed_candidates"], [])


class ProximityTests(unittest.TestCase):
    def test_a_new_branch_of_a_chain_is_not_hidden_by_the_existing_one(self):
        # Name-only matching meant any name already on the map suppressed a
        # genuinely new place with that name, however far away it was.
        osm = [{"osmType": "node", "osmId": 999, "name": "Wimpy", "category": "restaurant",
                "status": "open", "lon": 0.056, "lat": 51.648}]
        dataset = {"features": [{
            "geometry": {"type": "Point", "coordinates": [0.112, 51.700]},
            "properties": {"osmType": "node", "osmId": 1, "name": "Wimpy", "category": "restaurant"},
        }]}
        result = obd.diff_pois(osm, dataset)
        self.assertEqual([c["name"] for c in result["new_candidates"]], ["Wimpy"])

    def test_the_same_shop_nudged_a_few_metres_is_not_a_new_one(self):
        osm = [{"osmType": "node", "osmId": 999, "name": "Wimpy", "category": "restaurant",
                "status": "open", "lon": 0.0561, "lat": 51.6481}]
        dataset = {"features": [{
            "geometry": {"type": "Point", "coordinates": [0.056, 51.648]},
            "properties": {"name": "Wimpy", "category": "restaurant"},
        }]}
        result = obd.diff_pois(osm, dataset)
        self.assertEqual(result["new_candidates"], [])


class VenueScopeTests(unittest.TestCase):
    """A village hall closing could not reach the map at all: only food and
    shops were ever asked about."""

    def test_the_query_covers_community_venues(self):
        query = obd.build_overpass_query({"south": 51.5, "west": -0.1, "north": 51.8, "east": 0.2})
        self.assertIn("community_centre", query)
        self.assertIn("public_hall", query)

    def test_a_hall_is_recognised_as_a_place(self):
        elements = [{
            "type": "way", "id": 7, "center": {"lat": 51.649, "lon": 0.055},
            "tags": {"name": "Lopping Hall", "amenity": "public_hall"},
        }]
        out = obd.normalize_overpass_elements(elements)
        self.assertEqual(out[0]["category"], "public_hall")

    def test_the_food_only_scope_leaves_venues_out(self):
        elements = [{
            "type": "way", "id": 7, "center": {"lat": 51.649, "lon": 0.055},
            "tags": {"name": "Lopping Hall", "amenity": "public_hall"},
        }]
        self.assertEqual(obd.normalize_overpass_elements(elements, scope="food"), [])


class ScopeTests(unittest.TestCase):
    """The Overpass box is 22km by 12km; the map keeps to eight minutes' walk
    of the forest. Without this filter every pub in Leytonstone is a candidate."""

    def poi(self, lon, lat):
        return [{"osmType": "node", "osmId": 1, "name": "New Cafe", "category": "cafe",
                 "status": "open", "lon": lon, "lat": lat}]

    def test_a_place_out_of_scope_is_not_proposed(self):
        result = obd.diff_pois(self.poi(0.0075, 51.5683), {"features": []},
                               in_scope=lambda lon, lat: False)
        self.assertEqual(result["new_candidates"], [])

    def test_a_place_in_scope_is_proposed(self):
        result = obd.diff_pois(self.poi(0.0565, 51.6486), {"features": []},
                               in_scope=lambda lon, lat: True)
        self.assertEqual(len(result["new_candidates"]), 1)

    def test_scope_never_affects_places_already_on_the_map(self):
        # They passed this test when they were added; re-judging them could
        # have the run propose removing places it put there itself.
        dataset = {"features": [{"id": "node/1", "properties": {
            "osmType": "node", "osmId": 1, "name": "Old Cafe", "category": "cafe"}}]}
        result = obd.diff_pois([], dataset, in_scope=lambda lon, lat: False)
        self.assertEqual(len(result["missing_candidates"]), 1)


class ObservationTests(unittest.TestCase):
    def test_every_candidate_list_becomes_a_watchlist_observation(self):
        diff = {
            "new_candidates": [{"osmType": "node", "osmId": 1, "name": "A"}],
            "missing_candidates": [{"osmType": "node", "osmId": 2, "name": "B"}],
            "closed_candidates": [{"osmType": "node", "osmId": 3, "name": "C"}],
            "changed_candidates": [{"osmType": "node", "osmId": 4, "name": "D"}],
        }
        observations = obd.observations_from_diff(diff)
        self.assertEqual(
            {o["key"]: o["signal"] for o in observations},
            {"node/1": "new", "node/2": "missing", "node/3": "closed", "node/4": "changed"},
        )


class PopulationGuardTests(unittest.TestCase):
    def test_a_first_run_has_nothing_to_compare_against(self):
        self.assertTrue(obd.population_is_plausible(500, None))

    def test_a_normal_week_of_drift_is_fine(self):
        self.assertTrue(obd.population_is_plausible(690, 700))

    def test_a_collapsed_result_is_treated_as_a_bad_query(self):
        # Half the places vanishing at once is an outage, not a high street
        # closing. Escalating on it would empty the map.
        self.assertFalse(obd.population_is_plausible(350, 700))


if __name__ == "__main__":
    unittest.main()
