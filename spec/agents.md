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
- `spec/spec-alpha-access.md` — closed alpha gate, `/` vs `/app` URL split, shared secret link, service-worker navigation scope
- `spec/spec-marketing.md` — positioning, approved phrase bank, marketing homepage at `/`, mailing-list sign-up, social sharing assets
- `spec/spec-issue-workflow.md` — GitHub issue clarification automation (`.github/workflows/issue-clarify.yml`)
- `spec/glossary.md` — product terminology

Update the affected section only; do not pad.

Do not consider a behaviour change complete until the matching spec update is included in the same change set. If no spec update is needed, state the reason in the final response.

Before finishing any implementation task:
- Check `git diff --name-only`.
- Map changed files to the relevant `spec/` document.
- Update the spec or explicitly document why the change is implementation-only.

## Marketing and app ownership

- **ChatGPT owns marketing:** `index.html`, `assets/home/**`, `netlify/functions/subscribe.js`, `scripts/count-datasets.js`, `scripts/generate-sitemap.js`, `spec/spec-marketing.md`, `test/home-*.test.js`, `test/subscribe.test.js`, `test/sitemap.test.js`, and `test/e2e/18-homepage.spec.js`.
- **Claude owns the app:** `app.html`, `js/**`, `css/**`, `data/**`, `sw.js`, `manifest.webmanifest`, native wrappers, and app specs/tests. Marketing must not import app CSS/JS or reference app icons at runtime; small brand assets are independent copies in `assets/home/`.
- Marketing copy changes do not require edits to app metadata, onboarding or the manifest. Propose cross-surface wording changes to the app owner, who applies them in a separate app change.
- Shared integration files (`netlify.toml`, `server.js`, `package*.json`, `playwright.config.js`, `.github/**`, and these instructions) require coordination when both agents are active. Reports and terms are separate surfaces: coordinate changes with their current owner rather than changing their generators as part of a homepage edit.
- For simultaneous browser tests, choose separate local ports with `PLAYWRIGHT_BASE_URL=http://localhost:8081 npm run test:e2e` (and a different port for the other worktree). Playwright starts that worktree's server and refuses to reuse an existing server, so it cannot silently test the other agent's checkout.
- Each agent uses its own branch and worktree based on current `origin/main`. Do not edit or push the other agent's branch. Keep routine marketing changes within marketing-owned files, and routine app changes within app-owned files.
- `/`, `/app`, `/reports/`, `/terms.html`, and `/api/subscribe` are the integration contract. Dataset counts are a read-only marketing dependency: when data changes, coordinate the homepage count update with ChatGPT; do not silently rewrite marketing copy.
- `assets/home/**` is outside the app cache and the app-release workflow's watched paths. After this boundary change, marketing-only edits need no app cache/version edit; app changes retain the cache-release rules below.

## Project Structure
- `index.html` — the public marketing homepage at `/`. Static content, its own `assets/home/` styles, scripts and images, no app code
- `app.html` — the map application, served at `/app`. Markup only: head tags, DOM skeleton, and the `<script src>` list. No logic, no inline `<script>` body
- `netlify/edge-functions/alpha-gate.js` — closed alpha gate on `/app` (see `spec/spec-alpha-access.md`)
- `netlify/functions/subscribe.js` — mailing-list sign-up endpoint for the homepage
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
- **Cache versions in `sw.js` are bumped by CI on the pull request, never by hand.** The two caches move independently so returning users re-download only what changed:
  - `APP_CACHE_NAME` — `.github/workflows/sw-release.yml`, on a pull request touching `app.html`, `css/**`, `js/**`, `sw.js`, `manifest.webmanifest` or `tree-icon.svg` (the `APP_SHELL` contents). Note it watches `app.html`, not `index.html`: since the alpha URL split `index.html` is the marketing homepage and is deliberately not part of the app shell. It also syncs `APP_VERSION` in `js/app.js`, the fallback the About screen and bug reports show before `caches.keys()` resolves.
  - `DATA_CACHE_NAME` — `.github/workflows/data-bump.yml`, on a pull request touching `data/**`. That covers the Monday ledger merge and any regeneration script's output.

  Each sets its version to **one past the base branch's** rather than incrementing, so a pull request that triggers it twice lands on the same number. Both edit `sw.js` on the same branch, so they share a per-pull-request concurrency group rather than racing. The bump commit arrives on the branch with `[skip ci]` and rides in with the merge, so expect one in the diff of any pull request touching those paths — leave it alone.

  **They used to run after the merge and push straight to `main`, and that broke silently when `main` became a protected branch** (`GH006: Protected branch update failed ... Changes must be made through a pull request`). Every merge from 19 September 2026 failed that way on a `push` event nobody watches, so the caches stopped being versioned while everything looked fine. Anything else that wants to write to `main` from CI has the same problem and needs the same treatment.

  A fork's pull request is skipped rather than failed: its token is read-only and its branch is not ours to write to, so a merge from a fork needs the bump by hand.
