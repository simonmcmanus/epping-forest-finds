# Epping Forest Finds — AI Session Guidelines

## Spec Synchronisation
Update the relevant spec file(s) with every code change that adds, removes, or alters behaviour.

- `spec/spec.md` — product overview, data sources, UX, features
- `spec/spec-data-fetching.md` — loading, normalisation, AppData interface
- `spec/spec-data-rendering.md` — drawing, interaction, inspector, UI state
- `spec/spec-admin.md` — admin dashboard, tracking data API, Netlify routing
- `spec/spec-native.md` — iOS/Android native wrapper (Capacitor shell, `js/native.js`, native heading/permissions, bundled data + delta updates, store requirements)
- `spec/spec-weekly-report.md` — weekly Epping Forest Ledger report generator (`scripts/report/`)
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
- `index.html` — markup only: head tags, DOM skeleton, and the `<script src>` list. No logic, no inline `<script>` body
- `js/app.js` — application boot and wiring (state, boot sequence, settings/report/compass handlers). Loaded last, after every other `js/*.js`
- `js/loader.js` — data fetching, parallel fetch, normalisation triggers
- `js/routing.js` — walkable road/path graph builder and pathfinding for the selected-route line (pure, no state/DOM access)
- `js/normalize.js` — data normalisation utilities
- `js/categories.js` — filter groups, place classification (`matchesPlaceFilter` and its `is*Category` predicates), tag builders, emoji/color maps (no DOM dependency)
- `js/renderer.js` — canvas draw loop
- `js/inspector.js` — inspector panel, detail views, overview HTML
- `js/nav.js` — navigation, camera helpers, gate/fade utilities
- `js/tracker.js` — user consent, location/click tracking, offline queue
- `css/` — stylesheets; reuse existing classes before adding new ones
- `spec/` — product specs (keep in sync)
- `data/` — offline GeoJSON/JSON datasets
- `data/tracking/` — local NDJSON tracking storage (gitignored)
- `scripts/` — data regeneration scripts (Python/Node)
- `scripts/session-start.sh` — idempotent session bootstrap (installs deps, resolves `PLAYWRIGHT_CHROMIUM_EXECUTABLE`); registered as a SessionStart hook in `.claude/settings.json`
- `admin.html` / `js/admin.js` / `css/admin.css` — password-protected analytics dashboard
- `netlify/functions/track.js` — Netlify serverless tracking endpoint (POST events, GET admin data)
- `netlify.toml` — Netlify build config and redirects (update when adding API routes)

## Technical Constraints
- Vanilla HTML/CSS/JS only — no client build step, no external JS dependencies.
- Mobile performance is a priority.
- **Service worker cache version (`APP_CACHE_NAME` in `sw.js`) must be incremented with every client-side code or asset change.** Without a version bump, returning users will run stale cached code. This is now automated: `.github/workflows/sw-bump.yml` (`branches-ignore: [main]`) bumps it to `forest-finds-app-<branch-slug>-vN` on every branch push, and `sw-release.yml` (`branches: [main]`) strips the slug and increments again on merge. Both also sync `APP_VERSION` in `js/app.js`, which is the fallback the About screen and bug reports show before `caches.keys()` resolves. Bump by hand only when you need the new version inside the same commit — CI will not double-bump, as it no-ops when `sw.js` is already ahead.
- **Local dev (`node server.js` / `npm run dev`) never depends on the `CACHE_NAME` bump above.** `server.js` injects `self.__DEV__ = true` into the `sw.js` response it serves (see `injectDevFlag()`), and `sw.js` uses that to fetch everything network-first instead of its production cache-first strategy. Don't try to "fix" stale local testing by bumping `CACHE_NAME` by hand — that's a CI concern; if local changes still don't show up, the dev-flag wiring in `server.js`/`sw.js` is what to check. `injectDevFlag()` also prefixes the served `CACHE_NAME` with `dev-` (e.g. `forest-finds-dev-v274`), so the Settings "About" version display and any bug-report `appVersion` are visibly local rather than a frozen release number.

