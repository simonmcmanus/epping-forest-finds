# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 07-navigation.spec.js >> URL hash navigation >> empty hash >> an empty hashchange does not close the filter screen
- Location: test/e2e/07-navigation.spec.js:49:5

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
    113 × waiting for element to be visible, enabled and stable
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
  3  | const { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap, FIXTURE_TREE } = require("./helpers");
  4  | 
  5  | test.describe("URL hash navigation", () => {
  6  |   test.describe("hash #filters", () => {
  7  |     test("navigating to /#filters opens the filter screen on load", async ({ page }) => {
  8  |       await skipOnboarding(page);
  9  |       await mockCowApi(page);
  10 |       await gotoAndWaitForMap(page, "/#filters");
  11 |       await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
  12 |       await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);
  13 |     });
  14 |   });
  15 | 
  16 |   test.describe("hash #tree=<key>", () => {
  17 |     test("navigating with a tree hash selects that tree", async ({ page }) => {
  18 |       await skipOnboarding(page);
  19 |       await mockCowApi(page);
  20 |       await gotoAndWaitForMap(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  21 |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  22 |     });
  23 | 
  24 |     test("selecting a tree sets the URL hash via replaceState", async ({ page }) => {
  25 |       await setup(page);
  26 |       // Select via search so we can verify a replaceState (no new history entry)
  27 |       await page.click("#treeSearchToggle");
  28 |       await page.fill("#treeSearchInput", FIXTURE_TREE.tagNumber);
  29 |       await page.click("#treeSearchButton");
  30 |       await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`), { timeout: 5_000 });
  31 | 
  32 |       // replaceState means pressing back exits the app rather than deselecting the tree
  33 |       const historyLength = await page.evaluate(() => window.history.length);
  34 |       // After a replaceState, history.length should be the same as after the initial navigation (1)
  35 |       expect(historyLength).toBe(1);
  36 |     });
  37 |   });
  38 | 
  39 |   test.describe("empty hash", () => {
  40 |     test("an empty hashchange triggers goToInitialView when filter screen is not open", async ({ page }) => {
  41 |       await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  42 |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  43 |       // Manually clear hash to trigger hashchange
  44 |       await page.evaluate(() => history.replaceState(null, "", "/"));
  45 |       await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  46 |       await expect(page.locator("#inspectorTitle")).toContainText("Nearby", { timeout: 3_000 });
  47 |     });
  48 | 
  49 |     test("an empty hashchange does not close the filter screen", async ({ page }) => {
  50 |       await setup(page);
> 51 |       await page.click("#filterToggle");
     |                  ^ Error: page.click: Test timeout of 60000ms exceeded.
  52 |       await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
  53 |       // Clear hash while filter screen is open — it must stay open
  54 |       await page.evaluate(() => history.replaceState(null, "", "/"));
  55 |       await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  56 |       // Filter screen should remain active
  57 |       await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);
  58 |     });
  59 |   });
  60 | });
  61 | 
```