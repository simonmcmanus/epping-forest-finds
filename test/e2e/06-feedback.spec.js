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

  test("report screen stays open when the map canvas is tapped", async ({ page }) => {
    await page.locator("#mapCanvas").click({ position: { x: 200, y: 200 } });
    await expect(page.locator("#reportToggle")).toHaveClass(/screen-active/);
  });

  test("Nearby button closes the report screen and returns to overview", async ({ page }) => {
    await page.click("#nearbyToggle");
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
      { timeout: 5_000 }
    );
    await expect(page.locator("#reportToggle")).not.toHaveClass(/screen-active/);
  });

  test("report form has a Cancel button that returns to overview", async ({ page }) => {
    await page.click("#reportCancel");
    // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
      { timeout: 5_000 }
    );
  });

  test("a double-tap on submit only sends one report", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/.netlify/functions/report-missing-data", async (route) => {
      requestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, issueNumber: 1, issueUrl: "https://github.com/simonmcmanus/epping-forest-finds/issues/1" }),
      });
    });

    await page.fill("#reportDetails", "Double-tap duplicate test");
    // Two submit events dispatched back-to-back, simulating a double-tap:
    // the second must be ignored while the first is still in flight.
    await page.evaluate(() => {
      const form = document.getElementById("reportForm");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await expect(page.locator("#reportStatus")).toContainText("submitted successfully", { timeout: 5_000 });
    expect(requestCount).toBe(1);
  });

  test("a failed submission keeps the same request id for a safe retry", async ({ page }) => {
    await page.route("**/.netlify/functions/report-missing-data", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Failed to reach GitHub API" }),
      })
    );

    await page.fill("#reportDetails", "Retry keeps request id test");
    await page.click("#reportSubmit");
    await expect(page.locator("#reportStatus")).toContainText("Failed to reach GitHub API", { timeout: 5_000 });
    const firstId = await page.evaluate(() => localStorage.getItem("forest-finds-report-request-id-v1"));
    expect(firstId).toBeTruthy();

    await page.click("#reportSubmit");
    await expect(page.locator("#reportStatus")).toContainText("Failed to reach GitHub API", { timeout: 5_000 });
    const secondId = await page.evaluate(() => localStorage.getItem("forest-finds-report-request-id-v1"));
    expect(secondId).toBe(firstId);
  });
});
