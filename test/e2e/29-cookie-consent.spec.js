// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, denyGeolocationUnlessGranted } = require("./helpers");

// playwright.config.js pre-grants cookie consent for every other spec (see its `use.storageState`
// comment) so the banner never interferes with unrelated tests. This file is the one place that
// deliberately starts from an undecided state to exercise the banner itself.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Cookie consent banner", () => {
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
    await page.goto("/app");
    await expect(page.locator("#cookieConsentBanner")).toBeVisible();
  });

  test("a choice made on the homepage carries over to the app without asking again", async ({ page }) => {
    await page.goto("/");
    await page.locator("#cookieConsentBanner [data-action=\"accept\"]").click();

    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    await page.goto("/app");
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
    await page.goto("/app");
    await page.locator("#cookieConsentBanner [data-action=\"decline\"]").click();
    // The in-app tracker consent key is independent of the cookie-consent banner's choice.
    expect(await page.evaluate(() => localStorage.getItem("ff-track-v1"))).toBeNull();
  });
});
