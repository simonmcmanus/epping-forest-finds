// @ts-check
// In 3D: the compass arriving, a window resize / on-screen keyboard, and a GPS fix landing mid-move each
// leave the camera on the framing the same state reaches any other way, with one move at most and no snap.
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle, waitForFrames } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6538, longitude: 0.0400, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "no-preference" }); });

async function enter3d(page, { heading = 0 } = {}) {
  await page.evaluate((h) => {
    state.map3dEnabled = true;
    state.compassHeadingTarget = h;
    state.compassHeading = h;
    state.renderedNavigationHeading = h;
    state.tiltBetaTarget = 60;
    state.tiltBetaSmoothed = 60;
    window.__keepCompassFresh = setInterval(() => { state.compassLastEventAt = performance.now(); }, 50);
    state.compassLastEventAt = performance.now();
  }, heading);
  await waitForUiToSettle(page);
  expect(await page.evaluate(() => tiltActive()), "3D tilt is on").toBe(true);
}

async function startTrace(page) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__moveCount = 0;
    if (!window.__moveWrapped) {
      window.__moveWrapped = true;
      const original = window.moveCamera;
      window.moveCamera = function (...args) { window.__moveCount += 1; return original.apply(this, args); };
    }
    const sample = () => {
      window.__frames.push({
        heading: state.renderedNavigationHeading,
        scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty,
      });
      window.__traceRaf = requestAnimationFrame(sample);
    };
    sample();
  });
}

async function stopTrace(page) {
  return page.evaluate(() => {
    cancelAnimationFrame(window.__traceRaf);
    return { frames: window.__frames, moves: window.__moveCount };
  });
}

const view = (page) => page.evaluate(() => ({ scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty }));

function expectSame(a, b, label) {
  expect(Math.abs(a.scale - b.scale) / b.scale, `${label}: scale`).toBeLessThan(0.01);
  expect(Math.abs(a.tx - b.tx), `${label}: tx`).toBeLessThan(2);
  expect(Math.abs(a.ty - b.ty), `${label}: ty`).toBeLessThan(2);
}

/** The camera has stopped: nothing is tweening and the viewport has held for a run of frames. */
async function waitForCameraStill(page) {
  await page.waitForFunction(() => {
    const v = state.viewport;
    const key = `${v.scale.toFixed(5)}|${v.tx.toFixed(1)}|${v.ty.toFixed(1)}`;
    if (window.__stillKey === key && state.viewportAnimationTo == null) window.__stillRuns = (window.__stillRuns || 0) + 1;
    else { window.__stillKey = key; window.__stillRuns = 0; }
    return window.__stillRuns >= 20;
  }, null, { polling: "raf", timeout: 15000 });
}

