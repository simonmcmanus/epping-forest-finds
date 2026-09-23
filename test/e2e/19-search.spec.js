// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

// A real pub and a real street from the shipped datasets. "Forest Road" arrives from
// OpenStreetMap as 164 separate ways, which is exactly the case the results list has to
// collapse into one row.
const FIXTURE_PLACE = "Railway Bell";
const FIXTURE_ROAD = "Forest Road";
const FOREST_LOCATION = { latitude: 51.665, longitude: 0.045, accuracy: 10 };

test.describe("Searching the map", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("the search icon in the main navigation opens the search screen", async ({ page }) => {
    await expect(page.locator("#searchToggle")).toBeVisible();

    await page.click("#searchToggle");

    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Search")
    );
    await expect(page.locator("#mapSearchInput")).toBeVisible();
    await expect(page.locator("#searchToggle")).toHaveClass(/screen-active/);
    await expect(page).toHaveURL(/#search$/);
  });

  test("results are listed the way the nearby view lists places", async ({ page }) => {
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", FIXTURE_PLACE);

    const result = page.locator("#mapSearchResults .nearest-item").first();
    await expect(result).toContainText(FIXTURE_PLACE);
    await expect(result).toContainText("Pubs");
  });

  test("arrow keys step from the search field into the results, and Enter opens the focused row", async ({ page }) => {
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", "oak");

    const rows = page.locator("#mapSearchResults .nearest-item");
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    test.skip(rowCount < 3, "not enough oak results in the fixture data to step through");

    const input = page.locator("#mapSearchInput");
    await input.focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(2)).toBeFocused();

    await page.keyboard.press("ArrowUp");
    await expect(rows.nth(1)).toBeFocused();
    // ArrowUp from the first row goes back up into the search field, unlike the plain Nearby
    // list which has no field above it.
    await page.keyboard.press("ArrowUp");
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(input).toBeFocused();

    const secondRowInfo = await rows.nth(1).evaluate((el) => ({ type: el.dataset.searchType, key: el.dataset.searchKey }));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => Boolean(state.selected));
    const selectedMatches = await page.evaluate((expected) => {
      const key = expected.type === "tree" ? treeHashKey(state.selected.item)
        : expected.type === "landmark" ? placeHashKey(state.selected.item)
        : null;
      return state.selected?.type === expected.type && key === expected.key;
    }, secondRowInfo);
    expect(selectedMatches).toBe(true);
  });

  test("searching a tree tag finds that tree, and choosing it navigates there", async ({ page }) => {
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", FIXTURE_TREE.tagNumber);

    const result = page.locator("#mapSearchResults .nearest-item").first();
    await expect(result).toContainText(FIXTURE_TREE.commonName);
    await expect(result).toContainText(FIXTURE_TREE.tagNumber);

    await result.click();

    await page.waitForFunction(
      (name) => document.getElementById("inspectorTitle")?.textContent?.includes(name),
      FIXTURE_TREE.commonName
    );
    await expect(page).toHaveURL(new RegExp(`tree=${FIXTURE_TREE.hashKey}`));
  });

  test("a street split across many map ways is offered once, and can be navigated to", async ({ page }) => {
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", FIXTURE_ROAD);

    // Roads are not in the nearby list at all, so search is the only way to steer to one.
    const roadRows = page.locator('#mapSearchResults [data-search-type="road"]');
    await expect(roadRows.first()).toBeVisible();

    // OpenStreetMap splits this street into 164 separate ways; the list offers it once.
    const named = await page.evaluate((name) => {
      const ways = state.roads.filter((road) => road.name === name).length;
      const rows = searchMapFeatures(name)
        .filter((result) => result.type === "road" && result.item.name === name).length;
      return { ways, rows };
    }, FIXTURE_ROAD);
    expect(named.ways).toBeGreaterThan(1);
    expect(named.rows).toBe(1);

    await roadRows.first().click();

    await expect(page).toHaveURL(/#road=/);
  });

  test("a query that matches nothing says so rather than showing an empty list", async ({ page }) => {
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", "zzzqqqnothinghere");

    await expect(page.locator("#mapSearchResults")).toContainText("Nothing on the map matches");
    await expect(page.locator("#mapSearchResults .nearest-item")).toHaveCount(0);
  });

  test("clearing the field puts the prompt back", async ({ page }) => {
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", FIXTURE_PLACE);
    await expect(page.locator("#mapSearchResults .nearest-item").first()).toBeVisible();

    await page.click("#mapSearchClear");

    await expect(page.locator("#mapSearchInput")).toHaveValue("");
    await expect(page.locator("#mapSearchResults")).toContainText("Search for a tree tag");
  });

  test("typing a query highlights the top matches and frames all of them, live", async ({ page }) => {
    await page.click("#searchToggle");

    await page.fill("#mapSearchInput", FIXTURE_ROAD);
    // renderSearchResults debounces to one rAF; wait for that recompute rather than the input event.
    await page.waitForFunction(
      (name) => state.searchHighlightResults.some((r) => r.item?.name === name),
      FIXTURE_ROAD
    );

    // The camera fit is debounced past a typing pause (SEARCH_CAMERA_FIT_DEBOUNCE_MS) and then
    // animates (DEFAULT_VIEWPORT_ANIMATION_MS) -- wait for it to actually land rather than
    // asserting on the pre-fit viewport.
    await page.waitForFunction(() => {
      const points = state.searchHighlightResults
        .map((r) => searchResultPoint(r.type, r.item))
        .filter(Boolean)
        .map((p) => worldToScreen(p));
      return points.length > 0 && points.every((p) => p.x >= 0 && p.x <= els.canvas.width && p.y >= 0 && p.y <= els.canvas.height);
    });

    const afterRoad = await page.evaluate(() => ({
      count: state.searchHighlightResults.length,
      fitScale: state.fitScale,
      keys: state.searchHighlightResults.map((r) => r.key),
    }));
    expect(afterRoad.count).toBeGreaterThan(0);
    expect(afterRoad.count).toBeLessThanOrEqual(10);

    // Narrowing to a single, local match re-fits tighter and swaps the highlighted set.
    await page.fill("#mapSearchInput", FIXTURE_TREE.tagNumber);
    await page.waitForFunction(
      (tag) => state.searchHighlightResults.some((r) => r.item?.tagNumber === tag),
      FIXTURE_TREE.tagNumber
    );
    const afterTree = await page.evaluate(() => ({
      count: state.searchHighlightResults.length,
      keys: state.searchHighlightResults.map((r) => r.key),
    }));
    expect(afterTree.keys).not.toEqual(afterRoad.keys);

    // Clearing the query drops the highlight entirely.
    await page.click("#mapSearchClear");
    await page.waitForFunction(() => state.searchHighlightResults.length === 0);
  });

  test("the map shows only the matching pin for a search, ignoring the active filters", async ({ page }) => {
    await page.click("#searchToggle");
    await page.click("#nearbyToggle");
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby")
    );

    // Filter down to just Cows, then search for the pub -- a category Cows-only would hide.
    await page.click("#filterToggle");
    await page.click('[data-filter-subfilter="cows"]');
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", FIXTURE_PLACE);
    await page.waitForFunction(
      (name) => state.searchHighlightResults.some((r) => r.item?.name === name),
      FIXTURE_PLACE
    );

    const lookup = await page.evaluate(() => {
      const active = activeIconLookup();
      return {
        landmarkCount: active.landmark.size,
        treeCount: active.tree.size,
        opacity: markerOpacityFor("landmark", Array.from(active.landmark)[0]),
      };
    });
    expect(lookup.landmarkCount).toBe(1);
    expect(lookup.treeCount).toBe(0);
    expect(lookup.opacity).toBe(1);

    // The active filter is still there to clear.
    const clearButton = page.locator("#mapSearchResults [data-filter-clear-all]");
    await expect(clearButton).toBeVisible();
    await clearButton.click();
    await expect(clearButton).toHaveCount(0);
    const filtersAfter = await page.evaluate(() => state.overviewFilters.length);
    expect(filtersAfter).toBe(0);
  });

  test("the nearby button is the way back out of search", async ({ page }) => {
    await page.click("#searchToggle");
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Search")
    );

    await page.click("#nearbyToggle");

    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby")
    );
    await expect(page).not.toHaveURL(/#search/);
  });
});

