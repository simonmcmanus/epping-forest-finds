// @ts-check
// Every change between map states is one continuous move in 3D, including when the target is behind
// the user. Whichever way a place is reached (tap on the map, a Nearby list row, a deep link, history
// forward) the end viewport is the same, the place is inside the visible map area above the inspector,
// and the move never throws the place off screen and back.
const { test, expect } = require("@playwright/test");
const { setup, tapCanvasPoint, waitForUiToSettle, waitForFrames } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6538, longitude: 0.0400, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "no-preference" }); });

/** Heading-up 3D, phone held facing north, so a place to the south is behind the user and one to the north is ahead. */
async function hold3d(page) {
  await page.evaluate(() => {
    state.map3dEnabled = true;
    state.compassHeadingTarget = 0;
    state.compassHeading = 0;
    state.renderedNavigationHeading = 0;
    state.tiltBetaTarget = 60;
    state.tiltBetaSmoothed = 60;
    window.__keepCompassFresh = setInterval(() => { state.compassLastEventAt = performance.now(); }, 50);
    state.compassLastEventAt = performance.now();
  });
}

/**
 * Holds the phone up in 3D facing north and opens a non-cow place from the Nearby list (listed rows are
 * the ones ahead), learns its link, then returns to Nearby. For `behind`, the user then turns to face
 * south so the same place is behind them, as happens when a link or history entry is followed after
 * turning round: the list and the map hide what is behind in 3D, so those are only reachable ahead.
 */
async function arrangeNearby(page, { behind }) {
  await setup(page, "/nearby");
  await hold3d(page);
  await waitForUiToSettle(page);
  const row = page.locator("#inspectorBody [data-overview-type]:not([data-overview-type=cow])[data-overview-key]").first();
  await expect(row).toBeVisible();
  const type = await row.getAttribute("data-overview-type");
  const key = await row.getAttribute("data-overview-key");
  await row.click();
  await page.waitForFunction(() => Boolean(state.selected));
  // The walking route a fit frames depends on whether the routing graph has finished building (selecting
  // a place starts it), so a comparison between routes only means something once it has.
  await page.waitForFunction(() => state.routingGraphReady === true, null, { timeout: 30000 });
  await waitForUiToSettle(page);
  const path = await page.evaluate(() => {
    window.__placeItem = selectedCompassTarget();
    return location.pathname + location.search + location.hash;
  });
  await page.evaluate(() => navigateInApp("/nearby"));
  await page.waitForFunction(() => !state.selected);
  await waitForUiToSettle(page);
  if (behind) {
    await page.evaluate(() => {
      const target = window.__placeItem;
      const user = state.userLocation.point;
      const bearing = (Math.atan2(target.point.x - user.x, -(target.point.y - user.y)) * 180 / Math.PI + 360) % 360;
      const heading = (bearing + 180) % 360;
      state.compassHeadingTarget = heading;
      state.compassHeading = heading;
      state.renderedNavigationHeading = heading;
    });
    await waitForUiToSettle(page);
  }
  expect(await page.evaluate(() => tiltActive()), "3D tilt is on").toBe(true);
  expect(await page.evaluate(() => nearbyHeadingUpActive()), "heading-up is on").toBe(true);
  return { type, key, path };
}

async function startFrameTrace(page) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__moveCount = 0;
    if (!window.__moveWrapped) {
      window.__moveWrapped = true;
      const original = window.moveCamera;
      window.moveCamera = function (...args) { window.__moveCount += 1; return original.apply(this, args); };
    }
    const sample = () => {
      const target = state.selected ? selectedCompassTarget() : null;
      let inView = null;
      let tilted = null;
      if (target && target.point) {
        const rect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
        const p = worldToScreen(target.point);
        inView = Number.isFinite(p.x) && Number.isFinite(p.y)
          && p.x >= 0 && p.y >= 0 && p.x <= els.canvas.width && p.y <= els.canvas.height
          && !(rect.width <= 0);
      }
      tilted = tiltActive();
      window.__frames.push({ inView, tilted, scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty });
      window.__frameTraceRaf = requestAnimationFrame(sample);
    };
    sample();
  });
}

