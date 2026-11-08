# Testing and PR evidence reference

Read the relevant headings for the current task. `spec/agents.md` and `docs/agents/review-contract.md` contain the active completion and evidence rules.


### Test quality: assert behaviour, never source text

A test exists to fail when the app misbehaves for a user, and to stay green through any refactor that leaves behaviour alone. Coverage of app functionality is the goal; a test that cannot catch a real regression is worse than none, because it reads as coverage.

**Do not write tests that:**
- Read a source file (`js/*.js`, `css/*`, `sw.js`, `app.html`, `server.js`, a Netlify function) and `assert.match` / `.includes` / `doesNotMatch` a regex or string against it. That pins how code is written, not what it does: it fails on a rename or reformat and stays green when the logic is wrong. Execute the code instead — call the function, run `sw.js` in a `vm` context against fake `caches`/`fetch` (see `test/service-worker.test.js`), drive the page in Playwright — and assert on the output, the network traffic, the cache contents, or the DOM a user sees.
- Assert that something was **removed** by grepping for its name (`doesNotMatch(html, /oldFeature/)`). Once removed it has no behaviour to test; a regression is caught by the e2e journey that would exercise it.
- Count markup or CSS (`stroke="currentColor"` tallies, pixel values in a stylesheet). Assert the rendered result (`boundingBox`, accessible role/name, visible text) or rely on the snapshot.
- Have no assertion, or assert something that is true by construction (the value the test just set, `assert.ok(true)`, `x === x`, a `toBeTruthy()` on a value that is always set when the code runs at all).
- Mirror the implementation: re-deriving the expected value with the same formula the code uses, or asserting call order inside a function body, rather than the observable outcome.

**Do:**
- Name the behaviour in the test title, as a user or caller would state it, and assert that outcome.
- Stub only at the boundary (network, `caches`, `navigator`, time), not internal helpers.
- Prove a new test is real: break the code on purpose and confirm the test fails, then restore it. A test that survives the mutation it claims to guard is deleted or rewritten.
- A data invariant that crosses files (every CSS file `app.html` links is listed in `APP_SHELL`) is a legitimate check, because it asserts a property of the shipped product, not a code pattern. Keep those, and say so in the title.
- In Playwright, a missing precondition is a failure, not a skip: do not `test.skip(!target, ...)` because the camera or fixture did not produce something. Position the camera deterministically or fail loudly. Reserve `test.skip` for project/viewport gating.
- Wait on state (`expect(locator)`, `waitForFunction`), never `page.waitForTimeout`. `test/e2e/helpers.js` has `waitForUiToSettle` (camera landed, finite animations done) for "let it finish moving" and `waitForFrames` for "nothing should happen" assertions. A test that measures a wall-clock animation samples inside the page (see `sampleEvery` in `14-map-interaction.spec.js`) rather than waiting from the test side.

When removing a source-grep test, check that an executed test or e2e journey covers the behaviour; add one if not. Do not delete coverage — replace it.

### Unit tests (functional behaviour)
- Run: `npm run test:unit` (or `node test/forest-finds.test.js`).
- **Must pass before any task is considered complete.** Run after every code change and fix failures before finishing.
- Use BDD-style descriptions that mirror the spec wording.
- A passing run prints one dot per test and a `# N passed` summary, not a line per test. `TEST_VERBOSE=1` restores the per-test names; a failure always prints in full regardless.
- `test/service-worker.test.js` (run by `npm test`, `node --test test/service-worker.test.js`) executes the real `sw.js` against an in-memory Cache Storage and a scripted network. Add service-worker behaviour tests there, not as regexes over `sw.js`.
- `TEST_FILTER=<text>` runs only the tests whose name contains that text, case-insensitively — useful while iterating on one area. **It is never a substitute for the full run:** all unit tests share the single `app` instance built by `loadAppForTests()`, in registration order and with no per-test isolation, so a filtered subset starts from whatever state the skipped tests would have left. Finish on a full, unfiltered pass.

### BDD browser tests (user experience)
- Run one spec: `npx playwright test test/e2e/<file> --project=<desktop|mobile>`, narrowed
  further with `-g "<test name>"`. That is the local command. `npm run test:e2e` runs the whole
  suite, which is the PR's CI job's work — see "CI is the verdict" below before running it here.
- Located in `test/e2e/` — one file per user journey, using Playwright.
- **Both suites must pass before a task is considered complete** — the unit suite locally, the
  e2e suite on the PR.
