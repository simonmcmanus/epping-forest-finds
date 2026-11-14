// @ts-check
// Back from a place picked out of an expanded map group returns to that same group, with the same
// framing, so a reader can step through a group's places one after another. The expanded view has
// no URL of its own: the history entry carries the member keys (js/router.js) and Back rebuilds it.
const { test, expect } = require("@playwright/test");
const { setup, tapCanvasPoint, waitForUiToSettle } = require("./helpers");

test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

const FIND_GROUP = `(() => {
  const dpr = pixelRatio();
  for (const marker of buildMapMarkers(activeIconLookup(), worldToScreen)) {
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

async function tapGroupOnMap(page) {
  await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
  await waitForUiToSettle(page);
  const target = await page.evaluate(`(() => { stopViewportAnimation(); return ${FIND_GROUP}; })()`);
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
    await tapGroupOnMap(page);
    const before = await page.evaluate(GROUP_SUMMARY);
    const pin = await page.evaluate(() => {
      stopViewportAnimation();
      const dpr = pixelRatio();
      const markers = buildMapMarkers(activeIconLookup(), worldToScreen);
      const lone = markers.find((marker) => marker.items.length === 1);
      if (!lone) return null;
      const hit = findHit(lone.screenPt, screenToWorld(lone.screenPt.x, lone.screenPt.y));
      return hit && hit.type !== "none" ? { x: lone.screenPt.x - 4 * dpr, y: lone.screenPt.y - 14 * dpr } : null;
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
