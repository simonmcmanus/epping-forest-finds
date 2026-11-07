// @ts-check
// Re-tapping the Nearby nav button while already on Nearby: the sheet shakes in place rather than
// sliding out and back in, the list is refreshed and the camera refits to the Nearby ring fit. A
// browse anchor set from the list is kept across the tap, and the panel shows the Nearby list on
// the first tap.
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle, FIXTURE_TREE } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

const nearbyButton = (page) => page.locator("#nearbyToggle");
const listed = (page) => page.locator("#inspectorBody .nearest-item");

/** Counts every screen-entry ghost the panel slide would add from now on. */
async function watchForPanelSlide(page) {
  await page.evaluate(() => {
    window.__slides = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains("inspector-screen-ghost")) window.__slides += 1;
        });
      }
    }).observe(document.querySelector(".inspector-scroll"), { childList: true, subtree: true });
  });
}

test.describe("Nearby re-tap", () => {
  test("re-tapping Nearby on the Nearby screen shakes the sheet in place without a slide", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    await watchForPanelSlide(page);

    await nearbyButton(page).click();

    // The sheet's own shake animation runs, and no outgoing-screen ghost is created.
    await expect.poll(() => page.evaluate(() =>
      document.getElementById("inspector").getAnimations().some((a) => a.animationName === "sheet-shake")
    )).toBe(true);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
    await expect(listed(page).first()).toBeVisible();
  });

  test("tapping Nearby after picking a place from the list returns to the list on the first tap", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    const title = page.locator("#inspectorTitle");

    // Opening a place from the list moves the panel off the Nearby list.
    await listed(page).first().click();
    await expect(title).not.toHaveText("Nearby");

    await nearbyButton(page).click();

    // One tap is enough: the panel is back on the Nearby list without a second press.
    await expect(title).toHaveText("Nearby");
    await expect(listed(page).first()).toBeVisible();
  });
  test("tapping Nearby after moving the browse origin updates the panel on the first tap", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    // A tap on open ground moves the browse origin away from the real fix.
    await page.evaluate(() => {
      const latitude = state.userLocation.latitude + 0.02;
      const longitude = state.userLocation.longitude;
      setNearbyAnchor(latitude, longitude, projectLonLat(longitude, latitude));
    });
    await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();

    await nearbyButton(page).click();

    // One tap is enough: the panel shows the Nearby list for the moved origin.
    await expect(page.locator("#inspectorTitle")).toHaveText("Nearby");
    await expect(listed(page).first()).toBeVisible();
    await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
  });
  test("re-tapping Search while on Search shakes the sheet in place without a slide", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(nearbyButton(page)).toBeVisible();
    await page.locator("#searchToggle").click();
    await expect(page.locator("#searchToggle")).toHaveClass(/screen-active/);
    await watchForPanelSlide(page);

    await page.locator("#searchToggle").click();

    await expect.poll(() => page.evaluate(() =>
      document.getElementById("inspector").getAnimations().some((a) => a.animationName === "sheet-shake")
    )).toBe(true);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
    await expect(page.locator("#searchToggle")).toHaveClass(/screen-active/);
  });
});

// The camera, read the same way the other camera specs read it.
async function readCamera(page) {
  await waitForUiToSettle(page);
  return page.evaluate(() => ({
    scale: state.viewport.scale,
    tx: state.viewport.tx,
    ty: state.viewport.ty,
  }));
}

function expectSameCamera(actual, expected, label) {
  const tolerance = 0.5;
  for (const key of ["scale", "tx", "ty"]) {
    expect(Math.abs(actual[key] - expected[key]), `${label}: ${key}`).toBeLessThan(tolerance);
  }
}

// The compass loop makes its last fit once the sensor has been quiet for a moment, so a camera move
// caused by a turn can land after the turn itself. Wait for that last fit.
async function waitForCompassToSettle(page) {
  await expect.poll(() => page.evaluate(() => state.compassAnimationFrame == null)).toBe(true);
}

