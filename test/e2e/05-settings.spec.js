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

  test("settings screen shows a walking radius slider", async ({ page }) => {
    await expect(page.locator("#settingsWalkMins")).toHaveAttribute("type", "range");
  });

  // Sets the slider's value directly and fires "input" the way a real drag would, rather than
  // relying on Playwright's fill() (built for text-like inputs, not always reliable on range).
  async function setWalkSlider(page, value) {
    await page.locator("#settingsWalkMins").evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }

  test("dragging the walking radius slider updates the live minute label", async ({ page }) => {
    const max = await page.locator("#settingsWalkMins").getAttribute("max");
    await setWalkSlider(page, max);
    await expect(page.locator("#settingsWalkMinsValue")).toHaveText(`${max} min`);
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(Number(max));
  });

  test("dragging the walking radius slider down to its floor reveals the limit note", async ({ page }) => {
    const slider = page.locator("#settingsWalkMins");
    const min = await slider.getAttribute("min");
    const max = await slider.getAttribute("max");

    await setWalkSlider(page, min);
    await expect(page.locator("#settingsWalkMinsFloorNote")).toBeVisible();

    await setWalkSlider(page, max);
    await expect(page.locator("#settingsWalkMinsFloorNote")).toBeHidden();
  });

  test("settings screen shows the app version in the About section", async ({ page }) => {
    await expect(page.locator("#appVersionDisplay")).toBeVisible();
    // Should start with 'v' — e.g. "v120"
    await expect(page.locator("#appVersionDisplay")).toContainText("v");
  });

  test("settings screen stays open when the map canvas is tapped", async ({ page }) => {
    await page.locator("#mapCanvas").click({ position: { x: 200, y: 200 } });
    await expect(page.locator("#settingsToggle")).toHaveClass(/screen-active/);
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
