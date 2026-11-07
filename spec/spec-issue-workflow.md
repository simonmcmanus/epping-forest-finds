# GitHub Issue Clarification Workflow

`.github/workflows/issue-clarify.yml` clarifies requirements without editing code.
It runs on human issue opens, edits and reopens, and human comment creation/edits.
It reads trusted default-branch tooling, uses a compact input packet and Haiku with
20 turns, and keeps one maintained `github-actions[bot]` summary per issue.

## Deterministic preflight

- Skip pull requests, closed issues, bot/service events and comments, and `place-check` issues.
- Filter skipped bot/service events before entering the job-level per-issue cancellation group,
  so their summary/status events cannot cancel human clarification. Coalesce eligible events with
  cancellation of obsolete runs. Fetch the current issue and
  paginate its comments; do not act on the stale event's copy of the issue.
- Hash the current title, body and human comment content. Bot build/status chatter does not
  change the hash. If the maintained summary already covers those inputs, skip Claude.
- Ready issues (a ready summary or the `claude` label) do not rerun for ordinary comments.
  A human can edit the issue's title/body or comment `/clarify` to reopen requirements work.
  The maintained summary records a title/body scope hash, so a newer acknowledgment comment
  does not hide a pending scope edit when it replaces an earlier queued run. The publisher
  records the new scope hash after its own clarified-body rewrite.
  Reclarifying an already-labelled issue does not launch a second implementation.
- The model sees the current title/body, twelve recent human comments and the prior maintained
  summary, with explicit size limits. It must not claim omitted history was reviewed.
- An incomplete automatic handoff is recorded as `pending` in the maintained summary. A later
  eligible event retries the label/dispatch without another model call if the inputs still
  match. Dispatches can be repeated if the API succeeds before acknowledgment is saved; the
  implementation workflow serializes by issue and checks for an existing PR before doing work.
  Pending dispatch state survives human edits and `/clarify` comments, but changed requirements
  must be confirmed as ready simple data again before it can retry. A `claude` label alone is not
  evidence that a pending dispatch succeeded.

The Claude action retains its default collaborator authorization: reporters without repository
write access are not granted unattended model execution. This workflow does not enable
`allowed_non_write_users` or broaden access on its write-capable job. A collaborator can review
an external report and provide the relevant clarification input.

## Clarification and publication

The Claude action returns structured output; it has read/search/WebFetch tools, no GitHub
mutation tools (`--tools` restricts the actual available tools), and disabled session hooks. It searches only the relevant spec sections and data
rather than reading every product spec. Zero questions is valid when the scope is already clear.
The summary contains unresolved questions and short understood requirements, or a ready
confirmation, rather than another copy of every historical question and answer.

A contradiction of documented behavior is a bug. Proposed behavior outside the spec is a feature,
regardless of the template originally used. Once ready, the issue body is rewritten using the
matching `.github/ISSUE_TEMPLATE/` headings with the clarified requirements. The publisher validates
output bounds and status, re-fetches the issue and compares its input hash before making changes.
An obsolete result cannot overwrite newer human requirements. It creates or updates only its
marked summary; existing unrelated/human comments remain untouched. Failures do not leave a new
per-run “Thinking” comment behind.

A factual place report must be checked against the actual relevant `data/**` records and generated
sources. A source claim alone is not verification. A new event/closure/notice must be absent from
`data/forest-events.json`, `data/road-closures.json` or `data/forest-notices.json`; the model must
fetch the cited source and verify the date, venue and details. Missing/inaccessible/inconclusive
sources remain questions. New entries require a source URL and source evidence in the structured
result; existing-place corrections require concrete data evidence. No category, copy or recurrence
decision may remain before automatic handoff.

Only these verified, simple data changes on issues authored by a verified repository writer
(receiving write, maintain or admin permission from GitHub’s collaborator-permission API) receive
an automatic `claude` label and implementation handoff. Read/triage/external authors and unavailable
permission evidence require a maintainer’s explicit human-applied label. Both initial publication
and pending recovery recheck author authority; a bot implementation dispatch independently rejects
external-author issues even if a label exists. A human label or explicit human dispatch remains the
authorization path for an external report. No model-supplied assertion grants repository authority. Other clarified issues await a human's label or implementation decision. Pure place/event
facts never go in specs. Actual behavior/UX/architecture gaps get a short suggested requirement and
relevant spec reference in the summary; this workflow never edits code/spec files or opens a PR.

The deterministic publisher uses `GITHUB_TOKEN`. GitHub does not start another workflow for a
label event created by that token, so it explicitly dispatches `claude-issue-agent.yml` with the
validated issue number after labelling. No PAT or ruleset-bypass App credential is introduced.

## Place checks

Issues labelled `place-check` are structured community reports from
`netlify/functions/report-missing-data.js` (see `spec-community.md`). They remain manual review
items, including on later comments; clarification does not ask their reporters questions or label
them `claude`. A repeat report is added to the existing issue matched by its `place-key:` marker.

## PR Assistant Workflow

`.github/workflows/claude-pr.yml` answers an explicit `@claude` PR comment from
an owner/member/collaborator. It is a bounded read-only explainer (Haiku, 15 turns),
with session hooks disabled and no Bash, edit, agent or git-write tools. It uses
`GITHUB_TOKEN` with contents/PR read access and issues-write solely to post a concise
answer. No action App credential is requested. Superseded answer runs are cancelled.

It explains code/findings and names missing evidence. A request for a fix becomes
a concrete scenario and test plan for the lead/steward's gated repair round; this
assistant cannot race that repair owner or approve, resolve, push, rebase or merge.

## Issue Agent Workflow

`.github/workflows/claude-issue-agent.yml` accepts a human `claude` label or explicit
`workflow_dispatch` with an `issue_number`. Both paths fetch the current issue through the API;
the issue must still be open, must not be a PR, and must carry `claude`. Dispatch inputs are
validated as positive safe integers before use. Title/body are written into a JSON input file,
never interpolated into shell or the model prompt.

Work is serialized per issue. Each issue uses `claude/issue-<number>`, based on the default branch
or a partial earlier attempt on that same branch. An existing PR for that branch (open or closed)
skips another implementation; further work belongs on the PR or needs a deliberate new work item.
The branch/name and existence checks happen before dependency/browser setup or a model call.

The action uses Sonnet with 60 turns, disabled hooks and no nested team dispatch. It reads the
input file, implements one scoped item, runs the full unit suite and focused affected tests,
updates the matching spec for behavior changes, and never runs the full local browser suite or
updates baselines. Pure data corrections use their source/generation/count rules; new sourced
entries are verified again before writing. It must remove the temporary workflow input before
committing and must not push a change with failed verification.

The action retains its own scoped GitHub App credential rather than overriding it with
`GITHUB_TOKEN`. It commits/pushes the branch and opens the PR through its GitHub tool while the
App credential is active, so real PR/CI events fire. A deterministic final step verifies that an
open PR exists and links it from the issue; no PR is treated as a failed handoff with a visible
blocker. This workflow never approves or merges. Once open, further iteration belongs to the
single PR-steward process described in `spec-claude-pr-review.md`.
