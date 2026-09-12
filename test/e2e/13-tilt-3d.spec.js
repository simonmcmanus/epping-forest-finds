// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

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

  test("the walking radius ring lies on the ground plane and foreshortens with it", async ({ page }) => {
    // `ctx.arc()` takes one scalar radius, so it can only ever paint a true screen-space
    // circle: the ring looked identical at every tilt angle and read as standing up out of
    // the map rather than painted on it. Measured here from the pixels the ring actually
    // contributes — drawn once with it suppressed and once with it, then differenced — so
    // this tests what reaches the screen rather than re-deriving the projection.
    const measure = async (beta) => {
      await tiltTo(page, beta);
      return page.evaluate(() => {
        const canvas = els.canvas;
        const context = canvas.getContext("2d");
        // Let the viewport converge first: prepareCanvasForDraw can still adjust the fit on
        // the first draw after a tilt change, which would swamp the diff.
        for (let i = 0; i < 4; i += 1) { alignHeadingUpNavigationViewport(); draw(); }

        const real = window.drawWalkingRadius;
        window.drawWalkingRadius = () => {};
        draw();
        const without = context.getImageData(0, 0, canvas.width, canvas.height).data;
        window.drawWalkingRadius = real;
        draw();
        const withRing = context.getImageData(0, 0, canvas.width, canvas.height).data;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
        for (let y = 0; y < canvas.height; y += 2) {
          for (let x = 0; x < canvas.width; x += 2) {
            const i = ((y * canvas.width) + x) * 4;
            const delta = Math.abs(withRing[i] - without[i])
              + Math.abs(withRing[i + 1] - without[i + 1])
              + Math.abs(withRing[i + 2] - without[i + 2]);
            if (delta > 10) {
              count += 1;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        return { count, aspect: (maxY - minY) / (maxX - minX) };
      });
    };

    const flat = await measure(0);
    expect(flat.count, "the ring should be drawn on a flat map").toBeGreaterThan(0);
    expect(flat.aspect, "a flat map should paint the ring as a circle").toBeCloseTo(1, 1);

    let previous = flat.aspect;
    for (const beta of [40, 60, 85]) {
      const tilted = await measure(beta);
      expect(tilted.count, `the ring should still be drawn at beta ${beta}`).toBeGreaterThan(0);
      expect(tilted.aspect, `the ring should flatten further by beta ${beta}`).toBeLessThan(previous);
      previous = tilted.aspect;
    }
    expect(previous, "at max tilt the ring should be strongly foreshortened").toBeLessThan(0.45);
  });

  test("the canvas carries no CSS 3D transform of its own", async ({ page }) => {
    // A leftover perspective()/rotateX() would tilt the already-projected pixels twice.
    await tiltTo(page, 85);
    const transform = await page.evaluate(() => els.canvas.style.transform || "");
    expect(transform).not.toMatch(/perspective\(|rotateX\(/);
  });
});
