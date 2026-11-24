const { test, expect } = require("@playwright/test");
const { skipOnboarding } = require("./helpers");

// Admin map base layers (issue 600): roads must be legible, layers load on their own, and a failed layer says so.

const BOUNDS = { minLat: 51.595, maxLat: 51.730, minLng: -0.110, maxLng: 0.155 };
const EMPTY = { type: "FeatureCollection", features: [] };
const json = (route, status, data) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
const at = (min) => new Date(Date.parse("2026-10-22T12:00:00Z") + min * 60000).toISOString();
const WALK = [[51.640, 0.000], [51.650, 0.020], [51.660, 0.040], [51.670, 0.060], [51.680, 0.080]];
const tracks = () => ({
  locations: WALK.map(([lat, lng], i) => ({ type: "location", uid: "aaaaaaaa-1111", ts: at(i), lat, lng, heading: 0, navTarget: null })),
  clicks: [],
  meta: { storeName: "tracking-test", context: "test", windowDays: 30 },
});
const line = (highway, lat, a = -0.06, b = 0.12) => ({ type: "Feature", properties: { highway }, geometry: { type: "LineString", coordinates: [[a, lat], [b, lat]] } });
const ROADS = { type: "FeatureCollection", features: [line("residential", 51.700), line("primary", 51.620)] };
// A forest that fills the fallback box, so the map keeps its fallback fit.
const FOREST = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[BOUNDS.minLng, BOUNDS.minLat], [BOUNDS.maxLng, BOUNDS.minLat], [BOUNDS.maxLng, BOUNDS.maxLat], [BOUNDS.minLng, BOUNDS.maxLat], [BOUNDS.minLng, BOUNDS.minLat]]] } }] };

const FILES = { forest: "epping-forest-land", buffer: "epping-buffer-land", environment: "local-environment", roads: "local-roads", paths: "local-paths" };
const NAMES = { forest: "forest", buffer: "forest edge", environment: "water and railways", roads: "roads", paths: "paths" };

