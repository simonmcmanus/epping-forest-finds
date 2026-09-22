// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

test.describe("Selection and Inspector", () => {
  test.describe("tree selected via URL hash", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    });

    test("inspector title changes to the selected tree name", async ({ page }) => {
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    });

    test("inspector type line shows veteran tree label", async ({ page }) => {
      await expect(page.locator("#inspectorType")).toContainText("Veteran tree");
    });

    test("inspector body shows tree register details", async ({ page }) => {
      // Tag number should appear somewhere in the detail panel
      await expect(page.locator("#inspectorBody")).toContainText(FIXTURE_TREE.tagNumber);
    });

    test("tag number is shown as a metal tag plate", async ({ page }) => {
      await expect(page.locator("#inspectorBody .tree-tag-plate")).toHaveText(FIXTURE_TREE.tagNumber);
    });

    test("URL hash reflects the selected tree", async ({ page }) => {
      await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`));
    });

    // Regression: loading a tree/place link used to leave the inspector minimized on
    // narrow (mobile) viewports -- a hidden `if (window.innerWidth <= 760)` branch in
    // applySelectionFromHash() that contradicted the spec's "always expanded after a
    // selection" rule and wasn't exercised by this describe block before. This spec file
    // runs on both the "desktop" and "mobile" (Pixel 5, 393px) Playwright projects, so this
    // one assertion covers both widths.
    test("inspector opens expanded, not minimized, when a location is loaded via a link", async ({ page }) => {
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
      await expect(page.locator("#inspector")).not.toHaveClass(/minimized/);
    });

    test("snapshot: tree detail view", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
      await page.waitForTimeout(600);
      // Stop all canvas animations so Playwright's stability check can pass.
      // toHaveScreenshot() requires pixel-identical consecutive RAW screenshots — the mask
      // only applies to the final baseline comparison, not the stability check.
      // Two sources of ongoing redraws after boot: (1) viewport animation (triggerMapRevealZoom
      // runs 700ms, overlay hides at 420ms, so 280ms spill into the test), (2) emoji-scale
      // exponential smoother (calls requestDraw until settled, ~28 more frames).
      await page.evaluate(() => {
        stopViewportAnimation();
        state.emojiScaleAnimated = zoomEmojiScaleTarget();
        draw();
      });
      await page.waitForTimeout(50);
      await expect(page).toHaveScreenshot("tree-detail.png", {
        fullPage: false,
        mask: [page.locator("#mapCanvas")],
      });
    });
  });

  test.describe("returning to overview", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    });

    test("back button returns inspector to overview mode", async ({ page }) => {
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
      await page.click("#nearbyToggle");
      // transitionInspectorBody() briefly creates two #inspectorTitle elements during the slide animation;
      // use waitForFunction with getElementById (returns first match) to avoid strict-mode violations
      await page.waitForFunction(
        () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby")
      );
    });

    test("URL hash is cleared when returning to overview", async ({ page }) => {
      await page.click("#nearbyToggle");
      // Hash should no longer contain a tree key
      await expect(page).not.toHaveURL(/tree=/);
    });
  });

  test.describe("tree search", () => {
    // The search screen itself is covered by 19-search.spec.js; this is the selection it
    // produces, alongside the other ways a tree gets selected.
    test.beforeEach(async ({ page }) => {
      await setup(page);
    });

    test("searching by tree number selects the correct tree", async ({ page }) => {
      await page.click("#searchToggle");
      await page.fill("#mapSearchInput", FIXTURE_TREE.tagNumber);
      await page.locator("#mapSearchResults .nearest-item").first().click();
      // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
      await page.waitForFunction(
        (name) => document.getElementById("inspectorTitle")?.textContent?.includes(name),
        FIXTURE_TREE.commonName
      );
    });
  });

  test.describe("inspector state when location is selected", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    });

    test("inspector tools section is hidden in selected-detail mode", async ({ page }) => {
      // .inspector-tools (count selector, locate button) are hidden when a detail view is shown;
      // the main action buttons (#filterToggle etc) remain accessible in .inspector-actions
      await expect(page.locator(".inspector-tools")).toBeHidden();
    });

    test("inspector back button is visible in selected-detail mode", async ({ page }) => {
      await expect(page.locator("#inspectorBack")).toBeVisible();
    });
  });
});
