const { expect } = require("@playwright/test");
const cowFixture = require("./fixtures/cows.json");

// A real tree from the dataset used across selection tests
const FIXTURE_TREE = {
  tagNumber: "11383",
  recordNumber: "17338",
  commonName: "English Oak",
  latinName: "Quercus robur",
  // Trees are keyed by record number, prefixed so the key cannot be read as the old
  // id/tag-based one (see "Tree identity" in spec/spec-data-fetching.md). Tag 11383 and
  // record 11383 are two different real trees, which is exactly why the prefix exists.
  hashKey: "r17338",
  legacyHashKey: "11383",
};

/**
 * Set localStorage before the app boots so onboarding is skipped.
 * Must be called before page.goto().
 */
async function skipOnboarding(page) {
  await page.addInitScript(() => {
    localStorage.setItem("forest-finds-onboarding-v1", "done");
  });
}

/**
 * Intercept /api/cows with a small deterministic fixture so tests never
 * hit the live Nofence API.
 */
async function mockCowApi(page) {
  await page.route("**/api/cows**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cowFixture),
    })
  );
}

/**
 * Intercept data/events.json with a caller-supplied fixture, so an events test can control
 * exactly which events exist -- in particular, one that is "live" right now -- without being
 * at the mercy of whatever's actually in the committed data/events.json or the real wall clock.
 * Must be called before page.goto (same ordering as mockCowApi).
 */
async function mockEventsApi(page, events) {
  await page.route("**/data/events.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events }),
    })
  );
}

/**
 * Make an ungranted geolocation request fail immediately instead of hanging.
 *
 * Chromium answers getCurrentPosition neither way while the permission is still
 * undecided -- no success callback, no error callback, and the request's own
 * `timeout` option does not start until the decision is made, so nothing ever
 * fires. A spec that does not grant location would otherwise sit through the
 * app's whole boot-location bound on every single page load, and whether it got
 * there before the test timeout depended on how loaded the machine was. That is
 * what made whole spec files fail together on CI.
 *
 * Only getCurrentPosition is replaced, and only when the test has not granted
 * the permission: a spec using test.use({ permissions: ["geolocation"] }) keeps
 * the real API and Playwright's mock position. watchPosition is left alone
 * because the app only ever starts a watch after a fix has succeeded.
 */
async function denyGeolocationUnlessGranted(page) {
  await page.addInitScript(() => {
    if (window.__forestFindsGeolocationStubbed) return;
    window.__forestFindsGeolocationStubbed = true;

    const geolocation = navigator.geolocation;
    if (!geolocation) return;
    const realGetCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);

    geolocation.getCurrentPosition = (onSuccess, onError, options) => {
      Promise.resolve()
        .then(() => navigator.permissions.query({ name: "geolocation" }))
        .then((status) => status.state === "granted")
        .catch(() => false)
        .then((isGranted) => {
          if (isGranted) {
            realGetCurrentPosition(onSuccess, onError, options);
          } else if (onError) {
            onError({
              code: 1,
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
              message: "Geolocation was not granted to this test",
            });
          }
        });
    };
  });
}

/**
 * Freeze the camera and settle the canvas for a pixel-exact screenshot.
 *
 * `drawPngMapIcon` (js/renderer.js) silently skips an icon whose `Image` hasn't finished
 * loading yet (`if (!img.complete...) return false`), and its `onload` handler schedules a
 * *second* draw via requestDraw()/requestAnimationFrame once the icon lands. A screenshot taken
 * between those two draws depends entirely on how fast that particular icon's fetch happened to
 * be -- fine on a quiet machine, a real source of the pixel-diff flakiness documented in
 * spec/agents.md on a contended CI runner. Waiting for every icon already requested to finish
 * loading (success or error) before the final draw removes that race instead of outrunning it
 * with a longer timeout.
 */
async function settleMapIconsAndDraw(page) {
  await page.evaluate(async () => {
    stopViewportAnimation();
    state.emojiScaleAnimated = zoomEmojiScaleTarget();
    draw();
    await Promise.all(
      [...mapImageCache.values()].map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            })
      )
    );
    draw();
  });
}

/**
 * Navigate to the app and wait for the loading overlay to be fully gone.
 *
 * hideWithFade() fades opacity to 0 (CSS) and then sets el.hidden = true after
 * a 420 ms timer. We must wait for el.hidden === true (not just CSS opacity 0)
 * because the transparent overlay still intercepts pointer events until then.
 */
async function gotoAndWaitForMap(page, path = "/nearby", { timeout = 30_000 } = {}) {
  await denyGeolocationUnlessGranted(page);
  await page.goto(path);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("loadingOverlay");
      return !el || el.hidden === true;
    },
    { timeout }
  );
}

