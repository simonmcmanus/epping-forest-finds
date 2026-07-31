/grilling

Grill the user with targeted clarifying questions before implementing a feature or fix, using the codebase as context.

## Instructions

Read the following spec and project files to ground your questions:
- `spec/spec.md`
- `spec/spec-data-rendering.md`
- `spec/spec-data-fetching.md`
- `spec/spec-admin.md`
- `spec/spec-icons.md`
- `spec/glossary.md`
- `CLAUDE.md`

Identify ambiguities in what the user has described, covering:

- **Scope** — what exactly changes, what stays the same
- **UX behaviour** — interactions, edge cases, mobile vs desktop
- **Data** — which fields, normalisation, GeoJSON structure
- **Architecture** — which file owns the logic (renderer, inspector, nav, categories, tracker)
- **Performance** — canvas redraws, mobile impact
- **Spec alignment** — does this change existing spec'd behaviour

If a fact can be settled by reading the spec files or the codebase, look it up rather than asking — only ask about genuine decisions.

Ask one question at a time, waiting for the user's answer before asking the next. Do not front-load a numbered list of 4–6 questions — later questions should adapt based on earlier answers. For each question, offer your recommended answer so the user can confirm or override it rather than drafting from scratch. Keep tone collaborative.

Do not implement anything until the user has answered all questions and confirmed a shared understanding.

## Finishing the session

Once the open questions are resolved, summarise the outcome using this structure instead of a plain prose recap:

- **Problem** — one line on what's being solved
- **Solution** — one line on the approach agreed
- **Decisions** — the resolved answers from the interview, as a short list (scope, UX, data, architecture, performance, spec alignment — only include the ones that were actually in question)
- **Spec impact** — which `spec/*.md` file(s) will need updating, or state that none apply

Ask for confirmation before starting implementation.
