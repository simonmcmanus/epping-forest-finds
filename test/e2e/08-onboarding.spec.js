// @ts-check
const { test, expect } = require("@playwright/test");
const { mockCowApi, gotoAndWaitForMap } = require("./helpers");

test.describe("Onboarding", () => {
  test.describe("first visit", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

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
      await page.locator("#consentBannerDecline").click();
      await expect(page.locator("#consentBannerAccept")).toHaveText("Set up my map");
      await page.locator("#consentBannerAccept").click();
      const dialog = page.getByRole("dialog", { name: "Set up Epping Forest Finds" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    test("Escape does not accidentally finish first-run setup", async ({ page }) => {
      await page.goto("/nearby");
      await page.locator("#consentBannerDecline").click();
      await page.locator("#consentBannerAccept").click();
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("#onboardingOverlay")).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem("forest-finds-onboarding-v1"))).toBeNull();
      expect(await page.evaluate(() => state.overviewFilters.length)).toBeGreaterThan(0);
      await page.locator(".ob-skip").click();
    });

    test("the non-blocking first-run card explains location and cookies", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#consentBanner")).toBeVisible();
      await expect(page.locator("#consentBanner")).toContainText("cookies");
    });

    test("map data loads in the background while the first-run ask is visible", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#consentBanner")).toBeVisible();
      // The map data loads behind the card, which stays in the inspector while the map remains usable.
      await page.waitForFunction(() => {
        const step = document.querySelector('[data-load-step="places"]');
        return step && /done|error/.test(step.className);
      });
      await expect(page.locator("#consentBanner")).toBeVisible();
    });

    test("one first-run action records location and analytics together", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#consentBanner")).toBeVisible();
      await expect(page.locator("#consentBannerAccept")).toHaveText("Enable location & cookies");
      await page.locator("#consentBannerDecline").click();
      await expect(page.locator("#consentBannerAccept")).toHaveText("Set up my map");
      expect(await page.evaluate(() => localStorage.getItem("ff-location-v1"))).toBe("declined");
      expect(await page.evaluate(() => localStorage.getItem("ff-track-v1"))).toBe("0");
    });

    test("the first-run actions remain available without blocking the map", async ({ page }) => {
      await page.goto("/nearby");
      await expect(page.locator("#consentBanner")).toContainText("Allow location & cookies");
      await page.locator("#consentBannerAccept").click();
      await expect(page.locator("#consentBannerAccept")).toHaveText("Set up my map");
    });

    test("the guided flow toggles a chip and can go back to its welcome step", async ({ page }) => {
      await page.goto("/nearby");
      await page.locator("#consentBannerDecline").click();
      await page.locator("#consentBannerAccept").click();
      await page.locator(".ob-primary").click();
      const dialog = page.getByRole("dialog", { name: "Set up Epping Forest Finds" });
      await expect(dialog).toContainText("Nature");
      const trees = dialog.locator('.onboarding-chip[data-key="trees"]');
      await expect(trees).toHaveAttribute("aria-pressed", "true");
      await trees.click();
      await expect(trees).toHaveAttribute("aria-pressed", "false");
      await dialog.locator(".ob-back").click();
      await expect(dialog).toContainText("Make the map yours");
    });

    test("the final first-run step has no empty secondary action", async ({ page }) => {
      await page.goto("/nearby");
      await page.locator("#consentBannerDecline").click();
      await page.locator("#consentBannerAccept").click();
      await page.locator(".ob-primary").click();
      for (let i = 0; i < 6; i += 1) await page.getByRole("button", { name: "Next" }).click();
      const dialog = page.getByRole("dialog", { name: "Set up Epping Forest Finds" });
      await expect(dialog.getByRole("heading", { name: "Events" })).toBeVisible();
      await expect(dialog.locator(".onboarding-skip-btn")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Done" })).toBeVisible();
    });

    test("Explore first dismisses the setup invitation across visits", async ({ page }) => {
      await page.goto("/nearby");
      await page.locator("#consentBannerDecline").click();
      await page.locator("#consentBannerDecline").click();
      await expect(page.locator("#consentBanner")).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem("forest-finds-onboarding-v1"))).toBe("declined");
      await page.reload();
      await expect(page.locator("#consentBanner")).toBeHidden();
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
      await expect(page.getByRole("heading", { name: "What would you like to see?" })).toBeVisible();
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
