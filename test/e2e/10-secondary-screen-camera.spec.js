// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap, waitForUiToSettle } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

// Map setup is a modal over Nearby; Settings and Feedback remain inspector screens. All three
// leave the same map framing and walking-radius context visible behind them.
test.describe("Secondary screens preserve a consistent map view", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
  });

  async function readViewport(page) {
    await waitForUiToSettle(page);
    return page.evaluate(() => ({
      scale: state.viewport.scale,
      tx: state.viewport.tx,
      ty: state.viewport.ty,
    }));
  }

  test("Map setup, Settings, and Feedback preserve the same camera fit", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator("#onboardingOverlay")).toBeVisible();
    const mapSetupViewport = await readViewport(page);
    await page.getByRole("button", { name: "Close map setup" }).click();
    await expect(page.locator("#onboardingOverlay")).toBeHidden();

    await page.click("#settingsToggle");
    await expect(page.locator("#settingsWalkMins")).toBeVisible();
    const settingsViewport = await readViewport(page);

    await page.click("#reportToggle");
    await page.click(".community-feedback-link");
    await expect(page.locator("#reportDetails")).toBeVisible();
    const feedbackViewport = await readViewport(page);

    const tolerance = 0.5;
    for (const other of [settingsViewport, feedbackViewport]) {
      expect(Math.abs(other.scale - mapSetupViewport.scale)).toBeLessThan(tolerance);
      expect(Math.abs(other.tx - mapSetupViewport.tx)).toBeLessThan(tolerance);
      expect(Math.abs(other.ty - mapSetupViewport.ty)).toBeLessThan(tolerance);
    }
  });

  test("opening Map setup does not change the Nearby camera", async ({ page }) => {
    const before = await readViewport(page);
    await page.click("#filterToggle");
    await expect(page.locator("#onboardingOverlay")).toBeVisible();
    await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
    const during = await readViewport(page);
    expect(Math.abs(during.scale - before.scale)).toBeLessThan(0.5);
    expect(Math.abs(during.tx - before.tx)).toBeLessThan(0.5);
    expect(Math.abs(during.ty - before.ty)).toBeLessThan(0.5);
  });

  test("resizing the walking radius from Settings re-derives highlighted locations", async ({ page }) => {
    await page.click("#settingsToggle");
    await expect(page.locator("#settingsWalkMins")).toBeVisible();

    const readHighlights = () => page.evaluate(() => {
      const lookup = buildNearbyIconLookup();
      const origin = nearbyOrigin();
      const keys = [];
      let furthestInRadius = 0;
      for (const type of ["tree", "landmark", "cow"]) {
        for (const item of lookup[type]) {
          if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) continue;
          keys.push(`${type}:${item.latitude},${item.longitude}`);
          if (lookup.outOfRadius.has(item)) continue;
          const metres = distanceMetres(origin.latitude, origin.longitude, item.latitude, item.longitude);
          if (metres > furthestInRadius) furthestInRadius = metres;
        }
      }
      return {
        keys,
        furthestInRadius,
        radiusMetres: walkingDistanceToMetres(state.walkingDistanceMinutes),
      };
    });

    const setRadius = (minutes) => page.evaluate((value) => {
      const range = document.getElementById("settingsWalkMins");
      range.value = String(value);
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    }, minutes);

    await setRadius(15);
    const wide = await readHighlights();
    await setRadius(3);
    const tight = await readHighlights();

    expect(wide.keys.length, "the wide ring should highlight something").toBeGreaterThan(0);
    expect(wide.furthestInRadius).toBeLessThanOrEqual(wide.radiusMetres);
    expect(tight.furthestInRadius).toBeLessThanOrEqual(tight.radiusMetres);
    expect(wide.furthestInRadius).toBeGreaterThan(tight.furthestInRadius);
    expect(
      tight.keys.some((key) => !wide.keys.includes(key)) || wide.keys.some((key) => !tight.keys.includes(key)),
    ).toBe(true);
  });

  test("the walking radius is drawn behind Map setup, Settings, and Feedback", async ({ page }) => {
    for (const toggleId of ["#filterToggle", "#settingsToggle", "#reportToggle"]) {
      await page.click(toggleId);
      if (toggleId === "#filterToggle") {
        await expect(page.locator("#onboardingOverlay")).toBeVisible();
        await page.getByRole("button", { name: "Close map setup" }).click();
        await expect(page.locator("#onboardingOverlay")).toBeHidden();
      }
      await waitForUiToSettle(page);
      const radiusDrawn = await page.evaluate(() => {
        let arcCount = 0;
        drawWalkingRadius({
          save() {}, restore() {}, beginPath() {}, closePath() {}, rect() {},
          arc() { arcCount += 1; },
          fill() {}, fillRect() {}, stroke() {}, setLineDash() {},
          createRadialGradient() { return { addColorStop() {} }; },
          createLinearGradient() { return { addColorStop() {} }; },
        });
        return arcCount > 0;
      });
      expect(radiusDrawn).toBe(true);
    }
  });
});
