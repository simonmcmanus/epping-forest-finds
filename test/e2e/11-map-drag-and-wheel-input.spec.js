// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap, FIXTURE_TREE, waitForFrames } = require("./helpers");

// A GPS fix inside Epping Forest, reused from 09-location.spec.js / 10-secondary-screen-camera.spec.js.
// Genuinely inside the forest boundary polygon (see data/epping-forest-land.geojson), so
// updateFarFromForest() never raises the far-from-the-forest notice for these tests.
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

// A client point on genuinely open ground, near (0.5, 0.3) of the map: the first candidate on a
// small grid that none of the app's own tap tests (handleMapClick's order: group, pin or line,
// label) reports anything at, and that is clear of the inspector panel. Which pixels are open
// depends on how the markers grouped, so a fixed point is not safe. Fails loudly if none is.
async function findOpenGroundPoint(page, box) {
  const point = await page.evaluate(({ box }) => {
    const panel = document.querySelector("#inspector")?.getBoundingClientRect();
    for (const dy of [0, -0.05, 0.05, -0.1, 0.1, 0.15]) {
      for (const dx of [0, 0.05, -0.05, 0.1, -0.1, 0.15, -0.15, 0.2, -0.2]) {
        const clientX = box.x + box.width * (0.5 + dx), clientY = box.y + box.height * (0.3 + dy);
        if (panel && clientX > panel.left - 24 && clientX < panel.right + 24 && clientY > panel.top - 24 && clientY < panel.bottom + 24) continue;
        const screen = canvasPoint({ clientX, clientY });
        const world = screenToWorld(screen.x, screen.y);
        if (findClusterHit(screen)) continue;
        if (findHit(screen, world).type !== "none") continue;
        if (findMapLabelHit(screen)) continue;
        return { clientX, clientY };
      }
    }
    return null;
  }, { box });
  expect(point, "an open-ground point exists on the settled map").not.toBeNull();
  return point;
}

async function dragCanvas(page, from, to, steps = 4) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several intermediate steps so pointermove fires more than once, like a real drag.
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  }
  await page.mouse.up();
}