## Testing

### Unit tests (functional behaviour)
- Run: `npm run test:unit` (or `node test/forest-finds.test.js`).
- **Must pass before any task is considered complete.** Run after every code change and fix failures before finishing.
- Use BDD-style descriptions that mirror the spec wording.
- A passing run prints one dot per test and a `# N passed` summary, not a line per test. `TEST_VERBOSE=1` restores the per-test names; a failure always prints in full regardless.
- `TEST_FILTER=<text>` runs only the tests whose name contains that text, case-insensitively — useful while iterating on one area. **It is never a substitute for the full run:** all 251 tests share the single `app` instance built by `loadAppForTests()`, in registration order and with no per-test isolation, so a filtered subset starts from whatever state the skipped tests would have left. Finish on a full, unfiltered pass.

### BDD browser tests (user experience)
- Run: `npm run test:e2e`
- Located in `test/e2e/` — one file per user journey, using Playwright.
- **Both suites must pass before a task is considered complete.**
- Every new user-facing behaviour or spec change needs a matching BDD test in `test/e2e/`.
- If a behaviour change is implementation-only with no user-visible effect, state this explicitly.
- Snapshots live in the flat `test/e2e/__screenshots__/` directory (per `snapshotPathTemplate` in `playwright.config.js`, keyed only on the `toHaveScreenshot()` name so a real visual diff stays a reviewable update instead of a delete+create pair). Regenerate with `npm run test:e2e:update` locally, or trigger the `Update Snapshots` GitHub Action for a Linux-matching baseline, when intentional visual changes are made.
- `/api/cows` is always mocked via `test/e2e/fixtures/cows.json` — never hit the live Nofence API in tests.
- **Geolocation is always answered, one way or the other.** A spec that wants a position says so with `test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] })`; every other spec gets an immediate `PERMISSION_DENIED` from `denyGeolocationUnlessGranted` in `test/e2e/helpers.js`. Chromium answers an ungranted `getCurrentPosition` neither way — no success callback, no error callback, and the request's own `timeout` option does not start until the permission decision is made — so without this a spec that does not grant location sat through the app's whole boot-location bound on every page load, and whether it beat the test timeout depended on how loaded the machine was. That is what used to make whole spec files fail together on CI. The stub only replaces `getCurrentPosition`, and only when the permission has not been granted, so a granting spec keeps the real API and Playwright's mock position.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (optional, unset by default) points Playwright at an existing Chromium binary instead of the one it downloads. It exists only for sandboxes that cannot reach `cdn.playwright.dev` and so cannot run `npx playwright install`; local Macs and CI are unaffected and keep using Playwright's own pinned browser. A mismatched Chromium build renders text differently, so `toHaveScreenshot()` failures under this var are environmental and must never be used to regenerate the committed snapshots.
- `playwright.config.js` extends the `toHaveScreenshot()` stability timeout to 15s under `process.env.CI` (default 5s elsewhere). GitHub-hosted runners only have 2 vCPUs, and running the full 4 workers there can slow a page's animation-frame loop enough that the default 5s isn't always enough to catch a stable frame before comparing pixels. Workers stay at 4 everywhere — this fixes the flakiness without giving up CI parallelism/speed.

### Completion checklist for every task
1. `node --test test/forest-finds.test.js` passes.
2. `npm run test:e2e` passes (or snapshots are regenerated intentionally).
3. Relevant `spec/` file is updated, or reason documented.
4. create a commit with a good concise description summarising the change  

## Code Quality
- Separate concerns strictly per the project structure above.
- Reuse existing CSS classes before adding new ones.
- No logic in `index.html`: it is markup and `<script src>` tags only. Boot and wiring live in `js/app.js`.
- UX quality bar: this should feel like a polished, professional product.
- Optimise for token efficiency: short, precise edits over large rewrites.
