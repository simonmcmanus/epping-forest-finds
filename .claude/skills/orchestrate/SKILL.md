---
name: orchestrate
description: "Run the team playbook: triage issues, implement locally, run every review and the tests before anything is pushed, then push, open the PR if asked, and hand it to the steward. The lead session runs this itself, because subagents cannot dispatch other agents."
disable-model-invocation: true
---

You are the lead session. You plan and dispatch; the agents in `.claude/agents/` do the work. Subagents
cannot dispatch other agents, so every dispatch below comes from this session.

The user passes issue numbers or a task description. If the input is ambiguous, ask once before
dispatching anything.

The order is fixed: implement, review, test, then push. Nothing reaches `origin` until every review and
test gate has passed on the local branch.

## 1. Triage

For each issue, read it (`mcp__github__issue_read`) and state its title. Classify it:

- **code**: app code, tests, specs or styles. Goes to an `implementer`.
- **data**: a place fact is wrong (closed, renamed, moved, mis-categorised). Goes to `data-curator`.

Then say which issues touch the same hot files (`app.html`, `js/app.js`, `sw.js`, `spec/*.md`,
`test/forest-finds.test.js`). Those must run one after another, not in parallel.

Until the team has agreed rules for combining items into one PR, give each item its own branch and PR.

If there is more than one item, show the user the plan (items, agent, order, parallel groups) and
wait for a go-ahead. For a single item, go straight on.

## 2. Implement locally

Dispatch one `implementer` per item, with its work item, its branch name `claude/<topic>` and its
worktree `.worktrees/<topic>` from `origin/main`. Run at most three at once.

The implementer commits on its local branch and does not push. Wait for its report: branch, local
commit SHAs, files changed, spec updated or the implementation-only reason, and test counts.

## 3. Review gate, before the push

Dispatch reviewers on the local branch, diffed against `origin/main`, all in parallel. Always dispatch
`reviewer`. Add the specialists that match what the diff touches:

- markup, styles, interaction or icons: `accessibility-reviewer` and `design-reviewer`
- rendering, data loading, assets or the service worker: `performance-reviewer`
- a user flow, copy or a permission ask: `ux-reviewer`
- a data change: `reviewer` only

Collect every report. Only findings a reviewer has verified count. Blockers and majors go back to the
implementer as a new local commit, with the finding text and `file:line`. Re-run the reviewers that
raised them after each fix. Do not push a fix to test a review.

Stop after three rounds of findings on the same item, and report the open findings to the user. Do not
push that branch.

## 4. Test gate, before the push

Dispatch `test-runner` on the local branch: the complete unit suite, and the e2e specs the change
touches. A failure goes back to the implementer, the same as a finding. Do not treat a failure as
pre-existing without the CI check on the base branch.

## 5. Push, then pull request

Only when every reviewer in the gate has no open blockers or majors, and the test gate is green, push
from the lead session: `git push -u origin <branch>`. Retry network failures only.

Open the PR only when the user has asked for PRs. Otherwise report the pushed branch and stop.

When the PR is open, dispatch `pr-steward` with the PR number and head branch. The steward drives CI and
review threads. Subscribe this session to the PR so its events reach you, and dispatch the steward
again on each event.

## 6. Report

For each item, report in one block:

- branch, local commits, and the worktree path
- reviewer verdicts, and any findings left open
- test-runner counts
- whether it was pushed, and the PR URL if one was opened
- the CI result for the head SHA with its run URL, once CI has finished

Do not report an item as done until its CI run has finished green on that SHA.

## Hard limits

- Never push before the review and test gates pass.
- Never approve or merge a PR. Only a human approval counts.
- Never edit `js/app-cache-version.js` or `js/data-cache-version.js`.
- Never rebase, amend or force-push a PR branch.
- Never skip or quarantine a test to get green.
- Never correct place facts in a spec file. Those go to `data-curator`.
