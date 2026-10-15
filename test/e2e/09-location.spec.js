// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap, settleMapIconsAndDraw } = require("./helpers");

// A GPS fix inside Epping Forest
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.describe("Location and GPS — happy path", () => {
  test.describe("geolocation granted", () => {
    test.use({
      // Playwright grants geolocation and sets the mock position for this group
      geolocation: FOREST_LOCATION,
      permissions: ["geolocation"],
    });

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page);
    });

    test("location loading step reaches 'done' after a GPS fix", async ({ page }) => {
      // The location step should transition to done class after a fix arrives
      await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    });

    test("the location gate is not shown when geolocation is pre-granted", async ({ page }) => {
      await expect(page.locator("#locationGate")).toBeHidden();
    });

    test("distance info appears as an always-visible combined distance and walk chip after a GPS fix", async ({ page }) => {
      // Navigate to a tree via URL hash (tree search toggle is hidden on desktop viewports)
      await page.goto("/nearby#tree=11383");
      await page.waitForFunction(
        () => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; },
        { timeout: 30_000 }
      );
      await page.evaluate(() => { const g = document.getElementById("locationGate"); if (g && !g.hidden) g.hidden = true; });
      const walkChip = page.locator("#inspectorBody .walk-chip").first();
      await expect(walkChip).toHaveCount(1);
      await expect(walkChip).toContainText(/\b(?:\d+\s*m|\d+(?:\.\d+)?\s*km)\s*·\s*(?:<\s*1\s*min|\d+\s*min|\d+h(?:\s*\d+min)?)/);
      await expect(page.locator("#inspectorBody .walk-chip-btn")).toHaveCount(0);
    });

    test("snapshot: map with user location active", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
      await page.waitForTimeout(800);
      await settleMapIconsAndDraw(page);
      await expect(page).toHaveScreenshot("map-with-location.png", { fullPage: false });
    });
  });

  test.describe("geolocation denied", () => {
    // No geolocation permission granted, so denyGeolocationUnlessGranted (see
    // helpers.js) answers the request with PERMISSION_DENIED straight away.

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
    });

    test("location gate is shown after geolocation is denied or times out", async ({ page }) => {
      await gotoAndWaitForMap(page);
      // The location gate should become visible once the error/timeout path runs
      await expect(page.locator("#locationGate")).toBeVisible();
    });

    test("location gate button re-enables after the gate re-appears", async ({ page }) => {
      await gotoAndWaitForMap(page);
      await expect(page.locator("#locationGateButton")).toBeEnabled();
    });

    test("location gate is a labelled, keyboard-focus-trapped dialog", async ({ page }) => {
      await gotoAndWaitForMap(page);
      const gate = page.locator("#locationGate");
      await expect(gate).toHaveAttribute("role", "dialog");
      await expect(gate).toHaveAttribute("aria-modal", "true");
      await expect(gate).toHaveAttribute("aria-labelledby", "locationGateTitle");

      // Opening the gate should have moved focus into it, onto its first control.
      await expect(page.locator("#locationGateButton")).toBeFocused();

      // A returning visit with no real fix now falls back to DEFAULT_LOCATION, so this gate
      // is the dismissible invite (see "No real location fix" in spec.md) — Tab visits its
      // "Maybe later" button next, then the privacy note's policy link...
      await page.keyboard.press("Tab");
      await expect(page.locator("#locationGateDismiss")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(gate.locator(".privacy-note a")).toBeFocused();

      // ...and a further Tab cycles back to the first button rather than escaping to the map
      // behind it.
      await page.keyboard.press("Tab");
      await expect(page.locator("#locationGateButton")).toBeFocused();
    });

    test("the gate is dismissible, and the map behind it is already usable centred on High Beach", async ({ page }) => {
      await gotoAndWaitForMap(page);
      const gate = page.locator("#locationGate");
      const dismiss = page.locator("#locationGateDismiss");
      await expect(dismiss).toBeVisible();

      await dismiss.click();
      await expect(gate).toBeHidden();

      // Dismissing the invite never granted location — DEFAULT_LOCATION's stand-in is still
      // what the map and Nearby list are centred on, not a real fix.
      const isDefault = await page.evaluate(() => Boolean(state.userLocation && state.userLocation.isDefault));
      expect(isDefault).toBe(true);
      await expect(page.locator("#inspectorBody .nearest-list li").first()).toBeVisible();
    });
  });

  test.describe("no real fix falls back to DEFAULT_LOCATION (High Beach)", () => {
    // Same denied-geolocation setup as "geolocation denied" above, but these tests are about
    // what the fallback itself looks like rather than the gate's own dialog mechanics.
    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page);
    });

    test("the map opens on DEFAULT_LOCATION with the Nearby list already populated, not the bare whole-forest outline", async ({ page }) => {
      const result = await page.evaluate(() => ({
        latitude: state.userLocation?.latitude,
        longitude: state.userLocation?.longitude,
        isDefault: state.userLocation?.isDefault,
        defaultLatitude: DEFAULT_LOCATION.latitude,
        defaultLongitude: DEFAULT_LOCATION.longitude,
      }));
      expect(result.isDefault).toBe(true);
      expect(result.latitude).toBeCloseTo(result.defaultLatitude, 5);
      expect(result.longitude).toBeCloseTo(result.defaultLongitude, 5);
      await expect(page.locator("#inspectorBody .empty")).not.toBeVisible();
      await expect(page.locator("#inspectorBody .nearest-list li").first()).toBeVisible();
    });

    test("the walking radius defaults to 30 minutes, not the ordinary 5, since the anchor isn't tied to anywhere real", async ({ page }) => {
      const minutes = await page.evaluate(() => state.walkingDistanceMinutes);
      expect(minutes).toBe(30);
    });

    test("the locate button stays visible, and the \"You\" dot is never drawn for the stand-in", async ({ page }) => {
      await expect(page.locator("#locateButton")).toBeVisible();
      const drewYouDot = await page.evaluate(() => {
        let arcCount = 0;
        const ctx = {
          save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
          arc() { arcCount += 1; }, fill() {}, stroke() {}, fillText() {},
          createRadialGradient() { return { addColorStop() {} }; },
        };
        drawUser(ctx, (p) => p, false);
        return arcCount > 0;
      });
      expect(drewYouDot).toBe(false);
    });

    test("a landing-page arrival (/nearby/<slug>, simulated here via ?show=) with no real fix is centred on High Beach too, sorted by distance rather than an unsorted full category list", async ({ page }) => {
      // scripts/generate-find-pages.js's static /nearby/<slug>/ pages aren't built for this test
      // server (they're a production/Netlify-build concern, gitignored locally) -- a ?show= link
      // on the plain Nearby path is the same landing-page-arrival code path (isLandingPageArrival(),
      // js/app.js) and, unlike /nearby/filter?show=, lands on the Nearby screen itself.
      await page.goto("/nearby?show=pubs");
      await page.waitForFunction(
        () => document.getElementById("loadingOverlay")?.hidden === true,
        { timeout: 30_000 }
      );
      const isDefault = await page.evaluate(() => state.userLocation?.isDefault);
      expect(isDefault).toBe(true);
      const firstItem = page.locator("#inspectorBody .nearest-list li").first();
      await expect(firstItem).toBeVisible();
      // A walk-time chip only renders when the list has a real origin to measure from -- the
      // old "list the whole category" fallback for landing pages rendered no distance at all.
      await expect(firstItem.locator(".walk-chip")).toBeVisible();
    });

    test("a nested category URL applies only its own subcategory filter", async ({ page }) => {
      await page.goto("/nearby/food/pubs/");
      await page.waitForFunction(() => document.getElementById("loadingOverlay")?.hidden === true, { timeout: 30_000 });
      await expect.poll(() => page.evaluate(() => state.overviewFilters)).toEqual(["pubs"]);
    });
  });

  test.describe("the location request never answers", () => {
    // The hard case, and the real-world one: a permission prompt sitting
    // unanswered on the screen. The Geolocation API's own `timeout` option does
    // not start counting until the permission decision is made, so the request
    // calls back neither way — not success, not error, not ever. Boot waits for
    // that request before revealing the map, so it needs a bound of its own or
    // the map never appears at all.
    //
    // These two wait out that whole bound on top of the normal data load, so
    // they get more room than the 60s every other test runs under.
    test.describe.configure({ timeout: 90_000 });

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await page.addInitScript(() => {
        // Registered before the helper's stub, so this one wins.
        window.__forestFindsGeolocationStubbed = true;
        navigator.geolocation.getCurrentPosition = () => {};
      });
    });

    test("the map still opens when the location request never calls back", async ({ page }) => {
      // Deliberately sits through the whole BOOT_LOCATION_TIMEOUT_MS bound on top
      // of the normal data load, so it needs more room than the default wait.
      await gotoAndWaitForMap(page, "/nearby", { timeout: 45_000 });
      await expect(page.locator("#mapCanvas")).toBeVisible();
    });

    test("and the gate offers a retry rather than leaving the reader stuck", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby", { timeout: 45_000 });
      await expect(page.locator("#locationGate")).toBeVisible();
      await expect(page.locator("#locationGateButton")).toBeEnabled();
    });
  });
});

