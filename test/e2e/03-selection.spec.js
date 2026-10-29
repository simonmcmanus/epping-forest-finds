// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE, settleMapIconsAndDraw, waitForUiToSettle, tapCanvasPoint, waitForFrames } = require("./helpers");
const fs = require("fs");
const path = require("path");

// The fixture tree's real position, read from the shipped dataset rather than copied here.
const FIXTURE_TREE_LOCATION = (() => {
  const dir = path.join(__dirname, "..", "..", "data", "trees");
  for (const file of fs.readdirSync(dir).filter((f) => f.startsWith("chunk-"))) {
    const tree = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).trees
      .find((t) => String(t.recordNumber) === FIXTURE_TREE.recordNumber);
    if (tree) return { latitude: tree.location.wgs84.latitude, longitude: tree.location.wgs84.longitude };
  }
  throw new Error(`fixture tree ${FIXTURE_TREE.recordNumber} is not in data/trees`);
})();

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

    test("tree details show species artwork, a status icon and form beneath the title", async ({ page }) => {
      for (const status of ["Alive", "Dead"]) {
        await page.evaluate((status) => showTreeDetails({ ...state.selected.item, status, treeForm: "Veteran Pollard", girthMetres: 4, comments: "Recorded as a veteran tree." }, 420, "Tree record"), status);
        await waitForUiToSettle(page);
        await expect(page.locator("#inspectorTitleEmoji")).toBeVisible();
        await expect(page.locator("#inspectorTitleEmoji img:visible, #inspectorTitleEmoji canvas:visible")).toHaveCount(1);
        await expect(page.locator("#inspectorTitleEmoji img")).toHaveAttribute("src", /trees\/oak\.png$/);
        await expect(page.locator("#inspectorBody .tree-status dd")).toHaveText(status);
        await expect(page.locator("#inspectorType")).toHaveText("Veteran tree · Pollard form");
        const icon = page.locator("#inspectorBody .tree-status img");
        await expect(icon).toBeVisible();
        await expect(icon).toHaveAttribute("src", status === "Alive" ? /icons\/tree\.png$/ : /icons\/tree-dead\.png$/);
        const textBox = await page.locator("#inspectorBody .tree-status dd span").boundingBox();
        const iconBox = await icon.boundingBox();
        expect(iconBox.x).toBeGreaterThanOrEqual(textBox.x + textBox.width);
        expect(await icon.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
      }
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
      await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    });

    test("walking, map and share controls stay aligned", async ({ page }) => {
      await page.evaluate(() => showTreeDetails({ ...state.selected.item, girthMetres: 4, comments: "A veteran tree with a broad crown and a hollowing trunk." }, 420, "Tree record"));
      const controls = page.locator("#inspectorBody .walk-chip, #inspectorBody .detail-map-link--icon");
      await expect(controls).toHaveCount(3);
      const heights = await controls.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
      heights.slice(1).forEach((height) => expect(height).toBeCloseTo(heights[0], 0));
    });

    test("missing tree tags have a clear fallback and single measurements stay compact", async ({ page }) => {
      const show = async (tagNumber) => page.evaluate((tagNumber) => showTreeDetails({ ...state.selected.item, tagNumber, nationalDatabaseTagNumber: null, girthMetres: 0 }, 420, "Tree record"), tagNumber);
      for (const tag of [null, "0", ""]) {
        await show(tag);
        await expect(page.locator("#inspectorBody .tree-tag dd")).toHaveText("No tag recorded");
      }
      await show("11383");
      await expect(page.locator("#inspectorBody .tree-tag dd")).toHaveText("11383");
      const measurement = page.locator("#inspectorBody .tree-measurements .row");
      await expect(measurement).toHaveCount(1);
      const card = await measurement.boundingBox();
      const label = await measurement.locator("dt").boundingBox();
      const value = await measurement.locator("dd").boundingBox();
      // A single value has balanced insets, rather than blank space below a fixed-height card.
      expect(card.y + card.height - value.y - value.height).toBeCloseTo(label.y - card.y, 0);
      const pill = page.locator("#inspectorBody .walk-chip");
      expect((await pill.boundingBox()).height).toBeCloseTo((await page.locator("#inspectorBody .detail-map-link--icon").first().boundingBox()).height, 0);
      const tagFont = await page.locator("#inspectorBody .tree-tag dd").evaluate(item => parseFloat(getComputedStyle(item).fontSize));
      const labelFont = await measurement.locator("dt").evaluate(item => parseFloat(getComputedStyle(item).fontSize));
      expect(tagFont).toBeGreaterThan(labelFont);
    });

    test("estimated start year stays inline when it fits and wraps on a narrow screen", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => showTreeDetails({ ...state.selected.item, girthMetres: 4 }, null, "Tree record"));
      const age = page.locator("#inspectorBody .tree-age-value");
      const year = page.locator("#inspectorBody .tree-measurements small");
      await expect(age).toBeVisible();
      const wideAge = await age.boundingBox();
      const wideYear = await year.boundingBox();
      expect(wideYear.x).toBeGreaterThanOrEqual(wideAge.x + wideAge.width);
      await page.setViewportSize({ width: 320, height: 720 });
      const narrowAge = await age.boundingBox();
      const narrowYear = await year.boundingBox();
      expect(narrowYear.y).toBeGreaterThanOrEqual(narrowAge.y + narrowAge.height - 2);
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

    test("a linked location's first fit stays above the open mobile panel", async ({ page }) => {
      const mobileSheet = await page.evaluate(() => window.innerWidth <= 760
        || window.matchMedia("(orientation: landscape) and (pointer: coarse) and (max-height: 500px)").matches);
      test.skip(!mobileSheet, "the side-panel first fit is not covered by this mobile regression");

      await page.evaluate((key) => {
        state.userLocation = null;
        applyRoute(`tree=${key}`);
      }, FIXTURE_TREE.hashKey);
      await waitForUiToSettle(page);

      const geometry = await page.evaluate(() => {
        const stage = (els.mapStage || els.canvas).getBoundingClientRect();
        const point = worldToScreen(state.selected.item.point);
        const dpr = pixelRatio();
        const pointClientY = stage.top + (point.y - state.canvasInsetY) / dpr;
        const panel = els.inspector.getBoundingClientRect();
        return { pointClientY, panelTop: panel.top };
      });
      expect(geometry.pointClientY).toBeLessThan(geometry.panelTop - 4);

      const handle = await page.locator("#inspectorDragHandle").boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y - 120, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => page.evaluate(() => {
        const stage = (els.mapStage || els.canvas).getBoundingClientRect();
        const point = worldToScreen(state.selected.item.point);
        const dpr = pixelRatio();
        const pointClientY = stage.top + (point.y - state.canvasInsetY) / dpr;
        return pointClientY < els.inspector.getBoundingClientRect().top - 4;
      })).toBe(true);
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

  // Standing at the selected tree, delivered as a real GPS fix. Writing state.userLocation by
  // hand skipped the camera re-fit a fix triggers, leaving the whole dataset framed: every road
  // and path stroked on each of the many draws this journey makes, a second or more apiece on
  // a phone-sized canvas, which ran the test into its timeout on a 2-core CI runner.
  test.describe("standing at a tree selected via URL hash", () => {
    test.use({ geolocation: { ...FIXTURE_TREE_LOCATION, accuracy: 5 }, permissions: ["geolocation"] });

    test.beforeEach(async ({ page }) => {
      await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
      await page.waitForFunction(() => state.selected && state.selected.type === "tree" && Boolean(state.userLocation) && !state.userLocation.isDefault);
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
