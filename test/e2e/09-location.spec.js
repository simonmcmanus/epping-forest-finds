// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, skipOnboarding, mockCowApi, gotoAndWaitForMap, settleMapIconsAndDraw, waitForFrames, waitForUiToSettle } = require("./helpers");

// A GPS fix inside Epping Forest
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };
const DEFAULT_WALKING_DISTANCE_MINUTES = 5;

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

    test("snapshot: map with user location active", async ({ page }) => {
      await waitForUiToSettle(page);
      await settleMapIconsAndDraw(page);
      await expect(page).toHaveScreenshot("map-with-location.png", { fullPage: false });
    });

    test("on a train, the You marker keeps moving between GPS fixes rather than holding still and then jumping", async ({ page, context }) => {
      await page.waitForFunction((start) => state.rawUserLocation && state.rawUserLocation.latitude === start, FOREST_LOCATION.latitude);
      // A fix a second, 15m north each, at 15 m/s: the speed the phone's own GPS reports on a moving
      // train. Playwright's setGeolocation has no speed field, so the fixes go through the DevTools protocol.
      const cdp = await context.newCDPSession(page);
      // Sample the marker on every animation frame, in the page, tagged with the fix it last saw.
      await page.evaluate(() => {
        window.__trainFrames = [];
        const sample = () => {
          window.__trainFrames.push({ lat: state.userLocation.latitude, fix: state.rawUserLocation.latitude });
          if (window.__trainFrames.length < 600) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      for (let step = 1; step <= 4; step += 1) {
        const target = FOREST_LOCATION.latitude + step * 0.000135;
        await cdp.send("Emulation.setGeolocationOverride", { ...FOREST_LOCATION, latitude: target, speed: 15 });
        await page.waitForFunction((fix) => state.rawUserLocation.latitude === fix, target);
        await page.evaluate(() => { window.__fixAt = performance.now(); });
        // A GPS receiver delivers about one fix a second: wait for the next one's second to come round.
        if (step < 4) await page.waitForFunction(() => performance.now() >= window.__fixAt + 1000);
      }
      const frames = await page.evaluate(() => window.__trainFrames);
      // Frame pairs with no new fix between them: the marker should still be moving across them.
      const pairs = [];
      for (let i = 1; i < frames.length; i += 1) {
        if (frames[i].fix === frames[i - 1].fix) pairs.push(frames[i].lat !== frames[i - 1].lat);
      }
      const moved = pairs.filter(Boolean).length;
      // Frame rate varies with machine load, so only require enough frames to judge; the ratio is the assertion.
      expect(pairs.length).toBeGreaterThan(10);
      expect(moved / pairs.length).toBeGreaterThan(0.8);
    });

    test("a visitor inside the forest is not told they are far from it", async ({ page }) => {
      // The distance check runs as the location step completes, which gotoAndWaitForMap waited for.
      await expect(page.locator("#locationInviteBanner")).toBeHidden();
      await expect(page.getByText("too far away to use the app fully")).toHaveCount(0);
    });
  });

  test.describe("far from the forest", () => {
    // Trafalgar Square: about 21 km from High Beach, well beyond the forest.
    test.use({ geolocation: { latitude: 51.508, longitude: -0.1281, accuracy: 10 }, permissions: ["geolocation"] });

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page);
    });

    const notice = (page) => page.locator("#locationInviteBanner");

    test("says the visitor is too far away to use the app fully, in a notice rather than a blocking dialog", async ({ page }) => {
      await expect(notice(page)).toBeVisible();
      await expect(notice(page)).toContainText("You're too far away to use the app fully");
      await expect(notice(page)).toContainText("High Beach");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("the notice offers no 'Enable location' button, and OK dismisses it", async ({ page }) => {
      await expect(notice(page)).toBeVisible();
      await expect(notice(page).getByRole("button", { name: "Enable location" })).toBeHidden();
      await notice(page).getByRole("button", { name: "OK" }).click();
      await expect(notice(page)).toBeHidden();
    });

    test("dismissing the notice does not record a declined location choice", async ({ page }) => {
      await notice(page).getByRole("button", { name: "OK" }).click();
      await expect(notice(page)).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem("ff-location-v1"))).not.toBe("declined");
    });

    test("Nearby is centred on High Beach rather than on the visitor", async ({ page }) => {
      const origin = await page.evaluate(() => ({ lat: nearbyOrigin().latitude, lon: nearbyOrigin().longitude, you: state.userLocation.latitude }));
      expect(origin.lat).toBeCloseTo(51.667591, 4);
      expect(origin.lon).toBeCloseTo(0.037454, 4);
      expect(origin.you).toBeCloseTo(51.508, 3);
      await expect(page.locator("#inspectorType")).toContainText("of High Beach");
    });

    test("while browsing a spot the bar keeps its wording but offers no 'Use my location' button", async ({ page }) => {
      await page.evaluate(() => setNearbyAnchor(51.66, 0.02, projectLonLat(0.02, 51.66), "Chingford"));
      await expect(page.locator("#nearbyAnchorBar")).toBeVisible();
      await expect(page.locator("#nearbyAnchorBar .nearby-anchor-bar-text")).toContainText("Chingford");
      await expect(page.locator("#nearbyAnchorBar [data-action='reset-nearby-anchor']")).toBeHidden();
    });

    test("a pin on the map opens from here", async ({ page }) => {
      // A tree drawn where a tap reaches it (not under the sheet or the notice), found with the tap
      // handler's own hit test. Nothing tappable on screen would be a broken precondition, so the
      // test fails rather than skipping. The outside-the-ring case is covered in forest-finds.test.js.
      const pin = await page.evaluate(() => {
        const canvas = els.canvas;
        const rect = canvas.getBoundingClientRect();
        const origin = nearbyOrigin();
        // worldToScreen() is in backing-store pixels; the tap and the viewport are CSS pixels.
        const dpr = pixelRatio();
        const byDistance = state.trees
          .filter((tree) => Number.isFinite(tree.latitude) && Number.isFinite(tree.longitude))
          .map((tree) => ({ tree, d: Math.hypot(tree.latitude - origin.latitude, tree.longitude - origin.longitude) }))
          .sort((a, b) => a.d - b.d);
        for (const { tree } of byDistance) {
          const s = worldToScreen(projectLonLat(tree.longitude, tree.latitude));
          const x = s.x / dpr + rect.left;
          const y = s.y / dpr + rect.top;
          if (x < 8 || y < 8 || x > innerWidth - 8 || y > innerHeight - 8) continue;
          const hit = document.elementFromPoint(x, y);
          if (!hit || hit.closest("#inspector, nav, .consent-banner")) continue;
          // Ask the tap handler's own hit test what a tap here would land on: a tree, not a road, a
          // label or a cluster badge drawn over it.
          const screen = { x: s.x, y: s.y };
          if (findClusterHit(screen)) continue;
          if (findHit(screen, screenToWorld(screen.x, screen.y)).type !== "tree") continue;
          return { x, y };
        }
        return null;
      });
      expect(pin, "a tree is drawn where it can be tapped (the map is framed on High Beach, so one should be in view)").not.toBeNull();
      await page.mouse.click(pin.x, pin.y);
      await expect(page.locator("#inspectorBody .detail-top-row, #inspectorBody .tree-detail").first()).toBeVisible();
      await expect(page.locator("#inspectorBody .walk-chip")).toHaveCount(0);
    });

    test("a selected place is shown without directions", async ({ page }) => {
      await page.goto("/nearby#tree=11383");
      await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.hidden === true; });
      await expect(page.locator("#inspectorBody .detail-top-row, #inspectorBody .tree-detail").first()).toBeVisible();
      await expect(page.locator("#inspectorBody .walk-chip")).toHaveCount(0);
      await expect(page.locator("#compassArrow, .title-compass-arrow").first()).toBeHidden();
    });

    test("with a place selected, a turn of the compass still turns the map, about High Beach", async ({ page }) => {
      await page.goto("/nearby#tree=11383");
      await page.waitForFunction(() => state.selected && state.selected.type === "tree");
      // Steady readings, as a phone reports them while held still. Chrome reports the heading as
      // 360 minus alpha, so alpha 300 faces 60 degrees.
      await page.evaluate(async () => {
        for (let i = 0; i < 40; i += 1) {
          window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 300, beta: 0, gamma: 0, absolute: true }));
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      });
      await expect.poll(() => page.evaluate(() => headingUpActive())).toBe(true);
      await expect.poll(() => page.evaluate(() => Math.round(currentNavigationMapRotationDegrees()))).toBe(-60);
      expect(await page.evaluate(() => navigationOriginPoint() === highBeachStandIn().point)).toBe(true);
    });

    test("a place page shows the place but no walking distance or compass arrow", async ({ page }) => {
      const key = await page.evaluate(() => placeHashKey(state.landmarks.find((p) => p.latitude != null && p.name)));
      const name = await page.evaluate(() => state.landmarks.find((p) => p.latitude != null && p.name).name);
      await page.goto(`/nearby#place=${key}`);
      await expect(page.locator("#inspectorBody")).toContainText(name);
      await expect(page.locator("#inspectorBody .walk-chip, #inspectorBody .walk-chip-pending")).toHaveCount(0);
      await expect(page.locator("#compassArrow")).toBeHidden();
    });

    test("snapshot: far from the forest notice", async ({ page }) => {
      await expect(notice(page)).toBeVisible();
      await waitForUiToSettle(page);
      await settleMapIconsAndDraw(page);
      await expect(page).toHaveScreenshot("distance-warning.png", { fullPage: false });
    });
  });

  test.describe("geolocation denied", () => {
    // No geolocation permission granted, so denyGeolocationUnlessGranted (see
    // helpers.js) answers the request with PERMISSION_DENIED straight away.

    test.beforeEach(async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
    });

    // An app screen with no static Nearby list under it: on bare /nearby once the build has run
    // (as on CI), the same first ask is #consentBanner's location stage instead (39-permission-asks).
    const SCREEN = "/nearby/search";

    test("the first location ask is the non-blocking card, not a blocking gate", async ({ page }) => {
      await gotoAndWaitForMap(page, SCREEN);
      // A returning visit with no real fix falls back to DEFAULT_LOCATION (see "No real
      // location fix" in spec.md), so what invites a real fix here is the same non-blocking,
      // dismissible banner showCombinedConsentBanner() uses for its own ask — never the opaque,
      // full-screen #locationGate modal the hard-stop prompts elsewhere on this page use. The map
      // and list behind it are already usable, so there is nothing to block.
      await expect(page.locator("#consentBanner")).toBeVisible();
      await expect(page.locator("#locationGate")).toBeHidden();
      await expect(page.locator("#consentBannerAccept")).toBeEnabled();
    });

    test("the invite is not a modal — it has no dialog role and does not trap focus", async ({ page }) => {
      await gotoAndWaitForMap(page, SCREEN);
      const banner = page.locator("#locationInviteBanner");
      await expect(banner).not.toHaveAttribute("role", "dialog");
      await expect(banner).not.toHaveAttribute("aria-modal", "true");
      // Focus is never forced onto it — the reader can keep using the map/list behind it.
      const focusedId = await page.evaluate(() => document.activeElement?.id || null);
      expect(focusedId).not.toBe("locationInviteButton");
    });

    test("the invite is dismissible, and the map behind it is already usable centred on High Beach", async ({ page }) => {
      await gotoAndWaitForMap(page, SCREEN);
      const banner = page.locator("#consentBanner");
      const dismiss = page.locator("#consentBannerDecline");
      await expect(dismiss).toHaveText("Maybe later");

      await dismiss.click();
      await expect(banner).toContainText("We'll set your location as High Beach");
      await dismiss.click();
      await expect(banner).toBeHidden();

      // Dismissing the invite never granted location — DEFAULT_LOCATION's stand-in is still
      // what the map and Nearby list are centred on, not a real fix.
      const isDefault = await page.evaluate(() => Boolean(state.userLocation && state.userLocation.isDefault));
      expect(isDefault).toBe(true);
      await page.locator("#nearbyToggle").click();
      await expect(page.locator("#inspectorBody .nearest-list li").first()).toBeVisible();
    });

    test("tapping the card's own button requests a real fix", async ({ page }) => {
      await gotoAndWaitForMap(page, SCREEN);
      await page.evaluate(() => {
        navigator.geolocation.getCurrentPosition = (success) => success({
          coords: { latitude: 51.6650, longitude: 0.0450, accuracy: 10 },
          timestamp: Date.now(),
        });
      });
      await page.locator("#consentBannerAccept").click();
      await expect.poll(() => page.evaluate(() => Boolean(state.userLocation && !state.userLocation.isDefault))).toBe(true);
      await expect(page.locator("#consentBanner")).toBeHidden();
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

    test("the High Beach to real-location handoff flies out and settles instead of jolting", async ({ page }) => {
      const result = await page.evaluate(async () => {
        stopViewportAnimation();
        const start = { ...state.viewport };
        applyLocationFix({
          coords: { latitude: 51.6650, longitude: 0.0450, accuracy: 10 },
        });
        ensureOverviewTargetsVisible({ animate: true, cinematic: true, force: true, durationMs: 900 });

        const scales = [];
        await new Promise((resolve) => {
          const sample = () => {
            scales.push(state.viewport.scale);
            if (state.viewportAnimationFrame == null) resolve();
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        const cinematicEnd = { ...state.viewport };
        stopViewportAnimation();
        ensureOverviewTargetsVisible({ animate: false, force: true });
        const settled = { ...state.viewport };
        return {
          startScale: start.scale,
          endScale: cinematicEnd.scale,
          minimumScale: Math.min(...scales),
          settled,
          cinematicEnd,
        };
      });

      expect(result.minimumScale).toBeLessThan(Math.min(result.startScale, result.endScale) * 0.98);
      expect(result.cinematicEnd.scale).toBeCloseTo(result.settled.scale, 5);
      expect(result.cinematicEnd.tx).toBeCloseTo(result.settled.tx, 2);
      expect(result.cinematicEnd.ty).toBeCloseTo(result.settled.ty, 2);
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
        // Someone who turned location on before: the one case in which boot asks by itself, and
        // so the one in which a request that never answers can hold boot up (bootMayRequestLocation).
        localStorage.setItem("ff-location-v1", "granted");
        // Registered before the helper's stub, so this one wins.
        window.__forestFindsGeolocationStubbed = true;
        navigator.geolocation.getCurrentPosition = () => {};
      });
    });

    test("the map still opens when the location request never calls back", async ({ page }) => {
      // Deliberately sits through the whole BOOT_LOCATION_TIMEOUT_MS bound on top
      // of the normal data load, so it needs more room than the default wait.
      await gotoAndWaitForMap(page, "/nearby/search", { timeout: 45_000 });
      await expect(page.locator("#mapCanvas")).toBeVisible();
    });

    test("and the invite banner offers a retry rather than leaving the reader stuck", async ({ page }) => {
      await gotoAndWaitForMap(page, "/nearby/search", { timeout: 45_000 });
      await expect(page.locator("#locationInviteBanner")).toBeVisible();
      await expect(page.locator("#locationInviteButton")).toBeEnabled();
    });
  });
});

test.describe("compass access on motion-permission browsers", () => {
  test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

  test("requests compass access from the shared location notice", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await page.addInitScript(() => {
      window.__forestFindsGeolocationStubbed = true;
      navigator.permissions.query = () => Promise.resolve({ state: "prompt" });
      navigator.geolocation.getCurrentPosition = (success) => success({
        coords: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, timestamp: Date.now(),
      });
      navigator.geolocation.watchPosition = () => 1;
      if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = class {};
      window.__compassRequests = 0;
      window.DeviceOrientationEvent.requestPermission = () => {
        window.__compassRequests += 1;
        return Promise.resolve("granted");
      };
    });
    await gotoAndWaitForMap(page, "/nearby?show=pubs");
    expect(await page.evaluate(() => window.__compassRequests)).toBe(0);
    await page.locator("#consentBannerAccept").click();
    await expect.poll(() => page.evaluate(() => state.compassPermission)).toBe("granted");
    expect(await page.evaluate(() => window.__compassRequests)).toBe(1);
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

  test("the map stays usable after location permission is revoked mid-session", async ({ page }) => {
    await gotoAndWaitForMap(page);
    await waitForFrames(page, 30);
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
