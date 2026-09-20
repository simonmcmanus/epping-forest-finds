// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap, FIXTURE_TREE } = require("./helpers");

test.describe("URL navigation", () => {
  test.describe("a URL opens the screen it names", () => {
    test("navigating to /#filters opens the filter screen on load", async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page, "/app#filters");
      await expect(page).toHaveURL(/#filters$/);
      await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);
    });

    test("navigating to /#settings opens the settings screen on load", async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page, "/app#settings");
      await expect(page).toHaveURL(/#settings$/);
      await expect(page.locator("#settingsToggle")).toHaveClass(/screen-active/);
      await expect(page.locator("#settingsWalkMins")).toBeVisible();
    });

    test("navigating to /#report opens the report screen on load", async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page, "/app#report");
      await expect(page).toHaveURL(/#report$/);
      await expect(page.locator("#reportToggle")).toHaveClass(/screen-active/);
      await expect(page.locator("#reportDetails")).toBeVisible();
    });
  });

  test.describe("hash #tree=<key>", () => {
    // #treeSearchToggle is hidden at desktop widths (display:none at ≥761px).
    // Use mobile viewport so tree search is accessible for the history test.
    test.use({ viewport: { width: 390, height: 844 } });

    test("navigating with a tree hash selects that tree", async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    });

    test("a link shared before the tree key changed still opens the tree it named", async ({ page }) => {
      // The old key was the tag number. Those links are out in the world, so findTreeByHashKey
      // still accepts them -- and must not resolve them to the unrelated record that happens
      // to share the number.
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page, `/app#tree=${FIXTURE_TREE.legacyHashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    });

    test("selecting a tree puts it in the URL and leaves a history entry behind it", async ({ page }) => {
      await setup(page);
      const historyBefore = await page.evaluate(() => window.history.length);

      // Select tree via search.
      // #inspectorBody overlaps .bottom-search on mobile; dispatch click via JS to bypass hitTest.
      await page.evaluate(() =>
        document.getElementById("treeSearchToggle").dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        )
      );
      // After toggle, #treeSearchInput and #treeSearchButton are in inspector-tools (not covered)
      await page.fill("#treeSearchInput", FIXTURE_TREE.tagNumber);
      await page.click("#treeSearchButton");
      await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`));

      // The screen change is a navigation, so back has somewhere to go.
      const historyAfter = await page.evaluate(() => window.history.length);
      expect(historyAfter).toBe(historyBefore + 1);

      await page.goBack();
      await page.waitForFunction(
        () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby")
      );
      await expect(page).toHaveURL(/\/app$/);
    });
  });

  test.describe("back retraces the trail", () => {
    test("Nearby → Filters → Settings comes back out a screen at a time", async ({ page }) => {
      await setup(page);

      await page.click("#filterToggle");
      await expect(page).toHaveURL(/#filters$/);

      await page.click("#settingsToggle");
      await expect(page).toHaveURL(/#settings$/);

      await page.goBack();
      await expect(page).toHaveURL(/#filters$/);
      await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);

      await page.goBack();
      await expect(page).toHaveURL(/\/app$/);
      await expect(page.locator("#nearbyToggle")).toHaveClass(/screen-active/);
    });

    test("forward replays it", async ({ page }) => {
      await setup(page);
      await page.click("#filterToggle");
      await expect(page).toHaveURL(/#filters$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/app$/);

      await page.goForward();
      await expect(page).toHaveURL(/#filters$/);
      await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);
    });

    test("the inspector back arrow steps back through the trail, not straight to Nearby", async ({ page }) => {
      await setup(page);
      await page.click("#filterToggle");
      await page.click("#settingsToggle");
      await expect(page.locator("#inspectorBack")).toBeVisible();

      await page.click("#inspectorBack");
      await expect(page).toHaveURL(/#filters$/);
      await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);
    });

    test("the inspector back arrow returns to Nearby when the app was opened straight onto a screen", async ({ page }) => {
      // Nothing of this app's own sits behind a link opened in a fresh tab, so the arrow must
      // not hand the user back to whatever they were browsing before.
      await setup(page, "/app#settings");
      await page.click("#inspectorBack");
      await expect(page).toHaveURL(/\/app$/);
      await expect(page.locator("#nearbyToggle")).toHaveClass(/screen-active/);
    });
  });

  test.describe("a hash edited by hand still drives the app", () => {
    test("clearing the hash returns to Nearby", async ({ page }) => {
      await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
      await page.evaluate(() => { window.location.hash = ""; });
      // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
      await page.waitForFunction(
        () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby")
      );
    });

    test("clearing the hash closes the filter screen, because the URL is what says which screen is open", async ({ page }) => {
      await setup(page);
      await page.click("#filterToggle");
      await expect(page).toHaveURL(/#filters$/);
      await page.evaluate(() => { window.location.hash = ""; });
      await expect(page.locator("#nearbyToggle")).toHaveClass(/screen-active/);
      await expect(page.locator("#filterToggle")).not.toHaveClass(/screen-active/);
    });
  });
});
