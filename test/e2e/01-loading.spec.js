// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, settleMapIconsAndDraw, waitForUiToSettle } = require("./helpers");

test.describe("Loading experience", () => {
  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
  });

  test("shows the loading overlay at startup before interactive data arrives", async ({ page }) => {
    // The map shell is interactive before the full locations batch completes, so delaying a
    // location file must leave the progress strip visible without blocking the map underneath.
    let releasePlaces;
    const placesReleased = new Promise((resolve) => { releasePlaces = resolve; });
    await page.route("**/data/local-landmarks-food.geojson", async (route) => {
      await placesReleased;
      await route.continue();
    });
    await page.goto("/nearby");
    await expect(page.locator("#loadingOverlay")).toBeVisible();
    await expect(page.locator("#loadingOverlay")).toHaveClass(/inline/);
    await expect(page.locator("#mapCanvas")).toBeVisible();
    releasePlaces();
  });

  test("shows the High Beach map while location is still being requested", async ({ page }) => {
    await page.addInitScript(() => {
      // Leave the browser request unresolved to model an unanswered first-run permission prompt.
      // The map should still reveal at its fallback origin instead of waiting for the GPS branch.
      navigator.geolocation.getCurrentPosition = () => {};
    });
    await page.goto("/nearby");
    await page.waitForFunction(() => state.userLocation?.isDefault === true);
    await expect(page.locator("#mapCanvas")).toBeVisible();
    await expect(page.locator("#loadingOverlay")).toHaveClass(/inline/);
  });

  test("overlay shows a version badge element", async ({ page }) => {
    await page.goto("/nearby");
    await expect(page.locator("#sw-version")).toBeAttached();
  });

  test("loading indicators use clear artwork and respect reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/data/**/*.json", route => route.abort());
    await page.goto("/nearby");
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
    await page.goto("/nearby");
    await expect(page.locator("#loadingOverlay")).toBeHidden();
  });

  test("map canvas is visible once loading completes", async ({ page }) => {
    await page.goto("/nearby");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
    await expect(page.locator("#mapCanvas")).toBeVisible();
  });

  test("opens Filters and its pubs option while tree chunks are still downloading", async ({ page }) => {
    // Hold the tree chunks until the assertions below have run, rather than for a fixed time.
    let releaseTrees;
    const treesReleased = new Promise((resolve) => { releaseTrees = resolve; });
    await page.route("**/data/trees/chunk-*.json", async (route) => {
      await treesReleased;
      await route.continue();
    });
    await page.goto("/app#filters");

    await page.waitForFunction(() => document.getElementById("loadingOverlay")?.classList.contains("inline"));
    await expect(page.locator("#inspectorTitle")).toHaveText("Filters");
    await expect(page.locator("#inspectorBody")).toContainText("Pubs & bars");
    await expect(page.locator('[data-load-step="trees"]')).toHaveClass(/loading/);
    await expect(page.locator("#mapCanvas")).toBeVisible();
    releaseTrees();
  });

  test("falls back to the full tree register when the chunked index cannot be fetched", async ({ page }) => {
    await page.route("**/data/trees/index.json", (route) => route.fulfill({ status: 500, body: "unavailable" }));
    await page.route("**/Veteran_Tree_Register*.json", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ trees: [{ id: "fallback-1", location: { wgs84: { latitude: 51.6465, longitude: 0.0545 } } }] }),
    }));
    await page.goto("/nearby");
    await expect(page.locator('[data-load-step="trees"]')).toHaveClass(/done/);
    await expect(page.locator("[data-step-count='trees']")).toHaveText("1");
  });

  test("the map still opens when every tree download fails", async ({ page }) => {
    await page.route("**/data/trees/**", (route) => route.abort());
    await page.route("**/Veteran_Tree_Register*.json", (route) => route.abort());
    await page.goto("/nearby");
    await expect(page.locator('[data-load-step="trees"]')).toHaveClass(/error/);
    await expect(page.locator("#mapCanvas")).toBeVisible();
    await expect(page.locator('[data-load-step="places"]')).toHaveClass(/done/);
  });

  test("cows step completes with fixture data count", async ({ page }) => {
    await page.goto("/nearby");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
    // The fixture has 2 cows; the step-count badge should reflect that
    await expect(page.locator("[data-step-count='cows']")).toContainText("2");
  });

  test("snapshot: map ready state", async ({ page }) => {
    await page.goto("/nearby");
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; }, { timeout: 30_000 });
    await waitForUiToSettle(page);
    await settleMapIconsAndDraw(page);
    await expect(page).toHaveScreenshot("map-ready.png", { fullPage: false });
  });
});
