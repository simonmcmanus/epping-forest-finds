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
      // Navigate to a tree and check that distance is shown
      await page.click("#treeSearchToggle");
      await page.fill("#treeSearchInput", "11383");
      await page.click("#treeSearchButton");
      // Inspector body should show something like "X min walk" or "Xm"
      await expect(page.locator("#inspectorBody")).toContainText(/\d/, { timeout: 5_000 });
    });

    test("snapshot: map with user location active", async ({ page }) => {
      await page.waitForTimeout(800);
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
