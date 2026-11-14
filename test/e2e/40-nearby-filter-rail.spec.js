// @ts-check
// Nearby's filter rail: a row of category pills that narrows the list in place (no panel slide).
// See spec-data-rendering.md "Nearby filter rail".
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle, waitForFrames, settleMapIconsAndDraw } = require("./helpers");

// A GPS fix inside Epping Forest, with trees, ponds and pubs around it.
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

const rail = (page) => page.locator("#inspectorBody .filter-rail");
const pill = (page, key) => page.locator(`#inspectorBody [data-rail-key="${key}"]`);

/** Starts from the show-everything view, so a pill tap is the first narrowing. */
async function showAll(page) {
  await setup(page, "/nearby?filters=false");
  await expect(rail(page)).toBeVisible();
}

/** Presses and holds a pill until the map setup dialog opens, then lets go. */
async function holdPill(page, key) {
  const target = pill(page, key);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator("#onboardingOverlay")).toBeVisible();
  await page.mouse.up();
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

  test("plain Nearby shows top-level categories, each enabled group counting its subcategories that are on", async ({ page }) => {
    // The reader's saved filters are the starting selection, so their groups read as pressed.
    // Nature's defaults are Trees and Cows out of its three subcategories.
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "nature").locator(".rail-count")).toHaveText("2/3");
    await expect(pill(page, "nature").locator(".rail-check")).toHaveText("✓");
    await expect(pill(page, "food")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "transport")).toHaveAttribute("aria-pressed", "false");
    await expect(pill(page, "transport").locator(".rail-count")).toHaveText("0/4");
    await expect(rail(page).locator("[data-rail-key]").first()).toBeVisible();
  });

  test("a group's count shows how many subcategories are on, even when the group is off", async ({ page }) => {
    // Pubs stays on, so switching Nature off leaves a set that is not empty: un-pressing the last pill would select Everything.
    await setup(page, "/nearby?show=trees,ponds_streams,pubs");
    await expect(pill(page, "nature").locator(".rail-count")).toHaveText("2/3");
    await pill(page, "nature").click();
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "false");
    await expect(pill(page, "nature").locator(".rail-count")).toHaveText("0/3");
    await pill(page, "nature").click();
    await expect(pill(page, "nature").locator(".rail-count")).toHaveText("3/3");
  });

  test("a group pill keeps the same width when it is switched on or off", async ({ page }) => {
    await setup(page, "/nearby?show=trees,ponds_streams,pubs");
    const on = await pill(page, "nature").boundingBox();
    await pill(page, "nature").click();
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "false");
    const off = await pill(page, "nature").boundingBox();
    await pill(page, "nature").click();
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "true");
    const onAgain = await pill(page, "nature").boundingBox();
    expect(off.width).toBeCloseTo(on.width, 0);
    expect(onAgain.width).toBeCloseTo(on.width, 0);
  });

  test("tapping a top-level category narrows in place while keeping top-level pills available", async ({ page }) => {
    await showAll(page);
    await watchForPanelSlide(page);
    await pill(page, "nature").click();
    await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "nature")).toHaveCount(1);
    await expect(pill(page, "food")).toHaveCount(1);
    await expect(page.locator("#inspectorBody .nearest-item")).not.toHaveCount(0);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
    expect(await page.evaluate(() => state.overviewFilters.join())).toBe("trees,cows,ponds_streams");
  });

  test("All nearby restores every category and returns to the top-level rail", async ({ page }) => {
    await showAll(page);
    await pill(page, "nature").click();
    await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
    await pill(page, "all-nearby").click();
    await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
    await expect(pill(page, "all-nearby")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "food")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "pubs")).toHaveCount(0);
  });

  test("a second top-level category can be selected without changing the rail level", async ({ page }) => {
    await showAll(page);
    await pill(page, "nature").click();
    await pill(page, "food").click();
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "food")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "pubs")).toHaveCount(0);
  });

  test("a category page shows subcategories and toggling one changes only that subcategory", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("forest-finds-filter-state-v1", JSON.stringify({ filters: ["pubs", "restaurants", "cafes", "shops"] }));
    });
    await setup(page, "/nearby/food");
    await expect(rail(page)).toBeVisible();
    await expect(pill(page, "pubs")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "restaurants")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "cafes")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "shops")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "nature")).toHaveCount(0);
    await watchForPanelSlide(page);
    await pill(page, "cafes").click();
    await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
    await expect(pill(page, "cafes")).toHaveAttribute("aria-pressed", "false");
    await expect(pill(page, "pubs")).toHaveCount(1);
    expect(await page.evaluate(() => window.__slides)).toBe(0);

    // The rail stays at the subcategory level after another toggle: the URL is plain Nearby now.
    await pill(page, "restaurants").click();
    await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
    await expect(pill(page, "restaurants")).toHaveAttribute("aria-pressed", "false");
    await expect(pill(page, "shops")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "nature")).toHaveCount(0);
  });

  test("Everything also resets a category landing without changing its rail level", async ({ page }) => {
    await setup(page, "/nearby/food");
    await pill(page, "cafes").click();
    await pill(page, "all-nearby").click();
    await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
    await expect(pill(page, "all-nearby")).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page, "pubs")).toHaveCount(1);
    await expect(pill(page, "nature")).toHaveCount(0);
  });

  test("un-pressing the only category on its landing selects Everything and saves it", async ({ page }) => {
    // The landing's pressed state is its own view. Un-pressing its only category leaves no empty set:
    // the view and the saved set both become every category.
    await setup(page, "/nearby/trees");
    await expect(pill(page, "trees")).toHaveAttribute("aria-pressed", "true");
    await pill(page, "trees").click();
    await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
    await expect(pill(page, "all-nearby")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => state.overviewFilters.length)).toBe(await page.evaluate(() => ALL_OVERVIEW_FILTER_KEYS.size));
    expect(await page.evaluate(() => loadStoredOverviewFilters().length)).toBe(await page.evaluate(() => ALL_OVERVIEW_FILTER_KEYS.size));
  });

  test("un-pressing the last category selects Everything and keeps the list populated", async ({ page }) => {
    await showAll(page);
    await pill(page, "nature").click();
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "true");
    await pill(page, "nature").click();
    await expect(pill(page, "all-nearby")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => loadStoredOverviewFilters().length)).toBe(await page.evaluate(() => ALL_OVERVIEW_FILTER_KEYS.size));
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
  });

  test("closing a held pill's dialog with no change on a category landing keeps the landing and the saved set", async ({ page }) => {
    await setup(page, "/nearby/food");
    await expect(pill(page, "cafes")).toHaveAttribute("aria-pressed", "true");
    const urlBefore = page.url();
    const savedBefore = await page.evaluate(() => localStorage.getItem("forest-finds-filter-state-v1"));

    await holdPill(page, "cafes");
    await page.getByRole("button", { name: "Close map setup" }).click();
    await expect(page.locator("#onboardingOverlay")).toBeHidden();

    expect(page.url()).toBe(urlBefore);
    await expect(pill(page, "cafes")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("forest-finds-filter-state-v1"))).toBe(savedBefore);
  });

  test("a pill tap on All nearby on a category landing saves every category, and a reload keeps them", async ({ page }) => {
    await setup(page, "/nearby/food");
    await pill(page, "all-nearby").click();
    await expect(pill(page, "all-nearby")).toHaveAttribute("aria-pressed", "true");
    const every = await page.evaluate(() => ALL_OVERVIEW_FILTER_KEYS.size);
    expect(await page.evaluate(() => loadStoredOverviewFilters().length)).toBe(every);

    await page.reload();
    await page.waitForFunction(() => typeof state !== "undefined" && state.dataLoaded === true);
    await waitForUiToSettle(page);
    expect(await page.evaluate(() => state.overviewFilters.length)).toBe(every);
  });

  test("a selected top-level Nature pill can be switched off", async ({ page }) => {
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "true");
    await pill(page, "nature").click();
    await expect(pill(page, "nature")).toHaveAttribute("aria-pressed", "false");
    await expect(pill(page, "food")).toHaveAttribute("aria-pressed", "true");
  });

  test("adding Transport does not widen the walking radius to an invisible fallback", async ({ page }) => {
    const before = await page.evaluate(() => state.walkingDistanceMinutes);
    await pill(page, "transport").click();
    await expect.poll(() => page.evaluate(() => state.walkingDistanceMinutes)).toBe(before);
  });

  test("rapidly toggling a category off and on keeps the returning rows visible", async ({ page }) => {
    const nature = pill(page, "nature");
    await nature.click();
    await nature.click();
    await expect(nature).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".nearest-list .nearest-item")).not.toHaveCount(0);
  });

  for (const reducedMotion of ["reduce", "no-preference"]) {
    test(`a location update keeps the sideways category list at its scrolled position (${reducedMotion})`, async ({ page, context }) => {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 390, height: 844 });
      await waitForUiToSettle(page);
      const row = page.locator(".rail-pills");
      await expect.poll(() => row.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(100);
      const position = await row.evaluate(el => { el.scrollLeft = el.scrollWidth; return el.scrollLeft; });
      const previous = await page.locator("#inspectorBody").innerHTML();
      await context.setGeolocation({ ...FOREST_LOCATION, latitude: FOREST_LOCATION.latitude + 0.0003 });
      await expect.poll(() => page.locator("#inspectorBody").innerHTML()).not.toBe(previous);
      await waitForUiToSettle(page);
      await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBeCloseTo(position, 0);
      await expect(rail(page)).toHaveClass(/has-left-overflow/);
    });
  }

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
    await expect(rail(page)).toHaveClass(/has-left-overflow/);
    await stories.click();
    await expect(stories).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBe(before);
    await expect(stories.locator(".rail-count")).toHaveText("4/4");
    await expect(stories.locator(".rail-check")).toHaveText("✓");
    await row.evaluate((el) => { el.scrollLeft = 0; });
    await expect(rail(page)).not.toHaveClass(/has-left-overflow/);
  });

  test("holding a group pill opens just that category's chips, without toggling the pill", async ({ page }) => {
    const before = await page.evaluate(() => state.overviewFilters.slice().sort().join());
    await holdPill(page, "transport");
    const overlay = page.locator("#onboardingOverlay");
    await expect(overlay.locator(".onboarding-step-title")).toHaveText("Transport");
    await expect(overlay.locator(".onboarding-chip")).toHaveCount(4);
    // Not the full map setup: no intro, no progress dots, no Back.
    await expect(overlay.locator(".onboarding-dot")).toHaveCount(0);
    await expect(overlay.locator(".ob-back")).toHaveCount(0);
    await expect(overlay.locator(".ob-next")).toHaveText("Done");
    expect(await page.evaluate(() => state.overviewFilters.slice().sort().join())).toBe(before);
  });

  test("holding a subcategory pill opens the dialog for its own group", async ({ page }) => {
    await setup(page, "/nearby/food/");
    await expect(pill(page, "cafes")).toBeVisible();
    await holdPill(page, "cafes");
    await expect(page.locator("#onboardingOverlay .onboarding-step-title")).toHaveText("Food");
    await expect(page.locator("#onboardingOverlay .onboarding-chip")).toHaveCount(4);
  });

  test("a category changed in a held group's dialog updates that group's count when Done is pressed", async ({ page }) => {
    await expect(pill(page, "food").locator(".rail-count")).toHaveText("1/4");
    await holdPill(page, "food");
    await page.locator("#onboardingOverlay .onboarding-chip[data-key='restaurants']").click();
    await page.locator("#onboardingOverlay .ob-next").click();
    await expect(page.locator("#onboardingOverlay")).toBeHidden();
    await expect(pill(page, "food").locator(".rail-count")).toHaveText("2/4");
  });

  test("a long hold selects no text on the pill or anywhere else", async ({ page }) => {
    const label = pill(page, "food").locator("span").first();
    // A double-click would select the word under the pointer if the pill allowed it.
    const selectable = await label.evaluate((el) => getComputedStyle(el).userSelect);
    await holdPill(page, "food");
    expect(await page.evaluate(() => window.getSelection().toString())).toBe("");
    expect(selectable).toBe("none");
  });

  test("a press that starts on a pill cannot start a text selection", async ({ page }) => {
    const started = await pill(page, "food").locator("span").first().evaluate((el) =>
      !el.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }))
    );
    expect(started).toBe(true);
  });

  test("the Nearby rail contains category pills without a right-hand control", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Filters" })).toHaveCount(0);
    await expect(rail(page).locator("[data-rail-key]")).not.toHaveCount(0);
  });

  test("the Nearby title icon links back to plain Nearby", async ({ page }) => {
    await setup(page, "/nearby/food");
    const titleLink = page.locator("#inspectorTitleEmoji a.inspector-title-link");
    await expect(titleLink).toHaveAttribute("href", "/nearby");
    await titleLink.click();
    await expect(page).toHaveURL(/\/nearby(?:\?.*)?$/);
    await expect(pill(page, "nature")).toHaveCount(1);
  });

  test("the Nearby nav button leaves a category landing at plain Nearby", async ({ page }) => {
    await setup(page, "/nearby/nature/");
    await page.locator("#nearbyToggle").click();
    await expect(page).toHaveURL(/\/nearby(?:\?.*)?$/);
  });

  test("snapshot: nearby with a rail pick", async ({ page }) => {
    // A top-level pick saves the filter set, so the Nearby list and map show the picked categories.
    await pill(page, "nature").click();
    await waitForUiToSettle(page);
    await settleMapIconsAndDraw(page);
    await expect(page).toHaveScreenshot("nearby-with-a-rail-pick.png", { fullPage: false });
  });

  test("snapshot: Pixel 5 filter rail and navigation alignment", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the alignment capture is mobile-only");
    // Keep these focused captures at the renderer's actual Pixel 5 viewport. The full-sheet
    // snapshot can hide a one-line alignment regression behind map and list pixels; these images
    // make the rail count, clipped-edge fade, and tab labels independently reviewable.
    await page.setViewportSize({ width: 393, height: 727 });
    await pill(page, "nature").click();
    await waitForUiToSettle(page);
    await settleMapIconsAndDraw(page);

    const navAlignment = await page.locator(".inspector-actions > a").evaluateAll((tabs) => {
      const boxes = tabs.map((tab) => {
        const tabBox = tab.getBoundingClientRect();
        const label = tab.querySelector(".nav-label").getBoundingClientRect();
        return {
          fits: label.left >= tabBox.left && label.right <= tabBox.right,
          centerY: (label.top + label.bottom) / 2,
        };
      });
      return {
        allFit: boxes.every((box) => box.fits),
        centerSpread: Math.max(...boxes.map((box) => box.centerY)) - Math.min(...boxes.map((box) => box.centerY)),
      };
    });
    expect(navAlignment.allFit).toBe(true);
    expect(navAlignment.centerSpread).toBeLessThanOrEqual(1);

    const countAlignment = await pill(page, "nature").evaluate((element) => {
      const label = [...element.querySelectorAll(":scope > span")]
        .find((span) => !span.classList.contains("rail-count") && !span.classList.contains("rail-check"));
      const count = element.querySelector(".rail-count");
      const centerY = (box) => (box.top + box.bottom) / 2;
      return Math.abs(centerY(label.getBoundingClientRect()) - centerY(count.getBoundingClientRect()));
    });
    expect(countAlignment).toBeLessThanOrEqual(1);

    await expect(rail(page)).toHaveScreenshot("nearby-pixel5-filter-rail.png");
    await expect(page.locator(".inspector-actions")).toHaveScreenshot("nearby-pixel5-navigation.png");
  });
});

