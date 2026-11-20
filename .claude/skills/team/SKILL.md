---
name: team
description: "REQUIRED first step for ANY change to the Epping Forest Finds app or website: app code (js/, css/, app.html, sw.js), marketing pages (index.html, assets/home/), icons, tests, specs or place data. Use before editing any file for such a change, including small fixes and copy tweaks. Runs the lead playbook: plans the batch, dispatches scoped implementer/data-curator agents, selects risk reviewers, verifies, and opens one draft PR, marked ready once the /team gate passes. Skip only for questions with no file edits."
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
and test contracts. Use the model-routing table and compact-brief format in
`docs/agents/review-contract.md`; routine checks stay with the existing Haiku execution task.
Record each selected specialist with its changed path/dependency and concrete risk question before
dispatch. An absent risk means no specialist invocation. Select additional lenses for concrete changed risks:

| Risk | Additional lens |
| --- | --- |
| Auth, server endpoints, uploads, private data, untrusted input or privileged workflows | `security-reviewer` |
| Cache/shell/data lists, fetch/failure path, outbox or native bundle | `offline-reviewer` |
| Per-frame, startup, data loading, payload or battery cost | `performance-reviewer` |
| Generated/static page markup, `app.html` initial state, boot/first-render takeover, script order or marketing load motion | `progressive-enhancement-reviewer` |
| Screen switching, routing, inspector/panel chrome, list or rail rendering, camera moves or animation timing | `transition-reviewer` |
| Focus, accessible names, targets, contrast, zoom or motion accessibility | `accessibility-reviewer` |
| Significant visual hierarchy, layout, tokens or icon changes | `design-reviewer` |
| New journeys, navigation, permission asks, error recovery or action/copy mismatch | `ux-reviewer` |

For a small copy/style edit, the general reviewer can cover the relevant experience questions with
rendered evidence; do not spawn three experience specialists automatically. A data-only correction
still needs source provenance, format/ID/slug invariants and the general reviewer. Add offline/native
review when it changes file lists, formats or bundling. Paths are hints, not a reason to miss a risk.

`progressive-enhancement-reviewer` and `transition-reviewer` can run their existing focused specs
themselves. Give one of them the browser slot in its brief only while `test-runner` and every other
browser run is idle; otherwise it reviews statically and names the check for `test-runner`.

Collect concise structured findings with `proven-code`, `proven-test` or `needs-verification` evidence.
Deduplicate overlapping defects. Batch blockers/majors into one repair round. After fixes recompute
risk from the delta: rerun affected reviewers and newly implicated lenses; unaffected lens evidence
can carry forward only with an explicit dependency reason and its original SHA. Architecture, shared
contracts, broad conflict resolutions or uncertain impact require the full selected set again.
Use the contract's repair brief (previous/current SHA, delta, affected findings and dependencies)
instead of repeating the initial briefing. Retain the original requirements and evidence references.

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

Follow the flaky-test policy in `docs/agents/testing.md` ("Flaky tests"): record the first failure,
compare CI-to-CI, rerun only the failed jobs at most once per head, file or update one deduplicated
`Flaky test: <spec>:<line> <title>` issue, and repair repeat or PR-blocking flakes in a repair batch
(never skip, quarantine, loosen, raise timeouts or add retries).

## 5. One push and PR per reviewed batch

Once the batch is implemented and applicable local checks pass, push from the lead and open one
draft PR by default so the preview deploys. Do not push partial items just to get CI. Keep pushing
repairs to that draft (each round batched into one push). Include one consolidated verification
report and representative preview flow. CI must still finish on its exact current head. Never
rebase, amend, force-push, approve or merge the PR.

Every batch turn ends with the lead evaluating the ready gate and recording exactly one outcome:
(a) gate satisfied: mark the PR ready (`update_pull_request` with `draft: false`); or (b) gate open:
update the sticky Ready gate comment (below) naming the single blocker or waiting state (for
example "open finding X", "CI pending on <sha>", "CI failed <job>") and leave the PR draft. Never
leave a PR draft with no stated reason. A waiting state must also name the next action and its owner.
The lead may not end its session on "CI pending" unless it stays subscribed and handles the
completion event, or records a hand-off to the section 7 sweep that is actually scheduled, naming where
(scheduled task id or loop). If no sweep is scheduled, stay in the session or record "no sweep
scheduled; needs human follow-up" in the sticky comment. An all-green draft with no recorded outcome is not a valid end state.

The ready gate is the local gate plus draft-run CI: no open blockers/majors from local reviewers on
the aggregate head, required local verification complete, and every CI job that runs on drafts (unit,
E2E, visual, builds, Netlify, `Inspect final PR head` and `Claude PR review`) green on the exact
head. The two review jobs run on drafts on every push, so the final-head review is part of the gate,
not a post-ready step. Never mark ready while local reviews, local verification or draft-run CI are open.

