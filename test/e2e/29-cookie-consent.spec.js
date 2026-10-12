// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, denyGeolocationUnlessGranted } = require("./helpers");

// A GPS fix inside Epping Forest -- same value as 09-location.spec.js's own FOREST_LOCATION.
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

// playwright.config.js pre-grants cookie consent for every other spec (see its `use.storageState`
// comment) so the banner never interferes with unrelated tests. This file is the one place that
// deliberately starts from an undecided state to exercise the banner itself.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Cookie consent banner", () => {
  test("early testing notice is omitted from the homepage, then shown once elsewhere with feedback and mailing-list links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#earlyTestingBanner")).toHaveCount(0);

    await page.goto("/terms.html");
    const banner = page.locator("#earlyTestingBanner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("a few map details may be a bit off");
    await expect(banner.getByRole("link", { name: "Report feedback" })).toHaveAttribute("href", "/report");
    await expect(banner.getByRole("link", { name: "get email updates" })).toHaveAttribute("href", "/#signup");

    await page.reload();
    await expect(page.locator("#earlyTestingBanner")).toHaveCount(0);
  });

  test("the short /report link opens the app feedback screen", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    await page.goto("/report");
    await expect(page.locator("#reportForm")).toBeVisible();
    await expect(page.locator("#inspectorTitle")).toHaveText("Feedback");
  });

  test("is shown on first visit to the homepage, and Accept hides it and persists", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator("#cookieConsentBanner");
    await expect(banner).toBeVisible();
    await banner.locator('[data-action="accept"]').click();
    await expect(banner).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("ff-cookie-consent"))).toBe("granted");

    await page.reload();
    await expect(page.locator("#cookieConsentBanner")).toBeHidden();
  });

  test("Decline hides the banner, persists, and does not grant analytics storage", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator("#cookieConsentBanner");
    await expect(banner).toBeVisible();
    await banner.locator('[data-action="decline"]').click();
    await expect(banner).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("ff-cookie-consent"))).toBe("denied");

    await page.reload();
    await expect(page.locator("#cookieConsentBanner")).toBeHidden();
  });

  test("is shown on the app shell the same way as the homepage", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    await page.goto("/nearby");
    await expect(page.locator("#cookieConsentBanner")).toBeVisible();
  });

  test("a choice made on the homepage carries over to the app without asking again", async ({ page }) => {
    await page.goto("/");
    await page.locator("#cookieConsentBanner [data-action=\"accept\"]").click();

    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    await page.goto("/nearby");
    await expect(page.locator("#cookieConsentBanner")).toBeHidden();
  });

  test("terms.html offers a 'Manage cookie preferences' control that reopens the banner", async ({ page }) => {
    await page.goto("/terms.html");
    await page.locator("#cookieConsentBanner [data-action=\"accept\"]").click();
    await expect(page.locator("#cookieConsentBanner")).toBeHidden();

    await page.locator("#manageCookiePreferencesBtn").click();
    await expect(page.locator("#cookieConsentBanner")).toBeVisible();
  });

  test("declining analytics leaves the first-party location/usage consent untouched", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    await page.goto("/nearby");
    await page.locator("#cookieConsentBanner [data-action=\"decline\"]").click();
    // The in-app tracker consent key is independent of the cookie-consent banner's choice.
    expect(await page.evaluate(() => localStorage.getItem("ff-track-v1"))).toBeNull();
  });

  test("on first-run onboarding, the standalone banner is suppressed and 'Enable location' grants cookie consent too", async ({ page }) => {
    // Do NOT call skipOnboarding() — the merge only applies to the real first-visit overlay.
    await mockCowApi(page);
    await page.goto("/nearby");
    await expect(page.locator("#onboardingOverlay")).toBeVisible();
    await expect(page.locator("#cookieConsentBanner")).toHaveCount(0);

    await page.locator("#onboardingOverlay .ob-location").click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("ff-cookie-consent"))).toBe("granted");
    // Resolved by the onboarding tap, not by a banner that appears afterward.
    await expect(page.locator("#cookieConsentBanner")).toHaveCount(0);
  });

  test("on first-run onboarding, 'Skip for now' declines cookie consent too with no banner afterward", async ({ page }) => {
    await mockCowApi(page);
    await page.goto("/nearby");
    await expect(page.locator("#onboardingOverlay")).toBeVisible();

    await page.locator("#onboardingOverlay .ob-location-skip").click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("ff-cookie-consent"))).toBe("denied");
    await expect(page.locator("#cookieConsentBanner")).toHaveCount(0);
  });

  test.describe("landing-page arrival (merged location + cookie gate)", () => {
    // Do NOT call skipOnboarding() — isLandingPageArrival() already skips onboarding on its own
    // (js/app.js), and these tests are about what replaces it there: cookie consent is still
    // undecided (this file's own storageState), same as a genuine first visit.

    test.describe("geolocation granted", () => {
      // Grants the browser permission itself (not just cookie consent) so tapping Enable runs
      // the whole merged flow to a real success -- the happy-path case this gate is meant for,
      // where the gate stays hidden afterward rather than revealNoRealLocation's separate
      // no-fix invite reappearing moments later (see the decline test below for that case).
      test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

      test("shows one combined gate instead of the standalone cookie banner, and Enable grants both", async ({ page }) => {
        await mockCowApi(page);
        await page.goto("/nearby/filter?show=pubs");

        const gate = page.locator("#locationGate");
        await expect(gate).toBeVisible();
        await expect(page.locator("#cookieConsentBanner")).toHaveCount(0);
        await expect(page.locator("#locationGateMessage")).toContainText("cookies");

        await page.locator("#locationGateButton").click();
        await expect.poll(() => page.evaluate(() => localStorage.getItem("ff-cookie-consent"))).toBe("granted");
        await expect(gate).toBeHidden();
        // Resolved by the gate's own tap, not by a banner that appears afterward.
        await expect(page.locator("#cookieConsentBanner")).toHaveCount(0);
      });
    });

    test("'Maybe later' declines cookie consent too, with no banner afterward", async ({ page }) => {
      await mockCowApi(page);
      await page.goto("/nearby/filter?show=pubs");

      const gate = page.locator("#locationGate");
      await expect(gate).toBeVisible();

      await page.locator("#locationGateDismiss").click();
      await expect.poll(() => page.evaluate(() => localStorage.getItem("ff-cookie-consent"))).toBe("denied");
      // revealNoRealLocation's own separate "get a more custom experience" invite may reappear
      // shortly after (existing behaviour for any no-real-fix landing-page arrival, unrelated to
      // cookie consent) -- the cookie banner must not, since consent is already decided.
      await expect(page.locator("#cookieConsentBanner")).toHaveCount(0);
    });

    test("a repeat landing-page visit with consent already settled skips the combined gate", async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("ff-cookie-consent", "granted"));
      await denyGeolocationUnlessGranted(page);
      await mockCowApi(page);
      await page.goto("/nearby/filter?show=pubs");
      await page.waitForFunction(
        () => document.getElementById("loadingOverlay")?.hidden === true,
        { timeout: 30_000 }
      );
      // Consent was already decided, so this falls through to the ordinary immediate-fire
      // location request instead -- no gate tap needed, and no banner either since consent is
      // already stored.
      await expect(page.locator("#cookieConsentBanner")).toHaveCount(0);
    });
  });
});