test.describe("Nearby without a location fix", () => {
  test.use({ geolocation: undefined, permissions: [] });

  test("a saved single category without a location asks for location instead of listing every place in it", async ({ page }) => {
    // A saved set of one category is the reader's own choice, not a view of a landing, so it is not
    // listed in full without a location: the list asks for one instead.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded-filters")) return;
      sessionStorage.setItem("seeded-filters", "1");
      localStorage.setItem("forest-finds-filter-state-v1", JSON.stringify({ filters: ["cafes"] }));
    });
    await setup(page, "/nearby");
    await expect(rail(page)).toBeVisible();
    expect(await page.evaluate(() => state.userLocation)).toBeNull();
    await expect(page.locator("#inspectorBody .empty", { hasText: "Use your location" })).toBeVisible();
    await expect(page.locator("#inspectorBody .nearest-item")).toHaveCount(0);
  });
});

test("a category link opens with its subcategories available", async ({ page }) => {
  await setup(page, "/nearby/food?show=pubs");
  await expect(pill(page, "pubs")).toHaveAttribute("aria-pressed", "true");
  await expect(pill(page, "trees")).toHaveCount(0);
  await pill(page, "cafes").click();
  await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
  await expect(pill(page, "pubs")).toHaveCount(1);
  await expect(pill(page, "nature")).toHaveCount(0);
});

