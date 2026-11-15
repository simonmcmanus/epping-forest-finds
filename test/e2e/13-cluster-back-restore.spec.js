// @ts-check
// Back from a place picked out of an expanded map group returns to that same group, with the same
// framing, so a reader can step through a group's places one after another. The expanded view has
// no URL of its own: the history entry carries the member keys (js/router.js) and Back rebuilds it.
const { test, expect } = require("@playwright/test");
const { setup, tapCanvasPoint, waitForUiToSettle } = require("./helpers");

test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

// preferSmall: the smallest tappable group, which zooms in far enough on expansion to split into
// single pins that can be tapped on the map.
const FIND_GROUP = (preferSmall) => `(() => {
  const dpr = pixelRatio();
  const markers = buildMapMarkers(activeIconLookup(), worldToScreen);
  if (${preferSmall}) markers.sort((a, b) => a.items.length - b.items.length);
  for (const marker of markers) {
    if (marker.items.length < 2) continue;
    const box = clusterBadgeGeometry(marker.screenPt.x, marker.screenPt.y, marker.items.length, dpr);
    const point = { x: box.left + 8 * dpr, y: box.top + box.height / 2 };
    const hit = findClusterHit(point);
    if (hit && hit.items.length === marker.items.length && hit.items[0] === marker.items[0]) return { point, count: marker.items.length };
  }
  return null;
})()`;

const GROUP_SUMMARY = () => ({
  expanded: Boolean(state.clusterExpanded),
  keys: state.clusterExpanded
    ? Object.entries(clusterItemsByType(state.clusterExpanded))
      .flatMap(([type, items]) => items.map((item) => `${type}:${SELECTION_ROUTES.find((route) => route.type === type).toKey(item)}`))
      .sort()
    : [],
  radius: state.walkingDistanceMinutes,
  listed: document.querySelectorAll("#inspectorBody .nearest-item").length,
  selected: state.selected ? state.selected.type : null,
  search: window.location.search,
});

async function tapGroupOnMap(page, preferSmall = false) {
  await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
  await waitForUiToSettle(page);
  const target = await page.evaluate(`(() => { stopViewportAnimation(); return ${FIND_GROUP(preferSmall)}; })()`);
  expect(target, "a group badge is on screen at the default view").not.toBeNull();
  await tapCanvasPoint(page, target.point);
  await expect.poll(() => page.evaluate(() => state.clusterExpanded?.items.length)).toBe(target.count);
  await waitForUiToSettle(page);
}

