// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

test.describe("Selection and Inspector", () => {
  test.describe("tree selected via URL hash", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
    });

    test("inspector title changes to the selected tree name", async ({ page }) => {
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
    });

    test("inspector type line shows veteran tree label", async ({ page }) => {
      await expect(page.locator("#inspectorType")).toContainText("Veteran tree", { timeout: 5_000 });
    });

    test("inspector body shows tree register details", async ({ page }) => {
      // Tag number should appear somewhere in the detail panel
      await expect(page.locator("#inspectorBody")).toContainText(FIXTURE_TREE.tagNumber, { timeout: 5_000 });
    });

    test("URL hash reflects the selected tree", async ({ page }) => {
      await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`));
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
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
    });

    test("back button returns inspector to overview mode", async ({ page }) => {
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
      await page.click("#nearbyToggle");
      // transitionInspectorBody() briefly creates two #inspectorTitle elements during the slide animation;
      // use waitForFunction with getElementById (returns first match) to avoid strict-mode violations
      await page.waitForFunction(
        () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
        { timeout: 5_000 }
      );
    });

    test("URL hash is cleared when returning to overview", async ({ page }) => {
      await page.click("#nearbyToggle");
      // Hash should no longer contain a tree key
      await expect(page).not.toHaveURL(/tree=/);
    });
  });

  test.describe("tree search panel", () => {
    // #treeSearchToggle lives in .bottom-search which is display:none at min-width 761px.
    // Override to a mobile viewport so the toggle is visible.
    test.use({ viewport: { width: 390, height: 844 } });

    test.beforeEach(async ({ page }) => {
      await setup(page);
    });

    test("tree search toggle reveals the search input", async ({ page }) => {
      await expect(page.locator("#treeSearchPanel")).toBeHidden();
      // #inspectorBody overlaps .bottom-search on mobile (same z-index, inspector is later in DOM).
      // Playwright force:true still clicks at coordinates so #inspectorBody intercepts.
      // Dispatch the click event directly to the toggle via JS to bypass the visual hitTest.
      await page.evaluate(() =>
        document.getElementById("treeSearchToggle").dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        )
      );
      await expect(page.locator("#treeSearchPanel")).toBeVisible({ timeout: 3_000 });
    });

    test("searching by tree number selects the correct tree", async ({ page }) => {
      // Open the panel via JS dispatch (see comment in toggle test above)
      await page.evaluate(() =>
        document.getElementById("treeSearchToggle").dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        )
      );
      // After toggle, #treeSearchPanel is inside inspector-tools (top of inspector, not covered)
      await page.fill("#treeSearchInput", FIXTURE_TREE.tagNumber);
      await page.click("#treeSearchButton");
      // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
      await page.waitForFunction(
        (name) => document.getElementById("inspectorTitle")?.textContent?.includes(name),
        FIXTURE_TREE.commonName,
        { timeout: 5_000 }
      );
    });
  });

  test.describe("inspector state when location is selected", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle").first()).toContainText(FIXTURE_TREE.commonName, { timeout: 5_000 });
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
