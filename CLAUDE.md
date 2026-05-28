# Epping Forest Finds — Claude Code Instructions

## Spec Synchronisation

**Always update the spec when changing code.** The three spec files in `spec/` are the source of truth for product behaviour:

- `spec/spec.md` — top-level product overview, data sources, UX, features
- `spec/spec-data-fetching.md` — loading, normalisation, AppData interface
- `spec/spec-data-rendering.md` — drawing, interaction, inspector, UI state

Every code change that adds, removes, or alters behaviour must include a matching update to the relevant spec file(s) in the same commit/response. If you are unsure which spec to update, update all three and trim the irrelevant parts.

Spec updates should be accurate and concise — update the affected section only; do not pad.

## Project Structure

- `index.html` — all app state, boot, and inline JS logic
- `js/loader.js` — data fetching (parallel fetch, normalisation triggers)
- `js/normalize.js` — data normalization utilities
- `js/categories.js` — filter groups, tag builders, emoji/color maps (no DOM dependency)
- `js/renderer.js` — canvas draw loop
- `js/inspector.js` — inspector panel, detail views, overview HTML
- `js/nav.js` — navigation, interactions, camera helpers, gate/fade utilities
- `css/` — stylesheets, no build step
- `spec/` — product specs (keep in sync)
- `data/` — offline GeoJSON/JSON datasets
- `scripts/` — data regeneration scripts (Python/Node)

## Technical Constraints

- No client build step — vanilla HTML/CSS/JS only.
- No external JS dependencies on the client.
- Mobile performance is a priority.
- All three spec files should be kept in sync with every change.