// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi } = require("./helpers");

test.describe("Loading experience", () => {
  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
  });

  test("shows the loading overlay at startup before data arrives", async ({ page }) => {
    // Throttle data files so the overlay stays up long enough to assert on
    await page.route("**/data/**", async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.continue();
    });
    await page.goto("/");
    await expect(page.locator("#loadingOverlay")).toBeVisible({ timeout: 5_000 });
  });

  test("overlay shows a version badge element", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#sw-version")).toBeAttached();
  });

  test("overlay dismisses automatically after all steps complete", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
  });

  test("map canvas is visible once loading completes", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
    await expect(page.locator("#mapCanvas")).toBeVisible();
  });

  test("cows step completes with fixture data count", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
    // The fixture has 2 cows; the step-count badge should reflect that
    await expect(page.locator("[data-step-count='cows']")).toContainText("2");
  });

  test("snapshot: map ready state", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => { stopViewportAnimation(); state.emojiScaleAnimated = zoomEmojiScaleTarget(); draw(); });
    await page.waitForTimeout(50);
    await expect(page).toHaveScreenshot("map-ready.png", { fullPage: false });
  });
});
