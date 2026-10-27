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
      meta: { ...TRACKS.meta, partial: true, oldestDay: "2026-10-20" },
    };
    await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packed) }));
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("secret");
    await page.click("#loginBtn");

    await expect(page.getByRole("button", { name: /pts/ })).toHaveCount(2);
    await expect(page.locator("#adminStats")).toContainText("2 location pings");
    await expect(page.locator("#adminStats")).toContainText("back to 2026-10-20");
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