- **Local dev (`node server.js` / `npm run dev`) never depends on the `CACHE_NAME` bump above.** `server.js` injects `self.__DEV__ = true` into the `sw.js` response it serves (see `injectDevFlag()`), and `sw.js` uses that to fetch everything network-first instead of its production cache-first strategy. Don't try to "fix" stale local testing by bumping `CACHE_NAME` by hand — that's a CI concern; if local changes still don't show up, the dev-flag wiring in `server.js`/`sw.js` is what to check. `injectDevFlag()` also prefixes the served `CACHE_NAME` with `dev-` (e.g. `forest-finds-dev-v274`), so the Settings "About" version display and any bug-report `appVersion` are visibly local rather than a frozen release number.

## Testing

### Unit tests (functional behaviour)
- Run: `npm run test:unit` (or `node test/forest-finds.test.js`).
- **Must pass before any task is considered complete.** Run after every code change and fix failures before finishing.
- Use BDD-style descriptions that mirror the spec wording.
- A passing run prints one dot per test and a `# N passed` summary, not a line per test. `TEST_VERBOSE=1` restores the per-test names; a failure always prints in full regardless.
- `TEST_FILTER=<text>` runs only the tests whose name contains that text, case-insensitively — useful while iterating on one area. **It is never a substitute for the full run:** all 312 tests share the single `app` instance built by `loadAppForTests()`, in registration order and with no per-test isolation, so a filtered subset starts from whatever state the skipped tests would have left. Finish on a full, unfiltered pass.

