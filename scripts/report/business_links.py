"""Resolves a Ledger finding's business name to its own /find/<slug>/ page.

Reads data/business-slugs.json (scripts/regenerate-business-slugs.js) -- the
same committed index the live app and scripts/generate-business-pages.js both
read, so this never computes a slug of its own that the other two could
disagree with.

A finding (report-data.schema.md) carries a free-text title and, often, a
coordinate -- never the OSM id the index is keyed by internally, so matching
is necessarily a best-effort name join. A wrong link is worse than no link
(it would send a reader to the wrong business's page), so this stays
conservative: unambiguous name match links immediately; a name shared by
more than one place (a chain) only links when the finding's own coordinate
sits within NEARBY_METRES of exactly one candidate; anything still
ambiguous, or with no coordinate to break the tie, links to nothing.
"""
import json
import re
from math import asin, cos, radians, sin, sqrt
from pathlib import Path

SLUGS_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "business-slugs.json"
NEARBY_METRES = 75
EARTH_RADIUS_METRES = 6371000


def _normalize(name):
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def _haversine_metres(lat1, lon1, lat2, lon2):
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    h = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_METRES * asin(min(1, sqrt(h)))


class BusinessLinks:
    def __init__(self, entries):
        self._by_name = {}
        for entry in entries:
            self._by_name.setdefault(_normalize(entry.get("name")), []).append(entry)

    def _resolve(self, title, lat=None, lon=None):
        candidates = self._by_name.get(_normalize(title))
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]
        if lat is None or lon is None:
            return None
        close = [
            c for c in candidates
            if c.get("lat") is not None and c.get("lon") is not None
            and _haversine_metres(lat, lon, c["lat"], c["lon"]) <= NEARBY_METRES
        ]
        return close[0] if len(close) == 1 else None

    def url_for(self, title, lat=None, lon=None):
        entry = self._resolve(title, lat, lon)
        return f"/find/{entry['slug']}/" if entry else None

    def subcategory_for(self, title, lat=None, lon=None):
        """The app subcategory key (restaurants, shops, ...) of the resolved
        entry, by the same rule as url_for, or None."""
        entry = self._resolve(title, lat, lon)
        return (entry.get("key") or None) if entry else None


def load(path=SLUGS_PATH):
    if not path.exists():
        return BusinessLinks([])
    data = json.loads(path.read_text(encoding="utf-8"))
    return BusinessLinks(data.get("entries", []))
