// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

// A GPS fix inside Epping Forest, with plenty of trees on every side of it.
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

/**
 * Point the user at a compass heading, exactly as the orientation handler does, and let the
 * Nearby list settle on it. Drives the real smoothing-loop path (syncNearbyListHeading ->
 * selectOverview) rather than re-rendering the list directly.
 */
async function faceHeading(page, heading) {
  await page.evaluate(async (deg) => {
    state.compassHeadingTarget = deg;
    state.compassHeading = deg;
    state.renderedNavigationHeading = deg;
    state.compassLastEventAt = performance.now();
    refreshNearbyListForHeading();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }, heading);
}

/** The bearing from the user to each item the Nearby list is currently showing, in order. */
function listedBearings(page) {
  return page.evaluate(() => {
    const arrows = Array.from(document.querySelectorAll("#inspectorBody .nearest-arrow[data-item-lat]"));
    return arrows
      .map((arrow) => ({
        latitude: Number(arrow.dataset.itemLat),
        longitude: Number(arrow.dataset.itemLon),
      }))
      .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      .map((item) => bearingDegrees(
        state.userLocation.latitude,
        state.userLocation.longitude,
        item.latitude,
        item.longitude,
      ));
  });
}

/** How far off your heading the listed items sit, on average -- 0 = all dead ahead. */
async function averageOffAxisDegrees(page, heading) {
  const bearings = await listedBearings(page);
  expect(bearings.length, "the Nearby list should be showing items").toBeGreaterThan(2);
  const total = bearings.reduce((sum, bearing) => {
    const delta = Math.abs(((bearing - heading + 540) % 360) - 180);
    return sum + (180 - delta);
  }, 0);
  return total / bearings.length;
}

test.describe("Heads-up Nearby list", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await page.evaluate(() => {
      const gate = document.getElementById("locationGate");
      if (gate && !gate.hidden) gate.hidden = true;
    });
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 10_000 });
  });

  test("the list leans toward whatever you are facing, and follows you round as you turn", async ({ page }) => {
    // The listed finds should be the ones you are walking into, not just the ones that happen
    // to be closest: turning on the spot has to re-rank them behind you.
    // Baseline: no heading at all, so the list is in plain nearest-first order.
    await page.evaluate(() => {
      state.compassHeading = null;
      state.compassHeadingTarget = null;
      state.nearbyListHeading = null;
      selectOverview();
    });
    const unordered = await averageOffAxisDegrees(page, 0);

    await faceHeading(page, 0);
    const facingNorth = await averageOffAxisDegrees(page, 0);
    expect(facingNorth, "facing north should pull the list toward the north").toBeGreaterThan(unordered);

    await faceHeading(page, 180);
    const facingSouth = await averageOffAxisDegrees(page, 180);
    const stillNorth = await averageOffAxisDegrees(page, 0);
    expect(facingSouth, "turning round should pull the list toward the south").toBeGreaterThan(stillNorth);
  });

  test("a small sway does not reshuffle the list under your thumb", async ({ page }) => {
    await faceHeading(page, 90);
    const settled = await listedBearings(page);

    // Well inside HEADS_UP_REORDER_DEGREES: the compass is smoothed but never still, and the
    // list must not churn on that.
    await faceHeading(page, 95);
    expect(await listedBearings(page)).toEqual(settled);
  });

  test("with no compass the list is still ordered nearest-first", async ({ page }) => {
    // Desktop, or a phone with location but no orientation: heads-up ordering simply does not
    // apply and the list falls back to plain distance.
    const distances = await page.evaluate(() => {
      state.compassHeading = null;
      state.compassHeadingTarget = null;
      state.nearbyListHeading = null;
      selectOverview();
      return Array.from(document.querySelectorAll("#inspectorBody .nearest-arrow[data-item-lat]")).map((arrow) =>
        distanceMetres(
          state.userLocation.latitude,
          state.userLocation.longitude,
          Number(arrow.dataset.itemLat),
          Number(arrow.dataset.itemLon),
        ));
    });

    expect(distances.length).toBeGreaterThan(2);
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i], `item ${i} should not be closer than item ${i - 1}`).toBeGreaterThanOrEqual(distances[i - 1] - 0.5);
    }
  });
});
