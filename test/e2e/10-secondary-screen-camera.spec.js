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
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
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
    await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);
    const filterViewport = await readViewport(page);

    await page.click("#settingsToggle");
    await expect(page.locator("#settingsWalkMins")).toBeVisible();
    const settingsViewport = await readViewport(page);

    await page.click("#reportToggle");
    await expect(page.locator("#reportDetails")).toBeVisible();
    const feedbackViewport = await readViewport(page);

    const tolerance = 0.5;
    for (const other of [settingsViewport, feedbackViewport]) {
      expect(Math.abs(other.scale - filterViewport.scale)).toBeLessThan(tolerance);
      expect(Math.abs(other.tx - filterViewport.tx)).toBeLessThan(tolerance);
      expect(Math.abs(other.ty - filterViewport.ty)).toBeLessThan(tolerance);
    }
  });

  test("the filter screen zooms out to reach the nearest match of every selected filter, even outside the walking radius", async ({ page }) => {
    // The Nearby screen frames the walking-radius circle alone. The filter screen is where you
    // choose what you are looking for, so it has to show that the nearest match of each
    // selected kind exists at all and which way it lies -- however far outside the radius that
    // is. Previously the ring was a hard floor on the fit, so an out-of-radius match simply
    // stayed off the map.
    const before = await readViewport(page);

    const result = await page.evaluate(async () => {
      state.overviewFilters = ["pubs", "ponds_streams", "waymarked_trails"];
      openFiltersScreen();
      // The inspector's max-height transition changes how much map area is left, and the fit is
      // solved against that area -- so let it settle before fitting, or the fit is computed for
      // a taller map than the one we then measure against.
      await new Promise((resolve) => setTimeout(resolve, 500));
      stopViewportAnimation();
      ensureOverviewTargetsVisible({ force: true });

      const { latitude, longitude, point: originPoint } = state.userLocation;
      const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
      // Ask the app which filters it considers active rather than assuming the raw
      // state.overviewFilters entries map one-to-one onto point-filter keys.
      const reached = getActivePointFilterKeys()
        .map((key) => ({ key, entry: nearestOverviewEntryForFilter(key, latitude, longitude) }))
        .map(({ key, entry }) => ({ key, entry, point: nearestFitPointForEntry(entry, originPoint) }))
        .filter(({ point }) => Boolean(point));

      // Measured against the same rect the fit itself used.
      const rect = bestVisibleCanvasRect();
      const inside = (point) => {
        const screen = worldToScreen(point);
        return screen.x >= rect.x && screen.x <= rect.x + rect.width
          && screen.y >= rect.y && screen.y <= rect.y + rect.height;
      };

      return {
        reachedCount: reached.length,
        outsideRadiusCount: reached.filter(({ entry }) => entry.metres > radiusMetres).length,
        offScreen: reached.filter(({ point }) => !inside(point)).map(({ key }) => key),
        ringOffScreen: walkingRadiusCirclePoints().filter((point) => !inside(point)).length,
        scale: state.viewport.scale,
      };
    });

    expect(result.reachedCount).toBeGreaterThan(0);
    expect(result.outsideRadiusCount, "fixture sanity: at least one selected filter's nearest match is outside the walking radius").toBeGreaterThan(0);
    expect(result.offScreen, "every selected filter's nearest match should be on the map").toEqual([]);
    expect(result.ringOffScreen, "the walking-radius ring stays fully framed too").toBe(0);
    expect(result.scale, "reaching an out-of-radius match must zoom out, not in").toBeLessThan(before.scale);
  });

  test("walking radius circle is drawn on all three secondary screens", async ({ page }) => {
    for (const toggleId of ["#filterToggle", "#settingsToggle", "#reportToggle"]) {
      await page.click(toggleId);
      await page.waitForTimeout(300);
      const radiusDrawn = await page.evaluate(() => {
        let arcCount = 0;
        drawWalkingRadius({
          save() {}, restore() {}, beginPath() {}, closePath() {}, rect() {},
          arc() { arcCount += 1; },
          fill() {}, fillRect() {}, stroke() {}, setLineDash() {},
          createRadialGradient() { return { addColorStop() {} }; },
        });
        return arcCount > 0;
      });
      expect(radiusDrawn).toBe(true);
    }
  });
});
