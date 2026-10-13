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

    test("the non-blocking consent banner is shown after geolocation is denied or times out, not the full-screen gate", async ({ page }) => {
      await gotoAndWaitForMap(page);
      // revealNoRealLocation()'s soft "would you like to enable location" ask now uses the same
      // #consentBanner as the landing-page combined ask (see 29-cookie-consent.spec.js), not the
      // full-screen #locationGate -- that's reserved for the hard-stop cases below.
      const banner = page.locator("#consentBanner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("Get a more custom experience");
      await expect(banner).toHaveAttribute("role", "group");
      await expect(page.locator("#locationGate")).toBeHidden();
    });

    test("the banner never traps focus, and the map behind it is already usable centred on High Beach", async ({ page }) => {
      await gotoAndWaitForMap(page);
      await expect(page.locator("#consentBanner")).toBeVisible();

      // Unlike #locationGate, showLocationOnlyConsentBanner() never calls activateModalFocus --
      // the map stays fully interactive underneath while the banner is on screen.
      await expect(page.locator("#inspectorBody .nearest-list li").first()).toBeVisible();
      const isDefault = await page.evaluate(() => Boolean(state.userLocation && state.userLocation.isDefault));
      expect(isDefault).toBe(true);
    });

    test("'Maybe later' hides the banner without granting location", async ({ page }) => {
      await gotoAndWaitForMap(page);
      const banner = page.locator("#consentBanner");
      await expect(banner).toBeVisible();

      await page.locator("#consentBannerDecline").click();
      await expect(banner).toBeHidden();

      // Declining the invite never granted location — DEFAULT_LOCATION's stand-in is still what
      // the map and Nearby list are centred on, not a real fix.
      const isDefault = await page.evaluate(() => Boolean(state.userLocation && state.userLocation.isDefault));
      expect(isDefault).toBe(true);
    });

    test("tapping Enable re-asks for location, and a renewed denial surfaces the hard-stop gate", async ({ page }) => {
      await gotoAndWaitForMap(page);
      const banner = page.locator("#consentBanner");
      await expect(banner).toBeVisible();
      await expect(page.locator("#consentBannerAccept")).toHaveText("Enable location");

      await page.locator("#consentBannerAccept").click();
      await expect(banner).toBeHidden();

      // denyGeolocationUnlessGranted answers every request the same way, so the retry this tap
      // triggers is denied again -- this time as an explicit, in-the-moment blocked permission,
      // which is a true hard stop (unlike the soft invite above) and so still uses the
      // full-screen, focus-trapped #locationGate.
      const gate = page.locator("#locationGate");
      await expect(gate).toBeVisible();
      await expect(gate).toHaveAttribute("role", "dialog");
      await expect(gate).toHaveAttribute("aria-modal", "true");
      await expect(page.locator("#locationGateMessage")).toContainText("blocked");
      await expect(page.locator("#locationGateButton")).toBeFocused();
    });
  });

  test.describe("no real fix falls back to DEFAULT_LOCATION (High Beach)", () => {
    // Same denied-geolocation setup as "geolocation denied" above, but these tests are about
    // what the fallback itself looks like rather than the banner/gate mechanics.
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

    test("the \"You\" dot is never drawn for the stand-in", async ({ page }) => {
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

    test("and the consent banner offers a retry rather than leaving the reader stuck", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby", { timeout: 45_000 });
      await expect(page.locator("#consentBanner")).toBeVisible();
      await expect(page.locator("#consentBannerAccept")).toBeEnabled();
    });
  });
});