// Regression coverage for a bug where dragging the map while the camera auto-repositions
// (a selected navigation target with the inspector expanded, or heading-up mode) was
// indistinguishable from a stationary tap once the pointer lifted. state.moved was only
// ever set inside the plain-pan branch of the pointermove handler in js/nav.js; the
// heading-up and auto-reposition branches returned early without touching it. So after a
// real drag in either mode, pointerup's `wasClick = !state.moved` was still true and fired
// handleMapClick -- selecting whatever was under the release point, or resetting the camera
// via goToInitialView() -- even though the user only meant to pan or inspect the map.
test.describe("Map drag input while camera auto-repositions", () => {
  test.use({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
  });

  test("dragging while auto-repositioning to a selected target keeps the selection", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`, { suppressAdventure: true });
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    // Desktop viewport (see playwright.config.js) keeps the inspector expanded after a
    // selection, so shouldAutoRepositionSelection() is active during this drag.
    await expect(page.locator("#inspector")).not.toHaveClass(/minimized/);
    const autoRepositioning = await page.evaluate(() => shouldAutoRepositionSelection());
    expect(autoRepositioning).toBe(true);

    const box = await page.locator("#mapCanvas").boundingBox();
    await dragCanvas(
      page,
      { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 },
      { x: box.x + box.width * 0.7, y: box.y + box.height * 0.6 }
    );

    const after = await page.evaluate(() => ({
      moved: state.moved,
      selectedType: state.selected && state.selected.type,
    }));
    expect(after.moved).toBe(true);
    expect(after.selectedType).toBe("tree");
    // Previously this drag fell through to handleMapClick -> goToInitialView(), reverting
    // the inspector to the Nearby overview instead of leaving the tree selected.
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
  });

  test("dragging in nearby heading-up mode does not register as a stationary tap", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, "/nearby", { suppressAdventure: true });
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await page.evaluate(() => {
      state.compassHeading = 90;
      state.compassHeadingTarget = 90;
      alignHeadingUpNavigationViewport({ force: true });
    });
    await waitForFrames(page, 3);
    expect(await page.evaluate(() => headingUpActive())).toBe(true);

    const box = await page.locator("#mapCanvas").boundingBox();
    await dragCanvas(
      page,
      { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25 },
      { x: box.x + box.width * 0.75, y: box.y + box.height * 0.7 }
    );

    const after = await page.evaluate(() => ({ moved: state.moved, selected: state.selected }));
    expect(after.moved).toBe(true);
    // No pin should have been picked up by a spurious click at the release point, and the
    // overview should not have been reset by an unwanted goToInitialView() call.
    expect(after.selected).toBeNull();
    await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
  });
});

// The wheel is a laptop's version of the phone's two-finger radius pinch: on every screen that
// draws the walking-radius ring it resizes that ring, and the camera follows because the Nearby
// fit frames the ring and nothing else. It must never apply a raw pointer-anchored zoom on top
// of that -- the original bug here was zoomAt() multiplying the scale before deferring to
// alignHeadingUpNavigationViewport(), so wheel input settled at an unpredictable value.
test.describe("Wheel and trackpad input on the Nearby screen", () => {
  test.use({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
  });

  async function openNearbyHeadingUp(page) {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, "/nearby", { suppressAdventure: true });
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await page.evaluate(() => {
      state.compassHeading = 90;
      state.compassHeadingTarget = 90;
      alignHeadingUpNavigationViewport({ force: true });
    });
    return page.locator("#mapCanvas").boundingBox();
  }

  // The radius gesture ends on a timeout and settles the camera with an animation, so the scale
  // is only meaningful once it has stopped moving.
  async function settledScale(page) {
    await expect.poll(() => page.evaluate(() => (
      state.wheelRadiusSettleTimer == null && state.viewportAnimationFrame == null
    ))).toBe(true);
    let previous = null;
    await expect.poll(async () => {
      const scale = await page.evaluate(() => state.viewport.scale);
      const stable = previous !== null && Math.abs(scale - previous) < previous * 0.0005;
      previous = scale;
      return stable;
    }).toBe(true);
    return previous;
  }

  test("scrolling the wheel zooms by resizing the walking radius, both ways", async ({ page }) => {
    const box = await openNearbyHeadingUp(page);
    const before = await page.evaluate(() => state.walkingDistanceMinutes);
    const beforeScale = await settledScale(page);

    // Well away from the user's on-screen anchor point (but still over the map, not the chrome
    // around it): a raw pointer-anchored zoom would move the viewport away from the ring's own
    // fit, while resizing the ring does not care where the cursor is.
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.mouse.wheel(0, -600);

    await expect.poll(() => page.evaluate(() => state.walkingDistanceMinutes)).toBeLessThan(before);
    const zoomedInScale = await settledScale(page);
    expect(zoomedInScale).toBeGreaterThan(beforeScale);

    // The camera is the ring's locked fit, not a raw multiply: re-running that fit moves nothing.
    const refit = await page.evaluate(() => {
      alignHeadingUpNavigationViewport({ force: true });
      return state.viewport.scale;
    });
    expect(Math.abs(refit - zoomedInScale)).toBeLessThan(zoomedInScale * 0.01);

    // And scrolling the other way widens the ring again.
    const tight = await page.evaluate(() => state.walkingDistanceMinutes);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => state.walkingDistanceMinutes)).toBeGreaterThan(tight);
    expect(await settledScale(page)).toBeLessThan(zoomedInScale);
  });

  test("a laptop trackpad pinch resizes the radius the same way", async ({ page }) => {
    const box = await openNearbyHeadingUp(page);
    const before = await page.evaluate(() => state.walkingDistanceMinutes);

    // Every desktop browser reports a trackpad pinch as a wheel with ctrlKey set, in deltas far
    // smaller than a wheel notch -- which is why the gesture accumulates its own running value.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    for (let i = 0; i < 8; i += 1) await page.mouse.wheel(0, -8);
    await page.keyboard.up("Control");

    await expect.poll(() => page.evaluate(() => state.walkingDistanceMinutes)).toBeLessThan(before);
  });

  test("with a location selected the wheel still zooms the map itself", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`, { suppressAdventure: true });
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);

    // The hash deep-link forces the inspector open and animates the camera to fit user + target
    // (~520ms), so the scale here is still in transit. Read raw, before.scale can catch a
    // mid-animation value well above where the camera settles -- CI caught 36386 against a
    // settled 17470 -- and the wheel's zoom-in from the settled scale then never exceeds it.
    // Same settling the sibling wheel tests above already use.
    const before = {
      minutes: await page.evaluate(() => state.walkingDistanceMinutes),
      scale: await settledScale(page),
    };
    const box = await page.locator("#mapCanvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);

    await expect.poll(() => page.evaluate(() => state.viewport.scale)).toBeGreaterThan(before.scale);
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(before.minutes);
  });
});

