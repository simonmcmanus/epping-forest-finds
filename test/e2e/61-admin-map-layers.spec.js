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

async function openAdmin(page, { roads = (route) => json(route, 200, ROADS), forest = (route) => json(route, 200, EMPTY) } = {}) {
  await skipOnboarding(page);
  await page.route(/\/data\/epping-forest-land\.geojson/, forest);
  await page.route(/\/data\/(epping-buffer-land|local-environment|local-paths)\.geojson/, (route) => json(route, 200, EMPTY));
  await page.route(/\/data\/local-roads\.geojson/, roads);
  await page.route(/\/api\/admin\/me/, (route) => json(route, 200, { signedIn: true, name: "Test Admin" }));
  await page.route(/\/api\/admin\/tracks/, (route) => json(route, 200, tracks()));
  await page.goto("/admin");
  await expect(page.locator("#adminApp")).toBeVisible();
  await expect(page.locator(".admin-user-item")).not.toHaveCount(0);
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
    await expect(page.getByRole("status").filter({ hasText: "Loading roads" })).toBeVisible();
    // The forest edge on the west side is drawn.
    const edge = await canvasPoint(page, 51.66, BOUNDS.minLng);
    await expect.poll(() => strongestContrast(page, { x: edge.x - 5, y: edge.y }, { x: edge.x + 3, y: edge.y })).toBeGreaterThanOrEqual(20);
    // And a track can be opened.
    const a = await canvasPoint(page, ...WALK[1]);
    const b = await canvasPoint(page, ...WALK[2]);
    await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
    await expect(page.getByRole("region", { name: "Track details" })).toBeVisible();
    release();
    await expect(page.getByRole("status").filter({ hasText: "Loading roads" })).toBeHidden();
    await expect.poll(async () => strongestContrast(page, ...await acrossRoad(page, 51.700, 0.03))).toBeGreaterThanOrEqual(40);
  });
});

test.describe("Admin map: a layer that fails to load says so", () => {
  for (const [label, fail] of [["answers 500", (route) => json(route, 500, { error: "boom" })], ["is cut off", (route) => route.abort()], ["returns broken data", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{nope" })]]) {
    test(`a roads layer that ${label} shows a message, the tracks still work, and Retry recovers`, async ({ page }) => {
      let failing = true;
      await openAdmin(page, { roads: (route) => (failing ? fail(route) : json(route, 200, ROADS)) });
      const note = page.getByRole("status").filter({ hasText: "Couldn't load the roads layer" });
      await expect(note).toBeVisible();
      await expect(note.getByRole("button", { name: "Retry" })).toBeVisible();
      const a = await canvasPoint(page, ...WALK[1]);
      const b = await canvasPoint(page, ...WALK[2]);
      await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
      await expect(page.getByRole("region", { name: "Track details" })).toBeVisible();
      failing = false;
      await note.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Couldn't load" })).toBeHidden();
      await expect.poll(async () => strongestContrast(page, ...await acrossRoad(page, 51.700, 0.03))).toBeGreaterThanOrEqual(40);
    });
  }
});
