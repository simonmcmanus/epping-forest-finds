#!/usr/bin/env python3
"""
The weekly business watchlist: the memory that turns one week's "worth
checking" into next week's confident change.

Background. The weekly ledger workflow has always been able to *spot* that a
business looks wrong -- scripts/osm_business_diff.py has produced
"new_candidates" and "missing_candidates" since it was written. What it could
not do was act on them. Every run started from nothing, so a point that had
been missing from OpenStreetMap for six months looked exactly like one that
went missing last Tuesday, and the only instruction covering either was
"cross-check anything promising". In practice nothing was ever confident
enough to apply, and the map kept businesses that had closed years earlier.

This module is the missing half. It keeps a small ledger
(data/business-watch.json) of what each source said about each place, week by
week, and escalates a signal to "confident" once it has repeated often enough
to stop looking like source lag. Confident entries become a changeset that
scripts/apply_weekly_changeset.py applies mechanically, so the weekly run
proposes a real diff for review instead of a paragraph of prose.

Everything here is pure: no network, no clock of its own (the caller passes
today's date), no file I/O beyond load_ledger/save_ledger. See
scripts/test_business_watch.py.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LEDGER_PATH = ROOT / "data" / "business-watch.json"

LEDGER_VERSION = 1

# What each signal means, and how many consecutive weekly runs it takes
# before we are willing to change the map on the strength of it.
#
# - "closed": a source states the closure outright -- OpenStreetMap carries
#   disused:/was:/vacant tags on the very spot. Somebody went and recorded it,
#   so there is nothing to wait for.
# - "missing": the place simply is not in this week's source data. That is
#   weaker: a source can lag, and a single flaky query should never delete
#   anything. Three weeks running is long past lag.
# - "new"/"changed": an opening, or a rename/change of use at a place we
#   already know. Two weeks is enough to rule out a mapping accident that
#   somebody reverts.
CONFIDENT_AFTER_RUNS = {
    "closed": 1,
    "missing": 3,
    "new": 2,
    "changed": 2,
}

SIGNALS = tuple(CONFIDENT_AFTER_RUNS)

# Signals that take something off the map, as opposed to putting something on
# it. Removals are the dangerous direction -- an addition that turns out to be
# wrong is one extra pin, a removal is a place a walker can no longer find --
# so they are capped separately in build_changeset().
REMOVAL_SIGNALS = ("closed", "missing")

# The most entries a single unattended run may remove. A source outage that
# returns a short list would otherwise read as hundreds of simultaneous
# closures. Well above a plausible real week (a busy week is a handful) and
# well below the damage a bad query could do.
MAX_AUTO_REMOVALS = 12

# The most places a single unattended run may add. Removals were capped from
# the start; additions were not, and the first run to reach the food-hygiene
# register banked 679 of them in one go -- every one legitimately near the
# forest, every one due to turn confident on the same day a week later. That
# would have arrived as a pull request proposing 679 additions: unreviewable,
# and quite capable of doubling the food dataset overnight on a source that
# cannot tell a cafe from a restaurant.
#
# Over the cap the run takes the longest-waiting and leaves the rest queued,
# rather than holding everything back as a removal overflow does. An addition
# that is wrong is one extra pin; the risk is the size of the batch, not the
# direction, so a steady trickle drains the queue while staying readable.
MAX_AUTO_ADDITIONS = 15


def empty_ledger():
    return {"version": LEDGER_VERSION, "updatedAt": None, "entries": {}}


def load_ledger(path=DEFAULT_LEDGER_PATH):
    path = Path(path)
    if not path.exists():
        return empty_ledger()
    ledger = json.loads(path.read_text())
    ledger.setdefault("version", LEDGER_VERSION)
    ledger.setdefault("entries", {})
    return ledger


def save_ledger(ledger, path=DEFAULT_LEDGER_PATH):
    Path(path).write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n")


def is_dismissed(entry):
    """A human can park a false positive by setting "dismissed": true on its
    entry by hand. Without that there is no way to stop the weekly run
    re-proposing the same wrong change forever, which is the quickest way to
    make an automated PR something people stop reading."""
    return bool(entry.get("dismissed"))


def is_confident(entry, thresholds=None):
    if is_dismissed(entry):
        return False
    # An entry another source's entry already speaks for must not produce a
    # second copy of the same place. See link_agreements().
    if entry.get("supersededBy"):
        return False
    thresholds = thresholds or CONFIDENT_AFTER_RUNS
    needed = thresholds.get(entry.get("signal"))
    if needed is None:
        return False
    # Two sources that have never heard of each other describing the same new
    # place is better evidence than one source repeating itself, so it does
    # not have to wait out the patience the single-source case needs.
    # Agreement only means anything for an opening: "absent" is the one thing
    # sources are unreliable about in the same direction, since neither knows
    # about a place nobody has recorded.
    if entry.get("signal") == "new" and entry.get("agreedWith"):
        return True
    return int(entry.get("runs", 0)) >= needed


def record_run(ledger, observations, today, thresholds=None, sources=None):
    """Folds one run's observations into the ledger and returns it.

    An observation is {"key", "signal", "source", "detail"}: `key` identifies
    the place across runs (an OSM "node/123", or a source-specific id), and
    `detail` carries everything build_changeset() will need, so a confident
    entry never has to be researched again.

    An entry whose signal repeats has its run count raised. An entry whose
    signal changes starts again from one -- the evidence is about something
    else now. Anything this run did not see at all is dropped, so a one-off
    outage cannot accumulate into confidence over time; dismissed entries are
    the exception and are kept untouched so they stay parked.

    `sources` names which sources this run actually checked. Entries from any
    other source are carried over untouched -- several sources share one
    watchlist and run separately, so "I did not see it" from the food-hygiene
    register must not clear what OpenStreetMap recorded an hour earlier.
    Passing None means the run covers everything in the ledger.
    """
    thresholds = thresholds or CONFIDENT_AFTER_RUNS
    previous = ledger.get("entries", {})
    entries = {}

    if sources is not None:
        for key, entry in previous.items():
            if entry.get("source") not in sources:
                entries[key] = entry

    for observation in observations:
        key = observation["key"]
        signal = observation["signal"]
        if signal not in thresholds:
            raise ValueError(f"unknown signal {signal!r} (known: {sorted(thresholds)})")
        before = previous.get(key)
        if before and is_dismissed(before):
            entries[key] = before
            continue
        continuing = bool(before) and before.get("signal") == signal
        entries[key] = {
            "signal": signal,
            "source": observation.get("source"),
            "name": (observation.get("detail") or {}).get("name"),
            # .get rather than [], because this file can be edited by hand to
            # park a false positive and a missing key should not crash a run.
            "firstSeen": before.get("firstSeen", today) if continuing else today,
            "lastSeen": today,
            "runs": int(before.get("runs", 0)) + 1 if continuing else 1,
            "detail": observation.get("detail") or {},
        }

    for key, entry in previous.items():
        if key not in entries and is_dismissed(entry):
            entries[key] = entry

    for entry in entries.values():
        entry["confident"] = is_confident(entry, thresholds)

    ledger["version"] = LEDGER_VERSION
    ledger["updatedAt"] = today
    ledger["entries"] = entries
    return ledger


def link_agreements(ledger, radius_m=None):
    """Finds entries from different sources that describe the same new place,
    and links them.

    Two things come out of this. The obvious one is confidence: OpenStreetMap
    and a council's register both saying a cafe has opened, independently, is
    stronger than either saying it twice. The less obvious one matters more --
    without this, both entries produce an addition and the map grows two pins
    for one cafe. One entry is chosen to speak for the place and the rest are
    marked as spoken for.

    The survivor is the one carrying an OpenStreetMap id where there is one,
    because that id is how every later run recognises the place again; an
    entry added without one can only ever be matched by name.
    """
    from scripts.place_matching import NAME_MATCH_RADIUS_M, metres_between, name_key

    radius_m = NAME_MATCH_RADIUS_M if radius_m is None else radius_m
    openings = [
        (key, entry) for key, entry in ledger.get("entries", {}).items()
        if entry.get("signal") == "new" and not is_dismissed(entry)
    ]

    for key, entry in openings:
        entry.pop("agreedWith", None)
        entry.pop("supersededBy", None)

    groups = {}
    for key, entry in openings:
        detail = entry.get("detail") or {}
        groups.setdefault(name_key(detail.get("name")), []).append((key, entry))

    for members in groups.values():
        if len(members) < 2:
            continue
        for index, (key, entry) in enumerate(members):
            detail = entry.get("detail") or {}
            for other_key, other in members[index + 1:]:
                other_detail = other.get("detail") or {}
                if other.get("source") == entry.get("source"):
                    continue
                if None in (detail.get("lon"), detail.get("lat"), other_detail.get("lon"), other_detail.get("lat")):
                    continue
                if metres_between((detail["lon"], detail["lat"]), (other_detail["lon"], other_detail["lat"])) > radius_m:
                    continue
                keeper, spoken_for = (key, other_key)
                if not (entry.get("detail") or {}).get("osmId") and (other.get("detail") or {}).get("osmId"):
                    keeper, spoken_for = (other_key, key)
                entries = ledger["entries"]
                entries[keeper].setdefault("agreedWith", [])
                if spoken_for not in entries[keeper]["agreedWith"]:
                    entries[keeper]["agreedWith"].append(spoken_for)
                entries[spoken_for]["supersededBy"] = keeper

    for entry in ledger.get("entries", {}).values():
        entry["confident"] = is_confident(entry)
    return ledger


def reported_missing(ledger):
    """Places a person has said are missing from the map.

    Somebody walking the high street spots a gap long before any source does,
    and until now there was nowhere to put that: it lived in a message and was
    gone by the next run. An entry here is a standing instruction to the
    weekly run -- find it, add it, and take it off this list -- rather than a
    signal to be escalated, so it carries no run count.
    """
    return ledger.get("reportedMissing") or []


def confident_entries(ledger, thresholds=None):
    return {
        key: entry
        for key, entry in ledger.get("entries", {}).items()
        if is_confident(entry, thresholds)
    }


def pending_entries(ledger, thresholds=None):
    """Everything still short of its threshold, with how far it has to go --
    this is what the weekly pull request quotes so a reviewer can see what is
    being watched, not just what was changed."""
    thresholds = thresholds or CONFIDENT_AFTER_RUNS
    out = {}
    for key, entry in ledger.get("entries", {}).items():
        if is_confident(entry, thresholds) or is_dismissed(entry):
            continue
        needed = thresholds.get(entry.get("signal"), 0)
        out[key] = {**entry, "runsNeeded": needed, "runsRemaining": max(0, needed - int(entry.get("runs", 0)))}
    return out


def build_changeset(ledger, thresholds=None, max_removals=MAX_AUTO_REMOVALS,
                    max_additions=MAX_AUTO_ADDITIONS):
    """Turns the confident half of the ledger into an apply_weekly_changeset.py
    changeset. Returns (changeset, notes) -- `notes` explains anything held
    back, and belongs in the pull request body.

    A "changed" entry (the unit at a known place now trades under a different
    name) is both a removal and an addition: the old name goes, the successor
    arrives at the same coordinates. That pairing is the case the old diff
    could not see at all, because the underlying map element never moved --
    the Loughton site that went from Wildwood to something else kept its
    OpenStreetMap id throughout, so nothing ever looked missing.
    """
    confident = confident_entries(ledger, thresholds)
    add, remove, notes = [], [], []

    for key, entry in sorted(confident.items()):
        detail = entry.get("detail") or {}
        signal = entry["signal"]
        if signal in REMOVAL_SIGNALS:
            remove.append({
                "id": detail.get("id") or key,
                "name": detail.get("name"),
                "reason": detail.get("reason") or f"{signal} in {entry.get('source')} data for {entry.get('runs')} weekly checks running",
            })
        elif signal == "new":
            add.append({**_addition(detail), "_firstSeen": entry.get("firstSeen")})
        elif signal == "changed":
            if detail.get("previousName"):
                remove.append({
                    "id": detail.get("id") or key,
                    "name": detail.get("previousName"),
                    "reason": detail.get("reason") or f"now trading as {detail.get('name')}",
                })
            add.append({**_addition(detail), "_firstSeen": entry.get("firstSeen")})

    if len(remove) > max_removals:
        notes.append(
            f"{len(remove)} removals were confident this run, more than the {max_removals} "
            "a single unattended run is allowed to make. Nothing was removed -- that many at "
            "once usually means a source returned a short list, not that a whole high street "
            "closed. Needs a look by hand."
        )
        remove = []

    if len(add) > max_additions:
        waiting = len(add) - max_additions
        # Longest-waiting first, so the queue drains in a stable order and
        # nothing can sit at the back of it forever.
        add.sort(key=lambda entry: (entry.pop("_firstSeen", "") or "", entry.get("name") or ""))
        add = add[:max_additions]
        notes.append(
            f"{max_additions} of {max_additions + waiting} confident additions were applied, "
            f"longest-waiting first; {waiting} are queued for later runs. A batch that size "
            "arrives when a source is read for the first time, and it is too much to review "
            "at once -- they are not lost, just spread out."
        )
    else:
        for entry in add:
            entry.pop("_firstSeen", None)

    return {"add": add, "remove": remove}, notes


def _addition(detail):
    entry = {
        "name": detail.get("name"),
        "category": detail.get("category"),
        "lon": detail.get("lon"),
        "lat": detail.get("lat"),
    }
    for optional in ("address", "website", "phone", "osmType", "osmId"):
        if detail.get(optional) is not None:
            entry[optional] = detail[optional]
    return entry


def summarise(ledger, thresholds=None):
    """One-line-per-entry summary for the workflow log and the pull request."""
    thresholds = thresholds or CONFIDENT_AFTER_RUNS
    lines = []
    for key, entry in sorted(ledger.get("entries", {}).items()):
        needed = thresholds.get(entry.get("signal"), 0)
        state = "dismissed" if is_dismissed(entry) else ("confident" if is_confident(entry, thresholds) else f"{entry.get('runs')}/{needed}")
        lines.append(f"{key}  {entry.get('signal'):>7}  {state:>10}  {entry.get('name') or ''}")
    return "\n".join(lines)
