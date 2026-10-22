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

    test("the High Beach stand-in notice is not shown with a real fix", async ({ page }) => {
      await expect(page.locator("#inspectorBody")).not.toContainText("Showing things near High Beach");
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

    test("the location invite banner is shown after geolocation is denied or times out, not a blocking gate", async ({ page }) => {
      await gotoAndWaitForMap(page);
      // A returning visit with no real fix falls back to DEFAULT_LOCATION (see "No real
      // location fix" in spec.md), so what invites a real fix here is the same non-blocking,
      // dismissible banner showCombinedConsentBanner() uses for its own ask — never the opaque,
      // full-screen #locationGate modal the hard-stop prompts elsewhere on this page use. The map
      // and list behind it are already usable, so there is nothing to block.
      await expect(page.locator("#locationInviteBanner")).toBeVisible();
      await expect(page.locator("#locationGate")).toBeHidden();
      await expect(page.locator("#locationInviteButton")).toBeEnabled();
    });

    test("the invite is not a modal — it has no dialog role and does not trap focus", async ({ page }) => {
      await gotoAndWaitForMap(page);
      const banner = page.locator("#locationInviteBanner");
      await expect(banner).not.toHaveAttribute("role", "dialog");
      await expect(banner).not.toHaveAttribute("aria-modal", "true");
      // Focus is never forced onto it — the reader can keep using the map/list behind it.
      const focusedId = await page.evaluate(() => document.activeElement?.id || null);
      expect(focusedId).not.toBe("locationInviteButton");
    });

    test("the invite is dismissible, and the map behind it is already usable centred on High Beach", async ({ page }) => {
      await gotoAndWaitForMap(page);
      const banner = page.locator("#locationInviteBanner");
      const dismiss = page.locator("#locationInviteDismiss");
      await expect(dismiss).toBeVisible();

      await dismiss.click();
      await expect(banner).toBeHidden();

      // Dismissing the invite never granted location — DEFAULT_LOCATION's stand-in is still
      // what the map and Nearby list are centred on, not a real fix.
      const isDefault = await page.evaluate(() => Boolean(state.userLocation && state.userLocation.isDefault));
      expect(isDefault).toBe(true);
      await expect(page.locator("#inspectorBody .nearest-list li").first()).toBeVisible();
    });

    test("tapping the invite's own button requests a real fix, the same way the combined consent banner's does", async ({ page }) => {
      await gotoAndWaitForMap(page);
      await page.evaluate(() => {
        navigator.geolocation.getCurrentPosition = (success) => success({
          coords: { latitude: 51.6650, longitude: 0.0450, accuracy: 10 },
          timestamp: Date.now(),
        });
      });
      await page.locator("#locationInviteButton").click();
      await expect.poll(() => page.evaluate(() => Boolean(state.userLocation && !state.userLocation.isDefault))).toBe(true);
      await expect(page.locator("#locationInviteBanner")).toBeHidden();
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

    test("the list says it is showing High Beach because no location was shared, for as long as the stand-in is active", async ({ page }) => {
      // Folded into the Nearby heading's own type line (overviewHeadingText(), js/app.js) rather
      // than a separate sentence at the top of the list body -- see spec.md "No real location fix".
      await expect(page.locator("#inspectorType")).toContainText("of High Beach");
    });

    test("the walking radius keeps the ordinary 5-minute default while the anchor is temporary", async ({ page }) => {
      const minutes = await page.evaluate(() => state.walkingDistanceMinutes);
      expect(minutes).toBe(DEFAULT_WALKING_DISTANCE_MINUTES);
    });

    test("there is no duplicate location button, and the \"You\" dot is never drawn for the stand-in", async ({ page }) => {
      await expect(page.locator("#locateButton")).toHaveCount(0);
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

    test("a no-location location page keeps the map visible without opening the compass gate", async ({ page }) => {
      // startCompassNavigation() (js/app.js) bails out before showing #locationGate's blocking
      // compass-permission prompt while hasRealLocation() is false -- a default-location stand-in
      // is not a real fix to navigate from. The map and Nearby list behind it stay usable either way.
      await page.goto("/nearby#tree=11383");
      await page.waitForFunction(() => document.getElementById("loadingOverlay")?.hidden === true, { timeout: 30_000 });

      await expect(page.locator("#locationGate")).toBeHidden();
      await expect(page.locator("#mapCanvas")).toBeVisible();
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

    test("and the invite banner offers a retry rather than leaving the reader stuck", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby", { timeout: 45_000 });
      await expect(page.locator("#locationInviteBanner")).toBeVisible();
      await expect(page.locator("#locationInviteButton")).toBeEnabled();
    });
  });
});

test.describe("compass access on motion-permission browsers", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test("offers a user-gesture compass action after GPS has already resolved", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await page.addInitScript(() => {
      if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = class {};
      window.DeviceOrientationEvent.requestPermission = () => {
        window.__forestFindsCompassPermissionRequested = true;
        return Promise.resolve("granted");
      };
    });
    await gotoAndWaitForMap(page);

    await expect(page.locator("#compassCalibrationBanner")).toBeVisible();
    await expect(page.locator("#compassCalibrationBannerEnable")).toBeVisible();
    await page.locator("#compassCalibrationBannerEnable").click();
    await expect.poll(() => page.evaluate(() => state.compassPermission)).toBe("granted");
    await expect.poll(() => page.evaluate(() => Boolean(window.__forestFindsCompassPermissionRequested))).toBe(true);
    await expect(page.locator("#compassCalibrationBanner")).toBeHidden();
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

test.describe("Asking for location from an empty Nearby list", () => {
  test.use({ permissions: ["geolocation"] });

  test("shows a requesting-location state in place of the empty list until the fix arrives", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    // Hold the location callback so the loading state is on screen long enough to assert.
    await page.evaluate(() => {
      window.__locationCallbacks = null;
      navigator.geolocation.getCurrentPosition = (success, error) => { window.__locationCallbacks = { success, error }; };
      els.inspectorBody.innerHTML = "";
      locateUser({ initial: false });
    });
    await expect(page.locator("#inspectorBody .nearby-locating")).toBeVisible();
    await page.evaluate(() => window.__locationCallbacks.success({
      coords: { latitude: 51.6650, longitude: 0.0450, accuracy: 10 },
      timestamp: Date.now(),
    }));
    await expect(page.locator("#inspectorBody .nearby-locating")).toHaveCount(0);
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
  });

  test("a refused compass does not open the full-screen location gate", async ({ page }) => {
    await page.addInitScript(() => {
      // iOS-style compass: permission exists and is refused when asked.
      window.DeviceOrientationEvent = class {};
      window.DeviceOrientationEvent.requestPermission = () => Promise.resolve("denied");
    });
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await page.evaluate(() => locateUser({ initial: false }));
    await expect.poll(() => page.evaluate(() => state.compassPermission)).toBe("denied");
    await expect(page.locator("#locationGate")).toBeHidden();
    await expect(page.locator("#inspectorBody .nearest-item").first()).toBeVisible();
  });
});
