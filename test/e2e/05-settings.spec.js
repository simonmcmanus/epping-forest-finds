// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

test.describe("Settings screen", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.click("#settingsToggle");
    // Wait for the settings panel to render
    await expect(page.locator("#settingsWalkMins")).toBeVisible({ timeout: 5_000 });
  });

  test("settings button opens the settings screen", async ({ page }) => {
    await expect(page.locator("#settingsToggle")).toHaveClass(/screen-active/);
  });

  test("settings screen shows a walking radius dropdown", async ({ page }) => {
    await expect(page.locator("#settingsWalkMins")).toBeVisible();
  });

  test("settings screen shows the app version in the About section", async ({ page }) => {
    await expect(page.locator("#appVersionDisplay")).toBeVisible();
    // Should start with 'v' — e.g. "v120"
    await expect(page.locator("#appVersionDisplay")).toContainText("v");
  });

  test("nearby button returns to overview from settings", async ({ page }) => {
    await page.click("#nearbyToggle");
    // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
      { timeout: 5_000 }
    );
  });

  test("snapshot: settings screen", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
    await page.waitForTimeout(300);
    await page.evaluate(() => { stopViewportAnimation(); state.emojiScaleAnimated = zoomEmojiScaleTarget(); draw(); });
    await page.waitForTimeout(50);
    await expect(page).toHaveScreenshot("settings-screen.png", { fullPage: false });
  });
});
