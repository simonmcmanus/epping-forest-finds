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
    await expect(page.locator("#inspectorBody .empty")).toBeVisible();
  });

  test.describe("with mocked GPS inside the forest", () => {
    test.use({
      geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 },
      permissions: ["geolocation"],
    });

    test("inspector body shows nearest items when location is available", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
    });

    test("the list heading says how far it is reaching, not just what it is listing", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      // One filter selected: the heading has room to name both the kind and the radius, which
      // is the question a walker is actually asking ("what can I get to in five minutes?").
      await page.evaluate(() => {
        state.walkingDistanceMinutes = 5;
        setOverviewFilters(["trees"]);
        selectOverview();
      });

      await expect(page.locator("#inspectorBody .nearby-heading strong"))
        .toHaveText(/Trees within 5 min walk/i);
    });

    test("nearby entries show a combined distance and walk-time chip", async ({ page }) => {
      await setup(page);
      const walkChip = page.locator("#inspectorBody .nearest-item .walk-chip").first();
      await expect(walkChip).toBeVisible();
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

    test("tapping open map ground previews that spot instead of resetting to overview", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      // Which screen pixels are open ground (rather than a pin or a road) varies with the live
      // dataset, viewport shape, and in-flight GPS-follow animations -- hunting for a safe click
      // target is exactly the kind of geometry-dependent flakiness this app's own tilt/heading-up
      // e2e specs avoid by driving the underlying function directly instead of simulating the
      // real-world input that would trigger it.
      const after = await page.evaluate(() => {
        const origin = nearbyOrigin();
        const lonLat = { latitude: origin.latitude + 0.002, longitude: origin.longitude + 0.002 };
        const world = projectLonLat(lonLat.longitude, lonLat.latitude);
        const related = isOverviewScreenActive() && focusNearbyOnMapPoint(lonLat, world);
        return { related, hasAnchor: state.nearbyAnchor !== null, selected: state.selected };
      });
      expect(after.related, "focusNearbyOnMapPoint should have handled the tap").toBe(true);
      expect(after.hasAnchor).toBe(true);
      expect(after.selected).toBeNull();

      await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
    });

    test("tapping open map ground while a tree is selected returns to nearby, focused on that spot", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      await page.evaluate((hashKey) => {
        const tree = findTreeByHashKey(hashKey);
        state.selected = { type: "tree", item: tree };
        showTreeDetails(tree, distanceFromUser(tree), "Tree record");
      }, FIXTURE_TREE.hashKey);
      // transitionInspectorBody() briefly renders two #inspectorTitle elements during the slide
      // animation; getElementById (first match) avoids Playwright's strict-mode violation.
      await page.waitForFunction(
        (name) => document.getElementById("inspectorTitle")?.textContent?.includes(name),
        FIXTURE_TREE.commonName
      );

      const tapped = await page.evaluate(() => {
        const lonLat = { latitude: state.userLocation.latitude + 0.003, longitude: state.userLocation.longitude + 0.003 };
        focusNearbyOnMapPoint(lonLat, projectLonLat(lonLat.longitude, lonLat.latitude));
        return { selected: state.selected, anchor: state.nearbyAnchor, expected: lonLat };
      });

      expect(tapped.selected, "the selection is dropped for nearby mode").toBeNull();
      expect(tapped.anchor.latitude).toBeCloseTo(tapped.expected.latitude, 6);
      await page.waitForFunction(
        () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby")
      );
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
    });

    test("'Use my location' clears the browse anchor and restores the real nearest list", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

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

      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeHidden();
      expect(await page.evaluate(() => state.nearbyAnchor)).toBeNull();
    });
  });

  // Filters, Settings and Report all keep drawing the walking-radius ring around the browse
  // anchor behind them, so everything that removes or adjusts that ring has to work from them
  // too -- otherwise opening one of the three strands the user on a browsed spot with nothing
  // on screen offering to undo it.
  test.describe("Adjusting the browsed spot from Filters, Settings and Report", () => {
    test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

    test.beforeEach(async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
      await page.evaluate(() => {
        const latitude = state.userLocation.latitude + 0.02;
        const longitude = state.userLocation.longitude;
        setNearbyAnchor(latitude, longitude, projectLonLat(longitude, latitude));
      });
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
    });

    test("'Use my location' stays on screen across all three, and works from any of them", async ({ page }) => {
      for (const toggle of ["#filterToggle", "#settingsToggle", "#reportToggle"]) {
        await page.click(toggle);
        await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
      }

      // Cleared from the Report screen, which is the furthest from where the browse started.
      await page.click("[data-action='reset-nearby-anchor']");
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeHidden();
      expect(await page.evaluate(() => state.nearbyAnchor)).toBeNull();
      await expect(page.locator("#reportToggle")).toHaveClass(/screen-active/);
    });

    test("tapping open ground moves the browsed spot without closing the settings screen", async ({ page }) => {
      await page.click("#settingsToggle");
      await expect(page.locator("#settingsToggle")).toHaveClass(/screen-active/);

      const moved = await page.evaluate(() => {
        const before = { ...state.nearbyAnchor };
        const lonLat = { latitude: before.latitude - 0.004, longitude: before.longitude + 0.004 };
        focusNearbyOnMapPoint(lonLat, projectLonLat(lonLat.longitude, lonLat.latitude));
        return { before, after: { ...state.nearbyAnchor }, expected: lonLat };
      });
      expect(moved.after.latitude).toBeCloseTo(moved.expected.latitude, 6);
      expect(moved.after.latitude).not.toBeCloseTo(moved.before.latitude, 6);

      await expect(page.locator("#settingsToggle")).toHaveClass(/screen-active/);
      await expect(page.locator("#inspectorTitle")).toContainText("Settings");
    });

    test("pinching resizes the walking radius from the filter screen", async ({ page }) => {
      await page.click("#filterToggle");
      await expect(page).toHaveURL(/#filters$/);

      const before = await page.evaluate(() => state.walkingDistanceMinutes);
      await firePinch(page, { startHalfGap: 140, endHalfGap: 20 });
      const grown = await page.evaluate(() => state.walkingDistanceMinutes);

      expect(grown).toBeGreaterThan(before);
      // The screen it was performed on survives: refreshNearbyRadiusView must not re-render
      // the Nearby list over the top of it.
      await expect(page).toHaveURL(/#filters$/);
      await expect(page.locator("#inspectorTitle")).toContainText("Filters");
    });
  });

  test.describe("Camera framing", () => {
    test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

    // The Nearby camera frames the walking-radius circle and nothing else. Earlier designs
    // fitted the nearby item cluster, so the camera chased whichever matches happened to be
    // nearest: zoomed in past the ring and clipped it when they were clustered close, zoomed
    // out past it when one sat near the edge.
    async function measureRing(page) {
      await page.waitForFunction(() => Boolean(state.userLocation));
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
      await page.waitForFunction(() => Boolean(state.userLocation));
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
      await page.waitForFunction(() => Boolean(state.userLocation));
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
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

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
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

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

    // Stands the user right next to whatever is nearest, so "the closest thing to me" is
    // seconds away rather than minutes -- the case the sub-minute floor exists for.
    async function standBesideTheNearestFind(page, context) {
      const spot = await page.evaluate(() => {
        const nearest = nearestFallbackEntriesForActiveFilter(state.userLocation.latitude, state.userLocation.longitude)[0];
        return { latitude: nearest.item.latitude + 0.0002, longitude: nearest.item.longitude };
      });
      await context.setGeolocation({ ...spot, accuracy: 5 });
      await page.waitForFunction(
        (target) => Math.abs(state.userLocation.latitude - target.latitude) < 0.00005,
        spot
      );
      return spot;
    }

    test("a find closer than a minute's walk can be zoomed in on past the one-minute limit", async ({ page, context }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
      await standBesideTheNearestFind(page, context);

      const floor = await page.evaluate(() => walkingRadiusFloorMinutes(nearbyOrigin()));
      expect(floor).toBeLessThan(1);

      const beforeScale = await page.evaluate(() => state.viewport.scale);
      await firePinch(page, { startHalfGap: 20, endHalfGap: 600, step: 20 });

      const after = await page.evaluate(() => ({
        minutes: state.walkingDistanceMinutes,
        scale: state.viewport.scale,
        listed: document.querySelectorAll("#inspectorBody .nearest-item").length,
      }));
      expect(after.minutes).toBeLessThan(1);
      expect(after.minutes).toBeGreaterThanOrEqual(floor);
      // The map follows the ring in: zoomed in past where a one-minute radius would have stopped.
      expect(after.scale).toBeGreaterThan(beforeScale);
      // And what is that close is still listed -- the ring never closes past its own contents.
      expect(after.listed).toBeGreaterThan(0);
    });

    test("walking away from the last find in the ring widens it again", async ({ page, context }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
      await standBesideTheNearestFind(page, context);
      await firePinch(page, { startHalfGap: 20, endHalfGap: 600, step: 20 });
      const tight = await page.evaluate(() => state.walkingDistanceMinutes);
      expect(tight).toBeLessThan(1);

      // Somewhere in the forest with nothing within a few tens of metres, so the tight ring the
      // pinch left behind really does empty out on arrival.
      const emptySpot = await page.evaluate((origin) => {
        let best = null;
        for (let dLat = -0.01; dLat <= 0.0101; dLat += 0.005) {
          for (let dLon = -0.01; dLon <= 0.0101; dLon += 0.005) {
            const latitude = origin.latitude + dLat;
            const longitude = origin.longitude + dLon;
            const nearest = nearestFallbackEntriesForActiveFilter(latitude, longitude)[0];
            if (!nearest) continue;
            if (!best || nearest.metres > best.metres) best = { latitude, longitude, metres: nearest.metres };
          }
        }
        return best;
      }, FOREST_LOCATION);
      expect(emptySpot.metres).toBeGreaterThan(100);

      await context.setGeolocation({ latitude: emptySpot.latitude, longitude: emptySpot.longitude, accuracy: 5 });

      // The radius grows itself back out to whatever is nearest now, and the list fills again --
      // no pinching, no "nothing found" dead end.
      await expect.poll(() => page.evaluate(() => state.walkingDistanceMinutes)).toBeGreaterThan(tight);
      expect(await page.evaluate(() => state.overviewOutsideRadiusFallback)).toBe(false);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      // Grow-only: the radius the user chose is never quietly pulled back in.
      await page.evaluate(() => { state.walkingDistanceMinutes = 30; });
      await context.setGeolocation({ latitude: FOREST_LOCATION.latitude, longitude: FOREST_LOCATION.longitude, accuracy: 5 });
      await page.waitForFunction(
        (target) => Math.abs(state.userLocation.latitude - target.latitude) < 0.00005,
        FOREST_LOCATION
      );
      expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(30);
    });

    test("pinching is ignored while a real selection is open", async ({ page }) => {
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
      await page.waitForFunction(
        (name) => document.getElementById("inspectorTitle")?.textContent?.includes(name),
        FIXTURE_TREE.commonName
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
