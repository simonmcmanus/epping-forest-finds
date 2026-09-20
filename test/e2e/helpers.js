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
 * Navigate to the app and wait for the loading overlay to be fully gone.
 *
 * hideWithFade() fades opacity to 0 (CSS) and then sets el.hidden = true after
 * a 420 ms timer. We must wait for el.hidden === true (not just CSS opacity 0)
 * because the transparent overlay still intercepts pointer events until then.
 */
async function gotoAndWaitForMap(page, path = "/app", { timeout = 30_000 } = {}) {
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
 * has not granted the permission — see denyGeolocationUnlessGranted). The gate is
 * full-screen and would block all button clicks — hiding it here leaves
 * state.userLocation null so the overview empty-state assertion in 02-overview still
 * works.
 */
async function setup(page, urlPath = "/app") {
  await skipOnboarding(page);
  await mockCowApi(page);
  await gotoAndWaitForMap(page, urlPath);
  await page.evaluate(() => {
    const gate = document.getElementById("locationGate");
    if (gate && !gate.hidden) gate.hidden = true;
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

module.exports = {
  setup,
  skipOnboarding,
  mockCowApi,
  denyGeolocationUnlessGranted,
  gotoAndWaitForMap,
  tapCanvasPoint,
  FIXTURE_TREE,
};
