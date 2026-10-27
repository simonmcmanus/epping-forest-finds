// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, settleMapIconsAndDraw, waitForUiToSettle } = require("./helpers");

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

  test("walking presets update the radius and stay in sync with the slider", async ({ page }) => {
    const preset = page.locator("[data-walk-minutes]").last();
    const minutes = Number(await preset.getAttribute("data-walk-minutes"));
    await preset.click();
    await expect(preset).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#settingsWalkMinsValue")).toHaveText(`${minutes} min`);
    expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(minutes);
    const min = await page.locator("#settingsWalkMins").getAttribute("min");
    await setWalkSlider(page, min);
    await expect(preset).toHaveAttribute("aria-pressed", "false");
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

  test.describe("With a find closer than a minute's walk", () => {
    test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

    test("the slider reaches below a minute and reads the radius in seconds", async ({ page, context }) => {
      // Stand beside whatever is nearest, so the closest thing to the user is seconds away.
      const spot = await page.evaluate(() => {
        const nearest = nearestFallbackEntriesForActiveFilter(state.userLocation.latitude, state.userLocation.longitude)[0];
        return { latitude: nearest.item.latitude + 0.0002, longitude: nearest.item.longitude };
      });
      await context.setGeolocation({ ...spot, accuracy: 5 });
      await page.waitForFunction(
        (target) => Math.abs(state.userLocation.latitude - target.latitude) < 0.00005,
        spot
      );

      // The form is built when the screen opens, so re-open it on the new position.
      await page.click("#nearbyToggle");
      await page.click("#settingsToggle");
      const slider = page.locator("#settingsWalkMins");
      await expect(slider).toBeVisible();

      const min = Number(await slider.getAttribute("min"));
      expect(min).toBeLessThan(1);
      expect(Number(await slider.getAttribute("step"))).toBe(0.25);

      await setWalkSlider(page, min);
      await expect(page.locator("#settingsWalkMinsValue")).toHaveText(`${Math.round(min * 60)} sec`);
      expect(await page.evaluate(() => state.walkingDistanceMinutes)).toBe(min);
    });
  });

  test("settings screen shows the app version in the About section", async ({ page }) => {
    await expect(page.locator("#appVersionDisplay")).toBeVisible();
    // Should start with 'v' — e.g. "v120"
    await expect(page.locator("#appVersionDisplay")).toContainText("v");
  });

  test("a single update banner appears once an update is ready and one tap restarts", async ({ page }) => {
    await expect(page.locator("#updateBanner")).toHaveCount(0);
    await page.evaluate(() => { _markDataUpdateAvailable(); });
    await expect(page.locator("#updateBanner")).toBeVisible();
    await expect(page.locator("#updateBanner")).toContainText("New map data");
    await page.evaluate(() => { window.__reloadMarker = true; });
    await page.click("#updateBannerButton");
    await page.waitForFunction(() => !window.__reloadMarker);
  });

  test("data arriving while a waiting worker is still preparing does not show the banner early", async ({ page }) => {
    await page.evaluate(() => {
      state.swWaiting = { postMessage() {} };
      _markDataUpdateAvailable();
    });
    await expect(page.locator("#updateBanner")).toHaveCount(0);
    await page.evaluate(() => { _markSwUpdateAvailable(state.swWaiting); });
    await expect(page.locator("#updateBanner")).toBeVisible();
    await expect(page.locator("#updateBanner")).toContainText("Update ready");
    await expect(page.locator("#updateBanner")).toHaveCount(1);
  });

  test("snapshot: update ready banner", async ({ page }) => {
    await page.evaluate(() => { _markDataUpdateAvailable(); });
    await expect(page.locator("#updateBanner")).toBeVisible();
    await waitForUiToSettle(page);
    await settleMapIconsAndDraw(page);
    await expect(page).toHaveScreenshot("update-ready-banner.png", { fullPage: false });
  });

  test("settings screen offers a one-tap reload once new map data has already downloaded", async ({ page }) => {
    await expect(page.locator("#dataUpdateNote")).toBeHidden();

    await page.evaluate(() => { state.dataUpdateAvailable = true; });
    // The form is built when the screen opens, so re-open it to pick up the flag.
    await page.click("#nearbyToggle");
    await page.click("#settingsToggle");
    await expect(page.locator("#dataUpdateNote")).toBeVisible();
    await expect(page.locator("#dataUpdateReloadButton")).toBeVisible();

    // A real reload clears the JS realm, so a window property set just before the click
    // disappearing is proof the click actually triggered one (the refresh-scope tests below
    // use the same "survives/doesn't survive reload" idiom via sessionStorage).
    await page.evaluate(() => { window.__reloadMarker = true; });
    await page.click("#dataUpdateReloadButton");
    await page.waitForFunction(() => window.__reloadMarker === undefined, { timeout: 20_000 });
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
    await expect(page.locator("#appUpdateStatusText")).toContainText("You're offline");
    await expect(page.locator("#appUpdateButton")).toBeDisabled();

    await context.setOffline(false);
    await expect(page.locator("#refreshOfflineNote")).toBeHidden();
    await expect(page.locator("#refreshDataButton")).toBeEnabled();
  });

  test.describe("update status", () => {
    // Service workers are blocked in these tests, so the browser's registration and the incoming
    // worker are stood in for at that boundary; everything above it is the real Settings code.
    // update() makes `installing` a fake worker when `newRelease` is set, the way a browser
    // reports a newer sw.js; the fake records what the page posts to it.
    async function stubRegistration(page, { newRelease = false } = {}) {
      await page.evaluate((newRelease) => {
        window.__workerMessages = [];
        const worker = new EventTarget();
        worker.state = "installing";
        worker.postMessage = (message) => window.__workerMessages.push(message);
        window.__incomingWorker = worker;
        const registration = {
          installing: null,
          waiting: null,
          update: async () => { if (newRelease) registration.installing = worker; },
        };
        const serviceWorker = navigator.serviceWorker;
        Object.defineProperty(serviceWorker, "controller", { configurable: true, value: { postMessage() {} } });
        Object.defineProperty(serviceWorker, "getRegistration", { configurable: true, value: async () => registration });
        const realKeys = caches.keys.bind(caches);
        caches.keys = async () => [...(await realKeys()), "forest-finds-app-v999999"];
      }, newRelease);
    }

    test("before any check, Settings says updates are checked automatically and offers a check", async ({ page }) => {
      await expect(page.locator("#appUpdateStatusText")).toHaveText("Updates are checked automatically while the app is open.");
      await expect(page.locator("#appUpdateButton")).toHaveText("Check for updates");
    });

    test("checking for updates with nothing newer says the app is on the latest version", async ({ page }) => {
      await stubRegistration(page);
      await page.click("#appUpdateButton");
      await expect(page.locator("#appUpdateStatusText")).toContainText("You have the latest version.");
      await expect(page.locator("#appUpdateCheckedAt")).toContainText("Checked at");
      await expect(page.locator("#appUpdateButton")).toBeEnabled();
    });

    test("a newer version shows as downloading, then ready, and Restart switches to it", async ({ page }) => {
      await stubRegistration(page, { newRelease: true });
      await page.click("#appUpdateButton");
      await expect(page.locator("#appUpdateStatusText")).toContainText("Downloading update v999999");
      await expect(page.locator("#appUpdateButton")).toHaveText("Downloading…");
      await expect(page.locator("#appUpdateButton")).toBeDisabled();

      // The worker finishes installing, then fetches its own map data before it is announced.
      await page.evaluate(() => {
        window.__incomingWorker.state = "installed";
        window.__incomingWorker.dispatchEvent(new Event("statechange"));
      });
      await page.waitForFunction(() => window.__workerMessages.some((m) => m.type === "SYNC_DATA"));
      await expect(page.locator("#appUpdateStatusText")).toContainText("Downloading update v999999");

      await page.evaluate(() => {
        const sync = window.__workerMessages.find((m) => m.type === "SYNC_DATA");
        navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
          data: { type: "DATA_SYNC_COMPLETE", requestId: sync.requestId, ok: true, changed: 0, failed: 0 },
        }));
      });
      await expect(page.locator("#appUpdateStatusText")).toHaveText("Update v999999 has downloaded. Restart to start using it.");
      await expect(page.locator("#appUpdateButton")).toHaveText("Restart now");

      await page.click("#appUpdateButton");
      await page.waitForFunction(() => window.__workerMessages.some((m) => m.type === "SKIP_WAITING"));
    });

    test("an update that fails to download says so and offers to try again", async ({ page }) => {
      await stubRegistration(page, { newRelease: true });
      await page.click("#appUpdateButton");
      await expect(page.locator("#appUpdateButton")).toHaveText("Downloading…");
      await page.evaluate(() => {
        window.__incomingWorker.state = "redundant";
        window.__incomingWorker.dispatchEvent(new Event("statechange"));
      });
      await expect(page.locator("#appUpdateStatusText")).toContainText("Couldn't finish checking for updates");
      await expect(page.locator("#appUpdateButton")).toHaveText("Try again");
    });

    // The page's first controllerchange is the first install claiming it (no worker controlled
    // the page at load here), so the second is a newer release taking over from elsewhere.
    async function activateReleaseElsewhere(page) {
      await page.evaluate(() => {
        navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
        navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
      });
    }

    test("a release already switched on in another tab restarts with one tap", async ({ page }) => {
      await activateReleaseElsewhere(page);
      await expect(page.locator("#appUpdateButton")).toHaveText("Restart now");
      await page.evaluate(() => { window.__reloadMarker = true; });
      await page.click("#appUpdateButton");
      await page.waitForFunction(() => window.__reloadMarker === undefined);
    });

    test("snapshot: settings update ready", async ({ page }) => {
      await activateReleaseElsewhere(page);
      await expect(page.locator("#appUpdateButton")).toHaveText("Restart now");
      await page.locator("#appUpdateStatus").scrollIntoViewIfNeeded();
      await waitForUiToSettle(page);
      await settleMapIconsAndDraw(page);
      await expect(page.locator("#testerIdDisplay")).not.toHaveText("…");
      await expect(page).toHaveScreenshot("settings-update-ready.png", {
        fullPage: false,
        mask: [page.locator("#testerIdDisplay"), page.locator("#appVersionDisplay")],
      });
    });
  });

  test.describe("refresh scopes", () => {
    // Refreshes now keep the existing caches until the replacement is ready. The Cache Storage
    // and service-worker APIs are stubbed in the live page — Settings is already open at this
    // point, and setupPwa has long since read what it needs.
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
          const serviceWorker = navigator.serviceWorker;
          const controller = { postMessage: (message) => {
            record(`message:${message.type}`);
            if (message.type === "SYNC_DATA") {
              setTimeout(() => serviceWorker.dispatchEvent(new MessageEvent("message", {
                data: { type: "DATA_SYNC_COMPLETE", requestId: message.requestId, ok: true, changed: 0, failed: 0 },
              })), 0);
            }
          } };
          Object.defineProperty(serviceWorker, "controller", { configurable: true, value: controller });
          Object.defineProperty(serviceWorker, "ready", {
            configurable: true,
            value: Promise.resolve({ waiting: null, installing: null, update: async () => {} }),
          });
          Object.defineProperty(serviceWorker, "getRegistrations", {
            configurable: true,
            value: async () => [{ unregister: async () => { record("unregistered"); return true; } }],
          });
          Object.defineProperty(serviceWorker, "getRegistration", {
            configurable: true,
            value: async () => ({ waiting: null, installing: null, update: async () => {} }),
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
      // The button ends with location.reload(), and any single call into the page can land while
      // the old document is being torn down ("Execution context was destroyed"). Poll until one
      // read gets through; the log is in sessionStorage, so it survives the reload.
      let log = [];
      await expect.poll(async () => {
        try {
          log = await page.evaluate(() => JSON.parse(sessionStorage.getItem("refresh-log") || "[]"));
        } catch (error) {
          return 0;
        }
        return log.length;
      }).toBeGreaterThan(0);
      return log;
    }

    test("refreshing the data downloads successfully without deleting the offline caches", async ({ page }) => {
      const log = await clickRefreshAndReadLog(page, "#refreshDataButton");
      expect(log).toContain("message:SYNC_DATA");
      expect(log).not.toContain("deleted:");
      expect(log).not.toContain("unregistered");
      expect(log).not.toContain("deleted:another-apps-cache-v1");
    });

    // The log lives in sessionStorage and survives the location.reload() the button ends with, but a
    // single call into the page can land mid-reload ("Execution context was destroyed"), so poll.
    async function logOnceContains(page, entry) {
      let log = [];
      await expect.poll(async () => {
        try {
          log = await page.evaluate(() => JSON.parse(sessionStorage.getItem("refresh-log") || "[]"));
        } catch (error) {
          return false;
        }
        return log.includes(entry);
      }).toBe(true);
      return log;
    }

    test("refreshing the app clears the cached app but keeps the data and other apps' caches", async ({ page }) => {
      await stubCacheApis(page);
      await page.click("#refreshAppButton");
      const log = await logOnceContains(page, "deleted:forest-finds-app-v99");
      expect(log).toContain("unregistered");
      expect(log).not.toContain("message:SYNC_DATA");
      expect(log).not.toContain("deleted:forest-finds-data-v9");
      expect(log).not.toContain("deleted:another-apps-cache-v1");
    });

    test("refreshing both downloads the data, then clears the app and data caches but not other apps'", async ({ page }) => {
      await stubCacheApis(page);
      await page.click("#refreshAllButton");
      const log = await logOnceContains(page, "deleted:forest-finds-data-v9");
      expect(log).toContain("message:SYNC_DATA");
      expect(log).toContain("unregistered");
      expect(log).toContain("deleted:forest-finds-app-v99");
      expect(log).not.toContain("deleted:another-apps-cache-v1");
    });
  });

  test("snapshot: settings screen", async ({ page }) => {
    await waitForUiToSettle(page);
    await settleMapIconsAndDraw(page);
    // The tester ID is a random per-browser device id and the version moves with every release:
    // mask just those two values so the baseline only changes when the screen does.
    await expect(page.locator("#testerIdDisplay")).not.toHaveText("…");
    await expect(page).toHaveScreenshot("settings-screen.png", {
      fullPage: false,
      mask: [page.locator("#testerIdDisplay"), page.locator("#appVersionDisplay")],
    });
  });
});

