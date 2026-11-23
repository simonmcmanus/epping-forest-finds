const { test, expect } = require("@playwright/test");
const { skipOnboarding } = require("./helpers");

// Admin dashboard pages: Stats, Community and Beta are page-level views like Navigation, the sign-in card never
// flashes at a signed-in visitor, and the top bar and login card lost their old controls. Desktop and phone.

const META = { storeName: "tracking-test", context: "test", windowDays: 30 };
// Noon UTC keeps the local calendar day stable in any real timezone.
const loc = (uid, ts) => ({ type: "location", uid, ts, lat: 51.65, lng: 0.04, heading: 0, navTarget: null });
const tap = (uid, ts) => ({ type: "click", uid, ts, userLat: 51.65, userLng: 0.04, targetLat: 51.66, targetLng: 0.05, itemType: "tree", itemId: "T1", itemName: "Oak", source: "map" });
const TRACKS = {
  locations: [
    loc("aaaaaaaa-1", "2026-10-20T12:00:00Z"), loc("aaaaaaaa-1", "2026-10-20T12:01:00Z"),
    loc("aaaaaaaa-1", "2026-10-22T12:00:00Z"), loc("bbbbbbbb-2", "2026-10-22T12:01:00Z"),
  ],
  clicks: [tap("aaaaaaaa-1", "2026-10-21T12:00:00Z")],
  meta: META,
};
const CODES = [
  { code: "a234e", note: "Simon", createdAt: "2026-11-01T10:00:00.000Z", status: "claimed", claimedAt: "2026-11-02T09:00:00.000Z" },
  { code: "e111e", note: "Priya", createdAt: "2026-11-01T11:00:00.000Z", status: "claimed", claimedAt: "2026-11-03T09:00:00.000Z" },
  { code: "b345f", note: "Ann", createdAt: "2026-10-30T10:00:00.000Z", status: "open" },
  { code: "c456g", note: "Old", createdAt: "2026-10-29T10:00:00.000Z", status: "revoked", claimedAt: "2026-10-30T09:00:00.000Z", revokedAt: "2026-11-04T09:00:00.000Z" },
];
const COMMUNITY = { generatedAt: Date.parse("2026-11-20T10:00:00Z"), devices: 12, activeDevices1d: 3, activeDevices7d: 7, reports: 40, questioned: 9, verified: 5, newTreesUnconfirmed: 2, newTreesConfirmed: 1, conflicts: 0, totalPoints: 120, byStatus: { verified: 5, questioned: 9 }, perDay: { "2026-11-19": 4, "2026-11-20": 6 } };

const json = (route, status, data) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

async function mockAdmin(page, { tracks = TRACKS, signedIn = true } = {}) {
  await skipOnboarding(page);
  await page.route(/\/api\/admin\/me/, (route) => (signedIn ? json(route, 200, { signedIn: true, name: "Test Admin" }) : json(route, 401, { error: "Unauthorized" })));
  await page.route(/\/api\/admin\/tracks/, (route) => json(route, 200, tracks));
  await page.route(/\/api\/beta\/codes/, (route) => json(route, 200, { codes: CODES }));
  await page.route(/\/api\/community\/overlay/, (route) => json(route, 200, COMMUNITY));
}

async function openAdmin(page, hash = "", opts) {
  await mockAdmin(page, opts);
  await page.goto(`/admin${hash}`);
  await expect(page.locator("#adminApp")).toBeVisible();
}

