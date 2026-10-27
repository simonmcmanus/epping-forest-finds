/**
 * Visual snapshot of a location page: a generated /find/<slug>/ business page, opened the way a
 * reader lands on it, with no location shared. See spec/spec-marketing.md section 6.6 and
 * spec/spec-data-rendering.md (the place panel).
 */

const { test, expect } = require("@playwright/test");

// beforeAll rewrites generated pages on disk; keep this file in one worker so no other worker
// reads a page mid-rewrite (the config is otherwise fullyParallel).
test.describe.configure({ mode: "default" });
const { generate: generateBusinessPages } = require("../../scripts/generate-business-pages.js");
const businessIndex = require("../../data/business-slugs.json");
const { gotoAndWaitForMap, settleMapIconsAndDraw, skipOnboarding, mockCowApi, waitForUiToSettle } = require("./helpers");

const REPO_ROOT = require("node:path").join(__dirname, "..", "..");

// A real business picked from the data rather than a hardcoded name that could close or be renamed,
// the same way 30-find-pages.spec.js picks its example pub. The first pub with an address and
// coordinates, in the order the index lists them, so the choice is stable for a given data file.
const EXAMPLE_PUB = businessIndex.entries.find((e) => e.key === "pubs" && e.address && e.lat != null);

test.describe("location page snapshots", () => {
  // Build output (gitignored); CI's e2e job does not build, so generate it here as 30-find-pages does.
  test.beforeAll(() => {
    generateBusinessPages(REPO_ROOT);
  });

  test("snapshot: location page", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, `/find/${EXAMPLE_PUB.slug}/`);
    await waitForUiToSettle(page);
    await settleMapIconsAndDraw(page);
    await expect(page).toHaveScreenshot("location-page.png", { fullPage: false });
  });
});
