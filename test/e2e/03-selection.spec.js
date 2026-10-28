// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE, settleMapIconsAndDraw, waitForUiToSettle, tapCanvasPoint, waitForFrames } = require("./helpers");

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

    test("tree facts stay readable while taxonomy and technical data sit at the bottom", async ({ page }) => {
      const technical = page.locator("#inspectorBody details.technical-details");
      await expect(technical.locator("dt", { hasText: "Latin name" })).toHaveCount(1);
      await expect(technical).not.toHaveAttribute("open", "");
      await expect(page.locator("#inspectorBody .tree-detail > :last-child")).toHaveClass("technical-details");
      await expect(page.locator(".tree-facts")).toContainText("Tag number");
      await technical.locator("summary").click();
      await expect(technical.locator("dt", { hasText: "Latin name" })).toBeVisible();
    });

    test("tree fact icons follow species, status and form values", async ({ page }, testInfo) => {
      const show = async (values) => {
        await page.evaluate((values) => showTreeDetails({ ...state.selected.item, ...values }, null, "Tree record"), values);
      };
      await show({ commonName: "English Oak", latinName: "Quercus robur", status: "Alive", treeForm: "Veteran Pollard", girthMetres: 4, comments: "Recorded as a veteran tree." });
      await expect(page.locator("#inspectorTitleEmoji img")).toHaveAttribute("src", "data/icons/trees/oak.png");
      await expect(page.locator("#inspectorBody .tree-status .tree-field-icon")).toHaveClass(/--alive/);
      await expect(page.locator("#inspectorBody .tree-facts .tree-field-icon--pollard")).toBeVisible();
      await testInfo.attach("living-tree-icons", { body: await page.locator("#inspectorBody .tree-facts").screenshot({ animations: "disabled" }), contentType: "image/png" });
      await show({ commonName: "Ash", latinName: "Fraxinus excelsior", status: "dead", treeForm: "Veteran Pollard" });
      await expect(page.locator("#inspectorTitleEmoji img")).toHaveAttribute("src", "data/icons/trees/ash.png");
      await expect(page.locator("#inspectorBody .tree-status .tree-field-icon")).toHaveClass(/--dead/);
      await expect(page.locator("#inspectorBody .tree-facts .tree-field-icon--alive")).toHaveCount(0);
      await testInfo.attach("dead-tree-icons", { body: await page.locator("#inspectorBody .tree-facts").screenshot({ animations: "disabled" }), contentType: "image/png" });
      await show({ status: "Alive", treeForm: "Veteran_ Multistem_pollard" });
      await expect(page.locator("#inspectorBody .tree-facts .tree-field-icon--multistem")).toBeVisible();
      await show({ status: null, treeForm: null, commonName: "Unknown species", latinName: null });
      await expect(page.locator("#inspectorBody .tree-status")).toHaveCount(0);
      await expect(page.locator("#inspectorTitleEmoji img")).toHaveAttribute("src", "data/icons/tree.png");
    });

    test("tree identity and facts come before the community check", async ({ page }) => {
      const facts = page.locator("#inspectorBody .tree-facts");
      const check = page.locator("#inspectorBody .community-check");
      await expect(facts).toBeVisible();
      await expect(check).toHaveCount(1);
      const order = await page.evaluate(() => {
        const facts = document.querySelector("#inspectorBody .tree-facts");
        const check = document.querySelector("#inspectorBody .community-check");
        return Boolean(facts.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(order).toBe(true);
      await expect(facts.locator("dt", { hasText: "Common name" })).toHaveCount(0);
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    });

    test("tree sections keep text clear of decorative icons and align the walking controls", async ({ page }) => {
      await page.evaluate(() => showTreeDetails({ ...state.selected.item, girthMetres: 4, comments: "A veteran tree with a broad crown and a hollowing trunk." }, 420, "Tree record"));
      const controls = page.locator("#inspectorBody .walk-chip, #inspectorBody .detail-map-link--icon");
      await expect(controls).toHaveCount(3);
      const heights = await controls.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
      heights.forEach((height) => expect(height).toBeCloseTo(44, 0));
      const icons = page.locator("#inspectorBody .tree-measurements .tree-field-icon, #inspectorBody .tree-form .tree-field-icon, #inspectorBody .tree-comments .tree-field-icon");
      await expect(icons).toHaveCount(4);
      const placement = await icons.evaluateAll((items) => items.map((icon) => {
        const row = icon.closest(".row");
        const image = icon.getBoundingClientRect();
        const field = row.getBoundingClientRect();
        const label = row.querySelector("dt > span:not(.tree-field-icon)").getBoundingClientRect();
        return { opacity: getComputedStyle(icon).opacity, width: image.width, rightGap: field.right - image.right, labelLeft: label.left, iconLeft: image.left };
      }));
      for (const icon of placement) {
        expect(icon.opacity).toBe("0.5");
        expect(icon.width).toBe(56);
        expect(icon.rightGap).toBeGreaterThanOrEqual(5);
        expect(icon.rightGap).toBeLessThanOrEqual(10);
        expect(icon.labelLeft).toBeLessThan(icon.iconLeft);
      }
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

    test("expanded inspector keeps the same height across navigation and screen changes", async ({ page }) => {
      const panelHeight = () => page.evaluate(() => document.getElementById("inspector").getBoundingClientRect().height);
      const expectedHeight = await panelHeight();
      const panelGeometry = await page.evaluate(() => {
        const panel = document.getElementById("inspector").getBoundingClientRect();
        return { width: innerWidth, viewportHeight: innerHeight, top: panel.top, bottom: panel.bottom };
      });
      if (panelGeometry.width <= 760) {
        expect(panelGeometry.bottom - panelGeometry.top).toBeCloseTo(panelGeometry.viewportHeight * 0.5, 0);
      } else {
        expect(panelGeometry.bottom).toBeCloseTo(panelGeometry.viewportHeight - 14, 0);
      }
      const expectFixedHeight = async () => {
        const height = await panelHeight();
        expect(Math.abs(height - expectedHeight)).toBeLessThan(1);
      };

      await page.evaluate(() => {
        const target = state.selected.item;
        state.userLocation = {
          latitude: target.latitude,
          longitude: target.longitude,
          accuracy: 10,
          point: projectLonLat(target.longitude, target.latitude),
        };
      });

      await waitForUiToSettle(page);
      await expectFixedHeight();

      await page.click("#settingsToggle");
      await expect(page.locator("#settingsWalkMins")).toBeVisible();
      await expectFixedHeight();

      await page.click("#reportToggle");
      await expect(page.locator(".community-intro")).toBeVisible();
      await expectFixedHeight();

      await page.click("#searchToggle");
      await expect(page.locator("#mapSearchInput")).toBeVisible();
      await expectFixedHeight();

      await page.click("#nearbyToggle");
      await expect(page.locator("#filterToggle")).toBeVisible();
      await page.click("#filterToggle");
      await expect(page.locator("#inspectorTitle")).toHaveText("Filters");
      await expectFixedHeight();
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

  test.describe("taps beside the panel", () => {
    // A position in the forest, so the Nearby list has something to show around the user.
    test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

    // What a tap changed: the Nearby browse spot, the selection, or the URL. Open ground moves the
    // first; a pin or street sets the second; both rewrite the third.
    const mapTapOutcome = (page) => page.evaluate(() => JSON.stringify({
      anchor: state.nearbyAnchor,
      selected: state.selected?.type ?? null,
      url: location.pathname + location.search + location.hash,
    }));

    test("a finger landing on the strip of map just beside the panel does nothing", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
      await waitForUiToSettle(page);
      const box = await page.locator("#inspector").boundingBox();
      expect(box, "the inspector panel is on screen").not.toBeNull();
      const before = await mapTapOutcome(page);

      // 6 px off the panel's left edge: map shows there, but the finger was aiming for the panel.
      await tapCanvasPoint(page, { clientX: box.x - 6, clientY: box.y + box.height / 2 }, { alreadyClient: true });
      await waitForFrames(page, 3);
      expect(await mapTapOutcome(page), "a tap just beside the panel leaves the map as it was").toBe(before);

      // The same finger well clear of the panel still reaches the map: above the phone's bottom
      // sheet, or left of the desktop side panel.
      const clear = box.y > 200
        ? { clientX: box.x + box.width / 2, clientY: box.y - 80 }
        : { clientX: box.x / 2, clientY: box.y + box.height / 2 };
      await tapCanvasPoint(page, clear, { alreadyClient: true });
      await expect.poll(() => mapTapOutcome(page), "a tap clear of the panel still acts on the map").not.toBe(before);
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
});
