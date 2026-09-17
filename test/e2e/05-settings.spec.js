// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

test.describe("Settings screen", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.click("#settingsToggle");
    // Wait for the settings panel to render
    await expect(page.locator("#settingsWalkMins")).toBeVisible();
  });

  test("settings button opens the settings screen", async ({ page }) => {
    await expect(page.locator("#settingsToggle")).toHaveClass(/screen-active/);
  });

  test("settings screen shows a walking radius slider", async ({ page }) => {
    await expect(page.locator("#settingsWalkMins")).toHaveAttribute("type", "range");
  });

  // Sets the slider's value directly and fires "input" the way a real drag would, rather than
  // relying on Playwright's fill() (built for text-like inputs, not always reliable on range).
  async function setWalkSlider(page, value) {
    await page.locator("#settingsWalkMins").evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }

  test("dragging the walking radius slider updates the live minute label", async ({ page }) => {
    const max = await page.locator("#settingsWalkMins").getAttribute("max");
    await setWalkSlider(page, max);
    await expect(page.locator("#settingsWalkMinsValue")).toHaveText(`${max} min`);
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(Number(max));
  });

  test("dragging the walking radius slider down to its floor reveals the limit note", async ({ page }) => {
    const slider = page.locator("#settingsWalkMins");
    const min = await slider.getAttribute("min");
    const max = await slider.getAttribute("max");

    await setWalkSlider(page, min);
    await expect(page.locator("#settingsWalkMinsFloorNote")).toBeVisible();

    await setWalkSlider(page, max);
    await expect(page.locator("#settingsWalkMinsFloorNote")).toBeHidden();
  });

  test("settings screen shows the app version in the About section", async ({ page }) => {
    await expect(page.locator("#appVersionDisplay")).toBeVisible();
    // Should start with 'v' — e.g. "v120"
    await expect(page.locator("#appVersionDisplay")).toContainText("v");
  });

  test("settings screen stays open when the map canvas is tapped", async ({ page }) => {
    await page.locator("#mapCanvas").click({ position: { x: 200, y: 200 } });
    await expect(page.locator("#settingsToggle")).toHaveClass(/screen-active/);
  });

  test("nearby button returns to overview from settings", async ({ page }) => {
    await page.click("#nearbyToggle");
    // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby")
    );
  });

  test("settings screen offers separate data, app and combined refresh buttons", async ({ page }) => {
    await expect(page.locator("#refreshDataButton")).toHaveText("Refresh data");
    await expect(page.locator("#refreshAppButton")).toHaveText("Refresh app");
    await expect(page.locator("#refreshAllButton")).toHaveText("Refresh both");
  });

  test("going offline disables every refresh button and explains why", async ({ page, context }) => {
    await context.setOffline(true);
    // The buttons react to the browser's own online/offline events while Settings is open.
    await expect(page.locator("#refreshOfflineNote")).toBeVisible();
    for (const id of ["#refreshDataButton", "#refreshAppButton", "#refreshAllButton"]) {
      await expect(page.locator(id)).toBeDisabled();
    }

    await context.setOffline(false);
    await expect(page.locator("#refreshOfflineNote")).toBeHidden();
    await expect(page.locator("#refreshDataButton")).toBeEnabled();
  });

  test.describe("refresh scopes", () => {
    // Each button reloads the page once it has cleared what it owns, so what was cleared is
    // recorded into sessionStorage (which survives the reload) rather than asserted in place.
    // The Cache Storage and service-worker APIs are stubbed in the live page — Settings is
    // already open at this point, and setupPwa has long since read what it needs.
    async function stubCacheApis(page) {
      await page.evaluate(() => {
        sessionStorage.removeItem("refresh-log");
        const record = (entry) => {
          const log = JSON.parse(sessionStorage.getItem("refresh-log") || "[]");
          log.push(entry);
          sessionStorage.setItem("refresh-log", JSON.stringify(log));
        };
        const names = ["forest-finds-app-v99", "forest-finds-data-v9", "another-apps-cache-v1"];
        Object.defineProperty(window, "caches", {
          configurable: true,
          value: {
            keys: async () => names.slice(),
            delete: async (name) => { record(`deleted:${name}`); return true; },
            match: async () => undefined,
          },
        });
        if (navigator.serviceWorker) {
          Object.defineProperty(navigator.serviceWorker, "getRegistrations", {
            configurable: true,
            value: async () => [{ unregister: async () => { record("unregistered"); return true; } }],
          });
        }
        // Nothing was cleared yet, but the buttons only act when the browser reports being
        // online — make that explicit so an offline test runner can't turn these into no-ops.
        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
      });
    }

    async function clickRefreshAndReadLog(page, buttonId) {
      await stubCacheApis(page);
      await page.click(buttonId);
      // waitForFunction survives the location.reload() the button ends with; the log entries
      // are written to sessionStorage before that, so they are still there afterwards.
      await page.waitForFunction(
        () => {
          try {
            return JSON.parse(sessionStorage.getItem("refresh-log") || "[]").length > 0;
          } catch (error) {
            return false;
          }
        },
        { timeout: 20_000 }
      );
      return page.evaluate(() => JSON.parse(sessionStorage.getItem("refresh-log") || "[]"));
    }

    test("refreshing the data clears the data cache and keeps the app cached", async ({ page }) => {
      const log = await clickRefreshAndReadLog(page, "#refreshDataButton");
      expect(log).toContain("deleted:forest-finds-data-v9");
      expect(log).not.toContain("deleted:forest-finds-app-v99");
      expect(log).not.toContain("unregistered");
      expect(log).not.toContain("deleted:another-apps-cache-v1");
    });

    test("refreshing the app clears the app cache and keeps the downloaded map data", async ({ page }) => {
      const log = await clickRefreshAndReadLog(page, "#refreshAppButton");
      expect(log).toContain("deleted:forest-finds-app-v99");
      expect(log).not.toContain("deleted:forest-finds-data-v9");
      expect(log).toContain("unregistered");
    });

    test("refreshing both clears every cache this app owns and nobody else's", async ({ page }) => {
      const log = await clickRefreshAndReadLog(page, "#refreshAllButton");
      expect(log).toContain("deleted:forest-finds-app-v99");
      expect(log).toContain("deleted:forest-finds-data-v9");
      expect(log).toContain("unregistered");
      expect(log).not.toContain("deleted:another-apps-cache-v1");
    });
  });

  test("snapshot: settings screen", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Snapshots are mobile-only');
    await page.waitForTimeout(300);
    await page.evaluate(() => { stopViewportAnimation(); state.emojiScaleAnimated = zoomEmojiScaleTarget(); draw(); });
    await page.waitForTimeout(50);
    await expect(page).toHaveScreenshot("settings-screen.png", { fullPage: false });
  });
});
