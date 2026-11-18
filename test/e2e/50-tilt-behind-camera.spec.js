// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6538, longitude: 0.0400, accuracy: 10 };

// Things behind the camera in the pitched 3D view (pins, roads, paths, the radar and the
// destination) must land on screen the way things ahead do: in order, without being thrown
// sideways to the screen edges or piled onto a single row. Measured through the same
// projection the canvas, pins and radar draw with, plus tapping back to the map.
test.describe("3D tilt: things behind the camera", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await page.evaluate(() => {
      state.map3dEnabled = true;
      const gate = document.getElementById("locationGate");
      if (gate && !gate.hidden) gate.hidden = true;
    });
  });

  for (const browsing of [false, true]) {
    for (const beta of [45, 60, 75]) {
      test(`behind points stay ordered and bounded at ${beta} degrees${browsing ? " while browsing" : ""}`, async ({ page }) => {
        const samples = await page.evaluate(async ({ b, browse }) => {
          state.compassHeadingTarget = 0;
          state.compassHeading = 0;
          state.renderedNavigationHeading = 0;
          state.compassLastEventAt = performance.now();
          state.tiltBetaTarget = b;
          state.tiltBetaSmoothed = b;
          if (browse) state.nearbyAnchor = { latitude: 51.6538, longitude: 0.04, point: state.userLocation.point, label: "here" };
          alignHeadingUpNavigationViewport({ force: true });
          draw();
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
          const dpr = pixelRatio();
          const user = worldToScreen(state.userLocation.point);
          const sideCss = 40;
          const out = [];
          // Distances behind the user, in CSS px of flat map, running well past the camera.
          for (const behindCss of [20, 60, 120, 200, 320, 500, 800, 1500, 4000]) {
            const world = {
              x: state.userLocation.point.x + (sideCss * dpr) / state.viewport.scale,
              y: state.userLocation.point.y + (behindCss * dpr) / state.viewport.scale,
            };
            const p = worldToScreen(world);
            out.push({ behindCss, sideMagnification: (p.x - user.x) / (sideCss * dpr), y: p.y - user.y });
          }
          return out;
        }, { b: beta, browse: browsing });

        for (const s of samples) {
          expect(s.sideMagnification, `x spread ${s.behindCss}px behind`).toBeLessThanOrEqual(3.5);
          expect(s.sideMagnification).toBeGreaterThan(0);
        }
        for (let i = 1; i < samples.length; i += 1) {
          expect(samples[i].y - samples[i - 1].y, `row ${samples[i].behindCss} vs ${samples[i - 1].behindCss}`).toBeGreaterThan(1);
        }
      });
    }
  }

  test("a tap on a spot behind the user resolves to that spot", async ({ page }) => {
    const result = await page.evaluate(async () => {
      state.compassHeadingTarget = 0;
      state.compassHeading = 0;
      state.renderedNavigationHeading = 0;
      state.compassLastEventAt = performance.now();
      state.tiltBetaTarget = 60;
      state.tiltBetaSmoothed = 60;
      alignHeadingUpNavigationViewport({ force: true });
      draw();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      const dpr = pixelRatio();
      const errs = [];
      for (const behindCss of [30, 80, 150, 300]) {
        const world = {
          x: state.userLocation.point.x + (30 * dpr) / state.viewport.scale,
          y: state.userLocation.point.y + (behindCss * dpr) / state.viewport.scale,
        };
        const p = worldToScreen(world);
        const back = screenToWorld(p.x, p.y);
        errs.push({ behindCss, err: Math.hypot(back.x - world.x, back.y - world.y) * state.viewport.scale / dpr });
      }
      return errs;
    });
    for (const r of result) expect(r.err, `${r.behindCss}px behind`).toBeLessThan(2);
  });
});
