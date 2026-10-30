// @ts-check
// Every point the app asks for a permission or a consent (spec.md "Permissions and consent"):
// the app asks in its own words before any system dialog, a "not now" is remembered, and location
// and usage analytics are asked separately, with separate controls in Settings for changing either
// choice later.
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap, waitForFrames } = require("./helpers");

// Starts every test from a profile that has answered nothing (playwright.config.js pre-answers
// cookies and usage analytics for every other spec).
test.use({ storageState: { cookies: [], origins: [] } });

const FOREST_FIX = { coords: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, timestamp: 0 };

// Stands in for the browser at the boundary: what the Permissions API reports for geolocation, and
// how a request is answered. Counts requests, since a request whose permission is "prompt" is a
// system dialog on screen.
async function stubLocation(page, { permission = "prompt", answer = "deny" } = {}) {
  await page.addInitScript(({ permission, answer, fix }) => {
    window.__forestFindsGeolocationStubbed = true;
    window.__locationRequests = 0;
    navigator.geolocation.getCurrentPosition = (success, error) => {
      window.__locationRequests += 1;
      if (answer === "grant") setTimeout(() => success({ ...fix, timestamp: Date.now() }), 0);
      else if (answer === "deny") setTimeout(() => error({ code: 1, PERMISSION_DENIED: 1, message: "User denied Geolocation" }), 0);
    };
    navigator.geolocation.watchPosition = () => 1;
    navigator.geolocation.clearWatch = () => {};
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (descriptor) => (descriptor && descriptor.name === "geolocation"
      ? Promise.resolve({ state: permission })
      : query(descriptor));
  }, { permission, answer, fix: FOREST_FIX });
}

const locationRequests = (page) => page.evaluate(() => window.__locationRequests);
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

// Written once, on the first page load only, so a reload sees what the app itself stored since.
async function setStored(page, entries) {
  await page.addInitScript((pairs) => {
    if (sessionStorage.getItem("__seeded:" + Object.keys(pairs).join())) return;
    sessionStorage.setItem("__seeded:" + Object.keys(pairs).join(), "1");
    for (const [key, value] of Object.entries(pairs)) localStorage.setItem(key, value);
  }, entries);
}

test.describe("first-run onboarding", () => {
  test.beforeEach(async ({ page }) => {
    await mockCowApi(page);
  });

  test("the first-run location action enables location without deciding analytics", async ({ page }) => {
    await stubLocation(page, { answer: "grant" });
    await page.addInitScript(() => {
      localStorage.removeItem("ff-track-v1");
      localStorage.removeItem("ff-cookie-consent");
    });
    await page.goto("/nearby");
    const banner = page.locator("#consentBanner");
    await banner.getByRole("button", { name: "Enable location" }).click();
    expect(await stored(page, "ff-location-v1")).toBe("granted");
    expect(await stored(page, "ff-track-v1")).toBeNull();
    await expect(banner.getByRole("button", { name: "Share usage data" })).toBeVisible();
  });

  test("the separate first-run questions leave the guided setup available", async ({ page }) => {
    await stubLocation(page);
    await page.addInitScript(() => {
      localStorage.removeItem("ff-track-v1");
      localStorage.removeItem("ff-cookie-consent");
    });
    await page.goto("/nearby");
    await page.locator("#consentBannerAccept").click();
    await expect(page.locator("#consentBannerAccept")).toHaveText("Share usage data");
    expect(await stored(page, "ff-track-v1")).toBeNull();
    await page.locator("#consentBannerDecline").click();
    await expect(page.locator("#consentBannerAccept")).toHaveText("Set up my map");
  });

  test("'Maybe later' only declines location, then analytics can be answered separately", async ({ page }) => {
    await stubLocation(page);
    await page.addInitScript(() => {
      localStorage.removeItem("ff-track-v1");
      localStorage.removeItem("ff-cookie-consent");
    });
    await page.goto("/nearby");
    const banner = page.locator("#consentBanner");
    await banner.getByRole("button", { name: "Maybe later" }).click();
    expect(await stored(page, "ff-location-v1")).toBe("declined");
    expect(await stored(page, "ff-track-v1")).toBeNull();
    await expect(banner.getByRole("button", { name: "No thanks" })).toBeVisible();
    await banner.getByRole("button", { name: "No thanks" }).click();
    expect(await stored(page, "ff-track-v1")).toBe("0");
    expect(await stored(page, "ff-cookie-consent")).toBe("denied");
    await expect(banner.getByRole("button", { name: "Set up my map" })).toBeVisible();
  });

  test("usage analytics already refused is not overwritten by the location action", async ({ page }) => {
    await stubLocation(page);
    await setStored(page, { "ff-cookie-consent": "denied" });
    await page.goto("/nearby");
    const banner = page.locator("#consentBanner");
    await banner.getByRole("button", { name: "Enable location" }).click();
    expect(await stored(page, "ff-cookie-consent")).toBe("denied");
    await expect(banner.getByRole("button", { name: "Set up my map" })).toBeVisible();
  });

  test("'Maybe later' is not followed by another location ask, then or on the next visit", async ({ page }) => {
    await stubLocation(page);
    await page.goto("/nearby/search");
    const banner = page.locator("#consentBanner");
    await banner.getByRole("button", { name: "Maybe later" }).click();
    await banner.getByRole("button", { name: "No thanks" }).click();
    await banner.getByRole("button", { name: "Explore first" }).click();
    await page.waitForFunction(() => typeof state !== "undefined" && state.dataLoaded === true);
    await page.waitForFunction(() => document.querySelector("[data-load-step='location']")?.classList.contains("error"));
    await expect(page.locator("#locationInviteBanner")).toBeHidden();

    await page.reload();
    await gotoAndWaitForMap(page, "/nearby/search");
    expect(await locationRequests(page)).toBe(0);
    await expect(page.locator("#locationInviteBanner")).toBeHidden();
  });
});

