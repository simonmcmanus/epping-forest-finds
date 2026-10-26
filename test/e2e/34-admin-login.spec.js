const { test, expect } = require("@playwright/test");
const { skipOnboarding } = require("./helpers");

const TRACKS = { locations: [], clicks: [], meta: { storeName: "tracking-test", context: "test", windowDays: 30 } };

test.describe("Admin login", () => {
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