test.describe("Searching the map with a location fix", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  // The first match to appear fits the camera immediately (no debounce -- see
  // updateSearchHighlight's comment); waiting for the animation to actually finish
  // (viewportAnimationTo clears once it lands) avoids reading the viewport mid-flight, which a
  // bare "is it onscreen yet" check can pass on well before the animation settles.
  async function waitForSearchFitToSettle(page) {
    await page.waitForFunction(() => state.viewportAnimationTo == null);
  }

  test("the camera fit keeps the user's own position on screen alongside the matches", async ({ page }) => {
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", FIXTURE_ROAD);
    await page.waitForFunction(
      (name) => state.searchHighlightResults.some((r) => r.item?.name === name),
      FIXTURE_ROAD
    );
    await waitForSearchFitToSettle(page);

    const onscreen = await page.evaluate(() => {
      const origin = nearbyOrigin();
      const point = worldToScreen(origin.point);
      return point.x >= 0 && point.x <= els.canvas.width && point.y >= 0 && point.y <= els.canvas.height;
    });
    expect(onscreen).toBe(true);
  });

  test("a later GPS fix does not snap the camera back to the Nearby ring", async ({ page, context }) => {
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", FIXTURE_ROAD);
    await page.waitForFunction(
      (name) => state.searchHighlightResults.some((r) => r.item?.name === name),
      FIXTURE_ROAD
    );
    await waitForSearchFitToSettle(page);
    const settledScale = await page.evaluate(() => state.viewport.scale);

    // A fresh GPS fix -- exactly what a real watchPosition update, or the foreground sensor
    // watchdog restarting a stale watch, delivers periodically regardless of whether the user
    // has actually moved.
    const nudged = { latitude: FOREST_LOCATION.latitude + 0.0003, longitude: FOREST_LOCATION.longitude };
    await context.setGeolocation({ ...nudged, accuracy: 5 });
    await page.waitForFunction(
      (target) => Math.abs(state.userLocation.latitude - target.latitude) < 0.0001,
      nudged
    );
    // Give any (wrongly re-triggered) ring fit's own animation time to finish landing, so a
    // regression would be caught here rather than racing this assertion.
    await page.waitForTimeout(1000);

    const after = await page.evaluate(() => {
      const origin = nearbyOrigin();
      const point = worldToScreen(origin.point);
      return {
        scale: state.viewport.scale,
        userOnscreen: point.x >= 0 && point.x <= els.canvas.width && point.y >= 0 && point.y <= els.canvas.height,
      };
    });
    // The ring fit is a much wider/tighter scale than the search fit settled on above -- a
    // regression shows up as this scale jumping, not just as staying similar by coincidence.
    expect(after.scale).toBeCloseTo(settledScale, 1);
    expect(after.userOnscreen).toBe(true);
  });
});
