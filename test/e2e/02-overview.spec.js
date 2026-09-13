// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.665, longitude: 0.045, accuracy: 10 };

// Fires trusted-enough PointerEvents directly at the map canvas to drive the pinch handlers in
// js/nav.js. setPointerCapture/releasePointerCapture throw for a synthetic (non-active) pointer
// id, so they're stubbed here -- harmless, since the pinch logic itself never depends on real
// capture behaviour, only on the pointerdown/pointermove/pointerup sequence.
async function firePinch(page, { startHalfGap, endHalfGap, step = 10 }) {
  await page.evaluate(({ startHalfGap, endHalfGap, step }) => {
    const canvas = els.canvas;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fire = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: "touch",
    }));
    const direction = endHalfGap >= startHalfGap ? step : -step;
    fire("pointerdown", 1001, cx - startHalfGap, cy);
    fire("pointerdown", 1002, cx + startHalfGap, cy);
    for (let gap = startHalfGap + direction; direction > 0 ? gap <= endHalfGap : gap >= endHalfGap; gap += direction) {
      fire("pointermove", 1001, cx - gap, cy);
      fire("pointermove", 1002, cx + gap, cy);
    }
    fire("pointerup", 1001, cx - endHalfGap, cy);
    fire("pointerup", 1002, cx + endHalfGap, cy);
  }, { startHalfGap, endHalfGap, step });
}

