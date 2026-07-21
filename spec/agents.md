# Epping Forest Finds — AI Session Guidelines

## Spec Synchronisation
Update the relevant spec file(s) with every code change that adds, removes, or alters behaviour.

- `spec/spec.md` — product overview, data sources, UX, features
- `spec/spec-data-fetching.md` — loading, normalisation, AppData interface
- `spec/spec-data-rendering.md` — drawing, interaction, inspector, UI state
- `spec/spec-admin.md` — admin dashboard, tracking data API, Netlify routing
- `spec/spec-icons.md` — icon registry, icon rendering, generated icon asset requirements
- `spec/glossary.md` — product terminology

Update the affected section only; do not pad.

Do not consider a behaviour change complete until the matching spec update is included in the same change set. If no spec update is needed, state the reason in the final response.

Before finishing any implementation task:
- Check `git diff --name-only`.
- Map changed files to the relevant `spec/` document.
- Update the spec or explicitly document why the change is implementation-only.

## Project Structure
- `index.html` — boot and wiring only; no logic beyond this
- `js/loader.js` — data fetching, parallel fetch, normalisation triggers
- `js/normalize.js` — data normalisation utilities
- `js/categories.js` — filter groups, tag builders, emoji/color maps (no DOM dependency)
- `js/renderer.js` — canvas draw loop
- `js/inspector.js` — inspector panel, detail views, overview HTML
- `js/nav.js` — navigation, camera helpers, gate/fade utilities
- `js/tracker.js` — user consent, location/click tracking, offline queue
- `css/` — stylesheets; reuse existing classes before adding new ones
- `spec/` — product specs (keep in sync)
- `data/` — offline GeoJSON/JSON datasets
- `data/tracking/` — local NDJSON tracking storage (gitignored)
- `scripts/` — data regeneration scripts (Python/Node)
- `admin.html` / `js/admin.js` / `css/admin.css` — password-protected analytics dashboard
- `netlify/functions/track.js` — Netlify serverless tracking endpoint (POST events, GET admin data)
- `netlify.toml` — Netlify build config and redirects (update when adding API routes)

## Technical Constraints
- Vanilla HTML/CSS/JS only — no client build step, no external JS dependencies.
- Mobile performance is a priority.
- **Service worker cache version (`CACHE_NAME` in `sw.js`) must be incremented with every client-side code or asset change.** Without a version bump, returning users will run stale cached code. Include the bump in the same commit as the change.

## Testing

### Unit tests (functional behaviour)
- Run: `node --test test/forest-finds.test.js`
- **Must pass before any task is considered complete.** Run after every code change and fix failures before finishing.
- Use BDD-style descriptions that mirror the spec wording.

### BDD browser tests (user experience)
- Run: `npm run test:e2e`
- Located in `test/e2e/` — one file per user journey, using Playwright.
- **Both suites must pass before a task is considered complete.**
- Every new user-facing behaviour or spec change needs a matching BDD test in `test/e2e/`.
- If a behaviour change is implementation-only with no user-visible effect, state this explicitly.
- Snapshots live in `test/e2e/<spec-name>-snapshots/`. Regenerate with `npm run test:e2e:update` when intentional visual changes are made.
- `/api/cows` is always mocked via `test/e2e/fixtures/cows.json` — never hit the live Nofence API in tests.

### Completion checklist for every task
1. `node --test test/forest-finds.test.js` passes.
2. `npm run test:e2e` passes (or snapshots are regenerated intentionally).
3. Relevant `spec/` file is updated, or reason documented.

## Code Quality
- Separate concerns strictly per the project structure above.
- Reuse existing CSS classes before adding new ones.
- No logic in `index.html` beyond boot and wiring.
- UX quality bar: this should feel like a polished, professional product.
- Optimise for token efficiency: short, precise edits over large rewrites.