async function stopFrameTrace(page) {
  return page.evaluate(() => {
    cancelAnimationFrame(window.__frameTraceRaf);
    const frames = window.__frames;
    frames.moves = window.__moveCount;
    return { frames, moves: window.__moveCount };
  });
}

// Largest single-frame step as a share of the whole path the camera travelled (scale in log terms, then
// pan), so a mid-move snap to a different framing stands out from an eased move however many frames ran.
function stepShare(frames) {
  const path = (a, b) => Math.abs(Math.log(b.scale / a.scale)) * 400 + Math.hypot(b.tx - a.tx, b.ty - a.ty) / Math.max(1, b.scale) * 0;
  let total = 0;
  let biggest = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const d = path(frames[i - 1], frames[i]);
    total += d;
    biggest = Math.max(biggest, d);
  }
  return total > 0 ? biggest / total : 0;
}

/** Where the camera ended and whether the place sits in the visible map area above the open inspector. */
async function endState(page) {
  await waitForUiToSettle(page);
  await waitForFrames(page, 3);
  return page.evaluate(() => {
    const rect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
    const target = selectedCompassTarget();
    const p = target ? worldToScreen(target.point) : null;
    return {
      selected: Boolean(state.selected),
      scale: state.viewport.scale,
      tx: state.viewport.tx,
      ty: state.viewport.ty,
      place: p,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      inRect: Boolean(p) && p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height,
    };
  });
}

function expectSameViewport(a, b, label) {
  expect(Math.abs(a.scale - b.scale) / b.scale, `${label}: scale`).toBeLessThan(0.03);
  expect(Math.abs(a.tx - b.tx), `${label}: tx`).toBeLessThan(6);
  expect(Math.abs(a.ty - b.ty), `${label}: ty`).toBeLessThan(6);
}

function expectNoLeaveAndReturn(frames, label, moves) {
  const views = frames.filter((f) => f.inView !== null).map((f) => f.inView);
  expect(frames.filter((f) => !f.tilted).length, `${label}: 3D stays on for the whole move (no flat fit mid-move)`).toBe(0);
  expect(views.length, `${label}: sampled`).toBeGreaterThan(5);
  // On screen at some point is allowed to start off screen (it comes into view), but once it is
  // on screen it must not leave and come back: that is a second move.
  const firstOn = views.indexOf(true);
  expect(firstOn, `${label}: the place comes into view`).toBeGreaterThanOrEqual(0);
  expect(views.slice(firstOn).filter((v) => !v), `${label}: the place stays in view once seen`).toEqual([]);
}

async function openByList(page, place) {
  await page.locator(`#inspectorBody [data-overview-type=${JSON.stringify(place.type)}][data-overview-key=${JSON.stringify(place.key)}]`).first().click();
}

