#!/usr/bin/env python3
"""
Turns the hand-researched data/road-closures.json, data/forest-notices.json
and data/forest-events.json into report-data.json "findings" -- so a
multi-week roadworks project or a dated event shows up every week it is
genuinely happening, not only the week a web search happened to resurface it.

This never replaces the weekly research step: it is a floor, not a ceiling.
An entry still needs a person or the weekly run to keep lastVerified current
and to retire it once it is no longer true -- this script only decides
whether an already-researched entry is still within its own stated dates.

Usage:
    python3 scripts/report/structured_findings.py [--as-of YYYY-MM-DD] [--root DIR]

Prints a JSON list of findings to stdout, ready to extend
report-data.json's "findings" array.
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

EVENT_HORIZON_DAYS = 21
NEEDS_CHECK_SUFFIX = (
    " Not confirmed again this week -- worth checking before relying on it."
)

# Standing visit notices don't have a report category of their own yet
# (see spec/spec-weekly-report.md); they read naturally under the existing
# "Road closures & access" section, which the report already titles broadly.
NOTICE_CATEGORY = "road"


def _parse_partial_date(value):
    """"YYYY-MM-DD", "YYYY-MM" or "YYYY" -> a date, rounded down to day 1."""
    if not value:
        return None
    parts = [int(p) for p in str(value).split("-")]
    while len(parts) < 3:
        parts.append(1)
    year, month, day = parts[:3]
    return date(year, month, day)


def _is_active(start, end, as_of):
    start_date = _parse_partial_date(start)
    end_date = _parse_partial_date(end)
    if start_date and start_date > as_of:
        return False
    if end_date and end_date < as_of:
        return False
    return True


def _finding(category, entry, status_label, body):
    finding = {
        "category": category,
        "title": entry["title"],
        "place": entry["place"],
        "status_label": status_label,
        "body": body + (NEEDS_CHECK_SUFFIX if entry.get("needsReverification") else ""),
    }
    if "lon" in entry and "lat" in entry:
        finding["lon"] = entry["lon"]
        finding["lat"] = entry["lat"]
    if entry.get("sources"):
        finding["sources"] = entry["sources"]
    return finding


def road_closure_findings(entries, as_of):
    return [
        _finding("road", e, "Ongoing", e["body"])
        for e in entries
        if _is_active(e.get("startDate"), e.get("endDate"), as_of)
    ]


def notice_findings(entries, as_of):
    return [
        _finding(NOTICE_CATEGORY, e, "Ongoing", e["body"])
        for e in entries
        if _is_active(e.get("startDate"), e.get("endDate"), as_of)
    ]


def event_findings(entries, as_of, horizon_days=EVENT_HORIZON_DAYS):
    out = []
    for e in entries:
        event_date = _parse_partial_date(e.get("date"))
        if event_date is None:
            # A recurring series with no next date confirmed -- surface it,
            # but never pretend to know when it next happens.
            out.append(_finding("event", e, "Recurring", e["body"]))
            continue
        if event_date < as_of or (event_date - as_of).days > horizon_days:
            continue
        label = "Today" if event_date == as_of else "Coming up"
        out.append(_finding("event", e, label, e["body"]))
    return out


def collect(root, as_of):
    def load(name):
        path = root / name
        if not path.exists():
            return []
        with path.open() as f:
            return json.load(f).get("entries", [])

    findings = []
    findings += road_closure_findings(load("road-closures.json"), as_of)
    findings += notice_findings(load("forest-notices.json"), as_of)
    findings += event_findings(load("forest-events.json"), as_of)
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", help="YYYY-MM-DD, defaults to today")
    parser.add_argument(
        "--root", default="data", help="directory holding the three source files"
    )
    args = parser.parse_args()

    as_of = _parse_partial_date(args.as_of) if args.as_of else date.today()
    findings = collect(Path(args.root), as_of)
    json.dump(findings, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
