# Epping Forest Finds — active agent rules

Vanilla HTML/CSS/JS, phone-first, offline-first. Keep changes scoped.
`app.html` is markup and `<script src>` tags only. Marketing (`index.html`, `assets/home/`) is an
independent surface: never import app CSS/JS or reference app icons there at runtime.

**Mandatory:** before editing any app or website file, or any place data under `data/**`, invoke the
`team` skill with the Skill tool and follow its lead playbook. Do not hand-edit those files directly
in the main session. Only skip it for read-only questions.

- Delegate implementation to scoped `implementer` agents; place-fact corrections go to `data-curator`.
  The lead dispatches, reviews, pushes once and opens one PR. Never approve, merge or force-push.
- Place facts are corrected in `data/**`, never documented in a spec.
- CI owns `js/app-cache-version.js`, `js/data-cache-version.js` and screenshot baselines. Never edit them.
- Tests assert user-visible behaviour, never source text. Prove a regression test fails before the fix.
- Never report completion while required checks, findings or human approval remain outstanding.
- Preserve the PR's preview-links block and the template's `Specialist review` table when rewriting a PR description.
- Keep one sticky `<!-- ready-gate -->` PR comment, edited in place, naming the outstanding blocker (see `/team` section 5).
- Push the PR as a draft as soon as the batch is implemented and committed, so the Netlify preview
  deploys and can be tried. Draft status skips the final-head CI review jobs; that is expected. Every
  batch turn ends by evaluating the /team gate: satisfied, mark ready; open, comment the named blocker
  on the PR and leave it draft (never draft without a stated reason). The gate is local reviews and
  verification plus draft-run CI green on the exact head; the final-head jobs run after ready and are
  the independent check ("awaiting final-head PR review"). Never mark ready while that gate is open.

Load references on demand:

- `spec/agents.md`: module/spec map, active constraints, role routing and completion rules.
- `.claude/skills/team/SKILL.md`: batch selection, lead dispatch, risk selection and repair rounds.
- `docs/agents/review-contract.md`: findings, evidence receipts, invalidation and PR status.
- `docs/agents/testing.md`: test commands, snapshot evidence and CI diagnosis.
