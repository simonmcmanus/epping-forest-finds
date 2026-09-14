# Weekly Epping Forest Ledger — Report Generator

The weekly report is a standalone HTML page published under `reports/`, built by
`scripts/report/render_report.py` from a small structured `report-data.json`. The
generator owns the design, layout, SVG map and every number on the page; the
research and the written findings come from the weekly workflow
(`.github/workflows/weekly-ledger.yml`).

## Files

- `scripts/report/render_report.py` — entry point; renders the page
- `scripts/report/template.py` — design system (CSS, font links)
- `scripts/report/categories.py` — finding categories (opening/closing/road/event/grazing)
- `scripts/report/svg_map.py`, `geo.py`, `places.py` — the "This week on the map" SVG
- `scripts/report/jargon_guard.py` — refuses to write a report containing developer jargon
- `scripts/report/map-inventory.js` — counts everything on the map (see below)
- `scripts/test_render_report.py` — unit tests

## Stat strip

One cell per thing that changed this week (openings, closures, road/access, events,
and the cattle-grazing update when present), plus a count of the food/drink/shop
dataset labelled **"Places to eat, drink & shop"**. That label is deliberately
specific: it counts `data/local-landmarks-food.geojson` only. It must never be
labelled as a total for the map — the whole-map total belongs to the inventory
section below.

## "What's on the map" section

A running inventory of everything the app can draw: a headline total, then a
breakdown by the app's own high-level filter groups (Nature, Food, Transport,
History, Locations, Stories) with each group's subfilter counts underneath, and a
final full-width row for features that are always shown and have no filter of their
own (gates, benches, toilets and similar).

Rules:

- The breakdown must add up to the headline total. A place matching more than one
  subfilter is counted once, under the first match in `PLACE_FILTER_PRIORITY` —
  the same order the map uses to pick a pin's icon.
- Counts come from `scripts/report/map-inventory.js`, which loads
  `js/categories.js` and `js/normalize.js` and classifies places with the app's own
  `matchesPlaceFilter`. The report must never re-implement classification in
  Python: the numbers would drift from what the app actually shows, which is the
  problem this section exists to solve.
- Trees are counted from `data/trees/index.json`'s `recordCount`; ponds and streams
  from `extractWaterFeatures` over `data/local-environment.geojson`.
- Cattle are excluded — they are tracked live from the grazing collars, not stored
  with the map data — and so are the roads, paths and water drawn as base layers.
  The section says both in plain English.
- The inventory is read at render time, after the week's data changes have been
  applied, so the report always describes the map as it will be once the week's
  changes are live.

`map-inventory.js` takes an optional `--root <dir>` to read data from a different
directory (the report's own tests render against a stand-in). The classification
rules always come from this checkout's `js/`. When the data files are absent the
inventory is empty and the section is omitted entirely.