- Every new user-facing behaviour or spec change needs a matching BDD test in `test/e2e/`.
- If a behaviour change is implementation-only with no user-visible effect, state this explicitly.
- Snapshots live in the flat `test/e2e/__screenshots__/` directory (per `snapshotPathTemplate` in `playwright.config.js`, keyed only on the `toHaveScreenshot()` name so a real visual diff stays a reviewable update instead of a delete+create pair). Every PR publishes its baseline/actual/diff candidates automatically in a trusted follow-up workflow; it never writes snapshot PNGs into the feature branch. The `Update Snapshots` workflow regenerates canonical baselines from `main` after merges and commits them directly to `main` through the protected-branch GitHub App path used by cache bumps; it remains manually dispatchable for another branch when needed.
- **Never stack a PR on an unmerged branch.** Baselines are regenerated only after a change reaches `main`, so a branch cut from another open PR carries that PR's rendering changes and shows its snapshot diffs as its own. A workflow-only PR once listed 25 visual changes this way (it sat on top of two unmerged renderer commits). Branch from `origin/main`; before opening, check `git diff --stat origin/main...HEAD` lists only the files you meant to change. The `Visual snapshots` job summary lists the pixel-relevant files the PR touches.
- **Canvas screenshot diffs are non-deterministic on CI — re-run before you believe one.** On 2026-09-21, `02-overview.spec.js`'s snapshot reported a *stable* 17,206-pixel difference (ratio 0.07, seventy times the tolerance) on one run, then passed on the next two with byte-identical data and a byte-identical baseline. Playwright's own retry called the bad frame stable, so "it settled" is not evidence. The same class of flake recurred on 2026-10-01: two runs of one unchanged commit each failed exactly one of the six existing app snapshots, at a different pixel count each time, and a third run failed a *different* one of the six — while the other 104+ functional assertions in the same suite passed all three times. A data change near Loughton High Road *can* also legitimately change the overview image — the weekly ledger edits exactly there — so a real diff and a flake look alike and only a re-run tells them apart. This is why snapshot tests run as their own `Visual snapshots (desktop + mobile)` CI check with a one-time retry (see below) rather than inside `E2E tests`: the trusted publisher records the diff for review, and the main-branch workflow commits regenerated canonical baselines directly to `main` after the source change merges.
- **One real contributor, found and closed: `drawPngMapIcon` (`js/renderer.js`) silently skips an icon whose backing `Image` hasn't finished loading** (`if (!img.complete...) return false`), and that image's `onload` schedules a *second* draw via `requestDraw()`/`requestAnimationFrame` once it lands. A screenshot taken between those two draws depends on how fast that one icon's fetch happened to be -- unnoticeable on a quiet machine, a real source of the region-sized, load-dependent diffs described above on a contended CI runner. Map snapshots settle through `settleMapIconsAndDraw()` (`test/e2e/helpers.js`), which draws once, awaits every icon already in `mapImageCache` finishing (load or error), then draws again -- closing the race instead of outracing it with a longer wait. This does not retire the bullet above: it removes one proven cause, not a guarantee against every future one, so the dedicated check and its retry stay.
- `/api/cows` is always mocked via `test/e2e/fixtures/cows.json` — never hit the live Nofence API in tests.
- **Geolocation is always answered, one way or the other.** A spec that wants a position says so with `test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] })`; every other spec gets an immediate `PERMISSION_DENIED` from `denyGeolocationUnlessGranted` in `test/e2e/helpers.js`. Chromium answers an ungranted `getCurrentPosition` neither way — no success callback, no error callback, and the request's own `timeout` option does not start until the permission decision is made — so without this a spec that does not grant location sat through the app's whole boot-location bound on every page load, and whether it beat the test timeout depended on how loaded the machine was. That is what used to make whole spec files fail together on CI. The stub only replaces `getCurrentPosition`, and only when the permission has not been granted, so a granting spec keeps the real API and Playwright's mock position.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (optional, unset by default) points Playwright at an existing Chromium binary instead of the one it downloads. It exists only for sandboxes that cannot reach `cdn.playwright.dev` and so cannot run `npx playwright install`; local Macs and CI are unaffected and keep using Playwright's own pinned browser. A mismatched Chromium build renders text differently, so `toHaveScreenshot()` failures under this var are environmental and must never be used to regenerate the committed snapshots.
- **One Playwright project per CI runner, two workers each, five shards per project.** A GitHub-hosted runner has 2 vCPUs. Running the whole suite on one of them at `workers: 4` gave every worker half a core, which stretched the app's boot-and-draw cycle past the waits the specs bound it with and failed whole spec files together in `beforeEach` — around 20 failures a run, while the same suite showed 3-4 on a 4-core dev box. That was starvation, not flakiness. `.github/workflows/ci.yml` runs the `E2E tests` job as a `project: [desktop, mobile]` × `shard: [1, 2, 3, 4, 5]` matrix (`--shard=N/5`), and `playwright.config.js` sets `workers: process.env.CI ? 2 : 4`: ten runners, two workers each, a full core per worker, all ten jobs concurrent — each one now covers about a fifth of a project's specs. Five shards replaced three because the slowest desktop shard set the wall-clock time for the whole run. `playwright.config.js` sets `fullyParallel: true` so shards split by test rather than by whole file. Before that, one desktop shard took 13 minutes while another took 2.5. Spec files whose `beforeAll` regenerates build output on disk opt back out with `test.describe.configure({ mode: "default" })`, so no worker reads a page while another is rewriting it. The desktop `E2E tests` jobs skip the spec files the mobile project's `testMatch` already runs (`01`–`05`, `09`, `13-tilt-3d`, `27`). This is a phone-first app, so desktop functional coverage is only what mobile never exercises. Desktop snapshots are unaffected. This repo is a public repo on GitHub's free plan, which has no Actions-minutes cost and a concurrent-job budget well above what CI uses even with this split, so there is no reason to shard any less than this.
- **`e2e` and `visual-snapshots` run in Microsoft's own Playwright container image, not the bare `ubuntu-latest` runner.** Both jobs set `container: image: mcr.microsoft.com/playwright:v1.61.1-noble` -- the exact tag Microsoft publishes for this repo's `@playwright/test` version (`package.json`) against `ubuntu-latest`'s codename (noble/24.04), with Chromium, Xvfb and every font/library `--with-deps` used to apt-install already baked in. This replaced a separate `npx playwright install --with-deps chromium` step that re-downloaded the browser and apt-installed from scratch on every single job (~25-30s, observed directly in CI logs), repeated across all seven Playwright jobs on every run. Beyond the time, that step was also a standing network dependency on cdn.playwright.dev and the apt mirrors that bought nothing but risk. Bump the tag only together with `@playwright/test` in `package.json` -- a mismatched tag's Chromium build can render text differently, the same risk `PLAYWRIGHT_CHROMIUM_EXECUTABLE` already carries. `update-snapshots.yml` uses the same image for the same reason.
- **`E2E tests` never takes a screenshot.** Every `"snapshot: ..."` test is excluded from it with `--grep-invert "snapshot:"` and instead runs as its own `Visual snapshots (desktop + mobile)` job, `--grep "snapshot:"` once on each Playwright project. The desktop-only no-JavaScript snapshots live in `32-public-nojs-snapshots.spec.js`, which the mobile project's `testMatch` deliberately excludes. This keeps the two check names meaningfully different: a red `E2E tests (<project>, shard <n>)` is always a functional regression. The visual job uploads its candidate renders without changing the PR branch; a completed screenshot pixel/dimension mismatch with actual-image evidence is advisory. The JSON result classifier blocks browser launch, setup, boot, nonvisual assertion, timeout, missing-report and all-skipped runs. Reports and failure traces are retained separately for both projects; dependency-installation and artifact-upload errors still fail normally. The trusted `Publish visual snapshots` workflow writes the baseline/actual/diff table into the PR, while the main-branch `Update Snapshots` workflow regenerates canonical baselines and commits them directly to `main` after a merge. PR-body updates are done by the publisher so the visual sections cannot overwrite each other.
- **Every screen has a snapshot, on both projects.** Each app screen and state a user can land on (map ready, Nearby, a tree, a place, an event, Filters, Search before and after typing, Settings, the update banner, Community, Feedback, onboarding, the far-from-the-forest notice) and each public page (homepage, ledger index and edition, Nearby category landings, terms, contribute) has a `"snapshot: ..."` test that runs on `desktop` and `mobile`, so any visible change surfaces as a diff in the PR description. A page that server-renders content for a no-JavaScript visitor (homepage, ledger, bare `/nearby`, `/nearby/<category>/`, `/find/<slug>/`) also has a no-JS snapshot in `32-public-nojs-snapshots.spec.js`; a static page that renders the same either way does not. The admin sign-in screen is desktop only. A new screen gets its snapshot in the same change. App snapshots whose journey spec is desktop-only live in `38-screen-snapshots.spec.js`, and any file holding app snapshots must be in the mobile project's `testMatch`, or its phone baseline is silently never taken. Never `mask` `#mapCanvas`: it fills the viewport, so the mask paints over everything on top of it too and the baseline becomes a solid block that can never show a change (`tree-detail` was that way until it was found). Freeze anything clock-dependent (`page.clock.setFixedTime`) so a baseline does not change with the day CI runs.
- **To reproduce a CI-only failure locally, constrain the CPU:** `CI=1 taskset -c 0,1 npx playwright test --project=mobile`. Two cores and `CI=1` is what the runner actually gives a job, and it reproduces starvation failures that a 4-core box hides completely. Do this before concluding a CI failure is "environmental".
- **Specs say *what* they wait for; `playwright.config.js` says how long.** `expect.timeout` is 20s under CI and 5s elsewhere, so don't pass `{ timeout: N }` to an `expect()` assertion. An assertion's timeout bounds how long the UI may take to get somewhere — it is not a behaviour under test, and a genuinely broken UI still fails on the 60s test timeout. Roughly a hundred hard-coded few-second bounds were what turned a slow runner into a red suite; they are gone, and new ones should not appear. A deliberately long bound for something genuinely slow (the boot-location tests in `09-location`) is fine and stays explicit.
- `toHaveScreenshot()` allows `maxDiffPixelRatio: 0.001`. Even comparing against baselines CI generated itself on the same runner image, canvas antialiasing and font hinting came back ~28 pixels apart on a ~334k-pixel screenshot under load. 0.1% is ten times the headroom that noise needs and still catches any diff big enough to see. The `toHaveScreenshot()` stability timeout is 15s under CI (5s elsewhere) for the same reason.

