// @ts-check
const { test, expect } = require("@playwright/test");
const { mockCowApi } = require("./helpers");

test.describe("Consent banner and nav bar line up at the top of the desktop screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop layout: the nav bar sits top-right");
    await mockCowApi(page);
    await page.addInitScript(() => {
      const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
      if (!originalQuery) return;
      navigator.permissions.query = (descriptor) => descriptor && descriptor.name === "geolocation"
        ? Promise.resolve({ state: "prompt", onchange: null })
        : originalQuery(descriptor);
    });
  });

  test("the consent banner's top edge matches the nav bar's top edge", async ({ page }) => {
    await page.goto("/nearby");
    const banner = page.locator("#consentBanner");
    await expect(banner).toBeVisible();
    const nav = page.locator(".inspector-actions");
    await expect(nav).toBeVisible();
    const bannerBox = await banner.boundingBox();
    const navBox = await nav.boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(Math.abs(bannerBox.y - navBox.y)).toBeLessThan(1);
  });
});
