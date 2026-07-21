# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 06-feedback.spec.js >> Feedback / Report screen >> report form has a Submit button
- Location: test/e2e/06-feedback.spec.js:26:3

# Error details

```
Test timeout of 60000ms exceeded while running "beforeEach" hook.
```

```
Error: page.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('#reportToggle')
    - locator resolved to <button type="button" id="reportToggle" class="close report-toggle" aria-label="Report missing data or request a feature">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div id="locationGate" aria-live="polite" class="location-gate">…</div> intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div id="locationGate" aria-live="polite" class="location-gate">…</div> intercepts pointer events
    - retrying click action
      - waiting 100ms
    112 × waiting for element to be visible, enabled and stable
        - element is visible, enabled and stable
        - scrolling into view if needed
        - done scrolling
        - <div id="locationGate" aria-live="polite" class="location-gate">…</div> intercepts pointer events
      - retrying click action
        - waiting 500ms
    - waiting for element to be visible, enabled and stable

```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic "Interactive map of veteran trees and local landmarks" [ref=e4]
  - text: "!"
  - generic [ref=e6]:
    - heading "Allow location access" [level=2] [ref=e8]
    - paragraph [ref=e9]: Tap below to allow location so the map can centre on you and show nearby finds.
    - button "Enable location" [ref=e10] [cursor=pointer]
  - complementary [ref=e11]:
    - generic [ref=e12]:
      - button "Back to nearby" [ref=e13] [cursor=pointer]
      - button "3 top-level filters selected" [pressed] [ref=e14] [cursor=pointer]:
        - generic [ref=e15]: "3"
      - button "Report missing data or request a feature" [ref=e16] [cursor=pointer]
      - button "Settings" [ref=e17] [cursor=pointer]
    - button "Use my location" [ref=e21] [cursor=pointer]
    - generic [ref=e23]:
      - heading "Nearby" [level=2] [ref=e27]
      - paragraph [ref=e29]: Could not fully load map data. Try a hard refresh. If running locally, make sure the server is started from this folder.
```

# Test source

```ts
  1  | // @ts-check
  2  | const { test, expect } = require("@playwright/test");
  3  | const { setup } = require("./helpers");
  4  | 
  5  | test.describe("Feedback / Report screen", () => {
  6  |   test.beforeEach(async ({ page }) => {
  7  |     await setup(page);
> 8  |     await page.click("#reportToggle");
     |                ^ Error: page.click: Test timeout of 60000ms exceeded.
  9  |     await expect(page.locator("#reportDetails")).toBeVisible({ timeout: 5_000 });
  10 |   });
  11 | 
  12 |   test("feedback button opens the report form", async ({ page }) => {
  13 |     await expect(page.locator("#reportToggle")).toHaveClass(/screen-active/);
  14 |     await expect(page.locator("#reportForm")).toBeVisible();
  15 |   });
  16 | 
  17 |   test("report form includes the current app version", async ({ page }) => {
  18 |     // The version is displayed inside the form so the user knows which version will be reported
  19 |     await expect(page.locator("#reportForm")).toContainText("v");
  20 |   });
  21 | 
  22 |   test("report form has a text area for the user's description", async ({ page }) => {
  23 |     await expect(page.locator("#reportDetails")).toBeVisible();
  24 |   });
  25 | 
  26 |   test("report form has a Submit button", async ({ page }) => {
  27 |     await expect(page.locator("#reportSubmit")).toBeVisible();
  28 |   });
  29 | 
  30 |   test("report form has a Cancel button that returns to overview", async ({ page }) => {
  31 |     await page.click("#reportCancel");
  32 |     await expect(page.locator("#inspectorTitle")).toContainText("Nearby", { timeout: 3_000 });
  33 |   });
  34 | });
  35 | 
```