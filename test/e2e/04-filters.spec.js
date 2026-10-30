// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, settleMapIconsAndDraw, waitForFrames, waitForUiToSettle } = require("./helpers");

test.describe("Filter panel", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("filter toggle opens the filter screen", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator("#filterToggle")).toHaveClass(/screen-active/);
  });

  test("Filters explains its purpose directly beneath the screen title", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator(".inspector-title-copy #inspectorType").last())
      .toHaveText("Choose what appears on the map");
  });

  test("the URL becomes /nearby/filter when the filter screen opens", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/\/nearby\/filter(\?|$)/);
  });

  test("filter screen stays open when the map canvas is tapped", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/\/nearby\/filter(\?|$)/);
    // Tap the canvas — filter screen must not close
    await page.locator("#mapCanvas").click({ position: { x: 200, y: 200 } });
    await expect(page).toHaveURL(/\/nearby\/filter(\?|$)/);
  });

  test("Nearby button closes the filter screen and returns to overview", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/\/nearby\/filter(\?|$)/);
    await page.click("#nearbyToggle");
    // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby")
    );
    await expect(page).not.toHaveURL(/\/nearby\/filter(\?|$)/);
  });

  test("filter button shows active count badge when filters are toggled on", async ({ page }) => {
    const badge = page.locator("#filterCount");
    const before = await badge.textContent();
    await page.click("#filterToggle");
    // Pubs is the only active food filter: turning it off drops the Food group from the count
    await page.locator('.filter-chip[data-filter-subfilter="pubs"]').click();
    // The toggle (and its badge) is the way in from Nearby, so it hides while Filters itself
    // is open in favour of the ordinary back arrow -- the badge only has to be visible again
    // once back on Nearby.
    await page.click("#nearbyToggle");
    await expect(badge).toBeVisible();
    await expect(badge).not.toHaveText(before);
  });

  test.describe("the nearest list updates live on the Filter screen", () => {
    test.use({
      geolocation: { latitude: 51.654, longitude: 0.0296, accuracy: 10 },
      permissions: ["geolocation"],
    });

    test("toggling a chip changes the results count and the list beneath it, without leaving the screen", async ({ page }) => {
      await setup(page);
      await page.click("#filterToggle");
      const countEl = page.locator("#filterResultsCount");
      await expect(countEl).toBeVisible();
      await expect(countEl).toHaveText(/Showing \d+ nearby/);

      const before = await countEl.textContent();

      // Trees is on by default (DEFAULT_FILTERS) -- turning it off removes every tree row and
      // the count the panel itself reports, proving the connection without backing out to Nearby.
      await page.locator('.filter-chip[data-filter-subfilter="trees"]').click();

      await expect(countEl).not.toHaveText(before);
      await expect(page).toHaveURL(/\/nearby\/filter(\?|$)/);
      await expect(page.locator("#filterNearestListSection")).toBeVisible();
    });

    // Regression: the Filter screen's own copy of the nearest list sits lower than Nearby's
    // (pushed down by the chip groups above it), so captureNearestItemPositions() -- meant only
    // to animate a live reorder while already on Nearby -- used to also fire on the way back
    // from Filters, reading the layout difference as a reorder and sliding every row into place
    // right on top of the screen-slide transition. That read as the list refreshing itself.
    // selectOverview(animate) now skips the capture entirely when animate is true (a
    // screen-entry transition), since the slide alone is the transition here.
    test("going back from Filters to Nearby does not replay a reorder animation on the list", async ({ page }) => {
      await setup(page);
      await page.click("#filterToggle");
      await expect(page.locator("#filterNearestListSection")).toBeVisible();

      await page.evaluate(() => {
        window.__sawReorderStyle = false;
        const body = document.getElementById("inspectorBody");
        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            const style = m.target.getAttribute && m.target.getAttribute("style");
            if (m.type === "attributes" && m.attributeName === "style" &&
              m.target.classList?.contains("nearest-item") &&
              style && (style.includes("transform") || style.includes("opacity"))) {
              window.__sawReorderStyle = true;
            }
          }
        });
        observer.observe(body, { attributes: true, subtree: true, attributeFilter: ["style"] });
      });

      await page.click("#inspectorBack");
      await page.waitForFunction(
        () => document.getElementById("inspectorTitle")?.textContent === "Nearby"
      );
      await waitForFrames(page, 24);

      expect(await page.evaluate(() => window.__sawReorderStyle)).toBe(false);
    });
  });

  test.describe("adding a filter whose matches are all outside the radius", () => {
    test.use({
      geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 },
      permissions: ["geolocation"],
    });

    // The Nearby list still falls back to naming the closest match for a filter with nothing
    // inside the walking radius, but the map remains a survey of that radius. A distant fallback
    // must not make checking a category zoom the camera out to a place that is not shown.
    test("the map stays focused on the walking radius", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      const framing = await page.evaluate(async () => {
        // The re-fit animates, so wait it out rather than freezing the camera partway: a
        // stopViewportAnimation() here measures wherever the ease had got to, not the framing
        // the user ends up looking at.
        const settle = async () => {
          for (let i = 0; i < 200; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            if (state.viewportAnimationTo == null) return;
          }
        };

        state.walkingDistanceMinutes = 5;
        setOverviewFilters(["trees"]);
        await settle();
        prepareCanvasForDraw();
        const ringOnlyScale = state.viewport.scale;

        // Pick a real filter whose nearest match is outside the ring, so this exercises the
        // app's own data rather than an injected fixture.
        const origin = nearbyOrigin();
        const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
        const candidate = ["underground", "national_rail", "bus"].find((key) => {
          const nearest = nearestOverviewEntryForFilter(key, origin.latitude, origin.longitude);
          return nearest && nearest.metres > radiusMetres;
        });
        if (!candidate) return null;

        setOverviewFilters(["trees", candidate]);
        await settle();
        prepareCanvasForDraw();

        const nearest = nearestOverviewEntryForFilter(candidate, origin.latitude, origin.longitude);
        const rect = bestVisibleCanvasRect();
        const screen = worldToScreen(nearest.item.point);
        return {
          candidate,
          ringOnlyScale,
          afterFilterScale: state.viewport.scale,
          onScreen: screen.x >= rect.x && screen.x <= rect.x + rect.width
            && screen.y >= rect.y && screen.y <= rect.y + rect.height,
        };
      });

      expect(framing, "the dataset should have at least one transport kind outside a 5 min walk").not.toBeNull();
      expect(framing.afterFilterScale, "checking a distant fallback must not zoom out the Nearby map")
        .toBeGreaterThanOrEqual(framing.ringOnlyScale * 0.999);
    });
  });

  test("snapshot: filter screen open", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/\/nearby\/filter(\?|$)/);
    await waitForUiToSettle(page);
    await settleMapIconsAndDraw(page);
    await expect(page).toHaveScreenshot("filter-screen.png", { fullPage: false });
  });
});
