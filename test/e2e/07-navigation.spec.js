// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap, FIXTURE_TREE } = require("./helpers");

test.describe("URL hash navigation", () => {
  test.describe("hash #filters", () => {
    test("navigating to /#filters opens the filter screen on load", async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page, "/#filters");
      await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
      await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);
    });
  });

  test.describe("hash #tree=<key>", () => {
    test("navigating with a tree hash selects that tree", async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page, `/#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
    });

    test("selecting a tree sets the URL hash via replaceState", async ({ page }) => {
      await setup(page);
      // Select via search so we can verify a replaceState (no new history entry)
      await page.click("#treeSearchToggle");
      await page.fill("#treeSearchInput", FIXTURE_TREE.tagNumber);
      await page.click("#treeSearchButton");
      await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`), { timeout: 5_000 });

      // replaceState means pressing back exits the app rather than deselecting the tree
      const historyLength = await page.evaluate(() => window.history.length);
      // After a replaceState, history.length should be the same as after the initial navigation (1)
      expect(historyLength).toBe(1);
    });
  });

  test.describe("empty hash", () => {
    test("an empty hashchange triggers goToInitialView when filter screen is not open", async ({ page }) => {
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
      // Manually clear hash to trigger hashchange
      await page.evaluate(() => history.replaceState(null, "", "/"));
      await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
      await expect(page.locator("#inspectorTitle")).toContainText("Nearby", { timeout: 3_000 });
    });

    test("an empty hashchange does not close the filter screen", async ({ page }) => {
      await setup(page);
      await page.click("#filterToggle");
      await expect(page).toHaveURL(/#filters$/, { timeout: 3_000 });
      // Clear hash while filter screen is open — it must stay open
      await page.evaluate(() => history.replaceState(null, "", "/"));
      await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
      // Filter screen should remain active
      await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);
    });
  });
});