### BDD browser tests (user experience)
- Run: `npm run test:e2e`
- Located in `test/e2e/` — one file per user journey, using Playwright.
- **Both suites must pass before a task is considered complete.**
- Every new user-facing behaviour or spec change needs a matching BDD test in `test/e2e/`.
- If a behaviour change is implementation-only with no user-visible effect, state this explicitly.
- Snapshots live in the flat `test/e2e/__screenshots__/` directory (per `snapshotPathTemplate` in `playwright.config.js`, keyed only on the `toHaveScreenshot()` name so a real visual diff stays a reviewable update instead of a delete+create pair). Regenerate with `npm run test:e2e:update` locally, or trigger the `Update Snapshots` GitHub Action for a Linux-matching baseline, when intentional visual changes are made.
- **`02-overview.spec.js`'s snapshot has failed non-deterministically on CI — re-run before you believe it.** On 2026-09-21 it reported a *stable* 17,206-pixel difference (ratio 0.07, seventy times the tolerance) on one run, then passed on the next two with byte-identical data and a byte-identical baseline. Playwright's own retry called the bad frame stable, so "it settled" is not evidence. Something in the Nearby screen's content resolves differently under load, and a 7% difference is a region of the screen rather than antialiasing. A data change near Loughton High Road *can* also legitimately change that image — the weekly ledger edits exactly there — so the two look alike and only a re-run tells them apart. Re-run first; regenerate the baseline (**Update Snapshots** workflow, Linux runner only, never locally) only once the difference proves repeatable.
- `/api/cows` is always mocked via `test/e2e/fixtures/cows.json` — never hit the live Nofence API in tests.
- **Geolocation is always answered, one way or the other.** A spec that wants a position says so with `test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] })`; every other spec gets an immediate `PERMISSION_DENIED` from `denyGeolocationUnlessGranted` in `test/e2e/helpers.js`. Chromium answers an ungranted `getCurrentPosition` neither way — no success callback, no error callback, and the request's own `timeout` option does not start until the permission decision is made — so without this a spec that does not grant location sat through the app's whole boot-location bound on every page load, and whether it beat the test timeout depended on how loaded the machine was. That is what used to make whole spec files fail together on CI. The stub only replaces `getCurrentPosition`, and only when the permission has not been granted, so a granting spec keeps the real API and Playwright's mock position.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (optional, unset by default) points Playwright at an existing Chromium binary instead of the one it downloads. It exists only for sandboxes that cannot reach `cdn.playwright.dev` and so cannot run `npx playwright install`; local Macs and CI are unaffected and keep using Playwright's own pinned browser. A mismatched Chromium build renders text differently, so `toHaveScreenshot()` failures under this var are environmental and must never be used to regenerate the committed snapshots.
- **One Playwright project per CI runner, two workers each.** A GitHub-hosted runner has 2 vCPUs. Running the whole suite on one of them at `workers: 4` gave every worker half a core, which stretched the app's boot-and-draw cycle past the waits the specs bound it with and failed whole spec files together in `beforeEach` — around 20 failures a run, while the same suite showed 3-4 on a 4-core dev box. That was starvation, not flakiness. `.github/workflows/ci.yml` now runs the `E2E tests` job as a `project: [desktop, mobile]` matrix, and `playwright.config.js` sets `workers: process.env.CI ? 2 : 4`: two runners, two workers each, a full core per worker, the same total parallelism, and both jobs concurrent so wall-clock does not suffer. The snapshot-baseline commit step is `if: matrix.project == 'mobile'` — every `toHaveScreenshot()` spec is skipped outside mobile, and two jobs pushing to one branch would race.
- **To reproduce a CI-only failure locally, constrain the CPU:** `CI=1 taskset -c 0,1 npx playwright test --project=mobile`. Two cores and `CI=1` is what the runner actually gives a job, and it reproduces starvation failures that a 4-core box hides completely. Do this before concluding a CI failure is "environmental".
- **Specs say *what* they wait for; `playwright.config.js` says how long.** `expect.timeout` is 20s under CI and 5s elsewhere, so don't pass `{ timeout: N }` to an `expect()` assertion. An assertion's timeout bounds how long the UI may take to get somewhere — it is not a behaviour under test, and a genuinely broken UI still fails on the 60s test timeout. Roughly a hundred hard-coded few-second bounds were what turned a slow runner into a red suite; they are gone, and new ones should not appear. A deliberately long bound for something genuinely slow (the boot-location tests in `09-location`) is fine and stays explicit.
- `toHaveScreenshot()` allows `maxDiffPixelRatio: 0.001`. Even comparing against baselines CI generated itself on the same runner image, canvas antialiasing and font hinting came back ~28 pixels apart on a ~334k-pixel screenshot under load. 0.1% is ten times the headroom that noise needs and still catches any diff big enough to see. The `toHaveScreenshot()` stability timeout is 15s under CI (5s elsewhere) for the same reason.

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
2. `npm run test:e2e` passes locally (or snapshots are regenerated intentionally). For anything
   timing-sensitive, run it the way CI will: `CI=1 taskset -c 0,1 npx playwright test --project=<name>`.
3. Relevant `spec/` file is updated, or reason documented.
4. Create a commit with a good concise description summarising the change.
5. Push, wait for CI, and confirm the `E2E tests` job is **green on your branch** — per "CI is
   the verdict" above. The task is not finished until it is, and the report says what CI said.

## Code Quality
- Separate concerns strictly per the project structure above.
- Reuse existing CSS classes before adding new ones.
- No logic in `app.html`: it is markup and `<script src>` tags only. Boot and wiring live in `js/app.js`.
- UX quality bar: this should feel like a polished, professional product.
- Optimise for token efficiency: short, precise edits over large rewrites.
