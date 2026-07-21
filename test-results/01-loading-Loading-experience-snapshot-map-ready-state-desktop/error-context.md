# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01-loading.spec.js >> Loading experience >> snapshot: map ready state
- Location: test/e2e/01-loading.spec.js:56:3

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

Timeout: 5000ms
  Timeout 5000ms exceeded.

  Snapshot: map-ready.png

Call log:
  - Expect "toHaveScreenshot(map-ready.png)" with timeout 5000ms
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
      - paragraph [ref=e29]: Use your location to list the nearest trees, cows, cafés, transport links, pubs, and landmarks.
```

# Test source

```ts
  1  | // @ts-check
  2  | const { test, expect } = require("@playwright/test");
  3  | const { skipOnboarding, mockCowApi } = require("./helpers");
  4  | 
  5  | test.describe("Loading experience", () => {
  6  |   test.beforeEach(async ({ page }) => {
  7  |     await skipOnboarding(page);
  8  |     await mockCowApi(page);
  9  |   });
  10 | 
  11 |   test("shows the loading overlay at startup before data arrives", async ({ page }) => {
  12 |     // Throttle data files so the overlay stays up long enough to assert on
  13 |     await page.route("**/data/**", async (route) => {
  14 |       await new Promise((r) => setTimeout(r, 500));
  15 |       await route.continue();
  16 |     });
  17 |     await page.goto("/");
  18 |     await expect(page.locator("#loadingOverlay")).toBeVisible({ timeout: 5_000 });
  19 |   });
  20 | 
  21 |   test("overlay displays all eight loading step labels", async ({ page }) => {
  22 |     await page.goto("/");
  23 |     await expect(page.locator("[data-load-step='trees'] .step-label")).toContainText("Veteran trees");
  24 |     await expect(page.locator("[data-load-step='places'] .step-label")).toContainText("Places");
  25 |     await expect(page.locator("[data-load-step='paths'] .step-label")).toContainText("Paths");
  26 |     await expect(page.locator("[data-load-step='roads'] .step-label")).toContainText("Roads");
  27 |     await expect(page.locator("[data-load-step='environment'] .step-label")).toContainText("Water");
  28 |     await expect(page.locator("[data-load-step='forest'] .step-label")).toContainText("Forest");
  29 |     await expect(page.locator("[data-load-step='cows'] .step-label")).toContainText("cattle");
  30 |     await expect(page.locator("[data-load-step='location'] .step-label")).toContainText("location");
  31 |   });
  32 | 
  33 |   test("overlay shows a version badge element", async ({ page }) => {
  34 |     await page.goto("/");
  35 |     await expect(page.locator("#sw-version")).toBeAttached();
  36 |   });
  37 | 
  38 |   test("overlay dismisses automatically after all steps complete", async ({ page }) => {
  39 |     await page.goto("/");
  40 |     await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
  41 |   });
  42 | 
  43 |   test("map canvas is visible once loading completes", async ({ page }) => {
  44 |     await page.goto("/");
  45 |     await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
  46 |     await expect(page.locator("#mapCanvas")).toBeVisible();
  47 |   });
  48 | 
  49 |   test("cows step completes with fixture data count", async ({ page }) => {
  50 |     await page.goto("/");
  51 |     await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
  52 |     // The fixture has 2 cows; the step-count badge should reflect that
  53 |     await expect(page.locator("[data-step-count='cows']")).toContainText("2");
  54 |   });
  55 | 
  56 |   test("snapshot: map ready state", async ({ page }) => {
  57 |     await page.goto("/");
  58 |     await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
  59 |     await page.waitForTimeout(600);
  60 |     await page.evaluate(() => { stopViewportAnimation(); state.emojiScaleAnimated = zoomEmojiScaleTarget(); draw(); });
  61 |     await page.waitForTimeout(50);
> 62 |     await expect(page).toHaveScreenshot("map-ready.png", { fullPage: false });
     |                        ^ Error: expect(page).toHaveScreenshot(expected) failed
  63 |   });
  64 | });
  65 | 
```