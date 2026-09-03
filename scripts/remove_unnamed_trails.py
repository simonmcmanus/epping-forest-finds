#!/usr/bin/env python3
"""
DO NOT RUN THIS SCRIPT.

On 2026-05-20 this script was run against data/local-paths.geojson and deleted every path
feature without a `name` tag -- which turned out to be almost every real footpath, since OSM's
official Public Rights of Way (designation=public_footpath, prow_ref=... e.g. "Loughton FP 109")
are essentially never named, only named "trail"-classified features and waymarked trails are.
js/routing.js builds its walking route graph from that same file, so this didn't just declutter
the rendered map -- it silently deleted most of the app's real alleyway/footpath shortcuts,
forcing the router to send walkers the long way round via roads. See git history (commit
775c0d5) and /routing-pedestrian-bias.md in project memory for the full incident.

The data has since been rebuilt from the cached (pre-filter) Overpass response via
`npm run regen:paths -- --from-cache` (see scripts/regenerate_local_paths.py), which keeps
unnamed ways. If unnamed trails ever need hiding for visual clarity again, do it at render time
in js/renderer.js (keyed on `pathType`/`name`), not by deleting them from the data the router
depends on. This file is kept only as a record of what happened; it intentionally no longer runs.
"""

import sys

if __name__ == "__main__":
    sys.exit(
        "scripts/remove_unnamed_trails.py is disabled -- see its module docstring for why. "
        "Do not re-enable it: it deletes real footpaths/alleys that js/routing.js needs."
    )
