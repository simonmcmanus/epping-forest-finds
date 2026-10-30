spec/agents.md

## Pull request workflow

Every implementation change must be committed to a dedicated branch, pushed, and opened as a pull
request (or added to the existing pull request for that branch) before the work is reported as
complete. The pull request is the review and preview handoff.

After every push to a pull-request branch:

- Wait for the branch CI and deploy preview to finish.
- Check review comments, requested changes, and unresolved threads.
- Address all actionable feedback, run the relevant tests, commit, and push again.
- Continue this loop until the required reviewers have approved the pull request, required checks
  are green, and no requested changes remain. Do not stop at "awaiting review" or report completion
  while feedback is unresolved. If approval is blocked by permissions or a decision needed from the
  user, report that blocker explicitly.
- Make the final response for that round a useful testing link into the current preview. Choose a
  representative page or flow that exercises the change and include `nuke=true` in the URL (using
  `&nuke=true` when the URL already has a query string). If the preview is unavailable, say so
  explicitly instead of presenting an unverified link.

The preview testing link is part of the handoff, not optional status text. When rewriting the PR
description, preserve the preview-links block between `<!-- preview-links:start -->` and
`<!-- preview-links:end -->`.

## Review


Review checklist
- Confirm the PR meets the intended requirements and doesn’t introduce unnecessary scope.
- Check that tests verify user-visible behaviour rather than implementation details, including:
  - happy paths
  - validation and error states
  - loading, empty, and retry states
  - edge cases and regressions
- For offline functionality, verify behaviour when:
  - starting offline
  - reconnecting
  - requests fail or retry
  - data becomes stale
  - sync conflicts occur
- Check visual snapshots for all affected screens, states, platforms, and device sizes. Avoid requiring snapshots for unrelated screens.
- Review compatibility with existing functionality, data formats, APIs, migrations, and older app versions where relevant.
- Look for security and privacy issues, including authorization, sensitive data exposure, logging, and unsafe input handling.
- Check performance implications, including rendering, memory, network usage, and battery impact.
- Review the UI against the design system and existing app patterns: layout, typography, spacing, motion, copy, and interaction consistency.
- Verify accessibility: screen readers, focus order, labels, dynamic text sizing, colour contrast, touch targets, reduced motion, and keyboard/switch navigation where applicable.
- Check analytics, logging, feature flags, and rollout behaviour where relevant.
- Confirm the code is maintainable, appropriately documented, and free of avoidable complexity.

