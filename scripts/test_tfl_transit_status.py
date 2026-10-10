#!/usr/bin/env python3
"""Unit tests for scripts/report/tfl_transit_status.py. Run: python3 scripts/test_tfl_transit_status.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report.tfl_transit_status import (  # noqa: E402
    line_status_findings,
    stop_disruption_findings,
)

TEST_LINES = (
    {"id": "central", "label": "Central line"},
    {"id": "weaver", "label": "Weaver line (London Overground)"},
)


def good_service_line(line_id, name):
    return {
        "id": line_id,
        "name": name,
        "lineStatuses": [{"statusSeverity": 10, "statusSeverityDescription": "Good Service"}],
    }


def disrupted_line(line_id, name, severity, severity_description, **disruption_fields):
    status = {
        "statusSeverity": severity,
        "statusSeverityDescription": severity_description,
        "reason": disruption_fields.pop("reason", None),
    }
    if disruption_fields:
        status["disruption"] = disruption_fields
    return {"id": line_id, "name": name, "lineStatuses": [status]}


class LineStatusFindingsTests(unittest.TestCase):
    def test_good_service_produces_no_finding(self):
        lines_json = [
            good_service_line("central", "Central"),
            good_service_line("weaver", "Weaver"),
        ]
        self.assertEqual(line_status_findings(lines_json, TEST_LINES), [])

    def test_disrupted_line_becomes_a_finding(self):
        lines_json = [
            disrupted_line(
                "central", "Central", 6, "Severe Delays",
                description="Severe delays between Epping and Loughton due to a signal failure.",
            ),
        ]
        findings = line_status_findings(lines_json, TEST_LINES)
        self.assertEqual(len(findings), 1)
        finding = findings[0]
        self.assertEqual(finding["category"], "road")
        self.assertEqual(finding["place"], "Central line")
        self.assertEqual(finding["status_label"], "Severe Delays")
        self.assertIn("Epping and Loughton", finding["body"])
        self.assertEqual(finding["sources"][0]["label"], "TfL service status")

    def test_falls_back_to_reason_when_no_disruption_description(self):
        lines_json = [disrupted_line("weaver", "Weaver", 6, "Part Closure", reason="Planned engineering works.")]
        findings = line_status_findings(lines_json, TEST_LINES)
        self.assertEqual(findings[0]["body"], "Planned engineering works.")

    def test_unlisted_line_falls_back_to_its_own_name(self):
        lines_json = [disrupted_line("central", "Central", 6, "Minor Delays", reason="Signal failure.")]
        findings = line_status_findings(lines_json, lines=())
        self.assertEqual(findings[0]["place"], "Central")

    def test_multiple_statuses_on_one_line_each_produce_a_finding(self):
        lines_json = [{
            "id": "central",
            "name": "Central",
            "lineStatuses": [
                {"statusSeverity": 9, "statusSeverityDescription": "Minor Delays", "reason": "Signal failure."},
                {"statusSeverity": 6, "statusSeverityDescription": "Part Closure", "reason": "Planned closure."},
            ],
        }]
        findings = line_status_findings(lines_json, TEST_LINES)
        self.assertEqual(len(findings), 2)


class StopDisruptionFindingsTests(unittest.TestCase):
    def test_no_disruptions_produces_no_findings(self):
        self.assertEqual(stop_disruption_findings([]), [])
        self.assertEqual(stop_disruption_findings(None), [])

    def test_disruption_names_its_affected_stops(self):
        disruptions_json = [{
            "description": "Stop closed while a bus shelter is repaired.",
            "closureText": "closed",
            "affectedStops": [{"commonName": "Loughton Station"}],
        }]
        findings = stop_disruption_findings(disruptions_json)
        self.assertEqual(len(findings), 1)
        finding = findings[0]
        self.assertEqual(finding["category"], "road")
        self.assertEqual(finding["place"], "Loughton Station")
        self.assertEqual(finding["status_label"], "closed")
        self.assertIn("bus shelter", finding["body"])

    def test_multiple_affected_stops_are_combined_and_deduplicated(self):
        disruptions_json = [{
            "description": "Diversion in place.",
            "affectedStops": [
                {"commonName": "Chingford Station"},
                {"commonName": "Chingford Station"},
                {"commonName": "Larkshall Road"},
            ],
        }]
        findings = stop_disruption_findings(disruptions_json)
        self.assertEqual(findings[0]["place"], "Chingford Station, Larkshall Road")

    def test_disruption_with_no_named_stop_falls_back_to_the_area(self):
        findings = stop_disruption_findings([{"description": "A stop is suspended nearby."}])
        self.assertEqual(findings[0]["place"], "Epping Forest area")


if __name__ == "__main__":
    unittest.main()
