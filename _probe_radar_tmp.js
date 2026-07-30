const { chromium } = require("playwright");
const cowFixture = require("./test/e2e/fixtures/cows.json");
const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    geolocation: FOREST_LOCATION,
    permissions: ["geolocation"],
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("forest-finds-onboarding-v1", "done");
  });
  await page.route("**/api/cows**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cowFixture) })
  );
  await page.goto("http://localhost:8080/");
  await page.waitForFunction(() => {
    const el = document.getElementById("loadingOverlay");
    return !el || el.hidden === true;
  }, { timeout: 30000 });
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-load-step='location']");
    return el && el.classList.contains("done");
  }, { timeout: 10000 });
  await page.waitForTimeout(500);

  // Fire a fake compass event with a fixed heading, repeatedly, to simulate a real
  // device continuously reporting orientation (keeps headingUpCompassSensorActive true).
  async function fireCompass(headingDeg) {
    await page.evaluate((h) => {
      window.__fakeCompassInterval && clearInterval(window.__fakeCompassInterval);
      const fire = () => {
        const ev = new Event("deviceorientation");
        Object.defineProperty(ev, "webkitCompassHeading", { value: h });
        Object.defineProperty(ev, "alpha", { value: (360 - h) });
        Object.defineProperty(ev, "beta", { value: 5 }); // flat, below tilt threshold
        window.dispatchEvent(ev);
      };
      fire();
      window.__fakeCompassInterval = setInterval(fire, 100);
    }, headingDeg);
  }

  async function snap(label) {
    await page.waitForTimeout(700);
    const s = await page.evaluate(() => {
      const canvasTransform = els.canvas.style.transform;
      const overlayTransform = els.overlayCanvas ? els.overlayCanvas.style.transform : null;
      return {
        compassHeading: state.compassHeading,
        renderedNavigationHeading: state.renderedNavigationHeading,
        headingUpActive: headingUpActive(),
        tiltActive: tiltActive(),
        tiltBetaSmoothed: state.tiltBetaSmoothed,
        canvasTransform,
        overlayTransform,
        selected: state.selected && state.selected.type,
        filterScreenOpen: state.filterScreenOpen,
        viewportScale: state.viewport.scale,
      };
    });
    console.log(label, JSON.stringify(s));
  }

  await fireCompass(90);
  await snap("nearby, heading=90");

  await page.click("#filterToggle");
  await snap("filter, heading=90 (unchanged)");

  await page.click("#settingsToggle");
  await snap("settings, heading=90 (unchanged)");

  await page.click("#reportToggle");
  await snap("report, heading=90 (unchanged)");

  await page.click("#nearbyToggle");
  await snap("back to nearby, heading=90 (unchanged)");

  await browser.close();
})();
