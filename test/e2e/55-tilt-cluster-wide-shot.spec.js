// @ts-check
// In 3D tilt, tapping a cluster group far behind the user flies the camera in two legs (a wide shot that
// relates the user and the group, then a zoom in on the group). Sampled frame by frame: nothing cuts across
// the view, the user and the group are both on screen where the wide shot lands, and the camera ends zoomed
// in on the group.
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6538, longitude: 0.0400, accuracy: 10 };
// A share of the focus rect's short side. The same bound the unit tests hold the first frame to
// (FIRST_FRAME_STEP_SHARE in test/forest-finds.test.js).
const MAX_STEP_SHARE = 0.4;

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "no-preference" }); });

test("in 3D tilt, tapping a group about 600m behind the user flies without a cut, shows both places at the wide shot, then zooms in on the group", async ({ page }) => {
  await setup(page, "/nearby");
  await page.evaluate(() => {
    state.map3dEnabled = true;
    state.compassHeadingTarget = 0;
    state.compassHeading = 0;
    state.renderedNavigationHeading = 0;
    state.tiltBetaTarget = 55;
    state.tiltBetaSmoothed = 55;
    window.__keepCompassFresh = setInterval(() => { state.compassLastEventAt = performance.now(); }, 50);
    state.compassLastEventAt = performance.now();
  });
  await waitForUiToSettle(page);
  expect(await page.evaluate(() => tiltActive()), "3D tilt is on").toBe(true);

  // Two trees about 600m south of the user, behind a north-facing camera.
  const result = await page.evaluate(async () => {
    const user = state.userLocation;
    const lat = user.latitude - 0.0054;
    const lon = user.longitude;
    const make = (id, la) => ({ id, commonName: "Oak", latitude: la, longitude: lon, point: projectLonLat(lon, la) });
    const oak1 = make("e2e-wide-oak1", lat);
    const oak2 = make("e2e-wide-oak2", lat + 0.00001797);
    state.trees.push(oak1, oak2);
    selectOverview();
    ensureOverviewTargetsVisible({ animate: false, force: true });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const userPoint = user.point;
    const sample = () => ({
      scale: state.viewport.scale,
      user: worldToScreen(userPoint),
      group: worldToScreen(oak1.point),
    });
    const startScale = state.viewport.scale;
    const frames = [sample()];
    focusNearbyOnClusterGroup({ itemType: "tree", items: [oak1, oak2] });
    let still = 0;
    await new Promise((resolve) => {
      const tick = () => {
        frames.push(sample());
        const moving = state.viewportAnimationTo != null || state.nearbyOriginTransition != null;
        still = moving ? 0 : still + 1;
        if (still >= 10 || frames.length > 600) resolve(undefined);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const r = bestVisibleCanvasRect();
    return { frames, startScale, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  });

  const { frames, startScale, rect } = result;
  const finite = (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && !p.clipped;
  const inRect = (p) => finite(p) && p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
  const short = Math.min(rect.width, rect.height);
  const bound = short * MAX_STEP_SHARE;
  expect(frames.length, "the tap runs an animated camera move").toBeGreaterThan(5);

  // (a) No per-frame cut of the user's marker or the group.
  for (const key of ["user", "group"]) {
    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1][key];
      const b = frames[i][key];
      if (!finite(a) || !finite(b)) continue;
      const step = Math.hypot(a.x - b.x, a.y - b.y);
      expect(step, `frame ${i}: the ${key} steps ${step.toFixed(0)}px (bound ${bound.toFixed(0)}px)`).toBeLessThan(bound);
    }
  }

  // (b) Where the camera is pulled out furthest (the wide shot), both places are on screen.
  const scales = frames.map((f) => f.scale);
  const lowest = Math.min(...scales);
  expect(lowest, "the camera pulls out to relate the two places").toBeLessThan(startScale * 0.95);
  const wide = frames[scales.indexOf(lowest)];
  expect(inRect(wide.user), `the user is on screen at the wide shot (${JSON.stringify(wide.user)})`).toBe(true);
  expect(inRect(wide.group), `the group is on screen at the wide shot (${JSON.stringify(wide.group)})`).toBe(true);

  // (c) It then zooms in, and the group is on screen at the end.
  const last = frames[frames.length - 1];
  expect(last.scale, "the camera ends zoomed in on the group").toBeGreaterThan(lowest * 1.3);
  expect(inRect(last.group), `the group is on screen at the end (${JSON.stringify(last.group)})`).toBe(true);
});
