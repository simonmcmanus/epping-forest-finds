/**
 * Responsive visual coverage for the public surfaces and crawlable Nearby landings.
 * The no-JS snapshots cover only pages that deliberately server-render their content;
 * a tree selection has no dedicated no-JS page because its detail panel is app-only.
 */

const path = require("node:path");
const { test, expect } = require("@playwright/test");

// beforeAll rewrites generated pages on disk; keep this file in one worker so no other worker
// reads a page mid-rewrite (the config is otherwise fullyParallel).
test.describe.configure({ mode: "default" });
const { generate: generateReportsIndex } = require("../../scripts/generate-reports-index.js");
const { generate: generateCategoryPages } = require("../../scripts/generate-find-pages.js");
const { setup, settleMapIconsAndDraw } = require("./helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const REPORTS_DIR = path.join(REPO_ROOT, "reports");

const PUBLIC_SNAPSHOTS = [
  { name: "homepage", path: "/", ready: "main" },
  { name: "ledger-index", path: "/reports/", ready: ".report-list" },
  { name: "ledger-edition", path: "/reports/epping-forest-ledger-2026-10-03.html", ready: "#businesses" },
];

const CATEGORY_SNAPSHOTS = [
  { name: "nearby-food", path: "/nearby/food/" },
  { name: "nearby-pubs", path: "/nearby/pubs/" },
];

test.beforeAll(() => {
  // These are build output, so CI's e2e job does not have them unless the generator runs here.
  generateReportsIndex(REPORTS_DIR);
  generateCategoryPages(REPO_ROOT);
});

async function settlePublicPage(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    for (let y = 0; y <= document.documentElement.scrollHeight; y += innerHeight) {
      window.scrollTo(0, y);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  });
  await expect.poll(() => page.locator("img").evaluateAll(images => images
    .filter(image => !image.complete || image.naturalWidth === 0)
    .map(image => image.currentSrc || image.src)
  )).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const snapshot of PUBLIC_SNAPSHOTS) {
  test(`snapshot: ${snapshot.name}`, async ({ page }) => {
    await page.goto(snapshot.path);
    await expect(page.locator(snapshot.ready)).toBeVisible();
    await settlePublicPage(page);
    await expect(page).toHaveScreenshot(`${snapshot.name}.png`, { fullPage: true });
  });
}

for (const snapshot of CATEGORY_SNAPSHOTS) {
  test(`snapshot: ${snapshot.name}`, async ({ page }) => {
    await setup(page, snapshot.path);
    await expect(page.locator("#inspectorTitle")).toBeVisible();
    await settleMapIconsAndDraw(page);
    await expect(page).toHaveScreenshot(`${snapshot.name}.png`, { fullPage: false });
  });
}

