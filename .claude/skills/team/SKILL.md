---
name: team
description: "Lead playbook for coherent batches: implement locally, review changed risks, verify evidence, push one reviewed batch and coordinate its PR."
disable-model-invocation: true
---

The lead dispatches; subagents do not spawn agents. Read `docs/agents/review-contract.md` for the
shared evidence/invalidation rules. The user's authorized scope takes precedence over routine
workflow suggestions; do not ask again for approval of already-authorized batch subtasks.

## 1. Choose a coherent batch

Read referenced issues and state their titles. Classify code/test/spec/style work for `implementer`
and real-world place facts for `data-curator`. Batch related work into one branch/PR when it has one
clear subsystem or user goal, compatible rollback/risk, and a reviewable combined test plan. Include
associated specs, tests and review fixes. Do not turn each issue automatically into a PR.

Keep unrelated independently deployable features, incompatible migrations or changes whose combined
risk cannot be reviewed separately. If reviewers cannot explain the aggregate behavior, ownership and
rollback in a short summary, split it. This is a reviewability limit, not a target line count. Show the
batch plan and proceed within the user's authorization; ask only for a material ambiguity or scope
expansion, never another go-ahead for routine parts of an approved batch.

Use one branch/worktree from `origin/main` for the batch. Allocate exclusive file ownership and
serialize hot-file changes (`app.html`, `js/app.js`, `sw.js`, `spec/*.md`, `test/forest-finds.test.js`).
Sequential agents may share the batch worktree. For independent parallel work use isolated worktrees
and integrate locally before aggregate review. Never stack a branch on an unmerged PR. At most three
implementers run at once; the lead owns integration and all pushes.

## 2. Implement locally

Dispatch scoped work with base SHA, branch/worktree, owned files, requirements, neighboring journeys,
relevant spec headings, risk triggers and targeted checks. Load context by dependency; do not copy a
full repository briefing into every prompt. Agents commit locally and report commit SHAs, changes,
spec updates or the implementation-only reason, receipts and gaps. They do not push.

New regression tests fail on the unfixed code or a relevant mutant, then pass on the fix. Test and
spec updates belong with the batch. Browser runs have one owner and a CPU/port budget: parallel
worktrees must not each launch a full set of Playwright workers or reuse another worktree's server.

## 3. Review the aggregate head

Freeze the clean local head and dispatch independent `reviewer` for correctness, state transitions
and test contracts. Select additional lenses for concrete changed risks:

| Risk | Additional lens |
| --- | --- |
| Auth, server endpoints, uploads, private data, untrusted input or privileged workflows | `security-reviewer` |
| Cache/shell/data lists, fetch/failure path, outbox or native bundle | `offline-reviewer` |
| Per-frame, startup, data loading, payload or battery cost | `performance-reviewer` |
| Focus, accessible names, targets, contrast, zoom or motion accessibility | `accessibility-reviewer` |
| Significant visual hierarchy, layout, tokens or icon changes | `design-reviewer` |
| New journeys, navigation, permission asks, error recovery or action/copy mismatch | `ux-reviewer` |

For a small copy/style edit, the general reviewer can cover the relevant experience questions with
rendered evidence; do not spawn three experience specialists automatically. A data-only correction
still needs source provenance, format/ID/slug invariants and the general reviewer. Add offline/native
review when it changes file lists, formats or bundling. Paths are hints, not a reason to miss a risk.

Collect concise structured findings with `proven-code`, `proven-test` or `needs-verification` evidence.
Deduplicate overlapping defects. Batch blockers/majors into one repair round. After fixes recompute
risk from the delta: rerun affected reviewers and newly implicated lenses; unaffected lens evidence
can carry forward only with an explicit dependency reason and its original SHA. Architecture, shared
contracts, broad conflict resolutions or uncertain impact require the full selected set again.

The lead records attempts before dispatch. Stop after three unsuccessful repair rounds for the batch
and report open findings. A code change is not verified merely because a model completed its turn.

## 4. Verify the aggregate head

The `test-runner` audits the scenario plan and receipts and runs missing/invalid checks. Reuse checks
only when exact SHA, clean tree, dependencies, environment, command and generated/server inputs
match. Do not blindly rerun valid identical commands. A filtered unit run is never the full unit
pass. For code changes require full unfiltered unit coverage and affected Node/Python/E2E checks;
process-only changes require appropriate executable/config validation and explicitly state why
browser behavior is unaffected. One local full unit pass suffices; CI runs the full browser sweep.

Run reviews and tests concurrently on a frozen head only when CPU capacity allows. Any edits
invalidate affected evidence. CI-to-CI test ID/project/error comparison is required before declaring
failures pre-existing; a passing retry proves only intermittency. Preserve first-run failures.

## 5. One push and PR per reviewed batch

Only after the aggregate clean head has no open blockers/majors, required verification is complete
and applicable local checks pass, push from the lead and open one PR by default. Do not push partial
items just to get CI. Include one consolidated verification report and representative preview flow.
Every later repair round follows the same gates and is batched into one push; CI must still finish
on its exact current head. Never rebase, amend, force-push, approve or merge the PR.

Keep the lightweight GitHub PR reviewer as an independent final-head correctness/security/evidence
check. It does not repeat local specialist fan-out or replace human approval.

## 6. Coordinate the PR without no-op model turns

Use `node scripts/pr-status.js <PR> --state /tmp/<batch>-pr-state.json` to collect compact status
and detect deltas. Subscribe to events where supported; otherwise use bounded platform waits and
state that limitation. Dispatch `pr-steward` only for actionable changes. Fetch full logs only for
failures; unchanged pending CI or waiting human approval does not need a new LLM review.

The steward is the single post-push repair coordinator. It batches validated findings and routes
fixes, including conflicts and small human asks, back through local review/test gates. Resolve bot
threads only after the specific defect is verified fixed on the current head, affected reviews are
complete and required CI is green. Do not resolve a human thread without their authorization.

Report batch branch/worktree, current head, selected verdicts, verification counts/run URLs, visual
acceptance and preview link with `nuke=true`. Separate CI, unresolved findings and human approval.
Do not claim completion while any required gate remains open; give a named waiting/blocker state.
Never edit cache markers, screenshot baselines, disable tests or put place facts into specs.
