const { expect } = require("@playwright/test");
const cowFixture = require("./fixtures/cows.json");

// A real tree from the dataset used across selection tests
const FIXTURE_TREE = {
  tagNumber: "11383",
  commonName: "English Oak",
  latinName: "Quercus robur",
  hashKey: "11383",
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
 * Navigate to the app and wait for the loading overlay to be fully gone.
 *
 * hideWithFade() fades opacity to 0 (CSS) and then sets el.hidden = true after
 * a 420 ms timer. We must wait for el.hidden === true (not just CSS opacity 0)
 * because the transparent overlay still intercepts pointer events until then.
 */
async function gotoAndWaitForMap(page, path = "/") {
  await page.goto(path);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("loadingOverlay");
      return !el || el.hidden === true;
    },
    { timeout: 30_000 }
  );
}

/**
 * Full standard setup: skip onboarding, mock cows, navigate, wait for map.
 * Also force-hides the location gate if it appeared (location always fails in tests
 * because no geolocation permission is granted). The gate is full-screen and would
 * block all button clicks — hiding it here leaves state.userLocation null so the
 * overview empty-state assertion in 02-overview still works.
 */
async function setup(page, urlPath = "/") {
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

module.exports = { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap, tapCanvasPoint, FIXTURE_TREE };
