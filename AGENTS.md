spec/agents.md

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

