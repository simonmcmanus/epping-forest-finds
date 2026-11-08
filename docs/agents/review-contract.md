# Review and verification contract

Read this contract once per role. Load only the spec headings and dependencies relevant to the task.
The lead supplies immutable base/head SHAs, worktree/branch, owned files, requirements, changed
journeys, selected risk lenses and evidence paths. Expand context when a dependency requires it;
do not paste a complete repository briefing into every agent message.

## Findings and evidence

Each finding contains: priority (`blocker`, `major`, `minor`), reviewed head SHA, `file:line`,
triggering input/state, expected versus actual behavior, evidence and verification needed. Report
only concrete defects; keep optional observations separate and deduplicate overlapping findings.

Label the evidence:

- `proven-code`: a complete reachable code path establishes the defect.
- `proven-test`: a named executed test, measurement or rendered artifact establishes it; cite the receipt.
- `needs-verification`: a plausible concern needs a named check. This is an open verification task,
  not a claim that a runtime property has been verified or a speculative blocking finding.

Static reviewers cannot measure rendering, actual focus, contrast over rendered backgrounds, frame
timings or offline execution. Ask the test-runner for the smallest missing check and reuse its
artifacts. Say what remains unverified. A runtime claim required for acceptance stays open until
proved; absence of static findings alone does not prove it. End with a short verdict and outstanding
verification, not a restatement of the diff. Target 300 words per report unless findings require more.

## Test receipts

The agent that actually runs a check records:

```json
{
  "headSha": "full commit SHA",
  "worktree": "/absolute/task/worktree",
  "treeState": "clean",
  "command": "exact command, including filters and projects",
  "environment": {"node": "version", "browser": "version", "CI": "value", "workers": 2},
  "result": {"passed": 0, "failed": 0, "skipped": 0},
  "failures": [],
  "evidence": "log or artifact path/URL"
}
```

Capture the working-tree status before and after execution, including generated/untracked inputs;
record relevant environment variables, dependency/lockfile version, clock/fixtures and server/build
identity. If tests run against uncommitted work, record a content fingerprint and rerun on the final
clean committed tree before accepting it. Record zero skips only when the runner proves that count;
otherwise report it as unknown. Preserve the first failure when rerunning a suspected flake.

Reuse a receipt only when commit, clean tree, dependencies, relevant environment, command, fixtures
and generated/server inputs match. A dirty tree, changed SHA or environment invalidates it. Never
reuse a filtered unit run as a full unfiltered pass. The test-runner audits scenario coverage and
receipt provenance and runs missing/invalid checks; it does not repeat identical valid commands just
to provide a second narrator. CI results are separate receipts tied to the current PR head.

## Review invalidation

After any fix, inspect the delta from the previously reviewed head and recompute risk. Rerun the
general reviewer for changed correctness/test contracts and each specialist whose inputs or
dependencies changed, including newly relevant specialists. Unaffected lens evidence can carry
forward with an explicit dependency reason and its original reviewed SHA; never silently relabel it
as a review of the new head. Shared contracts, architecture, broad conflict resolutions or uncertain
dependency impact require the full selected set again. The final gate records the current head and
the evidence/invalidation decisions on which it relies.

Batch validated findings into one repair round. The lead records an attempt before dispatching;
count real repair attempts, not prose comments. Stop after three unsuccessful rounds on one batch
and report the remaining issues. Never push to use CI as a substitute for the local gate.

## PR status and one repair owner

The lead collects status deterministically: head SHA, checks with run URLs, unresolved thread IDs,
review state, visual decision and preview state. Compare this tuple with the previous snapshot.
Dispatch the steward only on an actionable change (new finding, completed failure, conflict, or a
new head requiring reconciliation), not for unchanged running/pending states or waiting human
approval. Fetch detailed logs only for failing jobs. Keep a bounded safety check for missed events;
if subscriptions are unavailable, report that and use the platform's supported wait/poll facility.
Do not claim a permanent event subscription exists merely because the playbook requests one.

`pr-steward` is the sole post-push repair coordinator; a second per-comment automatic fixer must not
race it. It verifies and batches findings, returns edits/conflict resolutions to the lead for the
same review/test gates, and never treats a push as proof of a fix. Resolve a bot thread only after
the specific defect is verified fixed on the current head, required checks are green and the
affected review is complete. Never resolve another person's thread without their authorization.

Compare base/head CI failures by test ID, project and error signature. A red check on both commits
can contain different failures. One passing rerun proves intermittency, not that the change is
unrelated. Unknown base evidence remains unknown; record a blocker rather than dismissing it.
Human approval, CI success, local review findings and visual acceptance are separate fields. A
waiting state is not completion; avoid repeated LLM wakeups while waiting on a person.

## Cost measurement

For the next 20 comparable PRs, record model, task type, reviewed SHA, invocation/round counts,
actual input/output/cache-read usage where available, declined/duplicate findings, escaped defects
and no-change repair sessions. Keep deterministic execution/status jobs on the cheaper model and
judgment-heavy reviews on Sonnet; escalate to a stronger model for a concrete unresolved problem.
Do not claim a percentage saving from prompt length alone.
