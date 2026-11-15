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


/** A lone dimmed sibling's pin, with the whole group framed above the sheet and clear of its tap margin. */
async function findTappableSibling(page) {
  return page.evaluate(() => {
    const items = Object.values(clusterItemsByType(selectionClusterGroup())).flat();
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
      const m = PANEL_EDGE_TAP_MARGIN_PX;
      const besidePanel = clientY > panel.top - m && clientY < panel.bottom + m && clientX > panel.left - m && clientX < panel.right + m;
      if (!besidePanel && hit.item === marker.items[0] && hit.item !== state.selected.item) return { point, id: hit.item.id ?? hit.item.name };
    }
    return null;
  });
}
const selectedId = () => state.selected?.item?.id ?? state.selected?.item?.name;

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

  test("siblings follow the group's captured membership: a Nearby filter that excludes them does not remove them", async ({ page }) => {
    await setup(page);
    await expandSmallGroup(page);
    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => selectionClusterGroup() != null)).toBe(true);
    await waitForUiToSettle(page);
    const lookupSize = () => page.evaluate(() => Object.values(activeIconLookup()).reduce((n, set) => n + set.size, 0));
    const before = await lookupSize();
    expect(before).toBeGreaterThan(0);
    const expected = await page.evaluate(() => Object.values(clusterItemsByType(selectionClusterGroup())).flat()
      .filter((item) => item !== state.selected.item).map((item) => item.id ?? item.name).sort());
    // The route a reader takes: Map setup, then apply a filter set that covers neither the picked place's nor the sibling's kind.
    const after = await page.evaluate(() => {
      openFiltersScreen();
      applyStagedFilterSet(["events"]);
      updateFilterUi();
      return { selected: state.selected?.type ?? null, grouped: selectionClusterGroup() != null };
    });
    await waitForUiToSettle(page);
    expect(after.selected, "opening Map setup and applying filters leaves the selection in place").not.toBeNull();
    expect(after.grouped, "so the group context stays with it").toBe(true);
    expect(await lookupSize(), "the siblings are the group's captured members, whatever the filter says").toBe(before);
    expect(await page.evaluate(() => Object.values(activeIconLookup()).flatMap((set) => [...set]).map((item) => item.id ?? item.name).sort()))
      .toEqual(expected);
    // Leaving the selection removes them, nothing stale remains.
    await page.evaluate(() => goToInitialView());
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    expect(await page.evaluate(() => state.selectionCluster)).toBeNull();
    expect(await page.evaluate(() => activeIconLookup() === buildNearbyIconLookup())).toBe(true);
  });

  test("History: each pick from the group pushes one entry; Back from a sibling returns to the previous place (group context gone), Back again to the group", async ({ page }) => {
    await setup(page);
    await expandSmallGroup(page);
    const depth = () => page.evaluate(() => history.length);
    const start = await depth();
    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => selectionClusterGroup() != null)).toBe(true);
    await waitForUiToSettle(page);
    const first = await page.evaluate(() => state.selected.item.id ?? state.selected.item.name);
    expect(await depth(), "picking from the group pushes one entry").toBe(start + 1);
    await page.evaluate(() => {
      const sibling = Object.values(activeIconLookup()).flatMap((set) => [...set])[0];
      const type = Object.keys(activeIconLookup()).find((key) => activeIconLookup()[key].has?.(sibling));
      const key = SELECTION_ROUTES.find((route) => route.type === type).toKey(sibling);
      focusOverviewItem(type, key);
    });
    await waitForUiToSettle(page);
    const second = await page.evaluate(() => state.selected.item.id ?? state.selected.item.name);
    expect(second).not.toBe(first);
    expect(await depth(), "stepping to a sibling pushes one more entry").toBe(start + 2);

    await page.goBack();
    await expect.poll(() => page.evaluate(() => state.selected?.item?.id ?? state.selected?.item?.name)).toBe(first);
    await waitForUiToSettle(page);
    expect(await page.evaluate(() => state.selectionCluster), "the previous place reopens as a plain selection: its group context is not in history").toBeNull();
    await page.goBack();
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    expect(await page.evaluate(() => Boolean(state.clusterExpanded)), "the group itself is restored").toBe(true);
  });

  test("dimmed siblings are drawn on the overlay canvas, still dimmed, with the phone held up and tilted", async ({ page }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expandSmallGroup(page);
    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => selectionClusterGroup() != null)).toBe(true);
    await waitForUiToSettle(page);
    await page.evaluate(async () => {
      window.__keepCompassFresh = setInterval(() => { state.compassLastEventAt = performance.now(); }, 50);
      state.compassHeadingTarget = 0; state.compassHeading = 0; state.renderedNavigationHeading = 0;
      state.compassLastEventAt = performance.now();
      state.tiltBetaTarget = 55; state.tiltBetaSmoothed = 55;
      window.__overlayPins = [];
      const draw = window.drawItemPin;
      window.drawItemPin = function (ctx) {
        window.__overlayPins.push({ overlay: ctx.canvas === els.overlayCanvas, alpha: ctx.globalAlpha });
        return draw.apply(this, arguments);
      };
      stopViewportAnimation();
      requestDraw();
    });
    await expect.poll(() => page.evaluate(() => tiltActive())).toBe(true);
    await page.evaluate(() => { window.__overlayPins.length = 0; drawOverlay(); });
    const pins = await page.evaluate(() => { clearInterval(window.__keepCompassFresh); return window.__overlayPins; });
    expect(pins.length, "siblings are drawn in the tilted view").toBeGreaterThan(0);
    for (const pin of pins) {
      expect(pin.overlay).toBe(true);
      expect(pin.alpha).toBeLessThanOrEqual(0.45);
    }
  });

  test("a real tap on a dimmed sibling pushes one plain history entry, keeps the group, and is one continuous move", async ({ page }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expandSmallGroup(page);
    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => selectionClusterGroup() != null)).toBe(true);
    await waitForUiToSettle(page);
    const first = await page.evaluate(selectedId);
    const pin = await findTappableSibling(page);
    expect(pin, "a lone dimmed sibling is on screen and tappable").not.toBeNull();
    const entries = await page.evaluate(() => history.length);
    await startTrace(page);
    await tapCanvasPoint(page, pin.point);
    await expect.poll(() => page.evaluate(selectedId)).toBe(pin.id);
    await waitForUiToSettle(page);
    const after = await page.evaluate((firstId) => ({
      entries: history.length,
      clusterInEntry: Boolean(history.state?.[NEARBY_ANCHOR_KEY]?.cluster),
      grouped: selectionClusterGroup() != null,
      siblingIds: Object.values(activeIconLookup()).flatMap((set) => [...set]).map((item) => item.id ?? item.name),
      firstId,
      moves: window.__moves,
    }), first);
    expect(after.entries, "one entry for the tapped sibling").toBe(entries + 1);
    expect(after.clusterInEntry, "a plain entry: the group is not recorded in it").toBe(false);
    expect(after.grouped).toBe(true);
    expect(after.siblingIds, "the previous place is now a dimmed sibling").toContain(first);
    expect(after.moves, "one continuous move").toHaveLength(1);
    expect(after.moves[0].restarting).toBe(false);
  });

  test("Back straight after a pick from the group redirects to the group in one move, with nothing held", async ({ page }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const count = await expandSmallGroup(page);
    await startTrace(page);
    await page.evaluate(() => {
      document.querySelector("#inspectorBody .nearest-item").click();
      const restore = window.restoreNearbyAnchorFromHistory;
      window.restoreNearbyAnchorFromHistory = function () {
        window.__moves = [];
        window.restoreNearbyAnchorFromHistory = restore;
        return restore.apply(this, arguments);
      };
      history.back();
    });
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    const end = await page.evaluate(() => ({
      mapHeld: state.selectionTransition.mapHeld,
      grouped: selectionClusterGroup() != null,
      expanded: state.clusterExpanded?.items.length ?? null,
      moves: window.__moves.length,
    }));
    expect(end.mapHeld).toBe(false);
    expect(end.grouped).toBe(false);
    expect(end.expanded, "the group is restored").toBe(count);
    expect(end.moves, "one redirected move").toBe(1);
  });

  test("the inspector's back arrow, with the panel minimised first, removes the siblings and leaves nothing stale drawn", async ({ page }) => {
    await setup(page);
    await expandSmallGroup(page);
    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => selectionClusterGroup() != null)).toBe(true);
    await waitForUiToSettle(page);
    await page.evaluate(() => setInspectorMinimized(true));
    await waitForUiToSettle(page);
    expect(await page.evaluate(() => selectionClusterGroup() != null), "minimising the panel keeps the siblings").toBe(true);
    await page.evaluate(() => { setInspectorMinimized(false); });
    await waitForUiToSettle(page);
    await page.locator("#inspectorBack").click();
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    await startTrace(page);
    await page.evaluate(() => { requestDraw(); });
    await expect.poll(() => page.evaluate(() => window.__pins.length)).toBeGreaterThan(0);
    const end = await page.evaluate(() => ({
      grouped: selectionClusterGroup() != null,
      plain: activeIconLookup() === buildNearbyIconLookup(),
      alphas: window.__pins.map((pin) => pin.alpha),
    }));
    expect(end.grouped).toBe(false);
    expect(end.plain, "the map is the restored group's own lookup").toBe(true);
    for (const alpha of end.alphas) expect(alpha, "nothing dimmed is left drawn").toBeGreaterThan(0.45);
  });
});
