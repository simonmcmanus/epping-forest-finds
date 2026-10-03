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

      // Select the tree from the search screen. Search is a screen in its own right, so the
      // trail is Nearby → Search → tree and back retraces it one screen at a time.
      await page.click("#searchToggle");
      await expect(page).toHaveURL(/#search$/);
      await page.fill("#mapSearchInput", FIXTURE_TREE.tagNumber);
      await page.locator("#mapSearchResults .nearest-item").first().click();
      await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`));

      // Each screen change is a navigation, so back has somewhere to go.
      const historyAfter = await page.evaluate(() => window.history.length);
      expect(historyAfter).toBe(historyBefore + 2);

      await page.goBack();
      await expect(page).toHaveURL(/#search$/);

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

  test.describe("keyboard accessibility", () => {
    test("Nearby, Search, Feedback, Settings and Filters are always reachable by Tab", async ({ page }) => {
      // The nav row (#nearbyToggle/#searchToggle/#reportToggle/#settingsToggle) sits at the top
      // of #inspector, before any per-screen content, so it is the first thing Tab reaches after
      // the skip link on every screen. #filterToggle is not part of that row -- it sits inline
      // with the Nearby heading (see spec-data-rendering.md, "Filters is reached from Nearby, not
      // a nav peer") -- but #locateButton (".inspector-tools", also always ahead of per-screen
      // content) comes first: with no GPS fix yet (geolocation is denied by default -- see
      // "Geolocation is always answered" in spec/agents.md) it is shown and enabled, offering a
      // manual retry, so it reaches it before filterToggle does.
      await setup(page);
      await page.locator("body").evaluate((el) => el.focus());
      const order = ["nearbyToggle", "searchToggle", "reportToggle", "settingsToggle", "locateButton", "filterToggle"];
      for (const id of order) {
        await page.keyboard.press("Tab");
        await expect(page.locator(`#${id}`)).toBeFocused();
      }
    });

    test("the nav row stays reachable with a place selected, and the filter toggle drops out of the order", async ({ page }) => {
      // #filterToggle only ever changes what Nearby/Filters show, so it is hidden -- and so
      // skipped by Tab -- whenever a place is selected.
      await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
      await page.locator("body").evaluate((el) => el.focus());
      const order = ["nearbyToggle", "searchToggle", "reportToggle", "settingsToggle", "inspectorBack"];
      for (const id of order) {
        await page.keyboard.press("Tab");
        await expect(page.locator(`#${id}`)).toBeFocused();
      }
    });

    test("the focus ring is solid, not the low-contrast translucent one", async ({ page }) => {
      await setup(page);
      await page.locator("#nearbyToggle").focus();
      const outline = await page.locator("#nearbyToggle").evaluate((el) => getComputedStyle(el).outlineColor);
      // The old rgba(60, 99, 130, 0.35)/0.6 rings blended down to under the 3:1 contrast WCAG
      // 2.4.11 requires against the app's light backgrounds -- a keyboard user's focus was
      // moving, but nothing on screen showed it. Solid var(--nav) renders as opaque rgb(44, 79, 133).
      expect(outline).toBe("rgb(44, 79, 133)");
    });
  });
});
