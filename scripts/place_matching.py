#!/usr/bin/env python3
"""
Deciding whether two records describe the same premises.

Shared by the business-watch sources (scripts/osm_business_diff.py,
scripts/fsa_business_diff.py), because getting this wrong in either direction
is what made the earlier checks useless:

- match too loosely (name alone, anywhere in the area) and a new branch of a
  chain is silently treated as one we already have, so it never gets added
- match too tightly and the same shop nudged a few metres onto the right
  building reads as an opening plus a closure

Pure functions, no network, no file access. See scripts/test_place_matching.py.
"""
import math
import re

# Two records this far apart at most, with the same name, are the same
# business. Roughly a high-street block: forgiving about which side of the
# pavement a point sits on, unforgiving about the next town along.
NAME_MATCH_RADIUS_M = 250

# Words that say what a business is rather than which business it is. A
# council's food-hygiene register writes "The Bell Public House" where a map
# writes "The Bell"; neither is wrong and they are the same pub.
NOISE_WORDS = {
    "the", "ltd", "limited", "plc", "uk", "co", "company",
    "restaurant", "cafe", "café", "coffee", "shop", "store",
    "public", "house", "bar", "inn", "tavern", "takeaway",
}


def normalize_name(name):
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def name_key(name):
    """A comparison key that survives the cosmetic differences between
    sources: punctuation, casing, and the words that describe a trade rather
    than name a business. Falls back to the plain normalised name when
    stripping the noise would leave nothing -- "The Bar" is a name."""
    # Apostrophes close up ("Green's" -> "greens"); everything else becomes a
    # word break, so "Fish & Chips" and "Fish and Chips" land on the same key.
    without_apostrophes = re.sub(r"['‘’ʼ]", "", normalize_name(name))
    cleaned = re.sub(r"[^a-z0-9\s]", " ", without_apostrophes)
    words = [w for w in cleaned.split() if w]
    kept = [w for w in words if w not in NOISE_WORDS]
    return " ".join(kept or words)


def compact_name(name):
    """A key that survives spacing and ampersands: "CHAPTER 21" and
    "Chapter21" both become "chapter21", "Bobo & Wild" and "Bobo and Wild"
    both become "boboandwild".

    name_key() cannot do this. It splits on whitespace to drop the words that
    describe a trade, so a space is meaningful to it and "chapter 21" stays
    two tokens. Both keys are needed: this one catches a name typed
    differently, that one catches a name described differently.
    """
    lowered = normalize_name(name).replace("&", " and ")
    return re.sub(r"[^a-z0-9]", "", lowered)


def names_look_like_one_place(a, b):
    """Either kind of match. A weekly run adding a hundred places a week meets
    both: "CHAPTER 21" beside the mapped "Chapter21" (spacing), and "Bell Inn"
    beside "The Bell" (wording)."""
    if not (normalize_name(a) and normalize_name(b)):
        return False
    return name_key(a) == name_key(b) or compact_name(a) == compact_name(b)


def metres_between(a, b):
    """Equirectangular approximation. Over the few hundred metres this is ever
    asked about it is indistinguishable from the real thing, and it keeps the
    matching cheap enough to run against every point in the dataset."""
    (lon_a, lat_a), (lon_b, lat_b) = a, b
    mean_lat = math.radians((lat_a + lat_b) / 2)
    dx = math.radians(lon_b - lon_a) * math.cos(mean_lat)
    dy = math.radians(lat_b - lat_a)
    return math.hypot(dx, dy) * 6371000


def feature_lonlat(feature):
    """(lon, lat) of a GeoJSON point feature, or None if it has no usable
    geometry -- which a hand-written test fixture or a manual entry may not."""
    geometry = (feature or {}).get("geometry") or {}
    coords = geometry.get("coordinates")
    if geometry.get("type") == "Point" and coords and len(coords) >= 2:
        return float(coords[0]), float(coords[1])
    return None


def same_premises(record, feature, radius_m=NAME_MATCH_RADIUS_M):
    """Is this record the same place as one the map already has -- allowing
    for a name typed or described differently, and only within `radius_m`?

    Used before adding, where the question is "have we got this already?"
    rather than "which source record matches which pin". Without coordinates
    on both sides the name has to carry it alone.
    """
    existing = (feature.get("properties") or {}).get("name")
    if not names_look_like_one_place(record.get("name"), existing):
        return False
    here = feature_lonlat(feature)
    if here is None or record.get("lon") is None or record.get("lat") is None:
        return True
    return metres_between((record["lon"], record["lat"]), here) <= radius_m


def same_place(record, feature, radius_m=NAME_MATCH_RADIUS_M, fuzzy=False):
    """Does `record` ({name, lon, lat}) describe the same premises as GeoJSON
    `feature`? When either side has no coordinates the name has to carry it
    alone -- that is the best available and is how manual entries match.

    `fuzzy` compares name_key()s rather than exact names. Sources that list
    businesses as their owners registered them (a council's food-hygiene
    register) need it; OpenStreetMap, which is edited to match the sign over
    the door, does not.
    """
    if fuzzy:
        matched = name_key(record.get("name")) == name_key((feature.get("properties") or {}).get("name"))
    else:
        matched = normalize_name(record.get("name")) == normalize_name((feature.get("properties") or {}).get("name"))
    if not matched:
        return False
    here = feature_lonlat(feature)
    if here is None or record.get("lon") is None or record.get("lat") is None:
        return True
    return metres_between((record["lon"], record["lat"]), here) <= radius_m


def within_bbox(lon, lat, bbox):
    return (
        lon is not None and lat is not None
        and bbox["west"] <= lon <= bbox["east"]
        and bbox["south"] <= lat <= bbox["north"]
    )
