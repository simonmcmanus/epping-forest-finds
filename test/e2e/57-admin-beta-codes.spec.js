const { test, expect } = require("@playwright/test");
const { skipOnboarding } = require("./helpers");

const TRACKS = { locations: [], clicks: [], meta: { storeName: "tracking-test", context: "test", windowDays: 30 } };

const CODES = [
  { code: "a234e", note: "Simon", createdAt: "2026-11-01T10:00:00.000Z", status: "claimed", claimedAt: "2026-11-02T09:00:00.000Z" },
  { code: "b345f", note: "<b>Ann</b>", createdAt: "2026-10-30T10:00:00.000Z", status: "open" },
  { code: "c456g", note: "", createdAt: "2026-10-29T10:00:00.000Z", status: "revoked" },
];

// Desktop only: this file is outside the mobile project's testMatch, and the dashboard is a desk tool.
async function openBeta(page, handler) {
  const calls = [];
  await skipOnboarding(page);
  await page.route(/\/api\/admin\/me/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: true, name: "Test Admin" }) }));
  await page.route(/\/api\/admin\/tracks/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TRACKS) }));
  await page.route(/\/api\/beta\/codes/, (route) => {
    const req = route.request();
    const body = req.method() === "POST" ? JSON.parse(req.postData() || "{}") : null;
    calls.push({ method: req.method(), csrf: req.headers()["x-requested-with"], auth: req.headers()["authorization"], body });
    return handler(route, body);
  });
  await page.goto("/admin");
  await expect(page.locator("#loginScreen")).toBeHidden();
  await expect(page.locator("#adminUserList")).toContainText("All users");
  await page.getByRole("button", { name: "Beta", exact: true }).click();
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

