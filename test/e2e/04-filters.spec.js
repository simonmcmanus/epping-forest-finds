// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, settleMapIconsAndDraw } = require("./helpers");

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

  test("URL hash becomes #filters when the filter screen opens", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/#filters$/);
  });

  test("filter screen stays open when the map canvas is tapped", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/#filters$/);
    // Tap the canvas — filter screen must not close
    await page.locator("#mapCanvas").click({ position: { x: 200, y: 200 } });
    await expect(page).toHaveURL(/#filters$/);
  });

  test("Nearby button closes the filter screen and returns to overview", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/#filters$/);
    await page.click("#nearbyToggle");
    // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby")
    );
    await expect(page).not.toHaveURL(/#filters$/);
  });

  test("filter button shows active count badge when filters are toggled on", async ({ page }) => {
    await page.click("#filterToggle");
    // Click a subfilter chip to activate it
    const firstChip = page.locator(".filter-chip").first();
    await firstChip.click();
    // The toggle (and its badge) is the way in from Nearby, so it hides while Filters itself
    // is open in favour of the ordinary back arrow -- the badge only has to be visible again
    // once back on Nearby.
    await page.click("#nearbyToggle");
    const badge = page.locator("#filterCount");
    await expect(badge).toBeVisible();
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
      await expect(page).toHaveURL(/#filters$/);
      await expect(page.locator("#filterNearestListSection")).toBeVisible();
    });
  });

  test.describe("adding a filter whose matches are all outside the radius", () => {
    test.use({
      geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 },
      permissions: ["geolocation"],
    });

    // The Nearby list already falls back to naming the closest match for a filter with nothing
    // inside the walking radius. The map has to agree: leaving the camera framed on the ring
    // meant adding, say, Underground stations from inside the forest changed the list and
    // changed nothing at all on the map, so the station the list had just named was nowhere
    // to be seen.
    test("the map zooms out far enough to show the nearest one", async ({ page }) => {
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
          zoomedOutScale: state.viewport.scale,
          onScreen: screen.x >= rect.x && screen.x <= rect.x + rect.width
            && screen.y >= rect.y && screen.y <= rect.y + rect.height,
        };
      });

      expect(framing, "the dataset should have at least one transport kind outside a 5 min walk").not.toBeNull();
      expect(framing.zoomedOutScale, "the camera reaches past the ring").toBeLessThan(framing.ringOnlyScale);
      expect(framing.onScreen, `the nearest ${framing?.candidate} is on the map`).toBe(true);
    });
  });

  test("snapshot: filter screen open", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
    await page.click("#filterToggle");
    await expect(page).toHaveURL(/#filters$/);
    await page.waitForTimeout(300);
    await settleMapIconsAndDraw(page);
    await expect(page).toHaveScreenshot("filter-screen.png", { fullPage: false });
  });
});
