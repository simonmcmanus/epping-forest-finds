// @ts-check
// Visual snapshots of the app screens whose own journey file runs on desktop only (search, feedback,
// events) or needs a first-visit state no other snapshot has (onboarding). Every app screen has a
// baseline on both projects, so a visible change to any of them shows up as a diff in the PR. The
// functional behaviour of each screen is covered by its journey spec; these only guard what it looks like.
const { test, expect } = require("@playwright/test");
const { setup, mockCowApi, mockEventsApi, denyGeolocationUnlessGranted, FIXTURE_TREE, settleMapIconsAndDraw, waitForUiToSettle } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.665, longitude: 0.045, accuracy: 10 };

async function settle(page) {
  await waitForUiToSettle(page);
  await settleMapIconsAndDraw(page);
}

test.describe("Search screen snapshots", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page, "/nearby/search");
    await expect(page.locator("#mapSearchInput")).toBeVisible();
  });

  test("snapshot: search screen before typing", async ({ page }) => {
    await expect(page.locator("#mapSearchResults")).toContainText("Search for a tree tag");
    await settle(page);
    await expect(page).toHaveScreenshot("search-screen.png", { fullPage: false });
  });

  test("snapshot: search screen with a result", async ({ page }) => {
    // A tree tag: the register is stable, so the result list does not churn with the weekly ledger.
    await page.fill("#mapSearchInput", FIXTURE_TREE.tagNumber);
    await expect(page.locator("#mapSearchResults .nearest-item").first()).toContainText(FIXTURE_TREE.commonName);
    await page.locator("#mapSearchInput").blur();
    await settle(page);
    await expect(page).toHaveScreenshot("search-results.png", { fullPage: false });
  });
});

test("snapshot: feedback screen", async ({ page }) => {
  await setup(page, "/feedback");
  await expect(page.locator("#reportForm")).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("feedback-screen.png", { fullPage: false });
});

test("snapshot: onboarding on a first visit", async ({ page }) => {
  // No skipOnboarding(): this is the first-visit state. The map remains usable beneath the
  // non-blocking combined consent card.
  await page.addInitScript(() => {
    localStorage.removeItem("ff-track-v1");
    localStorage.removeItem("ff-cookie-consent");
    const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (originalQuery) {
      navigator.permissions.query = (descriptor) => descriptor && descriptor.name === "geolocation"
        ? Promise.resolve({ state: "prompt", onchange: null })
        : originalQuery(descriptor);
    }
  });
  await mockCowApi(page);
  await denyGeolocationUnlessGranted(page);
  await page.goto("/nearby");
  await expect(page.locator("#consentBanner")).toContainText("Allow location & cookies");
  for (const step of ["trees", "places", "paths", "roads", "environment", "forest"]) {
    await expect(page.locator(`[data-load-step="${step}"]`)).toHaveClass(/\b(done|error)\b/);
  }
  await waitForUiToSettle(page);
  await expect(page).toHaveScreenshot("onboarding.png", { fullPage: false });
});

test("snapshot: guided onboarding after non-blocking consent", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("ff-track-v1");
    localStorage.removeItem("ff-cookie-consent");
    const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (originalQuery) {
      navigator.permissions.query = (descriptor) => descriptor && descriptor.name === "geolocation"
        ? Promise.resolve({ state: "prompt", onchange: null })
        : originalQuery(descriptor);
    }
  });
  await mockCowApi(page);
  await denyGeolocationUnlessGranted(page);
  await page.goto("/nearby");
  await page.locator("#consentBannerAccept").click();
  await page.locator("#consentBannerAccept").click();
  await expect(page.getByRole("dialog", { name: "Set up Epping Forest Finds" })).toBeVisible();
  for (const step of ["trees", "places", "paths", "roads", "environment", "forest"]) {
    await expect(page.locator(`[data-load-step="${step}"]`)).toHaveClass(/\b(done|error)\b/);
  }
  await waitForUiToSettle(page);
  await expect(page).toHaveScreenshot("onboarding-analytics.png", { fullPage: false });
});

test("snapshot: map setup modal over Nearby", async ({ page }) => {
  await setup(page);
  await page.locator("#filterToggle").click();
  await expect(page.getByRole("dialog", { name: "Set up Epping Forest Finds" })).toBeVisible();
  await waitForUiToSettle(page);
  await expect(page).toHaveScreenshot("map-setup.png", { fullPage: false });
});

test("snapshot: usage analytics card on the map", async ({ page }) => {
  // A returning visitor who has never answered: asked once the map is up, in the inspector chrome.
  await page.addInitScript(() => {
    localStorage.removeItem("ff-track-v1");
    localStorage.setItem("ff-location-v1", "declined");
  });
  await setup(page, "/nearby/search");
  await expect(page.locator("#consentBanner")).toContainText("Help improve the map?");
  await settle(page);
  await expect(page).toHaveScreenshot("analytics-card.png", { fullPage: false });
});

test.describe("Event snapshots", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  // A fixed clock and fixed event dates, so the "Happening now" label and the date range are the
  // same on every run rather than following the day CI happens to run on.
  const NOW = new Date("2026-06-13T11:00:00Z");
  const EVENT = {
    id: "live-fair",
    name: "Autumn Forest Fair",
    description: "Stalls and a guided walk.",
    lat: FOREST_LOCATION.latitude,
    lon: FOREST_LOCATION.longitude,
    startsAt: "2026-06-13T10:00:00Z",
    endsAt: "2026-06-13T16:00:00Z",
    sourceUrl: "https://example.com/autumn-fair",
  };

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockEventsApi(page, [EVENT]);
    await setup(page);
    await expect(page.locator("#eventNearbyBanner")).toBeVisible();
  });

  test("snapshot: live event nearby banner", async ({ page }) => {
    await settle(page);
    await expect(page).toHaveScreenshot("event-nearby-banner.png", { fullPage: false });
  });

  test("snapshot: event detail view", async ({ page }) => {
    await page.locator("#eventNearbyBannerOpen").click();
    await expect(page.locator("#inspectorTitle")).toHaveText(EVENT.name);
    await settle(page);
    await expect(page).toHaveScreenshot("event-detail.png", { fullPage: false });
  });
});
