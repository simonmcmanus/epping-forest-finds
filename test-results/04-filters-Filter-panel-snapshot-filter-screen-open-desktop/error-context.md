# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 04-filters.spec.js >> Filter panel >> snapshot: filter screen open
- Location: test/e2e/04-filters.spec.js:57:3

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('#filterToggle')
    - locator resolved to <button type="button" id="filterToggle" aria-pressed="true" class="close filter-toggle" aria-label="3 top-level filters selected">…</button>
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
  5  | test.describe("Filter panel", () => {
  6  |   test.beforeEach(async ({ page }) => {
  7  |     await setup(page);
  8  |   });
  9  | 
  10 |   test("filter toggle opens the filter screen", async ({ page }) => {
  11 |     await page.click("#filterToggle");
  12 |     await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/, { timeout: 3_000 });
  13 |   });
  14 | 
  15 |   test("URL hash becomes #filters when the filter screen opens", async ({ page }) => {
  16 |     await page.click("#filterToggle");
  17 |     await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
  18 |   });
  19 | 
  20 |   test("filter panel contains all six filter groups", async ({ page }) => {
  21 |     await page.click("#filterToggle");
  22 |     const body = page.locator("#inspectorBody");
  23 |     await expect(body).toContainText("Nature", { timeout: 3_000 });
  24 |     await expect(body).toContainText("Food");
  25 |     await expect(body).toContainText("Transport");
  26 |     await expect(body).toContainText("History");
  27 |     await expect(body).toContainText("Locations");
  28 |     await expect(body).toContainText("Stories");
  29 |   });
  30 | 
  31 |   test("filter screen stays open when the map canvas is tapped", async ({ page }) => {
  32 |     await page.click("#filterToggle");
  33 |     await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
  34 |     // Tap the canvas — filter screen must not close
  35 |     await page.locator("#mapCanvas").click({ position: { x: 200, y: 200 } });
  36 |     await expect(page).toHaveURL(/#filters$/);
  37 |   });
  38 | 
  39 |   test("Nearby button closes the filter screen and returns to overview", async ({ page }) => {
  40 |     await page.click("#filterToggle");
  41 |     await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
  42 |     await page.click("#nearbyToggle");
  43 |     await expect(page.locator("#inspectorTitle")).toContainText("Nearby", { timeout: 3_000 });
  44 |     await expect(page).not.toHaveURL(/#filters$/);
  45 |   });
  46 | 
  47 |   test("filter button shows active count badge when filters are toggled on", async ({ page }) => {
  48 |     await page.click("#filterToggle");
  49 |     // Click a subfilter chip to activate it
  50 |     const firstChip = page.locator(".filter-chip").first();
  51 |     await firstChip.click();
  52 |     const badge = page.locator("#filterCount");
  53 |     // Badge should be visible with a non-zero count
  54 |     await expect(badge).toBeVisible({ timeout: 3_000 });
  55 |   });
  56 | 
  57 |   test("snapshot: filter screen open", async ({ page }) => {
> 58 |     await page.click("#filterToggle");
     |                ^ Error: page.click: Test timeout of 60000ms exceeded.
  59 |     await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
  60 |     await page.waitForTimeout(300);
  61 |     await expect(page).toHaveScreenshot("filter-screen.png", { fullPage: false });
  62 |   });
  63 | });
  64 | 
```