"Ready" therefore means the local gate plus all draft-run CI green on the exact head; human approval
is separate and is what arms auto-merge (`.github/workflows/auto-merge.yml`, which also needs the
agent's APPROVE on that head). Agents (lead, steward, sweep, implementers) never approve, merge or arm
auto-merge. The sweep marking a PR ready can lead to auto-merge only after a human has approved.
Caveat: PRs opened through the owner's account cannot be approved by that same account (GitHub forbids
self-approval), so a human approval may be impossible on them.

**Ready gate comment.** The lead keeps one sticky PR comment starting with `<!-- ready-gate -->`.
Create it once; every later turn find it by that marker (`pull_request_read` method `get_comments`; create it with
`add_issue_comment` and record the comment id; edit it with `update_issue_comment` using that id), never a new comment per push. It is the recorded outcome in (b) and is also
updated when the gate is satisfied. Content:

- head SHA it describes;
- checklist: each selected specialist with reviewed SHA vs current head; local verification; each
  CI job on the exact head including `Inspect final PR head` and `Claude PR review` (green as
  defined below); unresolved threads; base staleness decision; visual-review reconciliation;
- the section 5a statement: in-scope items closed, follow-up issues filed (numbers, or none), nothing
  outstanding;
- the single named blocker with next action and owner (or "gate satisfied, marked ready"; if the
  final-head review is still running, the blocker is "final-head review pending on <sha>").

The lead updates it at the end of every batch turn; the section 7 sweep reads it.

PR body rule: any description you write or rewrite keeps the template's `Specialist review` table
(updating status, reviewed SHA and verdict) and the preview-links block verbatim (see the `pr` skill).

**Green** (defined here once) means the latest attempt of every required draft-run job on the exact
current head SHA is `success`, and, if an earlier attempt of that job failed or was cancelled, the PR
records the earlier run URL and the rerun result. If a test failed, the record must also carry the
first-failure signature, the `Flaky test:` issue link and the lead's dependency reason why the failing
test cannot be affected by this change. For a cancellation with no failing test the run URL and rerun
result suffice and no flake issue is filed. Without the record the job stays open even if the rerun
passed; no human waiver is needed. A second failure on the head is a regression until proven
otherwise; a repeated cancellation is a named blocker (suspected infrastructure) for the lead to
investigate. A job whose latest attempt is `cancelled`, `timed_out`, `skipped`, `neutral` where a result is required, or a MISSING job all count as open.
A visual-snapshot warning is a separate decision (see `docs/agents/testing.md`), not a red job.

No CI on the head (only Netlify ran): use `actions_list` for runs on that head SHA. If a run is
queued, waiting or action_required, name that as the blocker. If a run on that SHA is cancelled or
failed, rerun it with `actions_run_trigger` (rerun or rerun-failed-jobs). If no run exists, record
"no CI on <sha>", name the trigger as the blocker and ask a human. Never push an empty commit and
never rerun a run for a different SHA.

Before marking ready, reconcile the PR description with the CI "Visual review" block: if the
description says no baselines or visuals changed but the block lists changed screenshots, fix the
description or name the unexplained diff as a blocker.

Before marking ready, compare the head's base SHA with current `main`. If behind, record it and
decide explicitly: update the branch or state why the existing CI evidence still applies. Never skip
silently. `update_pull_request_branch` is merge-based only (never rebase or force-push), counts as the
batch's repair push and moves the head, so rerun affected local review/verification on the new head
before marking ready, or state why existing evidence still applies. A merge conflict goes to the lead
as a repair batch. Only the lead calls it; the sweep and steward never do.

The final-head review (`Inspect final PR head` / `Claude PR review`) runs on the draft and is the
independent check before ready. If it reports blockers/majors, run a repair round and keep pushing
repairs. Each new head re-runs it, so a ready PR that is repaired is again pending until it is green on
the new head. Re-draft is not available through the GitHub MCP tools in cloud sessions, so a PR that
is already ready stays ready during repair rounds; report the open findings as the named blocker. Do
not claim completion until the final-head review is green on the current head; human approval is separate.

Keep the lightweight GitHub PR reviewer as an independent final-head correctness/security/evidence
check. It does not repeat local specialist fan-out or replace human approval.

## 5a. Finish the PR's scope without being prompted

A PR is not done while any in-scope work is outstanding. The lead (and the sweep's resume path)
drives every open item to a resolved state on its own; a human should never have to ask "did you
finish X?". In-scope work is anything needed for the PR's stated request, its linked issues or its
acceptance criteria, plus everything raised against it:

- every blocker, major, minor and nit finding from local reviewers, the final-head review and bot
  or human review threads that is valid and touches this change;
- failing, cancelled or missing CI, visual decisions, preview verification and base staleness;
- unmet items in the PR description's checklist or test plan, missing specs/tests/BDD journeys, and
  spec or description drift;
- human comments and small asks on the PR.

Work this list down in repair rounds (section 3 limits still apply) without waiting for a prompt.
Do not end a turn with a list of "remaining items" or ask whether to continue; either do them or
record a named blocker (section 5) and its owner.

Work that is NOT specific to the PR's request (pre-existing bugs found on the way, adjacent
refactors, broader improvements, optional enhancements, scope-expanding ideas, a finding that
predates the change and does not interact with it) is follow-up. Do not grow the PR for it and do
not leave it only in a comment. Create one GitHub issue per follow-up (`gh issue create`, or `issue_write` in cloud sessions; search open issues first to
dedupe; update the existing issue instead of duplicating), with: what and why, the evidence or
file/line, the originating PR link, and a suggested scope. Then link the issue(s) in the PR
description under "Follow-ups" and in the outcome comment. When unsure whether an item is in scope,
it is in scope if the PR's request would be incorrect, incomplete or unsafe without it; otherwise
it is follow-up. A material scope ambiguity is the only reason to ask the user.

