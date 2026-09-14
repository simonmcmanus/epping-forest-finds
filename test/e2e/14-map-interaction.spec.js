// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, tapCanvasPoint } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.665, longitude: 0.045, accuracy: 10 };

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

  test.describe("Browsing in 3D", () => {
    // Drives the same state the compass/orientation handlers write, matching 13-tilt-3d.spec.js,
    // so this exercises the real projection rather than a test-only path.
    async function tiltTo(page, beta) {
      await page.evaluate(async (b) => {
        state.compassHeadingTarget = 20;
        state.compassHeading = 20;
        state.renderedNavigationHeading = 20;
        state.compassLastEventAt = performance.now();
        state.tiltBetaTarget = b;
        state.tiltBetaSmoothed = b;
        // The fit reads the tilt camera cached for the current frame and then changes the
        // scale, which moves the pivot the next frame's camera is built from -- so it converges
        // over a frame or two, exactly as it does in the live compass loop (which clears both
        // caches at the top of every tick). Settle it here rather than measuring mid-converge.
        for (let i = 0; i < 3; i += 1) {
          prepareCanvasForDraw();
          stopViewportAnimation();
          ensureOverviewTargetsVisible({ animate: false, force: true });
          stopViewportAnimation();
          draw();
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        }
      }, beta);
    }

    const ringFraming = (page) => page.evaluate(() => {
      // prepareCanvasForDraw clears the per-frame tilt-camera cache; the fit just moved the
      // scale, so the pivot has to be re-read before the ring is measured through it.
      prepareCanvasForDraw();
      const rect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
      const points = walkingRadiusCirclePoints(64).map((p) => worldToScreen(p));
      const inside = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)
        && p.x >= rect.x && p.x <= rect.x + rect.width
        && p.y >= rect.y && p.y <= rect.y + rect.height);
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      return {
        inside: inside.length,
        total: points.length,
        widthFraction: (Math.max(...xs) - Math.min(...xs)) / rect.width,
        heightFraction: (Math.max(...ys) - Math.min(...ys)) / rect.height,
      };
    });

    test("the whole walking radius stays in the map area at every tilt angle", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      await page.evaluate(() => {
        const origin = state.userLocation;
        // ~1km away: far enough that the ring sits nowhere near the real GPS fix, which is what
        // used to leave the 3D framing solved around a pivot that had gone off screen.
        const latitude = origin.latitude - 0.005;
        const longitude = origin.longitude - 0.012;
        focusNearbyOnMapPoint({ latitude, longitude }, projectLonLat(longitude, latitude));
      });
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();

      for (const beta of [20, 40, 60, 85]) {
        await tiltTo(page, beta);
        const framing = await ringFraming(page);
        expect(framing.inside, `beta=${beta}: ring points inside the map area`).toBe(framing.total);
        // Framed, not merely on screen: a ring shrunk into a corner would also pass the check
        // above. Before the pivot was centred for browsing it came out around a third of this.
        expect(framing.widthFraction, `beta=${beta}: fraction of the map width the ring fills`).toBeGreaterThan(0.4);
      }
    });

    test("the content inside the browsed radius is not hidden as 'behind you'", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });
      await tiltTo(page, 60);

      const firstPerson = await page.evaluate(() => {
        const origin = state.userLocation.point;
        const radius = walkingRadiusWorldUnits();
        const behind = { x: origin.x, y: origin.y + radius * 0.8 };
        return { tilted: tiltActive(), culled: isBehindTiltHeading(behind), pinScale: tiltPinScale(behind) };
      });
      expect(firstPerson.tilted, "sanity: the app should be in full 3D").toBe(true);
      expect(firstPerson.culled, "standing somewhere, what is behind you is still hidden").toBe(true);
      expect(firstPerson.pinScale).toBeLessThan(1);

      await page.evaluate(() => {
        const latitude = state.userLocation.latitude - 0.005;
        const longitude = state.userLocation.longitude - 0.012;
        focusNearbyOnMapPoint({ latitude, longitude }, projectLonLat(longitude, latitude));
      });
      await tiltTo(page, 60);

      const browsing = await page.evaluate(() => {
        const origin = state.nearbyAnchor.point;
        const radius = walkingRadiusWorldUnits();
        const behind = { x: origin.x, y: origin.y + radius * 0.8 };
        return { culled: isBehindTiltHeading(behind), pinScale: tiltPinScale(behind) };
      });
      expect(browsing.culled, "a browsed spot has no behind-you half to hide").toBe(false);
      expect(browsing.pinScale, "so its pins stay full size").toBe(1);
    });
  });

  test.describe("Moving the nearby point", () => {
    test("the radius circle holds still on screen while the map slides behind it", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1000);

      const sample = () => page.evaluate(() => {
        // prepareCanvasForDraw is the frame boundary: it advances the slide, re-derives the
        // camera from the interpolated origin, and unfreezes the per-frame origin.
        prepareCanvasForDraw();
        const circle = worldToScreenFlat(nearbyRenderOriginPoint());
        const mapPoint = worldToScreenFlat(state.trees[0].point);
        return {
          circle: [Math.round(circle.x), Math.round(circle.y)],
          mapX: Math.round(mapPoint.x),
          sliding: nearbyOriginTransitionActive(),
        };
      });

      await page.evaluate(() => { stopViewportAnimation(); });
      const before = await sample();

      await page.evaluate(() => {
        const latitude = state.userLocation.latitude - 0.005;
        const longitude = state.userLocation.longitude - 0.012;
        focusNearbyOnMapPoint({ latitude, longitude }, projectLonLat(longitude, latitude));
      });

      const frames = [];
      for (let i = 0; i < 10; i += 1) {
        await page.waitForTimeout(60);
        frames.push(await sample());
      }
      await page.waitForFunction(() => !nearbyOriginTransitionActive(), { timeout: 5_000 });
      const settled = await sample();

      expect(frames.some((f) => f.sliding), "the slide should have been observed running").toBe(true);
      for (const [i, f] of frames.entries()) {
        expect(Math.abs(f.circle[0] - before.circle[0]), `frame ${i}: circle x`).toBeLessThanOrEqual(1);
        expect(Math.abs(f.circle[1] - before.circle[1]), `frame ${i}: circle y`).toBeLessThanOrEqual(1);
      }
      expect(settled.circle, "and it ends where it started").toEqual(before.circle);
      expect(Math.abs(settled.mapX - before.mapX), "while the map behind it moved").toBeGreaterThan(10);
    });

    test("the new nearby set is held back until the map lands, then fades in", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1000);

      // Both read in one round trip: sampled separately, the slide can finish between them and
      // the pair no longer describes the same instant.
      const sample = () => page.evaluate(() => {
        prepareCanvasForDraw();
        return { sliding: nearbyOriginTransitionActive(), reveal: nearbyRevealOpacity() };
      });
      expect((await sample()).reveal, "settled, the nearby set is fully drawn").toBe(1);

      await page.evaluate(() => {
        const latitude = state.userLocation.latitude - 0.005;
        const longitude = state.userLocation.longitude - 0.012;
        focusNearbyOnMapPoint({ latitude, longitude }, projectLonLat(longitude, latitude));
      });

      const during = [];
      for (let i = 0; i < 5; i += 1) {
        await page.waitForTimeout(60);
        during.push(await sample());
      }
      for (const [i, sample] of during.entries()) {
        if (sample.sliding) expect(sample.reveal, `frame ${i}: nothing drawn while the map moves`).toBe(0);
      }
      expect(during.some((sample) => sample.sliding), "the slide should have been observed running").toBe(true);

      await page.waitForFunction(() => nearbyRevealOpacity() === 1, { timeout: 5_000 });
    });
  });

  test.describe("The off-ring user pointer", () => {
    test("tapping it goes back to using the real location", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      await page.evaluate(() => {
        const latitude = state.userLocation.latitude - 0.005;
        const longitude = state.userLocation.longitude - 0.012;
        focusNearbyOnMapPoint({ latitude, longitude }, projectLonLat(longitude, latitude));
      });
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();

      // Find where the pointer was actually drawn by asking its own hit test, rather than
      // recomputing its geometry here and risking the test agreeing with itself.
      // The browse-origin slide leaves the rendered origin on the old spot for its first frames,
      // where the user is still inside the ring and the pointer is deliberately not drawn.
      await page.waitForFunction(() => !nearbyOriginTransitionActive(), { timeout: 5_000 });

      const target = await page.evaluate(() => {
        stopViewportAnimation();
        draw();
        drawOverlay();
        const rect = (els.mapStage || els.canvas).getBoundingClientRect();
        const dpr = pixelRatio();
        // The centre of the hit area, not the first pixel of it: the first hit is on the rim,
        // where a pixel of drift between probing and tapping is enough to miss.
        const hits = [];
        for (let cx = 0; cx < rect.width; cx += 4) {
          for (let cy = 0; cy < rect.height; cy += 4) {
            const screen = { x: state.canvasInsetX + cx * dpr, y: state.canvasInsetY + cy * dpr };
            if (hitUserDirectionPointer(screen)) hits.push({ cx, cy });
          }
        }
        if (!hits.length) return null;
        const mean = hits.reduce((acc, h) => ({ cx: acc.cx + h.cx / hits.length, cy: acc.cy + h.cy / hits.length }), { cx: 0, cy: 0 });
        return { clientX: rect.left + mean.cx, clientY: rect.top + mean.cy };
      });
      expect(target, "the pointer should be on screen while browsing 1km away").not.toBeNull();

      await tapCanvasPoint(page, target, { alreadyClient: true });

      const after = await page.evaluate(() => ({ anchor: state.nearbyAnchor, selected: state.selected }));
      expect(after.anchor, "tapping the pointer returns to the real location").toBeNull();
      expect(after.selected, "and selects nothing on the way").toBeNull();
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeHidden();
    });

    test("it stands down once the You dot itself is on screen", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      const shown = await page.evaluate(() => {
        const latitude = state.userLocation.latitude - 0.005;
        const longitude = state.userLocation.longitude - 0.012;
        setNearbyAnchor(latitude, longitude, projectLonLat(longitude, latitude));
        state.nearbyOriginTransition = null;
        stopViewportAnimation();
        prepareCanvasForDraw();

        // Frame the user *and* the ring inside the part of the canvas the inspector isn't
        // covering, so the dot is unmistakably on screen and the ring (where the pointer would
        // sit) is too -- otherwise the pointer could be missing merely for being off canvas.
        const rect = bestVisibleCanvasRect();
        const user = state.userLocation.point;
        const anchor = state.nearbyAnchor.point;
        const ring = walkingRadiusWorldUnits();
        const span = Math.hypot(anchor.x - user.x, anchor.y - user.y) + ring * 2;
        const scale = (Math.min(rect.width, rect.height) * 0.8) / span;
        const cx = (user.x + anchor.x) / 2;
        const cy = (user.y + anchor.y) / 2;
        state.viewport = {
          scale,
          tx: rect.x + rect.width / 2 - cx * scale,
          ty: rect.y + rect.height / 2 - cy * scale,
        };
        prepareCanvasForDraw();
        draw();
        drawOverlay();

        const cssRect = (els.mapStage || els.canvas).getBoundingClientRect();
        const dpr = pixelRatio();
        let pointerDrawn = false;
        for (let px = 0; px < cssRect.width && !pointerDrawn; px += 8) {
          for (let py = 0; py < cssRect.height; py += 8) {
            if (hitUserDirectionPointer({ x: state.canvasInsetX + px * dpr, y: state.canvasInsetY + py * dpr })) {
              pointerDrawn = true;
              break;
            }
          }
        }
        return { pointerDrawn, dotVisible: userDotVisibleOnMap(worldToScreenForOverlay) };
      });

      expect(shown.dotVisible, "the framing should have put the You dot on screen").toBe(true);
      expect(shown.pointerDrawn, "two You labels a few centimetres apart is noise, not guidance").toBe(false);
    });
  });

  test.describe("The cone from you to the nearby circle", () => {
    // Browsing a spot puts the walking-radius circle somewhere the user is not standing. The
    // cone is what ties the two together on screen, so the relationship between "where I am"
    // and "what this circle is around" is readable at a glance instead of being two unrelated
    // markers -- and it has to bridge exactly the gap, apex on the dot, far edge on the ring.
    test("it bridges the You dot and the ring while browsing a distant spot", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      const shape = await page.evaluate(() => {
        const latitude = state.userLocation.latitude - 0.005;
        const longitude = state.userLocation.longitude - 0.012;
        setNearbyAnchor(latitude, longitude, projectLonLat(longitude, latitude));
        state.nearbyOriginTransition = null;
        stopViewportAnimation();
        prepareCanvasForDraw();

        const origin = nearbyRenderOriginPoint();
        const center = worldToScreenFlat(origin);
        const edge = worldToScreenFlat({ x: origin.x + walkingRadiusWorldUnits(), y: origin.y });
        const radiusPx = Math.hypot(edge.x - center.x, edge.y - center.y);
        const cone = nearbyUserCone(center, radiusPx, false);
        if (!cone) return null;
        const user = worldToScreenFlat(state.userLocation.point);
        return {
          apexOffUser: Math.hypot(cone[0].x - user.x, cone[0].y - user.y),
          maxRingError: Math.max(...cone.slice(1).map((p) => Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radiusPx))),
          corners: cone.length,
        };
      });

      expect(shape, "a cone should be drawn while the user stands outside the ring").not.toBeNull();
      expect(shape.corners).toBeGreaterThan(2);
      expect(shape.apexOffUser, "the cone starts at the You dot").toBeLessThan(0.5);
      expect(shape.maxRingError, "and opens out onto the ring itself").toBeLessThan(0.5);
    });

    test("it is not drawn once the user is standing inside the ring", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });

      const cone = await page.evaluate(() => {
        const latitude = state.userLocation.latitude + 0.0002;
        const longitude = state.userLocation.longitude + 0.0002;
        setNearbyAnchor(latitude, longitude, projectLonLat(longitude, latitude));
        state.nearbyOriginTransition = null;
        stopViewportAnimation();
        prepareCanvasForDraw();
        const origin = nearbyRenderOriginPoint();
        const center = worldToScreenFlat(origin);
        const edge = worldToScreenFlat({ x: origin.x + walkingRadiusWorldUnits(), y: origin.y });
        return nearbyUserCone(center, Math.hypot(edge.x - center.x, edge.y - center.y), false);
      });

      expect(cone, "the You dot is already inside the circle, saying it more directly").toBeNull();
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
