# Claude Pull Request Review

The local team reviews a frozen branch before its batched push. CI retains one
independent final-head review for same-repository pull requests, drafts included. Its
remit is actionable correctness/security regressions and gaps in the regression
test contract, including changes introduced while resolving conflicts. It does
not dispatch the local specialist roster again or repeat formatting/style checks.

## Read, validate, publish

`.github/workflows/ci.yml` separates model inspection from publication:

- `claude-review-model` uses a read-only repository token, the event's immutable
  base/head commits, and a static head checkout. It does not install dependencies
  or execute pull-request code. Claude has only Read/Glob/Grep tools; repository
  hooks are disabled. Settings sources are explicitly `user`: the deployed
  action SDK parser treats an empty `--setting-sources` value as absent and
  otherwise falls back to project/local settings. The action writes its
  hooks-disabled setting into the user settings source. The explicit bot allowlist admits github-actions and the
  Claude App that opens implementation PRs; other bots remain excluded.
  The base checkout supplies trusted review guidance. PR
  titles, descriptions, files and model output remain untrusted review data.
The context JSON is formatted for bounded line-range reads. Reviewers finish all changed files even
after finding a defect; findings do not imply an incomplete review.
The inspection starts from supplied patches. For each changed behaviour it reads the full governing
spec section and the source ranges and callers it touches, and reads a full changed file when a
hunk lacks the context needed to judge a changed line. It does not load every spec by default.
Local mechanical checks never replace independent inspection of every changed file.

Local review follows the model-routing and compact-brief contract in
`docs/agents/review-contract.md`: Sonnet retains correctness/security and specialist verdicts;
the existing Haiku execution task handles lead-specified mechanical checks. The lead records a
changed risk for each specialist and briefs repair reviews with previous/current SHAs, the delta,
affected findings and dependencies. Uncertain impact still requires the full applicable review.

- The model uses Sonnet with a 60-turn limit and returns structured JSON with
  the reviewed head/base SHAs, a completeness flag and at most 20 P0–P2 findings. A
  finding names its Standards/Spec axis and a changed line (RIGHT addition or LEFT deletion), and states
  the concrete triggering state, wrong result and expected correction. A review
  that cannot finish must return `complete: false`; truncation is not approval.
- `claude-review`, named **Claude PR review** to retain the required-check name,
  validates the result in workflow-owned JavaScript. It has no repository
  checkout and never executes repository scripts with its write token. It
  rejects malformed/incomplete results, invalid priorities, off-diff lines and
  incomplete changed-file lists. Files and reviews are read with pagination.
- Publication rechecks the current open PR (draft or ready) and its head SHA immediately
  and target base before creating one formal review pinned with `commit_id`. Superseded-head output
  is discarded. Base-only drift on a still-current head fails the required check;
  merge the updated base and push for a new inspection rather than rerunning
  the old event with its obsolete base. Context preparation also rejects drift
  before invoking the model. It also rejects PR changes to either CI-owned
  cache marker, including deletion or rename, without spending a model call. The API call pins the review even if a new push races the final
  check. Identical publisher retries on the same head/base do not duplicate reviews.
- A complete clean result produces an approval; findings produce one
  `REQUEST_CHANGES` review with concise inline comments and a short axis index.
  No model tool can publish, approve or resolve threads. Approval does not claim
  runtime/visual verification and never replaces the human `verified` label.

The model job cancels an obsolete in-progress review when the PR updates.
Publication is serialized per PR and does not depend on a bot-authored comment
starting another workflow. A failed model or invalid output fails the final
required review check rather than silently treating missing output as clean.
The action's session ID and a compact validated-result summary are recorded in
the job summary for usage correlation; no execution transcript or credentials
are published. On failure, a diagnostic step reads only the bounded final-result
  error fields from the action execution file and logs a fixed error category;
  it never prints error text, assistant turns or tool output. This distinguishes
  authentication, model/configuration, schema, rate-limit and network failures
  without enabling full output. Actual input/output/cache token usage comes from Claude's usage
records, not an estimate inferred from file size.

## One remediation owner

`pr-steward` is the sole remediation coordinator. The old
`claude-review-followup.yml` per-comment repair workflow is removed: it relied on
`GITHUB_TOKEN` comments triggering another workflow, duplicated the steward,
and resolved threads after a push without fresh verification.

The lead dispatches the steward only for actionable head/check/thread changes.
It batches independently validated findings into one fix round, applies the
relevant local test/review gates to the new SHA, and waits for CI on that head.
Only verified addressed threads may then be resolved; a push alone is not proof.
Human threads and decisions remain human-owned. Workflow/guidance/dependency
changes go through the normal reviewed branch rather than an unattended bot fixer.

`main` should require CI and one approving review (the
**Claude PR review** agent APPROVE) with stale approvals dismissed after a push.
The human check is the `verified` label (see Auto-merge workflow). Workflow code cannot itself configure or prove
the repository's live branch protection. Same-repository workflow changes can
change the workflow, so they need the human `verified` check; no fork code receives these
credentials. A setup or policy error is a reported blocker, never a reason to
skip the current-head gate.

