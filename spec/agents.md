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
- `spec/spec-community.md` — community verification: report statuses, overlay, outbox, scoring, upstream export (proposed)
- `spec/spec-alpha-access.md` — closed alpha gate, `/` vs `/app` URL split, shared secret link, service-worker navigation scope
- `spec/spec-marketing.md` — positioning, approved phrase bank, marketing homepage at `/`, mailing-list sign-up, social sharing assets
- `spec/spec-issue-workflow.md` — GitHub issue clarification automation (`.github/workflows/issue-clarify.yml`)
- `spec/spec-claude-pr-review.md` — lightweight final-head review and publication workflow
- `spec/glossary.md` — product terminology

Update the affected section only; do not pad.

Do not consider a behaviour change complete until the matching spec update is included in the same change set. If no spec update is needed, state the reason in the final response.

A correction to a specific place's real-world facts (it closed, renamed, moved, or is mis-categorised) is a data change, not a behaviour change: fix the data file directly and leave the spec alone. Only touch a spec file when the change alters what the app does or how it is structured — a spec file must never carry a specific place's name, status, or coordinates as documentation. When addressing a reported issue, fix the underlying cause (the data, the code) rather than writing the specific detail into a spec file.

Before finishing any implementation task:
- Check `git diff --name-only`.
- Map changed files to the relevant `spec/` document.
- Update the spec or explicitly document why the change is implementation-only.

## Agent skills

