#!/usr/bin/env python3
"""Unit tests for scripts/user_reports.py. Run: python3 scripts/test_user_reports.py"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import business_watch as bw  # noqa: E402
from scripts import user_reports as ur  # noqa: E402


def issue(number=77, title="Missing map data: Tree 04406 is missing", body=None,
          labels=("missing-data", "user-report"), created="2026-09-18T07:52:06Z"):
    # The shape netlify/functions/report-missing-data.js actually writes.
    if body is None:
        body = (
            "## Report\n"
            "Tree 04406 is missing\n"
            "\n"
            "## Metadata\n"
            "- Type: missing-data\n"
            "- App version: forest-finds-v274\n"
            "- Page URL: https://www.eppingforestfinds.uk/app\n"
            "- User agent: Mozilla/5.0\n"
            "- Reported location: 51.6486863, 0.056709\n"
            "- Google Maps: https://maps.google.com/?q=51.6486863,0.056709\n"
        )
    return {
        "number": number,
        "title": title,
        "body": body,
        "labels": [{"name": n} for n in labels],
        "created_at": created,
        "html_url": f"https://github.com/simonmcmanus/epping-forest-finds/issues/{number}",
    }


class SelectionTests(unittest.TestCase):
    def test_a_map_data_report_is_picked_up(self):
        self.assertTrue(ur.is_map_data_report(issue()))

    def test_a_feature_request_is_not_map_data(self):
        # Somebody asking the app to do something is not somebody telling us
        # the map is wrong.
        self.assertFalse(ur.is_map_data_report(issue(labels=("feature-request", "user-report"))))

    def test_an_issue_without_the_report_label_is_ignored(self):
        self.assertFalse(ur.is_map_data_report(issue(labels=("bug",))))

    def test_a_pull_request_is_not_a_report(self):
        pr = issue()
        pr["pull_request"] = {"url": "..."}
        self.assertFalse(ur.is_map_data_report(pr))

    def test_labels_given_as_plain_strings_still_work(self):
        self.assertTrue(ur.is_map_data_report(issue(labels=("missing-data", "user-report"))))


class ParseTests(unittest.TestCase):
    def test_the_position_the_reporter_was_standing_on_is_read(self):
        # This is what makes a report better evidence than any other source:
        # somebody was there, and the app recorded where.
        parsed = ur.parse_report(issue())
        self.assertAlmostEqual(parsed["lat"], 51.6486863)
        self.assertAlmostEqual(parsed["lon"], 0.056709)

    def test_the_title_keeps_the_report_not_the_prefix(self):
        self.assertEqual(ur.parse_report(issue())["name"], "Tree 04406 is missing")

    def test_the_reporters_own_words_are_kept_and_the_plumbing_is_not(self):
        parsed = ur.parse_report(issue())
        self.assertEqual(parsed["note"], "Tree 04406 is missing")
        self.assertNotIn("User agent", parsed["note"])
        self.assertNotIn("App version", parsed["note"])

    def test_a_report_sent_without_location_still_parses(self):
        body = "## Report\nThe Bell has closed\n\n## Metadata\n- Type: missing-data\n"
        parsed = ur.parse_report(issue(body=body))
        self.assertNotIn("lat", parsed)
        self.assertEqual(parsed["note"], "The Bell has closed")

    def test_the_issue_number_and_link_are_carried_so_it_can_be_closed(self):
        parsed = ur.parse_report(issue(number=77))
        self.assertEqual(parsed["issue"], 77)
        self.assertIn("/issues/77", parsed["url"])
        self.assertEqual(parsed["reportedOn"], "2026-09-18")

    def test_a_multi_line_report_keeps_all_of_it(self):
        body = "## Report\nWildwood has closed.\nLoaded has closed too.\n\n## Metadata\n- Type: missing-data\n"
        self.assertEqual(ur.parse_report(issue(body=body))["note"], "Wildwood has closed.\nLoaded has closed too.")


class AuthenticationTests(unittest.TestCase):
    """A zero must never be able to mean "could not look". That is the one
    failure that passes for a quiet week, because no reports and no permission
    produce the same empty list everywhere downstream."""

    def setUp(self):
        self.saved = {k: os.environ.get(k) for k in ("GITHUB_TOKEN", "GH_TOKEN")}
        for key in self.saved:
            os.environ.pop(key, None)

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_a_run_without_a_token_says_so(self):
        self.assertFalse(ur.is_authenticated())

    def test_either_token_name_counts(self):
        for key in ("GITHUB_TOKEN", "GH_TOKEN"):
            os.environ[key] = "x"
            self.assertTrue(ur.is_authenticated())
            del os.environ[key]

    def test_a_token_is_sent_as_a_bearer_when_there_is_one(self):
        os.environ["GH_TOKEN"] = "secret"
        self.assertEqual(ur._auth_headers()["Authorization"], "Bearer secret")

    def test_no_authorization_header_is_sent_without_a_token(self):
        # The repository is public, so this still works -- it just reads
        # against the shared unauthenticated rate limit.
        self.assertNotIn("Authorization", ur._auth_headers())


class MergeTests(unittest.TestCase):
    def test_a_new_report_is_added_to_the_watchlist(self):
        ledger = bw.empty_ledger()
        added = ur.merge_into_ledger(ledger, [ur.parse_report(issue(number=77))])
        self.assertEqual(len(added), 1)
        self.assertEqual(bw.reported_missing(ledger)[0]["issue"], 77)

    def test_the_same_report_is_not_listed_twice(self):
        ledger = bw.empty_ledger()
        report = ur.parse_report(issue(number=77))
        ur.merge_into_ledger(ledger, [report])
        ur.merge_into_ledger(ledger, [report])
        self.assertEqual(len(bw.reported_missing(ledger)), 1)

    def test_entries_written_by_hand_are_left_alone(self):
        # The hand-written ones have no issue number behind them, and losing
        # them would drop what somebody took the trouble to record.
        ledger = bw.empty_ledger()
        ledger["reportedMissing"] = [{"name": "Lopping Hall", "settlement": "Loughton"}]
        ur.merge_into_ledger(ledger, [ur.parse_report(issue(number=77))])
        names = [e.get("name") for e in bw.reported_missing(ledger)]
        self.assertIn("Lopping Hall", names)
        self.assertIn("Tree 04406 is missing", names)

    def test_a_report_is_never_dropped_by_a_run_that_does_not_see_it(self):
        # It leaves the list when somebody has dealt with it, not because a
        # query came back short.
        ledger = bw.empty_ledger()
        ur.merge_into_ledger(ledger, [ur.parse_report(issue(number=77))])
        ur.merge_into_ledger(ledger, [])
        self.assertEqual(len(bw.reported_missing(ledger)), 1)

    def test_reports_survive_a_watchlist_run(self):
        ledger = bw.empty_ledger()
        ur.merge_into_ledger(ledger, [ur.parse_report(issue(number=77))])
        bw.record_run(ledger, [], "2026-09-21", sources={"osm"})
        self.assertEqual(len(bw.reported_missing(ledger)), 1)


if __name__ == "__main__":
    unittest.main()