## Auto-merge workflow

`.github/workflows/auto-merge.yml` merges a PR once the current head has the
human `verified` label and the agent approval. It runs on `workflow_run` when
CI completes and on `pull_request_target` `labeled` and `unlabeled` (only for
`verified`), `synchronize` and `ready_for_review` (so the default-branch copy runs; it never
checks out PR code). The head SHA is read from the live PR, not the event. Only
same-repository, open, non-draft PRs are considered.

The `verified` label replaces a human approving review, because PRs are opened
from the owner's account and GitHub forbids approving your own PR. The label
stays on the PR across pushes, so the owner does not re-apply it after each
repair push. The per-head check is the agent's APPROVE: each new head must earn
it again before anything arms. On `synchronize` the workflow disables any armed
auto-merge with the `disablePullRequestAutoMerge` mutation, because auto-merge
is a PR-level setting that survives a push; the new head re-arms once its own
agent approval is in. A failure of that step fails the job (fail closed). After a
successful arming call the workflow re-fetches the PR and disarms again if the
label is gone or the head changed (closes the race with a parallel `unlabeled`
run). Removing the `verified` label
(`unlabeled`) on an armed PR disarms it through the same path as a missing label.
On the other events, an armed PR whose
label is absent or fails the label checks is disarmed; it exits quietly only
when auto-merge is enabled and the label gate passes.

Arming conditions, all on the current head: auto-merge not already enabled (an
armed PR is handled as above); the
PR has the `verified` label; the most recent `labeled` event for `verified` was
made by a person (user type User, not a bot) whose collaborator permission is
admin, maintain or write, and the label is still on the PR (pushes do not remove
it); and a `github-actions[bot]` `APPROVED` review carrying
`CLAUDE_FINAL_REVIEW:<head>:<base>` with `<base>` equal to the PR's live base
SHA. The latest review per reviewer wins, so a later change request or dismissal
cancels the agent approval.

It first tries native auto-merge. GitHub rejects that when the PR is already
mergeable, so it then squash-merges directly with the same GitHub App token and
`--match-head-commit`. Immediately before arming or merging it re-fetches the PR
and requires the head and base to still equal the evaluated SHAs and the label
to be present, otherwise it exits without arming. The arming mutation also passes
`expectedHeadOid`, so GitHub rejects it if the head moved. Runs are serialised
per PR by `concurrency` groups (never cancelled). A group keeps only one pending
run and a newer pending run replaces an older one, so `synchronize` and
`unlabeled` (of `verified`) runs use their own group, `auto-merge-disarm-<PR>`,
where arming and CI runs cannot displace them; arming runs use `auto-merge-<PR>`.
As a second guard, a `workflow_run` whose CI head differs from the live head
exits without arming but, if the live PR has auto-merge enabled, disables
auto-merge first (fail closed), in case the push-time run was lost. "Already enabled" from a racing event counts as success.
Branch protection still gates every merge. Agents never approve, arm, merge or
apply the `verified` label. Agent sessions act through the owner's token, so
this cannot be technically enforced; it is a policy.

Repository settings required (not enforced by the file): Allow auto-merge on;
the `verified` label existing; the `main` ruleset requiring one approval (the
agent), status checks and stale-approval dismissal; the GitHub App secrets `CACHE_VERSION_APP_ID` and
`CACHE_VERSION_APP_PRIVATE_KEY`. CI's `pull_request` trigger deliberately
omits `ready_for_review`: the review runs on drafts, so marking ready does not
re-run the paid review.

## Specialist record on the PR

The PR template has a **Specialist review** table. For each specialist the lead
records status (run, not selected with a reason, or not run), the head SHA it
reviewed, and its verdict or comment link. A push that changes the head makes
earlier rows stale: rerun the affected specialists, then update the SHA.

`.github/workflows/claude-specialist.yml` runs one read-only specialist on demand.
A repository writer (OWNER, MEMBER or COLLABORATOR) comments
`@claude review <specialist-name>` on an open, non-draft PR (unlike the final-head review, which also runs on drafts). The name must be one
of the read-only reviewers on the workflow's allow-list (each defined in `.claude/agents/`); anything else is ignored.

- The reviewer definition is read from the default branch checkout, and the
  diff is read from the PR head checkout. The job holds no write token for the
  repository and does not execute PR code.
- Tools are limited to Read, Glob, Grep and read-only git commands, with Edit,
  Write, Agent and Task disallowed.
- Before running, the job skips when a result for that name and head already
  exists, identified by the marker `<!-- CLAUDE_SPECIALIST:<name>:<sha> -->`. The
  run ends its comment with that marker. If a run does not write the marker, a
  repeat request runs again; this is a duplicate cost, not a gate.
- "Not selected" is a valid verdict. The specialist states that its risk does not
  apply, with the reason, rather than inventing findings.

These comments are advisory evidence for the lead. They do not replace the
required CI review, a runtime check, or the human `verified` label. The trust model matches
the read-only PR explainer: PR content is untrusted, and only writers can start
the job.
