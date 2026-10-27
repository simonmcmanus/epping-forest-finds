/**
 * The Ledger listing at /reports/ — styled to match the homepage, newest
 * edition first. See spec/spec-weekly-report.md.
 */

const path = require("node:path");
const { test, expect } = require("@playwright/test");

// beforeAll rewrites generated pages on disk; keep this file in one worker so no other worker
// reads a page mid-rewrite (the config is otherwise fullyParallel).
test.describe.configure({ mode: "default" });
const { generate } = require("../../scripts/generate-reports-index.js");

for (const width of [390, 1280]) {
  test(`individual editions lead with their date and a small cattle photograph at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/reports/epping-forest-ledger-2026-10-16.html");
    await expect(page.locator(".masthead h1")).toHaveText("Friday, 16 October 2026");
    await expect(page.locator(".ledger-name")).toHaveText("Epping Forest Ledger");
    const photo = await page.locator(".hero-photo img").boundingBox();
    expect(photo.width).toBeLessThanOrEqual(152);
    expect(photo.height).toBeLessThanOrEqual(114);
    const summary = await page.locator(".masthead > .banner").boundingBox();
    const masthead = await page.locator(".masthead").boundingBox();
    expect(summary.width).toBeCloseTo(masthead.width, 0);
    expect(summary.y).toBeGreaterThanOrEqual(photo.y + photo.height);
    expect(photo.x + photo.width).toBeGreaterThan(masthead.x + masthead.width - 30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

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
  await expect(page.locator(".masthead .banner")).toContainText("Four food and drink places to discover this week");
  await expect(page.locator("body")).not.toContainText(/pending review|proposed for the map|quick review/i);
  await expect(page.locator("#newsletter a")).toHaveAttribute("href", "https://www.eppingforestfinds.uk/#signup");
  await expect(page.locator("#newsletter")).toContainText("weekly Ledger updates when they launch");
  await expect(page.locator("#app")).toContainText("early access");
  await expect(page.locator("#inventory")).toHaveCount(0);
  await expect(page.locator(".masthead .stat-strip .stat")).toHaveCount(6);
  await expect(page.locator(".masthead .coverage")).toHaveCount(0);
  await expect(page.locator("footer.coverage")).toContainText("Loughton");
  expect(await page.locator("#businesses").evaluate(el => !!(el.compareDocumentPosition(document.querySelector("#map")) & Node.DOCUMENT_POSITION_PRECEDING))).toBe(true);
});

for (const width of [390, 1280]) {
  test(`the newsletter shares homepage imagery and fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/reports/epping-forest-ledger-2026-10-03.html");
    // Same page background as the homepage it shares imagery with, whatever the palette is today.
    const ledgerBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.goto("/");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(ledgerBackground);
    await page.goto("/reports/epping-forest-ledger-2026-10-03.html");
    await expect(page.locator(".hero-photo figcaption")).toHaveCount(0);
    await expect(page.locator(".hero-photo img")).toHaveAttribute("src", "/assets/home/epping-longhorns.jpg");
    expect(await page.locator(".hero-photo img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
