// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, denyGeolocationUnlessGranted } = require("./helpers");

// playwright.config.js pre-grants cookie consent for every other spec (see its `use.storageState`
// comment) so the banner never interferes with unrelated tests. This file is the one place that
// deliberately starts from an undecided state to exercise the banner itself.
test.use({ storageState: { cookies: [], origins: [] } });

/** The notice shows the homepage's top-left oak: drawn, loaded, and byte-for-byte the same file. */
async function expectOakLogo(page, logo) {
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  const bytesOf = async (src) => (await page.request.get(new URL(src, page.url()).href)).body();
  const logoBytes = await bytesOf(await logo.evaluate((img) => img.src));
  const homepage = await page.context().newPage();
  await homepage.goto("/");
  const markSrc = await homepage.locator(".brand-mark").evaluate((img) => img.src);
  await homepage.close();
  expect(logoBytes.equals(await bytesOf(markSrc))).toBe(true);
}

test.describe("Cookie consent banner", () => {
  test("no work-in-progress notice is shown on public pages or in the app", async ({ page }) => {
    await page.goto("/terms.html");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText("still a work in progress")).toHaveCount(0);

    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    await page.goto("/nearby");
    await expect(page.locator("#loadingOverlay")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("still a work in progress")).toHaveCount(0);
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
    await expectOakLogo(page, banner.locator("img.cookie-consent-logo"));
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
    await expectOakLogo(page, page.locator("#cookieConsentBanner img.cookie-consent-logo"));
    await page.locator("#cookieConsentBanner [data-action=\"accept\"]").click();
    await expect(page.locator("#cookieConsentBanner")).toBeHidden();

    await page.locator("#manageCookiePreferencesBtn").click();
    await expect(page.locator("#cookieConsentBanner")).toBeVisible();
  });

  test("Google's analytics script is not requested before consent, and loads once Accept is tapped", async ({ page }) => {
    const requests = [];
    await page.route("**/www.googletagmanager.com/**", (route) => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: "text/javascript", body: "" });
    });
    await page.goto("/");
    const banner = page.locator("#cookieConsentBanner");
    await expect(banner).toBeVisible();
    // Not even a cookieless ping: nothing goes to Google before an answer.
    expect(requests).toEqual([]);
    await banner.locator('[data-action="accept"]').click();
    await expect.poll(() => requests.length).toBe(1);
  });

  test("declining removes Google Analytics cookies already on the device, and never loads Google's script", async ({ page, context }) => {
    const requests = [];
    await page.route("**/www.googletagmanager.com/**", (route) => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: "text/javascript", body: "" });
    });
    await page.goto("/");
    await page.evaluate(() => { document.cookie = "_ga=GA1.1.123.456; path=/"; document.cookie = "_ga_M9NL06G2JB=GS1.1; path=/"; });
    await page.locator('#cookieConsentBanner [data-action="decline"]').click();
    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names.filter((name) => name.startsWith("_ga"))).toEqual([]);
    expect(requests).toEqual([]);
  });
});

