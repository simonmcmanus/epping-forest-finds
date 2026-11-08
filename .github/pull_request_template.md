## Summary

<!-- Keep the description concise and easy to scan. In 1–3 short bullets, explain who benefits,
     what changes for them, and why it matters. For internal changes, state the practical benefit.
     Include implementation details only when needed to understand an impact or risk.
     Link related issues. Delete optional sections that do not apply. -->

## How to test

<!-- Give repeatable steps for this PR, including any setup, test data or permissions needed.
     Link the relevant preview page with nuke=true. Give an observable expected result per step.
     For changes without an app flow, describe how to verify the changed document or workflow. -->

1. Open …
2. Do … → expect …

## Areas to check

<!-- Replace the prompts with a short checklist specific to this change. Keep only relevant areas:
     affected journeys and nearby regressions; validation, loading, empty and error states;
     mobile layout and accessibility; offline/reconnect behaviour; permissions and privacy.
     Highlight any known limitation or risk that needs reviewer attention. -->

- [ ] …

## Visual changes

<!-- If this PR changes any toHaveScreenshot() baseline, list each changed snapshot by name and embed
     its before and after images, linked to the commit each came from:
     | Before | After |
     | --- | --- |
     | ![before](https://raw.githubusercontent.com/<owner>/<repo>/<before-sha>/test/e2e/__screenshots__/<name>.png) | ![after](https://raw.githubusercontent.com/<owner>/<repo>/<after-sha>/test/e2e/__screenshots__/<name>.png) |
     CI fills this section automatically. Delete it only if nothing visual changed. -->

## Verification

<!-- Briefly list checks actually run and their results; distinguish local checks from CI and link
     the CI run. State anything not tested and why. Remove checks that do not apply. -->

- [ ] Unit tests passed (`npm run test:unit`)
- [ ] Relevant browser coverage passed
- [ ] Spec updated, or this is implementation/data-only

## Deploy preview

Netlify replaces this section with links for the deploy preview once it is ready.

<!-- preview-links:start -->
_Waiting for Netlify’s deploy preview…_
<!-- preview-links:end -->
