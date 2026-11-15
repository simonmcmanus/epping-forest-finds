// @ts-check
// Picking a place inside an expanded group should read as choosing one of the group: the camera
// moves at once and the group's other members stay on the map, dimmed, and can be stepped through.
// Places picked from outside a group are unchanged (the move still waits for the pins' exit fade).
const { test, expect } = require("@playwright/test");
const { setup, tapCanvasPoint, waitForUiToSettle } = require("./helpers");

test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

const FIND_SMALL_GROUP = `(() => {
  const dpr = pixelRatio();
  const markers = buildMapMarkers(activeIconLookup(), worldToScreen).sort((a, b) => a.items.length - b.items.length);
  for (const marker of markers) {
    if (marker.items.length < 2) continue;
    const box = clusterBadgeGeometry(marker.screenPt.x, marker.screenPt.y, marker.items.length, dpr);
    const point = { x: box.left + 8 * dpr, y: box.top + box.height / 2 };
    const hit = findClusterHit(point);
    if (hit && hit.items.length === marker.items.length && hit.items[0] === marker.items[0]) return { point, count: marker.items.length };
  }
  return null;
})()`;

async function expandSmallGroup(page) {
  await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
  await waitForUiToSettle(page);
  const target = await page.evaluate(`(() => { stopViewportAnimation(); return ${FIND_SMALL_GROUP}; })()`);
  expect(target, "a group badge is on screen at the default view").not.toBeNull();
  await tapCanvasPoint(page, target.point);
  await expect.poll(() => page.evaluate(() => state.clusterExpanded?.items.length)).toBe(target.count);
  await waitForUiToSettle(page);
  return target.count;
}

/** Records every camera move and the alpha each pin is drawn at, from now on. */
async function startTrace(page) {
  await page.evaluate(() => {
    window.__moves = [];
    window.__pins = [];
    if (window.__traceInstalled) return;
    window.__traceInstalled = true;
    const move = window.moveCamera;
    window.moveCamera = function (target) {
      window.__moves.push({ toScale: target.scale, restarting: state.viewportAnimationTo != null });
      return move.apply(this, arguments);
    };
    const draw = window.drawItemPin;
    window.drawItemPin = function (ctx, type, item) {
      window.__pins.push({ id: item.id ?? item.name, alpha: ctx.globalAlpha });
      return draw.apply(this, arguments);
    };
  });
}

