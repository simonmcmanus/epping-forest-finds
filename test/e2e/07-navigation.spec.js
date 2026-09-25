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
    test("a skip link jumps from the canvas straight to the Nearby panel", async ({ page }) => {
      // setup() force-hides the location gate JS-side (see helpers.js), which does not itself
      // move focus, so activating the skip link directly (rather than fighting real browser Tab
      // order against a gate that already claimed focus on open) is what actually exercises the
      // feature: that it exists, is reachable, and its target receives focus.
      await setup(page);
      const skipLink = page.locator(".skip-link");
      await expect(skipLink).toHaveAttribute("href", "#inspector");
      await skipLink.focus();
      await expect(skipLink).toBeFocused();

      await page.keyboard.press("Enter");
      await expect(page.locator("#inspector")).toBeFocused();
    });

    test("Nearby, Filters, Search, Report and Settings are always reachable by Tab", async ({ page }) => {
      // The nav row (#nearbyToggle/#filterToggle/#searchToggle/#reportToggle/#settingsToggle)
      // sits at the top of #inspector, before any per-screen content, so it is the first thing
      // Tab reaches after the skip link on every screen -- Nearby, a selected tree/place/cow, and
      // the Search/Filter/Settings/Report screens all render their own content below it rather
      // than replacing it.
      await setup(page);
      await page.locator("body").evaluate((el) => el.focus());
      const order = ["nearbyToggle", "filterToggle", "searchToggle", "reportToggle", "settingsToggle"];
      for (const id of order) {
        await page.keyboard.press("Tab");
        await expect(page.locator(`#${id}`)).toBeFocused();
      }
    });

    test("the nav row stays reachable with a place selected", async ({ page }) => {
      await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
      await page.locator("body").evaluate((el) => el.focus());
      const order = ["nearbyToggle", "filterToggle", "searchToggle", "reportToggle", "settingsToggle", "inspectorBack"];
      for (const id of order) {
        await page.keyboard.press("Tab");
        await expect(page.locator(`#${id}`)).toBeFocused();
      }
    });

    test.describe("with location already granted", () => {
      // Geolocation must be granted here: otherwise boot() shows the location gate, which
      // correctly (and intentionally) traps focus onto itself -- see the "Modal dialogs" section
      // of spec-data-rendering.md. This test is about the path where no modal opens at all.
      test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

      test("a keyboard user can reach the nav without clicking first", async ({ page }) => {
        // A full page load doesn't reliably hand keyboard focus to the document (it can sit in
        // the browser chrome instead), so without boot() explicitly focusing the skip link, the
        // first Tab a keyboard-only visitor presses can go nowhere obvious -- indistinguishable
        // from the nav simply not being keyboard-operable. No setup()/body.focus() here: this
        // exercises the real boot path, with no modal open to claim focus instead.
        await skipOnboarding(page);
        await mockCowApi(page);
        await gotoAndWaitForMap(page);
        await expect(page.locator(".skip-link")).toBeFocused();

        await page.keyboard.press("Tab");
        await expect(page.locator("#nearbyToggle")).toBeFocused();
      });
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
