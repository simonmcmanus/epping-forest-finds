# Epping Forest Finds — active agent rules

Vanilla HTML/CSS/JS, phone-first, offline-first. Keep changes scoped.
`app.html` is markup and `<script src>` tags only. Marketing (`index.html`, `assets/home/`) is an
independent surface: never import app CSS/JS or reference app icons there at runtime.

**Mandatory:** before editing any app or website file, or any place data under `data/**`, invoke the
`team` skill with the Skill tool and follow its lead playbook. Do not hand-edit those files directly
in the main session. Only skip it for read-only questions.

- Delegate implementation to scoped `implementer` agents; place-fact corrections go to `data-curator`.
  The lead dispatches, reviews, pushes once and opens one PR. Agents never approve, merge, arm
  auto-merge or force-push. The CI reviewer APPROVEs a clean head and otherwise REQUEST_CHANGES. Auto-merge
  is armed only when the same head has both a human approval and the agent approval
  (`.github/workflows/auto-merge.yml`); merge happens once checks pass. If the PR is already mergeable,
  the workflow merges it directly under the same both-approval conditions.
- Place facts are corrected in `data/**`, never documented in a spec.
- CI owns `js/app-cache-version.js`, `js/data-cache-version.js` and screenshot baselines. Never edit them.
- Tests assert user-visible behaviour, never source text. Prove a regression test fails before the fix.
- Finish all in-scope work on a PR (every valid finding including minors, CI, checklist and review
  threads) without being prompted. Work not specific to the PR's request becomes a deduplicated
  GitHub issue linked from the PR, never silent scope growth or an unrecorded "later". See
  `/team` section 5a.
- Never report completion while required checks, findings or human approval remain outstanding.
- Preserve the PR's preview-links block and the template's `Specialist review` table when rewriting a PR description.
- Keep one sticky `<!-- ready-gate -->` PR comment, edited in place, naming the outstanding blocker (see `/team` section 5).
- Push the PR as a draft as soon as the batch is implemented and committed, so the Netlify preview
  deploys and can be tried. The CI Claude review jobs run on every push, drafts included, so no manual
  step starts them. Every batch turn ends by evaluating the /team gate: satisfied, mark ready; open,
  update the sticky ready-gate comment with the named blocker and leave it draft (never draft without a
  stated reason). The gate is local reviews and verification plus draft-run CI green on the exact head,
  including the final-head review jobs. Never mark ready while that gate is open.

Load references on demand:

- `spec/agents.md`: module/spec map, active constraints, role routing and completion rules.
- `.claude/skills/team/SKILL.md`: batch selection, lead dispatch, risk selection and repair rounds.
- `docs/agents/review-contract.md`: findings, evidence receipts, invalidation and PR status.
- `docs/agents/testing.md`: test commands, snapshot evidence and CI diagnosis.
