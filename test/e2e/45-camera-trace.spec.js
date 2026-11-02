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

test.describe("Camera framing with the phone held up (heading-up)", () => {
  test("following a link to another place lands where heading-up navigation keeps it, so nothing pulls the camera afterwards", async ({ page }) => {
    // Two places a few hundred metres apart: close enough together the flat fit and the heading-up
    // fit both hit the zoom cap and agree, which would let a wrong camera call pass unnoticed.
    await setup(page, "/nearby");
    await page.evaluate(() => navigateInApp("/find/onest/"));
    await page.waitForFunction(() => state.selected?.type === "landmark");
    await waitForUiToSettle(page);

    // Hold the phone up: a fresh heading keeps heading-up navigation on.
    await page.evaluate(() => {
      const heading = 40;
      state.compassHeadingTarget = heading;
      state.compassHeading = heading;
      state.renderedNavigationHeading = heading;
      window.__keepCompassFresh = setInterval(() => { state.compassLastEventAt = performance.now(); }, 50);
      state.compassLastEventAt = performance.now();
    });
    expect(await page.evaluate(() => selectedNavigationHeadingUpActive()), "heading-up navigation must be on").toBe(true);

    await page.evaluate(() => navigateInApp("/find/hillside-tandoori/"));
    await page.waitForFunction(() => state.selected?.item?.name === "Hillside Tandoori" || state.selected?.item?.name?.toLowerCase().includes("hillside"));
    await waitForUiToSettle(page);
    await expect.poll(() => page.evaluate(() => state.viewportAnimationTo == null)).toBe(true);

    const result = await page.evaluate(() => {
      const landed = { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
      // What the heading-up follow wants for this place, asked for directly.
      alignHeadingUpNavigationViewport({ force: true, animate: false });
      const wanted = { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
      clearInterval(window.__keepCompassFresh);
      return { landed, wanted };
    });
    const scaleGap = Math.abs(result.landed.scale - result.wanted.scale) / result.wanted.scale;
    expect(scaleGap, `landed at ${result.landed.scale}, heading-up wants ${result.wanted.scale}`).toBeLessThan(0.05);
  });
});

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
