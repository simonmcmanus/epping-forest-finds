// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, settleMapIconsAndDraw } = require("./helpers");

test.describe("Map setup", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("map setup control opens the guided filter setup", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator("#onboardingOverlay")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What would you like to see?" })).toBeVisible();
  });

  test("the first setup step explains what changing filters affects", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator("#onboardingOverlay")).toContainText("What would you like to see?");
    await expect(page.locator("#onboardingOverlay")).toContainText("customise what is shown");
    await expect(page.locator("#onboardingOverlay")).toContainText("categories not currently shown");
    await expect(page.locator("#onboardingOverlay")).toContainText("Nearby list");
    await expect(page.locator("#onboardingOverlay")).toContainText("Nature");
    await expect(page.locator("#onboardingOverlay").locator(".onboarding-selection-item-group").first()).toHaveText(/\d+\/\d+/);
  });

  test("the control reads as map setup and uses the layers icon", async ({ page }) => {
    const toggle = page.locator("#filterToggle");
    await expect(toggle).toHaveAttribute("aria-label", /Map setup/);
    await expect(toggle).toHaveAttribute("title", "Choose what appears on the map");
    await expect(toggle.locator("svg path").first()).toHaveAttribute("d", /8\.5/);
  });

  test("cancel keeps the existing filter choices", async ({ page }) => {
    const before = await page.evaluate(() => state.overviewFilters.slice());
    await page.click("#filterToggle");
    await page.getByRole("button", { name: "Choose categories" }).click();
    await page.locator('.onboarding-chip[data-key="trees"]').click();
    await page.getByRole("button", { name: "Cancel changes" }).click();
    await expect(page.locator("#onboardingOverlay")).toBeHidden();
    expect(await page.evaluate(() => state.overviewFilters)).toEqual(before);
  });

  test("filter changes apply when the guided setup is done", async ({ page }) => {
    await page.click("#filterToggle");
    await page.getByRole("button", { name: "Choose categories" }).click();
    // Move through Nature, Food, Transport, History, Locations and Stories to Events.
    for (let i = 0; i < 6; i += 1) {
      await page.getByRole("button", { name: "Next" }).click();
    }
    await page.locator('.onboarding-chip[data-key="events"]').click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("#onboardingOverlay")).toBeHidden();
    await expect.poll(() => page.evaluate(() => state.overviewFilters.includes("events"))).toBe(false);
  });

  test("the legacy filter URL opens the guided setup", async ({ page }) => {
    await page.goto("/nearby/filter");
    await expect(page.locator("#onboardingOverlay")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What would you like to see?" })).toBeVisible();
  });

  test("the map stays visible behind the setup dialog", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator("#mapCanvas")).toBeVisible();
    await expect(page.locator("#onboardingOverlay")).toBeVisible();
  });

  test("keeps the Nearby panel in place behind the setup dialog", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator("#inspectorTitle")).toHaveText("Nearby");
    await expect(page.locator("#inspector")).toHaveClass(/nearby-overview/);
  });

  test("clicking the translucent backdrop returns to the map", async ({ page }) => {
    await page.click("#filterToggle");
    await page.locator("#onboardingOverlay").click({ position: { x: 4, y: 4 } });
    await expect(page.locator("#onboardingOverlay")).toBeHidden();
    await expect(page.locator("#inspectorTitle")).toHaveText("Nearby");
  });

  test("pressing Escape closes the setup modal", async ({ page }) => {
    await page.click("#filterToggle");
    await expect(page.locator("#onboardingOverlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#onboardingOverlay")).toBeHidden();
    await expect(page.locator("#inspectorTitle")).toHaveText("Nearby");
  });

  test.describe("adding a filter whose matches are all outside the radius", () => {
    test.use({
      geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 },
      permissions: ["geolocation"],
    });

    // The Nearby list still falls back to naming the closest match for a filter with nothing
    // inside the walking radius, but the map remains a survey of that radius. A distant fallback
    // must not make checking a category zoom the camera out to a place that is not shown.
    test("the map stays focused on the walking radius", async ({ page }) => {
      await setup(page);
      await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();

      const framing = await page.evaluate(async () => {
        const settle = async () => {
          for (let i = 0; i < 200; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            if (state.viewportAnimationTo == null) return;
          }
        };

        state.walkingDistanceMinutes = 5;
        setOverviewFilters(["trees"]);
        await settle();
        prepareCanvasForDraw();
        const ringOnlyScale = state.viewport.scale;

        const origin = nearbyOrigin();
        const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
        const candidate = ["underground", "national_rail", "bus"].find((key) => {
          const nearest = nearestOverviewEntryForFilter(key, origin.latitude, origin.longitude);
          return nearest && nearest.metres > radiusMetres;
        });
        if (!candidate) return null;

        setOverviewFilters(["trees", candidate]);
        await settle();
        prepareCanvasForDraw();

        const nearest = nearestOverviewEntryForFilter(candidate, origin.latitude, origin.longitude);
        const rect = bestVisibleCanvasRect();
        const screen = worldToScreen(nearest.item.point);
        return {
          candidate,
          ringOnlyScale,
          afterFilterScale: state.viewport.scale,
          onScreen: screen.x >= rect.x && screen.x <= rect.x + rect.width
            && screen.y >= rect.y && screen.y <= rect.y + rect.height,
        };
      });

      expect(framing, "the dataset should have at least one transport kind outside a 5 min walk").not.toBeNull();
      expect(framing.afterFilterScale, "checking a distant fallback must not zoom out the Nearby map")
        .toBeGreaterThanOrEqual(framing.ringOnlyScale * 0.999);
    });
  });


});
