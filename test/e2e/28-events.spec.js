// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, mockEventsApi, gotoAndWaitForMap, skipOnboarding, mockCowApi } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.665, longitude: 0.045, accuracy: 10 };

// startsAt/endsAt are relative to the real clock at test time -- a fixed date would drift out
// of "live" the moment this suite is run on a day other than when it was written.
function liveEventFixture(overrides = {}) {
  const now = Date.now();
  return {
    id: "live-fair",
    name: "Autumn Forest Fair",
    description: "Stalls and a guided walk.",
    lat: FOREST_LOCATION.latitude,
    lon: FOREST_LOCATION.longitude,
    startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
    endsAt: new Date(now + 60 * 60 * 1000).toISOString(),
    sourceUrl: "https://example.com/autumn-fair",
    ...overrides,
  };
}

test.describe("Events", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test("Events is on by default and a live event opens with its date range and source link", async ({ page }) => {
    await mockEventsApi(page, [liveEventFixture()]);
    await setup(page);

    await expect.poll(() => page.evaluate(() => isSubfilterActive("events"))).toBe(true);

    const eventId = await page.evaluate(() => state.landmarks.find((p) => isEventCategory(p))?.id);
    expect(eventId).toBeTruthy();

    await page.evaluate((id) => {
      const place = state.landmarks.find((p) => isEventCategory(p) && p.id === id);
      focusOverviewItem("landmark", placeHashKey(place));
    }, eventId);

    await expect(page.locator("#inspectorTitle")).toHaveText("Autumn Forest Fair");
    await expect(page.locator("#inspectorType")).toHaveText("Happening now");
    await expect(page.locator("#inspectorBody")).toContainText("example.com");
  });

  test("a live event within the walking radius surfaces an in-app banner, which opens the event and then can be dismissed", async ({ page }) => {
    await mockEventsApi(page, [liveEventFixture()]);
    await setup(page);

    await expect(page.locator("#eventNearbyBanner")).toBeVisible();
    await expect(page.locator("#eventNearbyBannerText")).toContainText("Autumn Forest Fair is on now");

    await page.locator("#eventNearbyBannerOpen").click();
    await expect(page.locator("#inspectorTitle")).toHaveText("Autumn Forest Fair");
    // Opening it dismisses the banner -- it must not still be sitting there once its event is open.
    await expect(page.locator("#eventNearbyBanner")).toBeHidden();
  });

  test("dismissing the banner hides it without opening the event", async ({ page }) => {
    await mockEventsApi(page, [liveEventFixture()]);
    await setup(page);

    await expect(page.locator("#eventNearbyBanner")).toBeVisible();
    await page.locator("#eventNearbyBannerDismiss").click();
    await expect(page.locator("#eventNearbyBanner")).toBeHidden();
    await expect(page.locator("#inspectorTitle")).not.toHaveText("Autumn Forest Fair");
  });

  test("an upcoming (not yet live) event never triggers the proximity banner", async ({ page }) => {
    const now = Date.now();
    await mockEventsApi(page, [liveEventFixture({
      id: "future-fair",
      startsAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(now + 28 * 60 * 60 * 1000).toISOString(),
    })]);
    await setup(page);

    // Give checkEventProximityAlert (run on every GPS fix) a real chance to have fired.
    await page.waitForTimeout(500);
    await expect(page.locator("#eventNearbyBanner")).toBeHidden();
  });

  test("turning off the Events filter stops the proximity banner from firing", async ({ page }) => {
    await skipOnboarding(page);
    // A filter set that excludes "events" must be in place for the very first GPS fix -- set
    // via the same localStorage key the app itself restores from on boot (js/app.js reads
    // forest-finds-filter-state-v1), rather than patching state.overviewFilters afterwards,
    // which would be too late for the fix that already fired during boot.
    await page.addInitScript(() => {
      localStorage.setItem("forest-finds-filter-state-v1", JSON.stringify({ filters: ["trees"], expandedGroups: [] }));
    });
    await mockCowApi(page);
    await mockEventsApi(page, [liveEventFixture()]);
    await gotoAndWaitForMap(page);
    await page.evaluate(() => {
      const gate = document.getElementById("locationGate");
      if (gate && !gate.hidden) gate.hidden = true;
    });

    await page.waitForTimeout(500);
    await expect(page.locator("#eventNearbyBanner")).toBeHidden();
  });
});
