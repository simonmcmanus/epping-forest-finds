// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi } = require("./helpers");

// The palette lab (dev/palette-lab.html) is a developer tool, not a user journey. These tests pin the
// one promise it makes: a chosen palette repaints the real app's panels, and Reset gives the app back
// its own colours. They measure the computed colour inside the app frame, not the lab's own markup.

/** Computed background of the first inspector panel in the app frame. */
async function panelBackground(app) {
  return app.locator(".inspector").first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

async function openSettingsInLab(page) {
  await skipOnboarding(page);
  await mockCowApi(page);
  await page.goto("/dev/palette-lab.html");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const app = page.frameLocator("#app-frame");
  await expect(app.locator(".inspector").first()).toBeVisible();
  return app;
}

test.describe("Palette lab", () => {
  test("choosing Warm stone repaints the app's panels in the Warm stone panel colour", async ({ page }) => {
    const app = await openSettingsInLab(page);
    const original = await panelBackground(app);

    await page.getByRole("button", { name: "Warm stone", exact: true }).click();

    // #fffdfa, the Warm stone panel token, as the browser reports it.
    await expect.poll(() => panelBackground(app)).toBe("rgb(255, 253, 250)");
    expect(original).not.toBe("rgb(255, 253, 250)");
  });

  test("Reset to app defaults gives the panel back its own colour", async ({ page }) => {
    const app = await openSettingsInLab(page);
    const original = await panelBackground(app);

    await page.getByRole("button", { name: "Slate harbour", exact: true }).click();
    await expect.poll(() => panelBackground(app)).not.toBe(original);

    await page.getByRole("button", { name: "Reset to app defaults" }).click();
    await expect.poll(() => panelBackground(app)).toBe(original);
  });
});
