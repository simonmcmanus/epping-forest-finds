# Domain Docs

How the engineering skills consume this repo's domain documentation. This repo keeps them in `spec/`, not the default `GLOSSARY.md` / `docs/adr/` layout.

## Before exploring, read these

- **`spec/glossary.md`**: the project's terminology. Use its terms, not synonyms.
- **`spec/*.md`**: the product and architecture specs (see `spec/agents.md` for which file covers what). They are the source of truth for behaviour.

If a file doesn't cover the area you're working in, proceed silently.

## Where decisions are recorded

- Resolved terms go in `spec/glossary.md`.
- Behaviour and architecture decisions go in the matching `spec/*.md` file, not a separate ADR folder. Do not create `GLOSSARY.md` or `docs/adr/`.
- A spec file must never carry a specific place's name, status or coordinates (see `spec/agents.md`).
