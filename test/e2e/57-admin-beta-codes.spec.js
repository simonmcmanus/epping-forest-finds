const { test, expect } = require("@playwright/test");
const { skipOnboarding } = require("./helpers");

const TRACKS = { locations: [], clicks: [], meta: { storeName: "tracking-test", context: "test", windowDays: 30 } };
const SESSION_TOKEN = "test-session-token";

const CODES = [
  { code: "a234e", note: "Simon", createdAt: "2026-11-01T10:00:00.000Z", status: "claimed", claimedAt: "2026-11-02T09:00:00.000Z" },
  { code: "b345f", note: "<b>Ann</b>", createdAt: "2026-10-30T10:00:00.000Z", status: "open" },
  { code: "c456g", note: "", createdAt: "2026-10-29T10:00:00.000Z", status: "revoked" },
];

// Desktop only: this file is outside the mobile project's testMatch, and the dashboard is a desk tool.
async function openBeta(page, handler) {
  const calls = [];
  await skipOnboarding(page);
  await page.route(/\/api\/admin\/session/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: SESSION_TOKEN, expiresAt: Date.now() + 8 * 3600000 }) }));
  await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TRACKS) }));
  await page.route(/\/api\/beta\/codes/, (route) => {
    const req = route.request();
    const body = req.method() === "POST" ? JSON.parse(req.postData() || "{}") : null;
    calls.push({ method: req.method(), auth: req.headers()["authorization"], body });
    return handler(route, body);
  });
  await page.goto("/admin");
  await page.getByLabel("Admin password").fill("secret");
  await page.click("#loginBtn");
  await expect(page.locator("#loginScreen")).toBeHidden();
  await expect(page.locator("#adminStats")).toContainText("location pings");
  await page.getByRole("button", { name: "Beta codes" }).click();
  return calls;
}

const json = (route, status, data) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

function okHandler(extra) {
  return (route, body) => {
    if (route.request().method() === "GET") return json(route, 200, { codes: CODES });
    if (extra) { const r = extra(route, body); if (r) return r; }
    return json(route, 200, { ok: true });
  };
}

