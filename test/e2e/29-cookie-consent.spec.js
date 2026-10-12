// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, denyGeolocationUnlessGranted } = require("./helpers");

// playwright.config.js pre-grants cookie consent for every other spec (see its `use.storageState`
// comment) so the banner never interferes with unrelated tests. This file is the one place that
// deliberately starts from an undecided state to exercise the banner itself.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Cookie consent banner", () => {
  test("early testing notice is omitted from the homepage, then shown once in the page flow with a feedback link", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#earlyTestingBanner")).toHaveCount(0);

    await page.goto("/terms.html");
    const banner = page.locator("#earlyTestingBanner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Epping Forest Finds is still a work in progress");
    await expect(banner).toContainText("You may find data problems or bugs");
    await expect(banner.getByRole("link", { name: "report any you find" })).toHaveAttribute("href", "/report");

    await page.reload();
    await expect(page.locator("#earlyTestingBanner")).toHaveCount(0);
  });

  test("early testing notice lives inside the app inspector instead of overlaying the map", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    await page.goto("/nearby");

    const banner = page.locator("#earlyTestingBanner");
    await expect(banner).toBeVisible();
    await expect(banner.locator("..")).toHaveAttribute("id", "earlyTestingNoticeSlot");
    await expect(banner).toHaveCSS("position", "static");

    // This fresh no-location visit receives the app's separate, intentional location invite.
    // Clear it before exercising the notice's own control.
    await expect(page.locator("#loadingOverlay")).toBeHidden({ timeout: 30_000 });
    await page.locator("#locationGateDismiss").click();
    await banner.getByRole("button", { name: "Dismiss early testing notice" }).click();
    await expect(banner).toBeHidden();
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
});
