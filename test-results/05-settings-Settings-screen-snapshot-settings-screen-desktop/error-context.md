# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 05-settings.spec.js >> Settings screen >> snapshot: settings screen
- Location: test/e2e/05-settings.spec.js:39:3

# Error details

```
Test timeout of 60000ms exceeded while running "beforeEach" hook.
```

```
Error: page.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('#settingsToggle')
    - locator resolved to <button type="button" id="settingsToggle" aria-label="Settings" class="close settings-toggle">…</button>
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
  5  | test.describe("Settings screen", () => {
  6  |   test.beforeEach(async ({ page }) => {
  7  |     await setup(page);
> 8  |     await page.click("#settingsToggle");
     |                ^ Error: page.click: Test timeout of 60000ms exceeded.
  9  |     // Wait for the settings panel to render
  10 |     await expect(page.locator("#settingsWalkMins")).toBeVisible({ timeout: 5_000 });
  11 |   });
  12 | 
  13 |   test("settings button opens the settings screen", async ({ page }) => {
  14 |     await expect(page.locator("#settingsToggle")).toHaveClass(/screen-active/);
  15 |   });
  16 | 
  17 |   test("settings screen shows a walking radius dropdown", async ({ page }) => {
  18 |     await expect(page.locator("#settingsWalkMins")).toBeVisible();
  19 |   });
  20 | 
  21 |   test("walking radius options are 1 2 5 10 15 20 30 minutes", async ({ page }) => {
  22 |     const values = await page
  23 |       .locator("#settingsWalkMins option")
  24 |       .evaluateAll((els) => els.map((e) => e.value));
  25 |     expect(values).toEqual(expect.arrayContaining(["1", "2", "5", "10", "15", "20", "30"]));
  26 |   });
  27 | 
  28 |   test("settings screen shows the app version in the About section", async ({ page }) => {
  29 |     await expect(page.locator("#appVersionDisplay")).toBeVisible();
  30 |     // Should start with 'v' — e.g. "v120"
  31 |     await expect(page.locator("#appVersionDisplay")).toContainText("v");
  32 |   });
  33 | 
  34 |   test("nearby button returns to overview from settings", async ({ page }) => {
  35 |     await page.click("#nearbyToggle");
  36 |     await expect(page.locator("#inspectorTitle")).toContainText("Nearby", { timeout: 3_000 });
  37 |   });
  38 | 
  39 |   test("snapshot: settings screen", async ({ page }) => {
  40 |     await page.waitForTimeout(300);
  41 |     await expect(page).toHaveScreenshot("settings-screen.png", { fullPage: false });
  42 |   });
  43 | });
  44 | 
```