// `layers` overrides the answer for a layer by key (forest, buffer, environment, roads, paths); the others answer an empty collection.
async function openAdmin(page, { layers = {}, roads, forest, expectTracks = true } = {}) {
  const handlers = { ...layers };
  if (roads) handlers.roads = roads;
  if (forest) handlers.forest = forest;
  await skipOnboarding(page);
  for (const key of Object.keys(FILES)) {
    const fallback = key === "roads" ? (route) => json(route, 200, ROADS) : (route) => json(route, 200, EMPTY);
    await page.route(new RegExp(`/data/${FILES[key]}\\.geojson`), handlers[key] || fallback);
  }
  await page.route(/\/api\/admin\/me/, (route) => json(route, 200, { signedIn: true, name: "Test Admin" }));
  await page.route(/\/api\/admin\/tracks/, (route) => json(route, 200, tracks()));
  await page.goto("/admin");
  await expect(page.locator("#adminApp")).toBeVisible();
  if (expectTracks) await expect(page.locator(".admin-user-item")).not.toHaveCount(0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function canvasPoint(page, lat, lng) {
  return page.evaluate(([la, ln, bounds]) => {
    const rect = document.getElementById("adminCanvas").getBoundingClientRect();
    const saved = JSON.parse(localStorage.getItem("ff-admin-map-viewport") || "null") || { zoom: 1, panX: 0, panY: 0 };
    const mercY = (v) => -Math.log(Math.tan(Math.PI / 4 + (v * Math.PI / 180) / 2)) * 180 / Math.PI;
    const minX = bounds.minLng; const maxX = bounds.maxLng; const minY = mercY(bounds.maxLat); const maxY = mercY(bounds.minLat);
    const w = rect.width; const h = rect.height;
    const pad = Math.max(18, Math.min(w, h) * 0.045);
    const base = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
    const bx = (w - (maxX - minX) * base) / 2 + (ln - minX) * base;
    const by = (h - (maxY - minY) * base) / 2 + (mercY(la) - minY) * base;
    return { x: rect.left + w / 2 + saved.panX + saved.zoom * (bx - w / 2), y: rect.top + h / 2 + saved.panY + saved.zoom * (by - h / 2) };
  }, [lat, lng, BOUNDS]);
}

// Biggest colour difference (0-255) between a pixel on a 1px-step scan across the map and the pixel at the scan start.
async function strongestContrast(page, from, to) {
  return page.evaluate(([a, b]) => {
    const c = document.getElementById("adminCanvas");
    const r = c.getBoundingClientRect();
    const ctx = c.getContext("2d");
    const px = (x, y) => ctx.getImageData(Math.round((x - r.left) * c.width / r.width), Math.round((y - r.top) * c.height / r.height), 1, 1).data;
    const ref = px(a.x, a.y);
    let best = 0;
    const steps = 14;
    for (let i = 1; i <= steps; i += 1) {
      const d = px(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
      best = Math.max(best, Math.abs(d[0] - ref[0]), Math.abs(d[1] - ref[1]), Math.abs(d[2] - ref[2]));
    }
    return best;
  }, [from, to]);
}

const acrossRoad = async (page, lat, lng) => {
  const p = await canvasPoint(page, lat, lng);
  return [{ x: p.x, y: p.y - 7 }, { x: p.x, y: p.y + 7 }];
};

test.describe("Admin map: roads are legible", () => {
  test("a residential street and a primary road stand out clearly from the map background", async ({ page }) => {
    await openAdmin(page);
    expect(await strongestContrast(page, ...await acrossRoad(page, 51.700, 0.03))).toBeGreaterThanOrEqual(40);
    expect(await strongestContrast(page, ...await acrossRoad(page, 51.620, 0.03))).toBeGreaterThanOrEqual(40);
  });
});

test.describe("Admin map: layers load on their own", () => {
  test("while the roads are still downloading the forest and the tracks are already drawn, with a Loading roads hint", async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    await openAdmin(page, { forest: (route) => json(route, 200, FOREST), roads: async (route) => { await gate; await json(route, 200, ROADS); } });
    await expect(page.locator("#adminLayerStatus").filter({ hasText: "Loading roads" })).toBeVisible();
    // The forest edge on the west side is drawn.
    const edge = await canvasPoint(page, 51.66, BOUNDS.minLng);
    await expect.poll(() => strongestContrast(page, { x: edge.x - 5, y: edge.y }, { x: edge.x + 3, y: edge.y })).toBeGreaterThanOrEqual(20);
    // And a track can be opened.
    const a = await canvasPoint(page, ...WALK[1]);
    const b = await canvasPoint(page, ...WALK[2]);
    await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
    await expect(page.getByRole("region", { name: "Track details" })).toBeVisible();
    release();
    await expect(page.locator("#adminLayerStatus").filter({ hasText: "Loading roads" })).toBeHidden();
    await expect.poll(async () => strongestContrast(page, ...await acrossRoad(page, 51.700, 0.03))).toBeGreaterThanOrEqual(40);
  });
});

const status = (page) => page.locator("#adminLayerStatus");
const pixel = (page, p) => page.evaluate(({ x, y }) => {
  const c = document.getElementById("adminCanvas");
  const r = c.getBoundingClientRect();
  return Array.from(c.getContext("2d").getImageData(Math.round((x - r.left) * c.width / r.width), Math.round((y - r.top) * c.height / r.height), 1, 1).data);
}, p);
const fail500 = (route) => json(route, 500, { error: "boom" });

test.describe("Admin map: a layer that fails to load says so", () => {
  for (const [label, fail] of [["answers 500", fail500], ["is cut off", (route) => route.abort()], ["returns broken data", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{nope" })]]) {
    test(`a roads layer that ${label} shows a message, the tracks still work, and Retry recovers`, async ({ page }) => {
      let failing = true;
      await openAdmin(page, { roads: (route) => (failing ? fail(route) : json(route, 200, ROADS)) });
      await expect(status(page)).toHaveText("Couldn't load the roads layer.");
      const retry = page.getByRole("button", { name: "Retry" });
      await expect(retry).toBeVisible();
      const a = await canvasPoint(page, ...WALK[1]);
      const b = await canvasPoint(page, ...WALK[2]);
      await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
      await expect(page.getByRole("region", { name: "Track details" })).toBeVisible();
      failing = false;
      await retry.click();
      await expect(status(page)).toHaveText("Roads loaded.");
      await expect.poll(async () => strongestContrast(page, ...await acrossRoad(page, 51.700, 0.03))).toBeGreaterThanOrEqual(40);
    });
  }

  test("a forest that fails to load keeps the rough forest outline on the map", async ({ page }) => {
    await openAdmin(page, { forest: fail500, roads: (route) => json(route, 200, EMPTY) });
    await expect(status(page)).toHaveText("Couldn't load the forest layer.");
    // Inside the fallback outline the map is tinted green; far outside it (the north-west corner) it is not.
    const inside = await pixel(page, await canvasPoint(page, 51.66, 0.0));
    const outside = await pixel(page, await canvasPoint(page, 51.725, -0.09));
    expect(outside[0] - inside[0]).toBeGreaterThan(4);
  });

  for (const key of Object.keys(FILES)) {
    test(`retrying the ${NAMES[key]} layer shows Loading ${NAMES[key]}... while it refetches`, async ({ page }) => {
      let calls = 0;
      let release;
      const gate = new Promise((r) => { release = r; });
      await openAdmin(page, { layers: { [key]: async (route) => { calls += 1; if (calls === 1) return fail500(route); await gate; return json(route, 200, key === "roads" ? ROADS : EMPTY); } } });
      await expect(status(page)).toHaveText(`Couldn't load the ${NAMES[key]} layer.`);
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(status(page)).toHaveText(`Loading ${NAMES[key]}...`);
      release();
      const done = `${NAMES[key][0].toUpperCase()}${NAMES[key].slice(1)} loaded.`;
      await expect(status(page)).toHaveText(done);
      await expect(status(page)).toHaveText("", { timeout: 8000 });
    });
  }

  test("a successful Retry is announced as Roads loaded., then the note clears itself", async ({ page }) => {
    let calls = 0;
    await openAdmin(page, { roads: (route) => { calls += 1; return calls === 1 ? fail500(route) : json(route, 200, ROADS); } });
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(status(page)).toHaveText("Roads loaded.");
    await expect(page.getByRole("button", { name: "Retry" })).toBeHidden();
    await expect(status(page)).toHaveText("", { timeout: 8000 });
    await expect(page.locator("#adminLayerNote")).toHaveClass(/is-idle/);
  });

  test("the map canvas has an accessible name and is described by the layer status", async ({ page }) => {
    await openAdmin(page);
    await expect(page.locator("#adminCanvas")).toHaveAttribute("aria-label", "Admin map");
    await expect(page.locator("#adminCanvas")).toHaveAttribute("aria-describedby", "adminLayerStatus");
  });

  test("Retry keeps keyboard focus: pressing Enter on it leaves focus on the page, not the body", async ({ page }) => {
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    await openAdmin(page, { roads: async (route) => { calls += 1; if (calls === 1) return fail500(route); await gate; return json(route, 200, ROADS); } });
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(status(page)).toHaveText("Loading roads...");
    expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).not.toBe("BODY");
    release();
    await expect(status(page)).toHaveText("Roads loaded.");
    expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).not.toBe("BODY");
  });

  test("the failure message and the Retry button are left alone while other layers finish loading", async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    await openAdmin(page, { layers: { roads: fail500, environment: async (route) => { await gate; return json(route, 200, EMPTY); } } });
    await expect(status(page)).toHaveText("Couldn't load the roads layer.");
    const retry = await page.getByRole("button", { name: "Retry" }).elementHandle();
    await page.evaluate(() => {
      window.__noteMutations = 0;
      new MutationObserver((list) => { window.__noteMutations += list.length; }).observe(document.getElementById("adminLayerNote"), { subtree: true, childList: true, characterData: true });
    });
    expect(await page.evaluate(() => adminMap.status.environment)).toBe("loading");
    release();
    // The environment layer settling (and the map redrawing) is the signal; only then check the note was left alone.
    await expect.poll(() => page.evaluate(() => adminMap.status.environment)).toBe("loaded");
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(() => window.__noteMutations)).toBe(0);
    expect(await retry.evaluate((el) => el.isConnected)).toBe(true);
    await expect(status(page)).toHaveText("Couldn't load the roads layer.");
  });

  test("the Retry button is a 44px touch target", async ({ page }) => {
    await openAdmin(page, { roads: fail500 });
    const box = await page.getByRole("button", { name: "Retry" }).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test("a layer request that never answers ends in the failure message with Retry", async ({ page }) => {
    await page.clock.install();
    await openAdmin(page, { roads: () => new Promise(() => {}), expectTracks: false });
    await expect(status(page)).toContainText("Loading");
    await page.clock.fastForward(31000);
    await expect(status(page)).toHaveText("Couldn't load the roads layer.");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("the loading hint is readable while the forest is still arriving", async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    await openAdmin(page, { forest: async (route) => { await gate; return json(route, 200, EMPTY); } });
    await expect(status(page)).toHaveText("Loading forest...");
    await expect(page.locator("#adminLayerNote")).toBeVisible();
    release();
    await expect(status(page)).toHaveText("");
  });
});

test.describe("Admin map: the view stays put", () => {
  test("a forest that arrives later through Retry does not move the map under the user", async ({ page }) => {
    // The forest edge alone frames the map (a box around the road); the retried forest is wider than that.
    const edge = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-0.05, 51.62], [0.1, 51.62], [0.1, 51.72], [-0.05, 51.72], [-0.05, 51.62]]] } }] };
    let failing = true;
    await openAdmin(page, { layers: { buffer: (route) => json(route, 200, edge), forest: (route) => (failing ? fail500(route) : json(route, 200, FOREST)) } });
    await expect(status(page)).toHaveText("Couldn't load the forest layer.");
    // Rows of the canvas (down one column) where the white residential street is drawn.
    const roadRows = () => page.evaluate(() => {
      const c = document.getElementById("adminCanvas");
      const ctx = c.getContext("2d");
      const x = Math.round(c.width / 2);
      const rows = [];
      for (let y = 0; y < c.height; y += 1) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        if (d[0] >= 250 && d[1] >= 250 && d[2] >= 250) rows.push(y);
      }
      return rows;
    });
    const before = await roadRows();
    expect(before.length).toBeGreaterThan(0);
    failing = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(status(page)).toHaveText("Forest loaded.");
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const after = await roadRows();
    expect(after).toEqual(before);
  });
});

