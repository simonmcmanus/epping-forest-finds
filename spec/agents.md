# Epping Forest Finds — AI Session Guidelines

## Spec Synchronisation
Update the relevant spec file(s) with every code change that adds, removes, or alters behaviour.

- `spec/spec.md` — product overview, data sources, UX, features
- `spec/spec-data-fetching.md` — loading, normalisation, AppData interface
- `spec/spec-data-rendering.md` — drawing, interaction, inspector, UI state
- `spec/spec-admin.md` — admin dashboard, tracking data API, Netlify routing
- `spec/spec-icons.md` — icon registry, icon rendering, generated icon asset requirements
- `spec/spec-issue-workflow.md` — GitHub issue clarification automation (`.github/workflows/issue-clarify.yml`)
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
- `js/routing.js` — walkable road/path graph builder and pathfinding for the selected-route line (pure, no state/DOM access)
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
- **Service worker cache version (`CACHE_NAME` in `sw.js`) must be incremented with every client-side code or asset change.** Without a version bump, returning users will run stale cached code. Include the bump in the same commit as the change — in practice this is automated by `.github/workflows/sw-bump.yml` (non-`main` branches) and `sw-release.yml` (`main`), since it only ever needs to happen once per commit, not once per local edit.
- **Local dev (`node server.js` / `npm run dev`) never depends on the `CACHE_NAME` bump above.** `server.js` injects `self.__DEV__ = true` into the `sw.js` response it serves (see `injectDevFlag()`), and `sw.js` uses that to fetch everything network-first instead of its production cache-first strategy. Don't try to "fix" stale local testing by bumping `CACHE_NAME` by hand — that's a CI concern; if local changes still don't show up, the dev-flag wiring in `server.js`/`sw.js` is what to check. `injectDevFlag()` also prefixes the served `CACHE_NAME` with `dev-` (e.g. `forest-finds-dev-v274`), so the Settings "About" version display and any bug-report `appVersion` are visibly local rather than a frozen release number.

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
- Snapshots live in the flat `test/e2e/__screenshots__/` directory (per `snapshotPathTemplate` in `playwright.config.js`, keyed only on the `toHaveScreenshot()` name so a real visual diff stays a reviewable update instead of a delete+create pair). Regenerate with `npm run test:e2e:update` locally, or trigger the `Update Snapshots` GitHub Action for a Linux-matching baseline, when intentional visual changes are made.
- `/api/cows` is always mocked via `test/e2e/fixtures/cows.json` — never hit the live Nofence API in tests.
- `playwright.config.js` extends the `toHaveScreenshot()` stability timeout to 15s under `process.env.CI` (default 5s elsewhere). GitHub-hosted runners only have 2 vCPUs, and running the full 4 workers there can slow a page's animation-frame loop enough that the default 5s isn't always enough to catch a stable frame before comparing pixels. Workers stay at 4 everywhere — this fixes the flakiness without giving up CI parallelism/speed.

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
