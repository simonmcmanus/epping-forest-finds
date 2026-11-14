// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap, FIXTURE_TREE, waitForFrames, waitForUiToSettle } = require("./helpers");

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
    await gotoAndWaitForMap(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
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
      moveCamera(target, 600);
      const firstStart = state.viewportAnimationStartTime;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const started = state.viewportAnimationStartTime;
      // Same destination, re-requested mid-flight, exactly as a GPS fix would.
      moveCamera({ ...target }, 600);
      const afterRepeat = state.viewportAnimationStartTime;
      // A genuinely different destination must still take over.
      moveCamera({ scale: target.scale, tx: target.tx + 900, ty: target.ty }, 600);
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

// Records every pin the map actually paints (a lone pin or a cluster face) with the shared gesture
// fade it was painted at and whether a zoom gesture was live, plus how often the marker layout is
// recomputed. Wraps the app's paint and build functions, so it sees exactly what a user would.
async function recordPaintedPins(page) {
  await page.evaluate(() => {
    window.__pins = [];
    window.__markerBuilds = 0;
    for (const name of ["drawItemPin", "drawClusterMarker"]) {
      const original = window[name];
      window[name] = function recordedPaint(ctx, ...args) {
        window.__pins.push({ t: performance.now(), fade: framePinFade(), live: zoomGestureLive(), alpha: ctx.globalAlpha });
        return original.call(this, ctx, ...args);
      };
    }
    const build = window.buildMapMarkers;
    window.buildMapMarkers = function countedBuild(...args) {
      window.__markerBuilds += 1;
      return build.apply(this, args);
    };
  });
}

// Samples the shared pin opacity every animation frame, so a test can see that the pins really
// faded to nothing (the paint recorder cannot: nothing is painted at opacity 0).
async function trackPinFade(page) {
  await page.evaluate(() => {
    window.__fadeSamples = [];
    const sample = () => { window.__fadeSamples.push(mapPinFadeOpacity()); requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
}

async function lowestPinFade(page) {
  return page.evaluate(() => Math.min(...window.__fadeSamples));
}

// A finger pair spread in steps, one animation frame per step, left down. Resolves once moved.
async function spreadFingersAcrossFrames(page, { startHalfGap, endHalfGap, steps, press = true }) {
  await page.evaluate(async ({ startHalfGap, endHalfGap, steps, press }) => {
    const canvas = els.canvas;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fire = (type, id, x) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: cy, bubbles: true, cancelable: true, pointerType: "touch",
    }));
    if (press) {
      fire("pointerdown", 5001, cx - startHalfGap);
      fire("pointerdown", 5002, cx + startHalfGap);
    }
    for (let i = 1; i <= steps; i += 1) {
      const gap = startHalfGap + (endHalfGap - startHalfGap) * (i / steps);
      fire("pointermove", 5001, cx - gap);
      fire("pointermove", 5002, cx + gap);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, { startHalfGap, endHalfGap, steps, press });
}

async function liftFingers(page) {
  await page.evaluate(() => {
    const canvas = els.canvas;
    const rect = canvas.getBoundingClientRect();
    for (const id of [5001, 5002]) {
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: id, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        bubbles: true, cancelable: true, pointerType: "touch",
      }));
    }
  });
}

// The sequence of shared pin opacities must go down once and then up once: a fade-out, nothing,
// a reveal -- never a flicker or a pin popping in mid-gesture.
function expectOneHideOneReveal(pins) {
  const fades = pins.map((pin) => pin.fade);
  let direction = -1;
  let reversals = 0;
  for (let i = 1; i < fades.length; i += 1) {
    const step = fades[i] - fades[i - 1];
    if (Math.abs(step) < 1e-9) continue;
    const next = step < 0 ? -1 : 1;
    if (next !== direction) { reversals += 1; direction = next; }
  }
  expect(reversals, `pin opacity ${JSON.stringify(fades.map((f) => +f.toFixed(2)))} should fall once, then rise once`).toBeLessThanOrEqual(1);
}

