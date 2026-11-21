#!/usr/bin/env python3
"""Unit tests for scripts/report/tfl_transit_status.py. Run: python3 scripts/test_tfl_transit_status.py"""
import contextlib
import io
import json
import os
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.report import tfl_transit_status  # noqa: E402
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


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def http_403(url):
    return urllib.error.HTTPError(url, 403, "Forbidden", {}, None)


DISRUPTED_CENTRAL = [{
    "id": "central", "name": "Central",
    "lineStatuses": [{"statusSeverity": 6, "statusSeverityDescription": "Severe Delays", "reason": "Signal failure."}],
}]
STOP_LOOKUP = {"stopPoints": [{"id": "490000001"}]}
STOP_DISRUPTION = [{"description": "Stop closed.", "affectedStops": [{"commonName": "Loughton Station"}]}]


def fake_network(line=None, lookup=STOP_LOOKUP, disruption=STOP_DISRUPTION, seen=None):
    """Stands in for urlopen. A section given an Exception instance fails."""
    def urlopen(request, timeout=None):
        url = request.full_url
        if seen is not None:
            seen.append(request)
        if "/Line/" in url:
            payload = line
        elif "/Disruption" in url:
            payload = disruption
        else:
            payload = lookup
        if isinstance(payload, Exception):
            raise payload
        return FakeResponse(payload)
    return urlopen


def run_main(urlopen, env=None):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.dict(os.environ, env or {}, clear=False), \
            mock.patch("urllib.request.urlopen", urlopen), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        tfl_transit_status.main()
    return json.loads(out.getvalue()), err.getvalue()


class FailSoftTests(unittest.TestCase):
    def test_line_status_403_still_returns_bus_stop_findings_and_reports_failure(self):
        findings, stderr = run_main(fake_network(line=http_403("https://api.tfl.gov.uk/Line/x")))
        self.assertEqual([f["place"] for f in findings], ["Loughton Station"])
        self.assertIn("TfL check failed: line status (HTTP 403)", stderr)

    def test_bus_stop_failure_still_returns_line_findings_and_reports_failure(self):
        findings, stderr = run_main(fake_network(
            line=DISRUPTED_CENTRAL, lookup=urllib.error.URLError("connection refused")))
        self.assertEqual([f["place"] for f in findings], ["Central line"])
        self.assertIn("TfL check failed: bus stop lookup", stderr)

    def test_all_sections_failing_prints_empty_list_and_names_each_failure(self):
        err = http_403("u")
        findings, stderr = run_main(fake_network(line=err, lookup=err))
        self.assertEqual(findings, [])
        self.assertIn("line status (HTTP 403)", stderr)
        self.assertIn("bus stop lookup (HTTP 403)", stderr)

    def test_healthy_run_reports_no_failure(self):
        findings, stderr = run_main(fake_network(line=DISRUPTED_CENTRAL))
        self.assertEqual(len(findings), 2)
        self.assertEqual(stderr, "")


class RequestHeaderTests(unittest.TestCase):
    def requests_for(self, key):
        seen = []
        env = {"TFL_APP_KEY": key} if key is not None else {}
        with mock.patch.dict(os.environ, env, clear=False):
            if key is None:
                os.environ.pop("TFL_APP_KEY", None)
            run_main(fake_network(line=[], seen=seen))
        return seen

    def test_requests_carry_a_descriptive_user_agent(self):
        requests = self.requests_for(None)
        self.assertTrue(requests)
        for request in requests:
            self.assertIn("epping-forest-finds", request.get_header("User-agent"))
            self.assertEqual(request.get_header("Accept"), "application/json")

    def test_app_key_sent_only_when_non_blank(self):
        for blank in (None, "", "   "):
            for request in self.requests_for(blank):
                self.assertNotIn("app_key", request.full_url)
        for request in self.requests_for(" abc123 "):
            self.assertIn("app_key=abc123", request.full_url)


if __name__ == "__main__":
    unittest.main()
