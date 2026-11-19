// @ts-check
// In 3D the secondary screens and the inspector's minimise/expand each cause at most one camera move.
// The camera holds still while Search is open (GPS and compass ticks included), Settings and Back to
// Nearby are one move each, minimising the inspector does not move the camera, and expanding it
// recentres once with the place clear of the panel. Reduced motion settles at once.
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle, waitForFrames } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6538, longitude: 0.0400, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "no-preference" }); });

async function hold3d(page) {
  await page.evaluate(() => {
    state.map3dEnabled = true;
    state.compassHeadingTarget = 0;
    state.compassHeading = 0;
    state.renderedNavigationHeading = 0;
    state.tiltBetaTarget = 60;
    state.tiltBetaSmoothed = 60;
    window.__keepCompassFresh = setInterval(() => { state.compassLastEventAt = performance.now(); }, 50);
    state.compassLastEventAt = performance.now();
  });
  await waitForUiToSettle(page);
  expect(await page.evaluate(() => tiltActive()), "3D tilt is on").toBe(true);
}

async function countMoves(page) {
  await page.evaluate(() => {
    window.__moveCount = 0;
    if (!window.__moveWrapped) {
      window.__moveWrapped = true;
      const original = window.moveCamera;
      window.moveCamera = function (...args) { window.__moveCount += 1; return original.apply(this, args); };
    }
  });
}
const moves = (page) => page.evaluate(() => window.__moveCount);
const view = (page) => page.evaluate(() => ({ scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty }));

function expectSame(a, b, label) {
  expect(Math.abs(a.scale - b.scale) / b.scale, `${label}: scale`).toBeLessThan(0.01);
  expect(Math.abs(a.tx - b.tx), `${label}: tx`).toBeLessThan(2);
  expect(Math.abs(a.ty - b.ty), `${label}: ty`).toBeLessThan(2);
}

test("Search in 3D holds the camera through opening, GPS and compass ticks", async ({ page }) => {
  await setup(page, "/nearby");
  await hold3d(page);
  const before = await view(page);
  await countMoves(page);
  await page.click("#searchToggle");
  await page.waitForFunction(() => state.searchScreenOpen);
  await waitForUiToSettle(page);
  await page.evaluate(() => {
    state.compassHeadingTarget = 40;
    state.compassHeading = 40;
    state.renderedNavigationHeading = 40;
    state.compassLastEventAt = performance.now();
  });
  await waitForFrames(page, 10);
  await page.evaluate(() => {
    const p = state.userLocation.point;
    window.dispatchEvent(new Event("resize"));
    if (typeof alignHeadingUpNavigationViewport === "function") alignHeadingUpNavigationViewport();
    if (typeof ensureOverviewTargetsVisible === "function") ensureOverviewTargetsVisible();
    return p;
  });
  await waitForUiToSettle(page);
  expect(await moves(page), "no camera move while Search is open").toBe(0);
  expectSame(await view(page), before, "Search holds the Nearby camera");
});

test("closing Search in 3D is one move back to the Nearby framing", async ({ page }) => {
  await setup(page, "/nearby");
  await hold3d(page);
  await page.click("#searchToggle");
  await page.waitForFunction(() => state.searchScreenOpen);
  await waitForUiToSettle(page);
  await countMoves(page);
  await page.click("#nearbyToggle");
  await page.waitForFunction(() => !state.searchScreenOpen);
  await waitForUiToSettle(page);
  expect(await moves(page), "one camera move").toBeLessThanOrEqual(1);
  const landed = await view(page);
  const wanted = await page.evaluate(() => {
    alignHeadingUpNavigationViewport({ force: true, animate: false });
    return { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
  });
  expectSame(landed, wanted, "lands on the Nearby framing");
});

for (const screen of [{ id: "#settingsToggle", name: "Settings" }, { id: "#reportToggle", name: "Community" }]) {
  test(`${screen.name} in 3D opens with at most one camera move and closes with at most one`, async ({ page }) => {
    await setup(page, "/nearby");
    await hold3d(page);
    await countMoves(page);
    await page.click(screen.id);
    await waitForUiToSettle(page);
    expect(await moves(page), "opening: one move").toBeLessThanOrEqual(1);
    await page.evaluate(() => { window.__moveCount = 0; });
    await page.click("#nearbyToggle");
    await waitForUiToSettle(page);
    expect(await moves(page), "closing: one move").toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => tiltActive()), "3D stays on").toBe(true);
  });
}

async function selectPlace(page) {
  await setup(page, "/nearby");
  await hold3d(page);
  const row = page.locator("#inspectorBody [data-overview-type]:not([data-overview-type=cow])[data-overview-key]").first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForFunction(() => Boolean(state.selected));
  await page.waitForFunction(() => state.routingGraphReady === true, null, { timeout: 30000 });
  await waitForUiToSettle(page);
}

test("minimising the inspector does not move the camera and expanding recentres once with the place clear of the panel", async ({ page }) => {
  await selectPlace(page);
  const open = await view(page);
  await countMoves(page);
  await page.evaluate(() => setInspectorMinimized(true));
  await waitForUiToSettle(page);
  await waitForFrames(page, 20);
  expect(await moves(page), "minimising: no move").toBe(0);
  expectSame(await view(page), open, "minimising leaves the camera");

  await page.evaluate(() => setInspectorMinimized(false));
  await waitForUiToSettle(page);
  await waitForFrames(page, 20);
  await waitForUiToSettle(page);
  expect(await moves(page), "expanding: exactly one move").toBe(1);
  const inRect = await page.evaluate(() => {
    const rect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
    const p = worldToScreen(selectedCompassTarget().point);
    return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
  });
  expect(inRect, "place is above the inspector").toBe(true);
});

test("with reduced motion, expanding the inspector settles at once", async ({ page }) => {
  await selectPlace(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => setInspectorMinimized(true));
  await waitForUiToSettle(page);
  await page.evaluate(() => setInspectorMinimized(false));
  await waitForFrames(page, 4);
  expect(await page.evaluate(() => state.viewportAnimationTo != null), "no tween left running").toBe(false);
  const settled = await view(page);
  await waitForFrames(page, 10);
  expectSame(await view(page), settled, "camera has already settled");
});
