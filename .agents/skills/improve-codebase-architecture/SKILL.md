---
name: improve-codebase-architecture
description: "Review a repository's architecture and propose prioritized, evidence-backed improvements without changing product behavior."
---

# Improve codebase architecture

Use this skill when the user asks for `/improve-codebase-architecture`, an architecture review, or suggestions for improving maintainability, modularity, performance, or system boundaries.

The default outcome is a review, not an implementation. Do not edit application code unless the user explicitly asks for implementation after receiving the review.

## Review process

1. Establish scope.

   - Confirm the repository root and current working tree.
   - Read `AGENTS.md`, `CLAUDE.md`, `CODING_STANDARDS.md`, and relevant product specifications before judging structure.
   - Preserve user changes and report unrelated dirty-worktree changes when they affect the review.

2. Map the system.

   Identify the runtime surfaces, entry points, modules, data sources, persistence, external integrations, build scripts, deployment configuration, and tests. Prefer `rg --files`, `rg`, and `git` inspection.

   Describe the important flow in plain language:

   ```text
   entry point
     -> boot/configuration
     -> data loading and normalization
     -> state/store
     -> rendering or response
     -> persistence/external services
   ```

3. Measure before proposing.

   Look for concrete signals:

   - oversized modules or files with several unrelated responsibilities;
   - implicit dependencies, global state, load-order coupling, or circular boundaries;
   - duplicated domain rules between runtime, build-time, and server code;
   - repeated full scans, unnecessary serialization, blocking work, or large hot paths;
   - cache, deployment, and route definitions that must be maintained by hand;
   - tests that evaluate implementation details, share mutable state, or lack boundary coverage;
   - dead, backup, generated, or environment-specific artifacts tracked as source.

4. Separate facts from judgement.

   Every recommendation must include an evidence reference: an absolute file link and line number, a measured count, or a reproducible command. Label speculative risks as risks rather than defects. Do not recommend a framework migration solely because the current code is unfamiliar.

5. Prioritize improvements.

   Rank each item using:

   - **High** — likely to cause regressions, block feature work, or materially affect performance/reliability;
   - **Medium** — recurring maintenance cost or meaningful testability/deployment risk;
   - **Low** — cleanup or consistency improvement with limited near-term impact.

   For each item give: the architectural problem, why it matters, the smallest sensible target design, affected files, and how to validate it.

6. Give an incremental roadmap.

   Prefer reversible seams and migration steps over a rewrite. Start with pure shared logic and characterization tests, then introduce explicit interfaces, state boundaries, workers/indexes, or generated manifests only where evidence supports them.

## Required output

Lead with a short overall assessment. Then provide a compact prioritized list or table with:

```text
Priority | Problem | Evidence | Improvement | Validation
```

End with an ordered implementation roadmap and a verification note. State clearly whether files were changed. If tests were run, report the exact command and result; distinguish sandbox or environment failures from product failures.

## Review constraints

- Do not turn architecture preferences into requirements.
- Do not propose a broad rewrite when an incremental boundary will solve the problem.
- Do not conflate product behavior, data corrections, and implementation structure.
- Do not make external changes, open issues, commit, push, or create a pull request unless the user separately asks for that action.
- Keep recommendations specific to the repository and its documented constraints.
