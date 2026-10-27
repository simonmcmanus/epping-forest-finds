// @ts-check
const { test, expect } = require("@playwright/test");

// This suite intentionally exercises the real service worker. The normal browser suite blocks
// workers so each test starts from the server, while this is the release-level check that proves a
// warm installation can restart with the network removed.
test.use({ serviceWorkers: "allow" });

test("a first visit downloads each map file once and keeps it for offline use", async ({ page, context }) => {
  await page.addInitScript(() => {
    localStorage.setItem("forest-finds-onboarding-v1", "done");
    localStorage.setItem("ff-cookie-consent", "granted");
  });
  // Counts full downloads over the network, by the page or the service worker. A page request the worker
  // answered is not one (the worker's own fetch for it is), and a bodyless 304 is the worker's background
  // sync revalidating the copy the page handed over, which is what it should do.
  const downloads = [];
  context.on("requestfinished", async (request) => {
    if (new URL(request.url()).pathname !== "/data/local-environment.geojson") return;
    const response = await request.response();
    if (response && response.status() === 200 && !response.fromServiceWorker()) downloads.push(request.serviceWorker() ? "worker" : "page");
  });

  await page.goto("/nearby");
  await page.waitForFunction(() => state.dataLoaded === true && state.environmentFeatures.length > 0, null, { timeout: 60_000 });
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30_000 });
  // expect.poll, not waitForFunction: an async predicate returns a promise, which waitForFunction treats as truthy at once.
  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match("/data/local-environment.geojson")))).toBe(true);
  // The worker's first sync runs once the hand-over has landed; wait for it to finish rather than
  // checking before it has had the chance to download anything.
  await page.evaluate(() => new Promise((resolve) => {
    navigator.serviceWorker.addEventListener("message", (event) => { if (event.data?.type === "DATA_SYNC_COMPLETE") resolve(); });
    navigator.serviceWorker.controller.postMessage({ type: "SYNC_DATA", requestId: "first-visit-test" });
  }));

  expect(downloads).toHaveLength(1);
});

test("a warmed app restarts from its cached shell and map data without a network", async ({ page, context }) => {
  await page.addInitScript(() => {
    localStorage.setItem("forest-finds-onboarding-v1", "done");
    localStorage.setItem("ff-cookie-consent", "granted");
  });

  await page.goto("/nearby");
  await page.waitForFunction(() => state.dataLoaded === true, null, { timeout: 60_000 });
  await page.waitForFunction(() => state.trees.length > 0, null, { timeout: 60_000 });
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30_000 });

  // The first page may be the one that installed the worker and therefore was not controlled by
  // it. One online restart proves that the runtime requests themselves have been written to the
  // data cache before the offline restart below.
  await page.reload();
  await page.waitForFunction(() => state.dataLoaded === true && state.trees.length > 0, null, { timeout: 60_000 });

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => state.dataLoaded === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => document.getElementById("loadingOverlay")?.hidden === true, null, { timeout: 30_000 });
  await expect(page.locator("#inspectorTitle")).toContainText("Nearby");
  expect(await page.evaluate(() => state.trees.length)).toBeGreaterThan(0);
});
