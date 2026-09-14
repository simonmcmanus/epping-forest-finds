// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap, tapCanvasPoint } = require("./helpers");

// A GPS fix inside Epping Forest
const FOREST_LOCATION = { latitude: 51.6538, longitude: 0.0400, accuracy: 10 };

// The full tilt range the device orientation handler can produce: flat, through the
// activation threshold, to the maximum 3D angle.
const TILT_SWEEP = [0, 12, 20, 30, 40, 50, 60, 70, 80, 85];

/**
 * Put the app into heading-up mode at a given tilt, then draw and settle a frame.
 * Drives the same state the compass/orientation handlers write, so this exercises the
 * real projection rather than a test-only path.
 */
async function tiltTo(page, beta) {
  await page.evaluate(async (b) => {
    state.compassHeadingTarget = 0;
    state.compassHeading = 0;
    state.renderedNavigationHeading = 0;
    state.compassLastEventAt = performance.now();
    state.tiltBetaTarget = b;
    state.tiltBetaSmoothed = b;
    alignHeadingUpNavigationViewport();
    draw();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }, beta);
}

test.describe("3D tilt view", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await page.evaluate(() => {
      const gate = document.getElementById("locationGate");
      if (gate && !gate.hidden) gate.hidden = true;
    });
  });

  test("the walking-radius circle keeps filling the map at every tilt angle", async ({ page }) => {
    // The "still way too zoomed out in 3D" report. The Nearby camera frames the radius circle,
    // and the circle's behind half is never drawn in 3D (isBehindTiltHeading culls it) -- but
    // the fit used to force that hidden half into the few pixels below the deep-tilt anchor,
    // which collapsed the scale to roughly a third of what the visible half needed and left a
    // tiny circle adrift in the middle of the screen.
    const measure = () => page.evaluate(() => {
      const rect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
      let minX = Infinity;
      let maxX = -Infinity;
      for (const point of walkingRadiusCirclePoints()) {
        const screen = worldToScreen(point);
        minX = Math.min(minX, screen.x);
        maxX = Math.max(maxX, screen.x);
      }
      return { widthFraction: (maxX - minX) / rect.width, scale: state.viewport.scale };
    });

    await tiltTo(page, 0);
    const flat = await measure();

    for (const beta of TILT_SWEEP) {
      await tiltTo(page, beta);
      const { widthFraction, scale } = await measure();

      // Pre-fix this sat around a quarter of the map width once tilt engaged.
      expect(widthFraction, `beta=${beta}: fraction of the map width the radius circle spans`).toBeGreaterThan(0.6);
      expect(widthFraction).toBeLessThanOrEqual(1.001);
      // Tilting into 3D must never zoom further out than the flat view -- it frames the same
      // circle, minus the half it no longer draws.
      expect(scale, `beta=${beta}: 3D must not be more zoomed out than 2D`).toBeGreaterThanOrEqual(flat.scale * 0.99);
    }
  });

  test("map items stay visible at every tilt angle, from flat to full 3D", async ({ page }) => {
    // Tilting used to progressively empty the map: the radar and destination pointer went
    // first, then buildings and streets, until at maximum tilt almost nothing was left.
    //
    // This test reads the canvas, so it guards the half of that caused by the ground plane
    // running out before the horizon. It cannot see the other half — CSS clipping a
    // 3D-rotated bitmap at the camera plane — because that happened during compositing,
    // with the canvas bitmap itself fully painted. The three tests below are what guard
    // that failure mode, by pinning the conditions it needed: no CSS 3D transform on the
    // canvas, no tilt overscan, and no unguarded perspective divide.
    for (const beta of TILT_SWEEP) {
      await tiltTo(page, beta);

      const { groundCoverage, horizonFraction } = await page.evaluate(() => {
        const rect = bestVisibleCanvasRect();
        // Derived here from the camera angle and distance rather than read from
        // tiltHorizonCanvasY(), so this measures observable behaviour and stays valid
        // across any future change to how the projection is implemented.
        const tiltDeg = tiltRotateXDeg();
        const horizon = tiltDeg > 0
          ? rawWorldToScreen(state.userLocation.point).y
            - (tiltPerspectivePx() / Math.tan(tiltDeg * Math.PI / 180)) * pixelRatio()
          : null;
        // Everything below the horizon is ground and must be painted. Above it is sky,
        // which is correctly empty — so the ground band is the honest thing to measure.
        const top = Math.max(Math.round(rect.y), horizon == null ? -Infinity : Math.round(horizon), 0);
        const bottom = Math.min(Math.round(rect.y + rect.height), els.canvas.height);
        const x = Math.max(0, Math.round(rect.x));
        const width = Math.min(els.canvas.width - x, Math.round(rect.width));
        const pixels = els.canvas.getContext("2d").getImageData(x, top, width, bottom - top).data;

        let painted = 0;
        let total = 0;
        for (let row = 0; row < bottom - top; row += 4) {
          for (let col = 0; col < width; col += 4) {
            total += 1;
            if (pixels[((row * width) + col) * 4 + 3] > 8) painted += 1;
          }
        }
        return {
          groundCoverage: (painted / total) * 100,
          horizonFraction: horizon == null ? null : (horizon - rect.y) / rect.height,
        };
      });

      expect(groundCoverage, `ground must stay painted at beta ${beta}`).toBeGreaterThan(95);
      if (horizonFraction !== null && horizonFraction > 0) {
        // Once the horizon is on screen it must stay in the upper half — a horizon that
        // crept down the screen would mean the ground was running out early again.
        expect(horizonFraction, `horizon should sit high at beta ${beta}`).toBeLessThan(0.5);
      }
    }
  });

  test("the perspective projection never goes singular while tilting", async ({ page }) => {
    for (const beta of TILT_SWEEP) {
      await tiltTo(page, beta);

      const bad = await page.evaluate(() => {
        const origin = rawWorldToScreen(state.userLocation.point);
        const failures = [];
        // Well beyond the canvas in both directions: ahead towards the horizon, and
        // behind the pivot where the old divide-by-(P - dz) blew up and mirrored points.
        for (let offset = -20000; offset <= 20000; offset += 200) {
          const point = projectCanvasPoint(origin.x, origin.y + offset);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.scale <= 0) {
            failures.push({ offset, x: point.x, y: point.y, scale: point.scale });
          }
        }
        return failures;
      });

      expect(bad, `projection must stay finite and forward-facing at beta ${beta}`).toEqual([]);
    }
  });

  test("tilting never resizes the canvas", async ({ page }) => {
    // Tilt is projected per point now, so it needs no canvas overscan. Oversizing for
    // tilt is what used to push the rotated plane through the camera plane; a resize
    // mid-gesture would also read as a visible snap.
    await tiltTo(page, 0);
    const flat = await page.evaluate(() => ({ w: els.canvas.width, h: els.canvas.height }));

    for (const beta of TILT_SWEEP) {
      await tiltTo(page, beta);
      const size = await page.evaluate(() => ({ w: els.canvas.width, h: els.canvas.height }));
      expect(size, `canvas size must not change at beta ${beta}`).toEqual(flat);
    }
  });

  test("the walking radius dimming edge lies on the ground plane and foreshortens with it", async ({ page }) => {
    // drawWalkingRadiusDimming cuts the radius shape out of a canvas-wide dark wash and blurs
    // the result, so the edge itself is the only soft transition (no separate boundary line).
    // ctx.arc() takes one scalar radius, so if that cutout were drawn as a plain screen-space
    // circle the edge would look identical at every tilt angle instead of foreshortening with
    // the ground. Measured by walking outward from the shape's own centre along each cardinal
    // direction to find where the before/after delta first rises above a small fixed noise
    // floor -- i.e. the inner edge of the blurred transition band in that direction -- and
    // comparing those four radii. This used to compare against a "fully dark, far outside"
    // reference sampled at a canvas corner, but the corners turned out to carry their own
    // small unrelated diffs (something else redraws slightly differently there between the
    // two draw() calls), which threw off the up/down/left/right comparison; a fixed threshold
    // sidesteps needing that reference at all.
    const measure = async (beta) => {
      await tiltTo(page, beta);
      return page.evaluate(() => {
        const canvas = els.canvas;
        const context = canvas.getContext("2d");
        // Let the viewport converge first: prepareCanvasForDraw can still adjust the fit on
        // the first draw after a tilt change, which would swamp the diff.
        for (let i = 0; i < 4; i += 1) { alignHeadingUpNavigationViewport(); draw(); }

        // Land the buildings reveal fade before sampling. It eases building opacity in over
        // BUILDINGS_FADE_MS (1200ms, drawBuildings in js/renderer.js) from first paint, so on a
        // slow enough machine it is still advancing when the two draws below are taken — and the
        // opacity step between them darkens every building pixel by enough to clear NOISE_FLOOR.
        // The measurement then reads the near edge of the nearest built-up area as if it were the
        // edge of the wash: whichever cardinal direction happens to have buildings comes back
        // roughly half the true radius (e.g. 133 against 245), and the aspect ratio with it.
        if (state.buildingsRevealStartTime) state.buildingsRevealStartTime = performance.now() - 100_000;

        const real = window.drawWalkingRadiusDimming;
        window.drawWalkingRadiusDimming = () => {};
        draw();
        const without = context.getImageData(0, 0, canvas.width, canvas.height).data;
        window.drawWalkingRadiusDimming = real;
        draw();
        const withDimming = context.getImageData(0, 0, canvas.width, canvas.height).data;

        const deltaAt = (x, y) => {
          x = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
          y = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
          const i = ((y * canvas.width) + x) * 4;
          return Math.abs(withDimming[i] - without[i])
            + Math.abs(withDimming[i + 1] - without[i + 1])
            + Math.abs(withDimming[i + 2] - without[i + 2]);
        };

        // The app's own screen-space centre for the shape, so this measures what was actually
        // rendered rather than re-deriving the projection independently.
        const centre = worldToScreenFlat(nearbyOrigin().point);
        const NOISE_FLOOR = 20;
        const edgeDistance = (dx, dy) => {
          const maxR = Math.max(canvas.width, canvas.height);
          for (let r = 0; r < maxR; r += 1) {
            if (deltaAt(centre.x + dx * r, centre.y + dy * r) > NOISE_FLOOR) return r;
          }
          return null;
        };

        return {
          right: edgeDistance(1, 0),
          left: edgeDistance(-1, 0),
          down: edgeDistance(0, 1),
          up: edgeDistance(0, -1),
        };
      });
    };

    const aspectOf = (edges) => {
      for (const key of ["right", "left", "down", "up"]) {
        expect(edges[key], `${key} edge of the walking radius must be found`).not.toBeNull();
      }
      return ((edges.up + edges.down) / 2) / ((edges.left + edges.right) / 2);
    };

    const flat = await measure(0);
    const flatAspect = aspectOf(flat);
    expect(flatAspect, "a flat map should paint the edge as a circle").toBeCloseTo(1, 1);

    let previous = flatAspect;
    for (const beta of [40, 60, 85]) {
      const tilted = await measure(beta);
      const aspect = aspectOf(tilted);
      expect(aspect, `the edge should flatten further by beta ${beta}`).toBeLessThan(previous);
      previous = aspect;
    }
    expect(previous, "at max tilt the edge should be strongly foreshortened").toBeLessThan(0.45);
  });

  test("pitching the phone up and down moves the map and the \"You\" marker together", async ({ page }) => {
    // Reported from the field as the "You" marker feeling detached from the map: lifting and
    // lowering the phone slid it up and down the screen while the map under it stood still.
    // Only the heading and the viewport used to trigger a main-canvas redraw, so a pure pitch
    // change repainted the overlay alone -- pins, radar and the "You" dot re-projected at the
    // new tilt on top of terrain still drawn at the old one. Anything far from the pivot sits
    // near the horizon, where a fraction of a degree moves it tens of pixels.
    const result = await page.evaluate(async () => {
      state.compassHeading = 0;
      state.compassHeadingTarget = 0;
      state.renderedNavigationHeading = 0;
      state.compassLastEventAt = performance.now();
      state.tiltBetaTarget = 20;
      state.tiltBetaSmoothed = 20;
      // Browsing a spot away from the GPS fix, as in the report: with the camera settled on a
      // browse anchor the heading-up fit stops changing, so the viewport-changed test that used
      // to be the only trigger for a main-canvas redraw reports nothing to do on every frame.
      const anchorLatitude = 51.6538 + 0.0135;
      const anchorLongitude = 0.0400;
      focusNearbyOnMapPoint(
        { longitude: anchorLongitude, latitude: anchorLatitude },
        projectLonLat(anchorLongitude, anchorLatitude)
      );
      await new Promise((resolve) => setTimeout(resolve, 900)); // let the browse slide land
      draw();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

      // Every overlay paint is checked against the tilt the map underneath it was last drawn
      // at: that is what "the two canvases share one camera" means in pixels.
      let overlayPaints = 0;
      let mismatchedPaints = 0;
      let worstGapDeg = 0;
      let userMarkerTravelPx = 0;
      let lastUserMarkerY = null;
      const originalDrawOverlay = drawOverlay;
      drawOverlay = function instrumentedDrawOverlay(...args) {
        overlayPaints += 1;
        const gap = Math.abs(tiltRotateXDeg() - state.renderedTiltRotateXDeg);
        worstGapDeg = Math.max(worstGapDeg, gap);
        if (gap > 0.05) mismatchedPaints += 1;
        const markerY = worldToScreenForOverlayTilted(state.userLocation.point).y;
        if (lastUserMarkerY !== null) userMarkerTravelPx += Math.abs(markerY - lastUserMarkerY);
        lastUserMarkerY = markerY;
        return originalDrawOverlay.apply(this, args);
      };

      // The phone is lifted, then lowered, with no turn at all -- webkitCompassHeading is held
      // at 0 throughout, so nothing but the pitch is moving.
      const sweep = [25, 35, 45, 55, 65, 55, 45, 35, 25, 20];
      for (const beta of sweep) {
        onDeviceOrientation({ beta, gamma: 0, alpha: 0, webkitCompassHeading: 0 });
        for (let frame = 0; frame < 4; frame += 1) {
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        }
      }

      drawOverlay = originalDrawOverlay;
      return { overlayPaints, mismatchedPaints, worstGapDeg, userMarkerTravelPx };
    });

    expect(result.overlayPaints, "the overlay should have been repainted while the phone pitched").toBeGreaterThan(0);
    // The marker really does travel a long way up and down the screen as the camera pitches --
    // that is the perspective doing its job. What must never happen is it travelling while the
    // map it sits on stays where it was.
    expect(result.userMarkerTravelPx, "sanity: the pitch sweep should move the marker at all").toBeGreaterThan(50);
    expect(result.mismatchedPaints, "no overlay frame may be painted over a map drawn at a different tilt").toBe(0);
    expect(result.worstGapDeg).toBeLessThanOrEqual(0.05);
  });

  test("tapping a spot in 3D slides the map there smoothly", async ({ page }) => {
    // The browse-origin slide holds the walking-radius circle still and moves the map behind it.
    // Two separate things used to break that in 3D, both reported as the move "jumping" rather
    // than repositioning:
    //
    //  - the camera switched between its two framings -- the first-person one, which lets the
    //    ground behind you run off the bottom edge, and the browse one, which frames the whole
    //    area around the tapped spot -- the moment the tap landed, a whole slide before the pivot
    //    had moved, throwing the map several-fold out of zoom on one frame;
    //  - the map was repainted four times per animation frame for the whole slide, so it
    //    actually moved at a fraction of the frame rate (see draw(), js/renderer.js).
    await tiltTo(page, 60);

    // Open ground well off to one side of the pivot, so the tap moves the browse origin (rather
    // than selecting whatever it landed on) and there is a real move for the camera to make.
    // Which pixels are open ground depends on the live dataset and the settled 3D camera, so the
    // spot is found by asking the same hit test the tap itself will run.
    const target = await page.evaluate(() => {
      stopViewportAnimation();
      const rect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
      for (const fx of [0.2, 0.25, 0.15, 0.3, 0.75, 0.8]) {
        for (const fy of [0.35, 0.3, 0.4, 0.25, 0.45]) {
          const point = { x: rect.x + rect.width * fx, y: rect.y + rect.height * fy };
          if (findHit(point, screenToWorld(point.x, point.y)).type === "none") return point;
        }
      }
      return null;
    });
    test.skip(!target, "no open ground on screen at this camera");

    // Watch the zoom and the repaint count on every animation frame from the tap until the
    // slide has landed.
    const samplingDone = page.evaluate(() => new Promise((resolve) => {
      const frames = [];
      const originalDraw = window.draw;
      let paints = 0;
      window.draw = function patchedDraw(...args) {
        paints += 1;
        return originalDraw.apply(this, args);
      };
      const startedAt = performance.now();
      const sample = () => {
        frames.push({ scale: state.viewport.scale, paints });
        paints = 0;
        if (performance.now() - startedAt < 1200) requestAnimationFrame(sample);
        else {
          window.draw = originalDraw;
          resolve(frames);
        }
      };
      requestAnimationFrame(sample);
    }));

    await tapCanvasPoint(page, target);
    const frames = await samplingDone;

    const anchored = await page.evaluate(() => Boolean(state.nearbyAnchor));
    expect(anchored, "sanity: the tap should have moved the nearby browse origin").toBe(true);

    const painted = frames.filter((frame) => frame.paints > 0);
    // More than one, not more than two: a painted-frame count is partly a statement about the
    // machine, and a 2-vCPU CI runner gets through about three animation frames per second on
    // this dataset -- the whole 1200ms sample comes back three to five frames wide there,
    // against seventy-odd on a desktop, with the first of them spent waiting for the tap. "More
    // than 2" asked such a runner for every frame it had and failed when it was a frame short.
    // What this is guarding is that the slide painted as it moved rather than landing in a
    // single jump, and two painted frames already says that; the assertions that carry the real
    // weight -- one paint per frame, and no framing switch mid-slide -- are unchanged below.
    expect(painted.length, "sanity: the slide should have painted the map").toBeGreaterThan(1);
    const worstPaints = Math.max(...painted.map((frame) => frame.paints));
    expect(worstPaints, "the map must be painted once per frame, not several times over").toBe(1);

    let worstStep = 1;
    for (let i = 1; i < frames.length; i += 1) {
      worstStep = Math.max(worstStep, frames[i].scale / frames[i - 1].scale, frames[i - 1].scale / frames[i].scale);
    }
    // An eased zoom moves a few percent per frame. A framing switch shows up here as a step of
    // several times over -- which is what reads as a jump on screen.
    expect(worstStep, `worst single-frame zoom step was ${worstStep.toFixed(2)}x`).toBeLessThan(1.35);
  });

  test("the canvas carries no CSS 3D transform of its own", async ({ page }) => {
    // A leftover perspective()/rotateX() would tilt the already-projected pixels twice.
    await tiltTo(page, 85);
    const transform = await page.evaluate(() => els.canvas.style.transform || "");
    expect(transform).not.toMatch(/perspective\(|rotateX\(/);
  });
});
