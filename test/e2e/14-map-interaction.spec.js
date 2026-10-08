// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, tapCanvasPoint } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.665, longitude: 0.045, accuracy: 10 };

test.describe("Map interaction", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.describe("Selecting a group", () => {
    test("tapping a group of trees browses the Nearby view to that group", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      // Find a real multi-item tree cluster at the current camera and tap its pin. Which pins
      // cluster together depends on the live dataset and the settled camera, so the target is
      // read from the same clustering the renderer draws from rather than guessed at in pixels.
      // The expected anchor/radius are computed here the same way focusNearbyOnClusterGroup
      // (js/nav.js) does, so the assertions below check that function's actual contract --
      // covering the group's own footprint -- rather than exact list membership, which the
      // Nearby list's existing nearest-N cap (state.nearestItemsCount) can still trim in a
      // register this dense, same as it does for any other browsed spot.
      const target = await page.evaluate(() => {
        stopViewportAnimation();
        const lookup = buildNearbyIconLookup();
        const clusters = buildTypeClusters(lookup.tree, worldToScreen);
        const cluster = clusters.find((c) => c.items.length > 1);
        if (!cluster) return null;
        const iconSize = MAP_PNG_ICON_SIZE * pixelRatio() * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const item of cluster.items) {
          minX = Math.min(minX, item.point.x);
          maxX = Math.max(maxX, item.point.x);
          minY = Math.min(minY, item.point.y);
          maxY = Math.max(maxY, item.point.y);
        }
        const center = unprojectPoint({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
        let maxMetres = 0;
        for (const item of cluster.items) {
          maxMetres = Math.max(maxMetres, distanceMetres(center.latitude, center.longitude, item.latitude, item.longitude));
        }
        return {
          point: { x: cluster.screenPt.x, y: cluster.screenPt.y - iconSize * 0.64 },
          center,
          maxMetres,
        };
      });
      test.skip(!target, "no multi-item tree cluster on screen at this camera");

      await tapCanvasPoint(page, target.point);

      // The state change (anchor, radius, list) lands synchronously on tap, but the camera eases
      // to its new framing afterwards (focusNearbyOnClusterGroup, js/nav.js) -- wait for the
      // state rather than asserting before the draw that reflects it has had a chance to run.
      await page.waitForFunction(() => Boolean(state.nearbyAnchor));

      // Tapping a group behaves like tapping open ground on that spot: the Nearby browse anchor
      // moves to the group's centre and the radius grows to cover it, so the Nearby list -- the
      // same screen, no separate cluster-detail screen -- now reads as "what's around here".
      const after = await page.evaluate((center) => ({
        hasAnchor: Boolean(state.nearbyAnchor),
        anchorDistanceFromGroupCentre: state.nearbyAnchor
          ? distanceMetres(state.nearbyAnchor.latitude, state.nearbyAnchor.longitude, center.latitude, center.longitude)
          : null,
        radiusMetres: walkingDistanceToMetres(state.walkingDistanceMinutes),
        hasListedItems: document.querySelectorAll("#inspectorBody .nearest-item").length > 0,
      }), target.center);

      expect(after.hasAnchor, "tapping a group sets a browse anchor, same as tapping open ground").toBe(true);
      expect(after.anchorDistanceFromGroupCentre, "the anchor sits at the group's own centre").toBeLessThan(1);
      expect(after.radiusMetres, "the walking radius grows to cover the group's farthest member").toBeGreaterThanOrEqual(target.maxMetres);
      expect(after.hasListedItems, "the Nearby list is populated around the new anchor").toBe(true);
      await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
    });

    test("the browser back button undoes a cluster tap and returns to the previous anchor", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
      const anchorBefore = await page.evaluate(() => state.nearbyAnchor);

      const target = await page.evaluate(() => {
        stopViewportAnimation();
        const lookup = buildNearbyIconLookup();
        const clusters = buildTypeClusters(lookup.tree, worldToScreen);
        const cluster = clusters.find((c) => c.items.length > 1);
        if (!cluster) return null;
        const iconSize = MAP_PNG_ICON_SIZE * pixelRatio() * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
        return { point: { x: cluster.screenPt.x, y: cluster.screenPt.y - iconSize * 0.64 } };
      });
      test.skip(!target, "no multi-item tree cluster on screen at this camera");

      await tapCanvasPoint(page, target.point);
      await page.waitForFunction(() => Boolean(state.nearbyAnchor));
      const anchorAfterTap = await page.evaluate(() => state.nearbyAnchor);

      // The browser back button retraces the cluster tap the same way it retraces a selection
      // (see pushNearbyAnchorHistory/restoreNearbyAnchorFromHistory, js/app.js and js/nav.js).
      // The restored anchor is re-derived from a lat/lon snapshot (history.state has no room for
      // live object references), so it is compared by value rather than by exact float equality.
      await page.goBack();
      await expect.poll(() => page.evaluate(() => state.nearbyAnchor)).toEqual(anchorBefore);

      // And forward replays it, landing back on the cluster's own anchor.
      await page.goForward();
      await expect.poll(() => page.evaluate(() => {
        const a = state.nearbyAnchor;
        return a ? { latitude: a.latitude, longitude: a.longitude } : null;
      })).toEqual(anchorAfterTap ? { latitude: anchorAfterTap.latitude, longitude: anchorAfterTap.longitude } : null);
    });

    test("tapping a cluster while something is selected expands the cluster, not the pin behind it", async ({ page }) => {
      await setup(page);

      // Select a tree first -- mirrors viewing one tree, then tapping a nearby cluster to browse
      // the rest. Cluster hit-testing used to be skipped whenever state.selected was set, so a
      // tap here fell straight through to findHit and picked up whatever individual pin sat
      // behind the badge instead of expanding it.
      await page.evaluate(() => {
        stopViewportAnimation();
        const lookup = buildNearbyIconLookup();
        state.selected = { type: "tree", item: [...lookup.tree][0] };
        requestDraw();
      });
      await expect.poll(() => page.evaluate(() => state.selected?.type)).toBe("tree");

      // Find a cluster whose hit-test circle overlaps an individual pin's own hit region -- the
      // exact overlap the old code got wrong.
      const clusterScreen = await page.evaluate(() => {
        const dpr = pixelRatio();
        const iconSize = MAP_PNG_ICON_SIZE * dpr * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
        const pinYOffset = iconSize * 0.64;
        const lookup = buildNearbyIconLookup();
        const clusters = buildTypeClusters(lookup.tree, worldToScreen);
        for (const cluster of clusters) {
          if (cluster.items.length <= 1) continue;
          const screen = { x: cluster.screenPt.x, y: cluster.screenPt.y - pinYOffset };
          if (!findClusterHit(screen)) continue;
          const world = screenToWorld(screen.x, screen.y);
          if (findHit(screen, world).type !== "none") return screen;
        }
        return null;
      });
      test.skip(!clusterScreen, "no multi-item tree cluster overlapping an individual pin at this camera");

      const dpr = await page.evaluate(() => pixelRatio());
      const { insetX, insetY, left, top } = await page.evaluate(() => {
        const r = (document.querySelector(".map-stage") || document.getElementById("mapCanvas")).getBoundingClientRect();
        return { insetX: state.canvasInsetX, insetY: state.canvasInsetY, left: r.left, top: r.top };
      });
      await page.mouse.click(left + (clusterScreen.x - insetX) / dpr, top + (clusterScreen.y - insetY) / dpr);

      await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
      await expect.poll(() => page.evaluate(() => Boolean(state.nearbyAnchor))).toBe(true);
    });
  });

  test.describe("The nearest area", () => {
    test("a tap on a street beyond the walking radius moves the nearest area instead of selecting it", async ({ page }) => {
      await setup(page);
      await page.waitForFunction(() => Boolean(state.userLocation) && state.roads.length > 0);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

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
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
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
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      await page.evaluate(() => {
        const origin = state.userLocation;
        // ~1km away: far enough that the ring sits nowhere near the real GPS fix, which is what
        // used to leave the 3D framing solved around a pivot that had gone off screen.
        const latitude = origin.latitude - 0.005;
        const longitude = origin.longitude - 0.012;
        focusNearbyOnMapPoint({ latitude, longitude }, projectLonLat(longitude, latitude));
      });
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
      // This assertion measures the settled browse view. The anchor bar appears before
      // the 520ms origin slide finishes, and stopping the camera does not stop that slide.
      // Measuring mid-slide mixes the moving ring with the destination's camera fit.
      await page.waitForFunction(() => !state.nearbyOriginTransition);


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
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
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
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
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
      await page.waitForFunction(() => !nearbyOriginTransitionActive());
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
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
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

      await page.waitForFunction(() => nearbyRevealOpacity() === 1);
    });
  });

  test.describe("Browsing away from where you are standing", () => {
    // The Nearby view used to plant a black arrow on the ring's edge pointing back at the
    // user's real position, with a "You · 1.2 km" label and a tap target of its own. Between
    // the amber browse-anchor marker, the cone from the dot to the ring and the "Use my
    // location" bar, the map was already saying it three times over -- so the arrow is gone.
    test("no arrow is planted on the ring pointing back at the user", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      await page.evaluate(() => {
        const latitude = state.userLocation.latitude - 0.005;
        const longitude = state.userLocation.longitude - 0.012;
        focusNearbyOnMapPoint({ latitude, longitude }, projectLonLat(longitude, latitude));
      });
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
      await page.waitForFunction(
        () => !state.nearbyOriginTransition && state.viewportAnimationFrame == null
      );

      const drawn = await page.evaluate(() => ({
        drawFn: typeof window.drawUserDirectionFromAnchor,
        hitFn: typeof window.hitUserDirectionPointer,
      }));
      expect(drawn.drawFn, "the off-ring pointer is no longer drawn").toBe("undefined");
      expect(drawn.hitFn, "and leaves no invisible tap target behind").toBe("undefined");

      // The way back to the real location is the bar, which is still there and still works.
      await page.locator("[data-action='reset-nearby-anchor']").click();
      const after = await page.evaluate(() => ({ anchor: state.nearbyAnchor, selected: state.selected }));
      expect(after.anchor, "the anchor bar still returns to the real location").toBeNull();
      expect(after.selected, "and selects nothing on the way").toBeNull();
    });

    test("selecting a real pin while browsing another spot resets Nearby to the user's own location", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      await page.evaluate(() => {
        const latitude = state.userLocation.latitude - 0.005;
        const longitude = state.userLocation.longitude - 0.012;
        focusNearbyOnMapPoint({ latitude, longitude }, projectLonLat(longitude, latitude));
      });
      await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
      await page.waitForFunction(() => !state.nearbyOriginTransition);

      // A single (unclustered) tree pin on screen, found the same way the cluster tests above
      // locate their own target -- which pins exist at this camera depends on the live dataset.
      const target = await page.evaluate(() => {
        stopViewportAnimation();
        const lookup = activeIconLookup();
        const clusters = buildTypeClusters(lookup.tree, worldToScreen);
        const iconSize = MAP_PNG_ICON_SIZE * pixelRatio() * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
        for (const single of clusters.filter(c => c.items.length === 1)) {
          const point = { x: single.screenPt.x, y: single.screenPt.y - iconSize * 0.416 };
          const hit = findHit(point, screenToWorld(point.x, point.y));
          if (!findClusterHit(point) && hit?.type === 'tree' && hit.item === single.items[0]) return { point };
        }
        return null;
      });
      test.skip(!target, "no single tree pin on screen at this camera");

      await tapCanvasPoint(page, target.point);
      await page.waitForFunction(() => state.selected?.type === "tree");

      // Selecting the pin must hand Nearby back to the real GPS fix rather than leaving the
      // browsed spot -- and its map dot (drawNearbyAnchorMarker, js/renderer.js, which only
      // checks state.nearbyAnchor) -- behind the new selection.
      const anchor = await page.evaluate(() => state.nearbyAnchor);
      expect(anchor, "the browse anchor is cleared once a real selection is made").toBeNull();
    });
  });

  test.describe("The cone from you to the nearby circle", () => {
    // Browsing a spot puts the walking-radius circle somewhere the user is not standing. The
    // cone is what ties the two together on screen, so the relationship between "where I am"
    // and "what this circle is around" is readable at a glance instead of being two unrelated
    // markers -- and it has to bridge exactly the gap, apex on the dot, far edge on the ring.
    test("it bridges the You dot and the ring while browsing a distant spot", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

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
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

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
      await page.waitForFunction(() => Boolean(state.userLocation) && state.roads.length > 0);

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
        () => document.getElementById("compassArrow").hidden === false
      );
      await expect(page.locator("#inspectorBody .detail-top-row")).toBeVisible();
    });
  });
});
