#!/usr/bin/env python3
"""Unit tests for scripts/business_watch.py. Run: python3 scripts/test_business_watch.py"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import business_watch as bw  # noqa: E402


def observation(key, signal, **detail):
    return {"key": key, "signal": signal, "source": "osm", "detail": {"name": key, **detail}}


class EscalationTests(unittest.TestCase):
    def test_a_signal_seen_once_is_not_acted_on(self):
        ledger = bw.record_run(bw.empty_ledger(), [observation("node/1", "missing")], "2026-01-05")
        self.assertFalse(ledger["entries"]["node/1"]["confident"])
        self.assertEqual(bw.confident_entries(ledger), {})

    def test_a_signal_that_repeats_enough_becomes_confident(self):
        ledger = bw.empty_ledger()
        for week, day in enumerate(("2026-01-05", "2026-01-12", "2026-01-19"), start=1):
            bw.record_run(ledger, [observation("node/1", "missing")], day)
            self.assertEqual(ledger["entries"]["node/1"]["runs"], week)
        self.assertTrue(ledger["entries"]["node/1"]["confident"])
        self.assertEqual(ledger["entries"]["node/1"]["firstSeen"], "2026-01-05")
        self.assertEqual(ledger["entries"]["node/1"]["lastSeen"], "2026-01-19")

    def test_a_stated_closure_is_confident_at_once(self):
        # OpenStreetMap carrying a disused:/vacant tag is somebody recording a
        # closure, not the absence of a record. There is nothing to wait for.
        ledger = bw.record_run(bw.empty_ledger(), [observation("node/1", "closed")], "2026-01-05")
        self.assertTrue(ledger["entries"]["node/1"]["confident"])

    def test_a_signal_that_stops_appearing_is_forgotten(self):
        ledger = bw.empty_ledger()
        bw.record_run(ledger, [observation("node/1", "missing")], "2026-01-05")
        bw.record_run(ledger, [observation("node/1", "missing")], "2026-01-12")
        bw.record_run(ledger, [], "2026-01-19")
        self.assertNotIn("node/1", ledger["entries"])

    def test_an_intermittent_signal_never_accumulates(self):
        # A source that drops a place every other week is flaky, not evidence.
        # Without this the run count would creep up and eventually delete it.
        ledger = bw.empty_ledger()
        for day in ("2026-01-05", "2026-01-19", "2026-02-02"):
            bw.record_run(ledger, [observation("node/1", "missing")], day)
            bw.record_run(ledger, [], day)
        self.assertEqual(bw.confident_entries(ledger), {})

    def test_a_changed_signal_starts_its_count_again(self):
        ledger = bw.empty_ledger()
        bw.record_run(ledger, [observation("node/1", "missing")], "2026-01-05")
        bw.record_run(ledger, [observation("node/1", "missing")], "2026-01-12")
        bw.record_run(ledger, [observation("node/1", "changed")], "2026-01-19")
        self.assertEqual(ledger["entries"]["node/1"]["runs"], 1)
        self.assertEqual(ledger["entries"]["node/1"]["firstSeen"], "2026-01-19")

    def test_an_unknown_signal_is_refused(self):
        with self.assertRaises(ValueError):
            bw.record_run(bw.empty_ledger(), [observation("node/1", "perhaps")], "2026-01-05")


class DismissalTests(unittest.TestCase):
    def test_a_dismissed_entry_never_becomes_confident(self):
        ledger = bw.empty_ledger()
        ledger["entries"]["node/1"] = {"signal": "closed", "runs": 9, "dismissed": True}
        bw.record_run(ledger, [observation("node/1", "closed")], "2026-01-05")
        self.assertFalse(ledger["entries"]["node/1"]["confident"])
        self.assertEqual(bw.confident_entries(ledger), {})

    def test_a_dismissed_entry_survives_a_run_that_does_not_see_it(self):
        ledger = bw.empty_ledger()
        ledger["entries"]["node/1"] = {"signal": "closed", "runs": 1, "dismissed": True}
        bw.record_run(ledger, [], "2026-01-05")
        self.assertIn("node/1", ledger["entries"])

    def test_a_dismissed_entry_keeps_its_run_count(self):
        ledger = bw.empty_ledger()
        ledger["entries"]["node/1"] = {"signal": "closed", "runs": 1, "dismissed": True}
        bw.record_run(ledger, [observation("node/1", "closed")], "2026-01-05")
        self.assertEqual(ledger["entries"]["node/1"]["runs"], 1)


class SourceScopeTests(unittest.TestCase):
    def test_one_source_reporting_does_not_clear_another_source(self):
        # The two checks run as separate steps against one watchlist. If
        # recording the second wiped what the first found an hour earlier,
        # nothing would ever reach a second week.
        ledger = bw.empty_ledger()
        bw.record_run(ledger, [observation("node/1", "missing")], "2026-01-05", sources={"osm"})
        bw.record_run(
            ledger,
            [{"key": "fsa/7", "signal": "new", "source": "fsa", "detail": {"name": "New Cafe"}}],
            "2026-01-05",
            sources={"fsa"},
        )
        self.assertIn("node/1", ledger["entries"])
        self.assertIn("fsa/7", ledger["entries"])
        self.assertEqual(ledger["entries"]["node/1"]["runs"], 1)


class ChangesetTests(unittest.TestCase):
    def confident(self, key, signal, **detail):
        ledger = bw.empty_ledger()
        ledger["entries"][key] = {
            "signal": signal, "source": "osm", "name": detail.get("name"),
            "runs": 99, "detail": detail,
        }
        return ledger

    def test_a_confident_closure_becomes_a_removal(self):
        ledger = self.confident("node/1", "closed", id="node/1", name="Gone Cafe")
        changeset, notes = bw.build_changeset(ledger)
        self.assertEqual(changeset["add"], [])
        self.assertEqual(changeset["remove"][0]["id"], "node/1")
        self.assertEqual(notes, [])

    def test_a_confident_opening_becomes_an_addition_with_its_details(self):
        ledger = self.confident(
            "node/2", "new", name="New Cafe", category="cafe", lon=0.05, lat=51.65,
            address="1 High Road", osmType="node", osmId=2,
        )
        changeset, _ = bw.build_changeset(ledger)
        self.assertEqual(changeset["remove"], [])
        self.assertEqual(changeset["add"], [{
            "name": "New Cafe", "category": "cafe", "lon": 0.05, "lat": 51.65,
            "address": "1 High Road", "osmType": "node", "osmId": 2,
        }])

    def test_a_site_that_changed_hands_removes_the_old_name_and_adds_the_new(self):
        # The case the old check could not see at all: the map element never
        # moved, so nothing looked missing and nothing looked new.
        ledger = self.confident(
            "node/3", "changed", id="node/3", previousName="Wildwood", name="Somewhere Else",
            category="restaurant", lon=0.056, lat=51.648,
        )
        changeset, _ = bw.build_changeset(ledger)
        self.assertEqual([r["name"] for r in changeset["remove"]], ["Wildwood"])
        self.assertEqual([a["name"] for a in changeset["add"]], ["Somewhere Else"])

    def test_nothing_short_of_confident_reaches_the_changeset(self):
        ledger = bw.record_run(bw.empty_ledger(), [observation("node/1", "missing")], "2026-01-05")
        changeset, _ = bw.build_changeset(ledger)
        self.assertEqual(changeset, {"add": [], "remove": []})

    def test_an_implausible_number_of_removals_is_held_back_entirely(self):
        # A source outage returning a short list reads as every place closing
        # at once. Removing them would empty the map for a walker relying on it.
        ledger = bw.empty_ledger()
        for n in range(bw.MAX_AUTO_REMOVALS + 1):
            ledger["entries"][f"node/{n}"] = {
                "signal": "closed", "source": "osm", "runs": 99,
                "detail": {"id": f"node/{n}", "name": f"Place {n}"},
            }
        changeset, notes = bw.build_changeset(ledger)
        self.assertEqual(changeset["remove"], [])
        self.assertEqual(len(notes), 1)
        self.assertIn("by hand", notes[0])

    def test_a_dismissed_entry_is_left_out_of_the_changeset(self):
        ledger = self.confident("node/1", "closed", id="node/1", name="Gone Cafe")
        ledger["entries"]["node/1"]["dismissed"] = True
        changeset, _ = bw.build_changeset(ledger)
        self.assertEqual(changeset["remove"], [])


class AgreementTests(unittest.TestCase):
    """Two sources that have never heard of each other describing the same new
    place. Before this, that produced two pins for one cafe and still made
    both wait out the full patience."""

    def ledger_with_both_sources(self, name_a="Chapter 21", name_b="Chapter 21",
                                 pos_a=(0.0565, 51.6486), pos_b=(0.0566, 51.6487)):
        ledger = bw.empty_ledger()
        ledger["entries"]["node/5"] = {
            "signal": "new", "source": "osm", "runs": 1,
            "detail": {"name": name_a, "lon": pos_a[0], "lat": pos_a[1], "category": "cafe",
                       "osmType": "node", "osmId": 5},
        }
        ledger["entries"]["fsa/99"] = {
            "signal": "new", "source": "fsa", "runs": 1,
            "detail": {"name": name_b, "lon": pos_b[0], "lat": pos_b[1], "category": "cafe"},
        }
        return ledger

    def test_agreement_makes_an_opening_confident_without_waiting(self):
        ledger = bw.link_agreements(self.ledger_with_both_sources())
        self.assertTrue(ledger["entries"]["node/5"]["confident"])

    def test_only_one_of_the_two_becomes_an_addition(self):
        ledger = bw.link_agreements(self.ledger_with_both_sources())
        changeset, _ = bw.build_changeset(ledger)
        self.assertEqual(len(changeset["add"]), 1, "one cafe should produce one pin")

    def test_the_entry_carrying_the_map_id_is_the_one_that_survives(self):
        # That id is how every later run recognises the place again.
        ledger = bw.link_agreements(self.ledger_with_both_sources())
        changeset, _ = bw.build_changeset(ledger)
        self.assertEqual(changeset["add"][0]["osmId"], 5)

    def test_the_same_name_far_apart_is_not_agreement(self):
        ledger = self.ledger_with_both_sources(pos_b=(0.112, 51.700))
        bw.link_agreements(ledger)
        self.assertNotIn("agreedWith", ledger["entries"]["node/5"])
        self.assertFalse(ledger["entries"]["node/5"]["confident"])

    def test_different_places_are_not_agreement(self):
        ledger = self.ledger_with_both_sources(name_b="Somewhere Else")
        bw.link_agreements(ledger)
        self.assertNotIn("agreedWith", ledger["entries"]["node/5"])

    def test_one_source_saying_it_twice_is_not_agreement(self):
        ledger = bw.empty_ledger()
        for key in ("node/5", "node/6"):
            ledger["entries"][key] = {
                "signal": "new", "source": "osm", "runs": 1,
                "detail": {"name": "Chapter 21", "lon": 0.0565, "lat": 51.6486},
            }
        bw.link_agreements(ledger)
        self.assertNotIn("agreedWith", ledger["entries"]["node/5"])

    def test_agreement_does_not_shortcut_a_closure(self):
        # Sources are unreliable in the same direction about absence -- neither
        # knows about a place nobody recorded -- so agreement means nothing there.
        ledger = bw.empty_ledger()
        ledger["entries"]["node/5"] = {
            "signal": "missing", "source": "osm", "runs": 1,
            "detail": {"name": "The Bell", "lon": 0.05, "lat": 51.65},
        }
        ledger["entries"]["fsa/9"] = {
            "signal": "missing", "source": "fsa", "runs": 1,
            "detail": {"name": "The Bell", "lon": 0.05, "lat": 51.65},
        }
        bw.link_agreements(ledger)
        self.assertFalse(ledger["entries"]["node/5"]["confident"])

    def test_relinking_does_not_accumulate_stale_links(self):
        ledger = self.ledger_with_both_sources()
        bw.link_agreements(ledger)
        bw.link_agreements(ledger)
        self.assertEqual(ledger["entries"]["node/5"]["agreedWith"], ["fsa/99"])

    def test_a_dismissed_entry_is_never_linked(self):
        ledger = self.ledger_with_both_sources()
        ledger["entries"]["node/5"]["dismissed"] = True
        bw.link_agreements(ledger)
        self.assertNotIn("supersededBy", ledger["entries"]["fsa/99"])


class PendingTests(unittest.TestCase):
    def test_pending_says_how_many_more_runs_are_needed(self):
        ledger = bw.record_run(bw.empty_ledger(), [observation("node/1", "missing")], "2026-01-05")
        pending = bw.pending_entries(ledger)
        self.assertEqual(pending["node/1"]["runsNeeded"], bw.CONFIDENT_AFTER_RUNS["missing"])
        self.assertEqual(pending["node/1"]["runsRemaining"], bw.CONFIDENT_AFTER_RUNS["missing"] - 1)


class LedgerFileTests(unittest.TestCase):
    def test_a_ledger_survives_a_round_trip_to_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "business-watch.json"
            ledger = bw.record_run(bw.empty_ledger(), [observation("node/1", "missing")], "2026-01-05")
            bw.save_ledger(ledger, path)
            self.assertEqual(bw.load_ledger(path)["entries"], ledger["entries"])

    def test_a_missing_ledger_reads_as_an_empty_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(bw.load_ledger(Path(tmp) / "nothing.json")["entries"], {})

    def test_places_a_person_reported_missing_survive_a_run(self):
        # They are a standing instruction, not a signal, so a run that sees
        # none of them must not clear them.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "business-watch.json"
            ledger = bw.empty_ledger()
            ledger["reportedMissing"] = [{"name": "Lopping Hall", "settlement": "Loughton"}]
            bw.record_run(ledger, [], "2026-01-05")
            bw.save_ledger(ledger, path)
            self.assertEqual(bw.reported_missing(bw.load_ledger(path))[0]["name"], "Lopping Hall")

    def test_a_ledger_with_nothing_reported_reads_as_empty(self):
        self.assertEqual(bw.reported_missing(bw.empty_ledger()), [])

    def test_the_committed_ledger_is_valid(self):
        # It carries the hand-checked closures that must never be re-added, so
        # a typo in it would quietly un-park them.
        ledger = bw.load_ledger()
        self.assertIsInstance(ledger.get("entries"), dict)
        for key, entry in ledger["entries"].items():
            self.assertIn(entry.get("signal"), bw.SIGNALS, f"{key} has an unknown signal")


if __name__ == "__main__":
    unittest.main()
