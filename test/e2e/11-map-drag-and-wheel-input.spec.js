// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap, FIXTURE_TREE } = require("./helpers");

// A GPS fix inside Epping Forest, reused from 09-location.spec.js / 10-secondary-screen-camera.spec.js.
// Genuinely inside the forest boundary polygon (see data/epping-forest-land.geojson), so
// checkDistanceToForest() never shows the "not near the forest" banner for these tests.
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

async function dragCanvas(page, from, to, steps = 4) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several intermediate steps so pointermove fires more than once, like a real drag.
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  }
  await page.mouse.up();
}

// Regression coverage for a bug where dragging the map while the camera auto-repositions
// (a selected navigation target with the inspector expanded, or heading-up mode) was
// indistinguishable from a stationary tap once the pointer lifted. state.moved was only
// ever set inside the plain-pan branch of the pointermove handler in js/nav.js; the
// heading-up and auto-reposition branches returned early without touching it. So after a
// real drag in either mode, pointerup's `wasClick = !state.moved` was still true and fired
// handleMapClick -- selecting whatever was under the release point, or resetting the camera
// via goToInitialView() -- even though the user only meant to pan or inspect the map.
test.describe("Map drag input while camera auto-repositions", () => {
  test.use({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
  });

  test("dragging while auto-repositioning to a selected target keeps the selection", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, `/#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    // Desktop viewport (see playwright.config.js) keeps the inspector expanded after a
    // selection, so shouldAutoRepositionSelection() is active during this drag.
    await expect(page.locator("#inspector")).not.toHaveClass(/minimized/);
    const autoRepositioning = await page.evaluate(() => shouldAutoRepositionSelection());
    expect(autoRepositioning).toBe(true);

    const box = await page.locator("#mapCanvas").boundingBox();
    await dragCanvas(
      page,
      { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 },
      { x: box.x + box.width * 0.7, y: box.y + box.height * 0.6 }
    );

    const after = await page.evaluate(() => ({
      moved: state.moved,
      selectedType: state.selected && state.selected.type,
    }));
    expect(after.moved).toBe(true);
    expect(after.selectedType).toBe("tree");
    // Previously this drag fell through to handleMapClick -> goToInitialView(), reverting
    // the inspector to the Nearby overview instead of leaving the tree selected.
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
  });

  test("dragging in nearby heading-up mode does not register as a stationary tap", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await page.evaluate(() => {
      state.compassHeading = 90;
      state.compassHeadingTarget = 90;
      alignHeadingUpNavigationViewport({ force: true });
    });
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => headingUpActive())).toBe(true);

    const box = await page.locator("#mapCanvas").boundingBox();
    await dragCanvas(
      page,
      { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25 },
      { x: box.x + box.width * 0.75, y: box.y + box.height * 0.7 }
    );

    const after = await page.evaluate(() => ({ moved: state.moved, selected: state.selected }));
    expect(after.moved).toBe(true);
    // No pin should have been picked up by a spurious click at the release point, and the
    // overview should not have been reset by an unwanted goToInitialView() call.
    expect(after.selected).toBeNull();
    await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
  });
});

// The wheel is a laptop's version of the phone's two-finger radius pinch: on every screen that
// draws the walking-radius ring it resizes that ring, and the camera follows because the Nearby
// fit frames the ring and nothing else. It must never apply a raw pointer-anchored zoom on top
// of that -- the original bug here was zoomAt() multiplying the scale before deferring to
// alignHeadingUpNavigationViewport(), so wheel input settled at an unpredictable value.
test.describe("Wheel and trackpad input on the Nearby screen", () => {
  test.use({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
  });

  async function openNearbyHeadingUp(page) {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await page.evaluate(() => {
      state.compassHeading = 90;
      state.compassHeadingTarget = 90;
      alignHeadingUpNavigationViewport({ force: true });
    });
    return page.locator("#mapCanvas").boundingBox();
  }

  // The radius gesture ends on a timeout and settles the camera with an animation, so the scale
  // is only meaningful once it has stopped moving.
  async function settledScale(page) {
    let previous = null;
    await expect.poll(async () => {
      const scale = await page.evaluate(() => state.viewport.scale);
      const stable = previous !== null && Math.abs(scale - previous) < previous * 0.0005;
      previous = scale;
      return stable;
    }).toBe(true);
    return previous;
  }

  test("scrolling the wheel zooms by resizing the walking radius, both ways", async ({ page }) => {
    const box = await openNearbyHeadingUp(page);
    const before = await page.evaluate(() => state.walkingDistanceMinutes);
    const beforeScale = await settledScale(page);

    // Well away from the user's on-screen anchor point (but still over the map, not the chrome
    // around it): a raw pointer-anchored zoom would move the viewport away from the ring's own
    // fit, while resizing the ring does not care where the cursor is.
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.mouse.wheel(0, -600);

    await expect.poll(() => page.evaluate(() => state.walkingDistanceMinutes)).toBeLessThan(before);
    const zoomedInScale = await settledScale(page);
    expect(zoomedInScale).toBeGreaterThan(beforeScale);

    // The camera is the ring's locked fit, not a raw multiply: re-running that fit moves nothing.
    const refit = await page.evaluate(() => {
      alignHeadingUpNavigationViewport({ force: true });
      return state.viewport.scale;
    });
    expect(Math.abs(refit - zoomedInScale)).toBeLessThan(zoomedInScale * 0.01);

    // And scrolling the other way widens the ring again.
    const tight = await page.evaluate(() => state.walkingDistanceMinutes);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => state.walkingDistanceMinutes)).toBeGreaterThan(tight);
    expect(await settledScale(page)).toBeLessThan(zoomedInScale);
  });

  test("a laptop trackpad pinch resizes the radius the same way", async ({ page }) => {
    const box = await openNearbyHeadingUp(page);
    const before = await page.evaluate(() => state.walkingDistanceMinutes);

    // Every desktop browser reports a trackpad pinch as a wheel with ctrlKey set, in deltas far
    // smaller than a wheel notch -- which is why the gesture accumulates its own running value.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    for (let i = 0; i < 8; i += 1) await page.mouse.wheel(0, -8);
    await page.keyboard.up("Control");

    await expect.poll(() => page.evaluate(() => state.walkingDistanceMinutes)).toBeLessThan(before);
  });

  test("with a location selected the wheel still zooms the map itself", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, `/#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);

    // The hash deep-link forces the inspector open and animates the camera to fit user + target
    // (~520ms), so the scale here is still in transit. Read raw, before.scale can catch a
    // mid-animation value well above where the camera settles -- CI caught 36386 against a
    // settled 17470 -- and the wheel's zoom-in from the settled scale then never exceeds it.
    // Same settling the sibling wheel tests above already use.
    const before = {
      minutes: await page.evaluate(() => state.walkingDistanceMinutes),
      scale: await settledScale(page),
    };
    const box = await page.locator("#mapCanvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);

    await expect.poll(() => page.evaluate(() => state.viewport.scale)).toBeGreaterThan(before.scale);
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(before.minutes);
  });
});
