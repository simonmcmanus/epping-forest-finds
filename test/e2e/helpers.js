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
 */
async function setup(page, urlPath = "/") {
  await skipOnboarding(page);
  await mockCowApi(page);
  await gotoAndWaitForMap(page, urlPath);
}

module.exports = { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap, FIXTURE_TREE };
