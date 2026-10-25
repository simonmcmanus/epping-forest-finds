# Coding standards

This file contains the repository's judgement-based coding standards. The
behavioural and operational rules remain in `spec/agents.md` and the relevant
`spec/*.md` document; do not duplicate those rules here.

## Structure and ownership

- Keep concerns in the module that owns them, following the project structure in
  `spec/agents.md`.
- Reuse existing CSS classes before adding new ones.
- Keep `app.html` to markup and `<script src>` tags. Application boot and wiring
  belong in `js/app.js` or the owning application module.

## Product quality

- User-facing changes should feel polished and professional on mobile as well as
  desktop.
- Prefer clear, local changes over broad rewrites or speculative abstractions.
- Keep names and boundaries understandable to both human reviewers and coding
  agents.

## Agent and review economy

- Optimise for token efficiency: make short, precise edits and avoid loading or
  rewriting unrelated files.
- Reviewers should report actionable correctness, security, reliability, and
  maintainability issues rather than formatting preferences or speculation.

For testing, CI, specification synchronisation, cache markers, visual snapshots,
and pull-request evidence, follow `spec/agents.md` and the relevant product spec.
