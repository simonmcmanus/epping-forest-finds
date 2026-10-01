// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, settleMapIconsAndDraw } = require("./helpers");

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
    await page.goto("/app");
    await expect(page.locator("#loadingOverlay")).toBeVisible();
  });

  test("overlay shows a version badge element", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("#sw-version")).toBeAttached();
  });

  test("loading indicators use clear artwork and respect reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/data/**/*.json", route => route.abort());
    await page.goto("/app");
    const indicators = await page.evaluate(async () => {
      setLoadStep("trees", "loading");
      setLoadStep("places", "done");
      const loading = document.querySelector('[data-load-step="trees"] .step-icon');
      const done = document.querySelector('[data-load-step="places"] .step-icon');
      const spinner = getComputedStyle(loading, "::before");
      const tick = getComputedStyle(done, "::after");
      const urls = [spinner.backgroundImage, tick.backgroundImage].map(value => value.match(/url\(["']?(.*?)["']?\)/)?.[1]);
      const decoded = await Promise.all(urls.map(async url => {
        if (!url) return false;
        const img = new Image(); img.src = url; await img.decode();
        return img.naturalWidth > 0;
      }));
      return { decoded, animation: spinner.animationName, width: parseFloat(tick.width), background: getComputedStyle(done).backgroundColor };
    });
    expect(indicators.decoded).toEqual([true, true]);
    expect(indicators.animation).toBe("none");
    expect(indicators.width).toBeGreaterThanOrEqual(20);
    expect(indicators.background).toBe("rgba(0, 0, 0, 0)");
  });

  test("overlay dismisses automatically after all steps complete", async ({ page }) => {
    await page.goto("/app");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
  });

  test("map canvas is visible once loading completes", async ({ page }) => {
    await page.goto("/app");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
    await expect(page.locator("#mapCanvas")).toBeVisible();
  });

  test("cows step completes with fixture data count", async ({ page }) => {
    await page.goto("/app");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
    // The fixture has 2 cows; the step-count badge should reflect that
    await expect(page.locator("[data-step-count='cows']")).toContainText("2");
  });

  test("snapshot: map ready state", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
    await page.goto("/app");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
    await page.waitForTimeout(600);
    await settleMapIconsAndDraw(page);
    await expect(page).toHaveScreenshot("map-ready.png", { fullPage: false });
  });
});
