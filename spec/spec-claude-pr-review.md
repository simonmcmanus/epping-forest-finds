# Claude Pull Request Review

The local team reviews a frozen branch before its batched push. CI retains one
independent final-head review for same-repository, non-draft pull requests. Its
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

- The model uses Sonnet with a 30-turn limit and returns structured JSON with
  the reviewed head/base SHAs, a completeness flag and at most 20 P0–P2 findings. A
  finding names its Standards/Spec axis and a changed line (RIGHT addition or LEFT deletion), and states
  the concrete triggering state, wrong result and expected correction. A review
  that cannot finish must return `complete: false`; truncation is not approval.
- `claude-review`, named **Claude PR review** to retain the required-check name,
  validates the result in workflow-owned JavaScript. It has no repository
  checkout and never executes repository scripts with its write token. It
  rejects malformed/incomplete results, invalid priorities, off-diff lines and
  incomplete changed-file lists. Files and reviews are read with pagination.
- Publication rechecks the current open, non-draft PR and its head SHA immediately
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
  runtime/visual verification and never replaces required human approval.

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

`main` should require CI, **Claude PR review**, and human approval with stale
approvals dismissed after a push. Workflow code cannot itself configure or prove
the repository's live branch protection. Same-repository workflow changes can
change the workflow, so they require human review; no fork code receives these
credentials. A setup or policy error is a reported blocker, never a reason to
skip the current-head gate.
