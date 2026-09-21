#!/usr/bin/env python3
"""Unit tests for scripts/data_quality.py. Run: python3 scripts/test_data_quality.py"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import data_quality as dq  # noqa: E402
from scripts import verification as v  # noqa: E402


def feature(osm_id, name="A Place", address=None, website=None):
    return {
        "id": f"node/{osm_id}",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [0.05, 51.65]},
        "properties": {
            "id": f"node/{osm_id}", "osmType": "node", "osmId": osm_id,
            "name": name, "address": address, "website": website,
        },
    }


class StandInData:
    """A stand-in checkout so the measurements are not read from the real
    datasets, which change under the weekly run."""

    def __init__(self, features, generated="2026-05-20T00:00:00Z"):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "data").mkdir()
        (root / "data" / "local-landmarks-food.geojson").write_text(json.dumps({
            "type": "FeatureCollection", "generatedAt": generated, "features": features,
        }))
        self.root = root

    def __enter__(self):
        return self.root

    def __exit__(self, *exc):
        self.tmp.cleanup()


class MeasureTests(unittest.TestCase):
    def test_a_dataset_nothing_has_checked_reads_as_entirely_unconfirmed(self):
        # The true state of most of this map when this was written.
        with StandInData([feature(1), feature(2)]) as root:
            result = dq.measure(root, today="2026-09-21")
        self.assertEqual(result["totals"]["total"], 2)
        self.assertEqual(result["totals"]["neverConfirmed"], 2)
        self.assertEqual(result["totals"]["fresh"], 0)

    def test_confirmed_places_are_counted_as_fresh(self):
        with StandInData([feature(1), feature(2)]) as root:
            record = v.record_confirmations(v.empty(), ["node/1"], "osm", "2026-09-20")
            v.save(record, root / "data" / "verification.json")
            result = dq.measure(root, today="2026-09-21")
        self.assertEqual(result["totals"]["fresh"], 1)
        self.assertEqual(result["totals"]["neverConfirmed"], 1)

    def test_field_coverage_is_counted(self):
        with StandInData([feature(1, address="1 High Road"), feature(2)]) as root:
            result = dq.measure(root, today="2026-09-21")
        self.assertEqual(result["totals"]["address"], 1)
        self.assertEqual(result["totals"]["website"], 0)

    def test_the_date_the_dataset_was_made_is_reported(self):
        with StandInData([feature(1)]) as root:
            result = dq.measure(root, today="2026-09-21")
        self.assertEqual(result["datasets"][0]["generatedAt"], "2026-05-20")

    def test_a_place_with_no_id_at_all_is_flagged(self):
        # It cannot be confirmed, matched or removed by anything automated.
        nameless = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0.05, 51.65]},
                    "properties": {"name": "Manual Entry"}}
        with StandInData([feature(1), nameless]) as root:
            result = dq.measure(root, today="2026-09-21")
        self.assertEqual(result["datasets"][0]["withoutKey"], 1)

    def test_a_missing_dataset_is_skipped_rather_than_failing(self):
        with StandInData([feature(1)]) as root:
            result = dq.measure(root, today="2026-09-21")
        self.assertEqual(len(result["datasets"]), 1)


class RenderTests(unittest.TestCase):
    def test_the_report_names_datasets_no_source_has_ever_checked(self):
        with StandInData([feature(1)]) as root:
            text = dq.render(dq.measure(root, today="2026-09-21"))
        self.assertIn("only as good as the day they were made", text)
        self.assertIn("local-landmarks-food.geojson", text)

    def test_the_movement_since_the_last_check_is_shown(self):
        with StandInData([feature(1), feature(2)]) as root:
            before = dq.measure(root, today="2026-09-21")
        with StandInData([feature(1), feature(2), feature(3)]) as root:
            after = dq.measure(root, today="2026-09-28")
        self.assertIn("places +1", dq.render(after, before))

    def test_a_quiet_week_says_so_rather_than_showing_nothing(self):
        with StandInData([feature(1)]) as root:
            result = dq.measure(root, today="2026-09-21")
        self.assertIn("no change", dq.render(result, result))


if __name__ == "__main__":
    unittest.main()
