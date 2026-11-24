const { test, expect } = require("@playwright/test");
const { skipOnboarding } = require("./helpers");

// Admin map: pinch zoom, track details (start and stop), time frame and beta filter. The base map layers are served empty so the
// map fits the fallback forest box and a test can work out where a ping lands on the canvas.

const BOUNDS = { minLat: 51.595, maxLat: 51.730, minLng: -0.110, maxLng: 0.155 };
const merc = (lat) => -Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * 180 / Math.PI;

// A walk of five pings a minute apart from south-west to north-east, plus a second user elsewhere.
const WALK = [[51.640, 0.000], [51.650, 0.020], [51.660, 0.040], [51.670, 0.060], [51.680, 0.080]];
const at = (min) => new Date(Date.parse("2026-10-22T12:00:00Z") + min * 60000).toISOString();
const ping = (uid, min, lat, lng, extra = {}) => ({ type: "location", uid, ts: at(min), lat, lng, heading: 0, navTarget: null, ...extra });
const A = "aaaaaaaa-1111";
const B = "bbbbbbbb-2222";
const tracks = (extra = {}) => ({
  locations: [
    ...WALK.map(([lat, lng], i) => ping(A, i, lat, lng)),
    ping(B, 0, 51.615, -0.05, { beta: true }), ping(B, 1, 51.618, -0.045, { beta: true }),
  ],
  clicks: [],
  meta: { storeName: "tracking-test", context: "test", windowDays: 30 },
  ...extra,
});
const json = (route, status, data) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

async function openAdmin(page, { onTracks = (route) => json(route, 200, tracks()), url = "/admin" } = {}) {
  await skipOnboarding(page);
  await page.route(/\/data\/(epping-forest-land|epping-buffer-land|local-environment|local-roads|local-paths)\.geojson/, (route) => json(route, 200, { type: "FeatureCollection", features: [] }));
  await page.route(/\/api\/admin\/me/, (route) => json(route, 200, { signedIn: true, name: "Test Admin" }));
  await page.route(/\/api\/admin\/tracks/, onTracks);
  await page.goto(url);
  await expect(page.locator("#adminApp")).toBeVisible();
  await expect(page.locator(".admin-user-item")).not.toHaveCount(0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// Where a lat/lng sits in the canvas (css px from its top-left) for the viewport the page has saved.
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
    return {
      x: rect.left + w / 2 + saved.panX + saved.zoom * (bx - w / 2),
      y: rect.top + h / 2 + saved.panY + saved.zoom * (by - h / 2),
    };
  }, [lat, lng, BOUNDS]);
}

const midOfSegment = async (page, i) => {
  const a = await canvasPoint(page, ...WALK[i]);
  const b = await canvasPoint(page, ...WALK[i + 1]);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};
const savedZoom = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("ff-admin-map-viewport") || "{}").zoom ?? 1);
const savedViewport = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("ff-admin-map-viewport") || '{"zoom":1,"panX":0,"panY":0}'));