### CI is the verdict, and the PR is how you get it

**Open the PR as soon as the lead session has pushed the reviewed work, and let its `E2E tests` shards and `Visual
snapshots (mobile)` be the one full run of the suite.** CI only fires on `pull_request` (plus a
push to `main` and a manual dispatch), so a branch pushed without a PR gets no checks at all —
and reaching for `workflow_dispatch` to fix that just means two runs of the same suite on the
same SHA. Open the PR instead.

**Do not run the full `npm run test:e2e` locally as well.** It is ~10-27 minutes that CI is
already going to spend, and it does not settle anything: the two disagree badly and routinely.
This suite has run 3-4 failures in a dev sandbox and 20-25 on a GitHub runner, because the
runner has 2 vCPUs and timing-sensitive specs (`beforeEach` waits, animation frames, paint
counts) fail there and nowhere else. A sandbox is just as capable of inventing a failure that
CI does not have: a full local run once reported `12-selected-route`'s "does not twitch once a
second" lurching 568px, purely because something else on the box was saturating the CPU at the
time; it passed on CI and on a re-run.

**Run the specs your change actually touches, and nothing else.** A single spec or a `-g`
filter is seconds, and it is what proves a new test is real — write the test, confirm it fails
against the unfixed code, confirm it passes against the fix. That is worth doing every time;
the full sweep is not.

