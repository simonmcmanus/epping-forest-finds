// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, gotoAndWaitForMap, FIXTURE_TREE } = require("./helpers");

// Same forest-area fix used by 09-location.spec.js/10-secondary-screen-camera.spec.js.
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

// Tree 11383 (English Oak, FIXTURE_TREE) sits at 51.6437884, 0.0236671 -- about 2.8km
// straight-line from FOREST_LOCATION, comfortably inside the local-roads/local-paths coverage
// area, and known (checked against the real dataset while building this test) to produce a
// genuinely bent route rather than a fallback straight line.
test.describe("Selected route line follows the road/path network", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test("routes to a selected tree along mapped paths/roads instead of a straight line once the routing graph is ready", async ({ page }) => {
    await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });

    // Building the ~120k-node regional graph from the full roads+paths GeoJSON is deliberately
    // lazy (see "Routing Graph (Lazy, Derived)" in spec-data-fetching.md) and triggered only once
    // a real selection needs it, so give it a generous window here.
    await page.waitForFunction(() => state.routingGraphReady === true, { timeout: 20_000 });

    // Once the graph is ready, drawSelectedRoute's next frame should have populated the memoized
    // route cache for this selection (js/renderer.js's selectedRoutePoints).
    await page.waitForFunction(
      () => Boolean(state.selectedRouteCache && state.selectedRouteCache.points && state.selectedRouteCache.points.length > 2),
      { timeout: 10_000 }
    );

    const result = await page.evaluate(() => {
      const points = state.selectedRouteCache.points;
      const from = state.userLocation.point;
      const to = points[points.length - 1];
      let routeMetres = 0;
      for (let i = 1; i < points.length; i += 1) {
        const a = unprojectPoint(points[i - 1]);
        const b = unprojectPoint(points[i]);
        routeMetres += distanceMetres(a.latitude, a.longitude, b.latitude, b.longitude);
      }
      const fromLatLon = unprojectPoint(from);
      const toLatLon = unprojectPoint(to);
      const straightMetres = distanceMetres(fromLatLon.latitude, fromLatLon.longitude, toLatLon.latitude, toLatLon.longitude);
      return { pointCount: points.length, routeMetres, straightMetres };
    });

    // A real routed path here has ~129 points (checked against the live dataset); a fallback to
    // the old straight line would be exactly 2. This is the core regression this test guards.
    expect(result.pointCount).toBeGreaterThan(10);
    expect(result.routeMetres).toBeGreaterThan(result.straightMetres);
    // Sanity bound so a runaway/disconnected-fragment route would still fail the test rather
    // than silently pass (findRoutePoints itself already rejects anything past 4x -- this just
    // confirms that guard is actually wired up end-to-end).
    expect(result.routeMetres).toBeLessThan(result.straightMetres * 4);

    // The displayed distance/walk-time chip must reflect this same routed figure, not the
    // straight-line one -- previously it stayed on the crow-flies distance even once the drawn
    // route line itself was following real paths/roads (see "Selected Detail Content" in
    // spec-data-rendering.md).
    await page.waitForFunction(
      (metres) => {
        const pill = document.querySelector('[data-live-field="distance"]');
        return Boolean(pill) && pill.innerHTML.includes(formatDistance(metres));
      },
      result.routeMetres,
      { timeout: 5_000 }
    );
    const pillText = await page.locator('[data-live-field="distance"]').first().innerText();
    expect(pillText).toContain(await page.evaluate((metres) => formatDistance(metres), result.routeMetres));
  });

  test("re-fits the viewport once the routing graph is ready so the whole routed line stays on screen", async ({ page }) => {
    await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });

    // The selection's own viewport fit runs immediately, while the graph is still building, so it
    // can only fit the straight-line [user, destination] fallback. This is the regression guard
    // for that: once the real routed line exists it is much longer than that straight line (the
    // assertion above in the previous test), so without ensureRoutingGraph's re-fit its far end
    // lands off-screen or behind the inspector.
    await page.waitForFunction(() => state.routingGraphReady === true, { timeout: 20_000 });
    await page.waitForFunction(
      () => Boolean(state.selectedRouteCache && state.selectedRouteCache.points && state.selectedRouteCache.points.length > 2),
      { timeout: 10_000 }
    );

    // Poll rather than assert-once: the re-fit deliberately waits out any in-flight viewport
    // animation and then animates for ~520ms, so the settled state is what matters here.
    const allPointsVisible = () => {
      if (state.viewportAnimationTo != null) return false;
      const rect = bestVisibleCanvasRect();
      return state.selectedRouteCache.points.every((point) => {
        const screen = worldToScreen(point);
        return screen.x >= rect.x
          && screen.x <= rect.x + rect.width
          && screen.y >= rect.y
          && screen.y <= rect.y + rect.height;
      });
    };

    await page.waitForFunction(allPointsVisible, { timeout: 15_000 });

    // Re-assert on a settled viewport so a transient pass mid-animation cannot green the test.
    const offScreenCount = await page.evaluate(() => {
      const rect = bestVisibleCanvasRect();
      return state.selectedRouteCache.points.filter((point) => {
        const screen = worldToScreen(point);
        return screen.x < rect.x
          || screen.x > rect.x + rect.width
          || screen.y < rect.y
          || screen.y > rect.y + rect.height;
      }).length;
    });
    expect(offScreenCount).toBe(0);
  });
});
