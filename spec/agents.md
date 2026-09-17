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
- `index.html` — boot and wiring only; no logic beyond this
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
- `admin.html` / `js/admin.js` / `css/admin.css` — password-protected analytics dashboard
- `netlify/functions/track.js` — Netlify serverless tracking endpoint (POST events, GET admin data)
- `netlify.toml` — Netlify build config and redirects (update when adding API routes)

## Technical Constraints
- Vanilla HTML/CSS/JS only — no client build step, no external JS dependencies.
- Mobile performance is a priority.
- **Service worker cache version (`APP_CACHE_NAME` in `sw.js`) must be incremented with every client-side code or asset change.** Without a version bump, returning users will run stale cached code. Include the bump in the same commit as the change. `.github/workflows/sw-bump.yml` (non-`main` branches) and `sw-release.yml` (`main`) were written to automate this, but **both are currently disabled** (`branches: [__disabled__]`), so the bump is a manual edit until one of them is switched back on. One bump per commit is enough, not one per local edit.
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
- **Geolocation is always answered, one way or the other.** A spec that wants a position says so with `test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] })`; every other spec gets an immediate `PERMISSION_DENIED` from `denyGeolocationUnlessGranted` in `test/e2e/helpers.js`. Chromium answers an ungranted `getCurrentPosition` neither way — no success callback, no error callback, and the request's own `timeout` option does not start until the permission decision is made — so without this a spec that does not grant location sat through the app's whole boot-location bound on every page load, and whether it beat the test timeout depended on how loaded the machine was. That is what used to make whole spec files fail together on CI. The stub only replaces `getCurrentPosition`, and only when the permission has not been granted, so a granting spec keeps the real API and Playwright's mock position.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (optional, unset by default) points Playwright at an existing Chromium binary instead of the one it downloads. It exists only for sandboxes that cannot reach `cdn.playwright.dev` and so cannot run `npx playwright install`; local Macs and CI are unaffected and keep using Playwright's own pinned browser. A mismatched Chromium build renders text differently, so `toHaveScreenshot()` failures under this var are environmental and must never be used to regenerate the committed snapshots.
- `playwright.config.js` extends the `toHaveScreenshot()` stability timeout to 15s under `process.env.CI` (default 5s elsewhere). GitHub-hosted runners only have 2 vCPUs, and running the full 4 workers there can slow a page's animation-frame loop enough that the default 5s isn't always enough to catch a stable frame before comparing pixels. Workers stay at 4 everywhere — this fixes the flakiness without giving up CI parallelism/speed.

### CI is the verdict, not your local run

**A local `npm run test:e2e` is a pre-filter. The CI `E2E tests` job on your own branch is the
result.** The two disagree badly and routinely: this suite has repeatedly run 3-4 failures in a
dev sandbox and 20-25 on a GitHub runner, because the runner has 2 vCPUs for 4 workers and the
whole job takes ~27 minutes, so timing-sensitive specs (`beforeEach` waits, animation frames,
paint counts) fail there and nowhere else. Two consecutive PRs were handed over as done on the
strength of a green-ish local run while their CI job was red the whole time.

So, before a PR is done — every time, no exceptions:

1. **Push, then read the CI run for your head SHA.** `actions_list` → `list_workflow_runs`
   filtered to your branch, then `list_workflow_jobs`, then `get_job_logs` on the `E2E tests`
   job. Read the `N failed / N passed` line and the failure list under it.
2. **The job must be green.** Not "green apart from the environmental ones" — green.
3. **Never call a failure pre-existing on the basis of a local run.** Establish it CI-to-CI:
   pull the CI failure list for your merge-base commit (the run on `main` for the SHA you
   branched from) and diff the two lists by test name. A failure on your branch that is not on
   that list is yours, whatever it looks like.
4. **Never write "passes locally" as evidence in a commit message, PR body, or hand-off.** State
   what CI said: the run URL, the pass/fail counts, and — if anything is still red — exactly
   which tests and why they are not yours, with the merge-base run that proves it.

If a wait is unavoidable, wait: the e2e job takes ~27 minutes. Reporting a task finished before
its CI run exists is reporting a guess.

### If the suite is already red when you arrive

Say so, with numbers, in your first report — do not absorb it silently and do not let it become
cover for your own failures. Then either fix it, or get a decision from the user about scope.
Shipping onto a red suite without flagging it is what let the failure count drift upward
unnoticed for a week.

### Changing a shared test helper

A helper like `tiltTo` in `test/e2e/13-tilt-3d.spec.js` sets up the state that every test in the
file then measures. Changing it changes what all of them are looking at, and a change that fixes
the one test you had in mind can silently break another on a viewport you did not run. If only
one test needs different setup, give that test its own helper rather than editing the shared one.
If you do edit a shared one, re-run every spec that uses it, on **every** Playwright project
(`--project=desktop` and `--project=mobile`), and then confirm in CI.

### Completion checklist for every task
1. `node --test test/forest-finds.test.js` passes.
2. `npm run test:e2e` passes locally (or snapshots are regenerated intentionally).
3. Relevant `spec/` file is updated, or reason documented.
4. Create a commit with a good concise description summarising the change.
5. Push, wait for CI, and confirm the `E2E tests` job is **green on your branch** — per "CI is
   the verdict" above. The task is not finished until it is, and the report says what CI said.

## Code Quality
- Separate concerns strictly per the project structure above.
- Reuse existing CSS classes before adding new ones.
- No logic in `index.html` beyond boot and wiring.
- UX quality bar: this should feel like a polished, professional product.
- Optimise for token efficiency: short, precise edits over large rewrites.