So, before a PR is done — every time, no exceptions:

1. **After the review and test gates pass, the lead session pushes and opens the PR, then reads the CI run for the head SHA.** `actions_list` →
   `list_workflow_runs` filtered to your branch, then `list_workflow_jobs`, then `get_job_logs`
   on each `E2E tests (<project>, shard <n>)` job and on `Visual snapshots (desktop + mobile)`. Read the
   `N failed / N passed` line and the failure list under it.
2. **Every `E2E tests` shard must be green.** Not "green apart from the environmental ones" —
   green. A warning from `Visual snapshots (desktop + mobile)` is a separate, narrower signal (see below) — it never
   excuses a red `E2E tests` shard, and a red `E2E tests` shard is never explained away as "just
   a snapshot issue".
3. **Never call a failure pre-existing on the basis of a local run.** Establish it CI-to-CI:
   pull the CI failure list for your merge-base commit (the run on `main` for the SHA you
   branched from) and diff the two lists by test name. A failure on your branch that is not on
   that list is yours, whatever it looks like.
4. **Keep local receipts and CI evidence distinct.** State exact local commands/counts as local
   evidence, and the CI run URL/pass-fail counts for the current head as the full-suite verdict.
   A local pass never substitutes for CI. If anything is red, name the failing tests and the
   merge-base CI run that establishes any pre-existing status.
