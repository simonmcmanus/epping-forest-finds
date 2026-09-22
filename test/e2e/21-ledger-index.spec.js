/**
 * The Ledger listing at /reports/ — styled to match the homepage, newest
 * edition first. See spec/spec-weekly-report.md.
 */

const { test, expect } = require("@playwright/test");

test.describe("the Ledger listing", () => {
  test("lists every edition newest first, under the homepage's header and green hero", async ({ page }) => {
    await page.goto("/reports/");

    await expect(page.locator(".site-head .brand")).toHaveAttribute("href", "/");
    await expect(page.locator(".hero h1")).toHaveText("Epping Forest Ledger");
    await expect(page.locator(".hero")).toHaveCSS("background-color", "rgb(29, 74, 47)");

    const weeks = await page.locator(".report-name").allTextContents();
    expect(weeks.length).toBeGreaterThan(0);
    const dates = weeks.map(week => Date.parse(week));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    await expect(page.locator(".report-row").first().locator(".report-latest")).toHaveText("Latest");
    await expect(page.locator(".report-latest")).toHaveCount(1);

    await page.locator(".report-link").first().click();
    await expect(page).toHaveURL(/\/reports\/epping-forest-ledger-\d{4}-\d{2}-\d{2}\.html$/);
  });

  test("fits a phone screen without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reports/");
    await expect(page.locator(".report-list")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
