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
    await expect(card("Median arrival")).toContainText("12 min");
    await expect(card("Distance walked")).toContainText("1.25 km");
    await expect(card("Median detour")).toContainText("1.25x");
    await expect(card("Detour sample")).toContainText("1");

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
    await expect(panel.getByRole("heading", { name: "Top destinations, last 7 days" })).toBeVisible();
    const row = panel.locator("tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row.first()).toContainText("Example Spot");
    await expect(row.first().locator("td").nth(0)).toHaveText("3");
    await expect(row.first().locator("td").nth(1)).toHaveText("2");
    await expect(row.first().locator("td").nth(2)).toHaveText("67%");
    await expect(row.first().locator("td").nth(3)).toHaveText("6 min");
    await expect(panel.locator(".nav-dest-bar").first()).toHaveAttribute("aria-hidden", "true");
  });

  test("Navigation cards use unambiguous visible labels with the full meaning for screen readers", async ({ page }) => {
    const view = await openNavigationWithNineDays(page);
    const detour = view.locator(".nav-card", { hasText: "Detour sample" });
    await expect(detour.locator(".nav-card-label")).toHaveText("Detour sample");
    await expect(detour.locator(".sr-only")).toContainText("journeys with a detour ratio");
    await expect(detour).toHaveAttribute("title", /journeys with a detour ratio/i);
    const arrival = view.locator(".nav-card", { hasText: "Median arrival" });
    await expect(arrival.locator(".nav-card-label")).toHaveText("Median arrival");
    await expect(arrival.locator(".sr-only")).toContainText("median time to arrive");
    await expect(view.locator(".nav-card", { hasText: "With detour" })).toHaveCount(0);
  });

  test("Navigation view explains the detour number, the counting basis and the destinations window in visible text", async ({ page }) => {
    const view = await openNavigationWithNineDays(page);
    const detourPanel = view.locator(".nav-panel", { has: page.getByRole("heading", { name: "Median detour by day" }) });
    await expect(detourPanel.locator(".nav-note").first()).toContainText(/1\.\d\dx means the walk was \d+% longer than the shortest route\./);
    await expect(view.locator(".nav-cards ~ .nav-note").first()).toContainText("Started and completed count journeys, not people. Distance includes abandoned walks.");
    await expect(view.locator(".nav-cards ~ .nav-note").first()).toBeVisible();
    await expect(view.locator(".nav-destinations .nav-note")).toHaveText("Counted back from now, within the loaded data and selected user.");
  });

  test("Navigation detour sentence quotes the current median", async ({ page }) => {
    const view = await openNavigationAt(page, [3600000]);
    await expect(view.locator(".nav-panel", { has: page.getByRole("heading", { name: "Median detour by day" }) }).locator(".nav-note")).toContainText("1.10x means the walk was 10% longer");
  });

  test("Navigation chart marks and scrollable tables meet non-text contrast and keyboard access", async ({ page }) => {
    const view = await openNavigationWithNineDays(page);
    const colours = await view.evaluate((v) => {
      const get = (sel, prop) => getComputedStyle(v.querySelector(sel))[prop];
      return {
        rate: get("path.nav-line:not(.nav-line-detour)", "stroke"),
        dot: get("circle.nav-dot:not(.nav-dot-detour)", "fill"),
        started: get("rect.nav-bar-started", "fill"),
        completed: get("rect.nav-bar-completed", "fill"),
        lt5: get(".nav-swatch.nav-bar-lt5", "backgroundColor"),
        b5to15: get(".nav-swatch.nav-bar-b5to15", "backgroundColor"),
        b15to30: get(".nav-swatch.nav-bar-b15to30", "backgroundColor"),
        gt30: get(".nav-swatch.nav-bar-gt30", "backgroundColor"),
      };
    });
    const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    for (const [name, c] of Object.entries(colours)) expect(1.05 / (lum(c) + 0.05), `${name} ${c} on white`).toBeGreaterThanOrEqual(3);
    expect(new Set([colours.rate, colours.started, colours.completed]).size).toBe(3);
    expect(new Set([colours.lt5, colours.b5to15, colours.b15to30, colours.gt30]).size).toBe(4);

    const wraps = view.locator(".nav-table-wrap");
    expect(await wraps.count()).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < await wraps.count(); i++) {
      await expect(wraps.nth(i)).toHaveAttribute("tabindex", "0");
      await expect(wraps.nth(i)).toHaveAttribute("role", "region");
      await expect(wraps.nth(i)).toHaveAttribute("aria-label", /scrollable/);
    }
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

  test("Navigation summary labels are not clipped at the narrowest two-column width", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    const view = await openNavigationWithNineDays(page);
    const clipped = await view.locator(".nav-card-label").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));
    expect(clipped).toEqual([]);
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

  // ---- Phone layout and panel coordination ----

  const PHONE_TRACKS = {
    ...TRACKS,
    locations: [
      { uid: "user-aaaa-1111", ts: "2026-10-20T10:00:00Z", lat: 51.65, lon: 0.04 },
      { uid: "user-bbbb-2222", ts: "2026-10-21T10:00:00Z", lat: 51.66, lon: 0.05 },
    ],
  };

  async function signInOnPhone(page) {
    await page.setViewportSize({ width: 390, height: 844 });
    await skipOnboarding(page);
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PHONE_TRACKS) }));
    await page.route(/\/api\/community\/overlay\?admin=1/, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ generatedAt: Date.parse("2026-10-27T09:35:00Z"), reports: 4, devices: 2, activeDevices1d: 1, activeDevices7d: 2, byStatus: { verified: 3 }, perDay: { "2026-10-26": 4 }, questioned: 1, verified: 3, newTreesUnconfirmed: 0, newTreesConfirmed: 0, conflicts: 0, totalPoints: 9 }),
    }));
    await page.route(/\/api\/features\?admin=1/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ community: [{ id: "a1b2c3d4e5", note: "Sam" }] }) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");
    await expect(page.locator("#adminApp")).toBeVisible();
  }

  test("on a phone the map and the Navigation view get the full width and the top bar stays compact", async ({ page }) => {
    await signInOnPhone(page);
    const m = await page.evaluate(() => ({
      map: document.querySelector(".admin-map-area").getBoundingClientRect().width,
      top: document.querySelector(".admin-topbar").getBoundingClientRect().height,
      scrollW: document.documentElement.scrollWidth,
    }));
    expect(m.map).toBeGreaterThanOrEqual(390 * 0.9);
    expect(m.top).toBeLessThanOrEqual(112);
    expect(m.scrollW).toBeLessThanOrEqual(390);
    await page.click("#navigationBtn");
    const nav = await page.locator("#adminNavigation").boundingBox();
    expect(nav.width).toBeGreaterThanOrEqual(390 * 0.9);
  });

  test("on a phone the top bar buttons and map controls are at least 44px to tap", async ({ page }) => {
    await signInOnPhone(page);
    const small = await page.evaluate(() => [...document.querySelectorAll(".admin-topbar button, .admin-map-control")]
      .map((el) => ({ id: el.id, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.height < 43.95 || r.width < 43.95))
      .map(({ id, r }) => `${id} ${Math.round(r.width)}x${Math.round(r.height)}`));
    expect(small).toEqual([]);
  });

  test("opening the Access panel closes the Community panel so only one overlay shows", async ({ page }) => {
    await signInOnPhone(page);
    await page.getByRole("button", { name: "Community" }).click();
    await expect(page.locator("#adminCommunity")).toBeVisible();
    await page.getByRole("button", { name: "Access" }).click();
    await expect(page.locator("#adminAccess")).toBeVisible();
    await expect(page.locator("#adminCommunity")).toBeHidden();
    await page.getByRole("button", { name: "Community" }).click();
    await expect(page.locator("#adminCommunity")).toBeVisible();
    await expect(page.locator("#adminAccess")).toBeHidden();
  });

  test("user rows can be picked from the keyboard with Enter and Space", async ({ page }) => {
    await signInOnPhone(page);
    const rows = page.locator(".admin-user-item");
    await expect(rows).toHaveCount(3);
    const user = rows.nth(1);
    await user.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".admin-user-item").nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.locator(".admin-user-item").nth(0).focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".admin-user-item").nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".admin-user-item").nth(1)).toHaveAttribute("aria-pressed", "false");
  });

  async function boxesOf(page, selector) {
    return page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => { const r = el.getBoundingClientRect(); return { id: el.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width }; }), selector);
  }
  const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  test("on a phone all five view and panel buttons are fully on screen without scrolling", async ({ page }) => {
    await signInOnPhone(page);
    const boxes = await boxesOf(page, "#tracksBtn, #heatmapBtn, #navigationBtn, #communityBtn, #accessBtn");
    expect(boxes).toHaveLength(5);
    for (const b of boxes) {
      expect(b.left, `${b.id} left`).toBeGreaterThanOrEqual(0);
      expect(b.right, `${b.id} right`).toBeLessThanOrEqual(390);
    }
    // The title is read out but not drawn truncated.
    await expect(page.locator(".admin-topbar-title")).toHaveText("Epping Forest Finds — User Analytics");
    expect((await boxesOf(page, ".admin-topbar-title"))[0].w).toBeLessThanOrEqual(1);
  });

  for (const [name, size] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    test(`the open ${name} overlay sheet leaves the legend and stats strip uncovered`, async ({ page }) => {
      await signInOnPhone(page);
      await page.setViewportSize(size);
      for (const name of ["Community", "Access"]) {
        await page.getByRole("button", { name, exact: true }).click();
        const sheet = page.locator(name === "Community" ? "#adminCommunity" : "#adminAccess");
        await expect(sheet).toBeVisible();
        if (name === "Community") await expect(page.locator("#adminCommunityBody")).not.toContainText("Loading");
        const stats = (await boxesOf(page, "#adminStats"))[0];
        expect(stats.right - stats.left, "stats strip has width").toBeGreaterThan(0);
        expect(stats.bottom - stats.top, "stats strip has height").toBeGreaterThan(0);
        const [s] = await boxesOf(page, name === "Community" ? "#adminCommunity" : "#adminAccess");
        for (const sel of [".admin-legend", "#adminStats", ".admin-map-controls"]) {
          const [other] = await boxesOf(page, sel);
          expect(intersects(s, other), `${name} sheet covers ${sel}`).toBe(false);
        }
      }
    });
  }

  test("the active view tab is exposed with aria-pressed", async ({ page }) => {
    await signInOnPhone(page);
    const state = () => page.evaluate(() => ["tracksBtn", "heatmapBtn", "navigationBtn"].map((id) => document.getElementById(id).getAttribute("aria-pressed")));
    expect(await state()).toEqual(["true", "false", "false"]);
    await page.click("#heatmapBtn");
    expect(await state()).toEqual(["false", "true", "false"]);
    await page.click("#navigationBtn");
    expect(await state()).toEqual(["false", "false", "true"]);
    await page.click("#tracksBtn");
    expect(await state()).toEqual(["true", "false", "false"]);
  });

  test("overlay panels take focus, close on Escape and give focus back to their button", async ({ page }) => {
    await signInOnPhone(page);
    for (const [btn, panel] of [["#communityBtn", "#adminCommunity"], ["#accessBtn", "#adminAccess"]]) {
      await page.click(btn);
      await expect(page.locator(panel)).toBeVisible();
      expect(await page.evaluate((sel) => document.querySelector(sel).contains(document.activeElement), panel)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(page.locator(panel)).toBeHidden();
      await expect(page.locator(btn)).toBeFocused();
    }
    await page.click("#communityBtn");
    await page.click("#adminCommunityClose");
    await expect(page.locator("#communityBtn")).toBeFocused();
  });

  test("overlay panels are labelled regions and are not live regions themselves", async ({ page }) => {
    await signInOnPhone(page);
    for (const id of ["adminCommunity", "adminAccess", "adminClickDetails"]) {
      const el = page.locator(`#${id}`);
      await expect(el).toHaveAttribute("role", "region");
      await expect(el).not.toHaveAttribute("aria-live", /.+/);
    }
    await page.click("#accessBtn");
    await expect(page.getByRole("region", { name: "Early access: Community" })).toBeVisible();
    await expect(page.locator("#adminAccessStatus")).toHaveAttribute("role", "status");
  });

  test("a user row keeps keyboard focus after it is activated and the list redraws", async ({ page }) => {
    await signInOnPhone(page);
    const row = page.locator(".admin-user-item").nth(1);
    const uid = await row.getAttribute("data-uid");
    await row.focus();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement.dataset.uid)).toBe(uid);
    await page.locator(".admin-user-item").first().focus();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement.classList.contains("admin-user-item") && document.activeElement.dataset.uid)).toBe("");
  });

  test("Refresh keeps an open Access panel and the text typed into it", async ({ page }) => {
    await signInOnPhone(page);
    await page.click("#accessBtn");
    await expect(page.locator("#adminAccessList")).toHaveValue("a1b2c3d4e5 Sam");
    await page.fill("#adminAccessList", "a1b2c3d4e5 Sam\nnot saved yet");
    await page.click("#refreshBtn");
    await expect(page.locator("#refreshBtn")).toBeEnabled();
    await expect(page.locator("#adminAccess")).toBeVisible();
    await expect(page.locator("#adminAccessList")).toHaveValue("a1b2c3d4e5 Sam\nnot saved yet");
  });

  test("the focus ring on the sign-in card is dark enough for a light surface", async ({ page }) => {
    await page.goto("/admin");
    await page.locator("#loginBtn").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator("#loginBtn")).toBeFocused();
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineColor);
    const [r, g, b] = ring.match(/[\d.]+/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    expect(1.05 / (lum + 0.05)).toBeGreaterThanOrEqual(3);
  });

  test("the selected phone user chip keeps its detail text readable", async ({ page }) => {
    await signInOnPhone(page);
    await page.locator(".admin-user-item").nth(1).click();
    // The chip background is translucent, so measure against what actually shows through: every ancestor background blended in turn.
    const colours = await page.evaluate(() => {
      const chip = document.querySelector(".admin-user-item.selected");
      const meta = chip.querySelector(".admin-user-meta");
      const layers = [];
      for (let el = chip; el; el = el.parentElement) layers.push(getComputedStyle(el).backgroundColor);
      return { text: getComputedStyle(meta).color, layers: layers.reverse() };
    });
    const parse = (c) => { const [r, g, b, a = 1] = c.match(/[\d.]+/g).map(Number); return { r, g, b, a }; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const bg = colours.layers.map(parse).reduce((under, top) => over(top, under), { r: 255, g: 255, b: 255, a: 1 });
    const mixed = over(parse(colours.text), bg);
    const [hi, lo] = [lum(mixed), lum(bg)].sort((x, y) => y - x);
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  for (const width of [768, 844, 1024, 1280, 360, 320]) {
    test(`at ${width}px wide no top-bar button overlaps another or runs off screen`, async ({ page }) => {
      await signInOnPhone(page);
      await page.setViewportSize({ width, height: width >= 768 ? 800 : 700 });
      const ids = "#tracksBtn, #heatmapBtn, #navigationBtn, #communityBtn, #accessBtn, #refreshBtn, #logoutBtn";
      const boxes = await boxesOf(page, ids);
      expect(boxes).toHaveLength(7);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(intersects(boxes[i], boxes[j]), `${boxes[i].id} overlaps ${boxes[j].id} at ${width}px`).toBe(false);
        }
      }
      // Phones may scroll the views row sideways; wider screens show every button.
      if (width >= 768) {
        for (const b of boxes) {
          expect(b.left, `${b.id} left at ${width}px`).toBeGreaterThanOrEqual(0);
          expect(b.right, `${b.id} right at ${width}px`).toBeLessThanOrEqual(width);
        }
      }
    });
  }

  async function tapFirstMarker(page) {
    const at = await page.evaluate(() => {
      const canvas = document.getElementById("adminCanvas");
      const { width, height } = canvasCssSize(canvas);
      const click = filteredClicks()[0];
      const ll = clickLatLng(click);
      const p = latLngToCanvas(ll.lat, ll.lng, width, height);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    });
    await page.mouse.click(at.x, at.y);
  }

  test("tapping a map marker opens its details with focus, Escape returns focus to the map, and Community closes it", async ({ page }) => {
    await skipOnboarding(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const withClick = { ...PHONE_TRACKS, clicks: [{ uid: "user-aaaa-1111", ts: "2026-10-20T10:01:00Z", itemType: "pub", itemId: "the-owl", itemName: "The Owl", targetLat: 51.655, targetLng: 0.045 }] };
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(withClick) }));
    await page.route(/\/api\/community\/overlay\?admin=1/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reports: 1, devices: 1 }) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");
    await expect(page.locator("#adminApp")).toBeVisible();

    await tapFirstMarker(page);
    await expect(page.locator("#adminClickDetails")).toBeVisible();
    await expect(page.locator("#adminClickDetailsClose")).toBeFocused();
    await expect(page.locator("#adminClickDetails")).toContainText("The Owl");

    await page.keyboard.press("Escape");
    await expect(page.locator("#adminClickDetails")).toBeHidden();
    await expect(page.locator("#adminCanvas")).toBeFocused();

    await tapFirstMarker(page);
    await expect(page.locator("#adminClickDetails")).toBeVisible();
    await page.click("#communityBtn");
    await expect(page.locator("#adminCommunity")).toBeVisible();
    await expect(page.locator("#adminClickDetails")).toBeHidden();
  });

  test("when a refresh removes the tapped marker the details close and focus returns to the map", async ({ page }) => {
    await skipOnboarding(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const withClick = { ...PHONE_TRACKS, clicks: [{ uid: "user-aaaa-1111", ts: "2026-10-20T10:01:00Z", itemType: "pub", itemId: "the-owl", itemName: "The Owl", targetLat: 51.655, targetLng: 0.045 }] };
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(withClick) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");
    await expect(page.locator("#adminApp")).toBeVisible();
    await tapFirstMarker(page);
    await expect(page.locator("#adminClickDetailsClose")).toBeFocused();
    // Simulate the auto-refresh bringing data in which the tapped target no longer exists.
    await page.evaluate(() => { allData = { ...allData, clicks: [] }; refreshClickDetails(); });
    await expect(page.locator("#adminClickDetails")).toBeHidden();
    await expect(page.locator("#adminCanvas")).toBeFocused();
  });

  test("the Community panel body announces its loading and result text as a status", async ({ page }) => {
    await signInOnPhone(page);
    await expect(page.getByRole("status").filter({ has: page.locator("#adminCommunityBody") })).toHaveCount(0);
    await expect(page.locator("#adminCommunityBody")).toHaveAttribute("role", "status");
    await expect(page.locator("#adminCommunity")).not.toHaveAttribute("aria-live", /.+/);
  });
});
