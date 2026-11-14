// @ts-check
// Camera continuity between Nearby and a selected place when the user changes screen again
// before the first camera move has landed. A refit requested mid-move must not be dropped.
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

const viewport = (page) => page.evaluate(() => ({
  scale: state.viewport.scale,
  tx: state.viewport.tx,
  ty: state.viewport.ty,
}));

test.describe("Camera after a quick change of screen", () => {
  test("returning to Nearby mid-move settles on the Nearby framing", async ({ page }) => {
    await setup(page, "/nearby");
    await page.locator("#inspectorBody [data-overview-type][data-overview-key]").first().click();
    // Tap Nearby while the selection zoom is still easing.
    await page.locator("#nearbyToggle").click();
    const returning = await page.evaluate(() => ({
      holding: state.selectionTransition.mapHeld,
      nearbyPins: ["tree", "landmark", "cow", "path", "water"]
        .reduce((count, type) => count + activeIconLookup()[type].size, 0),
    }));
    expect(returning.holding).toBe(false);
    expect(returning.nearbyPins).toBeGreaterThan(0);
    await waitForUiToSettle(page);
    await expect.poll(() => page.evaluate(() => state.selected == null && state.viewportAnimationTo == null)).toBe(true);

    const settled = await viewport(page);
    // The Nearby framing, computed fresh from the same state with no animation.
    const fresh = await page.evaluate(() => {
      ensureOverviewTargetsVisible({ animate: false, force: true });
      return { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
    });

    expect(Math.abs(settled.scale - fresh.scale) / fresh.scale).toBeLessThan(0.001);
    expect(Math.abs(settled.tx - fresh.tx)).toBeLessThan(1);
    expect(Math.abs(settled.ty - fresh.ty)).toBeLessThan(1);
  });

  test("tapping a place in the list leaves the panel open and zooms once", async ({ page }) => {
    await setup(page, "/nearby");
    await page.locator("#inspectorBody [data-overview-type][data-overview-key]").nth(0).click();
    await waitForUiToSettle(page);
    await page.locator("#nearbyToggle").click();
    await waitForUiToSettle(page);

    await page.locator("#inspectorBody [data-overview-type][data-overview-key]").nth(1).click();
    // Selecting a place from the list must not close the panel, then reopen it, then zoom: the panel
    // stays open from the tap and the camera frames the place against it.
    await expect(page.locator("#inspector")).not.toHaveClass(/minimized/);
    await waitForUiToSettle(page);
    await expect(page.locator("#inspector")).not.toHaveClass(/minimized/);
  });

  test("selection handoff hides Nearby pins before revealing the destination", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, "/nearby");
    const during = await page.evaluate(() => {
      document.querySelector("#inspectorBody [data-overview-type][data-overview-key]").click();
      const lookup = activeIconLookup();
      return {
        holding: state.selectionTransition.mapHeld,
        nearbyPins: ["tree", "landmark", "cow", "path", "water"]
          .reduce((count, type) => count + lookup[type].size, 0),
        destinationOpacity: selectionDestinationOpacity(),
      };
    });
    expect(during.holding).toBe(true);
    expect(during.nearbyPins).toBe(0);
    expect(during.destinationOpacity).toBeLessThan(1);

    await waitForUiToSettle(page);
    await expect.poll(() => page.evaluate(() => state.selectionTransition.mapHeld)).toBe(false);
  });

  test("a tap on a place inside a minimised panel opens the panel", async ({ page }) => {
    await setup(page, "/nearby");
    await page.evaluate(() => setInspectorMinimized(true));
    await expect(page.locator("#inspector")).toHaveClass(/minimized/);

    // The panel is closed; tapping what is on it must open it, as it always did. Dispatched on the
    // row itself because a minimised panel clips most of its content.
    await page.evaluate(() => {
      document.querySelector("#inspectorBody [data-overview-type][data-overview-key]")
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await expect(page.locator("#inspector")).not.toHaveClass(/minimized/);
  });

  test("tapping the minimised panel's title opens it", async ({ page }) => {
    await setup(page, "/nearby");
    await page.locator("#inspectorBody [data-overview-type][data-overview-key]").nth(0).click();
    await waitForUiToSettle(page);
    // A list tap leaves the panel open, so close it the way the drag handle does.
    await page.evaluate(() => setInspectorMinimized(true));
    await expect(page.locator("#inspector")).toHaveClass(/minimized/);

    await page.locator("#inspectorTitle").click();
    await expect(page.locator("#inspector")).not.toHaveClass(/minimized/);
  });

  test("a deep link to a tree keeps the selection map up while the camera moves", async ({ page }) => {
    await setup(page, "/nearby");
    await page.evaluate(() => navigateInApp("/nearby/trees/#near=51.667617,0.037559&label=Hornbeam"));
    await page.waitForFunction(() => state.nearbyAnchor != null);
    await waitForUiToSettle(page);

    // Followed and read in one task: reading it from the test side races the move on a loaded runner.
    // Straight after the link is followed, before the camera has landed, the map must be in its
    // selection state. Otherwise the renderer hides the Nearby pins and ring and the map blanks.
    const duringMove = await page.evaluate(() => {
      navigateInApp("/nearby?radius=30&show=trees#tree=r10867");
      return { selected: state.selected?.type, holding: state.selectionTransition.mapHeld };
    });
    expect(duringMove).toEqual({ selected: "tree", holding: true });

    await waitForUiToSettle(page);
    await expect.poll(() => page.evaluate(() => state.selectionTransition.mapHeld)).toBe(false);
  });
});
