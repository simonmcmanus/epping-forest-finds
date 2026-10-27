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

    // A no-location visit can receive the app's separate, non-blocking location invite banner.
    // It is asynchronous, so CI may instead reach the completed no-location state without
    // showing that prompt. Clear it when present before exercising the notice's own control.
    await expect(page.locator("#loadingOverlay")).toBeHidden({ timeout: 30_000 });
    const locationInviteDismiss = page.locator("#locationInviteDismiss");
    if (await locationInviteDismiss.isVisible()) await locationInviteDismiss.click();
    await banner.getByRole("button", { name: "Dismiss early testing notice" }).evaluate(button => button.click());
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

  test("mobile keeps the early-testing notice above the map and out of the Nearby sheet", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile layout only");
    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    await page.goto("/app");

    const notice = page.locator("#earlyTestingBanner");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Epping Forest Finds is still a work in progress");
    expect(await notice.evaluate((element) => element.parentElement === document.body)).toBe(true);
    expect((await notice.boundingBox()).y).toBeLessThan(80);
  });

  test("a cookie choice made on the homepage is not asked again by a cookie banner in the app", async ({ page }) => {
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
});
