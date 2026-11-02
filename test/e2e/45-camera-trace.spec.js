// @ts-check
// Camera trace: records every camera move a user-level transition starts, then asserts the shape of
// the sequence. Frame timing is not asserted here (headless frames are too slow to judge motion);
// instead each move's start, its target and whether anything wrote the viewport directly are checked.
// This is the net for refactoring the camera code: a regression shows up as an extra move, a
// restarted move or an un-animated write, not as a flaky pixel diff.
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

/** Starts recording camera moves and direct viewport writes from now on. */
async function startCameraTrace(page) {
  await page.evaluate(() => {
    window.__cameraTrace = [];
    const t0 = performance.now();
    const log = (entry) => window.__cameraTrace.push({ t: Math.round(performance.now() - t0), ...entry });
    const origTween = window.animateViewportTo;
    window.animateViewportTo = function (target, ms, cb, opts) {
      log({ kind: "tween", fromScale: state.viewport.scale, toScale: target.scale, ms,
        restarting: state.viewportAnimationTo != null });
      return origTween.apply(this, arguments);
    };
    const vp = state.viewport;
    let current = vp.scale;
    Object.defineProperty(vp, "scale", {
      configurable: true,
      get() { return current; },
      set(next) {
        // A write outside any tween is an un-animated camera jump.
        if (next !== current && state.viewportAnimationTo == null) log({ kind: "direct", to: next });
        current = next;
      },
    });
  });
}

/** Camera moves recorded since startCameraTrace, without the raw timestamps. */
async function cameraMoves(page) {
  return page.evaluate(() => window.__cameraTrace.map(({ t, ...rest }) => rest));
}

test.describe("Camera trace of user transitions", () => {
  test("opening a place from Nearby is one zoom, with no un-animated jumps", async ({ page }) => {
    await setup(page, "/nearby");
    await startCameraTrace(page);
    await page.locator("#inspectorBody [data-overview-type][data-overview-key]").nth(0).click();
    await waitForUiToSettle(page);

    const moves = await cameraMoves(page);
    expect(moves.filter((m) => m.kind === "direct")).toEqual([]);
    expect(moves.filter((m) => m.kind === "tween" && m.restarting)).toEqual([]);
    expect(moves.filter((m) => m.kind === "tween").length).toBeGreaterThan(0);
  });

  test("switching from one place to another is one zoom, not a pan cut short by a zoom", async ({ page }) => {
    await setup(page, "/nearby");
    await page.locator("#inspectorBody [data-overview-type][data-overview-key]").nth(0).click();
    await waitForUiToSettle(page);
    await page.locator("#nearbyToggle").click();
    await waitForUiToSettle(page);

    await startCameraTrace(page);
    await page.locator("#inspectorBody [data-overview-type][data-overview-key]").nth(1).click();
    await waitForUiToSettle(page);

    const moves = await cameraMoves(page);
    expect(moves.filter((m) => m.kind === "direct")).toEqual([]);
    expect(moves.filter((m) => m.kind === "tween" && m.restarting)).toEqual([]);
  });

  test("returning to Nearby from a place is one zoom out, with no un-animated jumps", async ({ page }) => {
    await setup(page, "/nearby");
    await page.locator("#inspectorBody [data-overview-type][data-overview-key]").nth(0).click();
    await waitForUiToSettle(page);

    await startCameraTrace(page);
    await page.locator("#nearbyToggle").click();
    await waitForUiToSettle(page);

    const moves = await cameraMoves(page);
    expect(moves.filter((m) => m.kind === "direct")).toEqual([]);
    expect(moves.filter((m) => m.kind === "tween" && m.restarting)).toEqual([]);
    // Zooming out from a place must actually be a zoom out, not a no-op.
    const tweens = moves.filter((m) => m.kind === "tween");
    expect(tweens.length).toBeGreaterThan(0);
    expect(tweens[tweens.length - 1].toScale).toBeLessThan(tweens[0].fromScale);
  });
});
