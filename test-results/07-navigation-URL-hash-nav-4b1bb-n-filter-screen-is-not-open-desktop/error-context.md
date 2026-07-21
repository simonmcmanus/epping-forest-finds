# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 07-navigation.spec.js >> URL hash navigation >> empty hash >> an empty hashchange triggers goToInitialView when filter screen is not open
- Location: test/e2e/07-navigation.spec.js:40:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#inspectorTitle')
Expected substring: "English Oak"
Received string:    "Nearby"
Timeout: 5000ms

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('#inspectorTitle')
    14 × locator resolved to <h2 id="inspectorTitle">Nearby</h2>
       - unexpected value "Nearby"

```

```yaml
- heading "Nearby" [level=2]
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
> 42 |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
     |                                                     ^ Error: expect(locator).toContainText(expected) failed
  43 |       // Manually clear hash to trigger hashchange
  44 |       await page.evaluate(() => history.replaceState(null, "", "/"));
  45 |       await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  46 |       await expect(page.locator("#inspectorTitle")).toContainText("Nearby", { timeout: 3_000 });
  47 |     });
  48 | 
  49 |     test("an empty hashchange does not close the filter screen", async ({ page }) => {
  50 |       await setup(page);
  51 |       await page.click("#filterToggle");
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