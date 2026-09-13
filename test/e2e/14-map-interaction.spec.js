// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.665, longitude: 0.045, accuracy: 10 };

// Fires a real tap (pointerdown + pointerup with no movement between them) at a point given in
// canvas pixels, so the whole js/nav.js pointer pipeline -- including the wasClick test -- runs
// exactly as it does under a finger. setPointerCapture/releasePointerCapture throw for a
// synthetic (non-active) pointer id, so they're stubbed, the same way the pinch helper in
// 02-overview.spec.js does.
async function tapCanvasPoint(page, canvasPoint, options = {}) {
  await page.evaluate(({ point, alreadyClient }) => {
    const canvas = els.canvas;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const rect = (els.mapStage || canvas).getBoundingClientRect();
    const dpr = pixelRatio();
    const clientX = alreadyClient ? point.clientX : rect.left + (point.x - state.canvasInsetX) / dpr;
    const clientY = alreadyClient ? point.clientY : rect.top + (point.y - state.canvasInsetY) / dpr;
    const fire = (type) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 2001, clientX, clientY, bubbles: true, cancelable: true, pointerType: "touch",
    }));
    fire("pointerdown");
    fire("pointerup");
  }, { point: canvasPoint, alreadyClient: Boolean(options.alreadyClient) });
}