test.describe("Back returns to the expanded group", () => {
  test("a place picked from the list: Back, Forward and the inspector's back arrow all return to the same group", async ({ page }) => {
    await setup(page);
    const realRadius = await page.evaluate(() => state.walkingDistanceMinutes);
    await tapGroupOnMap(page);
    const before = await page.evaluate(GROUP_SUMMARY);
    expect(before.expanded).toBe(true);
    expect(before.radius, "the tap borrowed its own radius").not.toBe(realRadius);
    expect(before.search, "the address bar never carries the borrowed radius").not.toContain(`radius=${before.radius}`);

    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => state.selected?.type ?? null)).not.toBeNull();
    await waitForUiToSettle(page);

    await page.goBack();
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    expect(await page.evaluate(GROUP_SUMMARY)).toEqual(before);

    // Forward re-opens the place; Back returns again.
    await page.goForward();
    await expect.poll(() => page.evaluate(() => state.selected?.type ?? null)).not.toBeNull();
    expect(await page.evaluate(() => state.clusterExpanded)).toBeNull();
    await page.goBack();
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    expect(await page.evaluate(GROUP_SUMMARY)).toEqual(before);

    // Step to the next place in the group using the inspector's own back arrow.
    await page.locator("#inspectorBody .nearest-item").nth(1).click();
    await expect.poll(() => page.evaluate(() => state.selected?.type ?? null)).not.toBeNull();
    await waitForUiToSettle(page);
    await page.locator("#inspectorBack").click();
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    expect(await page.evaluate(GROUP_SUMMARY)).toEqual(before);

    // Leaving the group later gives back the reader's real radius.
    await page.evaluate(() => exitClusterExpansion());
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(realRadius);
  });

  test("a place selected from the map rather than the list also returns to the group on Back", async ({ page }) => {
    await setup(page);
    await tapGroupOnMap(page, true);
    const before = await page.evaluate(GROUP_SUMMARY);
    const pin = await page.evaluate(() => {
      stopViewportAnimation();
      const iconSize = MAP_PNG_ICON_SIZE * pixelRatio() * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
      for (const single of buildMapMarkers(activeIconLookup(), worldToScreen).filter((marker) => marker.items.length === 1)) {
        const point = { x: single.screenPt.x, y: single.screenPt.y - iconSize * 0.416 };
        const hit = findHit(point, screenToWorld(point.x, point.y));
        if (!findClusterHit(point) && hit && hit.item === single.items[0]) return point;
      }
      return null;
    });
    expect(pin, "the expanded group shows a single pin to tap").not.toBeNull();
    await tapCanvasPoint(page, pin);
    await expect.poll(() => page.evaluate(() => state.selected?.type ?? null)).not.toBeNull();
    await waitForUiToSettle(page);

    await page.goBack();
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    expect(await page.evaluate(GROUP_SUMMARY)).toEqual(before);
  });

  test("two nested group levels retrace one at a time, ending on the reader's own radius", async ({ page }) => {
    await setup(page);
    const realRadius = await page.evaluate(() => state.walkingDistanceMinutes);
    await tapGroupOnMap(page);
    const outer = await page.evaluate(GROUP_SUMMARY);
    // Drill into a sub-group: the same call a tap on a smaller badge makes.
    const innerCount = await page.evaluate(() => {
      const items = state.clusterExpanded.items.slice(0, Math.max(2, Math.ceil(state.clusterExpanded.items.length / 2)));
      const itemsByType = {};
      for (const [type, list] of Object.entries(clusterItemsByType(state.clusterExpanded))) {
        const subset = list.filter((item) => items.includes(item));
        if (subset.length) itemsByType[type] = subset;
      }
      const types = Object.keys(itemsByType);
      focusNearbyOnClusterGroup({ items, itemsByType, itemType: types.length > 1 ? "_mega" : types[0] });
      return items.length;
    });
    await waitForUiToSettle(page);
    const inner = await page.evaluate(GROUP_SUMMARY);
    expect(inner.keys.length).toBe(innerCount);
    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => state.selected?.type ?? null)).not.toBeNull();
    await waitForUiToSettle(page);

    await page.goBack();
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    expect(await page.evaluate(GROUP_SUMMARY)).toEqual(inner);
    await page.goBack();
    await expect.poll(() => page.evaluate(() => state.clusterExpanded?.items.length)).toBe(outer.keys.length);
    await waitForUiToSettle(page);
    expect(await page.evaluate(GROUP_SUMMARY)).toEqual(outer);
    await page.goBack();
    await expect.poll(() => page.evaluate(() => Boolean(state.clusterExpanded))).toBe(false);
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(realRadius);
  });
});

test.describe("Back onto an expanded group from other screens", () => {
  for (const [name, open] of [
    ["Search", () => openSearchScreen()],
    ["Filters", () => openFiltersScreen()],
  ]) {
    test(`Back from ${name} restores the group with that screen closed, and nothing drops it afterwards`, async ({ page }) => {
      await setup(page);
      await tapGroupOnMap(page);
      const before = await page.evaluate(GROUP_SUMMARY);
      await page.evaluate(open);
      await expect.poll(() => page.evaluate(() => state.searchScreenOpen || state.filterScreenOpen)).toBe(true);
      await page.goBack();
      await expect.poll(() => page.evaluate(() => state.clusterExpanded?.items.length)).toBe(before.keys.length);
      await waitForUiToSettle(page);
      expect(await page.evaluate(() => state.searchScreenOpen || state.filterScreenOpen || mapSetupModalActive())).toBe(false);
      expect(await page.evaluate(GROUP_SUMMARY), "same members, radius, list and address bar").toEqual(before);

      // Forward lands on the screen again, with the group closed behind it.
      await page.goForward();
      await expect.poll(() => page.evaluate(() => state.searchScreenOpen || state.filterScreenOpen)).toBe(true);
      expect(await page.evaluate(() => state.clusterExpanded)).toBeNull();
    });
  }

  test("a group left by dragging the map is not re-expanded by Back from a place picked afterwards", async ({ page }) => {
    await setup(page);
    const realRadius = await page.evaluate(() => state.walkingDistanceMinutes);
    await tapGroupOnMap(page);
    const box = await page.locator("#mapCanvas").boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 4;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 20, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => Boolean(state.clusterExpanded))).toBe(false);
    await waitForUiToSettle(page);
    const afterDrag = await page.evaluate(() => state.walkingDistanceMinutes);
    expect(afterDrag, "the real radius is back").toBe(realRadius);

    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => state.selected?.type ?? null)).not.toBeNull();
    await waitForUiToSettle(page);
    await page.goBack();
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    expect(await page.evaluate(() => Boolean(state.clusterExpanded))).toBe(false);
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(realRadius);
  });
});