// Dragging the map while it is anchored on the user (the Nearby view with a GPS fix, or heading-up
// navigation) is there to show the map is not broken: it follows the pointer 1:1, and once it is
// let go it eases back to the framing it is anchored on. Neither a GPS fix nor a compass tick may
// pull it back while it is still held.
test.describe("Dragging an anchored map", () => {
  test.use({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
  });

  async function openNearby(page, { headingUp }) {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, "/nearby", { suppressAdventure: true });
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    if (headingUp) {
      await page.evaluate(() => {
        state.compassHeading = 90;
        state.compassHeadingTarget = 90;
        alignHeadingUpNavigationViewport({ force: true });
      });
      await waitForFrames(page, 3);
    }
    await viewportAtRest(page);
    return page.locator("#mapCanvas").boundingBox();
  }

  async function viewportAtRest(page) {
    let previous = "";
    await expect.poll(async () => {
      const now = await page.evaluate(() => (
        state.viewportAnimationFrame == null
          ? [state.viewport.scale, state.viewport.tx, state.viewport.ty].join(",")
          : ""
      ));
      const stable = now !== "" && now === previous;
      previous = now;
      return stable;
    }).toBe(true);
  }

  const userOnScreen = (page) => page.evaluate(() => {
    const p = worldToScreen(state.userLocation.point);
    return { x: p.x, y: p.y };
  });

  async function dragAndHold(page, box, dx, dy) {
    const from = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.4 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + (dx * i) / 6, from.y + (dy * i) / 6);
  }

  for (const headingUp of [false, true]) {
    const mode = headingUp ? "heading-up" : "north-up";

    test(`the ${mode} Nearby map follows the pointer while it is held`, async ({ page }) => {
      const box = await openNearby(page, { headingUp });
      const before = await userOnScreen(page);

      await dragAndHold(page, box, 120, 70);
      await waitForFrames(page, 3);

      const held = await userOnScreen(page);
      // Device pixels, not CSS: the canvas scales by devicePixelRatio, so compare in the units
      // the pointer moved in.
      const dpr = await page.evaluate(() => pixelRatio());
      expect((held.x - before.x) / dpr).toBeGreaterThan(110);
      expect((held.y - before.y) / dpr).toBeGreaterThan(60);
      await page.mouse.up();
    });

    test(`the ${mode} Nearby map eases back to its anchor on release and stays there`, async ({ page, context }) => {
      const box = await openNearby(page, { headingUp });
      const anchor = await userOnScreen(page);

      await dragAndHold(page, box, -140, -90);
      await waitForFrames(page, 2);
      const away = await userOnScreen(page);
      expect(Math.abs(away.x - anchor.x)).toBeGreaterThan(50);
      await page.mouse.up();

      await expect.poll(async () => {
        const now = await userOnScreen(page);
        return Math.hypot(now.x - anchor.x, now.y - anchor.y);
      }).toBeLessThan(4);
      await viewportAtRest(page);

      // A later GPS fix moves the user a few metres; it must not send the camera back to where the
      // drag left it (well over a hundred pixels away).
      const fixBefore = await page.evaluate(() => state.userLocation.point.y);
      await context.setGeolocation({ ...FOREST_LOCATION, latitude: FOREST_LOCATION.latitude + 0.0003 });
      await expect.poll(() => page.evaluate(() => state.userLocation.point.y)).not.toBe(fixBefore);
      await waitForFrames(page, 4);
      await viewportAtRest(page);
      const after = await userOnScreen(page);
      expect(Math.hypot(after.x - anchor.x, after.y - anchor.y)).toBeLessThan(60);
    });

    test(`a GPS fix does not pull the ${mode} map back while it is held`, async ({ page, context }) => {
      const box = await openNearby(page, { headingUp });
      const anchor = await userOnScreen(page);
      await dragAndHold(page, box, 150, 100);
      await waitForFrames(page, 2);
      const held = await userOnScreen(page);
      expect(Math.hypot(held.x - anchor.x, held.y - anchor.y), "the drag moved the map").toBeGreaterThan(100);

      const fixBefore = await page.evaluate(() => state.userLocation.point.y);
      await context.setGeolocation({ ...FOREST_LOCATION, latitude: FOREST_LOCATION.latitude + 0.0006 });
      await expect.poll(() => page.evaluate(() => state.userLocation.point.y)).not.toBe(fixBefore);
      await waitForFrames(page, 8);

      const now = await userOnScreen(page);
      const dpr = await page.evaluate(() => pixelRatio());
      // The fix itself moves the user on the map by a few metres; what must not happen is the
      // camera sliding back across the 150px that was dragged.
      expect(Math.hypot(now.x - held.x, now.y - held.y) / dpr).toBeLessThan(60);
      await page.mouse.up();
    });
  }
});