for (const behind of [true, false]) {
  const where = behind ? "behind the user" : "ahead of the user";
  test.describe(`3D selection transitions, place ${where}`, () => {
    test(`a Nearby list pick, a deep link and history forward end on the same view with the place in the map area (${where})`, async ({ page }) => {
      const place = await arrangeNearby(page, { behind });

      await startFrameTrace(page);
      await page.evaluate((path) => navigateInApp(path), place.path);
      await page.waitForFunction(() => Boolean(state.selected));
      const deepLink = await endState(page);
      const { frames: deepFrames, moves: deepFramesMoves } = await stopFrameTrace(page);
      expect(deepLink.inRect, `deep link: place ${JSON.stringify(deepLink.place)} in ${JSON.stringify(deepLink.rect)}`).toBe(true);
      expectNoLeaveAndReturn(deepFrames, "deep link", deepFramesMoves);

      await page.evaluate(() => navigateInApp("/nearby"));
      await page.waitForFunction(() => !state.selected);
      await waitForUiToSettle(page);

      if (!behind) {
        await startFrameTrace(page);
        await openByList(page, place);
        await page.waitForFunction(() => Boolean(state.selected));
        const list = await endState(page);
        const { frames: listFrames, moves: listFramesMoves } = await stopFrameTrace(page);
        expect(list.inRect, `list: place ${JSON.stringify(list.place)} in ${JSON.stringify(list.rect)}`).toBe(true);
        expectNoLeaveAndReturn(listFrames, "list", listFramesMoves);
        expectSameViewport(list, deepLink, "list vs deep link");

        await page.goBack();
        await page.waitForFunction(() => !state.selected);
        await waitForUiToSettle(page);
      } else {
        // Behind the user the place is in no list row and has no pin; history is how a user gets back to it.
        await page.goBack();
        await page.waitForFunction(() => Boolean(state.selected));
        await waitForUiToSettle(page);
        await page.goBack();
        await page.waitForFunction(() => !state.selected);
        await waitForUiToSettle(page);
      }

      await startFrameTrace(page);
      await page.goForward();
      await page.waitForFunction(() => Boolean(state.selected));
      const forward = await endState(page);
      const { frames: forwardFrames, moves: forwardFramesMoves } = await stopFrameTrace(page);
      expect(forward.inRect, `forward: place ${JSON.stringify(forward.place)} in ${JSON.stringify(forward.rect)}`).toBe(true);
      expectNoLeaveAndReturn(forwardFrames, "forward", forwardFramesMoves);
      expectSameViewport(forward, deepLink, "forward vs deep link");
    });

    if (!behind) test(`a tap on the place on the map ends on the same view as a deep link (${where})`, async ({ page }) => {
      const place = await arrangeNearby(page, { behind });
      await page.evaluate((path) => navigateInApp(path), place.path);
      await page.waitForFunction(() => Boolean(state.selected));
      const deepLink = await endState(page);
      await page.evaluate(() => navigateInApp("/nearby"));
      await page.waitForFunction(() => !state.selected);
      await waitForUiToSettle(page);

      // Tap exactly where the pin for this place is drawn. Zoom the Nearby ring in the place's favour is
      // not needed: the pin must be reachable from the ring view the user is looking at.
      const pin = await page.evaluate((path) => {
        const dpr = pixelRatio();
        const markers = buildActiveMapMarkers(worldToScreenForOverlayTilted, true);
        const item = window.__placeItem;
        const hit = markers.find((m) => m.items.length === 1 && m.items[0] === item)
          || markers.find((m) => m.items.includes(item));
        if (!hit) return null;
        const head = MAP_PNG_ICON_SIZE * dpr * mapMarkerPinScale(item, true) * MAP_ICON_SCALE_UNSELECTED * 0.416;
        return { x: hit.screenPt.x, y: hit.screenPt.y - head, grouped: hit.items.length > 1, dpr };
      }, place.path);
      expect(pin, "the place has a pin in the Nearby view").not.toBeNull();
      expect(pin.grouped, "the pin is tapped on its own, not inside a group").toBe(false);

      await startFrameTrace(page);
      await tapCanvasPoint(page, pin);
      await page.waitForFunction(() => Boolean(state.selected));
      const tap = await endState(page);
      const { frames: frames, moves: framesMoves } = await stopFrameTrace(page);
      expect(tap.inRect, `tap: place ${JSON.stringify(tap.place)} in ${JSON.stringify(tap.rect)}`).toBe(true);
      expectNoLeaveAndReturn(frames, "tap", framesMoves);
      expectSameViewport(tap, deepLink, "tap vs deep link");
    });

    test(`leaving the place to Nearby is one move back to the overview view (${where})`, async ({ page }) => {
      const place = await arrangeNearby(page, { behind });
      await page.evaluate((path) => navigateInApp(path), place.path);
      await page.waitForFunction(() => Boolean(state.selected));
      await waitForUiToSettle(page);

      await page.evaluate(() => {
        window.__moves = [];
        const original = window.moveCamera;
        window.moveCamera = function (target, ms, cb, opts) {
          const outcome = original.apply(this, arguments);
          window.__moves.push({ restarting: false });
          return outcome;
        };
      });
      await startFrameTrace(page);
      await page.goBack();
      await page.waitForFunction(() => !state.selected);
      const back = await endState(page);
      const { frames: frames, moves: framesMoves } = await stopFrameTrace(page);
      const moves = await page.evaluate(() => window.__moves);
      expect(moves.length, "one camera move").toBeLessThanOrEqual(1);
      expect(frames.every((f) => f.tilted), "3D stays on for the whole move (no flat fit mid-move)").toBe(true);
      // Where Back lands is where the Nearby follow would put the camera anyway: nothing re-fits afterwards.
      const wanted = await page.evaluate(() => {
        alignHeadingUpNavigationViewport({ force: true, animate: false });
        return { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
      });
      expectSameViewport(back, wanted, "Back vs the Nearby framing");
    });
  });
}

// A place well outside the walking radius, followed by link then history, in each facing.
for (const behind of [true, false]) {
  const where = behind ? "behind the user" : "ahead of the user";
  test(`a link to a far place ${where} is one move that lands it in the map area, the same way history forward does`, async ({ page }) => {
    await setup(page, "/nearby");
    await page.evaluate(() => navigateInApp("/find/onest/"));
    await page.waitForFunction(() => state.selected?.type === "landmark");
    await page.waitForFunction(() => state.routingGraphReady === true, null, { timeout: 30000 });
    await waitForUiToSettle(page);
    await page.evaluate((wantBehind) => {
      state.map3dEnabled = true;
      const target = selectedCompassTarget();
      const user = state.userLocation.point;
      const bearing = (Math.atan2(target.point.x - user.x, -(target.point.y - user.y)) * 180 / Math.PI + 360) % 360;
      const heading = (bearing + (wantBehind ? 180 : 0)) % 360;
      state.compassHeadingTarget = heading;
      state.compassHeading = heading;
      state.renderedNavigationHeading = heading;
      state.tiltBetaTarget = 60;
      state.tiltBetaSmoothed = 60;
      setInterval(() => { state.compassLastEventAt = performance.now(); }, 50);
      state.compassLastEventAt = performance.now();
    }, behind);
    await page.evaluate(() => navigateInApp("/nearby"));
    await page.waitForFunction(() => !state.selected);
    await waitForUiToSettle(page);
    expect(await page.evaluate(() => tiltActive()), "3D tilt is on").toBe(true);

    await startFrameTrace(page);
    await page.evaluate(() => navigateInApp("/find/onest/"));
    await page.waitForFunction(() => state.selected?.type === "landmark");
    const link = await endState(page);
    const { frames: linkFrames, moves: linkMoves } = await stopFrameTrace(page);
    expect(link.inRect, `link: place ${JSON.stringify(link.place)} in ${JSON.stringify(link.rect)}`).toBe(true);
    expectNoLeaveAndReturn(linkFrames, "far link", linkMoves);
    expect(linkMoves, "one camera move").toBeLessThanOrEqual(1);

    await page.goBack();
    await page.waitForFunction(() => !state.selected);
    await waitForUiToSettle(page);
    await startFrameTrace(page);
    await page.goForward();
    await page.waitForFunction(() => state.selected?.type === "landmark");
    const forward = await endState(page);
    const { frames: fwdFrames, moves: fwdMoves } = await stopFrameTrace(page);
    expect(forward.inRect, "forward: place in the map area").toBe(true);
    expectNoLeaveAndReturn(fwdFrames, "far forward", fwdMoves);
    expectSameViewport(forward, link, "far forward vs link");
  });
}

test("leaving a place back to a browsed spot in 3D is one move that matches the browse view", async ({ page }) => {
  await setup(page, "/nearby");
  await hold3d(page);
  await page.evaluate(() => navigateInApp("/nearby/pubs/#near=51.655204,0.065731&label=Far"));
  await page.waitForFunction(() => state.nearbyAnchor != null);
  await waitForUiToSettle(page);
  const browse = await endState(page);
  await page.evaluate(() => navigateInApp("/find/onest/"));
  await page.waitForFunction(() => state.selected?.type === "landmark");
  await page.waitForFunction(() => state.routingGraphReady === true, null, { timeout: 30000 });
  await waitForUiToSettle(page);

  await startFrameTrace(page);
  await page.goBack();
  await page.waitForFunction(() => !state.selected);
  const back = await endState(page);
  const { frames, moves } = await stopFrameTrace(page);
  expect(frames.filter((f) => !f.tilted).length, "3D stays on for the whole move").toBe(0);
  expect(moves, "one camera move").toBeLessThanOrEqual(1);
  expectSameViewport(back, browse, "Back vs the browse view it left");
});
