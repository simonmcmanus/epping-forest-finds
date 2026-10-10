/**
 * The Ledger listing at /reports/ — styled to match the homepage, newest
 * edition first. See spec/spec-weekly-report.md.
 */

const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { generate } = require("../../scripts/generate-reports-index.js");

test.describe("the Ledger listing", () => {
  // reports/index.html is a build output (gitignored, written by `npm run
  // build`), and CI's e2e job does not build. Generate it the way the build
  // does, so these specs test the current generator rather than a stale file.
  test.beforeAll(() => {
    generate(path.join(__dirname, "..", "..", "reports"));
  });

  test("lists every edition newest first, under the homepage's header and forest photograph", async ({ page }) => {
    await page.goto("/reports/");

    await expect(page.locator(".site-head .brand")).toHaveAttribute("href", "/");
    await expect(page.locator(".hero h1")).toHaveText("Epping Forest Ledger");
    await expect(page.locator(".hero-photo")).toHaveAttribute("src", "/assets/home/epping-longhorns.jpg");

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


test("published editions lead with a summary and map and offer updates without needing the app", async ({ page }) => {
  await page.goto("/reports/epping-forest-ledger-2026-10-03.html");
  await expect(page.locator(".banner")).toContainText("Food and drink finds around the forest");
  await expect(page.locator("body")).not.toContainText(/pending review|proposed for the map|quick review/i);
  await expect(page.locator("#newsletter a")).toHaveAttribute("href", "https://www.eppingforestfinds.uk/#signup");
  await expect(page.locator("#newsletter")).toContainText("once the site launches");
  await expect(page.locator("#app")).toContainText("early access");
  await expect(page.locator("#inventory")).toHaveCount(0);
  expect(await page.locator("#businesses").evaluate(el => !!(el.compareDocumentPosition(document.querySelector("#map")) & Node.DOCUMENT_POSITION_PRECEDING))).toBe(true);
});

for (const width of [390, 1280]) {
  test(`the newsletter shares homepage imagery and fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/reports/epping-forest-ledger-2026-10-03.html");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 244, 236)");
    await expect(page.locator(".masthead")).toHaveCSS("background-color", "rgb(29, 74, 47)");
    await expect(page.locator(".hero-photo img")).toHaveAttribute("src", "/assets/home/epping-longhorns.jpg");
    expect(await page.locator(".hero-photo img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