// One orientation event per frame, the way a phone's compass streams them while it turns, then wait
// until the heading the map shows has caught up with the turn.
async function turnCompass(page, fromDeg, toDeg, frames = 60) {
  await page.evaluate(async ({ fromDeg, toDeg, frames }) => {
    for (let i = 0; i <= frames; i += 1) {
      const deg = fromDeg + ((toDeg - fromDeg) * i) / frames;
      window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", {
        alpha: (360 - deg) % 360, beta: 0, gamma: 0, absolute: true,
      }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, { fromDeg, toDeg, frames });
  await expect.poll(() => page.evaluate(() =>
    Number.isFinite(state.compassHeading) && Math.abs(state.compassHeading - state.compassHeadingTarget) < 0.5
  )).toBe(true);
  await waitForCompassToSettle(page);
}

test.describe("Nearby camera returns to the Nearby ring fit", () => {
  test("tapping Nearby on plain Nearby returns a zoomed-out map to the Nearby ring fit", async ({ page }) => {
    await setup(page, "/nearby");
    const ringFit = await readCamera(page);

    // The map has been left zoomed out (for example by a pinch that was never undone).
    await page.evaluate(() => {
      state.viewport.scale *= 0.5;
      requestDraw();
    });
    const zoomedOut = await readCamera(page);
    expect(zoomedOut.scale).toBeLessThan(ringFit.scale * 0.75);

    await nearbyButton(page).click();

    expectSameCamera(await readCamera(page), ringFit, "after tapping Nearby");
  });

  test("tapping Nearby after Map setup closes returns a map zoomed out since then to the Nearby ring fit", async ({ page }) => {
    await setup(page, "/nearby");
    const ringFit = await readCamera(page);

    await page.click("#filterToggle");
    await expect(page.locator("#onboardingOverlay")).toBeVisible();
    await page.getByRole("button", { name: "Close map setup" }).click();
    await expect(page.locator("#onboardingOverlay")).toBeHidden();

    // The map is zoomed out after the setup dialog has closed, so only the Nearby tap can fix it.
    await page.evaluate(() => {
      state.viewport.scale *= 0.5;
      requestDraw();
    });
    expect((await readCamera(page)).scale).toBeLessThan(ringFit.scale * 0.75);

    await nearbyButton(page).click();

    expectSameCamera(await readCamera(page), ringFit, "after Map setup closed and Nearby tapped");
  });

  test("tapping Nearby on plain Nearby keeps a stale compass heading, by design", async ({ page }) => {
    await setup(page, "/nearby");
    await turnCompass(page, 0, 90);
    const headingBefore = await page.evaluate(() => state.compassHeading);

    // Deliberate: the compass has been quiet for longer than goToInitialView()'s stale-sensor limit,
    // and a re-tap still keeps the heading the map is showing rather than clearing it (north-up).
    await page.evaluate(() => {
      state.compassLastEventAt = performance.now() - 10_000;
    });

    await nearbyButton(page).click();
    await waitForUiToSettle(page);

    expect(await page.evaluate(() => state.compassHeading)).toBeCloseTo(headingBefore, 0);
  });
});

// Plain Nearby: the title, the document title and the list heading name no category.
async function expectPlainNearbyLabels(page) {
  await expect(page.locator("#inspectorTitle")).toHaveText("Nearby");
  await expect(page).toHaveTitle("Nearby | Epping Forest Finds");
  await expect(page.locator(".nearby-category-results")).toHaveCount(0);
}

test.describe("A re-tap keeps the view the reader set up", () => {
  const railPill = (page, key) => page.locator(`#inspectorBody [data-rail-key="${key}"]`);
  const sortedFilters = (page) => page.evaluate(() => [...state.overviewFilters].sort().join(","));
  // The stored string exactly as written, so a test can tell an untouched store from a rewritten one.
  const savedRaw = (page) => page.evaluate(() => localStorage.getItem("forest-finds-filter-state-v1"));
  const savedFilters = (page) => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("forest-finds-filter-state-v1") || "null");
    return stored && Array.isArray(stored.filters) ? stored.filters.slice().sort().join(",") : null;
  });
  // Seeds the saved set once per tab. An init script runs again on every reload, so without the marker a reload
  // would put the seeded set back over whatever the reader saved.
  const seedSavedFilters = (page, filters) => page.addInitScript((list) => {
    if (sessionStorage.getItem("seeded-filters")) return;
    sessionStorage.setItem("seeded-filters", "1");
    localStorage.setItem("forest-finds-filter-state-v1", JSON.stringify({ filters: list }));
  }, filters);

  test("a re-tap on Nearby returns the rail to its top level and keeps the subcategory picks", async ({ page }) => {
    // The saved set holds all of Food. Tapping Cafes on the Food landing takes it out of the saved set.
    await seedSavedFilters(page, ["pubs", "restaurants", "cafes", "shops"]);
    await setup(page, "/nearby/food");
    await railPill(page, "cafes").click();
    await expect(railPill(page, "pubs")).toHaveCount(1);

    await nearbyButton(page).click();
    await waitForUiToSettle(page);

    await expect(railPill(page, "pubs")).toHaveCount(0);
    await expect(railPill(page, "food").locator(".rail-count")).toHaveText("3/4");
    await expect(page).not.toHaveURL(/[?&]show=/);
    expect(await sortedFilters(page)).toBe("pubs,restaurants,shops");
    expect(await savedFilters(page)).toBe("pubs,restaurants,shops");
  });

  test("a rail pick stays on a re-tap", async ({ page }) => {
    await setup(page, "/nearby");
    const before = await sortedFilters(page);
    await railPill(page, "nature").click();
    const picked = await sortedFilters(page);
    expect(picked, "the rail pick changes the set").not.toBe(before);

    await nearbyButton(page).click();
    await waitForUiToSettle(page);

    expect(await sortedFilters(page)).toBe(picked);
    await expect(railPill(page, "nature")).toHaveAttribute("aria-pressed", "false");
  });

  test("a single subcategory pick stays on a re-tap", async ({ page }) => {
    // Three subcategories are turned off on the Food landing, leaving cafes as the one pick.
    await seedSavedFilters(page, ["pubs", "restaurants", "cafes", "shops"]);
    await setup(page, "/nearby/food");
    await railPill(page, "pubs").click();
    await railPill(page, "restaurants").click();
    await railPill(page, "shops").click();
    await expect(page).not.toHaveURL(/[?&]show=/);
    expect(await sortedFilters(page)).toBe("cafes");

    await nearbyButton(page).click();
    await waitForUiToSettle(page);

    expect(await sortedFilters(page)).toBe("cafes");
    expect(await savedFilters(page)).toBe("cafes");
    await expect(railPill(page, "food").locator(".rail-count")).toHaveText("1/4");
  });

  test("a re-tap with an expanded cluster leaves the cluster, restores the walking radius and keeps the browse anchor", async ({ page }) => {
    await setup(page, "/nearby");
    const ownRadius = await page.evaluate(() => state.walkingDistanceMinutes);

    // Tapping a cluster on the map expands it: the same call the tap makes.
    await page.evaluate(() => {
      const lookup = activeIconLookup();
      const clusters = buildTypeClusters(lookup.tree, worldToScreen);
      focusNearbyOnClusterGroup(clusters.find((candidate) => candidate.items.length >= 2));
    });
    await expect.poll(() => page.evaluate(() => Boolean(state.clusterExpanded))).toBe(true);
    const clusteredRadius = await page.evaluate(() => state.walkingDistanceMinutes);
    expect(clusteredRadius, "the cluster sets its own radius").not.toBe(ownRadius);
    const anchorBefore = await page.evaluate(() => ({ latitude: state.nearbyAnchor?.latitude, longitude: state.nearbyAnchor?.longitude }));
    expect(Number.isFinite(anchorBefore.latitude), "the cluster leaves a browse anchor").toBe(true);

    await nearbyButton(page).click();
    await waitForUiToSettle(page);

    expect(await page.evaluate(() => Boolean(state.clusterExpanded))).toBe(false);
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(ownRadius);
    expect(await page.evaluate(() => ({ latitude: state.nearbyAnchor?.latitude, longitude: state.nearbyAnchor?.longitude }))).toEqual(anchorBefore);
    await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
  });

  test("a re-tap on a landing page restores the reader's saved filters without sliding the sheet", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("forest-finds-filter-state-v1", JSON.stringify({ filters: ["trees", "ponds_streams"] }));
    });
    await setup(page, "/nearby/food");
    // The landing shows its own category lens, not the reader's saved filters.
    expect(await sortedFilters(page)).not.toBe("ponds_streams,trees");
    await watchForPanelSlide(page);

    await nearbyButton(page).click();
    await waitForUiToSettle(page);

    expect(await sortedFilters(page)).toBe("ponds_streams,trees");
    expect(await page.evaluate(() => window.__slides)).toBe(0);
  });

  test("a rail pick on plain Nearby is saved: a reload keeps it", async ({ page }) => {
    await setup(page, "/nearby");
    const before = await sortedFilters(page);
    await railPill(page, "nature").click();
    const picked = await sortedFilters(page);
    expect(picked, "the rail pick changes the set").not.toBe(before);
    expect(await savedFilters(page)).toBe(picked);

    await page.reload();
    await page.waitForFunction(() => typeof state !== "undefined" && state.dataLoaded === true);
    await waitForUiToSettle(page);

    expect(await sortedFilters(page)).toBe(picked);
    await expect(railPill(page, "nature")).toHaveAttribute("aria-pressed", "false");
  });

  test("visiting a category landing shows that category without changing the saved set", async ({ page }) => {
    await seedSavedFilters(page, ["ponds_streams", "trees"]);
    await setup(page, "/nearby/food");
    // The landing shows its own category: the Food pills are pressed, and the saved set is not.
    await expect(railPill(page, "pubs")).toHaveAttribute("aria-pressed", "true");
    expect(await sortedFilters(page)).not.toBe("ponds_streams,trees");
    expect(await savedFilters(page)).toBe("ponds_streams,trees");
  });

  test("a pill tap on a category landing saves the landing's set, and Undo restores the saved picks", async ({ page }) => {
    // The Food landing shows all four Food categories. Tapping Cafes edits that shown set, saves it and
    // moves the URL to plain Nearby. Undo then puts the earlier saved picks back.
    await seedSavedFilters(page, ["ponds_streams", "trees"]);
    await setup(page, "/nearby/food");
    const savedBefore = await savedRaw(page);
    await expect(railPill(page, "cafes")).toHaveAttribute("aria-pressed", "true");
    await railPill(page, "cafes").click();
    await expect(railPill(page, "cafes")).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
    // The saved set is the view the reader edited: the Food categories still on, which excludes the earlier picks.
    expect(await savedFilters(page)).toBe("pubs,restaurants,shops");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(await savedRaw(page)).toBe(savedBefore);

    await page.reload();
    await page.waitForFunction(() => typeof state !== "undefined" && state.dataLoaded === true);
    await waitForUiToSettle(page);
    expect(await sortedFilters(page)).toBe("ponds_streams,trees");
  });

  test("Everything within a place shows every category and leaves the saved picks as they were after a reload", async ({ page }) => {
    await seedSavedFilters(page, ["ponds_streams", "trees"]);
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect.poll(() => page.evaluate(() => state.selected?.type)).toBe("tree");
    const savedBefore = await savedRaw(page);

    await page.locator("#inspectorBody [data-action='walk-radius']").click();

    await expect.poll(() => page.evaluate(() => state.overviewFilters.length)).toBe(await page.evaluate(() => ALL_OVERVIEW_FILTER_KEYS.size));
    expect(await savedRaw(page)).toBe(savedBefore);

    await page.reload();
    await page.waitForFunction(() => typeof state !== "undefined" && state.dataLoaded === true);
    await waitForUiToSettle(page);
    expect(await savedRaw(page)).toBe(savedBefore);
  });

  test("closing Map setup from a landing without changes leaves the saved picks in storage", async ({ page }) => {
    await seedSavedFilters(page, ["ponds_streams", "trees"]);
    await setup(page, "/nearby/food");
    const savedBefore = await savedRaw(page);

    await page.locator("#filterToggle").click();
    await expect(page.locator("#onboardingOverlay")).toBeVisible();
    await page.locator("#onboardingOverlay .onboarding-close").click();
    await expect(page.locator("#onboardingOverlay")).toBeHidden();

    await expect(page).toHaveURL(/\/nearby(?:\?radius=30)?$/);
    expect(await savedRaw(page)).toBe(savedBefore);
    expect(await sortedFilters(page)).toBe("ponds_streams,trees");
  });

  test("a whole group picked on its landing is named by neither the title nor the list heading, before and after a reload", async ({ page }) => {
    await seedSavedFilters(page, ["pubs", "restaurants", "cafes", "shops"]);
    await setup(page, "/nearby/food");
    // Cafes off and back on leaves all four Food subcategories saved, so the whole group is picked.
    await railPill(page, "cafes").click();
    await railPill(page, "cafes").click();
    expect(await sortedFilters(page)).toBe("cafes,pubs,restaurants,shops");
    await expectPlainNearbyLabels(page);

    await page.reload();
    await page.waitForFunction(() => typeof state !== "undefined" && state.dataLoaded === true);
    await waitForUiToSettle(page);
    expect(await sortedFilters(page)).toBe("cafes,pubs,restaurants,shops");
    await expectPlainNearbyLabels(page);
  });

  test("a single subcategory pick names its category in the Nearby title and the document title", async ({ page }) => {
    // Three subcategories are turned off on the Food landing, leaving cafes as the one pick.
    await seedSavedFilters(page, ["pubs", "restaurants", "cafes", "shops"]);
    await setup(page, "/nearby/food");
    await railPill(page, "pubs").click();
    await railPill(page, "restaurants").click();
    await railPill(page, "shops").click();
    await expect(page).not.toHaveURL(/[?&]show=/);

    await expect(page).toHaveTitle("Nearby Cafés in Epping Forest | Epping Forest Finds");
    await expect(page.locator("#inspectorTitle")).toHaveText("Nearby Cafés");
  });
});

