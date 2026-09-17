// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap, FIXTURE_TREE } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.665, longitude: 0.045, accuracy: 10 };

// Dispatches a raw pointer sequence on the map canvas. setPointerCapture/releasePointerCapture
// are stubbed because they throw for synthetic (non-active) pointer ids, matching firePinch in
// 02-overview.spec.js and tapCanvasPoint in helpers.js.
async function fireCanvasPointers(page, steps) {
  return page.evaluate((steps) => {
    const canvas = els.canvas;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const rect = canvas.getBoundingClientRect();
    for (const [type, id, dx, dy] of steps) {
      canvas.dispatchEvent(new PointerEvent(type, {
        pointerId: id,
        clientX: rect.left + rect.width / 2 + dx,
        clientY: rect.top + rect.height / 2 + dy,
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
      }));
    }
  }, steps);
}

test.describe("Map gesture continuity", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  // The map used to go completely dead under a finger that was still on the glass: a second
  // touch point set state.dragging = false, and nothing ever set it back when that second
  // finger lifted. The user had to take every finger off and start again.
  test("lifting one of two fingers hands the pan back to the finger still down", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
    await page.evaluate(() => { stopViewportAnimation(); });

    // Two fingers down, one lifted, then the survivor drags 120px across.
    await fireCanvasPointers(page, [
      ["pointerdown", 3001, -60, 0],
      ["pointerdown", 3002, 60, 0],
      ["pointermove", 3001, -70, 0],
      ["pointerup", 3002, 60, 0],
    ]);

    const handedOver = await page.evaluate(() => ({
      dragging: state.dragging,
      pinchActive: state.pinchActive,
      tx: state.viewport.tx,
    }));
    expect(handedOver.pinchActive, "the two-finger radius pinch has ended").toBe(false);
    expect(handedOver.dragging, "the remaining finger is panning again").toBe(true);

    await fireCanvasPointers(page, [
      ["pointermove", 3001, 50, 0],
      ["pointerup", 3001, 50, 0],
    ]);

    const after = await page.evaluate(() => ({
      tx: state.viewport.tx,
      dragging: state.dragging,
      activePointers: state.activePointers.size,
      selected: state.selected,
    }));
    expect(Math.abs(after.tx - handedOver.tx), "the map followed that finger").toBeGreaterThan(40);
    expect(after.dragging, "and the gesture is fully torn down once it lifts").toBe(false);
    expect(after.activePointers).toBe(0);
    expect(after.selected, "a multi-touch gesture never registers as a tap").toBeNull();
  });

  // A cancelled gesture (system swipe, incoming call, the tab backgrounding) used to leave the
  // pointer in state.activePointers and state.dragging stuck true, after which the map ignored
  // every later gesture for the rest of the session.
  test("a gesture the browser takes away does not leave the map stuck", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

    await fireCanvasPointers(page, [
      ["pointerdown", 3101, 0, 0],
      ["pointermove", 3101, 30, 10],
      ["lostpointercapture", 3101, 30, 10],
    ]);

    const afterLoss = await page.evaluate(() => ({
      dragging: state.dragging,
      activePointers: state.activePointers.size,
    }));
    expect(afterLoss.activePointers, "the lost pointer is forgotten").toBe(0);
    expect(afterLoss.dragging).toBe(false);

    // A fresh gesture still works.
    await page.evaluate(() => { stopViewportAnimation(); });
    const before = await page.evaluate(() => state.viewport.tx);
    await fireCanvasPointers(page, [
      ["pointerdown", 3102, 0, 0],
      ["pointermove", 3102, 90, 0],
      ["pointerup", 3102, 90, 0],
    ]);
    const after = await page.evaluate(() => state.viewport.tx);
    expect(Math.abs(after - before), "the map responds to the next gesture").toBeGreaterThan(40);
  });
});

// With a location selected and the inspector expanded, every pointermove and every GPS fix used
// to re-run the "keep user and target framed" fit. The fit was already satisfied, so dragging
// did nothing at all -- the map read as frozen.
test.describe("Panning a selected location", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test("the map can be dragged, and the GPS follow leaves it where the user put it", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, `/#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    await expect(page.locator("#inspector")).not.toHaveClass(/minimized/);
    expect(await page.evaluate(() => shouldAutoRepositionSelection())).toBe(true);

    await page.evaluate(() => { stopViewportAnimation(); });
    const before = await page.evaluate(() => ({ tx: state.viewport.tx, ty: state.viewport.ty }));

    await fireCanvasPointers(page, [
      ["pointerdown", 3201, -80, -60],
      ["pointermove", 3201, -20, -20],
      ["pointermove", 3201, 40, 20],
      ["pointerup", 3201, 40, 20],
    ]);

    const panned = await page.evaluate(() => ({
      tx: state.viewport.tx,
      ty: state.viewport.ty,
      selectedType: state.selected && state.selected.type,
      overrideActive: manualCameraOverrideActive(),
      autoReposition: shouldAutoRepositionSelection(),
    }));
    expect(Math.abs(panned.tx - before.tx), "the drag moved the map").toBeGreaterThan(80);
    expect(panned.selectedType, "and kept the selection").toBe("tree");
    expect(panned.overrideActive, "the user now owns the camera for this selection").toBe(true);
    expect(panned.autoReposition, "so the follow stands down").toBe(false);

    // The GPS watch calls this on every fix; it must not snatch the view back.
    await page.evaluate(() => ensureUserAndSelectionVisible({ animate: true, durationMs: 200 }));
    const afterFollow = await page.evaluate(() => ({ tx: state.viewport.tx, ty: state.viewport.ty }));
    expect(afterFollow).toEqual({ tx: panned.tx, ty: panned.ty });

    // Selecting something else hands the camera back, with nothing left over to reset.
    await page.evaluate(() => { state.selected = { type: "tree", item: state.trees[0] }; });
    expect(await page.evaluate(() => manualCameraOverrideActive())).toBe(false);
  });
});

// spec-data-rendering.md, Animations: "all state-change transitions produce exactly one smooth
// animation with no intermediate jumps". The repeat callers (GPS watch, compass tick, inspector
// resize drag) each used to cancel the running ease and start a fresh one, so the camera
// decelerated and re-accelerated many times over and arrived in visible steps.
test.describe("Camera animation continuity", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test("re-requesting the same camera target keeps one continuous animation", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

    const result = await page.evaluate(async () => {
      stopViewportAnimation();
      const target = {
        scale: state.viewport.scale * 1.6,
        tx: state.viewport.tx - 400,
        ty: state.viewport.ty - 260,
      };
      animateViewportTo(target, 600);
      const firstStart = state.viewportAnimationStartTime;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const started = state.viewportAnimationStartTime;
      // Same destination, re-requested mid-flight, exactly as a GPS fix would.
      animateViewportTo({ ...target }, 600);
      const afterRepeat = state.viewportAnimationStartTime;
      // A genuinely different destination must still take over.
      animateViewportTo({ scale: target.scale, tx: target.tx + 900, ty: target.ty }, 600);
      return {
        firstStart,
        unchangedByRepeat: afterRepeat === started && started != null,
        restartedForNewTarget: state.viewportAnimationStartTime == null,
        headedSomewhereNew: state.viewportAnimationTo.tx === target.tx + 900,
      };
    });

    expect(result.unchangedByRepeat, "the in-flight ease keeps its own start time").toBe(true);
    expect(result.restartedForNewTarget, "a real change still restarts the ease").toBe(true);
    expect(result.headedSomewhereNew).toBe(true);
  });
});