test.describe("A group left in place stays left", () => {
  async function leaveBy(page, how) {
    if (how === "wheel") {
      const box = await page.locator("#mapCanvas").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4);
      await page.mouse.wheel(0, -300);
    } else if (how === "slider") {
      await page.evaluate(() => applyWalkingRadiusChange(12, { animate: false }));
    } else {
      const box = await page.locator("#mapCanvas").boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 4;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 60, cy + 20, { steps: 6 });
      await page.mouse.up();
    }
    await expect.poll(() => page.evaluate(() => Boolean(state.clusterExpanded))).toBe(false);
    await page.waitForFunction(() => state.wheelRadiusSettleTimer == null);
    await waitForUiToSettle(page);
  }

  for (const how of ["wheel", "slider", "drag"]) {
    test(`after a ${how}, Back from a picked place and then Forward onto that entry both show the plain view`, async ({ page }) => {
      await setup(page);
      await tapGroupOnMap(page);
      await leaveBy(page, how);
      const left = await page.evaluate(() => state.walkingDistanceMinutes);
      await page.locator("#inspectorBody .nearest-item").first().click();
      await expect.poll(() => page.evaluate(() => state.selected?.type ?? null)).not.toBeNull();
      await waitForUiToSettle(page);
      await page.goBack();
      await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
      await waitForUiToSettle(page);
      expect(await page.evaluate(() => Boolean(state.clusterExpanded)), "Back: plain view").toBe(false);
      expect(await page.evaluate(() => state.walkingDistanceMinutes), "Back: the reader's radius").toBe(left);
      // Back past the group's entry, then Forward onto it.
      await page.goBack();
      await waitForUiToSettle(page);
      await page.goForward();
      await waitForUiToSettle(page);
      expect(await page.evaluate(() => Boolean(state.clusterExpanded)), "Forward: plain view").toBe(false);
      expect(await page.evaluate(() => state.walkingDistanceMinutes), "Forward: the reader's radius").toBe(left);
    });
  }
});

test.describe("Rapid history steps", () => {
  test("Back, Forward, Back in one task ends on a screen that matches its entry, with every selection hold released", async ({ page }) => {
    await setup(page);
    await tapGroupOnMap(page);
    const before = await page.evaluate(GROUP_SUMMARY);
    await page.locator("#inspectorBody .nearest-item").first().click();
    await expect.poll(() => page.evaluate(() => state.selected?.type ?? null)).not.toBeNull();
    await waitForUiToSettle(page);
    await page.evaluate(() => {
      const transition = state.selectionTransition;
      let held = transition.mapHeld;
      window.__holds = { started: 0, released: 0 };
      Object.defineProperty(transition, "mapHeld", {
        configurable: true,
        get() { return held; },
        set(next) {
          if (next && !held) window.__holds.started += 1;
          if (!next && held) window.__holds.released += 1;
          held = next;
        },
      });
      history.back();
      history.forward();
      history.back();
    });
    await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
    await waitForUiToSettle(page);
    // The browser resolves the three queued traversals itself; whichever entry it lands on, the
    // screen must describe that entry: the group exactly when the entry carries one.
    const landed = await page.evaluate(() => ({
      entryHasGroup: Boolean(history.state && history.state.forestNearbyAnchor && history.state.forestNearbyAnchor.cluster),
      expanded: Boolean(state.clusterExpanded),
      selected: state.selected,
    }));
    expect(landed.selected).toBeNull();
    expect(landed.expanded).toBe(landed.entryHasGroup);
    if (landed.entryHasGroup) expect(await page.evaluate(GROUP_SUMMARY)).toEqual(before);
    const holds = await page.evaluate(() => ({ ...window.__holds, held: state.selectionTransition.mapHeld }));
    expect(holds.held).toBe(false);
    expect(holds.released, "every hold that started was released exactly once").toBe(holds.started);
  });
});

