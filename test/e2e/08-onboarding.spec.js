// @ts-check
const { test, expect } = require("@playwright/test");
const { mockCowApi, gotoAndWaitForMap } = require("./helpers");

test.describe("Onboarding", () => {
  test.describe("first visit", () => {
    // Do NOT call skipOnboarding() — we want the real first-visit behaviour
    test.beforeEach(async ({ page }) => {
      await mockCowApi(page);
      await page.addInitScript(() => {
        const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
        if (!originalQuery) return;
        navigator.permissions.query = (descriptor) => descriptor && descriptor.name === "geolocation"
          ? Promise.resolve({ state: "prompt", onchange: null })
          : originalQuery(descriptor);
      });
    });

    test("the map remains usable and the first-run ask sits in the inspector", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#consentBanner")).toBeVisible();
      await expect(page.locator("#onboardingOverlay")).toBeHidden();
    });

    test("the guided dialog is announced after the reader asks for setup", async ({ page }) => {
      await page.goto("/nearby");
      const accept = page.locator("#consentBannerAccept");
      if (await accept.textContent() !== "Set up my map") await accept.click();
      await expect(page.locator("#consentBannerAccept")).toHaveText("Set up my map");
      await accept.click();
      const dialog = page.getByRole("dialog", { name: "Set up Epping Forest Finds" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    test("the non-blocking first-run card explains location and cookies", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#consentBanner")).toBeVisible();
      await expect(page.locator("#consentBanner")).toContainText(/location|cookies/i);
    });

    test("map data loads in the background while the first-run ask is visible", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#consentBanner")).toBeVisible();
      // The map data loads behind the card, which stays in the inspector while the map remains usable.
      await expect(page.locator('[data-load-step="places"]')).toHaveClass(/done|error/, { timeout: 30_000 });
      await expect(page.locator("#consentBanner")).toBeVisible();
    });

  test("'Maybe later' records a location choice without blocking the map", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#consentBanner")).toBeVisible();
      await page.locator("#consentBannerDecline").click();
      await expect(page.locator("#consentBannerAccept")).toHaveText("Set up my map");
      expect(await page.evaluate(() => localStorage.getItem("ff-track-v1"))).not.toBe("1");
    });

  test("the combined first-run action moves to setup without blocking the map", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.removeItem("ff-track-v1");
        localStorage.removeItem("ff-cookie-consent");
      });
      await page.goto("/nearby");
      await expect(page.locator("#consentBanner")).toContainText("Allow location & cookies");
      await page.locator("#consentBannerAccept").click();
      await expect(page.locator("#consentBannerAccept")).toHaveText("Set up my map");
      expect(await page.evaluate(() => localStorage.getItem("ff-track-v1"))).toBe("1");
    });

  test("tapping the combined action records location and analytics together", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.removeItem("ff-track-v1");
        localStorage.removeItem("ff-cookie-consent");
        navigator.geolocation.getCurrentPosition = (success) => success({
          coords: { latitude: 51.665, longitude: 0.045, accuracy: 8 },
          timestamp: Date.now(),
        });
      });
      await page.goto("/nearby");
      await page.locator("#consentBannerAccept").click();
      await expect.poll(() => page.evaluate(() => localStorage.getItem("ff-location-v1"))).toBe("granted");
      expect(await page.evaluate(() => localStorage.getItem("ff-track-v1"))).toBe("1");
    });
  });

  test.describe("landing-page arrival", () => {
    // Do NOT call skipOnboarding() — this is still a first-ever visit, just one that already
    // names its own category (a /nearby/<slug> page's path, or a first-touch ?show= link).
    test.beforeEach(async ({ page }) => {
      await mockCowApi(page);
    });

    test("the legacy filter route opens filter setup without permission steps", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby/filter?show=pubs");
      await expect(page.getByRole("heading", { name: "Choose what appears on the map" })).toBeVisible();
      await expect(page.locator("#onboardingOverlay")).not.toContainText("Allow location");
    });

    test("onboarding is skipped on a first visit that selects a location via a hash", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby#tree=r17338");
      await expect(page.locator("#onboardingOverlay")).toBeHidden();
      await expect(page.locator("#inspector")).toContainText("English Oak");
    });

    test("closing filter setup does not mark first-visit onboarding as completed", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby/filter?show=pubs");
      await page.getByRole("button", { name: "Keep current choices" }).click();
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
