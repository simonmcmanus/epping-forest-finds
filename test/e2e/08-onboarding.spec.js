// @ts-check
const { test, expect } = require("@playwright/test");
const { mockCowApi, gotoAndWaitForMap } = require("./helpers");

test.describe("Onboarding", () => {
  test.describe("first visit", () => {
    // Do NOT call skipOnboarding() — we want the real first-visit behaviour
    test.beforeEach(async ({ page }) => {
      await mockCowApi(page);
    });

    test("onboarding overlay is shown on first visit", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
    });

    test("the onboarding overlay is announced to assistive tech as a named modal dialog", async ({ page }) => {
      await page.goto("/nearby");
      const dialog = page.getByRole("dialog", { name: "Set up Epping Forest Finds" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    test("the location/compass opt-in step is shown first", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
      // The first step asks the user to enable location — look for the enable button or location text
      await expect(page.locator("#onboardingOverlay")).toContainText(/location|compass/i);
    });

    test("map data loads in the background while onboarding is visible", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
      // The map data loads behind the overlay, which stays up until the person moves on.
      await expect(page.locator('[data-load-step="places"]')).toHaveClass(/done/);
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
    });

    test("'Skip for now' advances past the location step without granting permission", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
      await page.locator("#onboardingOverlay .ob-location-skip").click();
      // The location prompt is gone, onboarding carries on, and nothing was consented to.
      await expect(page.locator("#onboardingOverlay .ob-location")).toHaveCount(0);
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem("ff-track-v1"))).not.toBe("1");
    });

    test("the location step says where to change the choice and does not ask about usage data", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
      await expect(page.locator("#onboardingOverlay .privacy-note")).toContainText("Settings → Privacy");
      // Usage analytics is its own step (39-permission-asks.spec.js), never folded into this one.
      await expect(page.locator("#onboardingOverlay")).not.toContainText(/usage data|cookies/i);
    });

    test("tapping 'Enable location' records the choice and advances onboarding with no second location screen", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
      await page.locator("#onboardingOverlay .ob-location").click();
      await expect(page.locator("#onboardingOverlay .ob-location")).toHaveCount(0);
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
      await expect.poll(() => page.evaluate(() => localStorage.getItem("ff-location-v1"))).toBe("granted");
    });
  });

  test.describe("landing-page arrival", () => {
    // Do NOT call skipOnboarding() — this is still a first-ever visit, just one that already
    // names its own category (a /nearby/<slug> page's path, or a first-touch ?show= link).
    test.beforeEach(async ({ page }) => {
      await mockCowApi(page);
    });

    test("onboarding is skipped on a first visit that already names its own category", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby/filter?show=pubs");
      await expect(page.locator("#onboardingOverlay")).toBeHidden();
    });

    test("onboarding is skipped on a first visit that selects a location via a hash", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby#tree=r17338");
      await expect(page.locator("#onboardingOverlay")).toBeHidden();
      await expect(page.locator("#inspector")).toContainText("English Oak");
    });

    test("skipping onboarding here does not mark onboarding as completed, so plain Nearby still shows it next", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby/filter?show=pubs");
      await expect(page.locator("#onboardingOverlay")).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem("forest-finds-onboarding-v1"))).toBeNull();
    });
  });

  test.describe("returning visit", () => {
    test("onboarding is skipped entirely on a returning visit", async ({ page }) => {
      await mockCowApi(page);
      await page.addInitScript(() => {
        localStorage.setItem("forest-finds-onboarding-v1", "done");
      });
      await page.goto("/nearby");
      // Onboarding overlay must remain hidden
      await expect(page.locator("#onboardingOverlay")).toBeHidden();
    });

    test("map reveals directly without onboarding on return visit", async ({ page }) => {
      await mockCowApi(page);
      await page.addInitScript(() => {
        localStorage.setItem("forest-finds-onboarding-v1", "done");
      });
      await page.goto("/nearby");
      await page.waitForFunction(
        () => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; },
        { timeout: 30_000 }
      );
      await expect(page.locator("#mapCanvas")).toBeVisible();
    });
  });
});
