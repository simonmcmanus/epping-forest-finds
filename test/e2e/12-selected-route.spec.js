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
    await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);

    // Building the ~120k-node regional graph from the full roads+paths GeoJSON is deliberately
    // lazy (see "Routing Graph (Lazy, Derived)" in spec-data-fetching.md) and triggered only once
    // a real selection needs it, so give it a generous window here.
    await page.waitForFunction(() => state.routingGraphReady === true, { timeout: 20_000 });

    // Once the graph is ready, drawSelectedRoute's next frame should have populated the memoized
    // route cache for this selection (js/renderer.js's selectedRoutePoints).
    await page.waitForFunction(
      () => Boolean(state.selectedRouteCache && state.selectedRouteCache.tail && state.selectedRouteCache.tail.length > 1)
    );

    const result = await page.evaluate(() => {
      const points = selectedRoutePoints(state.selected.item);
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
      result.routeMetres
    );
    const pillText = await page.locator('[data-live-field="distance"]').first().innerText();
    expect(pillText).toContain(await page.evaluate((metres) => formatDistance(metres), result.routeMetres));
  });

  test("draws nothing at all while the graph is still building, rather than a crow-flies line it is about to replace", async ({ page }) => {
    // The straight line is a fallback for "we looked and there is no walkable route", not a
    // placeholder for "we have not looked yet". Flashing it up and swapping it for a winding
    // route a moment later reads as the app changing its mind -- and points the walker the
    // wrong way in the meantime.
    await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);

    const whileBuilding = await page.evaluate(() => {
      // Put the app back into the state it boots into: graph not built, selection made.
      state.routingGraphReady = false;
      state.routingGraph = null;
      state.selectedRouteCache = null;
      const moves = [];
      const noop = () => {};
      const probe = {
        save: noop, restore: noop, beginPath: noop, closePath: noop,
        moveTo(x, y) { moves.push({ x, y }); },
        lineTo: noop, stroke: noop, fill: noop, setLineDash: noop,
      };
      drawSelectedRoute(probe);
      return { moves: moves.length, isFallback: selectedRouteIsFallback(state.selected.item) };
    });
    expect(whileBuilding.isFallback, "there is no route yet, so anything drawn would be a fallback").toBe(true);
    expect(whileBuilding.moves, "so nothing is drawn").toBe(0);

    await page.waitForFunction(() => state.routingGraphReady === true, { timeout: 20_000 });

    const whenReady = await page.evaluate(() => {
      const moves = [];
      const noop = () => {};
      const probe = {
        save: noop, restore: noop, beginPath: noop, closePath: noop,
        moveTo(x, y) { moves.push({ x, y }); },
        lineTo: noop, stroke: noop, fill: noop, setLineDash: noop,
      };
      drawSelectedRoute(probe);
      return { moves: moves.length, isFallback: selectedRouteIsFallback(state.selected.item) };
    });
    expect(whenReady.isFallback, "this destination is reachable on the network").toBe(false);
    expect(whenReady.moves, "and the real route is drawn").toBe(1);
  });

  test("the drawn route starts where the walker is now, not where the journey began", async ({ page }) => {
    await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    await page.waitForFunction(() => state.routingGraphReady === true, { timeout: 20_000 });
    await page.waitForFunction(
      () => Boolean(state.selectedRouteCache && state.selectedRouteCache.tail && state.selectedRouteCache.tail.length > 1)
    );

    const walked = await page.evaluate(() => {
      const target = state.selected.item;
      const startHead = selectedRoutePoints(target)[0];

      // A few metres of walking -- under the threshold that re-runs the route search, which is
      // exactly the case that used to leave the line trailing behind the walker.
      const latitude = state.userLocation.latitude - 0.00005;
      const longitude = state.userLocation.longitude;
      state.userLocation = { latitude, longitude, accuracy: 10, point: projectLonLat(longitude, latitude) };

      const movedHead = selectedRoutePoints(target)[0];
      return {
        headFollowedTheWalker: movedHead.x === state.userLocation.point.x && movedHead.y === state.userLocation.point.y,
        headMoved: startHead.y !== movedHead.y,
      };
    });

    expect(walked.headMoved, "the head of the line moved with the walker").toBe(true);
    expect(walked.headFollowedTheWalker, "and sits exactly on their current position").toBe(true);
  });

  test("re-fits the viewport once the routing graph is ready so the whole routed line stays on screen", async ({ page }) => {
    await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);

    // The selection's own viewport fit runs immediately, while the graph is still building, so it
    // can only fit the straight-line [user, destination] fallback. This is the regression guard
    // for that: once the real routed line exists it is much longer than that straight line (the
    // assertion above in the previous test), so without ensureRoutingGraph's re-fit its far end
    // lands off-screen or behind the inspector.
    await page.waitForFunction(() => state.routingGraphReady === true, { timeout: 20_000 });
    await page.waitForFunction(
      () => Boolean(state.selectedRouteCache && state.selectedRouteCache.tail && state.selectedRouteCache.tail.length > 1)
    );

    // Poll rather than assert-once: the re-fit deliberately waits out any in-flight viewport
    // animation and then animates for ~520ms, so the settled state is what matters here.
    const allPointsVisible = () => {
      if (state.viewportAnimationTo != null) return false;
      const rect = bestVisibleCanvasRect();
      return selectedRoutePoints(state.selected.item).every((point) => {
        const screen = worldToScreen(point);
        return screen.x >= rect.x
          && screen.x <= rect.x + rect.width
          && screen.y >= rect.y
          && screen.y <= rect.y + rect.height;
      });
    };

    await page.waitForFunction(allPointsVisible);

    // Re-assert on a settled viewport so a transient pass mid-animation cannot green the test.
    const offScreenCount = await page.evaluate(() => {
      const rect = bestVisibleCanvasRect();
      return selectedRoutePoints(state.selected.item).filter((point) => {
        const screen = worldToScreen(point);
        return screen.x < rect.x
          || screen.x > rect.x + rect.width
          || screen.y < rect.y
          || screen.y > rect.y + rect.height;
      }).length;
    });
    expect(offScreenCount).toBe(0);
  });

  test("the selected route is framed where the tilt camera draws it, at every tilt angle", async ({ page }) => {
    // The scale fit was solved on flat (untilted) coordinates while worldToScreen() projects
    // through the tilt camera, which compresses everything ahead of the pivot towards the
    // horizon -- so the scale that flat arithmetic said filled the screen rendered the route
    // into a fraction of it, worsening with tilt (measured 1.06x too wide at beta 20, 1.96x at
    // 60, 5.27x at 85). Reported from the field as the selected-route view being far too
    // zoomed out. See claude/heading-up-tilt-aware-fit.md.
    await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    await page.waitForFunction(() => state.routingGraphReady === true, { timeout: 20_000 });

    for (const beta of [20, 30, 45, 60]) {
      const framing = await page.evaluate(async (b) => {
        // Drive the same state the compass/orientation handlers write, and force the fit so
        // this measures the fit itself rather than the ease that smooths it (covered by the
        // unit tests). Then draw, so worldToScreen reads the settled viewport.
        state.compassHeadingTarget = 0;
        state.compassHeading = 0;
        state.renderedNavigationHeading = 0;
        state.compassLastEventAt = performance.now();
        state.tiltBetaTarget = b;
        state.tiltBetaSmoothed = b;
        state.viewportAnimationTo = null;
        state.viewportAnimationFrame = null;
        // Settle before measuring. The fit anchors the user at navigationFocusPoint(), whose
        // vertical anchor is mirrored by the destination's bearing -- which is derived from
        // selectedNavigationTargetPoints(), i.e. the memoized route. draw() is what recomputes
        // that route (and clears the per-frame tilt-camera cache), so a single align+draw can
        // fit against one focus and then be measured against another: the first tilt step used
        // to report the whole route off to one side, purely because the route the focus was
        // derived from changed underneath it. On a device this self-corrects on the next frame,
        // since the compass loop re-aligns continuously; here it has to be done explicitly.
        for (let i = 0; i < 2; i += 1) {
          alignHeadingUpNavigationViewport({ force: true });
          draw();
        }
        alignHeadingUpNavigationViewport({ force: true });
        draw();
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

        const rect = bestVisibleCanvasRect();
        const focus = navigationFocusPoint(rect);
        const margin = headingUpFitMarginPx(rect);
        const points = selectedNavigationTargetPoints();
        // How much of the space available to it the route actually occupies once projected, and
        // whether anything ended up outside the visible rect. Measured on both axes: the fit is
        // bound by whichever runs out first, and for a route that is wider than it is deep that
        // is the width, not the depth ahead.
        let deepest = focus.y;
        let minX = focus.x;
        let maxX = focus.x;
        let offScreen = 0;
        for (const point of points) {
          const screen = worldToScreen(point);
          if (screen.y < deepest) deepest = screen.y;
          if (screen.x < minX) minX = screen.x;
          if (screen.x > maxX) maxX = screen.x;
          if (screen.x < rect.x || screen.x > rect.x + rect.width
            || screen.y < rect.y || screen.y > rect.y + rect.height) offScreen += 1;
        }
        return {
          verticalFill: (focus.y - deepest) / (focus.y - (rect.y + margin)),
          horizontalFill: Math.max(
            (focus.x - minX) / (focus.x - (rect.x + margin)),
            (maxX - focus.x) / ((rect.x + rect.width - margin) - focus.x)
          ),
          offScreen,
          pointCount: points.length,
        };
      }, beta);

      expect(framing.pointCount).toBeGreaterThan(2);
      expect(framing.offScreen, `beta=${beta}: route points outside the visible rect`).toBe(0);
      // The fit is only as good as the axis that binds it. This route is wider than it is deep,
      // so past about 30 degrees of tilt it is the width that runs out first (measured: the
      // route fills ~95% of the available width at every angle while the depth it reaches falls
      // from 0.89 to 0.49) -- zooming in far enough to fill the vertical band too would push it
      // off the sides. Asserting the vertical fill alone therefore failed on a correctly-framed
      // view. The bug this guards against shrank the whole projection, both axes together
      // (~1.96x too wide at beta 60), so it is still caught: max() would be ~0.5 there.
      const fill = Math.max(framing.verticalFill, framing.horizontalFill);
      expect(fill, `beta=${beta}: fraction of the binding axis the route fills`).toBeGreaterThan(0.75);
      expect(fill).toBeLessThanOrEqual(1.001);
    }
  });
});
