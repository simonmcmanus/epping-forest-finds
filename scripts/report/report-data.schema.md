# Weekly report data format

Input to `scripts/report/render_report.py`. This is the *only* thing the
weekly research step needs to produce -- the script owns the map, the CSS,
the layout and the point-count stats.

Write every piece of prose here in plain English, as if explaining it to a
neighbour who has never seen this project's code and never will: no file
names, OSM node/way ids, branch names, git/PR/CI talk, and nothing about how
the report itself is produced. Notes about the run belong in the write-up on
the weekly change, where the person reviewing it will look -- the page is for
a reader who only wants to know what is going on in Epping Forest. The
renderer refuses to write the report if any of that slips in (see
`jargon_guard.py`).

Write for publication after the report and accompanying changes are merged.
Review status belongs in the PR, never the newsletter. Lead with the place,
the news and its practical relevance, not how it was discovered. Established
businesses newly listed are local finds, not new openings. Keep uncertainty
about real-world facts explicit. Do not invent dates or visitor advice.

The "written by AI, tell us if it is wrong" note and the advert for the app
are added by the renderer itself -- never write either by hand.

```jsonc
{
  // Required.
  "date": "2026-09-03",                       // YYYY-MM-DD, used in the output filename
  "date_display": "Wednesday, 3 September 2026",

  // Optional. Shown inside the green heading panel beside the photo, if given.
  "intro": "Briefly say what was found, what changed, and which topics have no updates. No generic introduction.",

  // Optional. Defaults to the 8 coverage settlements (see places.py).
  "coverage_area": ["Loughton", "Chingford", "..."],

  // Optional. Overrides the default app address (https://www.eppingforestfinds.uk/app).
  // Also decides where the "report a mistake" link at the foot of the page points.
  "app_link": "https://www.eppingforestfinds.uk/app",

  // Optional. Overrides the default "About this report" paragraph. A
  // reader-facing note about coverage, not a status report on the tooling --
  // leave it out when there is nothing a reader would want to know.
  "about_note": "...",

  // One entry per business/road/event finding. Order doesn't matter --
  // the renderer groups and numbers them.
  "findings": [
    {
      "category": "opening",   // "opening" | "closing" | "road" | "event"
      "title": "The Hair of the Dog",
      "place": "Loughton",                  // short location line
      "status_label": "Already trading",   // short badge text
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

The attached statistics strip computes its counts from the findings and food
dataset; never put counts into the intro by hand. Keep the intro and
findings focused on useful local news, not the volume of map updates.
