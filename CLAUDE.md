# Epping Forest Finds — active agent rules

Vanilla HTML/CSS/JS, phone-first, offline-first. Keep changes scoped and use the owning module.
`app.html` is markup and script references only. Marketing (`index.html`, `assets/home/`) is an
independent surface: never import app CSS/JS or reference app icons there at runtime.

- Delegate implementation to one scoped `implementer` per owned part of a coherent batch, on a
  branch/worktree from `origin/main`; place-fact corrections go to `data-curator`. The lead plans,
  dispatches and reports. If those agents are unavailable, say so and work directly. Subagents do
  not spawn agents. Serialize changes to shared hot files.
- Update affected spec sections with behavior changes. Correct individual place facts in `data/**`,
  never by documenting a place name/status/coordinates in a spec. State when no spec update applies.
- CI owns `js/app-cache-version.js`, `js/data-cache-version.js` and screenshot baselines. Never edit
  markers, pick version numbers in conflicts or regenerate committed baselines in an agent task.
- Tests execute user/caller behavior, not source strings or implementation formulas. Prove a
  regression test fails before the fix. Finish with full unfiltered unit coverage and focused local
  E2E on affected projects; CI on the PR is the only full browser sweep. No sleeps, unexplained skips
  or weakened assertions to get green. Shared helper changes require their dependent journeys.
- Run independent correctness review plus selected risk lenses. Rerun affected reviews/tests after
  fixes; architecture/shared-contract changes require broad rereview. Evidence belongs to an exact
  SHA and environment. Static reading cannot establish runtime layout, focus, timing or offline behavior.
- Implementers commit locally. The lead pushes the coherent batch after the aggregate review/test
  gates, opens one PR and reconciles checks on its exact head. The steward is the single repair
  owner; fixes and conflict resolutions go through the same gates. Never approve, merge or force-push.
- Do not report completion while required checks, findings or human approval remain outstanding.
  Compare failing tests CI-to-CI before calling them pre-existing. State a waiting/blocker condition
  plainly; do not busy-poll or treat a passing rerun as proof a defect is unrelated.
- Preserve the PR's preview-links block. Inspect visual evidence, wait for the current preview, and
  hand over a representative testing URL with `nuke=true`; explicitly report when unavailable.

Load references on demand, rather than reading every spec on each invocation:

- `spec/agents.md`: module/spec map, active constraints, role routing and completion rules.
- `.claude/skills/team/SKILL.md`: batch selection, lead dispatch, risk selection and repair rounds.
- `docs/agents/review-contract.md`: findings, evidence receipts, invalidation and PR status.
- `docs/agents/testing.md`: test commands, snapshot evidence and CI diagnosis.
- Relevant product spec headings and `CODING_STANDARDS.md` for the change; expand only along dependencies.
