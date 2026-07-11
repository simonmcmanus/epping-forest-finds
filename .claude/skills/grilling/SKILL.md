/grilling

Grill the user with targeted clarifying questions before implementing a feature or fix, using the codebase as context.

## Instructions

Read the following spec and project files to ground your questions:
- `spec/spec.md`
- `spec/spec-data-rendering.md`
- `spec/spec-data-fetching.md`
- `spec/glossary.md`
- `CLAUDE.md`

Then ask the user 4–6 focused clarifying questions tailored to what they've described. Questions should surface ambiguities in:

- **Scope** — what exactly changes, what stays the same
- **UX behaviour** — interactions, edge cases, mobile vs desktop
- **Data** — which fields, normalisation, GeoJSON structure
- **Architecture** — which file owns the logic (renderer, inspector, nav, categories, tracker)
- **Performance** — canvas redraws, mobile impact
- **Spec alignment** — does this change existing spec'd behaviour

Format as a numbered list with a one-line intro. Keep tone collaborative.

Do not implement anything until the user has answered. After they answer, summarise what you'll build in 2–3 bullet points and ask for confirmation before starting.
