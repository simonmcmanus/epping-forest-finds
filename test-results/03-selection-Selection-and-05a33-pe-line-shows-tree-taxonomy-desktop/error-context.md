# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 03-selection.spec.js >> Selection and Inspector >> tree selected via URL hash >> inspector type line shows tree taxonomy
- Location: test/e2e/03-selection.spec.js:15:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#inspectorType')
Expected substring: "Quercus robur"
Received string:    ""
Timeout: 5000ms

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('#inspectorType')
    14 × locator resolved to <p class="type" id="inspectorType"></p>
       - unexpected value ""

```

```yaml
- main:
  - heading "Allow location access" [level=2]
  - paragraph: Tap below to allow location so the map can centre on you and show nearby finds.
  - button "Enable location"
  - complementary:
    - button "Back to nearby"
    - button "3 top-level filters selected" [pressed]
    - button "Report missing data or request a feature"
    - button "Settings"
    - button "Use my location"
    - heading "Nearby" [level=2]
    - paragraph: Could not fully load map data. Try a hard refresh. If running locally, make sure the server is started from this folder.
```

# Test source

```ts
  1  | // @ts-check
  2  | const { test, expect } = require("@playwright/test");
  3  | const { setup, FIXTURE_TREE } = require("./helpers");
  4  | 
  5  | test.describe("Selection and Inspector", () => {
  6  |   test.describe("tree selected via URL hash", () => {
  7  |     test.beforeEach(async ({ page }) => {
  8  |       await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  9  |     });
  10 | 
  11 |     test("inspector title changes to the selected tree name", async ({ page }) => {
  12 |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  13 |     });
  14 | 
  15 |     test("inspector type line shows tree taxonomy", async ({ page }) => {
> 16 |       await expect(page.locator("#inspectorType")).toContainText(FIXTURE_TREE.latinName, { timeout: 5_000 });
     |                                                    ^ Error: expect(locator).toContainText(expected) failed
  17 |     });
  18 | 
  19 |     test("inspector body shows tree register details", async ({ page }) => {
  20 |       // Tag number should appear somewhere in the detail panel
  21 |       await expect(page.locator("#inspectorBody")).toContainText(FIXTURE_TREE.tagNumber, { timeout: 5_000 });
  22 |     });
  23 | 
  24 |     test("URL hash reflects the selected tree", async ({ page }) => {
  25 |       await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`));
  26 |     });
  27 | 
  28 |     test("snapshot: tree detail view", async ({ page }) => {
  29 |       await page.waitForTimeout(400);
  30 |       await expect(page).toHaveScreenshot("tree-detail.png", { fullPage: false });
  31 |     });
  32 |   });
  33 | 
  34 |   test.describe("returning to overview", () => {
  35 |     test.beforeEach(async ({ page }) => {
  36 |       await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  37 |     });
  38 | 
  39 |     test("back button returns inspector to overview mode", async ({ page }) => {
  40 |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  41 |       await page.click("#nearbyToggle");
  42 |       await expect(page.locator("#inspectorTitle")).toContainText("Nearby", { timeout: 5_000 });
  43 |     });
  44 | 
  45 |     test("URL hash is cleared when returning to overview", async ({ page }) => {
  46 |       await page.click("#nearbyToggle");
  47 |       // Hash should no longer contain a tree key
  48 |       await expect(page).not.toHaveURL(/tree=/);
  49 |     });
  50 |   });
  51 | 
  52 |   test.describe("tree search panel", () => {
  53 |     test.beforeEach(async ({ page }) => {
  54 |       await setup(page);
  55 |     });
  56 | 
  57 |     test("tree search toggle reveals the search input", async ({ page }) => {
  58 |       await expect(page.locator("#treeSearchPanel")).toBeHidden();
  59 |       await page.click("#treeSearchToggle");
  60 |       await expect(page.locator("#treeSearchPanel")).toBeVisible({ timeout: 3_000 });
  61 |     });
  62 | 
  63 |     test("searching by tree number selects the correct tree", async ({ page }) => {
  64 |       await page.click("#treeSearchToggle");
  65 |       await page.fill("#treeSearchInput", FIXTURE_TREE.tagNumber);
  66 |       await page.click("#treeSearchButton");
  67 |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  68 |     });
  69 |   });
  70 | 
  71 |   test.describe("inspector state when location is selected", () => {
  72 |     test.beforeEach(async ({ page }) => {
  73 |       await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  74 |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  75 |     });
  76 | 
  77 |     test("filter button is hidden in selected-detail mode", async ({ page }) => {
  78 |       await expect(page.locator("#filterToggle")).toBeHidden();
  79 |     });
  80 | 
  81 |     test("inspector back button is visible in selected-detail mode", async ({ page }) => {
  82 |       await expect(page.locator("#inspectorBack")).toBeVisible();
  83 |     });
  84 |   });
  85 | });
  86 | 
```