test.describe("a returning visit", () => {
  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await setStored(page, { "ff-track-v1": "0" });
  });

  test("never puts a system location prompt up by itself: the in-app invite asks first", async ({ page }) => {
    await stubLocation(page, { permission: "prompt" });
    await gotoAndWaitForMap(page, "/nearby/search");
    expect(await locationRequests(page)).toBe(0);
    await expect(page.locator("#locationInviteBanner")).toBeVisible();
    await expect(page.locator("#locationInviteButton")).toBeVisible();
  });

  test("asks for a position straight away when the permission is already granted", async ({ page }) => {
    await stubLocation(page, { permission: "granted", answer: "grant" });
    await gotoAndWaitForMap(page, "/nearby/search");
    expect(await locationRequests(page)).toBe(1);
    await expect.poll(() => page.evaluate(() => Boolean(state.userLocation && !state.userLocation.isDefault))).toBe(true);
    await expect(page.locator("#locationInviteBanner")).toBeHidden();
  });

  test("asks for a position straight away for someone who turned location on in the app before", async ({ page }) => {
    // Some browsers re-ask every session; that prompt answers a request this person made.
    await stubLocation(page, { permission: "prompt", answer: "grant" });
    await setStored(page, { "ff-location-v1": "granted" });
    await gotoAndWaitForMap(page, "/nearby/search");
    expect(await locationRequests(page)).toBe(1);
  });

  test("a refused system dialog is the answer: no in-app card follows it, and the next visit does not ask", async ({ page }) => {
    await stubLocation(page, { permission: "prompt", answer: "deny" });
    await setStored(page, { "ff-location-v1": "granted" });
    await gotoAndWaitForMap(page, "/nearby/search");
    expect(await locationRequests(page)).toBe(1);
    await expect(page.locator("#locationInviteBanner")).toBeHidden();
    expect(await stored(page, "ff-location-v1")).toBe("declined");

    await page.reload();
    await gotoAndWaitForMap(page, "/nearby/search");
    expect(await locationRequests(page)).toBe(0);
    await expect(page.locator("#locationInviteBanner")).toBeHidden();
  });

  test("'Maybe later' on the invite is remembered across visits", async ({ page }) => {
    await stubLocation(page, { permission: "prompt" });
    await gotoAndWaitForMap(page, "/nearby/search");
    await page.locator("#locationInviteDismiss").click();
    await expect(page.locator("#locationInviteBanner")).toBeHidden();

    await page.reload();
    await gotoAndWaitForMap(page, "/nearby/search");
    await expect(page.locator("#locationInviteBanner")).toBeHidden();
    expect(await locationRequests(page)).toBe(0);
  });

  test("location blocked in browser settings is explained, with no button that could not work", async ({ page }) => {
    await stubLocation(page, { permission: "denied" });
    await gotoAndWaitForMap(page, "/nearby/search");
    expect(await locationRequests(page)).toBe(0);
    await expect(page.locator("#locationInviteMessage")).toContainText("blocked for this site");
    await expect(page.locator("#locationInviteButton")).toBeHidden();
    await expect(page.locator("#locationInviteDismiss")).toHaveText("OK");
  });

  test("usage analytics never answered is asked once the map is up, and only after the location invite has gone", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("ff-track-v1"));
    await stubLocation(page, { permission: "prompt" });
    await gotoAndWaitForMap(page, "/nearby/search");
    await expect(page.locator("#locationInviteBanner")).toBeVisible();
    await expect(page.locator("#consentBanner")).toBeHidden();

    await page.locator("#locationInviteDismiss").click();
    const card = page.locator("#consentBanner");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Help improve the map?");
    await page.locator("#consentBannerDecline").click();
    await expect(card).toBeHidden();
    expect(await stored(page, "ff-track-v1")).toBe("0");
    // The shared cookie banner never asks the same thing again on the app.
    await expect(page.locator("#cookieConsentBanner")).toHaveCount(0);
  });

  test("opening the feedback form does not ask for location", async ({ page }) => {
    await stubLocation(page, { permission: "prompt" });
    await gotoAndWaitForMap(page, "/feedback");
    await expect(page.locator("#reportForm")).toBeVisible();
    expect(await locationRequests(page)).toBe(0);
  });
});

