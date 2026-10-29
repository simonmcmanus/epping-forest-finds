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

  test("plain Nearby shows top-level categories with ticks for enabled groups", async ({ page }) => {
    // The reader's saved filters are the starting selection, so their groups read as pressed.
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "nature").locator(".rail-check")).toHaveText("✓");
    await expect(pill(page, "food")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "transport")).toHaveAttribute("aria-pressed", "false");
    await expect(pill(page, "transport").locator(".rail-check")).toHaveText("×");
    await expect(page.getByRole("button", { name: "Show all nearby" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Filters" })).toHaveAttribute("href", "/nearby/filter");
    await expect(rail(page).locator("[data-rail-key]").first()).toBeVisible();
  });

  test("tapping a top-level category narrows in place and opens its subcategories", async ({ page }) => {
    await showAll(page);
    await watchForPanelSlide(page);
    await pill(page, "nature").click();
    await expect(page).toHaveURL(/\/nearby\/nature$/);
    await expect(pill(page, "trees")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "cows")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "ponds_streams")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#inspectorBody .nearest-item")).not.toHaveCount(0);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
    expect(await page.evaluate(() => state.overviewFilters.join())).toBe("trees,cows,ponds_streams");
  });

  test("a category page shows subcategories and toggling one changes only that subcategory", async ({ page }) => {
    await setup(page, "/nearby/food");
    await expect(rail(page)).toBeVisible();
    await expect(pill(page, "pubs")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "restaurants")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "cafes")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "shops")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "nature")).toHaveCount(0);
    await watchForPanelSlide(page);
    await pill(page, "cafes").click();
    await expect(page).toHaveURL(/\/nearby\?(?:radius=30&)?show=pubs,restaurants,shops$/);
    await expect(pill(page, "cafes")).toHaveCount(0);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
  });

  test("a pill that was pressed un-presses on a second tap, and the last one returns to show-all", async ({ page }) => {
    await setup(page, "/nearby/trees");
    await pill(page, "trees").click();
    await expect(page).toHaveURL(/\/nearby\?(?:radius=30&)?filters=false$/);
    await expect(rail(page).locator('[aria-pressed="true"]')).toHaveCount(7);
    await expect(page.getByRole("button", { name: "Show all nearby" })).toBeDisabled();
  });

  test("show-all on the left clears the lens without sliding", async ({ page }) => {
    await showAll(page);
    await pill(page, "nature").click();
    await watchForPanelSlide(page);
    await page.getByRole("button", { name: "Show all nearby" }).click();
    await expect(page).toHaveURL(/\/nearby\?filters=false$/);
    await expect(rail(page).locator('[aria-pressed="true"]')).toHaveCount(7);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
  });

  test("tapping pills never changes the reader's saved filters", async ({ page }) => {
    const saved = await page.evaluate(() => localStorage.getItem(FILTER_STATE_KEY));
    await pill(page, "transport").click();
    await pill(page, "food").click();
    await expect(pill(page, "food")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => localStorage.getItem(FILTER_STATE_KEY))).toBe(saved);
  });

  test("rapidly toggling a category off and on keeps the returning rows visible", async ({ page }) => {
    const nature = pill(page, "nature");
    await nature.click();
    await nature.click();
    await expect(nature).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".nearest-list .nearest-item")).not.toHaveCount(0);
  });

  test("toggling a right-scrolled pill keeps the rail under the pointer", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the desktop rail does not need horizontal scrolling");
    const row = page.locator(".rail-pills");
    const stories = pill(page, "stories");
    await stories.scrollIntoViewIfNeeded();
    await row.evaluate((el) => {
      const button = el.querySelector('[data-rail-key="stories"]');
      el.scrollLeft = Math.max(0, button.offsetLeft + button.offsetWidth - el.clientWidth - 4);
    });
    const before = await row.evaluate((el) => el.scrollLeft);
    await stories.click();
    await expect(stories).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBe(before);
    await expect(stories.locator(".rail-check")).toHaveText("✓");
  });

  test("the Filters button still slides to the Filters screen", async ({ page }) => {
    await page.getByRole("link", { name: "Filters" }).click();
    await expect(page).toHaveURL(/\/nearby\/filter/);
    await expect(page.locator("#inspectorTitle")).toHaveText(/Filters/);
  });
});

test("a category link opens with its subcategories available", async ({ page }) => {
  await setup(page, "/nearby/food?show=pubs");
  await expect(pill(page, "pubs")).toHaveAttribute("aria-pressed", "true");
  await expect(pill(page, "trees")).toHaveCount(0);
  await pill(page, "cafes").click();
  await expect(page).toHaveURL(/\/nearby\?radius=30&show=pubs,restaurants,shops$/);
});

test("when more pills fit than are visible, the row drifts sideways once and back to show it scrolls", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the desktop panel is wide enough to show the whole row");
  await page.addInitScript(() => {
    window.__railMax = 0;
    window.__railScrolls = [];
    document.addEventListener("scroll", (event) => {
      const el = event.target;
      if (el instanceof HTMLElement && el.classList.contains("rail-pills")) {
        window.__railMax = Math.max(window.__railMax, el.scrollLeft);
        window.__railScrolls.push(el.scrollLeft);
      }
    }, true);
  });
  await setup(page, "/nearby");
  await expect(rail(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__railMax)).toBeGreaterThan(10);
  await expect.poll(() => page.evaluate(() => document.querySelector(".rail-pills").scrollLeft)).toBe(0);
});
