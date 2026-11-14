// @ts-check
// Deliberate, user-triggered camera moves that cover real distance get the cinematic zoom-out arc;
// small moves and continuous camera work (GPS follow, drag return) stay a plain ease.
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle, waitForFrames } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });
// The arc is extra motion, so it is off under reduced motion (the project default); these tests
// opt in the way a user without that setting would be.
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "no-preference" }); });

async function startSampling(page) {
  await page.evaluate(() => {
    window.__camera = [];
    const sample = () => {
      window.__camera.push(state.viewport.scale);
      window.__cameraFrame = requestAnimationFrame(sample);
    };
    sample();
  });
}

async function stopSampling(page) {
  return page.evaluate(() => {
    cancelAnimationFrame(window.__cameraFrame);
    return window.__camera;
  });
}

async function camerasAtRest(page) {
  await expect.poll(() => page.evaluate(() => state.viewportAnimationFrame == null && state.viewportAnimationTo == null)).toBe(true);
  await waitForFrames(page, 4);
}

// How far the scale dipped below the lower of the move's two endpoints.
function dipBelowEndpoints(scales) {
  const start = scales[0];
  const end = scales[scales.length - 1];
  return 1 - Math.min(...scales) / Math.min(start, end);
}

test.describe("Deliberate camera moves", () => {
  test("returning to Nearby from a far pan eases through a zoom-out arc", async ({ page }) => {
    await setup(page, "/nearby");
    await camerasAtRest(page);
    // Pan well away (as a long drag would), keeping the scale, then ask for Nearby again.
    await page.evaluate(() => { state.viewport.tx += els.canvas.width * 1.4; requestDraw(); });
    await waitForFrames(page, 2);
    await startSampling(page);
    await page.locator("#nearbyToggle").click();
    await camerasAtRest(page);
    const scales = await stopSampling(page);
    expect(dipBelowEndpoints(scales), "the camera pulls back mid-move").toBeGreaterThan(0.04);
    expect(scales[scales.length - 1] / scales[0], "and lands on the same framing").toBeCloseTo(1, 2);
  });

  test("a few pixels of refit stays a plain ease", async ({ page }) => {
    await setup(page, "/nearby");
    await camerasAtRest(page);
    await page.evaluate(() => { state.viewport.tx += 12; requestDraw(); });
    await waitForFrames(page, 2);
    await startSampling(page);
    await page.locator("#nearbyToggle").click();
    await camerasAtRest(page);
    const scales = await stopSampling(page);
    expect(dipBelowEndpoints(scales)).toBeLessThan(0.005);
  });

  test("the drag return stays a plain ease", async ({ page }) => {
    await setup(page, "/nearby");
    await camerasAtRest(page);
    const box = await page.locator("#mapCanvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 6 });
    await waitForFrames(page, 2);
    await startSampling(page);
    await page.mouse.up();
    await camerasAtRest(page);
    const scales = await stopSampling(page);
    expect(dipBelowEndpoints(scales)).toBeLessThan(0.005);
  });

  test("a GPS fix far from the last one follows the camera without an arc", async ({ page, context }) => {
    await setup(page, "/nearby");
    await camerasAtRest(page);
    const fixBefore = await page.evaluate(() => state.userLocation.point.y);
    await startSampling(page);
    await context.setGeolocation({ ...FOREST_LOCATION, latitude: FOREST_LOCATION.latitude + 0.004 });
    await expect.poll(() => page.evaluate(() => state.userLocation.point.y)).not.toBe(fixBefore);
    await waitForUiToSettle(page);
    await camerasAtRest(page);
    const scales = await stopSampling(page);
    expect(dipBelowEndpoints(scales)).toBeLessThan(0.005);
  });

  test("an arc leaves no first-location reveal state behind, and a selection still lands (guard)", async ({ page }) => {
    await setup(page, "/nearby");
    await camerasAtRest(page);
    await page.evaluate(() => {
      window.__reveal = false;
      const watch = () => { if (state.locationRevealAnimationActive) window.__reveal = true; window.__revealFrame = requestAnimationFrame(watch); };
      watch();
    });
    await page.evaluate(() => { state.viewport.tx += els.canvas.width * 1.4; requestDraw(); });
    await waitForFrames(page, 2);
    await page.locator("#nearbyToggle").click();
    await camerasAtRest(page);
    await page.locator("#inspectorBody [data-overview-type][data-overview-key]").first().click();
    await expect.poll(() => page.evaluate(() => state.selectionTransition.mapHeld)).toBe(false);
    await camerasAtRest(page);
    const result = await page.evaluate(() => {
      cancelAnimationFrame(window.__revealFrame);
      return { reveal: window.__reveal, mapHeld: state.selectionTransition.mapHeld, selected: Boolean(state.selected) };
    });
    expect(result).toEqual({ reveal: false, mapHeld: false, selected: true });
  });
});