test.describe("Zoom gestures hide the pins and bring them back together", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"], reducedMotion: "no-preference" });

  async function openNearby(page) {
    await setup(page);
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
    await waitForUiToSettle(page);
    await recordPaintedPins(page);
    await trackPinFade(page);
    await page.evaluate(() => requestDraw());
    await waitForFrames(page, 3);
    expect(await page.evaluate(() => window.__pins.length), "sanity: the Nearby map paints pins before the gesture").toBeGreaterThan(0);
  }

  test("a two-finger pinch fades the pins out together, paints none while it runs, and reveals the new set once on release", async ({ page }) => {
    await openNearby(page);
    const listBefore = await page.locator("#inspectorBody").innerHTML();
    await page.evaluate(() => { window.__pins.length = 0; });

    await spreadFingersAcrossFrames(page, { startHalfGap: 160, endHalfGap: 60, steps: 24 });
    await expect.poll(() => page.evaluate(() => zoomGestureLive() && mapPinFadeOpacity() === 0)).toBe(true);
    await page.evaluate(() => { window.__duringGesture = window.__pins.slice(); window.__pins.length = 0; window.__markerBuilds = 0; });

    // More of the pinch with the pins fully faded: nothing painted, nothing calculated, list untouched.
    await spreadFingersAcrossFrames(page, { startHalfGap: 60, endHalfGap: 30, steps: 12, press: false });
    const mid = await page.evaluate(() => ({ painted: window.__pins.length, builds: window.__markerBuilds, live: zoomGestureLive() }));
    expect(mid.live, "the zoom gesture is still live while the fingers are down").toBe(true);
    expect(mid.painted, "no pin is painted while the zoom is changing").toBe(0);
    expect(mid.builds, "no marker layout is calculated while the zoom is changing").toBe(0);
    expect(await page.locator("#inspectorBody").innerHTML(), "the Nearby list keeps its pre-gesture content").toBe(listBefore);

    await liftFingers(page);
    await expect.poll(() => page.evaluate(() => !zoomGestureLive() && mapPinFadeOpacity() === 1)).toBe(true);
    await expect(page.locator("#inspectorBody")).not.toHaveJSProperty("innerHTML", listBefore);

    const pins = await page.evaluate(() => ({ during: window.__duringGesture, after: window.__pins }));
    expect(pins.after.length, "the pins are back after the gesture").toBeGreaterThan(0);
    expectOneHideOneReveal([...pins.during, ...pins.after]);
    expect(pins.during.every((pin) => pin.fade <= 1) && pins.after.every((pin) => pin.alpha > 0)).toBe(true);
  });

  test("a run of wheel notches reads as one hide and one reveal, with the list updated once at the end", async ({ page }) => {
    await openNearby(page);
    const box = await page.locator("#mapCanvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.evaluate(() => {
      window.__pins.length = 0;
      window.__listWrites = 0;
      const original = window.selectOverview;
      window.selectOverview = function countedSelectOverview(...args) { window.__listWrites += 1; return original.apply(this, args); };
    });

    for (let notch = 0; notch < 6; notch += 1) {
      await page.mouse.wheel(0, -100);
      await waitForFrames(page, 2);
    }
    await expect.poll(() => page.evaluate(() => !zoomGestureLive() && mapPinFadeOpacity() === 1)).toBe(true);

    const result = await page.evaluate(() => ({ pins: window.__pins, listWrites: window.__listWrites }));
    expect(result.listWrites, "the Nearby list is swapped once, when the zoom settles").toBe(1);
    expect(await lowestPinFade(page), "the pins really faded all the way out during the wheel zoom").toBe(0);
    expect(result.pins.filter((pin) => pin.live && pin.fade === 0), "no pin is painted while hidden").toHaveLength(0);
    expect(result.pins.length, "the pins return after the zoom settles").toBeGreaterThan(0);
    expectOneHideOneReveal(result.pins);
  });

  test("a pin is never painted in the last instant of the fade-out, however the clock advances during a frame", async ({ page }) => {
    await openNearby(page);
    const painted = await page.evaluate(() => {
      // Drive one frame by hand with a clock that moves 0.5ms every time the app reads it, so the
      // frame straddles the instant the fade reaches zero.
      const realNow = performance.now.bind(performance);
      const fingers = (x) => { els.canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7001 + x, clientX: 100 + x * 50, clientY: 100, bubbles: true, cancelable: true, pointerType: "touch" })); };
      els.canvas.setPointerCapture = () => {};
      fingers(0); fingers(1);
      const startedAt = realNow();
      let reads = 0;
      let base = startedAt;
      performance.now = () => { reads += 1; return base + 117 + reads * 0.5; };
      window.__pins.length = 0;
      draw();
      performance.now = realNow;
      const seen = window.__pins.map((pin) => ({ fade: pin.fade, alpha: pin.alpha }));
      for (const id of [7001, 7051]) els.canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: id, bubbles: true, cancelable: true, pointerType: "touch" }));
      return seen;
    });
    expect(painted.filter((pin) => pin.fade < 1 / 255), "no pin is painted once the fade is effectively zero").toHaveLength(0);
  });

  test("the pins return when the wheel glide arrives, not after the settle wait", async ({ page }) => {
    await openNearby(page);
    const box = await page.locator("#mapCanvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.evaluate(() => {
      window.__arrivedAt = null;
      window.__settledAt = null;
      const wrap = (name, key) => {
        const original = window[name];
        window[name] = function wrapped(...args) { window[key] = performance.now(); return original.apply(this, args); };
      };
      const end = window.endZoomGesture;
      window.endZoomGesture = function recordedEnd(source) {
        const wasLive = zoomGestureLive();
        const result = end.call(this, source);
        if (wasLive && !zoomGestureLive()) window.__arrivedAt = performance.now();
        return result;
      };
      wrap("refreshNearbyRadiusView", "__settledAt");
    });
    await page.mouse.wheel(0, -100);
    await expect.poll(() => page.evaluate(() => window.__settledAt != null)).toBe(true);
    const times = await page.evaluate(() => ({ arrived: window.__arrivedAt, settled: window.__settledAt }));
    expect(times.arrived, "the gesture ended at arrival").not.toBeNull();
    expect(times.settled - times.arrived, "the list waits for the settle timer, the pins do not").toBeGreaterThan(150);
  });

  test("a stuck pinch is ended when the page is hidden: the pins return and the list updates once", async ({ page }) => {
    await openNearby(page);
    await page.evaluate(() => {
      window.__listWrites = 0;
      const original = window.selectOverview;
      window.selectOverview = function countedSelectOverview(...args) { window.__listWrites += 1; return original.apply(this, args); };
    });
    await spreadFingersAcrossFrames(page, { startHalfGap: 160, endHalfGap: 60, steps: 12 });
    await expect.poll(() => page.evaluate(() => zoomGestureLive() && mapPinFadeOpacity() === 0)).toBe(true);
    // The fingers are never lifted and no pointer event follows: the tab goes to the background.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => page.evaluate(() => !zoomGestureLive() && mapPinFadeOpacity() === 1)).toBe(true);
    expect(await page.evaluate(() => window.__listWrites), "the list is updated once").toBe(1);
    expect(await page.evaluate(() => state.activePointers.size), "the lost fingers are forgotten").toBe(0);
  });

  for (const endEvent of ["pointercancel", "lostpointercapture"]) {
    test(`a pinch ended by ${endEvent} brings the pins back and updates the list once`, async ({ page }) => {
      await openNearby(page);
      await page.evaluate(() => {
        window.__listWrites = 0;
        const original = window.selectOverview;
        window.selectOverview = function countedSelectOverview(...args) { window.__listWrites += 1; return original.apply(this, args); };
      });
      await spreadFingersAcrossFrames(page, { startHalfGap: 160, endHalfGap: 60, steps: 12 });
      await expect.poll(() => page.evaluate(() => zoomGestureLive() && mapPinFadeOpacity() === 0)).toBe(true);
      await page.evaluate((type) => {
        for (const id of [5001, 5002]) {
          els.canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, bubbles: true, cancelable: true, pointerType: "touch" }));
        }
      }, endEvent);
      await expect.poll(() => page.evaluate(() => !zoomGestureLive() && mapPinFadeOpacity() === 1)).toBe(true);
      expect(await page.evaluate(() => window.__listWrites)).toBe(1);
      expect(await page.evaluate(() => state.pinchActive)).toBe(false);
    });
  }

  test("a notice shown at the floor is gone after release even when the list is otherwise unchanged", async ({ page }) => {
    await openNearby(page);
    // Start with the ring already at its floor, so the list after release is the one before the squeeze.
    await page.evaluate(() => {
      state.walkingDistanceMinutes = walkingRadiusFloorMinutes(nearbyOrigin());
      selectOverview();
    });
    await waitForUiToSettle(page);
    await page.evaluate(() => {
      window.__noticesAdded = 0;
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.classList && node.classList.contains("walk-radius-floor-notice")) window.__noticesAdded += 1;
        }
      }).observe(els.inspectorBody, { childList: true, subtree: true });
    });
    await spreadFingersAcrossFrames(page, { startHalfGap: 20, endHalfGap: 900, steps: 20 });
    await expect(page.locator(".walk-radius-floor-notice")).toHaveCount(1);
    // Out of the floor and back in again: the one notice is kept, not re-inserted (live region).
    await spreadFingersAcrossFrames(page, { startHalfGap: 900, endHalfGap: 60, steps: 10, press: false });
    await spreadFingersAcrossFrames(page, { startHalfGap: 60, endHalfGap: 900, steps: 10, press: false });
    expect(await page.evaluate(() => window.__noticesAdded), "the notice is inserted once per gesture").toBeLessThanOrEqual(1);
    await liftFingers(page);
    await expect(page.locator(".walk-radius-floor-notice")).toHaveCount(0);
  });

  test("the ring is painted in the same frame the pinch applies it", async ({ page }) => {
    await openNearby(page);
    await page.evaluate(() => {
      window.__ringMinutes = [];
      const original = window.drawWalkingRadius;
      window.drawWalkingRadius = function recordedRing(...args) {
        window.__ringMinutes.push(state.walkingDistanceMinutes);
        return original.apply(this, args);
      };
    });
    await spreadFingersAcrossFrames(page, { startHalfGap: 160, endHalfGap: 150, steps: 1 });
    const result = await page.evaluate(async () => {
      const canvas = els.canvas;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const move = (id, x) => canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: id, clientX: x, clientY: cy, bubbles: true, cancelable: true, pointerType: "touch" }));
      window.__ringMinutes.length = 0;
      move(5001, cx - 80);
      move(5002, cx + 80);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return { drawn: window.__ringMinutes.slice(), applied: state.walkingDistanceMinutes };
    });
    expect(result.drawn.length, "the ring was painted within the frame of the move").toBeGreaterThan(0);
    expect(result.drawn[result.drawn.length - 1], "and shows the latest pinch radius").toBe(result.applied);
    await liftFingers(page);
  });

  test("after a wheel glide arrives, the settle does not move the camera or regroup the pins", async ({ page }) => {
    await openNearby(page);
    const box = await page.locator("#mapCanvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.evaluate(() => {
      window.__cameraMoves = 0;
      window.__afterArrival = false;
      const move = window.moveCamera;
      window.moveCamera = function countedMove(...args) { if (window.__afterArrival) window.__cameraMoves += 1; return move.apply(this, args); };
      const end = window.endZoomGesture;
      window.endZoomGesture = function recordedEnd(source) {
        const result = end.call(this, source);
        if (!zoomGestureLive()) window.__afterArrival = true;
        return result;
      };
      window.__markerCounts = [];
    });
    await page.mouse.wheel(0, -100);
    await expect.poll(() => page.evaluate(() => window.__afterArrival)).toBe(true);
    await page.evaluate(() => {
      const sample = () => { window.__markerCounts.push(buildActiveMapMarkers(worldToScreen, false).length); window.__sampling = requestAnimationFrame(sample); };
      sample();
    });
    await expect.poll(() => page.evaluate(() => !state.wheelRadiusSettleTimer && state.wheelRadiusTargetMinutes == null)).toBe(true);
    await waitForUiToSettle(page);
    const result = await page.evaluate(() => { cancelAnimationFrame(window.__sampling); return { moves: window.__cameraMoves, counts: window.__markerCounts }; });
    expect(new Set(result.counts).size, `pin/cluster count stays put through the settle ${JSON.stringify(result.counts)}`).toBe(1);
    expect(result.moves, "the settle refit does not move the camera after the reveal").toBe(0);
  });

  test("squeezing the ring to its floor shows the limit notice without re-rendering the list", async ({ page }) => {
    await openNearby(page);
    await page.evaluate(() => {
      window.__listWrites = 0;
      const original = window.selectOverview;
      window.selectOverview = function countedSelectOverview(...args) { window.__listWrites += 1; return original.apply(this, args); };
    });
    await spreadFingersAcrossFrames(page, { startHalfGap: 20, endHalfGap: 900, steps: 30 });
    await expect(page.locator(".walk-radius-floor-notice")).toBeVisible();
    expect(await page.evaluate(() => window.__listWrites), "the notice is patched in place, the list is not re-rendered").toBe(0);
    await liftFingers(page);
    await expect(page.locator(".walk-radius-floor-notice")).toHaveCount(0);
    expect(await page.evaluate(() => window.__listWrites), "the list is swapped once, at the end").toBe(1);
  });

  test("a pinch is a hard hide and show, with no fades, when the user prefers reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openNearby(page);
    await page.evaluate(() => { window.__pins.length = 0; });
    await spreadFingersAcrossFrames(page, { startHalfGap: 20, endHalfGap: 120, steps: 6 });
    expect(await page.evaluate(() => mapPinFadeOpacity()), "hidden straight away, no fade").toBe(0);
    await liftFingers(page);
    await expect.poll(() => page.evaluate(() => mapPinFadeOpacity())).toBe(1);
    await waitForFrames(page, 3);
    const pins = await page.evaluate(() => window.__pins);
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every((pin) => pin.fade === 1), "pins appear only at full gesture opacity").toBe(true);
  });
});