test.describe("permission revoked mid-session", () => {
  // Granted at boot (so ensureLocationWatch() starts a real watch), then the watch itself is
  // overridden to simulate the OS/browser revoking permission after the first fix -- the one
  // case watchPosition's own error callback distinguishes (error.code === 1) from an ordinary
  // timeout. The app must keep working on what it already had rather than blocking everything
  // behind a gate for a permission that was never required in the first place.
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await page.addInitScript(() => {
      navigator.geolocation.watchPosition = (success, error) => {
        setTimeout(() => success({
          coords: { latitude: 51.6650, longitude: 0.0450, accuracy: 10 },
          timestamp: Date.now(),
        }), 0);
        setTimeout(() => error({ code: 1, PERMISSION_DENIED: 1, message: "User denied Geolocation" }), 300);
        return 1;
      };
      navigator.geolocation.clearWatch = () => {};
    });
  });

  test("does not show the blocking location gate, and the map stays usable", async ({ page }) => {
    await gotoAndWaitForMap(page);
    await expect(page.locator("#locationGate")).toBeHidden();
    await page.waitForTimeout(500); // past the simulated revoke at 300ms
    await expect(page.locator("#locationGate")).toBeHidden();
    await expect(page.locator("#mapCanvas")).toBeVisible();
    await expect(page.locator("#inspectorBody .nearest-list li").first()).toBeVisible();
  });
});
