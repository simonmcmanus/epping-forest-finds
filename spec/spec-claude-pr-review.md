# Claude Pull Request Review

The GitHub Actions workflows provide an automated review loop for pull requests
from branches in this repository:

- `.github/workflows/ci.yml` reviews the changed code on every pull-request
  update. It reads the repository guidance and posts actionable inline findings
  plus a top-level summary. If the current diff has no actionable findings, it
  submits a Claude approval. This approval does not replace the required human
  approval.
- `.github/workflows/claude-review-followup.yml` listens only for marked inline
  findings from `github-actions[bot]` on same-repository pull requests. It
  serialises remediation jobs per pull request and allows at most three
  attempts. Findings in workflow/action files are left for a human because
  those files control the agent itself.
- A remediation run checks out the branch without persistent credentials,
  installs dependencies without lifecycle scripts, and gives Claude no PAT.
  Claude must commit a verified code fix; a separate workflow step rejects
  protected-file changes and pushes approved code with `WEEKLY_LEDGER_PAT`.
  That PAT-backed push starts a fresh CI review. A review thread is resolved
  only after a new commit has been pushed; rejected or unchanged findings stay
  open.

`main` should require the relevant CI checks, Claude's approval, and a human
approval, with stale approvals dismissed after new commits.