test.describe("Anchored drag edge cases", () => {
  test.use({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
  });

  async function openAnchoredNearby(page) {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, "/nearby", { suppressAdventure: true });
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await expect.poll(() => page.evaluate(() => state.viewportAnimationFrame == null)).toBe(true);
    await waitForFrames(page, 4);
    return page.locator("#mapCanvas").boundingBox();
  }

  const userOnScreen = (page) => page.evaluate(() => {
    const p = worldToScreen(state.userLocation.point);
    return { x: p.x, y: p.y };
  });

  test("a press that never becomes a drag still lets a GPS fix re-anchor the map", async ({ page, context }) => {
    const box = await openAnchoredNearby(page);
    const anchor = await userOnScreen(page);
    // The camera is off its anchor when the finger lands (as after a pan).
    await page.evaluate(() => { state.viewport.ty += 220; requestDraw(); });
    await waitForFrames(page, 2);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height * 0.4 + 1);
    const fixBefore = await page.evaluate(() => state.userLocation.point.y);
    await context.setGeolocation({ ...FOREST_LOCATION, latitude: FOREST_LOCATION.latitude + 0.0006 });
    await expect.poll(() => page.evaluate(() => state.userLocation.point.y)).not.toBe(fixBefore);
    await page.mouse.up();

    await expect.poll(async () => {
      const now = await userOnScreen(page);
      return Math.hypot(now.x - anchor.x, now.y - anchor.y);
    }).toBeLessThan(80);
  });

  test("scrolling the wheel while the anchored map is held leaves the radius alone", async ({ page }) => {
    const box = await openAnchoredNearby(page);
    const before = await page.evaluate(() => state.walkingDistanceMinutes);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height * 0.4 + 50, { steps: 4 });
    await page.mouse.wheel(0, -300);
    await waitForFrames(page, 8);
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(before);
    await page.mouse.up();
  });

  test("pressing the map ends a wheel zoom that is still gliding", async ({ page }) => {
    const box = await openAnchoredNearby(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
    await page.mouse.wheel(0, -600);
    await page.mouse.down();
    const atPress = await page.evaluate(() => state.walkingDistanceMinutes);
    await waitForFrames(page, 8);
    expect(await page.evaluate(() => state.walkingDistanceMinutes), "the ring stops under the finger").toBe(atPress);
    expect(await page.evaluate(() => state.wheelRadiusTargetMinutes), "the wheel gesture has ended").toBeNull();
    await page.mouse.up();
  });

  test("pressing and releasing mid-glide leaves the camera on the final radius's framing", async ({ page }) => {
    const box = await openAnchoredNearby(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
    await page.mouse.wheel(0, -600);
    const gliding = await page.evaluate(() => (
      state.wheelRadiusTargetMinutes != null && state.walkingDistanceMinutes > state.wheelRadiusTargetMinutes
    ));
    expect(gliding, "the press lands while the radius is still gliding").toBe(true);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (
      state.wheelRadiusSettleTimer == null && state.viewportAnimationFrame == null && state.wheelRadiusTargetMinutes == null
    ))).toBe(true);
    await waitForFrames(page, 10);
    const result = await page.evaluate(() => {
      const settled = { ...state.viewport };
      alignHeadingUpNavigationViewport({ force: true });
      return { settled, refit: { ...state.viewport } };
    });
    expect(Math.abs(result.settled.scale / result.refit.scale - 1)).toBeLessThan(0.01);
    expect(Math.abs(result.settled.tx - result.refit.tx)).toBeLessThan(3);
    expect(Math.abs(result.settled.ty - result.refit.ty)).toBeLessThan(3);
  });

  test("a second finger ends the anchored hold", async ({ page }) => {
    await openAnchoredNearby(page);
    const held = await page.evaluate(() => {
      const canvas = els.canvas;
      canvas.setPointerCapture = () => {};
      canvas.releasePointerCapture = () => {};
      const rect = canvas.getBoundingClientRect();
      const fire = (type, id, dx) => canvas.dispatchEvent(new PointerEvent(type, {
        pointerId: id, clientX: rect.left + rect.width / 2 + dx, clientY: rect.top + rect.height / 2,
        bubbles: true, cancelable: true, pointerType: "touch",
      }));
      fire("pointerdown", 4001, 0);
      fire("pointermove", 4001, 30);
      const whileDragging = state.anchoredDragHold;
      fire("pointerdown", 4002, 80);
      const afterSecond = state.anchoredDragHold;
      fire("pointerup", 4002, 80);
      fire("pointerup", 4001, 30);
      return { whileDragging, afterSecond, finally: state.anchoredDragHold };
    });
    expect(held).toEqual({ whileDragging: true, afterSecond: false, finally: false });
  });

  test("a tap leaves no drag hold behind on the anchored map (leak guard)", async ({ page }) => {
    const box = await openAnchoredNearby(page);
    const tap = await findOpenGroundPoint(page, box);
    await page.mouse.click(tap.clientX, tap.clientY);
    const after = await page.evaluate(() => ({ hold: state.anchoredDragHold, moved: state.moved, dragging: state.dragging }));
    expect(after).toEqual({ hold: false, moved: false, dragging: false });
    await waitForFrames(page, 10);
    expect(await page.evaluate(() => state.anchoredDragHold)).toBe(false);
  });

  test("tapping open ground on the anchored Nearby map previews that spot", async ({ page }) => {
    const box = await openAnchoredNearby(page);
    expect(await page.evaluate(() => state.nearbyAnchor)).toBeFalsy();
    const tap = await findOpenGroundPoint(page, box);
    await page.mouse.click(tap.clientX, tap.clientY);
    // handleMapClick on open ground sets a browse anchor (the Nearby view moves to that spot).
    await expect.poll(() => page.evaluate(() => Boolean(state.nearbyAnchor))).toBe(true);
    expect(await page.evaluate(() => state.selected)).toBeNull();
  });
});

