// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

test.describe("Overview / Nearby screen", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("inspector title reads 'Nearby' in overview mode", async ({ page }) => {
    // selectOverview() sets inspectorTitle to "Nearby"
    await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
  });

  test("inspector body explains demo mode when GPS is not available", async ({ page }) => {
    await expect(page.locator("#inspectorType")).toContainText("Demo mode", { timeout: 5_000 });
    await expect(page.locator("#inspectorBody")).toContainText("High Beach Visitor Centre Car Park");
  });

  test.describe("with mocked GPS inside the forest", () => {
    test.use({
      geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 },
      permissions: ["geolocation"],
    });

    test("inspector body shows nearest items when location is available", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test("nearby list does not contain the walking distance selector", async ({ page }) => {
    await expect(page.locator("#inspectorBody #settingsWalkMins")).toHaveCount(0);
  });

  test("nearby list does not show the app version", async ({ page }) => {
    await expect(page.locator("#inspectorBody #appVersionDisplay")).toHaveCount(0);
  });

  test("filter toggle button is visible in overview mode", async ({ page }) => {
    await expect(page.locator("#filterToggle")).toBeVisible();
  });

  test("settings button is visible in overview mode", async ({ page }) => {
    await expect(page.locator("#settingsToggle")).toBeVisible();
  });

  test("feedback button is visible in overview mode", async ({ page }) => {
    await expect(page.locator("#reportToggle")).toBeVisible();
  });

  test("snapshot: overview state", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
    await page.waitForFunction(
      () => !state.viewportAnimationFrame && !document.getElementById("inspector")?.classList.contains("entering"),
      { timeout: 30_000 }
    );
    await page.evaluate(() => {
      stopViewportAnimation();
      state.emojiScaleAnimated = zoomEmojiScaleTarget();
      if (typeof selectOverview === "function") selectOverview();
      draw();
    });
    await page.waitForTimeout(50);
    await expect(page).toHaveScreenshot("overview.png", { fullPage: false });
  });
});