test.describe("Map interaction", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.describe("Selecting a group", () => {
    test("tapping a group of trees shows only that group on the map", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      // Find a real multi-item tree cluster at the current camera and tap its pin. Which pins
      // cluster together depends on the live dataset and the settled camera, so the target is
      // read from the same clustering the renderer draws from rather than guessed at in pixels.
      const target = await page.evaluate(() => {
        stopViewportAnimation();
        const lookup = buildNearbyIconLookup();
        const clusters = buildTypeClusters(lookup.tree, worldToScreen);
        const cluster = clusters.find((c) => c.items.length > 1);
        if (!cluster) return null;
        const iconSize = MAP_PNG_ICON_SIZE * pixelRatio() * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
        return {
          point: { x: cluster.screenPt.x, y: cluster.screenPt.y - iconSize * 0.64 },
          otherHighlightedCount: lookup.landmark.size + lookup.cow.size + lookup.path.size + lookup.water.size,
        };
      });
      test.skip(!target, "no multi-item tree cluster on screen at this camera");

      await tapCanvasPoint(page, target.point);

      const after = await page.evaluate(() => {
        const lookup = buildNearbyIconLookup();
        const group = state.clusterExpanded;
        return {
          expanded: Boolean(group),
          groupSize: group ? group.items.length : 0,
          treesShown: lookup.tree.size,
          everyShownTreeIsInTheGroup: group ? [...lookup.tree].every((t) => group.items.includes(t)) : false,
          otherTypesShown: lookup.landmark.size + lookup.cow.size + lookup.path.size + lookup.water.size,
        };
      });

      expect(after.expanded, "tapping a cluster pin should expand the group").toBe(true);
      expect(after.treesShown).toBe(after.groupSize);
      expect(after.everyShownTreeIsInTheGroup, "only the group's own trees stay on the map").toBe(true);
      expect(after.otherTypesShown, "highlighted locations from the previous view are hidden").toBe(0);
      await expect(page.locator("#inspectorTitle")).toContainText("Trees");
    });
  });

  test.describe("The nearest area", () => {
    test("a tap on a street beyond the walking radius moves the nearest area instead of selecting it", async ({ page }) => {
      await setup(page);
      await page.waitForFunction(() => Boolean(state.userLocation) && state.roads.length > 0, { timeout: 15_000 });
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      // The nearby camera frames the ring, so the out-of-radius region on screen is the corners.
      // Read a real road vertex that lands there from the road geometry itself rather than
      // guessing at pixels -- which vertices qualify depends on the live dataset and camera.
      const target = await page.evaluate(() => {
        stopViewportAnimation();
        ensureOverviewTargetsVisible({ animate: false, force: true });
        stopViewportAnimation();
        const rect = (els.mapStage || els.canvas).getBoundingClientRect();
        const dpr = pixelRatio();
        for (const road of state.roads) {
          if (!road.segments) continue;
          for (const segment of road.segments) {
            for (const point of segment) {
              const screen = worldToScreen(point);
              const clientX = rect.left + (screen.x - state.canvasInsetX) / dpr;
              const clientY = rect.top + (screen.y - state.canvasInsetY) / dpr;
              if (clientX < 20 || clientX > rect.width * 0.55 || clientY < 40 || clientY > rect.height - 30) continue;
              if (!isOutsideNearestArea(unprojectPoint(point))) continue;
              return { clientX, clientY };
            }
          }
        }
        return null;
      });
      test.skip(!target, "no out-of-radius road vertex on screen at this camera");

      await tapCanvasPoint(page, target, { alreadyClient: true });

      const after = await page.evaluate(() => ({
        selected: state.selected,
        hasAnchor: Boolean(state.nearbyAnchor),
      }));
      expect(after.selected, "a street out there is somewhere to browse, not navigate to").toBeNull();
      expect(after.hasAnchor, "the nearest area moves to the tapped spot").toBe(true);
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
    });

    test("repeated taps outside the nearest area keep moving it, at a steady zoom", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1000);

      // How big the ring is drawn and where its centre sits on screen are what "still in nearby
      // mode" means visually -- both must survive relocation, or the view walks out to
      // whole-forest scale a tap at a time.
      const framing = () => page.evaluate(() => {
        const dpr = pixelRatio();
        const origin = worldToScreen(nearbyOrigin().point);
        const edge = worldToScreen({ x: nearbyOrigin().point.x + walkingRadiusWorldUnits(), y: nearbyOrigin().point.y });
        return {
          selected: state.selected,
          anchor: state.nearbyAnchor ? [state.nearbyAnchor.latitude, state.nearbyAnchor.longitude] : null,
          ringRadiusCssPx: Math.round((edge.x - origin.x) / dpr),
          originScreen: [Math.round(origin.x), Math.round(origin.y)],
        };
      });

      const box = await page.locator("#mapCanvas").boundingBox();
      const before = await framing();
      const spots = [
        { x: box.x + 20, y: box.y + box.height - 30 },
        { x: box.x + 20, y: box.y + 30 },
        { x: box.x + box.width * 0.45, y: box.y + box.height - 30 },
      ];

      let previousAnchor = before.anchor;
      for (const spot of spots) {
        await page.mouse.click(spot.x, spot.y);
        await page.waitForTimeout(1300);
        const after = await framing();
        expect(after.selected, "the Nearby view is never left").toBeNull();
        expect(after.anchor, "each tap moves the nearest area again").not.toEqual(previousAnchor);
        expect(after.ringRadiusCssPx).toBe(before.ringRadiusCssPx);
        expect(after.originScreen).toEqual(before.originScreen);
        previousAnchor = after.anchor;
      }
      await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
    });
  });

  test.describe("Selecting a street", () => {
    test("a selected street becomes a navigation target with a route and distance", async ({ page }) => {
      await setup(page);
      await page.waitForFunction(() => Boolean(state.userLocation) && state.roads.length > 0, { timeout: 15_000 });

      const navigating = await page.evaluate(() => {
        const road = state.roads.find((r) => r.segments && r.segments.length && (r.name || r.ref));
        if (!road) return null;
        state.selected = { type: "road", item: road };
        showRoadDetails(road, distanceFromUserToRoad(road));
        startCompassNavigation();
        const target = selectedCompassTarget();
        return {
          hasTarget: Boolean(target),
          routePointCount: target ? selectedRoutePoints(target).length : 0,
        };
      });
      expect(navigating, "the roads dataset should contain a named road").not.toBeNull();

      expect(navigating.hasTarget, "a street is navigable, not just a records list").toBe(true);
      expect(navigating.routePointCount).toBeGreaterThanOrEqual(2);
      // startCompassNavigation awaits the compass-permission check before it reveals the arrow.
      await page.waitForFunction(
        () => document.getElementById("compassArrow").hidden === false,
        { timeout: 5_000 }
      );
      await expect(page.locator("#inspectorBody .detail-top-row")).toBeVisible();
    });
  });
});