test.describe("?nuke=true URL parameter", () => {
  // Stubbed before the app boots so the safe update check can be observed. The log lives in
  // sessionStorage and therefore survives any navigation caused by an applied update.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
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
        const serviceWorker = navigator.serviceWorker;
        const controller = { postMessage: (message) => {
          record(`message:${message.type}`);
          if (message.type === "SYNC_DATA") {
            setTimeout(() => serviceWorker.dispatchEvent(new MessageEvent("message", {
              data: { type: "DATA_SYNC_COMPLETE", requestId: message.requestId, ok: true, changed: 0, failed: 0 },
            })), 0);
          }
        } };
        Object.defineProperty(serviceWorker, "controller", { configurable: true, value: controller });
        Object.defineProperty(serviceWorker, "ready", {
          configurable: true,
          value: Promise.resolve({ waiting: null, installing: null, update: async () => {} }),
        });
      }
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    });
  });

  test("runs the safe update check and returns to the URL without the flag", async ({ page }) => {
    await page.goto("/nearby?nuke=true&show=trees");
    await page.waitForFunction(
      () => JSON.parse(sessionStorage.getItem("refresh-log") || "[]").length > 0,
      null,
      { timeout: 20_000 }
    );
    await expect.poll(() => new URL(page.url()).searchParams.has("nuke")).toBe(false);
    const log = await page.evaluate(() => JSON.parse(sessionStorage.getItem("refresh-log") || "[]"));
    expect(log).toContain("message:SYNC_DATA");
    expect(log).not.toContain("deleted:");
    expect(log).not.toContain("unregistered");
    expect(new URL(page.url()).searchParams.get("show")).toBe("trees");
  });

  test("a page without the flag clears nothing", async ({ page }) => {
    await page.goto("/nearby");
    await expect(page.locator("#settingsToggle")).toBeVisible();
    const log = await page.evaluate(() => JSON.parse(sessionStorage.getItem("refresh-log") || "[]"));
    expect(log).toEqual([]);
  });
});

