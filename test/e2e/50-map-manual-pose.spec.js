// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap, FIXTURE_TREE, waitForFrames } = require("./helpers");

// The map is the user's to move. A one-finger drag, a two-finger pinch, or a wheel/trackpad zoom on
// the canvas pins the camera where they left it (state.manualPose) on every screen, including
// Nearby with a compass heading. GPS fixes and compass turns do not pull it back. Only the
// walking-radius ring keeps a gesture of its own: a wheel or pinch within 24px of the ring
// resizes the radius.
const FOREST_LOCATION = { latitude: 51.665, longitude: 0.045, accuracy: 10 };
const NEXT_FIX = { latitude: 51.6656, longitude: 0.0458, accuracy: 10 };
const RING_BAND_CSS_PX = 24;

test.use({
  geolocation: FOREST_LOCATION,
  permissions: ["geolocation"],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

async function openNearby(page, path = "/nearby") {
  await skipOnboarding(page);
  await mockCowApi(page);
  await gotoAndWaitForMap(page, path);
  await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
  await page.evaluate(() => {
    const banner = document.getElementById("compassCalibrationBanner");
    if (banner) banner.hidden = true;
  });
}

async function setCompassHeading(page, heading = 90) {
  await page.evaluate((deg) => {
    state.compassHeading = deg;
    state.compassHeadingTarget = deg;
    state.compassLastEventAt = performance.now();
    alignHeadingUpNavigationViewport({ force: true });
  }, heading);
  await waitForFrames(page, 3);
  expect(await page.evaluate(() => headingUpActive())).toBe(true);
}

async function settle(page) {
  await page.waitForFunction(() => state.viewportAnimationFrame == null);
  await waitForFrames(page, 3);
}

const viewport = (page) => page.evaluate(() => ({
  scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty,
}));

// Client-space points on the visible map: one on the walking-radius ring, and one well clear of it
// (and of the sheet), each hit-tested so a real pointer lands on the canvas rather than the chrome.
async function mapProbe(page) {
  return page.evaluate((bandPx) => {
    const dpr = pixelRatio();
    const rect = (els.mapStage || els.canvas).getBoundingClientRect();
    const ring = walkingRadiusCirclePoints(64).map((p) => worldToScreen(p));
    const toClient = (p) => ({ x: rect.left + p.x / dpr, y: rect.top + p.y / dpr });
    const ringDistance = (c) => Math.min(...ring.map((p, i) => {
      const a = toClient(p);
      const b = toClient(ring[(i + 1) % ring.length]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(c.x - (a.x + t * dx), c.y - (a.y + t * dy));
    }));
    const onCanvas = (c) => c.x > rect.left + 40 && c.x < rect.right - 40 && c.y > rect.top + 80
      && c.y < rect.bottom - 40 && document.elementFromPoint(c.x, c.y) === els.canvas;
    let onRing = null;
    for (const p of ring) {
      const c = toClient(p);
      if (onCanvas(c) && onCanvas({ x: c.x + 50, y: c.y }) && !onRing) onRing = c;
    }
    let offRing = null;
    let best = 0;
    for (let x = rect.left + 60; x < rect.right - 60; x += 20) {
      for (let y = rect.top + 100; y < rect.bottom - 60; y += 20) {
        const c = { x, y };
        if (!onCanvas(c) || !onCanvas({ x: x - 40, y }) || !onCanvas({ x: x + 40, y })) continue;
        const d = ringDistance(c);
        if (d > best) { best = d; offRing = c; }
      }
    }
    return { onRing, offRing, offRingDistance: best, bandPx };
  }, RING_BAND_CSS_PX);
}

async function drag(page, from, to, steps = 6) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  }
  await page.mouse.up();
}

// Two touch pointers on the canvas, spread apart. setPointerCapture is stubbed for synthetic ids,
// as in 15-map-gesture-continuity.spec.js.
async function pinchSpread(page, a, b, spreadPx = 90) {
  await page.evaluate(({ a, b, spreadPx }) => {
    const canvas = els.canvas;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const fire = (type, id, p) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, pointerType: "touch",
    }));
    fire("pointerdown", 4001, a);
    fire("pointerdown", 4002, b);
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      const d = (spreadPx / 2) * (i / steps);
      fire("pointermove", 4001, { x: a.x - d, y: a.y });
      fire("pointermove", 4002, { x: b.x + d, y: b.y });
    }
    fire("pointerup", 4002, { x: b.x + spreadPx / 2, y: b.y });
    fire("pointerup", 4001, { x: a.x - spreadPx / 2, y: a.y });
  }, { a, b, spreadPx });
}

async function nextGpsFix(page) {
  const before = await page.evaluate(() => state.userLocation.latitude);
  await page.context().setGeolocation(NEXT_FIX);
  await page.waitForFunction((lat) => state.userLocation && state.userLocation.latitude !== lat, before);
  await waitForFrames(page, 4);
  await settle(page);
}