5. **A `Visual snapshots (desktop + mobile)` mismatch is a pixel diff, not a functional regression.** Its
   baseline, actual render and diff are published into the PR description automatically. Review the
   images before merging; the PR branch is never changed by snapshot publication, and the visual
   check reports screenshot differences as warnings rather than failing CI. The PR comparison table and Playwright artifacts remain available for review. After the merge, the main-branch
   workflow regenerates them directly on `main` through the protected-branch GitHub App path, with
   the resulting commit triggering CI verification on the canonical baselines. A new snapshot with no
   committed baseline yet is a warning too: its first render is published as the Actual, with
   "No baseline yet, first render" in the Baseline cell.

If a wait is unavoidable, wait: each `E2E tests` shard takes a few minutes less than the old
single-project run; `Visual snapshots (desktop + mobile)` is a handful of tests and finishes quickly, but
CI's queueing and setup time still applies. Reporting a task finished before its CI run exists is
reporting a guess. Two consecutive PRs were once handed over as done on the strength of a
green-ish local run while their CI job was red the whole time.

After opening a PR, keep monitoring it for reviewer feedback and requested changes. After every
push to the PR branch, address actionable feedback, run the relevant tests, push any resulting
update, and re-check the resulting CI and review state. Do not stop working or report the task
complete while the PR is awaiting review or has unresolved requested changes; continue until the
required reviewers have approved it, required checks are green, and no requested changes remain.
If approval is blocked by a permission problem or a decision needed from the user, report that
blocker explicitly.

After each pushed update, wait for the current deploy preview to be available. The final response
for that update must be a useful testing link into the current preview, using a representative
page or flow and including `nuke=true` in the URL (or `&nuke=true` when a query string already
exists). If the preview is unavailable, say so explicitly rather than presenting an unverified
link.

### Screenshots in every PR

Every PR needs at least one screenshot showing the change in the running app, not just prose
describing it — a reviewer should be able to see the result without pulling the branch.
- **UI/visual change:** capture before and after. Start the dev server (`npm run dev`) or drive
  the page with Playwright (`page.screenshot()`), screenshot the affected view, and embed both
  images directly in the PR description.
- **No visible UI effect** (data fix, backend-only logic, test-only, spec-only change): say so
  explicitly in the PR description instead of a screenshot — do not fabricate one.
- A committed Playwright baseline (`test/e2e/__screenshots__/`) is a CI regression artifact, not
  a substitute: it's pixel-exact to the unchanged parts of the page too, so it rarely shows the
  change on its own. Take a fresh screenshot for the PR body even when a baseline also changed.
- **Changed baselines get their diffs in the PR description.** When a PR changes any
  `toHaveScreenshot()` baseline, list every changed snapshot by name and embed its before and after
  images (`![before](...)`, `![after](...)`), each linked to the file at the commit it came from
  (`https://raw.githubusercontent.com/<owner>/<repo>/<sha>/test/e2e/__screenshots__/<name>.png`), so
  no separate hosting is needed. CI fills this section automatically; the **Update Snapshots** workflow
  is only a fallback for branches that are not in a PR.
- **The preview link stays in the PR description.** Keep the Netlify block between
  `<!-- preview-links:start -->` and `<!-- preview-links:end -->`. When a description is rewritten,
  copy that block back verbatim, or the reviewer loses the deploy preview.

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
2. The e2e specs your change touches pass locally — that spec file, or a `-g` filter within it,
   not the whole suite. A new test is confirmed to fail against the unfixed code first. Chasing
   a failure CI has and you do not? `CI=1 taskset -c 0,1 npx playwright test --project=<name>`
   reproduces the runner's 2 vCPUs.
3. Relevant `spec/` file is updated, or reason documented.
4. Create a commit with a good concise description summarising the change.
5. After the review and test gates pass, the lead session pushes and opens the PR with screenshots of the change in its description (see "Screenshots in
   every PR" above), then confirm every `E2E tests (<project>, shard <n>)` job is **green on
   your branch**, and review warnings from `Visual snapshots (desktop + mobile)` — per "CI is the verdict"
   above. That PR run is the full sweep; do not also run the suite locally or dispatch CI by
   hand. The task is not finished until `E2E tests` is green, and the report says what CI said.


### Lightweight failure diagnostics

CI retains the first failed attempt’s action/network trace and a final screenshot. Continuous DOM
snapshots and screencast recording are disabled: capturing this canvas app on every Playwright
action added enough observer work to reproduce a keyboard-visibility failure on two CPUs and can
outlast held-request deadlines. Enable full tracing only for a focused diagnosis, not the whole
functional suite. Preserve the original assertions and report instrumentation when comparing runs.
