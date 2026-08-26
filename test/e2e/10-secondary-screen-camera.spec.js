// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

// A GPS fix inside Epping Forest, reused from 09-location.spec.js
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

// The Filter, Settings, and Feedback screens all show the map in the background and
// must present the same fixed view: zoomed out to show every highlighted (filtered)
// location, with the walking-radius circle visible. Regression coverage for the map
// view changing between these three screens.
test.describe("Secondary screens (Filter, Settings, Feedback) show a consistent map view", () => {
  test.use({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
  });

  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/, { timeout: 10_000 });
  });

  async function readViewport(page) {
    // Let any in-flight camera animation (max ~520ms in this codebase) settle.
    await page.waitForTimeout(900);
    return page.evaluate(() => ({
      scale: state.viewport.scale,
      tx: state.viewport.tx,
      ty: state.viewport.ty,
    }));
  }

  test("filter, settings, and feedback screens converge on the same camera fit", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/, { timeout: 3_000 });
    const filterViewport = await readViewport(page);

    await page.click("#settingsToggle");
    await expect(page.locator("#settingsWalkMins")).toBeVisible({ timeout: 5_000 });
    const settingsViewport = await readViewport(page);

    await page.click("#reportToggle");
    await expect(page.locator("#reportDetails")).toBeVisible({ timeout: 5_000 });
    const feedbackViewport = await readViewport(page);

    const tolerance = 0.5;
    for (const other of [settingsViewport, feedbackViewport]) {
      expect(Math.abs(other.scale - filterViewport.scale)).toBeLessThan(tolerance);
      expect(Math.abs(other.tx - filterViewport.tx)).toBeLessThan(tolerance);
      expect(Math.abs(other.ty - filterViewport.ty)).toBeLessThan(tolerance);
    }
  });

  test("tapping Nearby right after Filters re-fits the tight heading-up zoom even mid-animation", async ({ page }) => {
    // Simulate an active compass so the map is in heading-up "nearby" mode, matching
    // the bug report (only reproduced with phone compass/location active).
    await page.evaluate(() => {
      state.compassHeading = 45;
      state.compassLastEventAt = performance.now();
    });
    const nearbyViewport = await readViewport(page);

    // Open Filters, then tap Nearby again immediately — well inside the 420ms survey-mode
    // zoom-out animation Filters starts — to reproduce the race that used to leave the
    // camera stuck at the Filters-screen zoom indefinitely.
    await page.click("#filterToggle");
    await page.click("#nearbyToggle");

    const settledViewport = await readViewport(page);
    const tolerance = 0.5;
    expect(Math.abs(settledViewport.scale - nearbyViewport.scale)).toBeLessThan(tolerance);
    expect(Math.abs(settledViewport.tx - nearbyViewport.tx)).toBeLessThan(tolerance);
    expect(Math.abs(settledViewport.ty - nearbyViewport.ty)).toBeLessThan(tolerance);
  });

  test("walking radius circle is drawn on all three secondary screens", async ({ page }) => {
    for (const toggleId of ["#filterToggle", "#settingsToggle", "#reportToggle"]) {
      await page.click(toggleId);
      await page.waitForTimeout(300);
      const radiusDrawn = await page.evaluate(() => {
        let arcCount = 0;
        drawWalkingRadius({
          save() {}, restore() {}, beginPath() {},
          arc() { arcCount += 1; },
          fill() {}, stroke() {}, setLineDash() {},
        });
        return arcCount > 0;
      });
      expect(radiusDrawn).toBe(true);
    }
  });
});