test.describe("A Nearby tap on the minimised sheet", () => {
  test("reopens the sheet and refits, keeping the rail pick and the expanded cluster", async ({ page }) => {
    await setup(page, "/nearby");
    // Food is picked off, which leaves the trees on the map, so a cluster of trees is still there to expand.
    await page.locator("#inspectorBody [data-rail-key='food']").click();
    const picked = await page.evaluate(() => [...state.overviewFilters].sort().join(","));
    await page.evaluate(() => {
      const lookup = activeIconLookup();
      const clusters = buildTypeClusters(lookup.tree, worldToScreen);
      focusNearbyOnClusterGroup(clusters.find((candidate) => candidate.items.length >= 2));
    });
    await expect.poll(() => page.evaluate(() => Boolean(state.clusterExpanded))).toBe(true);
    const fitCamera = await readCamera(page);

    await page.evaluate(() => setInspectorMinimized(true));
    await expect(page.locator("#inspector")).toHaveClass(/minimized/);
    // The map is zoomed out while the sheet is away, so the tap has a refit to make.
    await page.evaluate(() => {
      state.viewport.scale *= 0.5;
      requestDraw();
    });

    await nearbyButton(page).click();
    await waitForUiToSettle(page);

    await expect(page.locator("#inspector")).not.toHaveClass(/minimized/);
    expect(await page.evaluate(() => [...state.overviewFilters].sort().join(","))).toBe(picked);
    expect(await page.evaluate(() => Boolean(state.clusterExpanded))).toBe(true);
    expectSameCamera(await readCamera(page), fitCamera, "camera after reopening the sheet");
  });
});
