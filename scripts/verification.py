#!/usr/bin/env python3
"""
Remembers when each place on the map was last confirmed to still be there.

Nothing recorded this before, which made "how stale is the map?" a question
only a walk could answer -- and that is exactly how it got answered: someone
walked through Loughton and found a restaurant that had closed two years
earlier still drawn on the map. A point that no source has confirmed since it
was first generated looks identical to one confirmed on Monday.

Every weekly run sees, as a side effect of diffing, which of our points the
sources still list. That is a confirmation, and it is free. This keeps them.

Why a separate file rather than a field on each feature
-------------------------------------------------------
Stamping every confirmed point inside the GeoJSON would rewrite hundreds of
features every week, burying a week's three real changes in a diff nobody can
read. The confirmations live in data/verification.json instead, one compact
line per place, the same way data/cow-grazing-history.json already carries
weekly state without touching the map data.

The format is deliberately plain: {"node/123": "osm@2026-09-21"}. One source,
one date, one line, and a diff that shows exactly which places were seen this
week.

Pure apart from load/save -- the caller passes today's date. See
scripts/test_verification.py.
"""
import json
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "data" / "verification.json"

VERSION = 1

# A place unconfirmed for longer than this is what the weekly report calls
# stale. Twelve weeks: long enough that a quiet source or a run that skipped a
# week does not raise it, short enough that a closed shop does not sit there
# for a year.
STALE_AFTER_DAYS = 84


def empty():
    return {"version": VERSION, "updatedAt": None, "confirmed": {}}


def load(path=DEFAULT_PATH):
    path = Path(path)
    if not path.exists():
        return empty()
    data = json.loads(path.read_text())
    data.setdefault("version", VERSION)
    data.setdefault("confirmed", {})
    return data


def save(record, path=DEFAULT_PATH):
    Path(path).write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")


def encode(source, day):
    return f"{source}@{day}"


def decode(value):
    """Returns (source, day). Tolerates a malformed entry rather than failing
    a whole run over one line somebody edited by hand."""
    text = str(value or "")
    if "@" not in text:
        return None, None
    source, _, day = text.partition("@")
    return source or None, day or None


def record_confirmations(record, keys, source, today):
    """Marks each key as confirmed by `source` on `today`.

    A later confirmation always wins: being seen this week is the freshest
    thing that can be said about a place, whichever source saw it.
    """
    confirmed = record.setdefault("confirmed", {})
    for key in keys:
        if not key:
            continue
        confirmed[key] = encode(source, today)
    record["version"] = VERSION
    record["updatedAt"] = today
    return record


def _as_date(day):
    try:
        return datetime.strptime(day, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def days_since(record, key, today):
    """How long since this place was last confirmed, or None if it never was."""
    source, day = decode(record.get("confirmed", {}).get(key))
    seen = _as_date(day)
    now = _as_date(today) if isinstance(today, str) else today
    if seen is None or now is None:
        return None
    return (now - seen).days


def is_stale(record, key, today, after_days=STALE_AFTER_DAYS):
    """Never confirmed counts as stale. That is the honest reading: the map
    has no evidence the place is still there, and most of the datasets have
    had none since the day they were generated."""
    age = days_since(record, key, today)
    return age is None or age > after_days


def summarise(record, keys, today, after_days=STALE_AFTER_DAYS):
    """Counts for a set of place keys: how many are confirmed, how many
    recently, how many have never been confirmed at all."""
    keys = list(keys)
    never = sum(1 for k in keys if days_since(record, k, today) is None)
    stale = sum(1 for k in keys if is_stale(record, k, today, after_days))
    ages = [a for a in (days_since(record, k, today) for k in keys) if a is not None]
    return {
        "total": len(keys),
        "confirmed": len(keys) - never,
        "neverConfirmed": never,
        "stale": stale,
        "fresh": len(keys) - stale,
        "oldestConfirmationDays": max(ages) if ages else None,
    }


def today_iso():
    return date.today().isoformat()
