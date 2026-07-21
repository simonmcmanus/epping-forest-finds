// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

test.describe("Feedback / Report screen", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.click("#reportToggle");
    await expect(page.locator("#reportDetails")).toBeVisible({ timeout: 5_000 });
  });

  test("feedback button opens the report form", async ({ page }) => {
    await expect(page.locator("#reportToggle")).toHaveClass(/screen-active/);
    await expect(page.locator("#reportForm")).toBeVisible();
  });

  test("report form includes the current app version", async ({ page }) => {
    // The version is displayed inside the form so the user knows which version will be reported
    await expect(page.locator("#reportForm")).toContainText("v");
  });

  test("report form has a text area for the user's description", async ({ page }) => {
    await expect(page.locator("#reportDetails")).toBeVisible();
  });

  test("report form has a Submit button", async ({ page }) => {
    await expect(page.locator("#reportSubmit")).toBeVisible();
  });

  test("report form has a Cancel button that returns to overview", async ({ page }) => {
    await page.click("#reportCancel");
    // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
      { timeout: 5_000 }
    );
  });
});
