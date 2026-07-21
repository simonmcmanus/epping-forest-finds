# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 03-selection.spec.js >> Selection and Inspector >> tree selected via URL hash >> snapshot: tree detail view
- Location: test/e2e/03-selection.spec.js:28:5

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

Timeout: 5000ms
  Timeout 5000ms exceeded.

  Snapshot: tree-detail.png

Call log:
  - Expect "toHaveScreenshot(tree-detail.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - Timeout 5000ms exceeded.

```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic "Interactive map of veteran trees and local landmarks" [ref=e4]
  - text: "!"
  - button "Show tree search" [ref=e6] [cursor=pointer]: 🔍
  - complementary [ref=e7]:
    - generic "Drag to resize" [ref=e8]
    - generic [ref=e9]:
      - button "Back to nearby" [ref=e10] [cursor=pointer]
      - button "3 top-level filters selected" [pressed] [ref=e11] [cursor=pointer]:
        - generic [ref=e12]: "3"
      - button "Report missing data or request a feature" [ref=e13] [cursor=pointer]
      - button "Settings" [ref=e14] [cursor=pointer]
    - button "Back to nearest locations" [ref=e16] [cursor=pointer]:
      - img
    - generic [ref=e18]:
      - generic [ref=e21]:
        - heading "English Oak" [level=2] [ref=e22]
        - paragraph [ref=e23]: Veteran tree
      - text: ▶
```

# Test source