Before the lead records its outcome (section 5) it states: in-scope items closed, follow-up issues
filed (numbers), and nothing outstanding. Never mark ready, or claim a PR satisfied, with an unfiled
follow-up or an unaddressed in-scope item.

## 6. Coordinate the PR without no-op model turns

Collect compact status with `node scripts/pr-status.js <PR> --state <scratch>/<batch>-pr-state.json`
where the `gh` CLI is available for this purpose. In cloud sessions, where GitHub GraphQL and `gh` are
refused, build the same snapshot from GitHub MCP reads: `pull_request_read` `get` (state, draft, head
and base SHA, `mergeable_state`), `get_check_runs` on the head SHA, `get_reviews`, `get_comments` (all `pull_request_read`
methods), and `get_review_comments` for unresolved threads. Compare it with the previous head and results to detect
deltas. Subscribe to events with `subscribe_pr_activity` and record that the subscription is in place;
otherwise use bounded platform waits and state that limitation. Dispatch `pr-steward` only for an
actionable change:

- a failed, cancelled, timed-out or missing required check on the current head;
- a head with no CI (only Netlify ran);
- new unresolved review threads or human comments;
- a conflict (`mergeable_state` dirty), or `behind` with no base-staleness decision recorded on the
  PR (`unstable` alone is ordinary pending CI; a completed failing check is the first bullet);
- a draft that is all-green with no recorded outcome;
- a final-head review that failed or reported blockers/majors on the current head;
- outstanding in-scope work (section 5a) or a follow-up not yet filed as an issue.

Unchanged pending CI or waiting human approval stays non-actionable. Fetch full logs only for
failures; unchanged states do not need a new LLM review.

The steward is the single post-push repair coordinator. It batches validated findings and routes
fixes, including conflicts and small human asks, back through local review/test gates. Resolve bot
threads only after the specific defect is verified fixed on the current head, affected reviews are
complete and required CI is green. Do not resolve a human thread without their authorization.

Report batch branch/worktree, current head, selected verdicts, verification counts/run URLs, visual
acceptance and preview link with `nuke=true`. Separate CI, unresolved findings and human approval.
Do not claim completion while any required gate remains open (including a pending final-head review
or open final-head findings); give a named waiting/blocker state and record it in the sticky ready-gate comment.
Never edit cache markers, screenshot baselines, disable tests or put place facts into specs.

## 7. Open-PR sweep

A periodic pass (scheduled task or `/loop`; the lead schedules it before ending any session that leaves a PR open) over every open PR, so a PR whose lead session ended is
still followed up. Per PR collect: head SHA, draft state, check runs on that SHA, the sticky `<!-- ready-gate -->`
comment (the recorded outcome), and base staleness against current `main`. Classify:

- satisfied: the sticky `<!-- ready-gate -->` comment records a head SHA equal to the CURRENT head (an
  older SHA does not count) and records local
  review and verification complete with no open findings and the PR description reconciled with the
  Visual review block, draft-run CI is green (section 5) on that head, and base staleness is recorded
  and decided (or the base is current). `actionable`
  takes precedence if both classes match. The sweep may mark ready (`update_pull_request`
  `draft: false`) and records it;
- waiting: a valid named waiting state with next action/owner, no action;
- actionable (any section 6 trigger, a stale base with no recorded decision, no sticky ready-gate
  comment, or outstanding in-scope work per section 5a: open review threads or findings, unchecked
  description/test-plan items, or unfiled follow-ups): dispatch `pr-steward` and record the owner and next action in the sticky comment (for a
  missing or stale sticky comment, "needs a lead session to resume"). Repairs still go through the lead's gates.

The sweep does not leave outstanding in-scope work for a human to notice: an actionable PR gets
a steward report listing each open in-scope item and a lead session is resumed (or "needs a lead
session to resume" is recorded in the sticky comment) so section 5a is carried out. The sweep may also file deduplicated
follow-up issues for items the steward classifies as out of scope.

The sweep may only read, edit the sticky comment in place (`update_issue_comment`, to record its own
outcome, filed follow-up issue numbers or that it marked ready; the steward only replies to threads, never edits it and has no issue tools), file follow-up issues and mark ready as above. It never pushes, approves, merges, rebases,
force-pushes, calls `update_pull_request_branch`, resolves human threads or changes the branch.
It uses the same MCP reads as section 6, fetches logs only for failures, and spends no LLM turn on a
PR whose snapshot is unchanged since the last sweep.
