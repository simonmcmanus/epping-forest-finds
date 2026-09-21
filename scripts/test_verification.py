#!/usr/bin/env python3
"""Unit tests for scripts/verification.py. Run: python3 scripts/test_verification.py"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import verification as v  # noqa: E402


class RecordTests(unittest.TestCase):
    def test_a_confirmation_records_its_source_and_date(self):
        record = v.record_confirmations(v.empty(), ["node/1"], "osm", "2026-09-21")
        self.assertEqual(record["confirmed"]["node/1"], "osm@2026-09-21")
        self.assertEqual(record["updatedAt"], "2026-09-21")

    def test_a_later_confirmation_wins(self):
        # Being seen this week is the freshest thing that can be said about a
        # place, whichever source saw it.
        record = v.record_confirmations(v.empty(), ["node/1"], "osm", "2026-09-01")
        v.record_confirmations(record, ["node/1"], "fsa", "2026-09-21")
        self.assertEqual(record["confirmed"]["node/1"], "fsa@2026-09-21")

    def test_empty_keys_are_ignored_rather_than_stored(self):
        record = v.record_confirmations(v.empty(), ["node/1", None, ""], "osm", "2026-09-21")
        self.assertEqual(list(record["confirmed"]), ["node/1"])


class AgeTests(unittest.TestCase):
    def setUp(self):
        self.record = v.record_confirmations(v.empty(), ["node/1"], "osm", "2026-09-01")

    def test_age_is_measured_in_days(self):
        self.assertEqual(v.days_since(self.record, "node/1", "2026-09-21"), 20)

    def test_a_place_never_confirmed_has_no_age(self):
        self.assertIsNone(v.days_since(self.record, "node/999", "2026-09-21"))

    def test_a_place_never_confirmed_counts_as_stale(self):
        # The honest reading: the map has no evidence it is still there. Most
        # of the datasets have had none since the day they were generated.
        self.assertTrue(v.is_stale(self.record, "node/999", "2026-09-21"))

    def test_a_recently_confirmed_place_is_not_stale(self):
        self.assertFalse(v.is_stale(self.record, "node/1", "2026-09-21"))

    def test_a_long_unconfirmed_place_is_stale(self):
        self.assertTrue(v.is_stale(self.record, "node/1", "2027-09-21"))

    def test_a_hand_mangled_entry_does_not_fail_the_run(self):
        record = v.empty()
        record["confirmed"]["node/2"] = "nonsense"
        self.assertIsNone(v.days_since(record, "node/2", "2026-09-21"))
        self.assertTrue(v.is_stale(record, "node/2", "2026-09-21"))


class SummaryTests(unittest.TestCase):
    def test_a_summary_counts_confirmed_and_never_confirmed(self):
        record = v.record_confirmations(v.empty(), ["node/1", "node/2"], "osm", "2026-09-21")
        summary = v.summarise(record, ["node/1", "node/2", "node/3"], "2026-09-21")
        self.assertEqual(summary["total"], 3)
        self.assertEqual(summary["confirmed"], 2)
        self.assertEqual(summary["neverConfirmed"], 1)
        self.assertEqual(summary["stale"], 1)
        self.assertEqual(summary["fresh"], 2)

    def test_a_dataset_nothing_has_ever_checked_reads_as_entirely_stale(self):
        # Which is the true state of most of this map's datasets: generated
        # once, never looked at again.
        summary = v.summarise(v.empty(), ["node/1", "node/2"], "2026-09-21")
        self.assertEqual(summary["stale"], 2)
        self.assertEqual(summary["confirmed"], 0)
        self.assertIsNone(summary["oldestConfirmationDays"])

    def test_the_oldest_confirmation_is_reported(self):
        record = v.record_confirmations(v.empty(), ["node/1"], "osm", "2026-08-01")
        v.record_confirmations(record, ["node/2"], "osm", "2026-09-21")
        summary = v.summarise(record, ["node/1", "node/2"], "2026-09-21")
        self.assertEqual(summary["oldestConfirmationDays"], 51)


class FileTests(unittest.TestCase):
    def test_a_record_survives_a_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "verification.json"
            record = v.record_confirmations(v.empty(), ["node/1"], "osm", "2026-09-21")
            v.save(record, path)
            self.assertEqual(v.load(path)["confirmed"], record["confirmed"])

    def test_a_missing_file_reads_as_nothing_confirmed(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(v.load(Path(tmp) / "nothing.json")["confirmed"], {})


if __name__ == "__main__":
    unittest.main()
