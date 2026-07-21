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
  - waiting for fonts to load...
  - fonts loaded
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
  28  |     test("snapshot: tree detail view", async ({ page }) => {
  29  |       await page.waitForTimeout(600);
  30  |       // Stop all canvas animations so Playwright's stability check can pass.
  31  |       // toHaveScreenshot() requires pixel-identical consecutive RAW screenshots — the mask
  32  |       // only applies to the final baseline comparison, not the stability check.
  33  |       // Two sources of ongoing redraws after boot: (1) viewport animation (triggerMapRevealZoom
  34  |       // runs 700ms, overlay hides at 420ms, so 280ms spill into the test), (2) emoji-scale
  35  |       // exponential smoother (calls requestDraw until settled, ~28 more frames).
  36  |       await page.evaluate(() => {
  37  |         stopViewportAnimation();
  38  |         state.emojiScaleAnimated = zoomEmojiScaleTarget();
  39  |         draw();
  40  |       });
  41  |       await page.waitForTimeout(50);
> 42  |       await expect(page).toHaveScreenshot("tree-detail.png", {
      |                          ^ Error: expect(page).toHaveScreenshot(expected) failed
  43  |         fullPage: false,
  44  |         mask: [page.locator("#mapCanvas")],
  45  |       });
  46  |     });
  47  |   });
  48  | 
  49  |   test.describe("returning to overview", () => {
  50  |     test.beforeEach(async ({ page }) => {
  51  |       await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  52  |     });
  53  | 
  54  |     test("back button returns inspector to overview mode", async ({ page }) => {
  55  |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  56  |       await page.click("#nearbyToggle");
  57  |       // transitionInspectorBody() briefly creates two #inspectorTitle elements during the slide animation;
  58  |       // use waitForFunction with getElementById (returns first match) to avoid strict-mode violations
  59  |       await page.waitForFunction(
  60  |         () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
  61  |         { timeout: 5_000 }
  62  |       );
  63  |     });
  64  | 
  65  |     test("URL hash is cleared when returning to overview", async ({ page }) => {
  66  |       await page.click("#nearbyToggle");
  67  |       // Hash should no longer contain a tree key
  68  |       await expect(page).not.toHaveURL(/tree=/);
  69  |     });
  70  |   });
  71  | 
  72  |   test.describe("tree search panel", () => {
  73  |     // #treeSearchToggle lives in .bottom-search which is display:none at min-width 761px.
  74  |     // Override to a mobile viewport so the toggle is visible.
  75  |     test.use({ viewport: { width: 390, height: 844 } });
  76  | 
  77  |     test.beforeEach(async ({ page }) => {
  78  |       await setup(page);
  79  |     });
  80  | 
  81  |     test("tree search toggle reveals the search input", async ({ page }) => {
  82  |       await expect(page.locator("#treeSearchPanel")).toBeHidden();
  83  |       // #inspectorBody overlaps .bottom-search on mobile (same z-index, inspector is later in DOM).
  84  |       // Playwright force:true still clicks at coordinates so #inspectorBody intercepts.
  85  |       // Dispatch the click event directly to the toggle via JS to bypass the visual hitTest.
  86  |       await page.evaluate(() =>
  87  |         document.getElementById("treeSearchToggle").dispatchEvent(
  88  |           new MouseEvent("click", { bubbles: true, cancelable: true })
  89  |         )
  90  |       );
  91  |       await expect(page.locator("#treeSearchPanel")).toBeVisible({ timeout: 3_000 });
  92  |     });
  93  | 
  94  |     test("searching by tree number selects the correct tree", async ({ page }) => {
  95  |       // Open the panel via JS dispatch (see comment in toggle test above)
  96  |       await page.evaluate(() =>
  97  |         document.getElementById("treeSearchToggle").dispatchEvent(
  98  |           new MouseEvent("click", { bubbles: true, cancelable: true })
  99  |         )
  100 |       );
  101 |       // After toggle, #treeSearchPanel is inside inspector-tools (top of inspector, not covered)
  102 |       await page.fill("#treeSearchInput", FIXTURE_TREE.tagNumber);
  103 |       await page.click("#treeSearchButton");
  104 |       // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
  105 |       await page.waitForFunction(
  106 |         (name) => document.getElementById("inspectorTitle")?.textContent?.includes(name),
  107 |         FIXTURE_TREE.commonName,
  108 |         { timeout: 5_000 }
  109 |       );
  110 |     });
  111 |   });
  112 | 
  113 |   test.describe("inspector state when location is selected", () => {
  114 |     test.beforeEach(async ({ page }) => {
  115 |       await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
  116 |       await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
  117 |     });
  118 | 
  119 |     test("inspector tools section is hidden in selected-detail mode", async ({ page }) => {
  120 |       // .inspector-tools (count selector, locate button) are hidden when a detail view is shown;
  121 |       // the main action buttons (#filterToggle etc) remain accessible in .inspector-actions
  122 |       await expect(page.locator(".inspector-tools")).toBeHidden();
  123 |     });
  124 | 
  125 |     test("inspector back button is visible in selected-detail mode", async ({ page }) => {
  126 |       await expect(page.locator("#inspectorBack")).toBeVisible();
  127 |     });
  128 |   });
  129 | });
  130 | 
```