Skills live in `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex). Use them as part of the normal workflow:

- **Non-trivial feature or ambiguous request:** start with `/grill-with-docs` (it uses the repo's `grilling` skill), then `/to-spec`. Specs go into the matching `spec/*.md` file, not only an issue. These and `/implement` only run when typed, so suggest the command to the user instead of skipping the step.
- **Implementation:** `/implement` or `/tdd`. A new user-facing behaviour still needs its BDD test in `test/e2e/`.
- **Bug, failing or flaky test:** `/diagnosing-bugs`; establish CI-to-CI whether a failure is pre-existing (see Testing).
- **Pull request body:** follow `/pr`, but `.github/pull_request_template.md`, the screenshot rules and the preview-links block win where they differ.
- **Throwaway UX/logic experiment:** `/prototype`. Delete the prototype code before committing.
- **Code review:** use independent `reviewer` plus selected risk lenses from `/team`; keep Standards
  and Spec as separate questions without automatically launching another duplicate review team.
- **Wrap-up (optional):** `/retro`.

### Issue tracker

GitHub Issues via `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Glossary and decisions live in `spec/`, not `GLOSSARY.md`/`docs/adr/`. See `docs/agents/domain.md`.

## Team of agents

Use the lead's `/team` playbook for a coherent batch of related work. A branch and PR represent the
batch, not necessarily one issue. Include associated specs, tests and review fixes together; separate
unrelated, independently deployable or incompatible-risk changes. The user can authorize an overall
batch once; do not ask again for its routine subtasks. Serialize hot-file changes within the batch.

The definitions in `.claude/agents/` are short-lived custom subagents. The
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` setting enables persistent team capability; it does not
create a team or turn each subagent call into a teammate. Use persistent teams only when independent
long-lived work needs direct coordination. Use Sonnet for judgment and Haiku for bounded execution;
agent frontmatter sets the normal model and turn budget. Escalate for a concrete unresolved problem.

- `implementer`: a scoped code/test/spec part of the batch; commits locally, never pushes.
- `data-curator`: place-fact correction in the authoritative data source and regenerated outputs.
- `reviewer`: independent correctness, state-transition regression and test-contract review.
- Conditional reviewers: `security-reviewer` for auth, endpoints, uploads, private data and privileged
  workflows; `offline-reviewer` for caching, fetch/failure paths, outbox and native parity;
  `performance-reviewer` for frame/startup/payload risks; `progressive-enhancement-reviewer` for
  the no-JS to JS handoff (generated pages, initial markup, boot/first render, script order),
  running the existing focused no-JS/boot specs when the lead grants it the browser slot;
  `transition-reviewer` for continuity between app states (screen/panel slides, selection, routes,
  rail and list patches, the accompanying camera move), on the same browser-slot terms;
  `accessibility-reviewer`, `design-reviewer` and `ux-reviewer` when their specific risk changes.
  Do not launch every specialist for every edit.
- `test-runner`: validates receipt provenance and coverage, executes missing or invalid checks and
  reports counts. It does not repeat identical valid checks merely to produce another report.
- `pr-steward`: single post-push repair coordinator. It returns every edit/conflict resolution through
  the lead's review/test gates and resolves only verified bot findings after current-head checks.
  Human approval remains separate. The lightweight GitHub reviewer independently checks the final
  pushed commit; it does not replace local review or human approval.

The lead dispatches; subagents report back without spawning. Default implementation goes through
these roles when available. If the agents are unavailable, say so and perform the authorized work
through available tools. Review before pushing, including later fixes and conflict resolutions.

Use one task branch/worktree from `origin/main` per batch. Sequential scoped agents may share that
batch worktree with exclusive ownership; concurrent agents must own disjoint files and use separate
worktrees when isolation is needed. Never edit the same hot file concurrently (`app.html`,
`js/app.js`, `sw.js`, `spec/*.md`, `test/forest-finds.test.js`). Do not stack on an open PR.
The lead alone assembles/reviews the aggregate delta, pushes once gates pass and opens one batch PR.

The lead supplies immutable base/head SHAs, branch/worktree, requirements, file ownership, relevant
spec headings, risk triggers and test/artifact paths. Reports name findings, reviewed SHA and evidence;
use `docs/agents/review-contract.md` for the shared format, receipt validity and rerun rules. After
fixes, rerun affected lenses and tests based on dependencies; architecture/shared-contract changes
or uncertain impact require the full selected review set. Stop after three unsuccessful repair rounds.

Use `node scripts/pr-status.js <PR> --state /tmp/<batch>-pr-state.json` for compact status deltas;
wake the steward only for an actionable change, not unchanged pending checks or human approval.
Read failure logs selectively. If subscriptions are unavailable, use supported bounded waits and say
so. Never claim completion while required checks, actionable findings or human approval remain open.

## Marketing and app surfaces

- `index.html` (marketing homepage, `/`) and `assets/home/**` are a separate surface from the app (`app.html`, `js/**`, `css/**`). Marketing must not import app CSS/JS or reference app icons at runtime; small brand assets are independent copies in `assets/home/`.
- `/`, `/app`, `/reports/`, `/terms.html`, and `/api/subscribe` are the integration contract between the two surfaces.
- `assets/home/**` is outside the app cache and the app-release workflow's watched paths — marketing-only edits need no app cache/version bump; app changes retain the cache-release rules below.

## Project Structure
- `index.html` — the public marketing homepage at `/`. Static content, its own `assets/home/` styles, scripts and images, no app code
- `app.html` — the map application, served at `/app`. Markup only: head tags, DOM skeleton, and the `<script src>` list. No logic, no inline `<script>` body
- `netlify/edge-functions/alpha-gate.js` — closed alpha gate on `/app` (see `spec/spec-alpha-access.md`)
- `netlify/edge-functions/native-cors.js` — CORS on `/api/*` for the native app's two WebView origins only (see `spec/spec-native.md`)
- `js/native.js` — native capability layer, loaded first: the only client file that knows about Capacitor (see `spec/spec-native.md`)
- `native/` — Capacitor shell for the App Store / Google Play: its own `package.json`, `scripts/sync-www.js` (allowlisted bundle of the client), committed `ios/` and `android/` projects
- `netlify/functions/subscribe.js` — mailing-list sign-up endpoint for the homepage
- `js/app.js` — application state, boot sequence and wiring (compass, camera, canvas, boot-time handlers). Loaded last, after every other `js/*.js`
- `js/shared.js` — helpers both the app and the admin page use (`escapeHtml`, `clamp`, the GeoJSON coordinate walkers). Loaded first
- `js/permission-asks.js` — the consent and permission prompts (location, analytics, motion, the first-visit card). Loaded before `app.js`
- `js/map-search.js` — map search: the search index, ranking and results. Loaded before `app.js`
- `js/router.js` — URL routing: screen routes, hash and history entries, query-string arrivals. Loaded before `app.js`
- `js/location-smoothing.js` — GPS fix ingestion, the glide that eases the You marker to each fix, and the camera that follows it while travelling. Loaded before `app.js`
- `js/tilt.js` — tilt camera state and geometry, and the 3D ground projection. Loaded before `app.js`
- `js/event-alert.js` — nearby-event proximity check and banner. Loaded before `app.js`
- `js/heads-up.js` — heads-up ordering of the nearby list. Loaded before `app.js`
- `js/settings.js` — the Settings screen: markup, rows and handlers. Loaded before `app.js`
- `js/report.js` — the Report screen: form, photo handling, send-or-queue and location-issue reports. Loaded before `app.js`
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
- **Current cache-marker policy: never edit `js/app-cache-version.js` or `js/data-cache-version.js` by hand.** `.github/workflows/cache-version-bump.yml` owns both files. After a qualifying merge to `main`, its dedicated GitHub App increments only the relevant marker(s) and triggers the Netlify release build hook. Agents must not add marker changes to a PR, resolve a conflict by changing a version number, or use `WEEKLY_LEDGER_PAT` for this flow. App changes (`app.html`, app shell CSS/JS, `sw.js`, the manifest or icon) move the app marker; `data/**` moves the data marker. `index.html` is marketing and must not move the app marker.
- Historical cache incidents live in `docs/agents/cache-incidents.md`; those superseded workflows and conflict instructions are not current policy.
- **Loopback local dev (`node server.js` / `npm run dev`) skips the service worker.** `setupPwa()` unregisters any old local registration and refreshes read directly from the dev server. Tunnelled development and explicit browser-test opt-ins still use `server.js`'s injected `self.__DEV__ = true` flag and the worker's network-first strategy. Don't try to “fix” stale local testing by bumping `CACHE_NAME` by hand — that's a CI concern; if a tunnelled or opt-in run is stale, check the dev-flag wiring in `server.js`/`sw.js`. `injectDevFlag()` also prefixes the served `CACHE_NAME` with `dev-` (e.g. `forest-finds-dev-v274`), so the Settings “About” version display and any bug-report `appVersion` are visibly local rather than a frozen release number.

## Testing and completion

- Tests execute behavior; never mirror implementation formulas, grep source text as behavior tests,
  weaken an assertion to get green, or skip missing preconditions. Prove regression tests fail on the
  unfixed code (or a relevant mutant), then pass on the fix.
- Finish with a full unfiltered `npm run test:unit`; run the other Node/Python suites covering changed
  modules. New user-facing behavior requires a matching BDD journey in `test/e2e/`.
- Run only affected E2E specs/projects locally. CI on the PR is the one full browser sweep. Shared
  helper changes require all dependent specs on every affected project. Use state waits, not sleeps.
- Test and review evidence belongs to an exact commit and environment. See
  `docs/agents/review-contract.md` for reusable receipts and when a rerun is required.
- Inspect every required check for the current head SHA and the visual artifacts. A red E2E shard
  remains a failure; a visual mismatch requires a current-head decision. Compare failing test IDs,
  project and error signatures CI-to-CI before calling any failure pre-existing. A passing rerun
  establishes intermittency, not that the PR is innocent.
- Unit evidence is local until confirmed by CI. Do not describe a task as complete while checks,
  actionable findings or required human approval remain outstanding. Waiting on a person is a
  named waiting state, not a reason to busy-poll or claim completion.
- No agent edits cache markers or committed screenshot baselines. CI publishes baseline/actual/diff
  artifacts and owns canonical baseline regeneration after merge. Distinguish screenshot mismatches
  from launch, boot, setup, assertion and timeout failures.
- Before handoff: map the diff to specs, commit on the task branch, pass local gates, push and open a
  PR. Reconcile feedback and CI after every push. Preserve the preview-links block. Wait for the
  current preview and give a representative testing URL containing `nuke=true`; explicitly report
  when unavailable. Visual changes need before/after evidence; nonvisual changes state why none is needed.

Detailed commands, snapshot rules, CI diagnosis and screenshot evidence:
`docs/agents/testing.md`. Read its relevant section before changing tests or preparing a PR.

## Code Quality
- Separate concerns strictly per the project structure above.
- Reuse existing CSS classes before adding new ones.
- No logic in `app.html`: it is markup and `<script src>` tags only. Boot and wiring live in `js/app.js`.
- UX quality bar: this should feel like a polished, professional product.
- Optimise for token efficiency: short, precise edits over large rewrites.

## Pull requests (every agent, every PR)

Every pull request, whichever agent opens it, follows `.github/pull_request_template.md` and these rules:

- **Description:** keep it concise and easy to scan. Lead with who benefits, what changes for them, and why it matters; include implementation details only to explain an impact or risk. Provide repeatable testing steps with expected results and a short, change-specific checklist of areas to check. Remove optional sections and checks that do not apply, and state any testing gaps.
- **Visual changes:** when a PR changes any `toHaveScreenshot()` baseline, list each changed snapshot by name in the PR body and embed its before and after images as Markdown images (`![before](...)`, `![after](...)`). Link each image to the file at the commit it came from, for example `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/test/e2e/__screenshots__/<name>.png`, so the images need no separate hosting. Take them from the CI `Visual snapshots (desktop + mobile)` artifact or from the committed baselines before and after the change.
- **Baselines:** every PR run publishes each changed snapshot's committed baseline, actual render and diff to the `visual-diffs` branch and writes them into a `Failing visual snapshots` table in the PR description. Snapshot publication never commits into the PR branch, so binary baselines cannot conflict between feature branches. After a source change reaches `main`, the `Update Snapshots` workflow regenerates the canonical files and commits them directly to `main` through the protected-branch GitHub App path, which triggers CI against the updated baselines.
- **Preview link:** keep the Netlify block between `<!-- preview-links:start -->` and `<!-- preview-links:end -->` in the PR body. When you rewrite a description, copy that block back verbatim. Netlify fills it in once the deploy preview is ready.
- **Spec and tests:** follow the Spec Synchronisation and Testing sections above.