test.describe("a landing-page arrival", () => {
  // isLandingPageArrival() skips onboarding, so the non-blocking card asks instead.
  test.beforeEach(async ({ page }) => {
    await mockCowApi(page);
  });

  test("asks for location and analytics as separate questions", async ({ page }) => {
    await stubLocation(page, { permission: "prompt" });
    await gotoAndWaitForMap(page, "/nearby/filter?show=pubs");
    const card = page.locator("#consentBanner");
    await expect(card).toBeVisible();
    await expect(page.locator("#consentBannerAccept")).toHaveText("Enable location");
    await expect(card).toContainText("walking distances");
    // Led by the same oak logo as every other notice (spec.md "Logo on notices").
    const logo = card.locator("img.consent-banner-logo");
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await locationRequests(page)).toBe(0);

    await page.locator("#consentBannerDecline").click();
    await expect(card).toContainText("Help improve the map?");
    await page.locator("#consentBannerDecline").click();
    await expect(card).toBeHidden();

    expect(await stored(page, "ff-location-v1")).toBe("declined");
    expect(await stored(page, "ff-track-v1")).toBe("0");
    // The card was the ask: nothing else draws in its place.
    await expect(page.locator("#locationInviteBanner")).toBeHidden();
    await expect(page.locator("#cookieConsentBanner")).toHaveCount(0);
  });

  test("'Enable location' on the card applies a real fix live, then analytics is offered", async ({ page }) => {
    await stubLocation(page, { permission: "prompt", answer: "grant" });
    await gotoAndWaitForMap(page, "/nearby/filter?show=pubs");
    await page.locator("#consentBannerAccept").click();
    await expect.poll(() => page.evaluate(() => Boolean(state.userLocation && !state.userLocation.isDefault))).toBe(true);
    expect(await locationRequests(page)).toBe(1);
    await expect(page.locator("#consentBanner")).toContainText("Help improve the map?");
    await page.locator("#consentBannerAccept").click();
    expect(await stored(page, "ff-track-v1")).toBe("1");
  });

  test("with location already allowed, the card asks only about usage analytics", async ({ page }) => {
    await stubLocation(page, { permission: "granted", answer: "grant" });
    await gotoAndWaitForMap(page, "/nearby/filter?show=pubs");
    await expect(page.locator("#consentBanner")).toContainText("Help improve the map?");
    await page.locator("#consentBannerAccept").click();
    expect(await stored(page, "ff-track-v1")).toBe("1");
    expect(await stored(page, "ff-cookie-consent")).toBe("granted");
  });

  test("a repeat visit with both questions answered shows no card", async ({ page }) => {
    await stubLocation(page, { permission: "prompt" });
    await setStored(page, { "ff-location-v1": "declined", "ff-track-v1": "0" });
    await gotoAndWaitForMap(page, "/nearby/filter?show=pubs");
    await expect(page.locator("#consentBanner")).toBeHidden();
    await expect(page.locator("#locationInviteBanner")).toBeHidden();
  });
});

