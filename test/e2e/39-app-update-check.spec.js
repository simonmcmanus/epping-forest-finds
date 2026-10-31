// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

test("loopback development leaves the service worker unregistered without the browser-test opt-in", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "allow" });
  // playwright.config.js opts the normal e2e server back into workers so the offline/update
  // scenarios can run. Make this isolated context behave like an ordinary local browser by
  // rejecting that explicit opt-in before nav.js loads.
  await context.addInitScript(() => {
    Object.defineProperty(window, "__ENABLE_LOCAL_SERVICE_WORKER__", {
      configurable: false,
      get: () => false,
      set: () => {},
    });
  });
  const page = await context.newPage();
  try {
    await page.goto("/nearby");
    await page.waitForSelector("#mapCanvas");
    await expect.poll(() => page.evaluate(async () => (
      (await navigator.serviceWorker.getRegistrations()).length
    ))).toBe(0);
  } finally {
    await context.close();
  }
});

test("checks for an app update on boot and when returning to the foreground", async ({ page }) => {
  await page.addInitScript(() => {
    let now = Date.now();
    Date.now = () => now;
    window.__advanceTestClock = (milliseconds) => { now += milliseconds; };

    const listeners = new Map();
    const on = (target, type, listener) => {
      if (!listeners.has(target)) listeners.set(target, new Map());
      const targetListeners = listeners.get(target);
      if (!targetListeners.has(type)) targetListeners.set(type, new Set());
      targetListeners.get(type).add(listener);
    };
    const registration = {
      waiting: null,
      installing: null,
      addEventListener(type, listener) { on(registration, type, listener); },
      update: async () => { window.__appUpdateChecks = (window.__appUpdateChecks || 0) + 1; },
    };
    const serviceWorker = {
      controller: { postMessage() {} },
      ready: Promise.resolve(registration),
      addEventListener(type, listener) { on(serviceWorker, type, listener); },
      register: async () => registration,
    };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  });

  await setup(page);
  await page.waitForFunction(() => window.__appUpdateChecks === 1);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.__advanceTestClock(10 * 60 * 1000 + 1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect.poll(() => page.evaluate(() => window.__appUpdateChecks)).toBe(2);
});
