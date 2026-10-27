// @ts-check
// The app as it runs inside the iOS/Android shell (spec/spec-native.md). window.__FORCE_NATIVE_SHIM__
// stands in for what Capacitor injects -- the platform and a Geolocation plugin -- so the client's
// native branches run in a desktop browser. The native half itself is covered by the manual device
// checklist in the spec; this guards the part ordinary web edits can break.
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

const PRODUCTION_ORIGIN = "https://www.eppingforestfinds.uk";

async function runAsNativeApp(page, { permission = "granted" } = {}) {
  await page.addInitScript(({ permission }) => {
    window.__nativeCalls = { getCurrentPosition: 0, watchPosition: 0, browserGeolocation: 0, serviceWorker: 0, compassAsked: 0 };
    const fix = () => ({ timestamp: Date.now(), coords: { latitude: 51.665, longitude: 0.045, accuracy: 8 } });
    window.__FORCE_NATIVE_SHIM__ = {
      platform: "ios",
      plugins: {
        Geolocation: {
          checkPermissions: async () => ({ location: permission }),
          getCurrentPosition: async () => { window.__nativeCalls.getCurrentPosition += 1; return fix(); },
          watchPosition: (options, callback) => { window.__nativeCalls.watchPosition += 1; setTimeout(() => callback(fix()), 0); return "w1"; },
          clearWatch: async () => {},
        },
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
    await expect(overlay.getByRole("heading", { name: "Your location" })).toBeVisible();
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
});
