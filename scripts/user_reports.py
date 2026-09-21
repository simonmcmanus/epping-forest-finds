#!/usr/bin/env python3
"""
Brings what people report from inside the app into the weekly run.

The app's "report a problem" screen already posts to
netlify/functions/report-missing-data.js, which opens a GitHub issue
labelled `user-report` carrying the reporter's own words and, when they had
granted location, the GPS fix they were standing on. That is the best
accuracy signal this project has -- a person in front of the thing, with
coordinates -- and until now the weekly run never read a single one of them.
Reports sat in the issue tracker; the map stayed as it was.

This reads the open ones and folds them into the same watchlist the
OpenStreetMap and food-hygiene checks feed (see scripts/business_watch.py),
under "reportedMissing". They are not signals to be escalated: a person has
already seen it, so there is nothing to grow more confident about. They are
standing instructions -- look this up, put it on the map, close the issue --
and they stay on the list until one of those happens.

What it deliberately does not do is act on them by itself. A report is free
text ("Tree 04406 is missing", "Show me horses"), which is not a name, a
category and a position, and guessing at those is how a map fills up with
things that are not there. The run reads the report, does the lookup, and
proposes a change a person can review.

Usage:
    python3 scripts/user_reports.py [--ledger PATH] [--out PATH]
                                    [--repo owner/name] [--no-record]

Network: the GitHub REST API. This repository is public, so its issues read
without a token at all; GITHUB_TOKEN or GH_TOKEN is used when present, and is
worth having anyway because unauthenticated requests are rate limited per IP
and an Actions runner's IP is shared. A token that cannot see issues gets a
403 rather than an empty list, and that is reported loudly -- "not allowed to
look" must never pass for "nothing to report". Parsing takes plain Python
data and has no network dependency -- see scripts/test_user_reports.py.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts import business_watch  # noqa: E402

DEFAULT_REPO = "simonmcmanus/epping-forest-finds"
API_BASE = "https://api.github.com"
REQUEST_TIMEOUT_S = 30

# The label netlify/functions/report-missing-data.js puts on everything it
# opens. `feature-request` issues carry it too, and those are not map data --
# they are filtered out by their own label below.
REPORT_LABEL = "user-report"
FEATURE_LABEL = "feature-request"

SOURCE = "report"

# Matches the "- Reported location: 51.65, 0.05" line the function writes when
# the reporter had granted location. Everything else in the body is prose.
LOCATION_RE = re.compile(r"^-\s*Reported location:\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$", re.MULTILINE)
TITLE_PREFIX_RE = re.compile(r"^(Missing map data|Feature request):\s*", re.IGNORECASE)


def _auth_headers():
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "epping-forest-finds-weekly"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def is_authenticated():
    return bool(os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"))


def fetch_open_reports(repo=DEFAULT_REPO, timeout=REQUEST_TIMEOUT_S):
    """Network call. Open issues carrying the app's report label."""
    url = f"{API_BASE}/repos/{repo}/issues?state=open&labels={REPORT_LABEL}&per_page=100"
    request = urllib.request.Request(url, headers=_auth_headers())
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _labels_of(issue):
    return {
        (label.get("name") if isinstance(label, dict) else label)
        for label in issue.get("labels", []) or []
    }


def is_map_data_report(issue):
    """A feature request is somebody asking for the app to do something, not
    telling us the map is wrong. Only the latter is this run's business."""
    if issue.get("pull_request"):
        return False
    labels = _labels_of(issue)
    return REPORT_LABEL in labels and FEATURE_LABEL not in labels


def parse_report(issue):
    """Turns one issue into a watchlist entry. The body's shape comes from
    report-missing-data.js: the reporter's words under "## Report", then a
    "## Metadata" list which may carry the position they were standing on."""
    body = issue.get("body") or ""
    details = body.split("## Metadata")[0].replace("## Report", "").strip()
    entry = {
        "issue": issue.get("number"),
        "url": issue.get("html_url"),
        "reportedOn": (issue.get("created_at") or "")[:10] or None,
        "name": TITLE_PREFIX_RE.sub("", issue.get("title") or "").strip() or None,
        "note": details or None,
        "source": SOURCE,
    }
    match = LOCATION_RE.search(body)
    if match:
        entry["lat"] = float(match.group(1))
        entry["lon"] = float(match.group(2))
    return entry


def merge_into_ledger(ledger, reports):
    """Adds reports the ledger has not seen, keyed by issue number so a run
    cannot list the same one twice, and leaves every existing entry alone --
    including the ones written by hand, which have no issue behind them.

    Nothing is ever removed here. A report leaves this list when the weekly
    run has actually dealt with it and taken it off, which is the point: an
    entry that keeps reappearing is one nobody has answered.
    """
    existing = business_watch.reported_missing(ledger)
    known = {e.get("issue") for e in existing if e.get("issue") is not None}
    added = [r for r in reports if r.get("issue") not in known]
    ledger["reportedMissing"] = existing + added
    return added


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", default=str(business_watch.DEFAULT_LEDGER_PATH))
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY") or DEFAULT_REPO)
    parser.add_argument("--out", default=None, help="Write JSON here instead of stdout")
    parser.add_argument("--no-record", action="store_true", help="Report only; leave the watchlist untouched")
    args = parser.parse_args()

    try:
        issues = fetch_open_reports(args.repo)
    except urllib.error.HTTPError as exc:
        # Told apart from a network failure on purpose. A token that cannot
        # see issues is the one failure that could otherwise pass for a quiet
        # week, because "no reports" and "not allowed to look" produce the
        # same empty list everywhere downstream.
        if exc.code in (401, 403, 404):
            print(
                f"The reports could not be read: GitHub answered {exc.code}. The token this "
                "run has cannot see this repository's issues -- it needs Issues: Read. Until "
                "that is fixed this check finds nothing, which is NOT the same as there being "
                "nothing, and the pull request must say so rather than reporting a quiet week.",
                file=sys.stderr,
            )
        else:
            print(f"Could not read the reports people have sent (HTTP {exc.code}).", file=sys.stderr)
        sys.exit(2)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(
            f"Could not read the reports people have sent ({exc}). Everything else in this "
            "run is unaffected, but say so in the pull request -- those reports are the best "
            "evidence there is and skipping them silently is how they go unanswered.",
            file=sys.stderr,
        )
        sys.exit(2)

    reports = [parse_report(i) for i in issues if is_map_data_report(i)]
    result = {
        "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        # Recorded so a zero is never ambiguous. This repository is public, so
        # its issues read fine without a token -- but unauthenticated requests
        # are rate limited per IP, which on a shared Actions runner is a real
        # way to get an empty list that means nothing of the sort.
        "authenticated": is_authenticated(),
        "open_reports": reports,
        "with_location": sum(1 for r in reports if r.get("lat") is not None),
    }

    if not args.no_record:
        ledger = business_watch.load_ledger(args.ledger)
        added = merge_into_ledger(ledger, reports)
        business_watch.save_ledger(ledger, args.ledger)
        result["newly_added"] = [r["issue"] for r in added]

    output = json.dumps(result, indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n")
        print(
            f"Wrote {args.out}: {len(reports)} open report(s) from people using the app, "
            f"{result['with_location']} with a position attached.",
            file=sys.stderr,
        )
    else:
        print(output)


if __name__ == "__main__":
    main()
