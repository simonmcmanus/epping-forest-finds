// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

// A GPS fix inside Epping Forest
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.describe("Location and GPS — happy path", () => {
  test.describe("geolocation granted", () => {
    test.use({
      // Playwright grants geolocation and sets the mock position for this group
      geolocation: FOREST_LOCATION,
      permissions: ["geolocation"],
    });

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page);
    });

    test("location loading step reaches 'done' after a GPS fix", async ({ page }) => {
      // The location step should transition to done class after a fix arrives
      await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/, { timeout: 10_000 });
    });

    test("the location gate is not shown when geolocation is pre-granted", async ({ page }) => {
      await expect(page.locator("#locationGate")).toBeHidden({ timeout: 5_000 });
    });

    test("distance info appears in the inspector after a GPS fix", async ({ page }) => {
      // Navigate to a tree via URL hash (tree search toggle is hidden on desktop viewports)
      await page.goto("/#tree=11383");
      await page.waitForFunction(
        () => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; },
        { timeout: 30_000 }
      );
      await page.evaluate(() => { const g = document.getElementById("locationGate"); if (g && !g.hidden) g.hidden = true; });
      // Inspector body should contain both walk time and distance in sensible units.
      // transitionInspectorBody() briefly creates two #inspectorBody elements; use .first()
      await expect(page.locator("#inspectorBody").first()).toContainText(/min/, { timeout: 5_000 });
      await expect(page.locator("#inspectorBody").first()).toContainText(/\d+\s?(m|mi)/, { timeout: 5_000 });
    });

    test("snapshot: map with user location active", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
      await page.waitForTimeout(800);
      await page.evaluate(() => { stopViewportAnimation(); state.emojiScaleAnimated = zoomEmojiScaleTarget(); draw(); });
      await page.waitForTimeout(50);
      await expect(page).toHaveScreenshot("map-with-location.png", {
        fullPage: false,
        timeout: 12000,
        maxDiffPixelRatio: 0.02,
      });
    });
  });

  test.describe("geolocation denied", () => {
    // No geolocation permission granted — browser will trigger error callback

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      // Grant no permissions — geolocation will be blocked at OS level in the test browser
    });

    test("location gate is shown after geolocation is denied or times out", async ({ page }) => {
      await gotoAndWaitForMap(page);
      // The location gate should become visible once the error/timeout path runs
      await expect(page.locator("#locationGate")).toBeVisible({ timeout: 15_000 });
    });

    test("location gate button re-enables after the gate re-appears", async ({ page }) => {
      await gotoAndWaitForMap(page);
      await expect(page.locator("#locationGateButton")).toBeEnabled({ timeout: 15_000 });
    });
  });
});
