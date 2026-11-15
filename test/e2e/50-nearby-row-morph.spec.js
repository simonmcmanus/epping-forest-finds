// @ts-check
// Opening a place from the Nearby list: the tapped row grows into the place panel, the panel's
// furniture (drag handle, tools, title, nav bar) fades back in once the card has landed, and Back
// folds the panel into the same row. Reduced-motion readers get the change with no movement.
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

const listed = (page) => page.locator("#inspectorBody .nearest-item");

/** Reads the morph card's box and the title's opacity as they stand right now. */
function readMorph(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".inspector-morph-card");
    const title = document.querySelector(".inspector-screen:not(.inspector-screen-ghost) .inspector-title-section");
    if (!card) return { card: null, titleOpacity: getComputedStyle(title).opacity };
    const r = card.getBoundingClientRect();
    return { card: { left: r.left, top: r.top, width: r.width, height: r.height }, titleOpacity: getComputedStyle(title).opacity };
  });
}

test.describe("Nearby row to place panel morph", () => {
  test("the tapped row grows into the panel, and the furniture comes back after it lands", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();

    const started = await page.evaluate(() => {
      const row = document.querySelector("#inspectorBody .nearest-item");
      const r = row.getBoundingClientRect();
      row.click();
      // Read synchronously after the press: the card is at the row's box and the furniture is hidden.
      const card = document.querySelector(".inspector-morph-card");
      const cr = card ? card.getBoundingClientRect() : null;
      return {
        row: { left: r.left, top: r.top, width: r.width, height: r.height },
        card: cr && { left: cr.left, top: cr.top, width: cr.width, height: cr.height },
        titleOpacity: getComputedStyle(document.querySelector(".inspector-screen:not(.inspector-screen-ghost) .inspector-title-section")).opacity,
        panelTitle: document.getElementById("inspectorTitle").textContent,
      };
    });
    expect(started.card, "a morph card starts the transition").not.toBeNull();
    expect(Math.abs(started.card.left - started.row.left)).toBeLessThan(1);
    expect(Math.abs(started.card.top - started.row.top)).toBeLessThan(1);
    expect(Math.abs(started.card.width - started.row.width)).toBeLessThan(1);
    expect(Number(started.titleOpacity)).toBe(0);
    expect(started.panelTitle).not.toBe("Nearby");

    // Once the card has landed and gone, the title is back and the panel is the place.
    await expect(page.locator(".inspector-morph-card")).toHaveCount(0);
    await expect(page.locator(".inspector-screen:not(.inspector-screen-ghost) .inspector-title-section")).toHaveCSS("opacity", "1");
    await expect(page.locator("#inspectorTitle")).toHaveText(started.panelTitle);
  });

  test("Back folds the panel into the Nearby row it was opened from", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();

    const key = await page.evaluate(() => {
      const row = document.querySelector("#inspectorBody .nearest-item");
      return { type: row.dataset.overviewType, key: row.dataset.overviewKey };
    });
    await page.locator(`#inspectorBody .nearest-item[data-overview-type="${key.type}"][data-overview-key="${key.key}"]`).first().click();
    await expect(page.locator(".inspector-morph-card")).toHaveCount(0);

    // Sample the card each frame while the panel folds. Its last box is the row's own box.
    await page.click("#inspectorBack");
    const samples = await page.evaluate(() => new Promise((resolve) => {
      const out = [];
      const tick = () => {
        const card = document.querySelector(".inspector-morph-card");
        if (card) {
          const r = card.getBoundingClientRect();
          out.push({ left: r.left, top: r.top, width: r.width, height: r.height });
          requestAnimationFrame(tick);
        } else if (out.length) {
          resolve(out);
        } else {
          requestAnimationFrame(tick);
        }
      };
      tick();
      setTimeout(() => resolve(out), 2000);
    }));
    expect(samples.length, "the fold is visible for some frames").toBeGreaterThan(3);
    const last = samples[samples.length - 1];
    // Read the row only now that the list is showing again.
    const rowBox = await page.evaluate(({ type, k }) => {
      const row = [...document.querySelectorAll("#inspectorBody .nearest-item")]
        .find((el) => el.dataset.overviewType === type && el.dataset.overviewKey === k);
      const r = row ? row.getBoundingClientRect() : null;
      return r && { left: r.left, top: r.top, width: r.width, height: r.height };
    }, { type: key.type, k: key.key });
    expect(rowBox, "the originating row is back on the list").not.toBeNull();
    expect(Math.abs(last.top - rowBox.top)).toBeLessThan(2);
    expect(Math.abs(last.width - rowBox.width)).toBeLessThan(2);
    await expect(page.locator("#inspectorTitle")).toHaveText("Nearby");
  });
});

test.describe("Nearby row morph with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("opening a place swaps the panel at once, with no card and no movement", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    await listed(page).first().click();
    await expect(page.locator(".inspector-morph-card")).toHaveCount(0);
    await expect(page.locator("#inspectorTitle")).not.toHaveText("Nearby");
    await expect(page.locator(".inspector-screen:not(.inspector-screen-ghost) .inspector-title-section")).toHaveCSS("opacity", "1");
  });
});
