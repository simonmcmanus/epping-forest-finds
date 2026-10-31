// @ts-check
const { test, expect } = require("@playwright/test");

// Source responses arrive independently online and from the offline data cache.
for (const firstSource of ["osm", "curated"]) {
  test(`a linked blue plaque keeps one pin and its history when ${firstSource} loads first`, async ({ page }) => {
    const { skipOnboarding, mockCowApi, denyGeolocationUnlessGranted } = require("./helpers");
    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    let releaseSecond;
    const secondReady = new Promise(resolve => { releaseSecond = resolve; });
    let releaseUnrelated;
    const unrelatedReady = new Promise(resolve => { releaseUnrelated = resolve; });
    let releaseMetadata;
    const metadataReady = new Promise(resolve => { releaseMetadata = resolve; });
    await page.route("**/data/business-slugs.json", async route => {
      await metadataReady;
      await route.fulfill({ json: { entries: [{ id: "folklore-42", slug: "blue-plaque-a-writer" }] } });
    });
    const osm = { type: "FeatureCollection", features: [{
      type: "Feature", id: "node/42", geometry: { type: "Point", coordinates: [0.037454, 51.667591] },
      properties: { id: "node/42", name: "A Writer", category: "memorial", categoryLabel: "Memorial", historic: "memorial" },
    }] };
    const curated = { locations: [{
      id: "folklore-42", osm_id: "node/42", name: "Blue Plaque: A Writer", category: ["blue plaque"],
      coordinates: { latitude: 51.668, longitude: 0.038 }, story: "The writer lived here.",
    }] };
    await page.route("**/data/local-landmarks-*.geojson", async route => {
      if (route.request().url().includes("historic")) {
        if (firstSource !== "osm") await secondReady;
        await route.fulfill({ json: osm });
      } else if (route.request().url().includes("food")) {
        await unrelatedReady;
        await route.fulfill({ json: { features: [{ type: "Feature", geometry: { type: "Point", coordinates: [0.037, 51.667] }, properties: { id: "node/99", name: "A cafe", category: "cafe" } }] } });
      } else await route.fulfill({ json: { features: [] } });
    });
    await page.route("**/data/epping_forest_folklore_locations.json", async route => {
      if (firstSource !== "curated") await secondReady;
      await route.fulfill({ json: curated });
    });
    await page.goto("/nearby");
    try {
      await page.waitForFunction(() => typeof state !== "undefined" && state.dataLoaded && state.landmarks.some(p => p.id === "node/42"));
      await page.goto("/nearby#place=id%3Anode%2F42");
      await expect(page.locator("#inspectorTitle")).toContainText("Writer");
    } finally { releaseSecond(); }
    await expect(page.locator("#inspectorType")).toHaveText("Blue plaque");
    await expect(page.locator("#inspectorTitleEmoji img")).toHaveAttribute("src", "data/icons/blue-plaques.png");
    await expect(page.locator("#inspectorBody")).toContainText("The writer lived here.");
    const pins = await page.evaluate(() => state.landmarks.filter(p => p.id === "node/42" || p.id === "folklore-42").map(p => ({ id: p.id, latitude: p.latitude, longitude: p.longitude })));
    expect(pins).toEqual([{ id: "node/42", latitude: 51.667591, longitude: 0.037454 }]);
    releaseUnrelated();
    await page.waitForFunction(() => state.landmarks.some(p => p.id === "node/99"));
    const selectedOpacity = await page.evaluate(() => markerOpacityFor("landmark", state.landmarks.find(p => p.id === "node/42")));
    expect(selectedOpacity).toBe(1);
    releaseMetadata();
    await expect.poll(() => page.evaluate(() => findPlaceByFindSlug("blue-plaque-a-writer")?.id)).toBe("node/42");
    expect(await page.evaluate(() => markerOpacityFor("landmark", state.landmarks.find(p => p.id === "node/42")))).toBe(1);
    // Previously shared links to the curated record still resolve to the combined place.
    await page.goto("/nearby#place=id%3Afolklore-42");
    await expect(page.locator("#inspectorTitle")).toHaveText("A Writer");
    await expect(page.locator("#inspectorType")).toHaveText("Blue plaque");
  });
}

for (const failedSource of ["osm", "curated"]) {
  test(`old plaque links remain usable when the ${failedSource} source fails`, async ({ page }) => {
    const { skipOnboarding, mockCowApi, denyGeolocationUnlessGranted } = require("./helpers");
    await skipOnboarding(page);
    await mockCowApi(page);
    await denyGeolocationUnlessGranted(page);
    await page.route("**/data/business-slugs.json", route => route.fulfill({ json: { entries: [{ id: "folklore-42", slug: "blue-plaque-a-writer" }] } }));
    await page.route("**/data/local-landmarks-*.geojson", route => {
      if (!route.request().url().includes("historic")) return route.fulfill({ json: { features: [] } });
      if (failedSource === "osm") return route.abort();
      return route.fulfill({ json: { features: [{
        type: "Feature", geometry: { type: "Point", coordinates: [0.037454, 51.667591] },
        properties: { id: "node/42", aliasIds: ["folklore-42"], name: "A Writer", category: "memorial", memorial: "blue_plaque" },
      }] } });
    });
    await page.route("**/data/epping_forest_folklore_locations.json", route => {
      if (failedSource === "curated") return route.abort();
      return route.fulfill({ json: { locations: [{
        id: "folklore-42", osm_id: "node/42", name: "Blue Plaque: A Writer", category: ["blue plaque"],
        coordinates: { latitude: 51.667591, longitude: 0.037454 },
      }] } });
    });
    await page.goto("/nearby#place=id%3Afolklore-42");
    await expect(page.locator("#inspectorTitle")).toContainText("Writer");
    await expect(page.locator("#inspectorType")).toHaveText("Blue plaque");
    await expect(page.locator("#inspectorTitleEmoji img")).toHaveAttribute("src", "data/icons/blue-plaques.png");
    await expect.poll(() => page.evaluate(() => findPlaceByFindSlug("blue-plaque-a-writer")?.id)).toBe("node/42");
  });
}

test("walking time finishes loading after the selected plaque record is refreshed", async ({ page }) => {
  const { setup } = require("./helpers");
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 51.64865, longitude: 0.0522 });
  await setup(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.evaluate(() => {
    const place = state.landmarks.find(p => p.id === "node/13049742876");
    if (!place || !hasRealLocation()) throw new Error("Plaque and shared location must be available");
    state.selected = { type: "landmark", item: place };
    showLandmarkDetails(place, distanceFromUser(place));
    // Metadata/source updates replace the selected record without navigating away.
    state.selected.item = { ...place };
  });
  await expect(page.locator('[data-live-field="distance"] .walk-chip--pending')).toBeVisible();
  await page.clock.runFor(500);
  await expect(page.locator('[data-live-field="distance"] .walk-chip--ready')).toBeVisible();
});
