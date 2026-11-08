// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

// A GPS fix inside Epping Forest, where the veteran-tree register is dense.
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };
const DEFAULT_WALKING_DISTANCE_MINUTES = 5;

function ringState(page) {
  return page.evaluate(() => ({
    minutes: state.walkingDistanceMinutes,
    firstLanding: state.firstLandingRadiusMinutes,
  }));
}

test.describe("First landing ring — a plain landing with a real fix", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
  });

  test("the first view rings the nearest items, says so, and keeps a radius the reader never chose out of the address bar", async ({ page }) => {
    // The page opens on the High Beach stand-in and sizes the ring once the real fix arrives.
    await page.waitForFunction(() => state.userLocation && !state.userLocation.isDefault && state.firstLandingRadiusMinutes != null, null, { timeout: 30_000 });
    const ring = await ringState(page);
    expect(ring.firstLanding, "a plain landing in the forest is sized to its nearest items").not.toBeNull();
    expect(ring.minutes, "the ring is the one the first landing chose").toBe(ring.firstLanding);
    expect(ring.minutes, "and it is tighter than the default five-minute ring").toBeLessThan(DEFAULT_WALKING_DISTANCE_MINUTES);
    await expect(page.locator("#inspectorType")).toContainText(/closest/i);
    expect(new URL(page.url()).searchParams.has("radius"), "no ?radius= is written for a ring the reader did not choose").toBe(false);
  });
});

test.describe("First landing ring — a shared link that names its radius", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test("a ?radius= link keeps the radius it names rather than the nearest-items ring", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, "/nearby?radius=3");
    const ring = await ringState(page);
    expect(ring.minutes).toBe(3);
    expect(ring.firstLanding, "the link's own radius is not replaced").toBeNull();
  });
});

test.describe("First landing ring — no real fix", () => {
  test("without a real fix in the forest the ring stays at the default five minutes", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    const ring = await ringState(page);
    expect(ring).toEqual({ minutes: DEFAULT_WALKING_DISTANCE_MINUTES, firstLanding: null });
  });
});