test.describe("Overview / Nearby screen", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("inspector title reads 'Nearby' in overview mode", async ({ page }) => {
    // selectOverview() sets inspectorTitle to "Nearby"
    await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
  });

  test("inspector body prompts for location when GPS is not available", async ({ page }) => {
    // Without geolocation, overviewNearestHtml() returns an empty-state message
    await expect(page.locator("#inspectorBody .empty")).toBeVisible({ timeout: 5_000 });
  });

  test.describe("with mocked GPS inside the forest", () => {
    test.use({
      geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 },
      permissions: ["geolocation"],
    });

    test("inspector body shows nearest items when location is available", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });
    });

    test("nearby entries show a combined distance and walk-time chip", async ({ page }) => {
      await setup(page);
      const walkChip = page.locator("#inspectorBody .nearest-item .walk-chip").first();
      await expect(walkChip).toBeVisible({ timeout: 15_000 });
      await expect(walkChip).toContainText(/\b(?:\d+\s*m|\d+(?:\.\d+)?\s*km)\s*·\s*(?:<\s*1\s*min|\d+\s*min|\d+h(?:\s*\d+min)?)/);
    });
  });

  test("nearby list does not contain the walking distance selector", async ({ page }) => {
    await expect(page.locator("#inspectorBody #settingsWalkMins")).toHaveCount(0);
  });

  test("nearby list does not show the app version", async ({ page }) => {
    await expect(page.locator("#inspectorBody #appVersionDisplay")).toHaveCount(0);
  });

  test("filter toggle button is visible in overview mode", async ({ page }) => {
    await expect(page.locator("#filterToggle")).toBeVisible();
  });

  test("settings button is visible in overview mode", async ({ page }) => {
    await expect(page.locator("#settingsToggle")).toBeVisible();
  });

  test("feedback button is visible in overview mode", async ({ page }) => {
    await expect(page.locator("#reportToggle")).toBeVisible();
  });

  test("snapshot: overview state", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
    await page.waitForTimeout(400);
    await page.evaluate(() => { stopViewportAnimation(); state.emojiScaleAnimated = zoomEmojiScaleTarget(); draw(); });
    await page.waitForTimeout(50);
    await expect(page).toHaveScreenshot("overview.png", { fullPage: false });
  });

  test.describe("Browsing another spot", () => {
    test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

    test("tapping empty space outside the walking radius previews that spot instead of resetting to overview", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      // The camera fit is item-based, not radius-based (see spec-data-rendering.md), so how
      // much empty, out-of-radius canvas is actually visible varies with the live dataset,
      // viewport shape, and in-flight GPS-follow animations -- searching screen pixels for a
      // safe click target is exactly the kind of geometry-dependent flakiness this app's own
      // tilt/heading-up e2e specs avoid by driving the underlying function directly instead of
      // simulating the real-world input that would trigger it. A point ~5.5km away (0.05
      // degrees) is unambiguously outside any walking-radius option (max 30 min ≈ 2.5km)
      // regardless of where the camera currently happens to be pointed.
      const after = await page.evaluate(() => {
        const origin = nearbyOrigin();
        const lonLat = { latitude: origin.latitude + 0.05, longitude: origin.longitude + 0.05 };
        const world = projectLonLat(lonLat.longitude, lonLat.latitude);
        const related = isOverviewScreenActive() && trySetNearbyAnchorFromClick(lonLat, world);
        return { related, hasAnchor: state.nearbyAnchor !== null, selected: state.selected };
      });
      expect(after.related, "trySetNearbyAnchorFromClick should have handled the click").toBe(true);
      expect(after.hasAnchor).toBe(true);
      expect(after.selected).toBeNull();

      await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
    });

    test("'Use my location' clears the browse anchor and restores the real nearest list", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      await page.evaluate(() => {
        const origin = state.userLocation;
        // Well outside any walking-radius option, so the anchor's own list clearly differs
        // from the real-location list.
        const latitude = origin.latitude + 0.02;
        const longitude = origin.longitude;
        setNearbyAnchor(latitude, longitude, projectLonLat(longitude, latitude));
      });
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();

      await page.click("[data-action='reset-nearby-anchor']");

      await expect(page.locator("[data-action='reset-nearby-anchor']")).toHaveCount(0);
      expect(await page.evaluate(() => state.nearbyAnchor)).toBeNull();
    });
  });

  test.describe("Camera framing", () => {
    test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

    // The Nearby camera frames the walking-radius circle and nothing else. Earlier designs
    // fitted the nearby item cluster, so the camera chased whichever matches happened to be
    // nearest: zoomed in past the ring and clipped it when they were clustered close, zoomed
    // out past it when one sat near the edge.
    async function measureRing(page) {
      await page.waitForFunction(() => Boolean(state.userLocation), { timeout: 15_000 });
      await page.waitForTimeout(900); // let the reveal animation settle
      return page.evaluate(() => {
        stopViewportAnimation();
        const rect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
        const user = worldToScreen(nearbyOrigin().point);
        const ring = walkingRadiusCirclePoints().map((p) => worldToScreen(p));
        const outside = ring.filter((s) => (
          s.x < rect.x || s.x > rect.x + rect.width || s.y < rect.y || s.y > rect.y + rect.height
        )).length;
        const radiusPx = walkingRadiusWorldUnits() * state.viewport.scale;
        const corners = [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.width, y: rect.y },
          { x: rect.x, y: rect.y + rect.height },
          { x: rect.x + rect.width, y: rect.y + rect.height },
        ];
        return {
          outside,
          cornersInsideRing: corners.filter((c) => Math.hypot(c.x - user.x, c.y - user.y) <= radiusPx).length,
          widthFraction: (radiusPx * 2) / rect.width,
          heightFraction: (radiusPx * 2) / rect.height,
          scale: state.viewport.scale,
        };
      });
    }

    test("the whole walking-radius circle is on screen, and the four corners fall outside it", async ({ page }) => {
      await setup(page);
      const ring = await measureRing(page);

      expect(ring.outside).toBe(0);
      expect(ring.cornersInsideRing).toBe(0);
      // Framed, not merely contained: the circle fills most of the smaller screen dimension.
      expect(Math.min(ring.widthFraction, ring.heightFraction)).toBeGreaterThan(0.6);
      expect(Math.max(ring.widthFraction, ring.heightFraction)).toBeLessThanOrEqual(1);
    });

    test("the zoom does not change as the compass heading turns", async ({ page }) => {
      // A circle centred on the user looks the same from every heading, so the fit is
      // heading-invariant by construction and the map must not breathe as you turn on the spot.
      await setup(page);
      await page.waitForFunction(() => Boolean(state.userLocation), { timeout: 15_000 });
      await page.waitForTimeout(900);

      const scales = await page.evaluate(() => {
        const out = [];
        for (const heading of [0, 37, 90, 180, 271]) {
          state.compassHeading = heading;
          state.compassHeadingTarget = heading;
          state.renderedNavigationHeading = heading;
          state.compassLastEventAt = null;
          state.headingUpScaleEaseAt = null;
          stopViewportAnimation();
          alignHeadingUpNavigationViewport({ force: true });
          out.push(state.viewport.scale);
        }
        return out;
      });

      const spread = (Math.max(...scales) - Math.min(...scales)) / Math.min(...scales);
      expect(spread).toBeLessThan(0.005);
    });

    test("a settled compass frame reports no viewport change, so nothing is redrawn", async ({ page }) => {
      // "It doesn't need to re-render the things in the circle unless the circle moves": once
      // the fit has landed, the per-frame compass tick must be a no-op for the viewport.
      await setup(page);
      await page.waitForFunction(() => Boolean(state.userLocation), { timeout: 15_000 });
      await page.waitForTimeout(900);

      const changedOnRepeat = await page.evaluate(() => {
        state.compassHeading = 90;
        state.compassHeadingTarget = 90;
        state.renderedNavigationHeading = 90;
        state.compassLastEventAt = null;
        stopViewportAnimation();
        alignHeadingUpNavigationViewport({ force: true });
        return alignHeadingUpNavigationViewport();
      });

      expect(changedOnRepeat).toBe(false);
    });
  });

  test.describe("Pinch to resize the walking radius", () => {
    test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

    test("spreading two fingers apart shrinks the radius; pinching together grows it", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      const before = await page.evaluate(() => state.walkingDistanceMinutes);
      await firePinch(page, { startHalfGap: 20, endHalfGap: 140 });
      const shrunk = await page.evaluate(() => state.walkingDistanceMinutes);
      expect(shrunk).toBeLessThan(before);

      // A pinch must never be mistaken for a tap: no stray selection/reset, and every
      // pointer is fully released.
      const afterShrink = await page.evaluate(() => ({ selected: state.selected, activePointers: state.activePointers.size }));
      expect(afterShrink.selected).toBeNull();
      expect(afterShrink.activePointers).toBe(0);
      await expect(page.locator("#inspectorTitle")).toContainText("Nearby");

      await firePinch(page, { startHalfGap: 140, endHalfGap: 20 });
      const grown = await page.evaluate(() => state.walkingDistanceMinutes);
      expect(grown).toBeGreaterThan(shrunk);
    });

    test("pinching well past the floor pins the radius there and shows a visual limit", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      // Inspects state mid-gesture (before the fingers lift) by dispatching the pointer
      // sequence inline rather than through firePinch, which only returns once the gesture --
      // and its "settle" reset of state.walkingRadiusAtFloor -- has already finished.
      const result = await page.evaluate(() => {
        const canvas = els.canvas;
        canvas.setPointerCapture = () => {};
        canvas.releasePointerCapture = () => {};
        const rect = canvas.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const fire = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: "touch",
        }));
        fire("pointerdown", 1001, cx - 20, cy);
        fire("pointerdown", 1002, cx + 20, cy);
        // 20 -> 600 is a 30x spread, driving the requested radius far below any real item's
        // distance regardless of the live dataset, so this reliably overshoots the floor.
        for (let gap = 30; gap <= 600; gap += 10) {
          fire("pointermove", 1001, cx - gap, cy);
          fire("pointermove", 1002, cx + gap, cy);
        }
        const mid = {
          minutes: state.walkingDistanceMinutes,
          floor: walkingRadiusFloorMinutes(nearbyOrigin()),
          atFloor: state.walkingRadiusAtFloor,
          noticeVisible: Boolean(document.querySelector(".walk-radius-floor-notice")),
        };
        fire("pointerup", 1001, cx - 600, cy);
        fire("pointerup", 1002, cx + 600, cy);
        return { mid, afterAtFloor: state.walkingRadiusAtFloor };
      });

      expect(result.mid.atFloor).toBe(true);
      expect(result.mid.noticeVisible).toBe(true);
      expect(result.mid.minutes).toBeGreaterThanOrEqual(result.mid.floor);
      // Pinned at the floor, not merely clamped somewhere above it.
      expect(result.mid.minutes).toBeLessThan(result.mid.floor + 1);

      // The notice is transient -- releasing the gesture clears it again.
      expect(result.afterAtFloor).toBe(false);
      await expect(page.locator(".walk-radius-floor-notice")).toHaveCount(0);
    });

    test("pinching is ignored while a real selection is open", async ({ page }) => {
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
      await page.waitForFunction(
        (name) => document.getElementById("inspectorTitle")?.textContent?.includes(name),
        FIXTURE_TREE.commonName,
        { timeout: 10_000 }
      );

      const before = await page.evaluate(() => state.walkingDistanceMinutes);
      await firePinch(page, { startHalfGap: 20, endHalfGap: 150 });

      // Pinch being ignored means none of the radius-changing code ran at all, so the
      // selection needs no settling time -- check state directly rather than the rendered DOM
      // title, which can lag behind for unrelated transition-timing reasons on some devices.
      const after = await page.evaluate(() => ({
        minutes: state.walkingDistanceMinutes,
        selectedType: state.selected && state.selected.type,
      }));
      expect(after.minutes).toBe(before);
      expect(after.selectedType).toBe("tree");
    });
  });
});