test.describe("Settings → Privacy", () => {
  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
  });

  test("'Use my location' is the way back after saying not now", async ({ page }) => {
    await stubLocation(page, { permission: "prompt", answer: "grant" });
    await setStored(page, { "ff-location-v1": "declined", "ff-track-v1": "0" });
    await gotoAndWaitForMap(page, "/settings");
    await expect(page.locator("#locationStatus")).toHaveText("off");
    await page.locator("#settingsLocateButton").click();
    await expect(page.locator("#locationStatus")).toHaveText("on");
    await expect(page.locator("#settingsLocateButton")).toBeHidden();
    expect(await stored(page, "ff-location-v1")).toBe("granted");
  });

  test("location blocked in browser settings is explained instead of offered", async ({ page }) => {
    await stubLocation(page, { permission: "denied" });
    await setStored(page, { "ff-track-v1": "0" });
    await gotoAndWaitForMap(page, "/settings");
    await expect(page.locator("#locationBlockedNote")).toContainText("blocked for this site");
    await expect(page.locator("#settingsLocateButton")).toBeHidden();
  });

  test("usage analytics is one switch covering usage data and analytics cookies", async ({ page }) => {
    await stubLocation(page);
    await setStored(page, { "ff-track-v1": "0", "ff-location-v1": "declined" });
    await gotoAndWaitForMap(page, "/settings");
    await expect(page.locator("#analyticsStatus")).toHaveText("off");
    await page.locator("#analyticsToggle").click();
    await expect(page.locator("#analyticsStatus")).toHaveText("on");
    expect(await stored(page, "ff-track-v1")).toBe("1");
    expect(await stored(page, "ff-cookie-consent")).toBe("granted");
    await page.locator("#analyticsToggle").click();
    expect(await stored(page, "ff-track-v1")).toBe("0");
    expect(await stored(page, "ff-cookie-consent")).toBe("denied");
  });
});

test.describe("compass access on motion-permission browsers", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045 }, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await setStored(page, { "ff-track-v1": "0" });
    await page.addInitScript(() => {
      if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = class {};
      window.DeviceOrientationEvent.requestPermission = () => Promise.resolve("granted");
    });
  });

  test("dismissing the 'Enable compass' card is remembered across visits", async ({ page }) => {
    await gotoAndWaitForMap(page);
    await expect(page.locator("#compassCalibrationBannerEnable")).toBeVisible();
    await page.locator("#compassCalibrationBannerDismiss").click();
    await expect(page.locator("#compassCalibrationBanner")).toBeHidden();

    await page.reload();
    await gotoAndWaitForMap(page);
    // Comfortably past the probe window (COMPASS_GRANT_PROBE_MS) in which the card would appear.
    await waitForFrames(page, 150);
    await expect(page.locator("#compassCalibrationBanner")).toBeHidden();
  });

  test("a grant the browser still remembers is not asked for again", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("forest-finds-compass-permission-v1", "granted"));
    await page.addInitScript(() => {
      // The remembered grant delivering headings with no new request.
      setInterval(() => {
        const event = new Event("deviceorientation");
        Object.assign(event, { alpha: 120, beta: 10, gamma: 0, webkitCompassHeading: 240, webkitCompassAccuracy: 10 });
        window.dispatchEvent(event);
      }, 100);
    });
    await gotoAndWaitForMap(page);
    await expect.poll(() => page.evaluate(() => state.compassPermission)).toBe("granted");
    await expect(page.locator("#compassCalibrationBannerEnable")).toBeHidden();
  });
});

test.describe("compass access before any real location", () => {
  test("the High Beach stand-in never brings up the compass card on top of the location ask", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await setStored(page, { "ff-track-v1": "0" });
    await page.addInitScript(() => {
      if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = class {};
      window.DeviceOrientationEvent.requestPermission = () => Promise.resolve("granted");
    });
    await stubLocation(page, { permission: "prompt" });
    await gotoAndWaitForMap(page, "/nearby/filter?show=pubs");
    await expect(page.locator("#consentBanner")).toBeVisible();
    // Comfortably past the probe window (COMPASS_GRANT_PROBE_MS) in which the card would appear.
    await waitForFrames(page, 150);
    await expect(page.locator("#compassCalibrationBannerEnable")).toBeHidden();
  });
});

