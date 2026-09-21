// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

// A real pub and a real street from the shipped datasets. "Forest Road" arrives from
// OpenStreetMap as 164 separate ways, which is exactly the case the results list has to
// collapse into one row.
const FIXTURE_PLACE = "Railway Bell";
const FIXTURE_ROAD = "Forest Road";

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
