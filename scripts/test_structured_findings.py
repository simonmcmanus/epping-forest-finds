#!/usr/bin/env python3
"""Unit tests for scripts/report/structured_findings.py. Run: python3 scripts/test_structured_findings.py"""
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report.structured_findings import (  # noqa: E402
    event_findings,
    notice_findings,
    road_closure_findings,
)


def entry(**overrides):
    base = {
        "title": "Example works",
        "place": "Loughton",
        "body": "Something is happening.",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
    }
    base.update(overrides)
    return base


class RoadClosureFindingsTests(unittest.TestCase):
    def test_active_entry_is_included(self):
        findings = road_closure_findings([entry()], date(2026, 6, 1))
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["category"], "road")
        self.assertEqual(findings[0]["status_label"], "Ongoing")

    def test_entry_before_start_date_is_excluded(self):
        findings = road_closure_findings(
            [entry(startDate="2026-11-01")], date(2026, 6, 1)
        )
        self.assertEqual(findings, [])

    def test_entry_after_end_date_is_excluded(self):
        findings = road_closure_findings(
            [entry(endDate="2026-01-31")], date(2026, 6, 1)
        )
        self.assertEqual(findings, [])

    def test_open_ended_entry_with_no_end_date_stays_active(self):
        findings = road_closure_findings(
            [entry(endDate=None)], date(2030, 1, 1)
        )
        self.assertEqual(len(findings), 1)

    def test_partial_dates_round_to_their_start(self):
        # "2026-10" means October 2026, so 1 October counts as active.
        findings = road_closure_findings(
            [entry(startDate="2026-10", endDate="2026-10")], date(2026, 10, 1)
        )
        self.assertEqual(len(findings), 1)

    def test_needs_reverification_appends_a_plain_english_caveat(self):
        findings = road_closure_findings(
            [entry(needsReverification=True)], date(2026, 6, 1)
        )
        self.assertIn("worth checking", findings[0]["body"])

    def test_lon_lat_and_sources_are_carried_through(self):
        findings = road_closure_findings(
            [entry(lon=0.05, lat=51.65, sources=[{"label": "Council", "url": "https://example.com"}])],
            date(2026, 6, 1),
        )
        self.assertEqual(findings[0]["lon"], 0.05)
        self.assertEqual(findings[0]["sources"][0]["label"], "Council")


class NoticeFindingsTests(unittest.TestCase):
    def test_active_notice_is_categorised_as_road_access(self):
        findings = notice_findings([entry(category="facility")], date(2026, 6, 1))
        self.assertEqual(findings[0]["category"], "road")


class EventFindingsTests(unittest.TestCase):
    def _event(self, **overrides):
        base = {"title": "Forest fun run", "place": "High Beach", "body": "A run.", "date": "2026-10-10"}
        base.update(overrides)
        return base

    def test_event_today_is_labelled_today(self):
        findings = event_findings([self._event()], date(2026, 10, 10))
        self.assertEqual(findings[0]["status_label"], "Today")

    def test_event_within_horizon_is_labelled_coming_up(self):
        findings = event_findings([self._event(date="2026-10-20")], date(2026, 10, 10))
        self.assertEqual(findings[0]["status_label"], "Coming up")

    def test_event_beyond_horizon_is_excluded(self):
        findings = event_findings([self._event(date="2026-12-25")], date(2026, 10, 10))
        self.assertEqual(findings, [])

    def test_past_event_is_excluded(self):
        findings = event_findings([self._event(date="2026-01-01")], date(2026, 10, 10))
        self.assertEqual(findings, [])

    def test_event_with_no_date_is_labelled_recurring(self):
        findings = event_findings([self._event(date=None)], date(2026, 10, 10))
        self.assertEqual(findings[0]["status_label"], "Recurring")


if __name__ == "__main__":
    unittest.main()