/** The framing the current state has when fitted directly, with no animation. */
function directFraming(page) {
  return page.evaluate(() => {
    alignHeadingUpNavigationViewport({ force: true, animate: false });
    return { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
  });
}

async function selectPlace(page) {
  const row = page.locator("#inspectorBody [data-overview-type]:not([data-overview-type=cow])[data-overview-key]").first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForFunction(() => Boolean(state.selected));
}

test("the first compass heading of the session shows the map at that heading without spinning it", async ({ page }) => {
  await setup(page, "/nearby");
  await enter3d(page);
  await page.evaluate(() => {
    state.compassHeadingTarget = NaN;
    state.compassHeading = NaN;
    state.renderedNavigationHeading = null;
    state.headingUpEntryAnim = null;
    state.headingUpEverEntered = false;
  });
  await waitForUiToSettle(page);
  await startTrace(page);
  await page.evaluate(() => {
    state.compassHeadingTarget = 130;
    state.compassHeading = 130;
    state.compassLastEventAt = performance.now();
    startCompassSmoothing();
    requestDraw();
  });
  await waitForFrames(page, 30);
  await waitForUiToSettle(page);
  const { frames, moves } = await stopTrace(page);
  const shown = frames.map((f) => f.heading).filter((h) => Number.isFinite(h));
  expect(shown.length, "the map was drawn at a heading").toBeGreaterThan(0);
  for (const h of shown) expect(Math.abs(h - 130), "never spins in from north").toBeLessThan(1);
  expect(moves, "at most one camera move").toBeLessThanOrEqual(1);
});

test("a later compass arrival turns the map in and moves the camera at most once, landing on the Nearby framing", async ({ page }) => {
  await setup(page, "/nearby");
  await enter3d(page);
  await page.evaluate(() => {
    state.compassHeadingTarget = NaN;
    state.compassHeading = NaN;
    state.renderedNavigationHeading = null;
    state.headingUpEverEntered = true;
  });
  await waitForUiToSettle(page);
  await startTrace(page);
  await page.evaluate(() => {
    state.compassHeadingTarget = 130;
    state.compassHeading = 130;
    state.compassLastEventAt = performance.now();
    startCompassSmoothing();
    requestDraw();
  });
  await waitForFrames(page, 10);
  await waitForCameraStill(page);
  const { moves } = await stopTrace(page);
  expect(moves, "at most one camera move").toBeLessThanOrEqual(1);
  const landed = await view(page);
  expectSame(landed, await directFraming(page), "lands on the direct Nearby framing");
});

test("selecting a place with the compass live is one camera move that lands on the direct framing", async ({ page }) => {
  await setup(page, "/nearby");
  await enter3d(page, { heading: 70 });
  await page.evaluate(() => { state.headingUpEverEntered = true; ensureRoutingGraph(); });
  // The real route is known before the selection, as it is for any later selection in a session.
  await page.waitForFunction(() => state.routingGraphReady === true, null, { timeout: 30000 });
  await startTrace(page);
  await selectPlace(page);
  await page.waitForFunction(() => state.routingGraphReady === true, null, { timeout: 30000 });
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  const { moves } = await stopTrace(page);
  expect(moves, "one camera move for the selection").toBeLessThanOrEqual(1);
  const landed = await view(page);
  expectSame(landed, await directFraming(page), "lands on the direct selected framing");
});

test("resizing the window in 3D refits at once with no animation and does not fall back to the whole-forest fit", async ({ page }) => {
  await setup(page, "/nearby");
  await enter3d(page, { heading: 20 });
  await startTrace(page);
  await page.setViewportSize({ width: 1000, height: 640 });
  await waitForFrames(page, 4);
  await waitForCameraStill(page);
  const { frames, moves } = await stopTrace(page);
  expect(moves, "a resize starts no tween").toBe(0);
  expect(await page.evaluate(() => state.viewportAnimationTo != null), "no animation running").toBe(false);
  const landed = await view(page);
  const base = await page.evaluate(() => state.baseFitScale);
  expect(landed.scale, "not the whole-forest fit").toBeGreaterThan(base * 1.5);
  expectSame(landed, await directFraming(page), "matches the framing fitted directly at the new size");
  expect(frames.length).toBeGreaterThan(0);
});

test("resizing with a place selected in 3D refits at once with no animation", async ({ page }) => {
  await setup(page, "/nearby");
  await enter3d(page, { heading: 20 });
  await selectPlace(page);
  await page.waitForFunction(() => state.routingGraphReady === true, null, { timeout: 30000 });
  await waitForUiToSettle(page);
  await startTrace(page);
  await page.setViewportSize({ width: 1000, height: 640 });
  await waitForFrames(page, 4);
  await waitForCameraStill(page);
  const { moves } = await stopTrace(page);
  expect(moves, "a resize starts no tween").toBe(0);
  expect(await page.evaluate(() => state.viewportAnimationTo != null), "no animation running").toBe(false);
  const landed = await view(page);
  expectSame(landed, await directFraming(page), "matches the framing fitted directly at the new size");
});

test("a GPS fix arriving mid-move neither restarts nor snaps the move, and the camera lands on the right framing", async ({ page, context }) => {
  await setup(page, "/nearby");
  await enter3d(page, { heading: 20 });
  await page.evaluate(() => { state.headingUpEverEntered = true; });
  await waitForUiToSettle(page);
  const target = await directFraming(page);
  // Start a move from a wider framing, as a returning refit does.
  await page.evaluate((t) => {
    state.viewport.scale = t.scale * 0.6;
    state.viewport.tx = t.tx + 120;
    state.viewport.ty = t.ty + 90;
    window.__tweens = [];
    ensureOverviewTargetsVisible({ animate: true, durationMs: 1200, force: true });
    window.__firstTo = state.viewportAnimationTo;
  }, target);
  await startTrace(page);
  await waitForFrames(page, 12);
  const flightBefore = await page.evaluate(() => state.viewportAnimationTo);
  await context.setGeolocation({ latitude: FOREST_LOCATION.latitude + 0.0004, longitude: FOREST_LOCATION.longitude, accuracy: 10 });
  await waitForFrames(page, 3);
  const flightAfter = await page.evaluate(() => state.viewportAnimationTo);
  expect(flightAfter, "the move was still in flight when the fix landed").not.toBeNull();
  expect(flightAfter, "the fix does not restart the move").toEqual(flightBefore);
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  const { frames, moves } = await stopTrace(page);
  expect(moves, "exactly one follow-up ease once the first has landed").toBe(1);
  // No snap: the scale never steps by more than a fifth of the whole travel in one frame.
  const travel = Math.abs(target.scale - target.scale * 0.6);
  for (let i = 1; i < frames.length; i += 1) {
    expect(Math.abs(frames[i].scale - frames[i - 1].scale), "no per-frame snap").toBeLessThan(travel * 0.2);
  }
  expectSame(await view(page), await directFraming(page), "lands on the framing reached without the interruption");
});

test("a GPS fix mid-move then Settings opening before the move lands leaves the map still under Settings", async ({ page, context }) => {
  await setup(page, "/nearby");
  await enter3d(page, { heading: 20 });
  await page.evaluate(() => { state.headingUpEverEntered = true; });
  await waitForUiToSettle(page);
  const target = await directFraming(page);
  await page.evaluate((t) => {
    state.viewport.scale = t.scale * 0.6;
    state.viewport.tx = t.tx + 120;
    state.viewport.ty = t.ty + 90;
    ensureOverviewTargetsVisible({ animate: true, durationMs: 1200, force: true });
  }, target);
  await waitForFrames(page, 8);
  await context.setGeolocation({ latitude: FOREST_LOCATION.latitude + 0.0004, longitude: FOREST_LOCATION.longitude, accuracy: 10 });
  await waitForFrames(page, 3);
  await page.evaluate(() => { state.selected = { type: "settings" }; });
  await waitForCameraStill(page);
  const landed = await view(page);
  await startTrace(page);
  await waitForFrames(page, 40);
  const { moves } = await stopTrace(page);
  expect(moves, "no follow-up move under Settings").toBe(0);
  expectSame(await view(page), landed, "map holds under Settings");
  expectSame(landed, target, "the first move still landed on its own target");
});

test("resizing while Report is open leaves the camera still", async ({ page }) => {
  await setup(page, "/nearby");
  await enter3d(page, { heading: 20 });
  await page.click("#reportToggle");
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  const before = await view(page);
  await startTrace(page);
  await page.setViewportSize({ width: 1000, height: 640 });
  await waitForFrames(page, 20);
  const { moves } = await stopTrace(page);
  expect(moves, "no move").toBe(0);
  expectSame(await view(page), before, "camera holds under Report");
});
