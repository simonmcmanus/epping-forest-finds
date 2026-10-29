spec/agents.md

Preview and PR workflow
- Always create a pull request for changes so they can be reviewed and previewed.
- Once the changes are ready, check the PR comments for the preview-environment URL and wait until the preview is available.
- In the final response, provide a useful testing link into the preview environment. Choose a representative page or flow that exercises the change, and include the `nuke` parameter in the URL.
- Treat the preview testing link as part of the handoff; do not report the work as ready without it unless the preview environment failed or is unavailable, in which case explain why.

Review


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