```ts
  1   | // @ts-check
  2   | const { test, expect } = require("@playwright/test");
  3   | const { setup, FIXTURE_TREE } = require("./helpers");
  4   | 
  5   | test.describe("Selection and Inspector", () => {
  6   |   test.describe("tree selected via URL hash", () => {
  7   |     test.beforeEach(async ({ page }) => {
  8   |       await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  9   |     });
  10  | 
  11  |     test("inspector title changes to the selected tree name", async ({ page }) => {
  12  |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  13  |     });
  14  | 
  15  |     test("inspector type line shows veteran tree label", async ({ page }) => {
  16  |       await expect(page.locator("#inspectorType")).toContainText("Veteran tree", { timeout: 5_000 });
  17  |     });
  18  | 
  19  |     test("inspector body shows tree register details", async ({ page }) => {
  20  |       // Tag number should appear somewhere in the detail panel
  21  |       await expect(page.locator("#inspectorBody")).toContainText(FIXTURE_TREE.tagNumber, { timeout: 5_000 });
  22  |     });
  23  | 
  24  |     test("URL hash reflects the selected tree", async ({ page }) => {
  25  |       await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`));
  26  |     });
  27  | 
  28  |     test("snapshot: tree detail view", async ({ page }, testInfo) => {
  29  |       test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
  30  |       await page.waitForTimeout(600);
  31  |       // Stop all canvas animations so Playwright's stability check can pass.
  32  |       // toHaveScreenshot() requires pixel-identical consecutive RAW screenshots — the mask
  33  |       // only applies to the final baseline comparison, not the stability check.
  34  |       // Two sources of ongoing redraws after boot: (1) viewport animation (triggerMapRevealZoom
  35  |       // runs 700ms, overlay hides at 420ms, so 280ms spill into the test), (2) emoji-scale
  36  |       // exponential smoother (calls requestDraw until settled, ~28 more frames).
  37  |       await page.evaluate(() => {
  38  |         stopViewportAnimation();
  39  |         state.emojiScaleAnimated = zoomEmojiScaleTarget();
  40  |         draw();
  41  |       });
  42  |       await page.waitForTimeout(50);
> 43  |       await expect(page).toHaveScreenshot("tree-detail.png", {
      |                          ^ Error: expect(page).toHaveScreenshot(expected) failed
  44  |         fullPage: false,
  45  |         mask: [page.locator("#mapCanvas")],
  46  |       });
  47  |     });
  48  |   });
  49  | 
  50  |   test.describe("returning to overview", () => {
  51  |     test.beforeEach(async ({ page }) => {
  52  |       await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  53  |     });
  54  | 
  55  |     test("back button returns inspector to overview mode", async ({ page }) => {
  56  |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  57  |       await page.click("#nearbyToggle");
  58  |       // transitionInspectorBody() briefly creates two #inspectorTitle elements during the slide animation;
  59  |       // use waitForFunction with getElementById (returns first match) to avoid strict-mode violations
  60  |       await page.waitForFunction(
  61  |         () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
  62  |         { timeout: 5_000 }
  63  |       );
  64  |     });
  65  | 
  66  |     test("URL hash is cleared when returning to overview", async ({ page }) => {
  67  |       await page.click("#nearbyToggle");
  68  |       // Hash should no longer contain a tree key
  69  |       await expect(page).not.toHaveURL(/tree=/);
  70  |     });
  71  |   });
  72  | 
  73  |   test.describe("tree search panel", () => {
  74  |     // #treeSearchToggle lives in .bottom-search which is display:none at min-width 761px.
  75  |     // Override to a mobile viewport so the toggle is visible.
  76  |     test.use({ viewport: { width: 390, height: 844 } });
  77  | 
  78  |     test.beforeEach(async ({ page }) => {
  79  |       await setup(page);
  80  |     });
  81  | 
  82  |     test("tree search toggle reveals the search input", async ({ page }) => {
  83  |       await expect(page.locator("#treeSearchPanel")).toBeHidden();
  84  |       // #inspectorBody overlaps .bottom-search on mobile (same z-index, inspector is later in DOM).
  85  |       // Playwright force:true still clicks at coordinates so #inspectorBody intercepts.
  86  |       // Dispatch the click event directly to the toggle via JS to bypass the visual hitTest.
  87  |       await page.evaluate(() =>
  88  |         document.getElementById("treeSearchToggle").dispatchEvent(
  89  |           new MouseEvent("click", { bubbles: true, cancelable: true })
  90  |         )
  91  |       );
  92  |       await expect(page.locator("#treeSearchPanel")).toBeVisible({ timeout: 3_000 });
  93  |     });
  94  | 
  95  |     test("searching by tree number selects the correct tree", async ({ page }) => {
  96  |       // Open the panel via JS dispatch (see comment in toggle test above)
  97  |       await page.evaluate(() =>
  98  |         document.getElementById("treeSearchToggle").dispatchEvent(
  99  |           new MouseEvent("click", { bubbles: true, cancelable: true })
  100 |         )
  101 |       );
  102 |       // After toggle, #treeSearchPanel is inside inspector-tools (top of inspector, not covered)
  103 |       await page.fill("#treeSearchInput", FIXTURE_TREE.tagNumber);
  104 |       await page.click("#treeSearchButton");
  105 |       // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
  106 |       await page.waitForFunction(
  107 |         (name) => document.getElementById("inspectorTitle")?.textContent?.includes(name),
  108 |         FIXTURE_TREE.commonName,
  109 |         { timeout: 5_000 }
  110 |       );
  111 |     });
  112 |   });
  113 | 
  114 |   test.describe("inspector state when location is selected", () => {
  115 |     test.beforeEach(async ({ page }) => {
  116 |       await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  117 |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  118 |     });
  119 | 
  120 |     test("inspector tools section is hidden in selected-detail mode", async ({ page }) => {
  121 |       // .inspector-tools (count selector, locate button) are hidden when a detail view is shown;
  122 |       // the main action buttons (#filterToggle etc) remain accessible in .inspector-actions
  123 |       await expect(page.locator(".inspector-tools")).toBeHidden();
  124 |     });
  125 | 
  126 |     test("inspector back button is visible in selected-detail mode", async ({ page }) => {
  127 |       await expect(page.locator("#inspectorBack")).toBeVisible();
  128 |     });
  129 |   });
  130 | });
  131 | 
```