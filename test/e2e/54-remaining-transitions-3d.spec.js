// @ts-check
// In 3D the last transition paths settle like the rest: the on-screen keyboard on Report leaves the camera
// alone and leaves nothing stale behind, selecting a place while browsing a spot lands where the same
// selection from plain Nearby does in one move, and a filter-only change inside an expanded group refits
// to the new filter in one move.
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle, waitForFrames } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6538, longitude: 0.0400, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "no-preference" }); });

async function hold3d(page) {
  await page.evaluate(() => {
    state.map3dEnabled = true;
    state.compassHeadingTarget = 20;
    state.compassHeading = 20;
    state.renderedNavigationHeading = 20;
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
  expect(Math.abs(a.scale - b.scale) / b.scale, `${label}: scale`).toBeLessThan(0.02);
  expect(Math.abs(a.tx - b.tx), `${label}: tx`).toBeLessThan(4);
  expect(Math.abs(a.ty - b.ty), `${label}: ty`).toBeLessThan(4);
}

async function waitForCameraStill(page) {
  await page.waitForFunction(() => {
    const v = state.viewport;
    const key = `${v.scale.toFixed(5)}|${v.tx.toFixed(1)}|${v.ty.toFixed(1)}`;
    if (window.__stillKey === key && state.viewportAnimationTo == null && !state.nearbyOriginTransition) window.__stillRuns = (window.__stillRuns || 0) + 1;
    else { window.__stillKey = key; window.__stillRuns = 0; }
    return window.__stillRuns >= 20;
  }, null, { polling: "raf", timeout: 15000 });
}

test("the on-screen keyboard on Report in 3D leaves the camera alone and closing it leaves no stale framing", async ({ page }) => {
  await setup(page, "/nearby");
  await hold3d(page);
  const full = page.viewportSize();
  await page.click("#reportToggle");
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  const open = await view(page);
  await countMoves(page);
  await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) });
  await waitForFrames(page, 20);
  expect(await moves(page), "keyboard opening: no move").toBe(0);
  expectSame(await view(page), open, "keyboard opening: camera holds");
  await page.setViewportSize(full);
  await waitForFrames(page, 20);
  expect(await moves(page), "keyboard closing: no move").toBe(0);
  expectSame(await view(page), open, "keyboard closing: camera holds");
  await page.click("#nearbyToggle");
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  const closed = await view(page);
  const direct = await page.evaluate(() => {
    alignHeadingUpNavigationViewport({ force: true, animate: false });
    return { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
  });
  expectSame(closed, direct, "Report closed: the Nearby framing at the restored size");
});

const BROWSE_HASH = "#near=51.655204,0.065731&label=Far";

test("selecting a place while browsing a spot in 3D is one move that ends where the same selection from Nearby does", async ({ page }) => {
  await setup(page, "/nearby");
  await hold3d(page);
  await page.evaluate((h) => navigateInApp(`/nearby/${h}`), BROWSE_HASH);
  await page.waitForFunction(() => state.nearbyAnchor != null);
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  const row = page.locator("#inspectorBody [data-overview-type]:not([data-overview-type=cow])[data-overview-key]").first();
  await expect(row).toBeVisible();
  await countMoves(page);
  await row.click();
  await page.waitForFunction(() => Boolean(state.selected));
  await page.waitForFunction(() => state.routingGraphReady === true, null, { timeout: 30000 });
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  const browsed = await view(page);
  const browsedMoves = await moves(page);
  const path = await page.evaluate(() => location.pathname);
  expect(browsedMoves, "one camera move").toBeLessThanOrEqual(1);

  // The same place chosen from plain Nearby.
  await page.evaluate(() => navigateInApp("/nearby"));
  await page.waitForFunction(() => !state.selected && !state.nearbyAnchor);
  await waitForUiToSettle(page);
  await page.evaluate((p) => navigateInApp(p), path);
  await page.waitForFunction(() => Boolean(state.selected));
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  expectSame(browsed, await view(page), "browse selection vs Nearby selection");
});

test("a filter-only change inside an expanded group refits to the new filter in one move and leaves the group framing", async ({ page }) => {
  await setup(page, "/nearby");
  await hold3d(page);
  await waitForUiToSettle(page);
  const expanded = await page.evaluate(() => {
    const markers = buildMapMarkers(activeIconLookup(), worldToScreen);
    const marker = markers.filter((m) => m.items.length > 1).sort((x, y) => x.items.length - y.items.length)[0];
    if (!marker) return false;
    const itemsByType = clusterItemsByType({ items: marker.items });
    const types = Object.keys(itemsByType);
    focusNearbyOnClusterGroup({ items: marker.items, itemsByType, itemType: types.length > 1 ? "_mega" : types[0] });
    return Boolean(state.clusterExpanded);
  });
  expect(expanded, "a group expands").toBe(true);
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  await countMoves(page);
  await page.evaluate(() => navigateInApp("/nearby/pubs/"));
  await page.waitForFunction(() => state.overviewFilters.join(",") === "pubs");
  await waitForUiToSettle(page);
  await waitForCameraStill(page);
  expect(await moves(page), "one camera move").toBe(1);
  expect(await page.evaluate(() => Boolean(state.clusterExpanded)), "the group is left").toBe(false);
  const landed = await view(page);
  const direct = await page.evaluate(() => {
    alignHeadingUpNavigationViewport({ force: true, animate: false });
    return { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
  });
  expectSame(landed, direct, "lands on the pubs framing");
});
