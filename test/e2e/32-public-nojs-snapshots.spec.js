/**
 * Desktop-only visual coverage for public surfaces that promise useful content without JS.
 * The app's tree detail is intentionally absent: it has no dedicated no-JS page.
 */

const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { generate: generateReportsIndex } = require("../../scripts/generate-reports-index.js");
const { generate: generateCategoryPages } = require("../../scripts/generate-find-pages.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const REPORTS_DIR = path.join(REPO_ROOT, "reports");
const SNAPSHOTS = [
  { name: "homepage", path: "/", ready: "main" },
  { name: "ledger-index", path: "/reports/", ready: ".report-list" },
  { name: "ledger-edition", path: "/reports/epping-forest-ledger-2026-10-03.html", ready: "#businesses" },
  { name: "nearby-food", path: "/nearby/food/", ready: "#inspectorTitle" },
  { name: "nearby-pubs", path: "/nearby/pubs/", ready: "#inspectorTitle" },
];

test.beforeAll(() => {
  generateReportsIndex(REPORTS_DIR);
  generateCategoryPages(REPO_ROOT);
});

for (const snapshot of SNAPSHOTS) {
  test(`snapshot: ${snapshot.name} without JavaScript`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    try {
      await page.goto(snapshot.path);
      await expect(page.locator(snapshot.ready)).toBeVisible();
      await expect(page).toHaveScreenshot(`${snapshot.name}-nojs.png`, { fullPage: true });
    } finally {
      await context.close();
    }
  });
}
