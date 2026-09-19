// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

// A GPS fix inside Epping Forest, so heading-up navigation can engage.
const FOREST_LOCATION = { latitude: 51.6538, longitude: 0.0400, accuracy: 10 };

test.describe("compass reliability", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await page.evaluate(() => {
      state.compassHeadingSource = HEADING_SOURCE_NONE;
      state.compassHeading = null;
      state.compassHeadingTarget = null;
      state.compassLastEventAt = null;
      resetCompassCalibration();
    });
  });

  test("the map keeps pointing where the user is facing while a drifting sensor stream fires alongside the real one", async ({ page }) => {
    // On Android both events fire, interleaved, many times a second. Only the absolute one
    // measures from north; the other starts from an arbitrary zero and drifts. Feeding both
    // into one heading is what made the compass read "a bit off" one moment and completely
    // wrong the next.
    const readings = await page.evaluate(async () => {
      const targets = [];
      for (let i = 0; i < 8; i += 1) {
        window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", {
          alpha: 270, beta: 10, gamma: 0, absolute: true,
        })); // facing east
        targets.push(state.compassHeadingTarget);
        window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", {
          alpha: 0, beta: 10, gamma: 0, absolute: false,
        })); // the drifting stream, a quarter-turn out
        targets.push(state.compassHeadingTarget);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      }
      return { targets, heading: state.compassHeading, source: state.compassHeadingSource };
    });

    expect(readings.source, "the north-referenced stream must win").toBe(2);
    const settled = readings.targets.filter((value) => value !== null);
    expect(settled.length, "sanity: the absolute readings should have been trusted").toBeGreaterThan(0);
    for (const target of settled) {
      expect(target, "the heading must never swing to the drifting stream's bearing").toBe(90);
    }
    expect(Math.abs(readings.heading - 90), "the smoothed heading settles on east, not between the two").toBeLessThan(5);
  });

  test("a heading already trusted from the drifting stream is dropped the moment a real bearing arrives", async ({ page }) => {
    const result = await page.evaluate(async () => {
      // A phone whose relative stream starts first: the app trusts it rather than leaving the
      // user with no compass at all.
      for (let i = 0; i < 5; i += 1) {
        window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", {
          alpha: 0, beta: 10, gamma: 0, absolute: false,
        }));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const relativeHeading = state.compassHeading;

      window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", {
        alpha: 180, beta: 10, gamma: 0, absolute: true,
      }));
      return { relativeHeading, afterUpgrade: state.compassHeading, source: state.compassHeadingSource };
    });

    expect(result.relativeHeading, "a drifting heading beats no heading at all").not.toBeNull();
    expect(result.source).toBe(2);
    expect(
      result.afterUpgrade,
      "the two streams measure from different zeroes, so the map goes north-up and re-calibrates rather than keeping a bearing it now knows is arbitrary"
    ).toBeNull();
  });

  test("the map starts redrawing again after an animation frame is dropped", async ({ page }) => {
    // Every loop in the app parks its pending rAF handle on state as a duplicate-loop guard.
    // A frame that never runs -- dropped on an app switch iOS never announced, or a callback
    // that threw -- leaves the handle set for ever and the guard becomes a "no loop at all"
    // lock: the map stops moving and only a reload brings it back.
    const result = await page.evaluate(async () => {
      const wedgedHandle = 999999; // a handle naming a frame that will never run
      state.animationFrame = wedgedHandle;
      state.animationFrameRequestedAt = performance.now() - (ANIMATION_FRAME_WEDGED_MS + 1000);
      state.viewportAnimationTo = { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };

      requestDraw();
      const handleWhileWedged = state.animationFrame;

      const recovered = recoverWedgedAnimationFrames();
      const cameraFitBlocked = selectionCameraTransitionActive();

      let paints = 0;
      const originalDraw = draw;
      draw = function countingDraw(...args) {
        paints += 1;
        return originalDraw.apply(this, args);
      };
      requestDraw();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      draw = originalDraw;

      return { handleWhileWedged, wedgedHandle, paints, recovered, cameraFitBlocked };
    });

    expect(
      result.handleWhileWedged,
      "the stale handle is the duplicate-loop guard, so requestDraw refuses to queue anything -- this is the freeze"
    ).toBe(result.wedgedHandle);
    expect(result.recovered, "the foreground watchdog should recognise the wedge").toBe(true);
    expect(result.paints, "the map must paint again without a reload").toBeGreaterThan(0);
    expect(
      result.cameraFitBlocked,
      "a stranded camera animation keeps alignHeadingUpNavigationViewport bailing on every call"
    ).toBe(false);
  });
});
