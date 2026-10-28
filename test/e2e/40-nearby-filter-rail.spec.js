// @ts-check
// Nearby's filter rail: a row of category pills that narrows the list in place (no panel slide),
// with show-all on the left and the Filters screen on the right. spec-data-rendering.md "Nearby
// filter rail".
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

// A GPS fix inside Epping Forest, with trees, ponds and pubs around it.
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

const rail = (page) => page.locator("#inspectorBody .filter-rail");
const pill = (page, key) => page.locator(`#inspectorBody [data-rail-key="${key}"]`);

/** Starts from the show-everything view, so a pill tap is the first narrowing. */
async function showAll(page) {
  await page.getByRole("button", { name: "Show all nearby" }).click();
  await expect(page).toHaveURL(/\/nearby\?filters=false$/);
}

/** Counts every outgoing-screen ghost the panel slide would create from now on. */
async function watchForPanelSlide(page) {
  await page.evaluate(() => {
    window.__slides = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains("inspector-screen-ghost")) window.__slides += 1;
        });
      }
    }).observe(document.querySelector(".inspector-scroll"), { childList: true, subtree: true });
  });
}

test.describe("Nearby filter rail", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page, "/nearby");
    await expect(rail(page)).toBeVisible();
  });

  test("every Nearby view has the rail: show-all on the left, category pills, Filters on the right", async ({ page }) => {
    // The reader's saved filters are the starting selection, so they read as pressed.
    await expect(pill(page, "pubs")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Show all nearby" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Filters" })).toHaveAttribute("href", "/nearby/filter");
    await expect(rail(page).locator("[data-rail-key]").first()).toBeVisible();
  });

  test("tapping a pill narrows the list in place without sliding the panel, and one category is its own /nearby/<slug>", async ({ page }) => {
    await showAll(page);
    await watchForPanelSlide(page);
    await pill(page, "trees").click();
    await expect(pill(page, "trees")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\/nearby\/trees$/);
    await expect(page.locator("#inspectorBody .nearest-item")).not.toHaveCount(0);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
    expect(await page.evaluate(() => state.overviewFilters.join())).toBe("trees");
  });

  test("a second pill adds to the first as /nearby?show=a,b and the pills stay put", async ({ page }) => {
    await showAll(page);
    await pill(page, "trees").click();
    await expect(page).toHaveURL(/\/nearby\/trees$/);
    const treeNode = await pill(page, "trees").elementHandle();
    await page.evaluate((el) => { el.dataset.survives = "yes"; }, treeNode);
    // Compared against the first pill, because tapping scrolls the row sideways.
    const gap = async () => (await pill(page, "cows").boundingBox()).x - (await pill(page, "trees").boundingBox()).x;
    const gapBefore = await gap();

    await watchForPanelSlide(page);
    await pill(page, "ponds_streams").click();
    await expect(page).toHaveURL(/\/nearby\?show=trees,ponds_streams$/);
    await expect(pill(page, "ponds_streams")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "trees")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "trees")).toHaveAttribute("data-survives", "yes");
    expect(await page.evaluate(() => window.__slides)).toBe(0);
    await expect.poll(gap).toBe(gapBefore);
  });

  test("a pill that was pressed un-presses on a second tap, and the last one returns to show-all", async ({ page }) => {
    await showAll(page);
    await pill(page, "trees").click();
    await expect(pill(page, "trees")).toHaveAttribute("aria-pressed", "true");
    await pill(page, "trees").click();
    await expect(page).toHaveURL(/\/nearby\?filters=false$/);
    await expect(rail(page).locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show all nearby" })).toBeDisabled();
  });

  test("show-all on the left clears the lens without sliding", async ({ page }) => {
    await showAll(page);
    await pill(page, "trees").click();
    await pill(page, "ponds_streams").click();
    await watchForPanelSlide(page);
    await page.getByRole("button", { name: "Show all nearby" }).click();
    await expect(page).toHaveURL(/\/nearby\?filters=false$/);
    await expect(rail(page).locator('[aria-pressed="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
  });

  test("tapping pills never changes the reader's saved filters", async ({ page }) => {
    const saved = await page.evaluate(() => localStorage.getItem(FILTER_STATE_KEY));
    await pill(page, "bus").click();
    await pill(page, "cafes").click();
    await expect(pill(page, "cafes")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem(FILTER_STATE_KEY))).toBe(saved);
  });

  test("the Filters button still slides to the Filters screen", async ({ page }) => {
    await page.getByRole("link", { name: "Filters" }).click();
    await expect(page).toHaveURL(/\/nearby\/filter/);
    await expect(page.locator("#inspectorTitle")).toHaveText(/Filters/);
  });
});

test("a shared /nearby?show= link opens with its categories pressed and a second pill adds to them", async ({ page }) => {
  await setup(page, "/nearby?show=pubs");
  await expect(pill(page, "pubs")).toHaveAttribute("aria-pressed", "true");
  await expect(pill(page, "trees")).toHaveAttribute("aria-pressed", "false");
  await pill(page, "cafes").click();
  await expect(page).toHaveURL(/\/nearby\?show=pubs,cafes$/);
});
