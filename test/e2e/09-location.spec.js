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
      // Inspector body should contain distance info (digits like "Xm" or "X min walk").
      // transitionInspectorBody() briefly creates two #inspectorBody elements; use .first()
      await expect(page.locator("#inspectorBody").first()).toContainText(/\d/, { timeout: 5_000 });
    });

    test("snapshot: map with user location active", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
      await page.waitForTimeout(800);
      await page.evaluate(() => { stopViewportAnimation(); state.emojiScaleAnimated = zoomEmojiScaleTarget(); draw(); });
      await page.waitForTimeout(50);
      await expect(page).toHaveScreenshot("map-with-location.png", { fullPage: false });
    });
  });

  test.describe("geolocation denied", () => {
    // No geolocation permission granted — browser will trigger error callback

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      // Grant no permissions — geolocation will be blocked at OS level in the test browser
    });

    test("demo mode starts automatically after geolocation is denied or times out", async ({ page }) => {
      await gotoAndWaitForMap(page);
      await expect(page.locator("#demoModeBadge")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("#locationGate")).toBeHidden();
      await expect(page.locator("#inspectorType")).toContainText("Demo mode");
    });

    test("demo mode nearby list is populated from the fixed High Beach location", async ({ page }) => {
      await gotoAndWaitForMap(page);
      await expect(page.locator("#inspectorBody")).toContainText("High Beach Visitor Centre Car Park", { timeout: 15_000 });
      await expect(page.locator("#inspectorBody")).not.toContainText("Use your location");
    });
  });

  test.describe("geolocation granted but too far away", () => {
    test.use({
      geolocation: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      permissions: ["geolocation"],
    });

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page);
    });

    test("distance warning offers demo mode and switches to the fixed High Beach view", async ({ page }) => {
      await expect(page.locator("#distanceWarning")).toBeVisible({ timeout: 15_000 });
      await page.locator("#distanceWarningButton").click();
      await expect(page.locator("#distanceWarning")).toBeHidden();
      await expect(page.locator("#demoModeBadge")).toBeVisible();
      await expect(page.locator("#inspectorType")).toContainText("Demo mode");
    });
  });
});
