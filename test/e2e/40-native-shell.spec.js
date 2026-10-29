// @ts-check
// The app as it runs inside the iOS/Android shell (spec/spec-native.md). window.__FORCE_NATIVE_SHIM__
// stands in for what Capacitor injects -- the platform and a Geolocation plugin -- so the client's
// native branches run in a desktop browser. The native half itself is covered by the manual device
// checklist in the spec; this guards the part ordinary web edits can break.
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap, waitForFrames } = require("./helpers");

const PRODUCTION_ORIGIN = "https://www.eppingforestfinds.uk";

async function runAsNativeApp(page, { permission = "granted" } = {}) {
  await page.addInitScript(({ permission }) => {
    window.__nativeCalls = { getCurrentPosition: 0, watchPosition: 0, browserGeolocation: 0, serviceWorker: 0, compassAsked: 0, keepAwake: [], haptics: [], shared: [], opened: [] };
    const fix = (where = { latitude: 51.665, longitude: 0.045 }) => ({ timestamp: Date.now(), coords: { ...where, accuracy: 8 } });
    let watchCallback = null;
    let headingListener = null;
    // Test hooks: move the walker, turn the phone.
    window.__emitFix = (latitude, longitude) => watchCallback && watchCallback(fix({ latitude, longitude }));
    window.__emitHeading = (reading) => headingListener && headingListener(reading);
    window.__FOREST_FINDS_BUNDLE__ = { dataVersion: "v43", generatedAt: "2026-10-27T00:00:00.000Z" };
    window.open = (url, target) => { window.__nativeCalls.opened.push({ url, target }); return null; };
    window.__FORCE_NATIVE_SHIM__ = {
      platform: "ios",
      plugins: {
        Geolocation: {
          checkPermissions: async () => ({ location: permission }),
          getCurrentPosition: async () => { window.__nativeCalls.getCurrentPosition += 1; return fix(); },
          watchPosition: (options, callback) => { window.__nativeCalls.watchPosition += 1; watchCallback = callback; setTimeout(() => callback(fix()), 0); return "w1"; },
          clearWatch: async () => {},
        },
        ForestHeading: {
          addListener: (event, callback) => { headingListener = callback; return { remove() {} }; },
          start: async () => ({ started: true }),
          stop: async () => {},
          setLocation: async () => {},
        },
        KeepAwake: {
          keepAwake: async () => { window.__nativeCalls.keepAwake.push("awake"); },
          allowSleep: async () => { window.__nativeCalls.keepAwake.push("sleep"); },
        },
        Haptics: {
          impact: async () => { window.__nativeCalls.haptics.push("select"); },
          notification: async () => { window.__nativeCalls.haptics.push("arrive"); },
        },
        Share: { share: async (what) => { window.__nativeCalls.shared.push(what); } },
        App: { getInfo: async () => ({ version: "1.0.0", build: "7" }) },
        Filesystem: { writeFile: async ({ path }) => ({ uri: `file:///data/${path}` }) },
      },
    };
    // Anything reaching the browser's own geolocation inside the shell would be WebKit's second prompt.
    window.__forestFindsGeolocationStubbed = true;
    navigator.geolocation.getCurrentPosition = () => { window.__nativeCalls.browserGeolocation += 1; };
    navigator.geolocation.watchPosition = () => { window.__nativeCalls.browserGeolocation += 1; return 1; };
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => { window.__nativeCalls.serviceWorker += 1; return new Promise(() => {}); };
    // An iOS-style WebView, where the web build would need an in-app compass ask.
    window.DeviceOrientationEvent = window.DeviceOrientationEvent || class {};
    window.DeviceOrientationEvent.requestPermission = () => { window.__nativeCalls.compassAsked += 1; return Promise.resolve("granted"); };
  }, { permission });
}

const calls = (page) => page.evaluate(() => window.__nativeCalls);