test.describe("The map-scale wheel zoom hides the pins the same way", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"], reducedMotion: "no-preference" });

  test("with no radius to resize (a selection or search is open) a run of wheel notches is one hide and one reveal", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
    await waitForUiToSettle(page);
    await recordPaintedPins(page);
    await trackPinFade(page);
    // Without a location fix the wheel zooms the map scale (zoomAt) instead of resizing the radius.
    await page.evaluate(() => { state.userLocation = null; requestDraw(); });
    await waitForFrames(page, 3);
    expect(await page.evaluate(() => zoomInputResizesNearbyRadius()), "sanity: this is the map-scale wheel").toBe(false);
    await page.evaluate(() => { window.__pins.length = 0; });
    const box = await page.locator("#mapCanvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    for (let notch = 0; notch < 5; notch += 1) {
      await page.mouse.wheel(0, -100);
      await waitForFrames(page, 2);
    }
    await expect.poll(() => page.evaluate(() => !zoomGestureLive() && mapPinFadeOpacity() === 1)).toBe(true);
    expect(await lowestPinFade(page), "the pins faded all the way out while the map zoomed").toBe(0);
    const pins = await page.evaluate(() => window.__pins);
    expectOneHideOneReveal(pins);
  });
});

test.describe("Panning keeps the pins and does not recalculate them", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test("dragging the map moves the existing pins with the ground and never regroups them", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
    await waitForUiToSettle(page);
    await recordPaintedPins(page);
    await page.evaluate(() => { stopViewportAnimation(); requestDraw(); });
    await waitForFrames(page, 3);

    const box = await page.locator("#mapCanvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await page.evaluate(() => { window.__markerBuilds = 0; window.__pins.length = 0; });
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(box.x + box.width * 0.5 - i * 6, box.y + box.height * 0.3 + i * 3);
      await waitForFrames(page, 1);
    }
    const dragging = await page.evaluate(() => {
      const markers = buildActiveMapMarkers(worldToScreen, false);
      return {
        builds: window.__markerBuilds,
        painted: window.__pins.length,
        live: zoomGestureLive(),
        offsets: markers.map((marker) => {
          const ground = worldToScreen(marker.worldPt);
          return Math.hypot(marker.screenPt.x - ground.x, marker.screenPt.y - ground.y);
        }),
        count: markers.length,
      };
    });
    await page.mouse.up();

    expect(dragging.live, "a pan is not a zoom gesture").toBe(false);
    expect(dragging.painted, "pins stay visible while panning").toBeGreaterThan(0);
    expect(dragging.builds, "panning translates the existing marker layout instead of rebuilding it").toBe(0);
    expect(dragging.count).toBeGreaterThan(0);
    for (const offset of dragging.offsets) expect(offset, "each pin sits on its own ground after the pan").toBeLessThan(0.01);
  });
});
