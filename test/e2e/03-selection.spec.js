// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE, settleMapIconsAndDraw, waitForUiToSettle } = require("./helpers");

function largestInspectorFrameStep(samples) {
  return Math.max(0, ...samples.slice(1).map((sample, index) => Math.max(
    Math.abs(sample.top - samples[index].top),
    Math.abs(sample.bottom - samples[index].bottom),
  )));
}

test.describe("Selection and Inspector", () => {
  test.describe("tree selected via URL hash", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
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

    test("navigation drawer shrinks for the map and grows smoothly on arrival", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const inspector = page.locator("#inspector");
      await expect(inspector).toHaveClass(/inspector-navigation/);
      const navigatingHeight = await inspector.evaluate((el) => el.getBoundingClientRect().height);

      await page.evaluate(() => {
        const target = state.selected.item;
        state.userLocation = {
          latitude: target.latitude,
          longitude: target.longitude,
          accuracy: 10,
          point: projectLonLat(target.longitude, target.latitude),
        };
        updateInspectorNavigationHeight();
      });

      await expect(inspector).toHaveClass(/inspector-navigation-arrived/);
      await waitForUiToSettle(page);
      const arrivedHeight = await inspector.evaluate((el) => el.getBoundingClientRect().height);
      expect(arrivedHeight).toBeGreaterThan(navigatingHeight + 20);
    });

    test("snapshot: tree detail view", async ({ page }) => {
      await waitForUiToSettle(page);
      // Stop all canvas animations so Playwright's stability check can pass.
      // toHaveScreenshot() requires pixel-identical consecutive RAW screenshots.
      // Two sources of ongoing redraws after boot: (1) viewport animation (triggerMapRevealZoom
      // runs 700ms, overlay hides at 420ms, so 280ms spill into the test), (2) emoji-scale
      // exponential smoother (calls requestDraw until settled, ~28 more frames).
      // No mask: #mapCanvas fills the viewport, and a mask paints over its whole box, inspector
      // included, which left this baseline a solid magenta frame that could never show a change.
      await settleMapIconsAndDraw(page);
      await expect(page).toHaveScreenshot("tree-detail.png", { fullPage: false });
    });
  });

  test.describe("returning to overview", () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
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
      await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    });

    test("inspector tools section is hidden in selected-detail mode", async ({ page }) => {
      // .inspector-tools (count selector, locate button) are hidden when a detail view is shown;
      // the nav row (#searchToggle etc) remains accessible in .inspector-actions, while
      // #filterToggle -- inline with the Nearby heading, not part of that row -- hides too.
      await expect(page.locator(".inspector-tools")).toBeHidden();
    });

    test("inspector back button is visible in selected-detail mode", async ({ page }) => {
      await expect(page.locator("#inspectorBack")).toBeVisible();
    });
  });

  test.describe("coordinated state transitions", () => {
    // The default Playwright project uses reduced motion so ordinary assertions do not wait on
    // animation. This group opts into the real motion path because it is specifically checking
    // that Nearby -> destination -> Back moves as one continuous interaction.
    test.use({
      reducedMotion: "no-preference",
      geolocation: { latitude: 51.6650, longitude: 0.0450, accuracy: 10 },
      permissions: ["geolocation"],
    });

    test("Nearby selection and Back move the sheet continuously", async ({ page }) => {
      await setup(page);
      // Make the motion preference explicit after setup as well as in the project fixture: the
      // setup helper may have already created the page under its default reduced-motion context.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      // The standard setup deliberately removes its fallback location. Restore a deterministic
      // in-forest fix for this motion-only scenario, then use the same focus function the
      // delegated Nearby row click calls. That keeps the test about the transition, not about
      // which dataset item happens to be first in a no-location empty state.
      await page.evaluate(() => {
        const item = state.trees[0];
        state.userLocation = {
          latitude: item.latitude,
          longitude: item.longitude,
          accuracy: 10,
          point: projectLonLat(item.longitude, item.latitude),
          isDefault: false,
        };
        state.userInMapArea = true;
        selectOverview();
      });
      await expect(page.locator("#inspectorBody [data-overview-type][data-overview-key]").first()).toBeVisible();

      const selectingSamples = await page.evaluate(() => new Promise((resolve) => {
        const item = document.querySelector("#inspectorBody [data-overview-type][data-overview-key]");
        focusOverviewItem(item.dataset.overviewType, item.dataset.overviewKey);
        const samples = [];
        let frames = 0;
        const tick = () => {
          const inspector = document.getElementById("inspector");
          const rect = inspector.getBoundingClientRect();
          samples.push({ top: rect.top, bottom: rect.bottom });
          if (++frames === 24) return resolve(samples);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }));
      await page.waitForFunction(() => state.selected && document.getElementById("inspector").classList.contains("minimized"));
      expect(largestInspectorFrameStep(selectingSamples)).toBeLessThanOrEqual(80);

      const returningSamples = await page.evaluate(() => new Promise((resolve) => {
        document.getElementById("inspectorBack").click();
        const samples = [];
        let frames = 0;
        const tick = () => {
          const rect = document.getElementById("inspector").getBoundingClientRect();
          samples.push({ top: rect.top, bottom: rect.bottom });
          if (++frames === 24) return resolve(samples);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }));
      await page.waitForFunction(() => !state.selected && document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"));
      expect(largestInspectorFrameStep(returningSamples)).toBeLessThanOrEqual(80);
    });
  });
});
