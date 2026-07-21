# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 08-onboarding.spec.js >> Onboarding >> returning visit >> map reveals directly without onboarding on return visit
- Location: test/e2e/08-onboarding.spec.js:57:5

# Error details

```
TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('#loadingOverlay[hidden]') to be visible
    57 × locator resolved to hidden <div hidden="" aria-live="polite" id="loadingOverlay" class="loading-overlay" aria-label="Loading map data">…</div>

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
  3  | const { mockCowApi } = require("./helpers");
  4  | 
  5  | test.describe("Onboarding", () => {
  6  |   test.describe("first visit", () => {
  7  |     // Do NOT call skipOnboarding() — we want the real first-visit behaviour
  8  |     test.beforeEach(async ({ page }) => {
  9  |       await mockCowApi(page);
  10 |     });
  11 | 
  12 |     test("onboarding overlay is shown on first visit", async ({ page }) => {
  13 |       await page.goto("/");
  14 |       await expect(page.locator("#onboardingOverlay")).toBeVisible({ timeout: 10_000 });
  15 |     });
  16 | 
  17 |     test("the location/compass opt-in step is shown first", async ({ page }) => {
  18 |       await page.goto("/");
  19 |       await expect(page.locator("#onboardingOverlay")).toBeVisible({ timeout: 10_000 });
  20 |       // The first step asks the user to enable location — look for the enable button or location text
  21 |       await expect(page.locator("#onboardingOverlay")).toContainText(/location|compass/i);
  22 |     });
  23 | 
  24 |     test("map data loads in the background while onboarding is visible", async ({ page }) => {
  25 |       await page.goto("/");
  26 |       await expect(page.locator("#onboardingOverlay")).toBeVisible({ timeout: 10_000 });
  27 |       // Loading overlay may already be hidden (data loaded behind onboarding) — either state is valid,
  28 |       // but the loading overlay must not block onboarding visibility
  29 |       const overlayHidden = await page.locator("#loadingOverlay").getAttribute("hidden");
  30 |       // Onboarding should still be visible regardless of loading state
  31 |       await expect(page.locator("#onboardingOverlay")).toBeVisible();
  32 |     });
  33 | 
  34 |     test("'Skip for now' advances past the location step without granting permission", async ({ page }) => {
  35 |       await page.goto("/");
  36 |       await expect(page.locator("#onboardingOverlay")).toBeVisible({ timeout: 10_000 });
  37 |       const skipBtn = page.locator("#onboardingOverlay .onboarding-skip-btn, #onboardingOverlay [class*='skip']").first();
  38 |       await skipBtn.click();
  39 |       // Should have moved to the next step — the overlay may still be visible
  40 |       // (welcome step or a filter group step follows)
  41 |       // Just verify the location-only prompt is gone and onboarding continues
  42 |       await expect(page.locator("#onboardingOverlay")).toBeVisible();
  43 |     });
  44 |   });
  45 | 
  46 |   test.describe("returning visit", () => {
  47 |     test("onboarding is skipped entirely on a returning visit", async ({ page }) => {
  48 |       await mockCowApi(page);
  49 |       await page.addInitScript(() => {
  50 |         localStorage.setItem("forest-finds-onboarding-v1", "done");
  51 |       });
  52 |       await page.goto("/");
  53 |       // Onboarding overlay must remain hidden
  54 |       await expect(page.locator("#onboardingOverlay")).toBeHidden({ timeout: 5_000 });
  55 |     });
  56 | 
  57 |     test("map reveals directly without onboarding on return visit", async ({ page }) => {
  58 |       await mockCowApi(page);
  59 |       await page.addInitScript(() => {
  60 |         localStorage.setItem("forest-finds-onboarding-v1", "done");
  61 |       });
  62 |       await page.goto("/");
> 63 |       await page.waitForSelector("#loadingOverlay[hidden]", { timeout: 30_000 });
     |                  ^ TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.
  64 |       await expect(page.locator("#mapCanvas")).toBeVisible();
  65 |     });
  66 |   });
  67 | });
  68 | 
```