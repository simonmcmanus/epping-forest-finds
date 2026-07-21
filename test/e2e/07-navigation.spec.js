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
    // #treeSearchToggle is hidden at desktop widths (display:none at ≥761px).
    // Use mobile viewport so tree search is accessible for the replaceState history test.
    test.use({ viewport: { width: 390, height: 844 } });

    test("navigating with a tree hash selects that tree", async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page, `/#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
    });

    test("selecting a tree sets the URL hash via replaceState", async ({ page }) => {
      await setup(page);
      // Capture history before any tree selection
      const historyBefore = await page.evaluate(() => window.history.length);

      // Select tree via search — internally calls setHashFromSelection → replaceState.
      // #inspectorBody overlaps .bottom-search on mobile; dispatch click via JS to bypass hitTest.
      await page.evaluate(() =>
        document.getElementById("treeSearchToggle").dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        )
      );
      // After toggle, #treeSearchInput and #treeSearchButton are in inspector-tools (not covered)
      await page.fill("#treeSearchInput", FIXTURE_TREE.tagNumber);
      await page.click("#treeSearchButton");
      await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`), { timeout: 5_000 });

      // replaceState must not add a history entry (pressing back should exit the app)
      const historyAfter = await page.evaluate(() => window.history.length);
      expect(historyAfter).toBe(historyBefore);
    });
  });

  test.describe("empty hash", () => {
    test("an empty hashchange triggers goToInitialView when filter screen is not open", async ({ page }) => {
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
      // Manually clear hash to trigger hashchange
      await page.evaluate(() => history.replaceState(null, "", "/"));
      await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
      // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
      await page.waitForFunction(
        () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
        { timeout: 5_000 }
      );
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