test("when more pills fit than are visible, the row can scroll sideways and return to the start", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the desktop panel is wide enough to show the whole row");
  await setup(page, "/nearby");
  await expect(rail(page)).toBeVisible();
  const row = page.locator(".rail-pills");
  await expect.poll(() => row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(10);
  await row.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(10);
  await row.evaluate((el) => { el.scrollLeft = 0; });
  await expect.poll(() => page.evaluate(() => document.querySelector(".rail-pills").scrollLeft)).toBe(0);
});

test("narrow phones keep every navigation label inside its tab", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the narrow-phone layout is mobile-only");
  await setup(page, "/nearby");
  await page.setViewportSize({ width: 280, height: 844 });
  await expect.poll(() => page.locator(".inspector-actions > a").count()).toBe(4);
  const labelsFit = await page.locator(".inspector-actions > a").evaluateAll((tabs) => tabs.every((tab) => {
    const tabBox = tab.getBoundingClientRect();
    const label = tab.querySelector(".nav-label").getBoundingClientRect();
    return label.left >= tabBox.left && label.right <= tabBox.right && label.height <= tabBox.height;
  }));
  expect(labelsFit).toBe(true);
});

// Keep motion enabled: ordinary rail coverage uses reduced motion and would hide an intro nudge.
test.describe("Nearby pill arrival", () => {
  test.use({ reducedMotion: "no-preference" });

  for (const [label, path] of [["category", "/nearby"], ["subcategory", "/nearby/food"]]) {
    test(`${label} pills stay still on first display and can be scrolled manually`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 393, height: 851 });
      await page.addInitScript(() => {
        window.__arrivalScroll = 0;
        document.addEventListener("scroll", (event) => {
          if (event.target instanceof HTMLElement && event.target.matches(".rail-pills")) {
            window.__arrivalScroll = Math.max(window.__arrivalScroll, event.target.scrollLeft);
          }
        }, true);
      });
      await setup(page, path);
      const row = rail(page).locator(".rail-pills");
      await expect(row).toBeVisible();
      expect(await row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(8);
      // Nothing should move: let frames render, then assert no automatic scroll happened.
      await waitForFrames(page, 120);
      await testInfo.attach(`${label}-arrival`, { body: await rail(page).screenshot(), contentType: "image/png" });
      expect(await page.evaluate(() => window.__arrivalScroll)).toBe(0);
      await row.evaluate((el) => { el.scrollLeft = 48; });
      await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await expect(rail(page)).toHaveClass(/has-left-overflow/);
    });
  }
});
