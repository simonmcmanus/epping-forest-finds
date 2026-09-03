# Weekly report data format

Input to `scripts/report/render_report.py`. This is the *only* thing the
weekly research step needs to produce -- the script owns the map, the CSS,
the layout and the point-count stats.

Write every piece of prose here in plain English, as if explaining it to a
neighbour who has never seen this project's code: no file names, OSM
node/way ids, branch names, or git/PR/CI talk. The renderer will refuse to
write the report if any of that slips in (see `jargon_guard.py`).

```jsonc
{
  // Required.
  "date": "2026-09-03",                       // YYYY-MM-DD, used in the output filename
  "date_display": "Wednesday, 3 September 2026",

  // Optional. Shown in the coloured banner under the title, if given.
  "intro": "A short plain-English line about anything unusual this run.",

  // Optional. Defaults to the 8 coverage settlements (see places.py).
  "coverage_area": ["Loughton", "Chingford", "..."],

  // Optional. Overrides the default app-link URL.
  "app_link": "https://epping-forest.netlify.app",

  // Optional. Overrides the default "About this report" paragraph.
  "about_note": "...",

  // One entry per business/road/event finding. Order doesn't matter --
  // the renderer groups and numbers them.
  "findings": [
    {
      "category": "opening",   // "opening" | "closing" | "road" | "event"
      "title": "The Hair of the Dog",
      "place": "Loughton",                  // short location line
      "status_label": "New, not yet on the map",   // short badge text
      "body": "One or two plain-English sentences. No jargon.",
      "lon": 0.0573766, "lat": 51.6521913,  // optional -- omit for "no pin"
      "sources": [{"label": "Tripadvisor", "url": "https://..."}]
    }
  ],

  // Optional. The cattle/grazing update (see scripts/cow_boundary_tracker.py,
  // which produces this shape directly).
  "grazing": {
    "moved": true,
    "place": "High Beach",
    "body": "The cattle have moved to a new paddock near High Beach.",
    "lon": 0.0247, "lat": 51.6580,
    "sources": []
  }
}
```

Usage:

```
python3 scripts/report/render_report.py <report-data.json> [output-path]
```

Point counts and the category breakdown sentence ("There are currently NNN
places to eat, drink and shop...") are computed by the script from the
current map data -- never put counts in the JSON by hand, they'll just be
ignored.
