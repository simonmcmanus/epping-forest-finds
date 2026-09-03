"""
A regression guard for one specific requirement: the weekly report must be
readable by someone who has never heard of this app, its git history, or
OpenStreetMap ids. render_report.py runs this on every section's rendered
text and refuses to write the report if any of this slips back in.

Deliberately narrow: it flags internal/dev-process jargon (raw OSM ids,
file paths, git/PR terms, "changeset"/"diff" talk), not legitimate
source-crediting language like "OpenStreetMap" or "the map" -- a report
telling a reader where information came from is exactly what we want to
keep.
"""
import re

JARGON_PATTERNS = [
    (re.compile(r"\bway/\d+\b"), "raw OSM way id (e.g. way/12345)"),
    (re.compile(r"\bnode/\d+\b"), "raw OSM node id (e.g. node/12345)"),
    (re.compile(r"\.geojson\b", re.I), "a data file name (.geojson)"),
    (re.compile(r"\bdata/local-[\w-]+\b"), "an internal file path"),
    (re.compile(r"\bgit (branch|commit|worktree|push|diff|checkout)\b", re.I), "a git operation"),
    (re.compile(r"\bworktree\b", re.I), "the word 'worktree'"),
    (re.compile(r"\bpull request\b|\bPR #?\d+\b", re.I), "pull request / PR talk"),
    (re.compile(r"\bchangeset\b", re.I), "the word 'changeset'"),
    (re.compile(r"\bunit test(s|ing)?\b", re.I), "unit test talk"),
    (re.compile(r"\bcommit(ted|s|ting)?\b", re.I), "the word 'commit'"),
    (re.compile(r"\bGitHub Actions\b", re.I), "GitHub Actions"),
    (re.compile(r"\brepo(sitory)?\b", re.I), "the word 'repo(sitory)'"),
]


def strip_html_tags(html):
    """Visible text only -- so a URL in an href (which may legitimately
    contain path-like segments) is never scanned, only what a reader sees."""
    text = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def find_jargon(text):
    """Returns a list of (matched_text, explanation) pairs found in `text`."""
    found = []
    for pattern, explanation in JARGON_PATTERNS:
        for match in pattern.finditer(text):
            found.append((match.group(0), explanation))
    return found


def assert_reader_friendly(html):
    """Raises ValueError with every offending phrase if the rendered
    report's visible text contains internal/dev jargon."""
    text = strip_html_tags(html)
    hits = find_jargon(text)
    if hits:
        details = "; ".join(f"{phrase!r} ({why})" for phrase, why in hits)
        raise ValueError(
            "Report contains technical jargon a general reader wouldn't "
            f"understand -- rewrite these in plain English: {details}"
        )