// A wheel or trackpad stream must glide the camera rather than teleporting it on every event.
test.describe("Wheel zoom on the Nearby screen glides", () => {
  test.use({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
  });

  test("a single wheel notch zooms in over several frames and reaches its target", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page, "/nearby", { suppressAdventure: true });
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await expect.poll(() => page.evaluate(() => state.viewportAnimationFrame == null)).toBe(true);
    await waitForFrames(page, 4);
    const box = await page.locator("#mapCanvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);

    const start = await page.evaluate(() => {
      window.__scaleFrames = [];
      const sample = () => {
        window.__scaleFrames.push(state.viewport.scale);
        window.__scaleSampler = requestAnimationFrame(sample);
      };
      sample();
      return state.viewport.scale;
    });
    await page.mouse.wheel(0, -100);
    await expect.poll(() => page.evaluate(() => (
      state.wheelRadiusSettleTimer == null && state.viewportAnimationFrame == null
        && state.viewport.scale > window.__scaleFrames[0] * 1.1
    ))).toBe(true);
    await waitForFrames(page, 20);
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.__scaleSampler);
      return window.__scaleFrames;
    });

    let largestStep = 1;
    let movingFrames = 0;
    for (let i = 1; i < frames.length; i++) {
      const ratio = Math.max(frames[i] / frames[i - 1], frames[i - 1] / frames[i]);
      largestStep = Math.max(largestStep, ratio);
      if (ratio > 1.001) movingFrames++;
    }
    const final = frames[frames.length - 1];
    expect(final / start, "one notch zooms in by about a notch").toBeGreaterThan(1.1);
    expect(largestStep, "no single frame carries the whole notch").toBeLessThan(1.1);
    expect(movingFrames, "the zoom is spread across frames").toBeGreaterThanOrEqual(3);
  });
});