test.describe("Admin map: tapping a route line shows its start and stop", () => {
  test("clicking a route line opens the track details with user, start, stop, duration, pings and distance", async ({ page }) => {
    await openAdmin(page);
    const p = await midOfSegment(page, 1);
    await page.mouse.click(p.x, p.y);
    const sheet = page.getByRole("region", { name: "Track details" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("User aaaaaaaa");
    await expect(sheet).toContainText("4 min");
    await expect(sheet).toContainText("5 pings");
    await expect(sheet).toContainText("km"); // about 4 km of straight-line hops
    const [startTime, stopTime] = await page.evaluate(([s, e]) => [new Date(s).toLocaleString(), new Date(e).toLocaleString()], [at(0), at(4)]);
    await expect(sheet.locator(".admin-click-meta-row").nth(0)).toContainText("Start");
    await expect(sheet.locator(".admin-click-meta-row").nth(0)).toContainText(startTime);
    await expect(sheet.locator(".admin-click-meta-row").nth(0)).toContainText("51.64000, 0.00000");
    await expect(sheet.locator(".admin-click-meta-row").nth(1)).toContainText("Stop");
    await expect(sheet.locator(".admin-click-meta-row").nth(1)).toContainText(stopTime);
    await expect(sheet.locator(".admin-click-meta-row").nth(1)).toContainText("51.68000, 0.08000");
    await expect(page.getByRole("button", { name: "Close track details (Esc)" })).toBeFocused();
  });

  test("a click well away from every route line opens nothing", async ({ page }) => {
    await openAdmin(page);
    const p = await midOfSegment(page, 1);
    await page.mouse.click(p.x + 60, p.y - 60);
    await expect(page.getByRole("region", { name: "Track details" })).toBeHidden();
    await expect(page.getByRole("region", { name: "Tap details" })).toBeHidden();
  });

  test("Escape closes the track details and returns focus to the map", async ({ page }) => {
    await openAdmin(page);
    const p = await midOfSegment(page, 2);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByRole("region", { name: "Track details" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Track details" })).toBeHidden();
    await expect(page.locator("#adminCanvas")).toBeFocused();
  });

  test("a tap marker on the route line wins over the line", async ({ page }) => {
    await openAdmin(page, {
      onTracks: (route) => json(route, 200, tracks({ clicks: [{ type: "click", uid: A, ts: at(2), userLat: 51.66, userLng: 0.04, targetLat: 51.660, targetLng: 0.040, itemType: "tree", itemId: "T1", itemName: "Oak", source: "map" }] })),
    });
    const p = await canvasPoint(page, 51.66, 0.04);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByRole("region", { name: "Tap details" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Track details" })).toBeHidden();
  });

  test("choosing a user shows a Track details control that opens the sheet from the keyboard and Escape returns focus to it", async ({ page }) => {
    await openAdmin(page);
    const row = page.locator(".admin-user-item", { hasText: "aaaaaaaa" });
    await row.focus();
    await page.keyboard.press("Enter");
    const control = page.getByRole("button", { name: "Track details for aaaaaaaa" });
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await control.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("region", { name: "Track details" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("User aaaaaaaa");
    await expect(page.getByRole("button", { name: "Close track details (Esc)" })).toBeFocused();
    await expect(control).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(control).toBeFocused();
  });

  test("the Track details control and the sheet are not offered on the heatmap view", async ({ page }) => {
    await openAdmin(page);
    await page.locator(".admin-user-item", { hasText: "aaaaaaaa" }).click();
    await expect(page.getByRole("button", { name: "Track details for aaaaaaaa" })).toBeVisible();
    await page.getByRole("button", { name: "Heatmap" }).click();
    await expect(page.getByRole("button", { name: "Track details for aaaaaaaa" })).toHaveCount(0);
    const p = await midOfSegment(page, 1);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByRole("region", { name: "Track details" })).toBeHidden();
  });

  test("start and stop markers are drawn for the chosen user (a circle and a square, with a legend)", async ({ page }) => {
    await openAdmin(page);
    const start = await canvasPoint(page, ...WALK[0]);
    const stop = await canvasPoint(page, ...WALK[4]);
    const pixel = (x, y) => page.evaluate(([px, py]) => {
      const c = document.getElementById("adminCanvas");
      const r = c.getBoundingClientRect();
      const d = c.getContext("2d").getImageData(Math.round((px - r.left) * c.width / r.width), Math.round((py - r.top) * c.height / r.height), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [x, y]);
    const before = [await pixel(start.x, start.y), await pixel(stop.x, stop.y)];
    await page.locator(".admin-user-item", { hasText: "aaaaaaaa" }).click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const [s, e] = [await pixel(start.x, start.y), await pixel(stop.x, stop.y)];
    expect(s).not.toEqual(before[0]);
    expect(s[1]).toBeGreaterThan(s[0]); // green dot
    expect(e).not.toEqual(before[1]);
    expect(e[0]).toBeGreaterThan(e[1]); // red square
    await expect(page.locator(".admin-legend")).toContainText("Track start");
    await expect(page.locator(".admin-legend")).toContainText("Track stop");
  });
});

test.describe("Admin map: a user's separate walks", () => {
  // Walk 1 is WALK (minutes 0-4); walk 2 is an hour and a half later somewhere else.
  const WALK2 = [[51.620, -0.060], [51.625, -0.050], [51.630, -0.040], [51.635, -0.030]];
  const twoWalks = (route) => json(route, 200, tracks({ locations: [...WALK.map(([lat, lng], i) => ping(A, i, lat, lng)), ...WALK2.map(([lat, lng], i) => ping(A, 120 + i, lat, lng))] }));
  const mid = async (page, list, i) => {
    const a = await canvasPoint(page, ...list[i]);
    const b = await canvasPoint(page, ...list[i + 1]);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  test("clicking a route line shows the walk under the click, not the whole window", async ({ page }) => {
    await openAdmin(page, { onTracks: twoWalks });
    const sheet = page.getByRole("region", { name: "Track details" });
    const first = await mid(page, WALK, 1);
    await page.mouse.click(first.x, first.y);
    await expect(sheet).toContainText("Walk 1 of 2");
    await expect(sheet).toContainText("5 pings");
    await expect(sheet).toContainText("4 min");
    await page.keyboard.press("Escape");
    const second = await mid(page, WALK2, 1);
    await page.mouse.click(second.x, second.y);
    await expect(sheet).toContainText("Walk 2 of 2");
    await expect(sheet).toContainText("4 pings");
    await expect(sheet).toContainText("3 min");
    await expect(sheet).toContainText("51.62000, -0.06000");
    await expect(sheet).toContainText("51.63500, -0.03000");
  });

  test("the Track details control opens the latest walk and Previous and Next walk step through them, keeping focus", async ({ page }) => {
    await openAdmin(page, { onTracks: twoWalks });
    await page.locator(".admin-user-item", { hasText: "aaaaaaaa" }).click();
    await page.getByRole("button", { name: "Track details for aaaaaaaa" }).click();
    const sheet = page.getByRole("region", { name: "Track details" });
    await expect(sheet).toContainText("Walk 2 of 2");
    await expect(sheet).toContainText("4 pings");
    const prev = page.getByRole("button", { name: "Previous walk" });
    const next = page.getByRole("button", { name: "Next walk" });
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await prev.focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toContainText("Walk 1 of 2");
    await expect(sheet).toContainText("5 pings");
    await expect(prev).toBeFocused();
    await expect(prev).toHaveAttribute("aria-disabled", "true");
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toContainText("Walk 2 of 2");
    await expect(next).toBeFocused();
  });
});

test.describe("Admin map: pinch to zoom on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  // One CDP session for a whole gesture, so touch ids stay stable.
  async function gesture(page) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
    return { send, done: () => cdp.detach() };
  }

  test("spreading two fingers zooms the map in, saves the zoom, and does not open any details when the fingers lift on a route line", async ({ page }) => {
    await openAdmin(page);
    expect(await savedZoom(page)).toBe(1);
    const mid = await midOfSegment(page, 2);
    const g = await gesture(page);
    await g.send("touchStart", [[mid.x - 20, mid.y, 1], [mid.x + 20, mid.y, 2]]);
    await g.send("touchMove", [[mid.x - 50, mid.y, 1], [mid.x + 50, mid.y, 2]]);
    await g.send("touchMove", [[mid.x - 80, mid.y, 1], [mid.x + 80, mid.y, 2]]);
    await g.send("touchEnd", []);
    await g.done();
    await expect.poll(() => savedZoom(page)).toBeGreaterThan(2.5);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(page.getByRole("region", { name: "Track details" })).toBeHidden();
    await expect(page.getByRole("region", { name: "Tap details" })).toBeHidden();
  });

  test("pinching in zooms out, and the point under the fingers stays put", async ({ page }) => {
    await openAdmin(page);
    // Zoom in first with the + button so there is room to zoom out.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    const startZoom = await savedZoom(page);
    expect(startZoom).toBeGreaterThan(1.5);
    const focus = await canvasPoint(page, 51.66, 0.04);
    const g = await gesture(page);
    await g.send("touchStart", [[focus.x - 90, focus.y, 1], [focus.x + 90, focus.y, 2]]);
    await g.send("touchMove", [[focus.x - 50, focus.y, 1], [focus.x + 50, focus.y, 2]]);
    await g.send("touchEnd", []);
    await g.done();
    await expect.poll(() => savedZoom(page)).toBeLessThan(startZoom * 0.8);
    const after = await canvasPoint(page, 51.66, 0.04);
    expect(Math.abs(after.x - focus.x)).toBeLessThan(2);
    expect(Math.abs(after.y - focus.y)).toBeLessThan(2);
  });

  test("lifting one finger carries on as a pan without a jump, and ends cleanly", async ({ page }) => {
    await openAdmin(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    const c = await canvasPoint(page, 51.66, 0.04);
    const g = await gesture(page);
    await g.send("touchStart", [[c.x - 40, c.y, 1], [c.x + 40, c.y, 2]]);
    await g.send("touchMove", [[c.x - 40, c.y, 1], [c.x + 40, c.y, 2]]);
    await g.send("touchEnd", [[c.x - 40, c.y, 1]]); // finger 1 lifts, finger 2 stays
    const before = await canvasPoint(page, 51.66, 0.04);
    await g.send("touchMove", [[c.x + 40, c.y, 2]]); // no movement: no jump
    const still = await canvasPoint(page, 51.66, 0.04);
    expect(Math.abs(still.x - before.x)).toBeLessThan(1);
    expect(Math.abs(still.y - before.y)).toBeLessThan(1);
    await g.send("touchMove", [[c.x + 70, c.y + 25, 2]]);
    await g.send("touchEnd", []);
    await g.done();
    await expect.poll(async () => (await canvasPoint(page, 51.66, 0.04)).x).toBeGreaterThan(before.x + 20);
    // No stuck drag: the map has left the grabbing state.
    await expect(page.locator("#adminCanvas")).not.toHaveClass(/dragging/);
    // A later plain tap on a route line still works.
    await page.getByRole("button", { name: "Reset" }).click();
    const p = await midOfSegment(page, 1);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByRole("region", { name: "Track details" })).toBeVisible();
  });

  test("a finger tap within 12px of a route line opens its track details", async ({ page }) => {
    await openAdmin(page);
    const p = await midOfSegment(page, 1);
    // A route line here runs up and to the right, so a point straight above its midpoint is perpendicular distance 10 * cos(angle) away: well inside 12px.
    await page.touchscreen.tap(p.x, p.y - 9);
    await expect(page.getByRole("region", { name: "Track details" })).toBeVisible();
  });

  test("the toolbar and track sheet fit at 390px with 44px touch targets", async ({ page }) => {
    await openAdmin(page);
    for (const loc of [page.locator("#adminWindowSelect"), page.locator("#adminAudienceAll"), page.locator("#adminAudienceBeta")]) {
      const box = await loc.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(box.x + box.width).toBeLessThanOrEqual(390.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe("Admin time frame", () => {
  test("the time frame control offers 24 hours, 7, 30 and 90 days and All, defaulting to 30 days and asking the server for it", async ({ page }) => {
    const asked = [];
    await openAdmin(page, { onTracks: (route) => { asked.push(new URL(route.request().url()).searchParams.get("days")); return json(route, 200, tracks()); } });
    expect(asked[0]).toBe("30");
    const select = page.getByLabel("Time frame");
    await expect(select).toHaveValue("30");
    await expect(select.locator("option")).toHaveText(["24 hours", "7 days", "30 days", "90 days", "All"]);
  });

  test("choosing a time frame re-fetches that window (24 hours is days=1, All is days=all), puts it in the address, and Stats says so", async ({ page }) => {
    const asked = [];
    await openAdmin(page, {
      onTracks: (route) => {
        const days = new URL(route.request().url()).searchParams.get("days");
        asked.push(days);
        return json(route, 200, tracks({ meta: { storeName: "tracking-test", context: "test", windowDays: days === "all" ? null : Number(days) } }));
      },
    });
    await page.getByRole("button", { name: "Stats" }).click();
    await page.getByLabel("Time frame").selectOption("1");
    await expect.poll(() => asked.at(-1)).toBe("1");
    await expect(page.locator("#adminStatsSub")).toContainText("the last 24 hours");
    await expect.poll(() => page.url()).toContain("days=1");
    await page.getByLabel("Time frame").selectOption("all");
    await expect.poll(() => asked.at(-1)).toBe("all");
    await expect(page.locator("#adminStatsSub")).toContainText("all history");
    await expect(page.locator(".nav-card", { hasText: "Time window" })).toContainText("All history");
    await page.getByLabel("Time frame").selectOption("7");
    await expect(page.locator("#adminStatsSub")).toContainText("the last 7 days");
    // Refresh keeps the chosen window.
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => asked.at(-1)).toBe("7");
    expect(asked.slice(-2)).toEqual(["7", "7"]);
    await expect(page.getByLabel("Time frame")).toHaveValue("7");
  });

  test("opening the dashboard with ?days=90 loads 90 days", async ({ page }) => {
    const asked = [];
    await openAdmin(page, { url: "/admin?days=90", onTracks: (route) => { asked.push(new URL(route.request().url()).searchParams.get("days")); return json(route, 200, tracks()); } });
    expect(asked[0]).toBe("90");
    await expect(page.getByLabel("Time frame")).toHaveValue("90");
  });

  test("when the chosen window is too big for the server the control shows the window that actually loaded and says why", async ({ page }) => {
    await openAdmin(page, {
      url: "/admin?days=90",
      onTracks: (route) => {
        const days = new URL(route.request().url()).searchParams.get("days");
        return days === "90" || days === "30" ? json(route, 503, { error: "busy" }) : json(route, 200, tracks({ meta: { storeName: "tracking-test", context: "test", windowDays: Number(days) } }));
      },
    });
    await expect(page.getByLabel("Time frame")).toHaveValue("7");
    await expect(page.locator("#adminWindowNote")).toContainText("Showing the last 7 days");
    await page.getByRole("button", { name: "Stats" }).click();
    await expect(page.locator("#adminStatsSub")).toContainText("the last 7 days");
  });

  test("a failed time frame change keeps the previous data on screen, reverts the control and says what happened", async ({ page }) => {
    await openAdmin(page, { onTracks: (route) => (new URL(route.request().url()).searchParams.get("days") === "90" ? route.abort() : json(route, 200, tracks())) });
    await page.getByLabel("Time frame").selectOption("90");
    await expect(page.locator("#adminWindowNote")).toContainText("Could not load the last 90 days. Still showing the last 30 days.");
    await expect(page.getByLabel("Time frame")).toHaveValue("30");
    await expect(page.locator(".admin-user-item")).toHaveCount(3); // All users, aaaaaaaa, bbbbbbbb: still there
    await expect(page.locator("#adminToolbar")).toHaveAttribute("aria-busy", "false");
  });

  test("a failed change to All says 'all history', in the same plain words as the other windows", async ({ page }) => {
    await openAdmin(page, { onTracks: (route) => (new URL(route.request().url()).searchParams.get("days") === "all" ? route.abort() : json(route, 200, tracks())) });
    await page.getByLabel("Time frame").selectOption("all");
    await expect(page.locator("#adminWindowNote")).toHaveText("Could not load all history. Still showing the last 30 days.");
  });

  test("a slow answer for an earlier time frame never overwrites the newer choice", async ({ page }) => {
    let releaseSlow;
    const slow = new Promise((resolve) => { releaseSlow = resolve; });
    let slowAsked;
    const slowSeen = new Promise((resolve) => { slowAsked = resolve; });
    await openAdmin(page, {
      onTracks: async (route) => {
        const days = new URL(route.request().url()).searchParams.get("days");
        if (days === "90") {
          slowAsked();
          await slow;
          // The old window had two users...
          return json(route, 200, tracks({ meta: { storeName: "tracking-test", context: "test", windowDays: 90 } }));
        }
        // ...the newer one only user A.
        return json(route, 200, { locations: WALK.map(([lat, lng], i) => ping(A, i, lat, lng)), clicks: [], meta: { storeName: "tracking-test", context: "test", windowDays: Number(days) } });
      },
    });
    await page.getByLabel("Time frame").selectOption("90");
    await slowSeen;
    await expect(page.locator("#adminToolbar")).toHaveAttribute("aria-busy", "true");
    await page.getByLabel("Time frame").selectOption("7");
    await expect(page.locator(".admin-user-item")).toHaveCount(2); // All users + aaaaaaaa
    const slowFinished = page.waitForEvent("requestfinished", (request) => request.url().includes("days=90"));
    releaseSlow();
    await slowFinished;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(page.locator(".admin-user-item")).toHaveCount(2);
    await expect(page.getByLabel("Time frame")).toHaveValue("7");
    await expect(page.locator("#adminToolbar")).toHaveAttribute("aria-busy", "false");
  });
});

test.describe("Admin time frame and refresh", () => {
  test("a failed Refresh that overtook a time frame change puts the control, address and note back on the data actually shown", async ({ page }) => {
    let ninety = 0;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let firstAsked;
    const firstSeen = new Promise((resolve) => { firstAsked = resolve; });
    await openAdmin(page, {
      onTracks: async (route) => {
        if (new URL(route.request().url()).searchParams.get("days") !== "90") return json(route, 200, tracks());
        ninety += 1;
        if (ninety === 1) { firstAsked(); await held; return route.abort(); }
        return route.abort(); // the Refresh fails
      },
    });
    await page.getByLabel("Time frame").selectOption("90");
    await firstSeen;
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator("#adminRefreshStatus")).toContainText("Could not refresh");
    await expect(page.getByLabel("Time frame")).toHaveValue("30");
    await expect.poll(() => page.url()).not.toContain("days=90");
    await expect(page.locator("#adminRefreshStatus")).toContainText("Could not refresh. Could not load the last 90 days; still showing the last 30 days");
    await expect(page.locator("#adminWindowNote")).toHaveText(""); // one note, not two
    await expect(page.locator("#adminToolbar")).toHaveAttribute("aria-busy", "false");
    release();
  });
});

test.describe("Admin beta users filter", () => {
  test("Beta users only narrows the Users list, the Stats page and its subtitle, and Everyone brings everyone back", async ({ page }) => {
    await openAdmin(page);
    const everyone = page.getByRole("button", { name: "Everyone" });
    const beta = page.getByRole("button", { name: "Beta users only" });
    await expect(everyone).toHaveAttribute("aria-pressed", "true");
    await expect(beta).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".admin-user-item")).toHaveCount(3);
    await page.getByRole("button", { name: "Stats" }).click();
    await expect(page.locator(".nav-card", { hasText: "Location pings" })).toContainText("7");
    await beta.click();
    await expect(beta).toHaveAttribute("aria-pressed", "true");
    await expect(everyone).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".admin-user-item")).toHaveCount(2); // All beta users + bbbbbbbb
    await expect(page.locator(".admin-user-item", { hasText: "bbbbbbbb" })).toBeVisible();
    await expect(page.locator(".admin-user-item", { hasText: "aaaaaaaa" })).toHaveCount(0);
    await expect(page.locator(".nav-card", { hasText: "Location pings" })).toContainText("2");
    await expect(page.locator("#adminStatsSub")).toContainText("for beta users");
    await expect.poll(() => page.url()).toContain("beta=1");
    await expect(page.locator("#adminFilterNote")).toHaveText("Beta users only: activity from before beta users were marked isn't counted here.");
    await everyone.click();
    await expect(page.locator(".admin-user-item")).toHaveCount(3);
    await expect(page.locator(".nav-card", { hasText: "Location pings" })).toContainText("7");
  });

  test("a selected user the beta filter hides is deselected", async ({ page }) => {
    await openAdmin(page);
    await page.locator(".admin-user-item", { hasText: "aaaaaaaa" }).click();
    await expect(page.locator(".admin-user-item.selected")).toContainText("aaaaaaaa");
    await page.getByRole("button", { name: "Beta users only" }).click();
    await expect(page.locator(".admin-user-item.selected")).toContainText("All beta users");
    await page.getByRole("button", { name: "Stats" }).click();
    await expect(page.locator("#adminStatsSub")).toContainText("for beta users");
  });

  test("with no beta activity in the window the map says so instead of staying blank", async ({ page }) => {
    await openAdmin(page, { onTracks: (route) => json(route, 200, { locations: WALK.map(([lat, lng], i) => ping(A, i, lat, lng)), clicks: [], meta: { storeName: "t", context: "test", windowDays: 30 } }) });
    await page.getByRole("button", { name: "Beta users only" }).click();
    await expect(page.locator("#adminFilterNote")).toHaveText("No beta user activity in this window yet. Activity from before beta users were marked isn't counted here.");
    await page.getByRole("button", { name: "Everyone" }).click();
    await expect(page.locator("#adminFilterNote")).toHaveText("");
    await page.getByRole("button", { name: "Beta users only" }).click();
    await page.getByRole("button", { name: "Stats" }).click();
    await expect(page.locator("#adminStatsBody .nav-empty-state")).toHaveText("No beta user activity in this window yet. Activity from before beta users were marked isn't counted here.");
  });

  test("the packed beta index from the server marks events, so the filter works on real responses", async ({ page }) => {
    const packed = {
      format: 2,
      locations: { v: 2, type: "location", uids: [A, B], targets: [], rows: [[0, Date.parse(at(0)), 51.64, 0, 0, -1], [1, Date.parse(at(1)), 51.615, -0.05, 0, -1], [1, Date.parse(at(2)), 51.618, -0.045, 0, -1]], beta: [1, 2] },
      clicks: { v: 2, type: "click", uids: [], rows: [] },
      navigation: { v: 2, type: "navigation", uids: [], rows: [] },
      meta: { storeName: "tracking-test", context: "test", windowDays: 30 },
    };
    await openAdmin(page, { onTracks: (route) => json(route, 200, packed) });
    await expect(page.locator(".admin-user-item")).toHaveCount(3);
    await page.getByRole("button", { name: "Beta users only" }).click();
    await expect(page.locator(".admin-user-item")).toHaveCount(2);
    await expect(page.locator(".admin-user-item", { hasText: "bbbbbbbb" })).toContainText("2 pts");
  });
});

test.describe("Admin sign-in check", () => {
  test("a sign-in check that never answers ends in the sign-in link instead of 'Checking your sign-in' forever", async ({ page }) => {
    await skipOnboarding(page);
    await page.clock.install();
    let asked;
    const seen = new Promise((resolve) => { asked = resolve; });
    await page.route(/\/api\/admin\/me/, async () => { asked(); /* never answered */ });
    await page.goto("/admin");
    await seen;
    await expect(page.getByText("Checking your sign-in")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeHidden();
    await page.clock.fastForward(9000);
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("#loginError")).toHaveText("Could not check your sign-in. Reload the page, then sign in.");
    await expect(page.getByText("Checking your sign-in")).toBeHidden();
  });

  test("a signed-in deep link to /admin#stats shows the checking note while pending, never the login card, and then the page", async ({ page }) => {
    await skipOnboarding(page);
    await page.addInitScript(() => {
      window.__loginSeen = false;
      const look = () => {
        const link = document.getElementById("loginBtn");
        if (link && link.getClientRects().length > 0) window.__loginSeen = true;
        if (!window.__stop) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let asked;
    const seen = new Promise((resolve) => { asked = resolve; });
    await page.route(/\/api\/admin\/me/, async (route) => { asked(); await held; return json(route, 200, { signedIn: true, name: "T" }); });
    await page.route(/\/api\/admin\/tracks/, (route) => json(route, 200, tracks()));
    await page.goto("/admin#stats");
    await seen;
    await expect(page.getByText("Checking your sign-in")).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
    await expect(page.getByText("Checking your sign-in")).toBeHidden();
    expect(await page.evaluate(() => { window.__stop = true; return window.__loginSeen; })).toBe(false);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("the sign-in card and its link are simply shown", async ({ page }) => {
      await page.goto("/admin");
      await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
      await expect(page.getByText("Checking your sign-in")).toBeHidden();
    });
  });
});

const COMMUNITY = { generatedAt: Date.parse("2026-11-20T10:00:00Z"), devices: 12, activeDevices1d: 3, activeDevices7d: 7, reports: 40, questioned: 9, verified: 5, newTreesUnconfirmed: 2, newTreesConfirmed: 1, conflicts: 0, totalPoints: 120, byStatus: { verified: 5 }, perDay: { "2026-11-20": 6 } };
const CODES = [{ code: "b345f", note: "Ann", createdAt: "2026-10-30T10:00:00.000Z", status: "open" }];
async function mockPages(page) {
  await page.route(/\/api\/community\/overlay/, (route) => json(route, 200, COMMUNITY));
  await page.route(/\/api\/beta\/codes/, (route) => json(route, 200, { codes: CODES }));
}

test.describe("Admin refresh and visibility", () => {
  test("Refresh on the Community and Beta pages keeps their content", async ({ page }) => {
    await openAdmin(page);
    await mockPages(page);
    await page.getByRole("button", { name: "Community" }).click();
    await expect(page.locator("#adminCommunityBody .nav-card", { hasText: "Reports" })).toBeVisible();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
    await expect(page.locator("#adminCommunityBody .nav-card", { hasText: "Reports" })).toBeVisible();
    await page.getByRole("button", { name: "Beta", exact: true }).click();
    await expect(page.locator("#adminBetaOpen")).toContainText("Ann");
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
    await expect(page.locator("#adminBetaOpen")).toContainText("Ann");
  });

  test("the 5-minute auto-refresh waits while the tab is hidden and refreshes once when it comes back", async ({ page }) => {
    await skipOnboarding(page);
    await page.clock.install();
    await page.addInitScript(() => { window.__hidden = false; Object.defineProperty(document, "hidden", { get: () => window.__hidden }); });
    let asked = 0;
    await openAdmin(page, { onTracks: (route) => { asked += 1; return json(route, 200, tracks()); } });
    expect(asked).toBe(1);
    await page.evaluate(() => { window.__hidden = true; });
    await page.clock.fastForward(6 * 60 * 1000);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(asked).toBe(1);
    await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
    await expect.poll(() => asked).toBe(2);
  });
});

test.describe("Admin touch targets on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const NAMES = ["tracksBtn", "heatmapBtn", "navigationBtn", "statsBtn", "communityBtn", "betaBtn"];

  test("all six top-bar buttons are at least 44x44 and fully inside a 390px screen", async ({ page }) => {
    await openAdmin(page);
    for (const id of NAMES) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.width, id).toBeGreaterThanOrEqual(43.5);
      expect(box.height, id).toBeGreaterThanOrEqual(43.5);
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(390.5);
    }
  });
});

test.describe("Admin on the narrowest phone", () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });

  test("every top-bar button is reachable by Tab and is scrolled fully into view when focused", async ({ page }) => {
    await openAdmin(page);
    await page.locator("#tracksBtn").focus();
    for (const id of ["heatmapBtn", "navigationBtn", "statsBtn", "communityBtn", "betaBtn"]) {
      await page.keyboard.press("Tab");
      await expect(page.locator(`#${id}`)).toBeFocused();
      await expect.poll(async () => {
        const box = await page.locator(`#${id}`).boundingBox();
        return box.x >= -0.5 && box.x + box.width <= 320.5;
      }, { message: `${id} is scrolled into view` }).toBe(true);
    }
  });

  test("Stats, Community and Beta have no horizontal page scroll at 320px", async ({ page }) => {
    await openAdmin(page);
    await mockPages(page);
    for (const [name, ready] of [["Stats", "#adminStatsBody .nav-card"], ["Community", "#adminCommunityBody .nav-card"], ["Beta", "#adminBetaOpen li"]]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.locator(ready).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), name).toBeLessThanOrEqual(320);
    }
  });
});

test.describe("Admin walks: identity, announcement and drawing", () => {
  const WALK2 = [[51.620, -0.060], [51.625, -0.050], [51.630, -0.040], [51.635, -0.030]];
  const WALK3 = [[51.700, 0.100], [51.705, 0.110], [51.710, 0.120]];
  const all = () => [
    ...WALK.map(([lat, lng], i) => ping(A, i, lat, lng)),
    ...WALK2.map(([lat, lng], i) => ping(A, 120 + i, lat, lng)),
    ...WALK3.map(([lat, lng], i) => ping(A, 300 + i, lat, lng)),
  ];
  const threeWalks = (route) => {
    const days = new URL(route.request().url()).searchParams.get("days");
    // The shorter window only reaches the latest walk.
    return json(route, 200, tracks({ locations: days === "7" ? all().filter((e) => Date.parse(e.ts) >= Date.parse(at(300))) : all() }));
  };
  const mid = async (page, list, i) => {
    const a = await canvasPoint(page, ...list[i]);
    const b = await canvasPoint(page, ...list[i + 1]);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  test("the 'Walk N of M' status is one persistent live region that is updated in place when stepping", async ({ page }) => {
    await openAdmin(page, { onTracks: threeWalks });
    await page.locator(".admin-user-item", { hasText: "aaaaaaaa" }).click();
    await page.getByRole("button", { name: "Track details for aaaaaaaa" }).click();
    const status = page.locator("#adminTrackWalkStatus");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveText("Walk 3 of 3");
    const before = await status.elementHandle();
    await page.getByRole("button", { name: "Previous walk" }).click();
    await expect(status).toHaveText("Walk 2 of 3");
    expect(await page.evaluate((node) => node === document.getElementById("adminTrackWalkStatus") && document.contains(node), before)).toBe(true);
  });

  test("a walk that leaves the window is not silently swapped: the latest is shown and the status says so", async ({ page }) => {
    await openAdmin(page, { onTracks: threeWalks });
    const first = await mid(page, WALK, 1);
    await page.mouse.click(first.x, first.y);
    const sheet = page.getByRole("region", { name: "Track details" });
    await expect(sheet).toContainText("Walk 1 of 3");
    await page.getByLabel("Time frame").selectOption("7");
    await expect(page.locator("#adminTrackWalkStatus")).toHaveText("Walk 1 of 1. That walk is no longer in this window. Showing the latest.");
    await expect(sheet).toContainText("3 pings");
  });

  test("a walk that is still in the window stays the one shown after a refresh that adds an earlier walk (its position shifts)", async ({ page }) => {
    let calls = 0;
    const EARLIER = [[51.600, 0.100], [51.605, 0.105]];
    await openAdmin(page, {
      onTracks: (route) => {
        calls += 1;
        const extra = calls > 1 ? EARLIER.map(([lat, lng], i) => ping(A, -300 + i, lat, lng)) : [];
        return json(route, 200, tracks({ locations: [...extra, ...all()] }));
      },
    });
    const second = await mid(page, WALK2, 1);
    await page.mouse.click(second.x, second.y);
    const sheet = page.getByRole("region", { name: "Track details" });
    await expect(sheet).toContainText("Walk 2 of 3");
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
    await expect(page.locator("#adminTrackWalkStatus")).toHaveText("Walk 3 of 4");
    await expect(sheet).toContainText("4 pings");
    await expect(sheet).toContainText("51.62000, -0.06000");
  });

  test("a walk whose first pings age out of a rolling window is still the walk shown, with no notice", async ({ page }) => {
    await openAdmin(page, {
      onTracks: (route) => {
        const days = new URL(route.request().url()).searchParams.get("days");
        // The 7-day window has lost the first two pings of walk 1, but the walk is still there.
        return json(route, 200, tracks({ locations: days === "7" ? all().filter((e) => !(e.uid === A && Date.parse(e.ts) < Date.parse(at(2)))) : all() }));
      },
    });
    const first = await mid(page, WALK, 3);
    await page.mouse.click(first.x, first.y);
    const sheet = page.getByRole("region", { name: "Track details" });
    await expect(sheet).toContainText("Walk 1 of 3");
    await expect(sheet).toContainText("5 pings");
    await page.getByLabel("Time frame").selectOption("7");
    // The same walk, now starting at its third ping (the reload has landed once the start has moved).
    await expect(sheet).toContainText("51.66000, 0.04000");
    await expect(sheet).toContainText("3 pings");
    await expect(page.locator("#adminTrackWalkStatus")).toHaveText("Walk 1 of 3");
  });

  test("the 'no longer in this window' notice clears when the walk is back in the window", async ({ page }) => {
    await openAdmin(page, { onTracks: threeWalks });
    const first = await mid(page, WALK, 1);
    await page.mouse.click(first.x, first.y);
    await page.getByLabel("Time frame").selectOption("7");
    await expect(page.locator("#adminTrackWalkStatus")).toContainText("no longer in this window");
    await page.getByLabel("Time frame").selectOption("30");
    await expect(page.locator("#adminTrackWalkStatus")).toHaveText("Walk 1 of 3");
    await expect(page.getByRole("region", { name: "Track details" })).toContainText("5 pings");
  });

  test("when a refresh leaves a single walk, focus on Previous or Next moves to the sheet's Close button", async ({ page }) => {
    let calls = 0;
    await openAdmin(page, { onTracks: (route) => { calls += 1; return json(route, 200, tracks({ locations: calls > 1 ? all().filter((e) => Date.parse(e.ts) >= Date.parse(at(300))) : all() })); } });
    await page.locator(".admin-user-item", { hasText: "aaaaaaaa" }).click();
    await page.getByRole("button", { name: "Track details for aaaaaaaa" }).click();
    await page.getByRole("button", { name: "Previous walk" }).focus();
    await page.evaluate(() => document.getElementById("refreshBtn").click()); // a refresh that does not move focus itself
    await expect(page.locator("#adminTrackWalkStatus")).toHaveText("Walk 1 of 1");
    await expect(page.getByRole("button", { name: "Close track details (Esc)" })).toBeFocused();
  });

  test("a walk of a single ping is drawn as a dot, can be tapped, and the sheet reads 1 ping", async ({ page }) => {
    const LONE = [51.69, -0.09];
    await openAdmin(page, { onTracks: (route) => json(route, 200, tracks({ locations: [...all(), ping(A, 60, ...LONE)] })) });
    const p = await canvasPoint(page, ...LONE);
    const lit = await page.evaluate(([x, y]) => {
      const c = document.getElementById("adminCanvas");
      const r = c.getBoundingClientRect();
      const d = c.getContext("2d").getImageData(Math.round((x - r.left) * c.width / r.width) - 2, Math.round((y - r.top) * c.height / r.height) - 2, 5, 5).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] - d[i] > 40) return true; // the route colour is much greener than the map's pale ground
      return false;
    }, [p.x, p.y]);
    expect(lit).toBe(true);
    await page.mouse.click(p.x, p.y);
    const sheet = page.getByRole("region", { name: "Track details" });
    await expect(sheet).toContainText("Walk 2 of 4");
    await expect(sheet).toContainText("1 ping");
  });

  test("the sheet's heading comes before its walk controls in reading order", async ({ page }) => {
    await openAdmin(page, { onTracks: threeWalks });
    const first = await mid(page, WALK, 1);
    await page.mouse.click(first.x, first.y);
    const before = await page.evaluate(() => {
      const h = document.querySelector("#adminTrackDetails h2");
      const status = document.getElementById("adminTrackWalkStatus");
      return !!(h.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(before).toBe(true);
  });

  test("the empty ground between two walks is not a route line: no click there and no line is drawn across it", async ({ page }) => {
    await openAdmin(page, { onTracks: threeWalks });
    const end1 = await canvasPoint(page, ...WALK[4]);
    const start2 = await canvasPoint(page, ...WALK2[0]);
    const gap = { x: (end1.x + start2.x) / 2, y: (end1.y + start2.y) / 2 };
    await page.mouse.click(gap.x, gap.y);
    await expect(page.getByRole("region", { name: "Track details" })).toBeHidden();
    // Pixel check: no route colour anywhere near the middle of the gap, while a point known to be on a route IS lit (positive control).
    const lit = (x, y, radius) => page.evaluate(([px, py, r]) => {
      const c = document.getElementById("adminCanvas");
      const rect = c.getBoundingClientRect();
      const sx = c.width / rect.width;
      const d = c.getContext("2d").getImageData(Math.round((px - rect.left - r) * sx), Math.round((py - rect.top - r) * sx), Math.round(2 * r * sx) + 1, Math.round(2 * r * sx) + 1).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] - d[i] > 40) return true; // greener than the map background
      return false;
    }, [x, y, radius]);
    const onRoute = await mid(page, WALK, 1);
    expect(await lit(onRoute.x, onRoute.y, 3)).toBe(true);
    expect(await lit(gap.x, gap.y, 8)).toBe(false);
  });
});

test.describe("Admin load that never answers", () => {
  test("a signed-in admin whose data load hangs sees what is happening, then a clear failure", async ({ page }) => {
    await skipOnboarding(page);
    await page.clock.install();
    await page.route(/\/api\/admin\/me/, (route) => json(route, 200, { signedIn: true, name: "T" }));
    let asked;
    const seen = new Promise((resolve) => { asked = resolve; });
    await page.route(/\/api\/admin\/tracks/, async () => { asked(); /* never answered */ });
    await page.goto("/admin");
    await seen;
    await page.clock.fastForward(11000);
    await expect(page.locator("#loginError")).toHaveText("Still checking your sign-in… If this stays, reload the page.");
    await page.clock.fastForward(11000);
    await expect(page.locator("#loginError")).toHaveText("Could not reach the server. Check your connection, then reload the page.");
  });
});

test.describe("Admin track sheet and toolbar fit on small phones", () => {
  for (const width of [320, 360, 390]) {
    test(`at ${width}px the walk controls are 44px targets, nothing overflows, and the pressed toggle fits`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      const WALK2 = [[51.620, -0.060], [51.625, -0.050]];
      await openAdmin(page, { onTracks: (route) => json(route, 200, tracks({ locations: [...WALK.map(([lat, lng], i) => ping(A, i, lat, lng)), ...WALK2.map(([lat, lng], i) => ping(A, 120 + i, lat, lng))] })) });
      await page.getByRole("button", { name: "Beta users only" }).click();
      await page.getByRole("button", { name: "Everyone" }).click();
      await page.locator(".admin-user-item", { hasText: "aaaaaaaa" }).click();
      await page.getByRole("button", { name: "Track details for aaaaaaaa" }).click();
      const sheet = await page.locator("#adminTrackDetails").boundingBox();
      expect(sheet.x).toBeGreaterThanOrEqual(0);
      expect(sheet.x + sheet.width).toBeLessThanOrEqual(width + 0.5);
      const prev = await page.getByRole("button", { name: "Previous walk" }).boundingBox();
      const next = await page.getByRole("button", { name: "Next walk" }).boundingBox();
      for (const box of [prev, next]) {
        expect(box.height).toBeGreaterThanOrEqual(43.5);
        expect(box.width).toBeGreaterThanOrEqual(43.5);
        expect(box.x + box.width).toBeLessThanOrEqual(sheet.x + sheet.width + 0.5);
      }
      if (Math.abs(prev.y - next.y) < 4) expect(next.x - (prev.x + prev.width)).toBeGreaterThanOrEqual(4);
      const status = await page.locator("#adminTrackWalkStatus").boundingBox();
      expect(status.x + status.width).toBeLessThanOrEqual(sheet.x + sheet.width + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      for (const id of ["adminWindowSelect", "adminAudienceAll", "adminAudienceBeta"]) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box.x + box.width, id).toBeLessThanOrEqual(width + 0.5);
      }
      await context.close();
    });
  }
});
