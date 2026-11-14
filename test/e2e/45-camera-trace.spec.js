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
    const origTween = window.moveCamera;
    window.moveCamera = function (target, ms, cb, opts) {
      const entry = { kind: "tween", fromScale: state.viewport.scale, toScale: target.scale, ms,
        restarting: state.viewportAnimationTo != null };
      const outcome = origTween.apply(this, arguments);
      // The duration the move was actually given: a big zoom is stretched beyond the requested ms.
      if (state.viewportAnimationTo != null) entry.ms = state.viewportAnimationDuration;
      log(entry);
      return outcome;
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

/**
 * Lists the Nearby items that are not cows. A cow can sit at the user's own position (0 m), where
 * selecting it needs no zoom, so the camera journeys must not take "whichever is first".
 * Returns locators for the first `count` such items, in list order, and the Nearby ring scale.
 */
async function pickPlaces(page, count) {
  const items = page.locator("#inspectorBody [data-overview-type][data-overview-key]");
  await expect(items.first()).toBeVisible();
  const listed = await items.evaluateAll((els) => els.map((el) => ({
    type: el.getAttribute("data-overview-type"), key: el.getAttribute("data-overview-key") })));
  const places = listed.filter((item) => item.type !== "cow").slice(0, count);
  expect(places.length, `needs ${count} non-cow Nearby items, listed: ${JSON.stringify(listed)}`).toBe(count);
  const ringScale = await page.evaluate(() => state.viewport.scale);
  const locators = places.map((p) => page.locator(
    `#inspectorBody [data-overview-type=${JSON.stringify(p.type)}][data-overview-key=${JSON.stringify(p.key)}]`));
  return { locators, ringScale };
}

/** Fails clearly if opening a place did not zoom in from the Nearby ring, so the journey is meaningful. */
async function expectZoomedInFrom(page, ringScale) {
  await expect.poll(() => page.evaluate(() => state.viewport.scale),
    { message: `opening a place must zoom in beyond the Nearby ring scale ${ringScale}` }).toBeGreaterThan(ringScale * 1.5);
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
    // The wrongly-chosen flat fit landed about 150% off; a few percent is the panel's own settling.
    expect(scaleGap, `landed at ${result.landed.scale}, heading-up wants ${result.wanted.scale}`).toBeLessThan(0.1);
  });
});

test.describe("Back from a zoomed-in place to a browse view", () => {
  test("the zoom out is eased across the slide, not applied in one step", async ({ page }) => {
    await setup(page, "/nearby");
    await page.evaluate(() => navigateInApp("/nearby/pubs/#near=51.655204,0.065731&label=Onest"));
    await page.waitForFunction(() => state.nearbyAnchor != null);
    await waitForUiToSettle(page);
    await page.evaluate(() => navigateInApp("/find/the-plume-of-feathers/"));
    await page.waitForFunction(() => state.selected?.type === "landmark");
    await waitForUiToSettle(page);

    // Press the real browser Back. Inside the app's own browse-point move, the slide's clock is moved by
    // hand and the zoom is read, all in one task, so the result does not depend on how many frames a
    // loaded runner manages to draw.
    await page.evaluate(() => {
      const original = window.setNearbyAnchor;
      window.setNearbyAnchor = function (...args) {
        const zoomedIn = state.viewport.scale;
        const outcome = original.apply(this, args);
        const slide = state.nearbyOriginTransition;
        const at = (fraction) => {
          slide.startedAt = performance.now() - fraction * slide.durationMs;
          prepareCanvasForDraw();
          return state.viewport.scale;
        };
        window.__backZoom = { zoomedIn, start: at(0.001), middle: at(0.5), landed: at(1.5) };
        slide.startedAt = performance.now();
        return outcome;
      };
    });
    await page.goBack();
    await page.waitForFunction(() => window.__backZoom != null);
    const result = await page.evaluate(() => window.__backZoom);
    // On the first frame it is still where it was; by the end it has zoomed out; in between it is partway.
    expect(Math.abs(result.start - result.zoomedIn) / result.zoomedIn, "no jump on the first frame").toBeLessThan(0.02);
    expect(result.landed, "it ends zoomed out").toBeLessThan(result.zoomedIn * 0.9);
    expect(result.middle, "and is part-way through the slide").toBeLessThan(result.start * 0.98);
    expect(result.middle).toBeGreaterThan(result.landed * 1.02);
  });
});

test.describe("Camera trace of user transitions", () => {
  test("opening a place from Nearby is one zoom, with no un-animated jumps", async ({ page }) => {
    await setup(page, "/nearby");
    const { locators, ringScale } = await pickPlaces(page, 1);
    await startCameraTrace(page);
    await locators[0].click();
    await waitForUiToSettle(page);
    await expectZoomedInFrom(page, ringScale);

    const moves = await cameraMoves(page);
    expect(moves.filter((m) => m.kind === "direct")).toEqual([]);
    expect(moves.filter((m) => m.kind === "tween" && m.restarting)).toEqual([]);
    expect(moves.filter((m) => m.kind === "tween").length).toBeGreaterThan(0);
  });

  test("switching from one place to another is one zoom, not a pan cut short by a zoom", async ({ page }) => {
    await setup(page, "/nearby");
    const { locators, ringScale } = await pickPlaces(page, 2);
    await locators[0].click();
    await waitForUiToSettle(page);
    await expectZoomedInFrom(page, ringScale);
    await page.locator("#nearbyToggle").click();
    await waitForUiToSettle(page);

    await startCameraTrace(page);
    await locators[1].click();
    await waitForUiToSettle(page);

    const moves = await cameraMoves(page);
    expect(moves.filter((m) => m.kind === "direct")).toEqual([]);
    expect(moves.filter((m) => m.kind === "tween" && m.restarting)).toEqual([]);
  });

  test("returning to Nearby from a place is one zoom out, with no un-animated jumps", async ({ page }) => {
    await setup(page, "/nearby");
    const { locators, ringScale } = await pickPlaces(page, 1);
    await locators[0].click();
    await waitForUiToSettle(page);
    await expectZoomedInFrom(page, ringScale);

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
    // A zoom this large must be given more than the base 500ms, or it zooms for only a fraction of it.
    const last = tweens[tweens.length - 1];
    expect(last.fromScale / last.toScale, "this is a large zoom out").toBeGreaterThan(3);
    expect(last.ms, "so it is given extra time").toBeGreaterThan(550);
    expect(last.ms).toBeLessThanOrEqual(1200);
  });
});