test.describe("A place picked from an expanded group", () => {
  test("starts its camera move at once, where a place picked from outside a group still waits", async ({ page }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
    await waitForUiToSettle(page);
    // Outside any group: the move waits out the outgoing pins' fade, so no camera move has started in the click's own task.
    await startTrace(page);
    const outside = await page.evaluate(() => {
      document.querySelector("#inspectorBody .nearest-item").click();
      return { moves: window.__moves.length, pending: state.selectionTransition.mapHeld };
    });
    expect(outside, "a place picked from the plain list waits for the exit fade").toEqual({ moves: 0, pending: true });
    await expect.poll(() => page.evaluate(() => state.selectionTransition.mapHeld)).toBe(false);
    await waitForUiToSettle(page);
    await page.locator("#inspectorBack").click();
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);

    await expandSmallGroup(page);
    await startTrace(page);
    const inside = await page.evaluate(() => {
      document.querySelector("#inspectorBody .nearest-item").click();
      return { moves: window.__moves.length, pending: state.selectionTransition.mapHeld };
    });
    expect(inside, "a place picked from an expanded group moves the camera in the same task").toEqual({ moves: 1, pending: true });
    await waitForUiToSettle(page);
    expect(await page.evaluate(() => window.__moves), "one continuous move, never retargeted").toEqual([expect.objectContaining({ restarting: false })]);
  });

  for (const motion of ["no-preference", "reduce"]) {
    test(`the group's other members stay on the map dimmed, and leave with Back or an outside pick (${motion} motion)`, async ({ page }) => {
      await setup(page);
      await page.emulateMedia({ reducedMotion: /** @type {any} */ (motion) });
      const count = await expandSmallGroup(page);
      await page.locator("#inspectorBody .nearest-item").first().click();
      await expect.poll(() => page.evaluate(() => state.selected?.type ?? null)).not.toBeNull();
      await waitForUiToSettle(page);
      await startTrace(page);
      await page.evaluate(() => requestDraw());
      await expect.poll(() => page.evaluate(() => window.__pins.length)).toBeGreaterThan(0);
      const shown = await page.evaluate(() => ({
        selected: state.selected.item.id ?? state.selected.item.name,
        group: Object.values(clusterItemsByType(state.selectionCluster)).flat().map((item) => item.id ?? item.name),
        pins: window.__pins,
        total: Object.values(clusterItemsByType(state.selectionCluster)).flat().length,
      }));
      expect(shown.total).toBe(count);
      for (const pin of shown.pins) {
        expect(pin.alpha, "siblings are dimmed").toBeLessThan(0.6);
        expect(pin.id, "the selected place is not drawn as a sibling").not.toBe(shown.selected);
        expect(shown.group).toContain(pin.id);
      }

      // Back returns to the group (part of the cluster's own restore); the dimmed siblings are gone.
      await page.goBack();
      await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
      await waitForUiToSettle(page);
      expect(await page.evaluate(() => state.selectionCluster)).toBeNull();
      expect(await page.evaluate(() => Boolean(state.clusterExpanded))).toBe(true);

      // A place outside the group ends the context too.
      await page.locator("#inspectorBody .nearest-item").first().click();
      await expect.poll(() => page.evaluate(() => state.selectionCluster != null)).toBe(true);
      await waitForUiToSettle(page);
      await page.evaluate(() => navigateInApp("/find/onest/"));
      await page.waitForFunction(() => state.selected?.item?.name === "Onest");
      expect(await page.evaluate(() => state.selectionCluster)).toBeNull();
      await waitForUiToSettle(page);
      expect(await page.evaluate(() => [...Object.values(activeIconLookup()).flatMap((set) => [...set])].length)).toBe(0);
    });
  }

  test("tapping a dimmed sibling steps to it with the group kept, in one continuous move; the selected pin keeps its own taps", async ({ page }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expandSmallGroup(page);
    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => state.selectionCluster != null)).toBe(true);
    await waitForUiToSettle(page);

    // Bring the whole group into view the way a reader would zoom out, then pick a lone sibling pin to tap.
    const pin = await page.evaluate(() => {
      const items = Object.values(clusterItemsByType(state.selectionCluster)).flat();
      fitToPoints(items.map((item) => item.point), false, { animate: false, focusVisibleArea: true, assumeInspectorOpen: true });
      stopViewportAnimation();
      requestDraw();
      const size = MAP_PNG_ICON_SIZE * pixelRatio() * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
      for (const marker of buildActiveMapMarkers(worldToScreen)) {
        if (marker.items.length !== 1) continue;
        const point = { x: marker.screenPt.x, y: marker.screenPt.y - size * 0.416 };
        const hit = findHit(point, screenToWorld(point.x, point.y));
        const stage = (els.mapStage || els.canvas).getBoundingClientRect();
        const clientX = stage.left + (point.x - state.canvasInsetX) / pixelRatio();
        const clientY = stage.top + (point.y - state.canvasInsetY) / pixelRatio();
        const panel = els.inspector.getBoundingClientRect();
        const besidePanel = clientY > panel.top - PANEL_EDGE_TAP_MARGIN_PX && clientY < panel.bottom + PANEL_EDGE_TAP_MARGIN_PX
          && clientX > panel.left - PANEL_EDGE_TAP_MARGIN_PX && clientX < panel.right + PANEL_EDGE_TAP_MARGIN_PX;
        if (!besidePanel && hit.item === marker.items[0] && hit.item !== state.selected.item) return { point, id: hit.item.id ?? hit.item.name };
      }
      return null;
    });
    expect(pin, "a lone dimmed sibling is on screen and tappable").not.toBeNull();
    const group = await page.evaluate(() => state.selectionCluster);
    expect(group).not.toBeNull();
    await startTrace(page);
    await tapCanvasPoint(page, pin.point);
    await expect.poll(() => page.evaluate(() => state.selected?.item?.id ?? state.selected?.item?.name)).toBe(pin.id);
    await waitForUiToSettle(page);
    const after = await page.evaluate(() => ({
      keptGroup: state.selectionCluster != null,
      moves: window.__moves,
      siblings: Object.values(activeIconLookup()).flatMap((set) => [...set]).length,
    }));
    expect(after.keptGroup).toBe(true);
    expect(after.siblings, "the previous place is now one of the dimmed siblings").toBeGreaterThan(0);
    expect(after.moves, "one move, not retargeted").toHaveLength(1);
    expect(after.moves[0].restarting).toBe(false);

    // A sibling standing exactly on the selected place's pin never takes the tap from it.
    const kept = await page.evaluate(() => {
      const selected = state.selected.item;
      const other = Object.values(activeIconLookup()).flatMap((set) => [...set])[0];
      const original = other.point;
      other.point = { ...selected.point };
      const size = MAP_PNG_ICON_SIZE * pixelRatio() * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
      const at = worldToScreen(selected.point);
      const point = { x: at.x, y: at.y - size * 0.416 };
      const hit = findHit(point, screenToWorld(point.x, point.y));
      other.point = original;
      return hit.item === selected;
    });
    expect(kept).toBe(true);
  });
});