/**
 * Full standard setup: skip onboarding, mock cows, navigate, wait for map.
 * Also force-hides the location gate if it appeared (location fails in any test that
 * has not granted the permission — see denyGeolocationUnlessGranted), and clears
 * applyDefaultLocation()'s High Beach stand-in (js/app.js) that boot falls back to
 * whenever there is no real fix — restoring the "no location at all" baseline most of
 * this suite is written against, including the overview empty-state assertion in
 * 02-overview. A test that wants the real default-location behaviour (09-location) uses
 * gotoAndWaitForMap directly instead of this helper, so it sees it unmodified.
 */
async function setup(page, urlPath = "/nearby") {
  await skipOnboarding(page);
  await mockCowApi(page);
  await gotoAndWaitForMap(page, urlPath);
  await page.evaluate(() => {
    const gate = document.getElementById("locationGate");
    if (gate && !gate.hidden) gate.hidden = true;
    // Same reason as the gate above -- revealNoRealLocation()'s own "get a more custom
    // experience" invite (#locationInviteBanner, js/app.js) is non-blocking and sits inline in
    // the inspector chrome, so leaving it up would add two extra buttons to this suite's keyboard
    // tab-order baseline on every screen, not just Nearby.
    const invite = document.getElementById("locationInviteBanner");
    if (invite && !invite.hidden) invite.hidden = true;
    if (state.userLocation && state.userLocation.isDefault) {
      state.userLocation = null;
      // This fixture removes the default location entirely, so its static
      // High Beach list must not stand in for the no-location empty state.
      _serverRenderedNearbyList = false;
      state.walkingDistanceMinutes = DEFAULT_WALKING_DISTANCE_MINUTES;
      // Only reset to the overview when the test actually asked for the bare /nearby screen --
      // boot() already routed a URL like /nearby#tree=... or /settings to its own screen, and
      // resetting unconditionally here threw that away again, back to the plain overview.
      if (window.location.pathname === "/nearby" && !window.location.hash) selectOverview();
      // boot()'s own reveal already zoomed the camera tight around DEFAULT_LOCATION's 30-minute
      // radius before this runs -- clearing the location above doesn't undo that framing on its
      // own, so a screen (Settings/Report included) is left zoomed in on a single, now-stale
      // patch of map instead of the whole-forest view the old no-location baseline expects.
      fitToBounds(false);
      draw();
    }
  });
}

/**
 * Fire a real tap (pointerdown + pointerup with no movement between them) at a point given in
 * canvas pixels, so the whole js/nav.js pointer pipeline -- including the wasClick test -- runs
 * exactly as it does under a finger. setPointerCapture/releasePointerCapture throw for a
 * synthetic (non-active) pointer id, so they're stubbed, the same way the pinch helper in
 * 02-overview.spec.js does.
 */
async function tapCanvasPoint(page, canvasPoint, options = {}) {
  await page.evaluate(({ point, alreadyClient }) => {
    const canvas = els.canvas;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const rect = (els.mapStage || canvas).getBoundingClientRect();
    const dpr = pixelRatio();
    const clientX = alreadyClient ? point.clientX : rect.left + (point.x - state.canvasInsetX) / dpr;
    const clientY = alreadyClient ? point.clientY : rect.top + (point.y - state.canvasInsetY) / dpr;
    const fire = (type) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 2001, clientX, clientY, bubbles: true, cancelable: true, pointerType: "touch",
    }));
    fire("pointerdown");
    fire("pointerup");
  }, { point: canvasPoint, alreadyClient: Boolean(options.alreadyClient) });
}

/**
 * boundingBox() reads layout the instant it's called, which can land mid-reflow right after a
 * class/style change that triggers a transition or a flex-layout resolve -- a real, reproducible
 * failure in CI (06-feedback.spec.js's keyboard-avoidance tests measured the sheet ~15-20px short
 * of its settled position on a loaded runner, consistently, not a one-off), even though the box
 * is never actually wrong once it settles. Polls until two consecutive reads agree, so a caller
 * gets the box layout has actually settled on rather than a transient mid-reflow one.
 */
async function waitForStableBoundingBox(locator, { timeout = 2000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  let previous = await locator.boundingBox();
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const current = await locator.boundingBox();
    if (previous && current && previous.y === current.y && previous.height === current.height) {
      return current;
    }
    previous = current;
  }
  return previous;
}

/**
 * Wait until no viewport slide is in flight. animateViewportTo() (js/app.js) keeps
 * state.viewportAnimationFrame set for the length of a slide and clears it on landing, so
 * this is the real end of a pan or zoom rather than a guessed-at number of milliseconds.
 */
async function waitForViewportToSettle(page) {
  await page.waitForFunction(() => state.viewportAnimationFrame == null);
}

module.exports = {
  setup,
  waitForViewportToSettle,
  skipOnboarding,
  mockCowApi,
  mockEventsApi,
  denyGeolocationUnlessGranted,
  waitForStableBoundingBox,
  gotoAndWaitForMap,
  settleMapIconsAndDraw,
  tapCanvasPoint,
  FIXTURE_TREE,
};
