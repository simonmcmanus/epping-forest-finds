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
      await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    });

    test("the location gate is not shown when geolocation is pre-granted", async ({ page }) => {
      await expect(page.locator("#locationGate")).toBeHidden();
    });

    test("distance info appears as an always-visible combined distance and walk chip after a GPS fix", async ({ page }) => {
      // Navigate to a tree via URL hash (tree search toggle is hidden on desktop viewports)
      await page.goto("/app#tree=11383");
      await page.waitForFunction(
        () => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; },
        { timeout: 30_000 }
      );
      await page.evaluate(() => { const g = document.getElementById("locationGate"); if (g && !g.hidden) g.hidden = true; });
      const walkChip = page.locator("#inspectorBody .walk-chip").first();
      await expect(walkChip).toHaveCount(1);
      await expect(walkChip).toContainText(/\b(?:\d+\s*m|\d+(?:\.\d+)?\s*km)\s*·\s*(?:<\s*1\s*min|\d+\s*min|\d+h(?:\s*\d+min)?)/);
      await expect(page.locator("#inspectorBody .walk-chip-btn")).toHaveCount(0);
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
    // No geolocation permission granted, so denyGeolocationUnlessGranted (see
    // helpers.js) answers the request with PERMISSION_DENIED straight away.

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
    });

    test("location gate is shown after geolocation is denied or times out", async ({ page }) => {
      await gotoAndWaitForMap(page);
      // The location gate should become visible once the error/timeout path runs
      await expect(page.locator("#locationGate")).toBeVisible();
    });

    test("location gate button re-enables after the gate re-appears", async ({ page }) => {
      await gotoAndWaitForMap(page);
      await expect(page.locator("#locationGateButton")).toBeEnabled();
    });
  });

  test.describe("the location request never answers", () => {
    // The hard case, and the real-world one: a permission prompt sitting
    // unanswered on the screen. The Geolocation API's own `timeout` option does
    // not start counting until the permission decision is made, so the request
    // calls back neither way — not success, not error, not ever. Boot waits for
    // that request before revealing the map, so it needs a bound of its own or
    // the map never appears at all.
    //
    // These two wait out that whole bound on top of the normal data load, so
    // they get more room than the 60s every other test runs under.
    test.describe.configure({ timeout: 90_000 });

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await page.addInitScript(() => {
        // Registered before the helper's stub, so this one wins.
        window.__forestFindsGeolocationStubbed = true;
        navigator.geolocation.getCurrentPosition = () => {};
      });
    });

    test("the map still opens when the location request never calls back", async ({ page }) => {
      // Deliberately sits through the whole BOOT_LOCATION_TIMEOUT_MS bound on top
      // of the normal data load, so it needs more room than the default wait.
      await gotoAndWaitForMap(page, "/app", { timeout: 45_000 });
      await expect(page.locator("#mapCanvas")).toBeVisible();
    });

    test("and the gate offers a retry rather than leaving the reader stuck", async ({ page }) => {
      await gotoAndWaitForMap(page, "/app", { timeout: 45_000 });
      await expect(page.locator("#locationGate")).toBeVisible();
      await expect(page.locator("#locationGateButton")).toBeEnabled();
    });
  });
});