test.describe("Admin beta page", () => {
  test("opening Beta lists each code with its status", async ({ page }) => {
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
    expect(calls[0].csrf).toBe("admin");
    expect(calls[0].auth).toBeUndefined();
  });

  test("Create code sends the note and shows the new code and link at the top", async ({ page }) => {
    const calls = await openBeta(page, okHandler((route, body) => {
      if (body.action === "create") return json(route, 200, { code: "z999q", note: body.note, createdAt: "2026-11-22T10:00:00.000Z", status: "open" });
    }));
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByLabel("Name").fill("For Bob");
    await panel.getByRole("button", { name: "Create code" }).click();
    await expect(panel.locator("li")).toHaveCount(4);
    await expect(panel.locator("#adminBetaOpen li").first()).toContainText("z999q");
    await expect(panel.locator("#adminBetaOpen li").first()).toContainText("For Bob");
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
    const row = panel.locator("li", { hasText: "a234e" });
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
    await panel.getByLabel("Name").fill("Zoe");
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

  test("the name label says it is required", async ({ page }) => {
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await expect(panel.locator("label[for=adminBetaNote]")).toHaveText("Name (required)");
  });

  test("while a revoke is pending, the focused Revoke button stays in the page and focused", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let seen;
    const requestSeen = new Promise((resolve) => { seen = resolve; });
    await openBeta(page, async (route, body) => {
      if (route.request().method() === "GET") return json(route, 200, { codes: CODES });
      if (body.action === "revoke") { seen(); await held; }
      return json(route, 200, { ok: true });
    });
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByRole("button", { name: "Revoke code b345f" }).click();
    const confirm = panel.getByRole("button", { name: "Confirm revoke code b345f" });
    const handle = await confirm.elementHandle();
    await confirm.click();
    await requestSeen;
    await expect(panel.locator("#adminBetaStatus")).toContainText("Revoking");
    expect(await handle.evaluate((el) => el.isConnected && el === document.activeElement)).toBe(true);
    release();
    await expect(panel.locator("li").nth(1)).toContainText(/revoked/);
    expect(await page.evaluate(() => !!document.activeElement.closest("#adminBeta"))).toBe(true);
  });

  test("while a revoke is pending, the focused Confirm button is dimmed and a second press sends nothing", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let seen;
    const requestSeen = new Promise((resolve) => { seen = resolve; });
    let revokes = 0;
    await openBeta(page, async (route, body) => {
      if (route.request().method() === "GET") return json(route, 200, { codes: CODES });
      if (body.action === "revoke") { revokes++; seen(); await held; }
      return json(route, 200, { ok: true });
    });
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByRole("button", { name: "Revoke code b345f" }).click();
    const confirm = panel.getByRole("button", { name: "Confirm revoke code b345f" });
    await confirm.click();
    await requestSeen;
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await expect(confirm).toHaveCSS("opacity", "0.55");
    await confirm.click({ force: true });
    await page.waitForTimeout(150);
    expect(revokes).toBe(1);
    release();
    await expect(panel.locator("li").nth(1)).toContainText(/revoked/);
    expect(revokes).toBe(1);
  });

  test("while a create is pending, the note field is read-only and keeps what was typed", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let seen;
    const requestSeen = new Promise((resolve) => { seen = resolve; });
    await openBeta(page, async (route, body) => {
      if (route.request().method() === "GET") return json(route, 200, { codes: CODES });
      if (body.action === "create") { seen(); await held; return json(route, 200, { code: "z999z", note: "Pat", createdAt: "2026-11-03T10:00:00.000Z", status: "open" }); }
      return json(route, 200, { ok: true });
    });
    const panel = page.locator("#adminBeta");
    const note = panel.locator("#adminBetaNote");
    await expect(panel.locator("li")).toHaveCount(3);
    await note.fill("Pat");
    await panel.locator("#adminBetaCreate").click();
    await requestSeen;
    await expect(note).toHaveJSProperty("readOnly", true);
    release();
    await expect(panel.locator("li")).toHaveCount(4);
    await expect(note).toHaveJSProperty("readOnly", false);
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
    await expect(panel.getByLabel("Name")).toHaveAttribute("aria-required", "true");
    await expect(create).toBeDisabled();
    await panel.getByLabel("Name").fill("   ");
    await expect(create).toBeDisabled();
    await panel.getByLabel("Name").fill("Ann, Tuesday walk group");
    await expect(create).toBeEnabled();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  test("a failed create shows wording without an HTTP number", async ({ page }) => {
    await openBeta(page, okHandler((route, body) => {
      if (body.action === "create") return json(route, 500, {});
    }));
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByLabel("Name").fill("Zoe");
    await panel.getByRole("button", { name: "Create code" }).click();
    await expect(panel.locator("#adminBetaStatus")).toHaveText("Could not create a code. Try again.");
  });

  test("a 401 on load returns to admin sign-in", async ({ page }) => {
    await openBeta(page, (route) => json(route, 401, { error: "Unauthorized" }));
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
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
    await expect(panel.getByLabel("Name")).toBeEnabled();
    await panel.getByLabel("Name").fill("Ann");
    await expect(panel.getByRole("button", { name: "Create code" })).toBeEnabled();
  });

  test("Beta is a page: Back returns to the map and Escape does not close it", async ({ page }) => {
    await openBeta(page, okHandler());
    await expect(page.locator("#adminBeta")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Beta", level: 2 })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#adminBeta")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#adminBeta")).toBeHidden();
    await expect(page.locator("#adminCanvas")).toBeVisible();
  });

  test("Share link on a row shares the beta link without the note", async ({ page }) => {
    await page.addInitScript(() => {
      window.__shares = [];
      Object.defineProperty(navigator, "share", { value: (data) => { window.__shares.push(data); return Promise.resolve(); }, configurable: true });
    });
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    const button = panel.locator("li").nth(1).getByRole("button", { name: "Share link" });
    await button.click();
    const shares = await page.evaluate(() => window.__shares);
    const origin = await page.evaluate(() => location.origin);
    expect(shares).toHaveLength(1);
    expect(shares[0].url).toBe(`${origin}/beta/b345f`);
    expect(JSON.stringify(shares[0])).not.toContain("Ann");
    expect(shares[0].text).not.toContain("Ann");
    expect(shares[0].text).toContain("what you like");
    expect(shares[0].text).toContain("isn't working");
    await expect(button).toBeFocused();
  });

  test("a cancelled share shows no error", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: () => Promise.reject(new DOMException("cancelled", "AbortError")), configurable: true });
    });
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    const button = panel.getByRole("button", { name: "Share link for b345f" });
    await button.click();
    await page.waitForTimeout(150);
    await expect(panel.locator("#adminBetaStatus")).toHaveText("");
    await expect(button).toBeFocused();
  });

  test("Share link falls back to copy when the share sheet is missing", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true });
    });
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByRole("button", { name: "Share link for b345f" }).click();
    await expect(panel.locator("#adminBetaStatus")).toContainText(/Copied .*\/beta\/b345f/);
  });

  test("Share link names its code and revoked rows have none", async ({ page }) => {
    await openBeta(page, okHandler());
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await expect(panel.getByRole("button", { name: "Share link for a234e" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Share link for b345f" })).toBeVisible();
    await expect(panel.locator("li").nth(2).getByRole("button", { name: /Share link/ })).toHaveCount(0);
  });

  test("after Create, the status line offers Share link for the new code", async ({ page }) => {
    await page.addInitScript(() => {
      window.__shares = [];
      Object.defineProperty(navigator, "share", { value: (data) => { window.__shares.push(data); return Promise.resolve(); }, configurable: true });
    });
    await openBeta(page, okHandler((route, body) => {
      if (body.action === "create") return json(route, 200, { code: "z999q", note: body.note, createdAt: "2026-11-22T10:00:00.000Z", status: "open" });
    }));
    const panel = page.locator("#adminBeta");
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByLabel("Name").fill("Secret Zoe");
    await panel.getByRole("button", { name: "Create code" }).click();
    await expect(panel.locator("li")).toHaveCount(4);
    await panel.locator("#adminBetaStatus").getByRole("button", { name: "Share link for z999q" }).click();
    const shares = await page.evaluate(() => window.__shares);
    expect(shares).toHaveLength(1);
    expect(shares[0].url).toMatch(/\/beta\/z999q$/);
    expect(JSON.stringify(shares[0])).not.toContain("Zoe");
  });
});