test.describe("Admin sign-in card", () => {
  test("the sign-in link is not shown while the sign-in check is still running, then appears on a 401", async ({ page }) => {
    await skipOnboarding(page);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let asked;
    const meAsked = new Promise((resolve) => { asked = resolve; });
    await page.route(/\/api\/admin\/me/, async (route) => { asked(); await held; return json(route, 401, { error: "Unauthorized" }); });
    await page.goto("/admin");
    await meAsked;
    await expect(page.getByRole("link", { name: /sign in/i })).toBeHidden();
    await expect(page.locator("#adminApp")).toBeHidden();
    await expect(page.getByText("Checking your sign-in")).toBeVisible();
    release();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Checking your sign-in")).toBeHidden();
  });

  test("a signed-in visitor never sees the sign-in link while the check and the first data load run", async ({ page }) => {
    await skipOnboarding(page);
    await page.addInitScript(() => {
      window.__loginSeen = false;
      const look = () => {
        const link = document.getElementById("loginBtn");
        if (link && link.getClientRects().length > 0) window.__loginSeen = true;
        if (!window.__stopLooking) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.route(/\/api\/admin\/me/, async (route) => { await new Promise((r) => setTimeout(r, 400)); return json(route, 200, { signedIn: true, name: "Test Admin" }); });
    await page.route(/\/api\/admin\/tracks/, async (route) => { await new Promise((r) => setTimeout(r, 400)); return json(route, 200, TRACKS); });
    await page.goto("/admin");
    await expect(page.locator("#adminApp")).toBeVisible();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(() => { window.__stopLooking = true; return window.__loginSeen; })).toBe(false);
  });

  test("the sign-in link reads just Sign in", async ({ page }) => {
    await mockAdmin(page, { signedIn: false });
    await page.goto("/admin");
    const link = page.locator("#loginBtn");
    await expect(link).toBeVisible();
    await expect(link).toHaveText("Sign in");
    await expect(link).toHaveAttribute("href", "/api/auth/login?admin=1");
  });

  test("a server error while checking the sign-in explains itself and keeps the Sign in link, with no Try again button", async ({ page }) => {
    await skipOnboarding(page);
    await page.route(/\/api\/admin\/me/, (route) => json(route, 500, { error: "boom" }));
    await page.goto("/admin");
    await expect(page.locator("#loginError")).toHaveText("Couldn't check your sign-in. Reload the page, then sign in.");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  });
});

test.describe("Admin top bar", () => {
  test("the environment badge is hidden for a local server and shown for production and previews", async ({ page }) => {
    await openAdmin(page, "", { tracks: { ...TRACKS, meta: { storeName: "", context: "local", windowDays: 30 } } });
    await expect(page.locator("#adminEnvBadge")).toBeHidden();
    await page.unroute(/\/api\/admin\/tracks/);
    await page.route(/\/api\/admin\/tracks/, (route) => json(route, 200, { ...TRACKS, meta: { storeName: "tracking", context: "production", windowDays: 30 } }));
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator("#adminEnvBadge")).toHaveText("production");
    await page.unroute(/\/api\/admin\/tracks/);
    await page.route(/\/api\/admin\/tracks/, (route) => json(route, 200, { ...TRACKS, meta: { storeName: "tracking-my-branch", context: "deploy-preview", windowDays: 30 } }));
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator("#adminEnvBadge")).toHaveText("preview: my-branch");
  });

  test("there is no early-access button, and Stats, Community and Beta sit beside the view tabs with aria-pressed", async ({ page }) => {
    await openAdmin(page);
    await expect(page.getByRole("button", { name: "Access" })).toHaveCount(0);
    for (const name of ["Tracks", "Heatmap", "Navigation", "Stats", "Community", "Beta"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Tracks", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Beta", exact: true }).click();
    await expect(page.getByRole("button", { name: "Beta", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Tracks", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  test("on a phone all six buttons fit on one row at 390px without scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openAdmin(page);
    const row = await page.locator(".admin-nav").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(row.scroll).toBeLessThanOrEqual(row.client);
    for (const name of ["Tracks", "Heatmap", "Navigation", "Stats", "Community", "Beta"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("Admin Stats page", () => {
  test("the map no longer carries a stats bar", async ({ page }) => {
    await openAdmin(page);
    await expect(page.locator("#adminCanvas")).toBeVisible();
    await expect(page.getByText("location pings")).toHaveCount(0);
  });

  test("Stats is its own page with the summary cards, the hash, and focus on its heading", async ({ page }) => {
    await openAdmin(page);
    await page.getByRole("button", { name: "Stats", exact: true }).click();
    await expect(page).toHaveURL(/#stats$/);
    await expect(page.locator("#adminCanvas")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Stats", level: 2 })).toBeFocused();
    const cards = page.locator("#adminStatsPage .nav-card");
    await expect(cards.filter({ hasText: "Users" }).locator(".nav-card-value")).toHaveText("2");
    await expect(cards.filter({ hasText: "Location pings" }).locator(".nav-card-value")).toHaveText("4");
    await expect(cards.filter({ hasText: "Taps" }).locator(".nav-card-value")).toHaveText("1");
    await expect(cards.filter({ hasText: "Time window" })).toContainText("30 days");
    await expect(page.getByRole("button", { name: "Stats", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("the daily trend charts show users, pings and taps per day with a text alternative", async ({ page }) => {
    await openAdmin(page, "#stats");
    const page_ = page.locator("#adminStatsPage");
    const users = page_.getByRole("img", { name: /Users active per day/ });
    await expect(users).toHaveAttribute("aria-label", /3 days from 2026-10-20 to 2026-10-22/);
    await expect(page_.getByRole("img", { name: /Location pings per day/ })).toHaveAttribute("aria-label", /4 location pings/);
    await expect(page_.getByRole("img", { name: /Taps per day/ })).toHaveAttribute("aria-label", /1 tap/);
    // Marks carry their day and value as hover text; a quiet day in the middle is drawn as zero.
    await expect(page_.locator("svg title", { hasText: "2026-10-22: 2 users" })).toHaveCount(1);
    await expect(page_.locator("svg title", { hasText: "2026-10-21: 0 location pings" })).toHaveCount(1);
    const pings = page_.getByRole("region", { name: /Daily location pings/ });
    await expect(pings.locator("tbody tr")).toHaveCount(3);
    await expect(pings.locator("tbody tr").nth(0)).toContainText("2026-10-20");
    await expect(pings.locator("tbody tr").nth(0)).toContainText("2");
    await expect(page_.getByRole("region", { name: /Daily taps/ }).locator("tbody tr").nth(1)).toContainText("1");
  });

  test("choosing a user in the list narrows the Stats figures and charts", async ({ page }) => {
    await openAdmin(page, "#stats");
    await page.locator('.admin-user-item[data-uid="bbbbbbbb-2"]').click();
    const cards = page.locator("#adminStatsPage .nav-card");
    await expect(cards.filter({ hasText: "Location pings" }).locator(".nav-card-value")).toHaveText("1");
    await expect(cards.filter({ hasText: "Taps" }).locator(".nav-card-value")).toHaveText("0");
    await expect(page.locator("#adminStatsSub")).toContainText("bbbbbbbb");
  });

  test("the Stats page links to the Navigation page and says when there are no journeys", async ({ page }) => {
    await openAdmin(page, "#stats");
    await expect(page.locator("#adminStatsPage")).toContainText("No navigation journeys in this window");
    await page.locator("#adminStatsPage").getByRole("link", { name: /Navigation page/ }).click();
    await expect(page).toHaveURL(/#navigation$/);
    await expect(page.getByRole("heading", { name: "Navigation", level: 2 })).toBeFocused();
  });

  test("an empty window says so instead of drawing empty charts", async ({ page }) => {
    await openAdmin(page, "#stats", { tracks: { locations: [], clicks: [], meta: META } });
    await expect(page.locator("#adminStatsPage")).toContainText("No tracking activity in this window");
    await expect(page.locator("#adminStatsPage svg")).toHaveCount(0);
  });

  test("Stats charts have no horizontal page scroll on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openAdmin(page, "#stats");
    await expect(page.locator("#adminStatsPage svg").first()).toBeVisible();
    const over = await page.locator("#adminStatsPage").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
  });
});

test.describe("Admin Community and Beta pages", () => {
  test("Community is a page: map hidden, hash set, heading focused, figures in cards, Back returns to the map", async ({ page }) => {
    await openAdmin(page);
    await page.getByRole("button", { name: "Community", exact: true }).click();
    await expect(page).toHaveURL(/#community$/);
    await expect(page.locator("#adminCanvas")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Community", level: 2 })).toBeFocused();
    const page_ = page.locator("#adminCommunity");
    await expect(page_.locator("#adminCommunityBody .nav-card").filter({ hasText: "Reports" }).locator(".nav-card-value")).toHaveText("40");
    await expect(page.getByRole("button", { name: "Community", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.goBack();
    await expect(page.locator("#adminCanvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Community", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Tracks", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("Community and Beta use the full width: the user list is not shown beside them", async ({ page }) => {
    await openAdmin(page);
    await expect(page.locator("#adminUserList")).toBeVisible();
    await page.getByRole("button", { name: "Community", exact: true }).click();
    await expect(page.locator("#adminUserList")).toBeHidden();
    await page.getByRole("button", { name: "Beta", exact: true }).click();
    await expect(page.locator("#adminUserList")).toBeHidden();
    await page.getByRole("button", { name: "Tracks", exact: true }).click();
    await expect(page.locator("#adminUserList")).toBeVisible();
  });

  test("opening /admin#beta or #community signed in lands on that page", async ({ page }) => {
    await openAdmin(page, "#beta");
    await expect(page.getByRole("heading", { name: "Beta", level: 2 })).toBeVisible();
    await expect(page.locator("#adminBeta li").first()).toBeVisible();
    await page.goto("/admin#community");
    await expect(page.locator("#adminCommunityBody .nav-card").first()).toBeVisible();
  });

  test("Beta lists people who claimed a code apart from open and revoked codes, with counts", async ({ page }) => {
    await openAdmin(page, "#beta");
    const users = page.getByRole("region", { name: /Beta users/ });
    await expect(users.getByRole("heading", { name: "Beta users (2)" })).toBeVisible();
    await expect(users.locator("li")).toHaveCount(2);
    await expect(users.locator("li").nth(0)).toContainText("Simon");
    await expect(users.locator("li").nth(0)).toContainText("a234e");
    await expect(users.locator("li").nth(0)).toContainText("claimed 2 Nov 2026");
    await expect(users.locator("li").nth(1)).toContainText("Priya");
    const open = page.getByRole("region", { name: /Open codes/ });
    await expect(open.getByRole("heading", { name: "Open codes (1)" })).toBeVisible();
    await expect(open.locator("li")).toHaveCount(1);
    await expect(open.locator("li")).toContainText("Ann");
    await expect(open.locator("li")).not.toContainText("Simon");
    const revoked = page.getByRole("region", { name: /Revoked/ });
    await expect(revoked.getByRole("heading", { name: "Revoked (1)" })).toBeVisible();
    await expect(revoked.locator("li")).toContainText("revoked 4 Nov 2026");
  });

  test("an empty beta list says there are no beta users yet", async ({ page }) => {
    await mockAdmin(page);
    await page.unroute(/\/api\/beta\/codes/);
    await page.route(/\/api\/beta\/codes/, (route) => json(route, 200, { codes: [] }));
    await page.goto("/admin#beta");
    await expect(page.getByRole("heading", { name: "Beta users (0)" })).toBeVisible();
    await expect(page.locator("#adminBeta")).toContainText("No one has claimed a code yet.");
  });

  test("revoking a beta user moves them to Revoked and keeps focus on their code", async ({ page }) => {
    await mockAdmin(page);
    await page.unroute(/\/api\/beta\/codes/);
    await page.route(/\/api\/beta\/codes/, (route) => (route.request().method() === "GET" ? json(route, 200, { codes: CODES }) : json(route, 200, { ok: true })));
    await page.goto("/admin#beta");
    await page.getByRole("button", { name: "Revoke code a234e" }).click();
    await page.getByRole("button", { name: "Confirm revoke code a234e" }).click();
    await expect(page.getByRole("heading", { name: "Beta users (1)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Revoked (2)" })).toBeVisible();
    await expect(page.getByRole("region", { name: /Revoked/ }).locator("li").first()).toContainText("a234e");
    await expect(page.locator("#adminBeta .admin-beta-code", { hasText: "a234e" })).toBeFocused();
  });

  test("logging out from a page resets to the map with no hash at the next sign-in", async ({ page }) => {
    await openAdmin(page, "#beta");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.locator("#loginScreen")).toBeVisible();
    await expect(page).not.toHaveURL(/#/);
  });
});