test.describe("the native app shell", () => {
  test("locates through the native plugin only, with no service worker and no compass ask", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await runAsNativeApp(page);
    await page.addInitScript(() => localStorage.setItem("ff-track-v1", "0"));
    await gotoAndWaitForMap(page);

    await expect.poll(() => page.evaluate(() => Boolean(state.userLocation && !state.userLocation.isDefault))).toBe(true);
    const seen = await calls(page);
    expect(seen.getCurrentPosition).toBe(1);
    expect(seen.browserGeolocation).toBe(0);
    expect(seen.serviceWorker).toBe(0);
    await expect(page.locator("#compassCalibrationBannerEnable")).toBeHidden();
    // The shell's grant is collected silently from the first tap, never with a card.
    await page.locator("#searchToggle").click();
    await expect.poll(async () => (await calls(page)).compassAsked).toBe(1);
    await expect(page.locator("#compassCalibrationBannerEnable")).toBeHidden();
  });

  test("calls the website's API, not the app bundle, for live data", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await runAsNativeApp(page);
    await page.addInitScript(() => localStorage.setItem("ff-track-v1", "0"));
    const cowRequest = page.waitForRequest((request) => request.url().includes("/api/cows"));
    await page.goto("/nearby");
    expect((await cowRequest).url().startsWith(`${PRODUCTION_ORIGIN}/api/cows`)).toBe(true);
  });

  test("first-run onboarding asks for location without a compass step, through the plugin", async ({ page }) => {
    await mockCowApi(page);
    await runAsNativeApp(page, { permission: "prompt" });
    await page.goto("/nearby");
    const overlay = page.locator("#onboardingOverlay");
    await expect(overlay.getByRole("heading", { name: "Before we start" })).toBeVisible();
    await expect(overlay.locator(".ob-location")).toHaveText("Enable location");
    await overlay.locator(".ob-location").click();
    await expect.poll(async () => (await calls(page)).getCurrentPosition).toBe(1);
    expect((await calls(page)).browserGeolocation).toBe(0);
  });

  test("Settings offers no sign-in that could not come back to the app, and no web update controls", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await runAsNativeApp(page);
    await page.addInitScript(() => localStorage.setItem("ff-track-v1", "0"));
    await gotoAndWaitForMap(page, "/settings");
    await expect(page.locator("#settingsAccountBody")).toContainText("not available in the app yet");
    await expect(page.locator("#settingsSignIn")).toHaveCount(0);
    // App updates come from the store; the web build's worker-driven refresh does nothing here.
    await expect(page.locator("#refreshAppButton")).toBeHidden();
  });

  test("Community says points stay on this device instead of waiting on a sign-in the app cannot reach", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await runAsNativeApp(page);
    await page.addInitScript(() => localStorage.setItem("ff-track-v1", "0"));
    // /api/auth/* is not open to the app's origins, so from the shell it fails the way CORS would.
    let identityChecks = 0;
    await page.route("**/api/auth/**", (route) => { identityChecks += 1; return route.abort(); });
    await gotoAndWaitForMap(page, "/community");
    const account = page.locator("#communityAccount");
    await expect(account).toContainText("Your points stay on this device");
    await expect(account.locator(".is-loading")).toHaveCount(0);
    await expect(account.locator("a[href^='/api/auth/login']")).toHaveCount(0);
    await expect(page.locator(".community-contributions")).toBeVisible();
    expect(identityChecks).toBe(0);
  });

  test("the true-north heading from the native plugin turns the map, and WebKit's own heading is then ignored", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await runAsNativeApp(page);
    await page.addInitScript(() => localStorage.setItem("ff-track-v1", "0"));
    await gotoAndWaitForMap(page);
    // An accurate reading is trusted at once, with no wait for agreeing samples.
    await page.evaluate(() => window.__emitHeading({ trueHeading: 90, magneticHeading: 89, accuracy: 5 }));
    await expect.poll(() => page.evaluate(() => state.compassHeading)).toBe(90);
    await page.evaluate(() => {
      const event = new Event("deviceorientation");
      Object.assign(event, { alpha: 10, beta: 20, gamma: 0, webkitCompassHeading: 250, webkitCompassAccuracy: 5 });
      window.dispatchEvent(event);
    });
    await waitForFrames(page, 10);
    expect(await page.evaluate(() => state.compassHeadingTarget)).toBe(90);
  });

  test("walking to a find keeps the screen awake, arriving is felt once, and leaving lets the screen sleep", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await runAsNativeApp(page);
    await page.addInitScript(() => localStorage.setItem("ff-track-v1", "0"));
    await gotoAndWaitForMap(page, "/nearby#tree=r17338");
    await expect.poll(async () => (await calls(page)).keepAwake.at(-1)).toBe("awake");

    const tree = await page.evaluate(() => ({ latitude: state.selected.item.latitude, longitude: state.selected.item.longitude }));
    await page.evaluate(({ latitude, longitude }) => window.__emitFix(latitude, longitude), tree);
    await expect.poll(async () => (await calls(page)).haptics.filter((h) => h === "arrive").length).toBe(1);
    await page.evaluate(({ latitude, longitude }) => window.__emitFix(latitude, longitude), tree);
    await waitForFrames(page, 5);
    expect((await calls(page)).haptics.filter((h) => h === "arrive").length).toBe(1);

    await page.locator("#nearbyToggle").click();
    await expect.poll(async () => (await calls(page)).keepAwake.at(-1)).toBe("sleep");
  });

  test("sharing a find from the app shares its website address through the native share sheet", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await runAsNativeApp(page);
    await page.addInitScript(() => {
      localStorage.setItem("ff-track-v1", "0");
      // A WebView that is not a secure context exposes neither browser API; the plugin alone shares.
      delete Navigator.prototype.share;
      delete Navigator.prototype.clipboard;
    });
    await gotoAndWaitForMap(page, "/nearby#tree=r17338");
    await page.locator("[data-action='share-location']").first().click();
    await expect.poll(async () => (await calls(page)).shared.length).toBe(1);
    const [shared] = (await calls(page)).shared;
    expect(shared.url).toBe(`${PRODUCTION_ORIGIN}/nearby#tree=r17338`);
  });

  test("a page that only exists on the website opens there, in the browser, rather than inside the app", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await runAsNativeApp(page);
    await page.addInitScript(() => localStorage.setItem("ff-track-v1", "0"));
    await gotoAndWaitForMap(page, "/settings");
    const settingsUrl = page.url();
    await page.locator(".settings-section", { hasText: "Usage analytics" }).getByRole("link", { name: "Privacy Policy" }).click();
    await expect.poll(async () => (await calls(page)).opened.length).toBe(1);
    expect((await calls(page)).opened[0].url).toBe(`${PRODUCTION_ORIGIN}/terms.html`);
    expect(page.url()).toBe(settingsUrl);
  });

  test("Settings shows the store version with the map data release, and checks the website for newer data", async ({ page }) => {
    await skipOnboarding(page);
    await mockCowApi(page);
    await runAsNativeApp(page);
    await page.addInitScript(() => localStorage.setItem("ff-track-v1", "0"));
    const manifest = { dataVersion: "v43", files: {} };
    await page.route(`${PRODUCTION_ORIGIN}/data/manifest.json`, (route) => route.fulfill({ json: manifest }));
    await page.route("**/data/manifest.json", (route) => route.fulfill({ json: manifest }));
    await gotoAndWaitForMap(page, "/settings");
    await expect(page.locator("#appVersionDisplay")).toHaveText("1.0.0 (7) · data v43");
    await page.locator("#nativeDataCheckButton").click();
    await expect(page.locator("#nativeDataStatus")).toHaveText("Map data is up to date.");
  });
});
