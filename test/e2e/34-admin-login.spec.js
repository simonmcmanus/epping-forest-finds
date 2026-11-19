const { test, expect } = require("@playwright/test");
const { skipOnboarding } = require("./helpers");

const TRACKS = { locations: [], clicks: [], meta: { storeName: "tracking-test", context: "test", windowDays: 30 } };

test.describe("Admin login", () => {
  // Desktop only: this file is outside the mobile project's testMatch, and the dashboard is a desk tool.
  test("snapshot: admin sign-in screen", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByLabel("Admin password")).toBeVisible();
    await expect(page).toHaveScreenshot("admin-login.png", { fullPage: false });
  });

  test("Admin keeps the password out of browser storage", async ({ page }) => {
    const password = "correct-horse-battery-staple-7731";
    const authHeaders = [];
    await skipOnboarding(page);
    await page.route(/\/api\/admin\/tracks/, (route) => {
      authHeaders.push(route.request().headers()["authorization"]);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TRACKS) });
    });
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill(password);
    await page.click("#loginBtn");
    await expect(page.locator("#adminApp")).toBeVisible();

    const storage = await page.evaluate(() => JSON.stringify({
      session: Object.entries(sessionStorage),
      local: Object.entries(localStorage),
    }));
    expect(storage).not.toContain(password);

    await page.reload();
    await expect(page.locator("#loginScreen")).toBeVisible();
    // Nothing fetched the data on the reload: the page waited for the password to be typed again.
    expect(authHeaders).toEqual([`Bearer ${password}`]);
  });

  test("Admin clears a password that an earlier version left in session storage", async ({ page }) => {
    await skipOnboarding(page);
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TRACKS) }));
    await page.goto("/admin");
    await page.evaluate(() => sessionStorage.setItem("ff-admin-session-password", "left-by-old-version"));
    await page.reload();
    await expect(page.getByLabel("Admin password")).toBeVisible();
    const leftover = await page.evaluate(() => sessionStorage.getItem("ff-admin-session-password"));
    expect(leftover).toBeNull();
  });

  test("falls back to a shorter window when the full one fails on the server", async ({ page }) => {
    const asked = [];
    await skipOnboarding(page);
    await page.route(/\/api\/admin\/tracks/, (route) => {
      const url = new URL(route.request().url());
      asked.push(url.searchParams.get("days"));
      if (!url.searchParams.get("days")) return route.fulfill({ status: 502, contentType: "text/plain", body: "Bad Gateway" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...TRACKS, meta: { ...TRACKS.meta, windowDays: Number(url.searchParams.get("days")) } }) });
    });
    await page.goto("/admin");
    await page.fill("#loginPassword", "secret");
    await page.click("#loginBtn");
    await expect(page.locator("#adminStats")).toContainText("last 7 days");
    expect(asked).toEqual([null, "7"]);
  });

  test("says what the server answered when every window fails", async ({ page }) => {
    await skipOnboarding(page);
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 502, contentType: "text/plain", body: "Bad Gateway" }));
    await page.goto("/admin");
    await page.fill("#loginPassword", "secret");
    await page.click("#loginBtn");
    await expect(page.locator("#loginError")).toContainText("Server error 502: Bad Gateway");
  });

  test("a wrong password is still reported as one", async ({ page }) => {
    await skipOnboarding(page);
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
    await page.goto("/admin");
    await page.fill("#loginPassword", "nope");
    await page.click("#loginBtn");
    await expect(page.locator("#loginError")).toContainText("Incorrect password");
  });

  test("shows the people in a packed tracking response and says how far back a partial one reaches", async ({ page }) => {
    await skipOnboarding(page);
    const packed = {
      format: 2,
      locations: {
        v: 2, type: "location", uids: ["user-aaaa-1111", "user-bbbb-2222"], targets: [],
        rows: [[0, Date.parse("2026-10-20T10:00:00Z"), 51.65, 0.04, null, -1], [1, Date.parse("2026-10-21T10:00:00Z"), 51.66, 0.05, 90, -1]],
      },
      clicks: { v: 2, type: "click", uids: [], rows: [] },
      meta: { ...TRACKS.meta, partial: true, oldestDay: "2026-10-20", oldestDayIncomplete: true },
    };
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packed) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");

    await expect(page.getByRole("button", { name: /pts/ })).toHaveCount(2);
    await expect(page.locator("#adminStats")).toContainText("2 location pings");
    await expect(page.locator("#adminStats")).toContainText("back to 2026-10-20, that day only in part");
  });

  test("snapshot: admin navigation journey block when packed navigation events are present", async ({ page }) => {
    await skipOnboarding(page);
    const at = (iso) => Date.parse(iso);
    // Fictional fixed coordinates and timestamps: one walker starts, arrives, then ends a navigation.
    const packed = {
      format: 2,
      locations: { v: 2, type: "location", uids: [], targets: [], rows: [] },
      clicks: { v: 2, type: "click", uids: [], rows: [] },
      navigation: {
        v: 2, type: "navigation", uids: ["walker-aaaa-1111"],
        rows: [
          [0, at("2026-10-20T10:00:00Z"), "nav-1", "Example Spot", "place", 51.5, 0.1, 51.49, 0.09, 1000, null, null, null, "start"],
          [0, at("2026-10-20T10:12:00Z"), "nav-1", "Example Spot", "place", 51.5, 0.1, 51.5, 0.1, 1000, 1250, 0, null, "arrive"],
          [0, at("2026-10-20T10:13:00Z"), "nav-1", "Example Spot", "place", 51.5, 0.1, 51.5, 0.1, 1000, 1250, 0, "arrived", "end"],
        ],
      },
      meta: { ...TRACKS.meta },
    };
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packed) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");

    const stats = page.locator("#adminStats");
    await expect(stats).toContainText("Navigation:");
    await expect(stats).toContainText("1 started");
    await expect(stats).toContainText("1 arrived (100%)");
    await expect(stats).toContainText("Detour: walked 1.25x the shortest route");
    // Navigation events carry no location pings or taps, so these are the final counts.
    await expect(stats).toContainText("0 users");
    await expect(stats).toContainText("0 location pings");
    await expect(stats).toContainText("0 taps");
    // Let the dashboard's entrance fade finish (an element state, not a sleep) before capturing.
    await expect.poll(() => page.evaluate(() => {
      const app = document.getElementById("adminApp");
      const running = document.getAnimations().filter((a) => a.playState === "running" || a.pending).length;
      return running === 0 && getComputedStyle(app).opacity === "1" && getComputedStyle(document.getElementById("adminStats")).opacity === "1";
    })).toBe(true);
    await expect(stats).toHaveScreenshot("admin-navigation-stats.png");
  });

  test("the Navigation view shows summary cards, a daily table and chart labels", async ({ page }) => {
    await skipOnboarding(page);
    const at = (iso) => Date.parse(iso);
    // Same fictional single journey as the navigation block test: 12 minutes to arrive, walked 1.25x the route.
    const packed = {
      format: 2,
      locations: { v: 2, type: "location", uids: [], targets: [], rows: [] },
      clicks: { v: 2, type: "click", uids: [], rows: [] },
      navigation: {
        v: 2, type: "navigation", uids: ["walker-aaaa-1111"],
        rows: [
          [0, at("2026-10-20T10:00:00Z"), "nav-1", "Example Spot", "place", 51.5, 0.1, 51.49, 0.09, 1000, null, null, null, "start"],
          [0, at("2026-10-20T10:12:00Z"), "nav-1", "Example Spot", "place", 51.5, 0.1, 51.5, 0.1, 1000, 1250, 0, null, "arrive"],
          [0, at("2026-10-20T10:13:00Z"), "nav-1", "Example Spot", "place", 51.5, 0.1, 51.5, 0.1, 1000, 1250, 0, "arrived", "end"],
        ],
      },
      meta: { ...TRACKS.meta },
    };
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packed) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");

    await page.getByRole("button", { name: "Navigation", exact: true }).click();
    const view = page.locator("#adminNavigation");
    await expect(view).toBeVisible();
    const card = (label) => view.locator(".nav-card", { hasText: label });
    await expect(card("Started")).toContainText("1");
    await expect(card("Completed")).toContainText("1");
    await expect(card("Completion rate")).toContainText("100%");
    await expect(card("Median time")).toContainText("12 min");
    await expect(card("Distance walked")).toContainText("1.25 km");
    await expect(card("Median detour")).toContainText("1.25x");
    await expect(card("With detour")).toContainText("1");

    const row = view.locator("table.nav-trend-table").first().locator("tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row.first()).toContainText("2026-10-20");
    await expect(row.first()).toContainText("100%");
    const charts = view.locator("svg[role='img']");
    await expect(charts).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(charts.nth(i)).toHaveAttribute("aria-label", /.+/);
    await expect(charts.first()).toHaveAttribute("aria-label", /1 started.*1 completed/);
    // No horizontal page scroll at the default viewport.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  // Fictional fixture: nine days of journeys, each day with a start, then an arrival on most days.
  async function openNavigationWithNineDays(page) {
    await skipOnboarding(page);
    const rows = [];
    for (let d = 0; d < 9; d++) {
      const day = String(10 + d).padStart(2, "0");
      for (let j = 0; j <= d % 4; j++) {
        const id = `nav-${d}-${j}`;
        const t0 = Date.parse(`2026-10-${day}T10:${String(j * 10).padStart(2, "0")}:00Z`);
        rows.push([0, t0, id, "Example Spot", "place", 51.5, 0.1, 51.49, 0.09, 1000, null, null, null, "start"]);
        if (j !== 0 || d % 3 !== 2) {
          rows.push([0, t0 + (3 + d * 3) * 60000, id, "Example Spot", "place", 51.5, 0.1, 51.5, 0.1, 1000, 1000 + d * 40, 0, null, "arrive"]);
          rows.push([0, t0 + (4 + d * 3) * 60000, id, "Example Spot", "place", 51.5, 0.1, 51.5, 0.1, 1000, 1000 + d * 40, 0, "arrived", "end"]);
        }
      }
    }
    const packed = {
      format: 2,
      locations: { v: 2, type: "location", uids: [], targets: [], rows: [] },
      clicks: { v: 2, type: "click", uids: [], rows: [] },
      navigation: { v: 2, type: "navigation", uids: ["walker-aaaa-1111"], rows },
      meta: { ...TRACKS.meta },
    };
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packed) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");
    await page.getByRole("button", { name: "Navigation", exact: true }).click();
    const view = page.locator("#adminNavigation");
    await expect(view).toBeVisible();
    return view;
  }

  test("every bar and completion point in the Navigation trend chart carries its day and values as text", async ({ page }) => {
    const view = await openNavigationWithNineDays(page);
    const chart = view.locator("svg[role='img']").first();
    const titles = async (sel) => chart.locator(sel).evaluateAll((els) => els.map((e) => (e.querySelector("title") || {}).textContent || ""));
    const started = await titles("rect.nav-bar-started");
    const completed = await titles("rect.nav-bar-completed");
    const points = await titles("circle.nav-dot");
    expect(started).toHaveLength(9);
    expect(completed).toHaveLength(9);
    expect(points.length).toBeGreaterThan(0);
    for (const t of [...started, ...completed, ...points]) expect(t).toMatch(/^2026-10-\d\d: \d+ started, \d+ completed(, \d+%)?/);
    expect(started[0]).toMatch(/^2026-10-1\d: 1 started, 1 completed, 100%$/);
    // The table keeps the same figures as text for touch devices.
    await expect(view.locator("table.nav-trend-table").first().locator("tbody tr")).toHaveCount(9);
  });

  // Fictional fixture with times relative to the run, so it stays inside (or outside) the 7-day window.
  async function openNavigationAt(page, startsMsAgo) {
    await skipOnboarding(page);
    const rows = [];
    startsMsAgo.forEach((ago, i) => {
      const t0 = Date.now() - ago;
      const id = "nav-top";
      rows.push([0, t0, id, "Example Spot", "place", 51.5, 0.1, 51.49, 0.09, 1000, null, null, null, "start"]);
      if (i !== 1) {
        rows.push([0, t0 + 6 * 60000, id, "Example Spot", "place", 51.5, 0.1, 51.5, 0.1, 1000, 1100, 0, null, "arrive"]);
        rows.push([0, t0 + 7 * 60000, id, "Example Spot", "place", 51.5, 0.1, 51.5, 0.1, 1000, 1100, 0, "arrived", "end"]);
      }
    });
    const packed = {
      format: 2,
      locations: { v: 2, type: "location", uids: [], targets: [], rows: [] },
      clicks: { v: 2, type: "click", uids: [], rows: [] },
      navigation: { v: 2, type: "navigation", uids: ["walker-aaaa-1111"], rows },
      meta: { ...TRACKS.meta },
    };
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packed) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");
    await page.getByRole("button", { name: "Navigation", exact: true }).click();
    const view = page.locator("#adminNavigation");
    await expect(view).toBeVisible();
    return view;
  }

  test("the Navigation view lists the top destinations of the last 7 days with their started count", async ({ page }) => {
    const HOUR = 3600000;
    // Three journeys to one place inside the week (one abandoned), one 9 days ago that must not count.
    const view = await openNavigationAt(page, [2 * HOUR, 5 * HOUR, 30 * HOUR, 9 * 24 * HOUR]);
    const panel = view.locator(".nav-destinations");
    await expect(panel.getByRole("heading", { name: "Top destinations this week" })).toBeVisible();
    const row = panel.locator("tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row.first()).toContainText("Example Spot");
    await expect(row.first().locator("td").nth(0)).toHaveText("3");
    await expect(row.first().locator("td").nth(1)).toHaveText("2");
    await expect(row.first().locator("td").nth(2)).toHaveText("67%");
    await expect(row.first().locator("td").nth(3)).toHaveText("6 min");
    await expect(panel.locator(".nav-dest-bar").first()).toHaveAttribute("aria-hidden", "true");
  });

  test("the Navigation view says so when no journey started in the last 7 days", async ({ page }) => {
    const view = await openNavigationAt(page, [8 * 24 * 3600000, 10 * 24 * 3600000]);
    await expect(view.locator(".nav-destinations")).toContainText("No navigation journeys in the last 7 days.");
    await expect(view.locator(".nav-destinations tbody tr")).toHaveCount(0);
  });

  test("the stats bar is a readable panel over the map", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await skipOnboarding(page);
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TRACKS) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");
    await expect(page.locator("#adminStats")).toContainText("location pings");
    const m = await page.evaluate(() => {
      const el = document.getElementById("adminStats");
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        bg: cs.backgroundColor, color: cs.color, size: parseFloat(cs.fontSize),
        strongColor: getComputedStyle(el.querySelector("strong")).color,
        strongWeight: parseInt(getComputedStyle(el.querySelector("strong")).fontWeight, 10),
        weight: parseInt(cs.fontWeight, 10),
        inView: rect.right <= window.innerWidth && rect.bottom <= window.innerHeight && rect.left >= 0,
      };
    });
    const rgba = (c) => { const n = c.match(/[\d.]+/g).map(Number); return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bg = rgba(m.bg);
    expect(bg.a).toBeGreaterThan(0);
    // Worst case: the panel sits over a white map. Composite the background over white first.
    const flat = { r: bg.r * bg.a + 255 * (1 - bg.a), g: bg.g * bg.a + 255 * (1 - bg.a), b: bg.b * bg.a + 255 * (1 - bg.a) };
    const contrast = (fg) => { const f = rgba(fg); const [hi, lo] = [lum(f), lum(flat)].sort((a, b) => b - a); return (hi + 0.05) / (lo + 0.05); };
    expect(m.size).toBeGreaterThanOrEqual(14);
    expect(contrast(m.color)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(m.strongColor)).toBeGreaterThanOrEqual(4.5);
    expect(m.strongWeight).toBeGreaterThan(m.weight);
    expect(m.inView).toBe(true);
  });

  test("Navigation summary labels stay on one line on desktop and the charts fill the page in two columns", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const view = await openNavigationWithNineDays(page);
    const labels = view.locator(".nav-card-label");
    const n = await labels.count();
    expect(n).toBeGreaterThanOrEqual(6);
    const oneLine = await labels.evaluateAll((els) => els.map((e) => {
      const lh = parseFloat(getComputedStyle(e).lineHeight);
      return e.getBoundingClientRect().height <= lh * 1.2;
    }));
    expect(oneLine.every(Boolean)).toBe(true);
    const cardHeights = await view.locator(".nav-card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(cardHeights).size).toBe(1);
    const boxes = await view.locator("svg[role='img']").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width })));
    const content = await view.evaluate((v) => v.clientWidth);
    expect(boxes[0].w).toBeGreaterThan(content * 0.8);
    expect(boxes[2].y).toBeCloseTo(boxes[1].y, 0);
    expect(boxes[2].x).toBeGreaterThan(boxes[1].x + boxes[1].w * 0.9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("the Community panel says which snapshot its figures come from", async ({ page }) => {
    await skipOnboarding(page);
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TRACKS) }));
    const generatedAt = Date.parse("2026-10-27T09:35:00Z");
    await page.route(/\/api\/community\/overlay\?admin=1/, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ generatedAt, reports: 42, devices: 9, activeDevices1d: 3, activeDevices7d: 7, byStatus: {}, perDay: {}, questioned: 0, verified: 0, newTreesUnconfirmed: 0, newTreesConfirmed: 0, conflicts: 0, totalPoints: 0 }),
    }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");
    await page.getByRole("button", { name: "Community" }).click();
    const panel = page.locator("#adminCommunity");
    await expect(panel).toContainText("As of the last snapshot");
    const shown = await page.evaluate((ms) => new Date(ms).toLocaleString(), generatedAt);
    await expect(panel).toContainText(shown);
    await expect(panel).toContainText("42");
  });

  test("the password field is labelled, and a user row can be opened from the keyboard", async ({ page }) => {
    await skipOnboarding(page);
    const tracks = {
      ...TRACKS,
      locations: [
        { uid: "user-aaaa-1111", ts: "2026-10-20T10:00:00Z", lat: 51.65, lon: 0.04 },
        { uid: "user-bbbb-2222", ts: "2026-10-21T10:00:00Z", lat: 51.66, lon: 0.05 },
      ],
    };
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tracks) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");

    const rows = page.getByRole("button", { name: /pts/ });
    await expect(rows).toHaveCount(2);
    const first = rows.first();
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /pts/ }).first()).toHaveAttribute("aria-pressed", "true");
  });
});
