#!/usr/bin/env python3
"""
Live check of Transport for London's own published status for the two rail
lines serving the forest's coverage settlements -- the Central line (Epping,
Theydon Bois, Debden, Loughton) and the Weaver line, London Overground's name
for the Chingford branch -- plus bus stop disruptions around those same
settlements. Turns whatever is currently disrupted into report-data.json
"findings", the same shape scripts/report/structured_findings.py produces.

Unlike data/road-closures.json, data/forest-notices.json and
data/forest-events.json, this needs no hand-researched file: Transport for
London's own feed *is* the live, authoritative record of what's disrupted
right now, so this queries it fresh every run instead of keeping a watchlist.
Most weeks every line returns "Good Service" and no stop has a live
disruption, which is correct and reported as no findings -- the report's
existing empty-section wording covers that, the same as an empty week for
road closures or events. See spec/spec-weekly-report.md.

Network: Transport for London's own public transport data feed
(api.tfl.gov.uk). A key is optional but recommended: the weekly ledger runs
from shared GitHub runner IPs and TfL answered some of those unauthenticated
calls with HTTP 403. An optional TFL_APP_KEY environment variable is sent as
app_key; it changes nothing about the data returned -- see .env.example.

Each section (line status, bus stop lookup, stop disruptions) fails soft: if
one cannot be fetched a "TfL check failed: <section> (<reason>)" line goes to
stderr, the other sections' findings are still printed, and the exit code
stays 0. A failed section is NOT "no disruption" -- callers must read stderr.

Usage:
    python3 scripts/report/tfl_transit_status.py

Prints a JSON list of findings to stdout, ready to extend
report-data.json's "findings" array -- the same contract as
structured_findings.py.
"""
import http.client
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from scripts.report.places import TOWNS  # noqa: E402
else:
    from .places import TOWNS

BASE_URL = "https://api.tfl.gov.uk"
REQUEST_TIMEOUT_S = 20
USER_AGENT = "epping-forest-finds-ledger/1.0 (+https://github.com/simonmcmanus/epping-forest-finds)"

# The two lines that actually serve the forest's own stations. Chingford is
# served by London Overground's "Weaver" line, not Greater Anglia -- an
# earlier data/road-closures.json sourceNotes entry guessed Greater Anglia;
# a live stop lookup on 2026-10-11 showed that was wrong.
LINES = (
    {"id": "central", "label": "Central line"},
    {"id": "weaver", "label": "Weaver line (London Overground)"},
)

# Mirrors scripts/report/places.py's coverage towns -- there is no single
# "stops near Epping Forest" lookup, so this scans a radius around each town
# the report already covers and checks every bus stop found there.
STOP_SCAN_RADIUS_M = 500
GOOD_SERVICE_SEVERITY = 10

# /StopPoint/{ids}/Disruption itself rejects the request (HTTP 400) past a
# certain number of comma-joined ids -- confirmed live on 2026-10-11: 22 ids
# succeeds, 23 fails regardless of which ones or their order, and the two
# towns scanned here already turn up more than 22 stops between them. There
# is no documented limit to code against, so this batches conservatively
# rather than assuming 22 holds forever.
STOP_IDS_PER_REQUEST = 20

STATUS_SOURCE = {"label": "TfL service status", "url": "https://tfl.gov.uk/tube-dlr-overground/status/"}
STOP_SOURCE = {"label": "TfL service status", "url": "https://tfl.gov.uk/status-updates/"}