test.describe("Admin beta codes", () => {
  test("opening Beta codes lists each code with its status", async ({ page }) => {
    const calls = await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Each code is for one person");
    const rows = panel.locator("li");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("a234e");
    await expect(rows.nth(0)).toContainText("Simon");
    await expect(rows.nth(0)).toContainText(/claimed/i);
    await expect(rows.nth(1)).toContainText(/open/i);
    await expect(rows.nth(1)).toContainText("<b>Ann</b>");
    await expect(rows.nth(2)).toContainText(/revoked/i);
    await expect(rows.nth(2).getByRole("button", { name: /^Revoke/ })).toHaveCount(0);
    await expect(rows.nth(2).getByRole("button", { name: /Copy link/ })).toHaveCount(0);
    expect(calls[0].auth).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  test("Create code sends the note and shows the new code and link at the top", async ({ page }) => {
    const calls = await openBeta(page, okHandler((route, body) => {
      if (body.action === "create") return json(route, 200, { code: "z999q", note: body.note, createdAt: "2026-11-22T10:00:00.000Z", status: "open" });
    }));
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByLabel("Who is it for?").fill("For Bob");
    await panel.getByRole("button", { name: "Create code" }).click();
    await expect(panel.locator("li")).toHaveCount(4);
    await expect(panel.locator("li").first()).toContainText("z999q");
    await expect(panel.locator("li").first()).toContainText("For Bob");
    await expect(panel.locator("#adminBetaStatus")).toContainText("/beta/z999q");
    expect(calls.find((c) => c.method === "POST").body).toEqual({ action: "create", note: "For Bob" });
  });

  test("Copy link copies the beta link for that code", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.locator("li").nth(1).getByRole("button", { name: /Copy link/ }).click();
    const expected = await page.evaluate(() => `${location.origin}/beta/b345f`);
    await expect(panel.locator("#adminBetaStatus")).toContainText(/copied|\/beta\/b345f/i);
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (copied !== null) expect(copied).toBe(expected);
    else await expect(panel.locator("#adminBetaStatus")).toContainText(expected);
  });

  test("Copy link shows the link when the clipboard is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
    });
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.locator("li").nth(1).getByRole("button", { name: /Copy link/ }).click();
    await expect(panel.locator("#adminBetaStatus")).toContainText("/beta/b345f");
    await expect(panel.locator("#adminBetaStatus")).toContainText(/copy/i);
  });

  test("Revoke asks to confirm, then marks the row revoked and sends the code", async ({ page }) => {
    const calls = await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    const row = panel.locator("li").nth(0);
    await expect(panel.locator("li")).toHaveCount(3);
    await row.getByRole("button", { name: /^Revoke/ }).click();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await expect(panel.locator("#adminBetaStatus")).toContainText(/sure|confirm/i);
    await row.getByRole("button", { name: /Confirm/ }).click();
    await expect(row).toContainText(/revoked/i);
    await expect(row.getByRole("button", { name: /Revoke|Confirm/ })).toHaveCount(0);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{ action: "revoke", code: "a234e" }]);
  });

  test("a failed revoke keeps the row and shows the error", async ({ page }) => {
    await openBeta(page, okHandler((route, body) => {
      if (body.action === "revoke") return json(route, 503, { error: "Storage unavailable: nothing was saved. Try again." });
    }));
    const panel = page.locator("#adminBeta");
    const row = panel.locator("li").nth(1);
    await expect(panel.locator("li")).toHaveCount(3);
    await row.getByRole("button", { name: /^Revoke/ }).click();
    await row.getByRole("button", { name: /Confirm/ }).click();
    await expect(panel.locator("#adminBetaStatus")).toContainText("Storage unavailable");
    await expect(row).toContainText(/open/i);
    await expect(row).not.toContainText(/revoked/i);
  });

  test("every row button names its code", async ({ page }) => {
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await expect(panel.getByRole("button", { name: "Copy link for a234e" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Copy link for b345f" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Revoke code a234e" })).toBeVisible();
    await panel.getByRole("button", { name: "Revoke code b345f" }).click();
    await expect(panel.getByRole("button", { name: "Confirm revoke code b345f" })).toBeVisible();
  });

  test("a revoked row keeps its claimed history, says revoked and has no Copy link", async ({ page }) => {
    await openBeta(page, (route) => json(route, 200, { codes: [{ code: "d567h", note: "", createdAt: "2026-10-01T10:00:00.000Z", status: "revoked", claimedAt: "2026-10-02T09:00:00.000Z" }] }));
    const row = page.locator("#adminBeta li").first();
    await expect(row).toContainText(/claimed 2 Oct 2026/);
    await expect(row).toContainText(/revoked/);
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  test("after Create, focus is on the new row's Copy link button", async ({ page }) => {
    await openBeta(page, okHandler((route, body) => {
      if (body.action === "create") return json(route, 200, { code: "z999q", note: "", createdAt: "2026-11-22T10:00:00.000Z", status: "open" });
    }));
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByLabel("Who is it for?").fill("Zoe");
    await panel.getByRole("button", { name: "Create code" }).click();
    await expect(panel.locator("li")).toHaveCount(4);
    await expect(panel.getByRole("button", { name: "Copy link for z999q" })).toBeFocused();
  });

  test("after a confirmed revoke, focus stays inside the panel", async ({ page }) => {
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByRole("button", { name: "Revoke code b345f" }).click();
    await panel.getByRole("button", { name: "Confirm revoke code b345f" }).click();
    await expect(panel.locator("li").nth(1)).toContainText(/revoked/);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).not.toBe("BODY");
    expect(await page.evaluate(() => !!document.activeElement.closest("#adminBeta"))).toBe(true);
  });

  test("pressing another row disarms a pending revoke", async ({ page }) => {
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByRole("button", { name: "Revoke code b345f" }).click();
    await panel.getByRole("button", { name: "Copy link for a234e" }).click();
    await expect(panel.getByRole("button", { name: "Revoke code b345f" })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Confirm revoke/ })).toHaveCount(0);
  });

  test("Create code needs a note: it stays disabled until one is typed", async ({ page }) => {
    const calls = await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    const create = panel.getByRole("button", { name: "Create code" });
    await expect(panel.getByLabel("Who is it for?")).toHaveAttribute("aria-required", "true");
    await expect(create).toBeDisabled();
    await panel.getByLabel("Who is it for?").fill("   ");
    await expect(create).toBeDisabled();
    await panel.getByLabel("Who is it for?").fill("Ann, Tuesday walk group");
    await expect(create).toBeEnabled();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  test("a failed create shows wording without an HTTP number", async ({ page }) => {
    await openBeta(page, okHandler((route, body) => {
      if (body.action === "create") return json(route, 500, {});
    }));
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByLabel("Who is it for?").fill("Zoe");
    await panel.getByRole("button", { name: "Create code" }).click();
    await expect(panel.locator("#adminBetaStatus")).toHaveText("Could not create a code. Try again.");
  });

  test("a 401 on load returns to admin sign-in", async ({ page }) => {
    await openBeta(page, (route) => json(route, 401, { error: "Unauthorized" }));
    await expect(page.getByLabel("Admin password")).toBeVisible();
    await expect(page.locator("#adminBeta")).toBeHidden();
  });

  test("a failed load disables Create and offers Retry", async ({ page }) => {
    let fail = true;
    await openBeta(page, (route, body) => {
      if (route.request().method() === "GET") return fail ? json(route, 503, { error: "x" }) : json(route, 200, { codes: CODES });
      return json(route, 200, { ok: true });
    });
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("#adminBetaStatus")).toContainText("Could not load");
    await expect(panel.getByRole("button", { name: "Create code" })).toBeDisabled();
    await expect(panel.locator("li")).toHaveCount(0);
    fail = false;
    await panel.getByRole("button", { name: "Retry" }).click();
    await expect(panel.locator("li")).toHaveCount(3);
    await expect(panel.getByLabel("Who is it for?")).toBeEnabled();
    await panel.getByLabel("Who is it for?").fill("Ann");
    await expect(panel.getByRole("button", { name: "Create code" })).toBeEnabled();
  });

  test("Escape closes the Beta codes panel", async ({ page }) => {
    await openBeta(page, okHandler());
    await expect(page.locator("#adminBeta")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#adminBeta")).toBeHidden();
  });
});
