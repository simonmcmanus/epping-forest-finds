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

  // The ring can be resized from these screens (the Settings slider, and the pinch/wheel
  // gesture that engages behind all of them), so what it holds has to follow it here exactly
  // as it does on Nearby. It used to not: these screens built their own radius-blind icon set,
  // and moving the slider redrew the circle with the same pins inside it.
  test("resizing the walking radius from the Settings screen re-derives the highlighted locations", async ({ page }) => {
    await page.click("#settingsToggle");
    await expect(page.locator("#settingsWalkMins")).toBeVisible();

    // Reads what the map is highlighting, keyed so the two rounds can be compared, plus the
    // furthest in-radius item so "everything highlighted is inside the ring" can be checked.
    const readHighlights = () => page.evaluate(() => {
      const lookup = buildNearbyIconLookup();
      const origin = nearbyOrigin();
      const keys = [];
      let furthestInRadius = 0;
      for (const type of ["tree", "landmark", "cow"]) {
        for (const item of lookup[type]) {
          if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) continue;
          keys.push(`${type}:${item.latitude},${item.longitude}`);
          if (lookup.outOfRadius.has(item)) continue;
          const metres = distanceMetres(origin.latitude, origin.longitude, item.latitude, item.longitude);
          if (metres > furthestInRadius) furthestInRadius = metres;
        }
      }
      return {
        keys,
        furthestInRadius,
        radiusMetres: walkingDistanceToMetres(state.walkingDistanceMinutes),
      };
    });

    // Drive the slider itself rather than the state behind it: the "input" handler is the
    // path a dragging finger takes.
    const setRadius = (minutes) => page.evaluate((value) => {
      const range = document.getElementById("settingsWalkMins");
      range.value = String(value);
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    }, minutes);

    await setRadius(15);
    const wide = await readHighlights();
    await setRadius(3);
    const tight = await readHighlights();

    expect(wide.keys.length, "fixture sanity: the wide ring highlights something").toBeGreaterThan(0);
    expect(
      wide.furthestInRadius,
      "everything highlighted inside the ring is actually inside the ring",
    ).toBeLessThanOrEqual(wide.radiusMetres);
    expect(tight.furthestInRadius).toBeLessThanOrEqual(tight.radiusMetres);
    expect(
      wide.furthestInRadius,
      "the wide ring reaches further than the tight one, so the two sets are genuinely different",
    ).toBeGreaterThan(tight.furthestInRadius);
    expect(
      tight.keys.some((key) => !wide.keys.includes(key)) || wide.keys.some((key) => !tight.keys.includes(key)),
      "shrinking the radius changes which locations are highlighted",
    ).toBe(true);
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
