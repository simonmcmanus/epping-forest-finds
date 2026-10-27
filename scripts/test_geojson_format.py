import json
import unittest

from geojson_format import dumps_feature_lines


COLLECTION = {
    "type": "FeatureCollection",
    "name": "Épping test",
    "features": [
        {"type": "Feature", "id": "way/1", "geometry": {"type": "Point", "coordinates": [0.0123456, 51.6543210]}, "properties": {"name": "Oak"}},
        {"type": "Feature", "id": "way/2", "geometry": {"type": "LineString", "coordinates": [[0, 51], [0.1, 51.1]]}, "properties": {}},
    ],
}


class FeatureLinesTest(unittest.TestCase):
    def test_reads_back_as_the_same_collection(self):
        self.assertEqual(json.loads(dumps_feature_lines(COLLECTION)), COLLECTION)

    def test_each_feature_is_on_its_own_line_so_a_diff_stays_per_feature(self):
        lines = dumps_feature_lines(COLLECTION).splitlines()
        self.assertEqual(len(lines), 2 + len(COLLECTION["features"]))
        self.assertEqual(json.loads(lines[1].rstrip(",")), COLLECTION["features"][0])

    def test_is_much_smaller_than_pretty_printed_json(self):
        self.assertLess(len(dumps_feature_lines(COLLECTION)), len(json.dumps(COLLECTION, indent=2)) * 0.7)

    def test_an_empty_collection_is_still_valid(self):
        self.assertEqual(json.loads(dumps_feature_lines({"type": "FeatureCollection", "features": []})), {"type": "FeatureCollection", "features": []})


if __name__ == "__main__":
    unittest.main()
