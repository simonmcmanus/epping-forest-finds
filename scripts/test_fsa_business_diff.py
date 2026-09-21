#!/usr/bin/env python3
"""Unit tests for scripts/fsa_business_diff.py. Run: python3 scripts/test_fsa_business_diff.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import fsa_business_diff as fsa  # noqa: E402


def establishment(**overrides):
    base = {
        "FHRSID": 1,
        "BusinessName": "Chapter 21",
        "BusinessType": "Restaurant/Cafe/Canteen",
        "AddressLine1": "206 High Road",
        "AddressLine2": "Loughton",
        "PostCode": "IG10 1DZ",
        "LocalAuthorityName": "Epping Forest",
        "RatingDate": "2026-04-28T00:00:00",
        "geocode": {"longitude": "0.0565", "latitude": "51.6486"},
    }
    base.update(overrides)
    return base


class NormalizeTests(unittest.TestCase):
    def test_a_registered_food_business_keeps_its_address_and_position(self):
        out = fsa.normalize_establishments([establishment()])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["name"], "Chapter 21")
        self.assertEqual(out[0]["category"], "restaurant")
        self.assertEqual(out[0]["address"], "206 High Road, Loughton, IG10 1DZ")
        self.assertAlmostEqual(out[0]["lon"], 0.0565)
        self.assertAlmostEqual(out[0]["lat"], 51.6486)

    def test_kinds_of_business_a_walker_cannot_visit_are_left_out(self):
        for business_type in ("School/college/university", "Hospitals/Childcare/Caring Premises",
                              "Manufacturers/packers", "Distributors/Transporters"):
            self.assertEqual(
                fsa.normalize_establishments([establishment(BusinessType=business_type)]), [],
                f"{business_type} should not be mapped",
            )

    def test_a_business_with_no_position_is_dropped_rather_than_guessed_at(self):
        self.assertEqual(fsa.normalize_establishments([establishment(geocode=None)]), [])
        self.assertEqual(fsa.normalize_establishments([establishment(geocode={})]), [])

    def test_a_business_outside_the_search_area_is_dropped(self):
        far = establishment(geocode={"longitude": "-1.5", "latitude": "53.8"})
        self.assertEqual(fsa.normalize_establishments([far]), [])

    def test_a_business_in_the_register_but_far_from_the_forest_is_dropped(self):
        # The register covers whole councils. The first run to reach it found
        # 2,949 of 3,204 "new", nearly all of them miles from any tree --
        # which would have buried the week's real findings on the watchlist.
        leytonstone = establishment(geocode={"longitude": "0.0075", "latitude": "51.5683"})
        self.assertEqual(fsa.normalize_establishments([leytonstone]), [])

    def test_a_business_beside_the_forest_is_kept(self):
        self.assertEqual(len(fsa.normalize_establishments([establishment()])), 1)

    def test_a_business_with_no_name_is_dropped(self):
        self.assertEqual(fsa.normalize_establishments([establishment(BusinessName="  ")]), [])


class CleaningTests(unittest.TestCase):
    """What the register holds is not always what belongs on a map. These are
    the four failure modes a real sample of 679 candidates showed."""

    def test_a_registered_company_name_becomes_the_name_over_the_door(self):
        self.assertEqual(fsa.clean_name("Lidl Great Britain Limited"), "Lidl")
        self.assertEqual(fsa.clean_name("Costa Coffee Ltd."), "Costa Coffee")
        self.assertEqual(fsa.clean_name("Greggs PLC"), "Greggs")

    def test_an_ordinary_name_is_left_alone(self):
        for name in ("The Bell Inn", "Woodstock Foods", "Zest Salad & Juice Bar", "M&S Simply Food"):
            self.assertEqual(fsa.clean_name(name), name)

    def test_a_name_that_is_only_a_suffix_is_kept_rather_than_emptied(self):
        self.assertEqual(fsa.clean_name("Ltd"), "Ltd")

    def test_a_concession_inside_another_shop_is_not_a_second_pin(self):
        # "Sushi Gourmet, J Sainsbury PLC, Old Station Road" -- real, and the
        # map already has the Sainsbury's.
        self.assertTrue(fsa.is_concession({
            "BusinessName": "Sushi Gourmet",
            "AddressLine1": "J Sainsbury PLC", "AddressLine2": "Old Station Road",
        }))

    def test_the_host_shop_itself_is_not_treated_as_its_own_concession(self):
        self.assertFalse(fsa.is_concession({
            "BusinessName": "Sainsburys",
            "AddressLine1": "J Sainsbury PLC", "AddressLine2": "Old Station Road",
        }))

    def test_a_members_club_is_not_a_pub(self):
        # A cricket club with a bar is not somewhere a walker drops in.
        self.assertTrue(fsa.is_members_club({"BusinessName": "Loughton Cricket Club"}))
        self.assertFalse(fsa.is_members_club({"BusinessName": "The Cricketers"}))

    def test_neither_reaches_the_candidate_list(self):
        concession = establishment(BusinessName="Sushi Gourmet", AddressLine1="J Sainsbury PLC")
        club = establishment(BusinessName="Loughton Cricket Club")
        self.assertEqual(fsa.normalize_establishments([concession, club]), [])


class CategoryTests(unittest.TestCase):
    def test_the_registers_business_types_map_onto_the_maps_categories(self):
        cases = {
            "Restaurant/Cafe/Canteen": "restaurant",
            "Pub/bar/nightclub": "pub",
            "Takeaway/sandwich shop": "restaurant",
            "Retailers - supermarkets/hypermarkets": "supermarket",
            "Retailers - other": "convenience",
            "Bakers": "bakery",
        }
        for business_type, expected in cases.items():
            self.assertEqual(fsa.category_for({"BusinessType": business_type}), expected, business_type)

    def test_an_unfamiliar_type_falls_back_rather_than_failing(self):
        self.assertEqual(fsa.category_for({"BusinessType": "Something new"}), fsa.DEFAULT_CATEGORY)


class AmbiguousCategoryTests(unittest.TestCase):
    """The register's one catch-all type covers restaurants, cafes and
    canteens alike -- 283 of one real sample of 679 arrived under it. The name
    usually knows better."""

    def category(self, name):
        return fsa.category_for({"BusinessType": "Restaurant/Cafe/Canteen", "BusinessName": name})

    def test_a_coffee_shop_is_read_as_a_cafe(self):
        for name in ("Costa Coffee", "The Tea Room", "Bean Cafe", "Espresso Bar"):
            self.assertEqual(self.category(name), "cafe", name)

    def test_a_kitchen_or_a_grill_is_read_as_a_restaurant(self):
        for name in ("Dickens Grill", "Nonna Pizzeria", "Loughton Kitchen", "Spice Village"):
            self.assertEqual(self.category(name), "restaurant", name)

    def test_a_wine_bar_is_read_as_a_bar(self):
        self.assertEqual(self.category("The Wine Bar"), "bar")

    def test_a_juice_bar_is_not_a_drinking_bar(self):
        # "Zest Salad & Juice Bar" is real, and is not somewhere to drink.
        for name in ("Zest Salad & Juice Bar", "Fresh Juice Bar", "Sushi Bar"):
            self.assertNotEqual(self.category(name), "bar", name)

    def test_a_name_that_says_nothing_falls_back(self):
        self.assertEqual(self.category("Marco's"), fsa.DEFAULT_CATEGORY)

    def test_a_type_the_register_is_sure_about_is_not_second_guessed(self):
        # Only the catch-all type gets this treatment.
        self.assertEqual(
            fsa.category_for({"BusinessType": "Pub/bar/nightclub", "BusinessName": "The Coffee House"}),
            "pub",
        )


class DiffTests(unittest.TestCase):
    def dataset(self, features):
        return {"type": "FeatureCollection", "features": features}

    def test_a_registered_business_missing_from_the_map_is_a_candidate(self):
        # The case that prompted this source: trading, registered with the
        # council, and nowhere on the map because nobody had mapped it.
        establishments = fsa.normalize_establishments([establishment()])
        result = fsa.diff_establishments(establishments, self.dataset([]))
        self.assertEqual([c["name"] for c in result["new_candidates"]], ["Chapter 21"])

    def test_a_business_already_on_the_map_is_not_a_candidate(self):
        establishments = fsa.normalize_establishments([establishment()])
        dataset = self.dataset([{
            "geometry": {"type": "Point", "coordinates": [0.0565, 51.6486]},
            "properties": {"name": "Chapter 21"},
        }])
        self.assertEqual(fsa.diff_establishments(establishments, dataset)["new_candidates"], [])

    def test_a_registered_name_that_differs_from_the_sign_is_not_a_duplicate(self):
        # The register holds the name a business registered under. Treating
        # that as a different business would add a second pin every week.
        establishments = fsa.normalize_establishments([establishment(BusinessName="The Bell Public House")])
        dataset = self.dataset([{
            "geometry": {"type": "Point", "coordinates": [0.0565, 51.6486]},
            "properties": {"name": "The Bell"},
        }])
        self.assertEqual(fsa.diff_establishments(establishments, dataset)["new_candidates"], [])

    def test_the_same_name_across_town_does_not_suppress_a_new_branch(self):
        establishments = fsa.normalize_establishments([establishment(BusinessName="Costa")])
        dataset = self.dataset([{
            "geometry": {"type": "Point", "coordinates": [0.112, 51.700]},
            "properties": {"name": "Costa"},
        }])
        self.assertEqual(len(fsa.diff_establishments(establishments, dataset)["new_candidates"]), 1)


class ObservationTests(unittest.TestCase):
    def test_findings_are_recorded_as_openings_only(self):
        # This source never proposes a removal: "not in the register" is far
        # more often a naming difference than a closure, and that mistake
        # would repeat every week and so clear any patience threshold.
        result = fsa.diff_establishments(fsa.normalize_establishments([establishment()]), {"features": []})
        observations = fsa.observations_from_diff(result)
        self.assertEqual([o["signal"] for o in observations], ["new"])
        self.assertEqual(observations[0]["key"], "fsa/1")
        self.assertEqual(observations[0]["source"], "fsa")


if __name__ == "__main__":
    unittest.main()
