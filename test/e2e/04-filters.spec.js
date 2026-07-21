// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

test.describe("Filter panel", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("filter toggle opens the filter screen", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/, { timeout: 3_000 });
  });

  test("URL hash becomes #filters when the filter screen opens", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
  });

  test("filter screen stays open when the map canvas is tapped", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
    // Tap the canvas — filter screen must not close
    await page.locator("#mapCanvas").click({ position: { x: 200, y: 200 } });
    await expect(page).toHaveURL(/#filters$/);
  });

  test("Nearby button closes the filter screen and returns to overview", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
    await page.click("#nearbyToggle");
    // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
      { timeout: 5_000 }
    );
    await expect(page).not.toHaveURL(/#filters$/);
  });

  test("filter button shows active count badge when filters are toggled on", async ({ page }) => {
    await page.click("#filterToggle");
    // Click a subfilter chip to activate it
    const firstChip = page.locator(".filter-chip").first();
    await firstChip.click();
    const badge = page.locator("#filterCount");
    // Badge should be visible with a non-zero count
    await expect(badge).toBeVisible({ timeout: 3_000 });
  });

  test("snapshot: filter screen open", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => { stopViewportAnimation(); state.emojiScaleAnimated = zoomEmojiScaleTarget(); draw(); });
    await page.waitForTimeout(50);
    await expect(page).toHaveScreenshot("filter-screen.png", { fullPage: false });
  });
});
