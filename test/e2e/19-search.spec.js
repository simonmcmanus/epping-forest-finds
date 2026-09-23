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

    const afterRoad = await page.evaluate(() => {
      // Every highlighted point should be visible on screen -- the camera fit that
      // updateSearchHighlight() triggers has to actually have reached them.
      const points = state.searchHighlightResults
        .map((r) => searchResultPoint(r.type, r.item))
        .filter(Boolean)
        .map((p) => worldToScreen(p));
      const onscreen = points.every((p) => p.x >= 0 && p.x <= els.canvas.width && p.y >= 0 && p.y <= els.canvas.height);
      return {
        count: state.searchHighlightResults.length,
        fitScale: state.fitScale,
        keys: state.searchHighlightResults.map((r) => r.key),
        onscreen,
      };
    });
    expect(afterRoad.count).toBeGreaterThan(0);
    expect(afterRoad.count).toBeLessThanOrEqual(10);
    expect(afterRoad.onscreen).toBe(true);

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

  test("the camera fit keeps the user's own position on screen alongside the matches", async ({ page }) => {
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", FIXTURE_ROAD);
    await page.waitForFunction(
      (name) => state.searchHighlightResults.some((r) => r.item?.name === name),
      FIXTURE_ROAD
    );

    const onscreen = await page.evaluate(() => {
      const origin = nearbyOrigin();
      const point = worldToScreen(origin.point);
      return point.x >= 0 && point.x <= els.canvas.width && point.y >= 0 && point.y <= els.canvas.height;
    });
    expect(onscreen).toBe(true);
  });
});
