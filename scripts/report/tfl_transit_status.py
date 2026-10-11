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
(api.tfl.gov.uk). No key or registration needed. An optional TFL_APP_KEY
environment variable raises the shared rate limit but changes nothing about
the data returned -- see .env.example.

Usage:
    python3 scripts/report/tfl_transit_status.py

Prints a JSON list of findings to stdout, ready to extend
report-data.json's "findings" array -- the same contract as
structured_findings.py.
"""
import json
import os
import sys
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
    key = os.environ.get("TFL_APP_KEY")
    if key:
        url = f"{url}{'&' if '?' in url else '?'}app_key={urllib.parse.quote(key)}"
    request = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_line_statuses(lines=LINES):
    ids = ",".join(line["id"] for line in lines)
    return _get_json(f"{BASE_URL}/Line/{ids}/Status?detail=true")


def fetch_bus_stop_ids(towns=TOWNS, radius_m=STOP_SCAN_RADIUS_M):
    ids = set()
    for town in towns:
        data = _get_json(
            f"{BASE_URL}/StopPoint?lat={town['lat']}&lon={town['lon']}"
            f"&stopTypes=NaptanPublicBusCoachTram&radius={radius_m}"
        )
        for stop in data.get("stopPoints", []):
            if stop.get("id"):
                ids.add(stop["id"])
    return sorted(ids)


def fetch_stop_disruptions(stop_ids, batch_size=STOP_IDS_PER_REQUEST):
    disruptions = []
    for start in range(0, len(stop_ids), batch_size):
        batch = stop_ids[start:start + batch_size]
        disruptions += _get_json(f"{BASE_URL}/StopPoint/{','.join(batch)}/Disruption")
    return disruptions


# ---- pure transforms: no network, covered by scripts/test_tfl_transit_status.py ----


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
            findings.append({
                "category": "road",
                "title": f"{label}: {severity_label}",
                "place": label,
                "status_label": severity_label,
                "body": body,
                "sources": [STATUS_SOURCE],
            })
    return findings


def stop_disruption_findings(disruptions_json):
    """`disruptions_json` is the /StopPoint/{ids}/Disruption response: a flat
    list of disruptions, each naming the stop(s) it affects."""
    findings = []
    for disruption in disruptions_json or []:
        stop_names = sorted({
            stop.get("commonName")
            for stop in (disruption.get("affectedStops") or [])
            if stop.get("commonName")
        })
        place = ", ".join(stop_names) if stop_names else "Epping Forest area"
        status_label = disruption.get("closureText") or disruption.get("categoryDescription") or "Disrupted"
        body = (
            disruption.get("description")
            or disruption.get("closureText")
            or disruption.get("summary")
            or f"{place}: bus stop disruption."
        )
        findings.append({
            "category": "road",
            "title": f"Bus stop disruption: {place}",
            "place": place,
            "status_label": status_label,
            "body": body,
            "sources": [STOP_SOURCE],
        })
    return findings


def collect():
    line_findings = line_status_findings(fetch_line_statuses())
    stop_findings = stop_disruption_findings(fetch_stop_disruptions(fetch_bus_stop_ids()))
    return line_findings + stop_findings


def main():
    findings = collect()
    json.dump(findings, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