test.describe("Admin map: crossings", () => {
  test("where a small alley crosses a primary road the primary road's colour is on top", async ({ page }) => {
    const alley = { type: "Feature", properties: { highway: "service", service: "alley" }, geometry: { type: "LineString", coordinates: [[0.03, 51.64], [0.03, 51.68]] } };
    const crossing = { type: "FeatureCollection", features: [line("primary", 51.66), alley] };
    await openAdmin(page, { forest: (route) => json(route, 200, FOREST), roads: (route) => json(route, 200, crossing) });
    await expect.poll(async () => (await pixel(page, await canvasPoint(page, 51.66, 0.03)))[2]).toBeLessThan(120);
    const [r, g, b] = await pixel(page, await canvasPoint(page, 51.66, 0.03));
    expect(Math.abs(r - 0xf2)).toBeLessThan(14);
    expect(Math.abs(g - 0xc9)).toBeLessThan(14);
    expect(Math.abs(b - 0x4c)).toBeLessThan(14);
  });
});

test.describe("Admin map: the layer note does not get in the way on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });
  const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  test("the failed note sits clear of the controls and the legend, also with the track sheet open", async ({ page }) => {
    await openAdmin(page, { roads: fail500 });
    const note = page.locator("#adminLayerNote");
    await expect(note).toBeVisible();
    const boxes = async () => ({
      note: await note.boundingBox(),
      controls: await page.locator(".admin-map-controls").boundingBox(),
      legend: await page.locator(".admin-legend").boundingBox(),
    });
    let b = await boxes();
    expect(overlaps(b.note, b.controls)).toBe(false);
    expect(overlaps(b.note, b.legend)).toBe(false);
    const a = await canvasPoint(page, ...WALK[1]);
    const c = await canvasPoint(page, ...WALK[2]);
    await page.mouse.click((a.x + c.x) / 2, (a.y + c.y) / 2);
    const sheet = page.getByRole("region", { name: "Track details" });
    await expect(sheet).toBeVisible();
    b = await boxes();
    const sheetBox = await sheet.boundingBox();
    expect(overlaps(b.note, sheetBox)).toBe(false);
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    const retryBox = await page.getByRole("button", { name: "Retry" }).boundingBox();
    expect(overlaps(retryBox, sheetBox)).toBe(false);
  });
});

test.describe("Admin map: Retry stays reachable on a short phone", () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test("with the Track details sheet open and a failed layer, Retry is visible, uncovered and clickable", async ({ page }) => {
    let calls = 0;
    await openAdmin(page, { roads: (route) => { calls += 1; return calls === 1 ? fail500(route) : json(route, 200, ROADS); } });
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    const a = await canvasPoint(page, ...WALK[1]);
    const c = await canvasPoint(page, ...WALK[2]);
    await page.mouse.click((a.x + c.x) / 2, (a.y + c.y) / 2);
    await expect(page.getByRole("region", { name: "Track details" })).toBeVisible();
    await expect(retry).toBeVisible();
    const box = await retry.boundingBox();
    const topIsRetry = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el && el.closest(".admin-layer-retry"));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(topIsRetry).toBe(true);
    await retry.click({ timeout: 3000 });
    await expect(status(page)).toHaveText("Roads loaded.");
  });
});
