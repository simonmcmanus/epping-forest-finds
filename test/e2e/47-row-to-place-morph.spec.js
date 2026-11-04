// Opening a place from a Nearby row morphs the row into the place header, and going back flies the
// header's icon into its row again. The panel header box never moves while that happens. See
// spec-data-rendering.md, "Row-to-place morph".
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

// The morph is motion, so these specs opt back in to animation (the suite default is reduced motion).
test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"], reducedMotion: "no-preference" });

const listed = (page) => page.locator("#inspectorBody .nearest-item");

/**
 * Samples the header and the title icon/text on every animation frame, from now until the title has
 * changed and the morph (340 ms) has had time to land. Stops on that state rather than a fixed clock,
 * so a loaded runner that delays the tap still gets the whole flight in the samples.
 */
async function recordFrames(page) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__framesDone = false;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const titleNow = () => document.getElementById("inspectorTitle")?.textContent ?? "";
    const initialTitle = titleNow();
    const start = performance.now();
    let changedAt = null;
    const step = () => {
      const now = performance.now();
      if (changedAt === null && titleNow() !== initialTitle) changedAt = now;
      window.__frames.push({
        header: box(document.querySelector(".inspector-title-section")),
        icon: box(document.getElementById("inspectorTitleEmoji")),
        title: titleNow(),
        rowIcon: box(document.querySelector("#inspectorBody .nearest-item .nearest-icon")),
      });
      const landed = changedAt !== null && now - changedAt > 600;
      if (landed || now - start > 8000) window.__framesDone = true;
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function framesOf(page) {
  await page.waitForFunction(() => window.__framesDone === true);
  return page.evaluate(() => window.__frames);
}

// Playwright's boundingBox() reports { x, y, width, height }; the in-page samples use { x, y, w, h }.
const fromLocator = (box) => ({ x: box.x, y: box.y, w: box.width, h: box.height });
const centre = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Every frame's header box matches the first one to within a pixel. */
function expectHeaderStill(frames) {
  const first = frames[0].header;
  for (const frame of frames) {
    expect(Math.abs(frame.header.x - first.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.header.y - first.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.header.w - first.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.header.h - first.h)).toBeLessThanOrEqual(1);
  }
}

test.describe("Row to place morph", () => {
  test("the panel header does not move while a Nearby row opens a place", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    await waitForUiToSettle(page);

    await recordFrames(page);
    await listed(page).first().click();
    const frames = await framesOf(page);

    // The place is on screen (the title has changed), and the header box stayed exactly where it was.
    expect(frames.at(-1).title).not.toBe("Nearby");
    expectHeaderStill(frames);
  });

  test("the row's icon travels from the tapped row up into the place header", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    await waitForUiToSettle(page);
    const rowIcon = fromLocator(await listed(page).first().locator(".nearest-icon").boundingBox());

    await recordFrames(page);
    await listed(page).first().click();
    const frames = await framesOf(page);

    // The first frame of the place is nearer the row it came from than the header it lands in.
    const landing = fromLocator(await page.locator("#inspectorTitleEmoji").boundingBox());
    const opening = frames.find((frame) => frame.title !== "Nearby");
    expect(opening).toBeDefined();
    expect(distance(centre(opening.icon), centre(rowIcon))).toBeLessThan(distance(centre(opening.icon), centre(landing)));

    // It finishes resting in the header.
    await waitForUiToSettle(page);
    const settled = frames.at(-1).icon;
    expect(Math.abs(settled.x - landing.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(settled.y - landing.y)).toBeLessThanOrEqual(1);
  });

  test("going back flies the place's icon down into its Nearby row, with the header still", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    await waitForUiToSettle(page);
    await listed(page).first().click();
    await expect(page.locator("#inspectorTitle")).not.toHaveText("Nearby");
    await waitForUiToSettle(page);
    const placeIcon = fromLocator(await page.locator("#inspectorTitleEmoji").boundingBox());

    await recordFrames(page);
    await page.locator("#nearbyToggle").click();
    const frames = await framesOf(page);

    // The header box stayed put through the return.
    expectHeaderStill(frames);

    // The first Nearby frame has the row's icon nearer the place's header icon than its own row.
    const opening = frames.find((frame) => frame.title === "Nearby");
    expect(opening).toBeDefined();
    const restingRowIcon = frames.at(-1).rowIcon;
    expect(distance(centre(opening.rowIcon), centre(placeIcon))).toBeLessThan(distance(centre(opening.rowIcon), centre(restingRowIcon)));
  });
});