test.describe("Map manual pose", () => {
  test("heading-up Nearby: a drag moves the map and the pose holds across a GPS fix", async ({ page }) => {
    await openNearby(page);
    await setCompassHeading(page, 90);
    await settle(page);
    const probe = await mapProbe(page);
    const before = await viewport(page);

    await drag(page, probe.offRing, { x: probe.offRing.x + 70, y: probe.offRing.y + 20 });
    await waitForFrames(page, 3);
    const dragged = await viewport(page);
    expect(dragged.tx - before.tx, "the map followed the drag to the right").toBeGreaterThan(20);
    expect(dragged.ty - before.ty, "and down").toBeGreaterThan(5);
    expect(await page.evaluate(() => Boolean(state.manualPose))).toBe(true);

    await nextGpsFix(page);
    const afterFix = await viewport(page);
    expect(Math.abs(afterFix.tx - dragged.tx)).toBeLessThan(1);
    expect(Math.abs(afterFix.ty - dragged.ty)).toBeLessThan(1);
    expect(Math.abs(afterFix.scale - dragged.scale)).toBeLessThan(dragged.scale * 0.001);
  });

  test("Nearby with a GPS fix and no compass: a drag keeps the pan through the next refit", async ({ page }) => {
    await openNearby(page);
    await settle(page);
    expect(await page.evaluate(() => Number.isFinite(state.compassHeading))).toBe(false);
    const probe = await mapProbe(page);

    await drag(page, probe.offRing, { x: probe.offRing.x - 60, y: probe.offRing.y + 40 });
    await waitForFrames(page, 3);
    const dragged = await viewport(page);

    await nextGpsFix(page);
    await page.evaluate(() => ensureOverviewTargetsVisible({ animate: false }));
    await waitForFrames(page, 3);
    const after = await viewport(page);
    expect(Math.abs(after.tx - dragged.tx)).toBeLessThan(1);
    expect(Math.abs(after.ty - dragged.ty)).toBeLessThan(1);
  });

  test("wheel away from the ring zooms the map; within 24px of the ring it resizes the radius", async ({ page }) => {
    await openNearby(page);
    await settle(page);
    const probe = await mapProbe(page);
    expect(probe.offRingDistance).toBeGreaterThan(RING_BAND_CSS_PX * 2);
    const start = await page.evaluate(() => ({ minutes: state.walkingDistanceMinutes, scale: state.viewport.scale }));

    await page.mouse.move(probe.offRing.x, probe.offRing.y);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => page.evaluate(() => state.viewport.scale)).toBeGreaterThan(start.scale * 1.05);
    expect(await page.evaluate(() => state.walkingDistanceMinutes), "the radius is untouched").toBe(start.minutes);

    // A fresh Nearby (the pose from the zoom above would otherwise carry over), then the ring.
    await page.reload();
    await openNearby(page);
    await settle(page);
    const ringProbe = await mapProbe(page);
    const before = await page.evaluate(() => state.walkingDistanceMinutes);
    await page.mouse.move(ringProbe.onRing.x, ringProbe.onRing.y);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => page.evaluate(() => state.walkingDistanceMinutes)).toBeLessThan(before);
  });

  test("a pinch over a selected place zooms the map", async ({ page }) => {
    await openNearby(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    await settle(page);
    const probe = await mapProbe(page);
    const before = await viewport(page);

    await pinchSpread(page,
      { x: probe.offRing.x - 30, y: probe.offRing.y },
      { x: probe.offRing.x + 30, y: probe.offRing.y });
    await waitForFrames(page, 3);
    const after = await viewport(page);
    expect(after.scale).toBeGreaterThan(before.scale * 1.3);
    expect(await page.evaluate(() => state.selected && state.selected.type)).toBe("tree");
  });

  test("a pinch starting on the ring resizes the radius; one starting off it zooms the map", async ({ page }) => {
    await openNearby(page);
    await settle(page);
    let probe = await mapProbe(page);
    const start = await page.evaluate(() => ({ minutes: state.walkingDistanceMinutes, scale: state.viewport.scale }));

    // Fingers closing: zooms out, which has headroom (the fit sits near the deepest zoom).
    await pinchSpread(page, { x: probe.offRing.x - 60, y: probe.offRing.y }, { x: probe.offRing.x + 60, y: probe.offRing.y }, -80);
    await waitForFrames(page, 3);
    const mapZoom = await page.evaluate(() => ({ minutes: state.walkingDistanceMinutes, scale: state.viewport.scale }));
    expect(mapZoom.scale, "the map zoomed out").toBeLessThan(start.scale * 0.8);
    expect(mapZoom.minutes, "the radius was left alone").toBe(start.minutes);

    await page.reload();
    await openNearby(page);
    await settle(page);
    probe = await mapProbe(page);
    const before = await page.evaluate(() => state.walkingDistanceMinutes);
    await pinchSpread(page, { x: probe.onRing.x, y: probe.onRing.y }, { x: probe.onRing.x + 40, y: probe.onRing.y });
    await waitForFrames(page, 3);
    expect(await page.evaluate(() => state.walkingDistanceMinutes), "the radius shrank").toBeLessThan(before);
  });

  test("selecting a place clears the pose; dismissing the sheet does not", async ({ page }) => {
    await openNearby(page);
    await settle(page);
    let probe = await mapProbe(page);
    await drag(page, probe.offRing, { x: probe.offRing.x + 50, y: probe.offRing.y + 30 });
    await waitForFrames(page, 3);
    expect(await page.evaluate(() => Boolean(state.manualPose))).toBe(true);

    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => Boolean(state.selected && state.selected.item))).toBe(true);
    expect(await page.evaluate(() => Boolean(state.manualPose)), "selecting a place clears it").toBe(false);

    // Back on Nearby (a pan only counts once the map is the Nearby view again).
    await page.locator("#nearbyToggle").click();
    await expect.poll(() => page.evaluate(() => state.selected === null)).toBe(true);
    await settle(page);
    probe = await mapProbe(page);
    await drag(page, probe.offRing, { x: probe.offRing.x - 40, y: probe.offRing.y + 30 });
    await waitForFrames(page, 3);
    expect(await page.evaluate(() => Boolean(state.manualPose))).toBe(true);

    // Minimising the sheet and bringing it back, and a visit to Settings and back, keep the pan.
    await page.evaluate(() => { setInspectorMinimized(true); setInspectorMinimized(false); });
    expect(await page.evaluate(() => Boolean(state.manualPose)), "a sheet dismiss keeps the pose").toBe(true);
    await page.locator("#settingsToggle").click();
    await expect.poll(() => page.evaluate(() => state.selected && state.selected.type)).toBe("settings");
    await page.locator("#nearbyToggle").click();
    await expect.poll(() => page.evaluate(() => state.selected === null)).toBe(true);
    expect(await page.evaluate(() => Boolean(state.manualPose)), "returning from Settings keeps the pose").toBe(true);
  });

  test("panning does not change near=", async ({ page }) => {
    await openNearby(page);
    await settle(page);
    const before = await page.evaluate(() => window.location.search + window.location.hash);
    const probe = await mapProbe(page);
    await drag(page, probe.offRing, { x: probe.offRing.x + 90, y: probe.offRing.y + 60 });
    await waitForFrames(page, 3);
    expect(await page.evaluate(() => window.location.search + window.location.hash)).toBe(before);
    expect(await page.evaluate(() => state.nearbyAnchor)).toBeNull();
  });

  async function panOnNearby(page) {
    await openNearby(page);
    await settle(page);
    const probe = await mapProbe(page);
    await drag(page, probe.offRing, { x: probe.offRing.x + 70, y: probe.offRing.y + 40 });
    await waitForFrames(page, 3);
    expect(await page.evaluate(() => Boolean(state.manualPose))).toBe(true);
    return probe;
  }

  test("pressing Nearby while on Nearby hands the camera back to following the user", async ({ page }) => {
    await openNearby(page);
    await settle(page);
    const fitted = await viewport(page);
    const probe = await mapProbe(page);
    await drag(page, probe.offRing, { x: probe.offRing.x + 70, y: probe.offRing.y + 40 });
    await waitForFrames(page, 3);
    const panned = await viewport(page);
    expect(Math.abs(panned.tx - fitted.tx)).toBeGreaterThan(20);

    await page.locator("#nearbyToggle").click();
    await expect.poll(() => page.evaluate(() => Boolean(state.manualPose))).toBe(false);
    await settle(page);
    const after = await viewport(page);
    expect(Math.abs(after.tx - fitted.tx)).toBeLessThan(2);
    expect(Math.abs(after.ty - fitted.ty)).toBeLessThan(2);
  });

  test("tapping open ground to relocate the anchor clears the pose", async ({ page }) => {
    const probe = await panOnNearby(page);
    await page.mouse.click(probe.offRing.x, probe.offRing.y);
    await expect.poll(() => page.evaluate(() => state.nearbyAnchor !== null)).toBe(true);
    expect(await page.evaluate(() => Boolean(state.manualPose))).toBe(false);
  });

  test("changing the radius from the Settings slider clears the pose", async ({ page }) => {
    await panOnNearby(page);
    await page.locator("#settingsToggle").click();
    await expect.poll(() => page.evaluate(() => state.selected && state.selected.type)).toBe("settings");
    expect(await page.evaluate(() => Boolean(state.manualPose)), "opening Settings keeps the pose").toBe(true);
    await page.evaluate(() => {
      const range = document.getElementById("settingsWalkMins");
      range.value = String(Number(range.value) + 5 > Number(range.max) ? Number(range.value) - 5 : Number(range.value) + 5);
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => page.evaluate(() => Boolean(state.manualPose))).toBe(false);
  });

  test("returning to Nearby from a real selection clears the pose", async ({ page }) => {
    await panOnNearby(page);
    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => Boolean(state.selected && state.selected.item))).toBe(true);
    await settle(page);
    const probe = await mapProbe(page);
    await drag(page, probe.offRing, { x: probe.offRing.x + 40, y: probe.offRing.y + 30 });
    await waitForFrames(page, 3);
    expect(await page.evaluate(() => Boolean(state.manualPose))).toBe(true);
    await page.locator("#nearbyToggle").click();
    await expect.poll(() => page.evaluate(() => state.selected === null)).toBe(true);
    expect(await page.evaluate(() => Boolean(state.manualPose))).toBe(false);
  });
});
