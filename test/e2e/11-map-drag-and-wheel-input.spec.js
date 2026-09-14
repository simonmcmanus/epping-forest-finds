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
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/, { timeout: 10_000 });
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
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
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/, { timeout: 10_000 });
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

// Regression coverage for zoomAt() applying a raw pointer-anchored zoom before deferring
// to alignHeadingUpNavigationViewport(): the pan always snapped back to the heading-up
// anchor, but the scale from the raw multiply could survive depending on timing, so wheel
// input didn't reliably zoom toward the cursor or settle at a predictable value. Heading-up
// mode should treat wheel input the same as drag: just re-run the locked fit (spec:
// "Drag, zoom, resize, compass changes ... all re-fit the overview targets via
// alignHeadingUpNavigationViewport()").
test.describe("Wheel input while heading-up is active", () => {
  test.use({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
  });

  test("wheel-zoom re-fits to the heading-up view instead of applying a raw pointer-anchored zoom", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/, { timeout: 10_000 });
    await page.evaluate(() => {
      state.compassHeading = 90;
      state.compassHeadingTarget = 90;
      alignHeadingUpNavigationViewport({ force: true });
    });
    await page.waitForTimeout(50);
    const referenceScale = await page.evaluate(() => state.viewport.scale);

    const box = await page.locator("#mapCanvas").boundingBox();
    // Wheel near a corner, far from the user's on-screen anchor point, so a raw
    // pointer-anchored zoom (the pre-fix behaviour) would move the viewport away from
    // the locked fit.
    await page.mouse.move(box.x + 15, box.y + 15);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(50);
    const afterZoomIn = await page.evaluate(() => state.viewport.scale);

    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(50);
    const afterZoomOut = await page.evaluate(() => state.viewport.scale);

    // Locked to the heading-up fit: the resulting scale is the same regardless of scroll
    // direction, because wheel input just re-triggers the fit rather than applying `factor`.
    expect(Math.abs(afterZoomIn - referenceScale)).toBeLessThan(referenceScale * 0.001);
    expect(Math.abs(afterZoomOut - referenceScale)).toBeLessThan(referenceScale * 0.001);
  });
});