def _get_json(url):
    key = (os.environ.get("TFL_APP_KEY") or "").strip()
    if key:
        url = f"{url}{'&' if '?' in url else '?'}app_key={urllib.parse.quote(key)}"
    request = urllib.request.Request(
        url,
        headers={"accept": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
        return json.loads(response.read().decode("utf-8"))


def _expect(payload, kind):
    if not isinstance(payload, kind):
        raise ValueError("unexpected response shape")
    return payload


def fetch_line_statuses(lines=LINES):
    ids = ",".join(line["id"] for line in lines)
    return _expect(_get_json(f"{BASE_URL}/Line/{ids}/Status?detail=true"), list)


def fetch_bus_stop_ids(towns=TOWNS, radius_m=STOP_SCAN_RADIUS_M, failures=None):
    """With `failures` (a list), a town whose search fails is reported there
    and the other towns' stops are kept; if every town failed the first error
    is raised so the whole section counts as failed. Without it, any error
    propagates."""
    ids = set()
    errors = []
    for town in towns:
        try:
            data = _expect(_get_json(
                f"{BASE_URL}/StopPoint?lat={town['lat']}&lon={town['lon']}"
                f"&stopTypes=NaptanPublicBusCoachTram&radius={radius_m}"
            ), dict)
            for stop in _expect(data.get("stopPoints", []), list):
                if stop.get("id"):
                    ids.add(stop["id"])
        except FETCH_ERRORS as error:
            if failures is None:
                raise
            errors.append((town, error))
    if errors and len(errors) == len(towns):
        raise errors[0][1]
    for town, error in errors:
        failures.append(f"bus stop lookup for {town.get('name', 'one town')} ({_describe_failure(error)})")
    return sorted(ids)


def fetch_stop_disruptions(stop_ids, batch_size=STOP_IDS_PER_REQUEST, failures=None):
    """Same partial-results rule as fetch_bus_stop_ids, per batch of stops."""
    disruptions = []
    errors = []
    starts = list(range(0, len(stop_ids), batch_size))
    for number, start in enumerate(starts, 1):
        batch = stop_ids[start:start + batch_size]
        try:
            disruptions += _expect(_get_json(f"{BASE_URL}/StopPoint/{','.join(batch)}/Disruption"), list)
        except FETCH_ERRORS as error:
            if failures is None:
                raise
            errors.append((number, error))
    if errors and len(errors) == len(starts):
        raise errors[0][1]
    for number, error in errors:
        failures.append(f"stop disruptions batch {number} of {len(starts)} ({_describe_failure(error)})")
    return disruptions


# ---- pure transforms: no network, covered by scripts/test_tfl_transit_status.py ----


# Line ids the report draws an icon for (see render_report.LINE_ICONS).
ICON_LINE_IDS = ("central", "elizabeth", "weaver")


def _stop_points(stops):
    """`{"lon", "lat"}` for each affected stop with numeric, finite, distinct
    coordinates. A stop without them is skipped: no coordinates means no pin,
    which is correct, not an error."""
    points = []
    for stop in _stops_list(stops):
        if not isinstance(stop, dict):
            continue
        lat, lon = stop.get("lat"), stop.get("lon")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                   for v in (lat, lon)):
            continue
        point = {"lon": lon, "lat": lat}
        if point not in points:
            points.append(point)
    return points


def line_status_findings(lines_json, lines=LINES):
    """`lines_json` is the /Line/{ids}/Status response. A line with nothing
    but "Good Service" statuses produces no finding -- most weeks that is
    every line, which is correct, not a gap."""
    labels = {line["id"]: line["label"] for line in lines}
    findings = []
    for line in lines_json or []:
        label = labels.get(line.get("id"), line.get("name") or line.get("id"))
        for status in line.get("lineStatuses", []):
            if status.get("statusSeverity") == GOOD_SERVICE_SEVERITY:
                continue
            severity_label = status.get("statusSeverityDescription") or "Disruption"
            disruption = status.get("disruption") or {}
            body = (
                disruption.get("description")
                or disruption.get("summary")
                or status.get("reason")
                or f"{label}: {severity_label.lower()}."
            )
            finding = {
                "category": "road",
                "title": f"{label}: {severity_label}",
                "place": label,
                "status_label": severity_label,
                "body": body,
                "sources": [STATUS_SOURCE],
            }
            if line.get("id") in ICON_LINE_IDS:
                finding["line"] = line["id"]
            # TfL lists the stops a disruption affects on the disruption itself.
            points = _stop_points(_stops_list(disruption.get("affectedStops")) + _stops_list(status.get("affectedStops")))
            if points:
                finding["points"] = points
            findings.append(finding)
    return findings


def _stops_list(value):
    """affectedStops as a list; anything else the API sends means no stops."""
    return list(value) if isinstance(value, list) else []


def stop_disruption_findings(disruptions_json):
    """`disruptions_json` is the /StopPoint/{ids}/Disruption response: a flat
    list of disruptions, each naming the stop(s) it affects."""
    findings = []
    for disruption in disruptions_json or []:
        stop_names = sorted({
            stop.get("commonName")
            for stop in _stops_list(disruption.get("affectedStops"))
            if isinstance(stop, dict) and stop.get("commonName")
        })
        place = ", ".join(stop_names) if stop_names else "Epping Forest area"
        status_label = disruption.get("closureText") or disruption.get("categoryDescription") or "Disrupted"
        body = (
            disruption.get("description")
            or disruption.get("closureText")
            or disruption.get("summary")
            or f"{place}: bus stop disruption."
        )
        finding = {
            "category": "road",
            "title": f"Bus stop disruption: {place}",
            "place": place,
            "status_label": status_label,
            "body": body,
            "line": "bus",
            "sources": [STOP_SOURCE],
        }
        points = _stop_points(disruption.get("affectedStops"))
        if points:
            finding["points"] = points
        findings.append(finding)
    return findings


# Everything a section can plausibly raise: network/HTTP errors, timeouts,
# bad JSON, a payload of the wrong shape, and truncated reads.
FETCH_ERRORS = (
    urllib.error.URLError, TimeoutError, OSError, ValueError,
    AttributeError, KeyError, TypeError, http.client.HTTPException,
)


def _describe_failure(error):
    """A fixed plain string only -- never the URL, app key or response body,
    all of which can end up in exception text."""
    if isinstance(error, urllib.error.HTTPError):
        return f"HTTP {error.code}"
    if isinstance(error, TimeoutError) or isinstance(getattr(error, "reason", None), TimeoutError):
        return "timed out"
    if isinstance(error, (urllib.error.URLError, OSError)):
        return "network error"
    return "unexpected response"


def collect_with_failures():
    """Returns (findings, failures). `failures` is a list of
    "<section> (<reason>)" strings, one per section (or part of one) that
    could not be fetched. A failed section contributes no findings, but that
    is not the same as "no disruption"."""
    findings = []
    failures = []

    try:
        findings += line_status_findings(fetch_line_statuses())
    except FETCH_ERRORS as error:
        failures.append(f"line status ({_describe_failure(error)})")

    try:
        stop_ids = fetch_bus_stop_ids(failures=failures)
    except FETCH_ERRORS as error:
        stop_ids = None
        failures.append(f"bus stop lookup ({_describe_failure(error)})")

    if stop_ids is not None:
        try:
            findings += stop_disruption_findings(fetch_stop_disruptions(stop_ids, failures=failures))
        except FETCH_ERRORS as error:
            failures.append(f"stop disruptions ({_describe_failure(error)})")

    return findings, failures


def collect():
    return collect_with_failures()[0]


def main():
    findings, failures = collect_with_failures()
    for failure in failures:
        print(f"TfL check failed: {failure}", file=sys.stderr)
    json.dump(findings, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
