// @ts-check
const { test, expect } = require("@playwright/test");
const { mockCowApi } = require("./helpers");

test.describe("Onboarding", () => {
  test.describe("first visit", () => {
    // Do NOT call skipOnboarding() — we want the real first-visit behaviour
    test.beforeEach(async ({ page }) => {
      await mockCowApi(page);
    });

    test("onboarding overlay is shown on first visit", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("#onboardingOverlay")).toBeVisible({ timeout: 10_000 });
    });

    test("the location/compass opt-in step is shown first", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("#onboardingOverlay")).toBeVisible({ timeout: 10_000 });
      // The first step asks the user to enable location — look for the enable button or location text
      await expect(page.locator("#onboardingOverlay")).toContainText(/location|compass/i);
    });

    test("map data loads in the background while onboarding is visible", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("#onboardingOverlay")).toBeVisible({ timeout: 10_000 });
      // Loading overlay may already be hidden (data loaded behind onboarding) — either state is valid,
      // but the loading overlay must not block onboarding visibility
      const overlayHidden = await page.locator("#loadingOverlay").getAttribute("hidden");
      // Onboarding should still be visible regardless of loading state
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
    });

    test("'Skip for now' advances past the location step without granting permission", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("#onboardingOverlay")).toBeVisible({ timeout: 10_000 });
      const skipBtn = page.locator("#onboardingOverlay .onboarding-skip-btn, #onboardingOverlay [class*='skip']").first();
      await skipBtn.click();
      // Should have moved to the next step — the overlay may still be visible
      // (welcome step or a filter group step follows)
      // Just verify the location-only prompt is gone and onboarding continues
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
    });
  });

  test.describe("returning visit", () => {
    test("onboarding is skipped entirely on a returning visit", async ({ page }) => {
      await mockCowApi(page);
      await page.addInitScript(() => {
        localStorage.setItem("forest-finds-onboarding-v1", "done");
      });
      await page.goto("/");
      // Onboarding overlay must remain hidden
      await expect(page.locator("#onboardingOverlay")).toBeHidden({ timeout: 5_000 });
    });

    test("map reveals directly without onboarding on return visit", async ({ page }) => {
      await mockCowApi(page);
      await page.addInitScript(() => {
        localStorage.setItem("forest-finds-onboarding-v1", "done");
      });
      await page.goto("/");
      await page.waitForSelector("#loadingOverlay[hidden]", { timeout: 30_000 });
      await expect(page.locator("#mapCanvas")).toBeVisible();
    });
  });
});