test.describe("Back before the place's exit fade has finished (motion enabled)", () => {
  async function trace(page) {
    await page.evaluate(() => {
      window.__moves = [];
      const orig = window.moveCamera;
      window.moveCamera = function (target) {
        window.__moves.push({ toScale: target.scale });
        return orig.apply(this, arguments);
      };
    });
  }

  for (const headingUp of [false, true]) {
    test(`makes one camera move and releases the selection hold${headingUp ? " with the phone held up" : ""}`, async ({ page }) => {
      await setup(page);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      if (headingUp) {
        await page.evaluate(() => {
          state.compassHeadingTarget = 40;
          state.compassHeading = 40;
          state.renderedNavigationHeading = 40;
          window.__keepCompassFresh = setInterval(() => { state.compassLastEventAt = performance.now(); }, 50);
          state.compassLastEventAt = performance.now();
        });
      }
      await tapGroupOnMap(page);
      const before = await page.evaluate(GROUP_SUMMARY);
      await trace(page);
      // Pick the place and press Back in the same task: the place's camera move is still waiting
      // out the pins' exit fade, so the hold is pending whatever the runner's speed.
      const pending = await page.evaluate(() => {
        document.querySelector("#inspectorBody .nearest-item").click();
        const held = state.selectionTransition.mapHeld;
        // Moves made before the browser even delivers the Back (a slow runner can outlast the
        // fade) belong to the place, not to Back: only count from the moment popstate fires.
        const restore = window.restoreNearbyAnchorFromHistory;
        window.restoreNearbyAnchorFromHistory = function () {
          window.__moves = [];
          window.restoreNearbyAnchorFromHistory = restore;
          return restore.apply(this, arguments);
        };
        // Registered after the app's own handler, so it reads the state that handler left behind.
        window.addEventListener("popstate", () => {
          window.__afterBack = { mapHeld: state.selectionTransition.mapHeld, token: state.selectionMapTransitionToken };
        }, { once: true });
        history.back();
        return held;
      });
      expect(pending, "the place's hold was pending when Back was pressed").toBe(true);
      await expect.poll(() => page.evaluate(() => state.selected)).toBeNull();
      await waitForUiToSettle(page);
      // Let any stale selection timer that would still fire have its chance.
      await page.evaluate(() => new Promise((resolve) => {
        const until = performance.now() + SELECTION_MARKER_EXIT_MS + SELECTION_MARKER_EXIT_MAX_STAGGER_MS + 200;
        const tick = () => (performance.now() >= until ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }));
      await waitForUiToSettle(page);
      expect(await page.evaluate(() => window.__afterBack), "the hold is released by Back itself, not left to the settle loop")
        .toEqual({ mapHeld: false, token: null });
      const state2 = await page.evaluate(() => ({
        mapHeld: state.selectionTransition.mapHeld,
        viewportPending: state.selectionTransition.viewportPending,
        token: state.selectionMapTransitionToken,
        moves: window.__moves.length,
      }));
      expect(state2.mapHeld).toBe(false);
      expect(state2.viewportPending).toBe(false);
      expect(state2.token).toBeNull();
      expect(state2.moves, "one ease to the group, none to the abandoned place").toBe(1);
      expect(await page.evaluate(GROUP_SUMMARY)).toEqual(before);
    });
  }
});

test.describe("Back from Filters onto a group with the phone held up (motion enabled)", () => {
  test("makes one camera move and leaves no pins held", async ({ page }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      state.compassHeadingTarget = 40;
      state.compassHeading = 40;
      state.renderedNavigationHeading = 40;
      window.__keepCompassFresh = setInterval(() => { state.compassLastEventAt = performance.now(); }, 50);
      state.compassLastEventAt = performance.now();
    });
    await tapGroupOnMap(page);
    const before = await page.evaluate(GROUP_SUMMARY);
    await page.evaluate(() => openFiltersScreen());
    await expect.poll(() => page.evaluate(() => state.filterScreenOpen)).toBe(true);
    await waitForUiToSettle(page);
    await page.evaluate(() => {
      window.__moves = [];
      const orig = window.moveCamera;
      window.moveCamera = function (target) {
        window.__moves.push({ toScale: target.scale });
        return orig.apply(this, arguments);
      };
      const restore = window.restoreNearbyAnchorFromHistory;
      window.restoreNearbyAnchorFromHistory = function () {
        window.__moves = [];
        window.restoreNearbyAnchorFromHistory = restore;
        return restore.apply(this, arguments);
      };
      history.back();
    });
    await expect.poll(() => page.evaluate(() => state.clusterExpanded?.items.length)).toBe(before.keys.length);
    await waitForUiToSettle(page);
    const after = await page.evaluate(() => ({ moves: window.__moves.length, held: state.selectionTransition.mapHeld, token: state.selectionMapTransitionToken }));
    expect(after.moves, "one ease").toBe(1);
    expect(after.held).toBe(false);
    expect(after.token).toBeNull();
    expect(await page.evaluate(GROUP_SUMMARY)).toEqual(before);
  });
});
