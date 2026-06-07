# Epping Forest Finds — AI Session Guidelines

## Spec Synchronisation
Update the relevant spec file(s) with every code change that adds, removes, or alters behaviour.

- `spec/spec.md` — product overview, data sources, UX, features
- `spec/spec-data-fetching.md` — loading, normalisation, AppData interface
- `spec/spec-data-rendering.md` — drawing, interaction, inspector, UI state

Update the affected section only; do not pad.

## Project Structure
- `index.html` — boot and wiring only; no logic beyond this
- `js/loader.js` — data fetching, parallel fetch, normalisation triggers
- `js/normalize.js` — data normalisation utilities
- `js/categories.js` — filter groups, tag builders, emoji/color maps (no DOM dependency)
- `js/renderer.js` — canvas draw loop
- `js/inspector.js` — inspector panel, detail views, overview HTML
- `js/nav.js` — navigation, camera helpers, gate/fade utilities
- `css/` — stylesheets; reuse existing classes before adding new ones
- `spec/` — product specs (keep in sync)
- `data/` — offline GeoJSON/JSON datasets
- `scripts/` — data regeneration scripts (Python/Node)

## Technical Constraints
- Vanilla HTML/CSS/JS only — no client build step, no external JS dependencies.
- Mobile performance is a priority.

## Testing
- Run: `node --test test/forest-finds.test.js`
- Every new feature or behaviour change needs a matching test.
- Use BDD-style descriptions that mirror the spec wording.

## Code Quality
- Separate concerns strictly per the project structure above.
- Reuse existing CSS classes before adding new ones.
- No logic in `index.html` beyond boot and wiring.
- UX quality bar: this should feel like a polished, professional product.
- Optimise for token efficiency: short, precise edits over large rewrites.
