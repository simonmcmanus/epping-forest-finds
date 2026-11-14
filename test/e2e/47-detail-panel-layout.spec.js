// Layout of the selected place and cow detail screens: the details block comes first, and the
// panels on the screen sit one shared gap apart (spec/spec-data-rendering.md, "Place Details" and
// "Cow Details"). Runs on the phone project, where the inspector is the bottom sheet a visitor reads.
const { test, expect } = require("@playwright/test");
const { gotoAndWaitForMap, setup, skipOnboarding, waitForUiToSettle } = require("./helpers");

const PANEL_GAP = 16;

// The rendered distance between two panels, measured on the page. Subpixel rounding can move it by
// a fraction of a pixel, so the assertion allows one pixel either way.
async function gapBetween(upper, lower) {
  const a = await upper.boundingBox();
  const b = await lower.boundingBox();
  expect(a, "upper panel is rendered").not.toBeNull();
  expect(b, "lower panel is rendered").not.toBeNull();
  return b.y - (a.y + a.height);
}

test.describe("Nearby return from a location page", () => {
  test("the first Nearby tap after a /find/ place replaces the detail panel and refits the map", async ({ page }) => {
    await skipOnboarding(page);
    await gotoAndWaitForMap(page, "/find/railway-bell/");
    await expect.poll(() => page.evaluate(() => state.selected?.type)).toBe("landmark");

    await page.evaluate(() => {
      stopViewportAnimation();
      state.viewport.tx += 180;
      state.viewport.ty -= 120;
    });
    await page.locator("#nearbyToggle").click();
    await waitForUiToSettle(page);

    await expect(page.locator("#inspectorTitle")).toHaveText("Nearby");
    await expect(page.locator("#inspectorBody .nearest-list")).toBeVisible();
    await expect(page.locator("#inspectorBody > .place-detail")).toHaveCount(0);

    const settled = await page.evaluate(() => ({
      scale: state.viewport.scale,
      tx: state.viewport.tx,
      ty: state.viewport.ty,
    }));
    const fresh = await page.evaluate(() => {
      ensureOverviewTargetsVisible({ animate: false, force: true });
      return { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
    });
    expect(Math.abs(settled.scale - fresh.scale) / fresh.scale).toBeLessThan(0.001);
    expect(Math.abs(settled.tx - fresh.tx)).toBeLessThan(1);
    expect(Math.abs(settled.ty - fresh.ty)).toBeLessThan(1);
  });
});

test.describe("Place detail panel layout", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.click("#searchToggle");
    await page.fill("#mapSearchInput", "Railway Bell");
    await page.locator("#mapSearchResults .nearest-item").first().click();
    await expect(page.locator(".community-check-place")).toBeVisible();
    await waitForUiToSettle(page);
  });

  test("the address and website block sits above the community check card", async ({ page }) => {
    const details = page.locator("#inspectorBody .place-detail > dl");
    const check = page.locator("#inspectorBody .community-check-place");
    const detailsBox = await details.boundingBox();
    const checkBox = await check.boundingBox();
    expect(detailsBox.y).toBeLessThan(checkBox.y);
  });

  test("every panel on the screen is one 16px gap below the one above it", async ({ page }) => {
    const actions = page.locator("#inspectorBody .place-detail > .detail-top-row");
    const details = page.locator("#inspectorBody .place-detail > dl");
    const check = page.locator("#inspectorBody .community-check-place");
    const nearby = page.locator("#inspectorBody .place-detail > [data-live-nearby]");
    const report = page.locator("#inspectorBody .place-detail > .report-issue");

    const gaps = [
      await gapBetween(actions, details),
      await gapBetween(details, check),
      await gapBetween(check, nearby),
      await gapBetween(nearby, report),
    ];
    for (const gap of gaps) {
      expect(Math.abs(gap - PANEL_GAP)).toBeLessThan(1);
    }
  });
});

test.describe("Cow detail panel layout", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
    // The cow fixture reaches the app through /api/cows. Selecting one drives the same function a
    // tap on a cow pin calls, so the panel under test is the real one.
    await page.waitForFunction(() => typeof state !== "undefined" && state.cows && state.cows.length > 0);
    await page.evaluate(() => {
      const cow = state.cows[0];
      state.selected = { type: "cow", item: cow };
      showCowDetails(cow, null);
    });
    await expect(page.locator("#inspectorBody .place-detail--cow")).toBeVisible();
    await waitForUiToSettle(page);
  });

  test("a cow's values are shown without field names, the way a place's are", async ({ page }) => {
    const panel = page.locator("#inspectorBody .place-detail--cow");
    await expect(panel).toContainText("E2E-001");
    await expect(panel.locator("dt")).toHaveCount(0);
  });

  test("a cow's nearby lists sit one 16px gap below its details block", async ({ page }) => {
    const details = page.locator("#inspectorBody .place-detail--cow > dl");
    const nearby = page.locator("#inspectorBody .place-detail--cow > [data-live-nearby]");
    const gap = await gapBetween(details, nearby);
    expect(Math.abs(gap - PANEL_GAP)).toBeLessThan(1);
  });
});
