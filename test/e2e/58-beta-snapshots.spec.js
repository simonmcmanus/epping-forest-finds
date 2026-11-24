// @ts-check
// Visual snapshots of every beta screen and state: the /beta/<code> sign-in page (desktop and mobile) and
// the admin Beta page (desktop only). Baselines are written by CI, never by hand. Auth0, the redeem
// function and the admin API are all mocked at the network edge, so nothing depends on time or the network.
const { test, expect } = require("@playwright/test");
const { skipOnboarding } = require("./helpers");

const json = (route, status, data) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
const NEVER = () => new Promise(() => {});
// The link text is inline in the status line, so it cannot be masked on its own. Swap the browser origin for a
// fixed one in the text nodes, so the image is the same on every host (local, CI).
async function fixOrigin(panel) {
  await panel.locator("#adminBetaStatus").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeValue = n.nodeValue.split(location.origin).join("https://example.test");
  });
}

async function mockMe(page, signedIn) {
  await page.route("**/api/auth/me", (route) => json(route, 200, signedIn ? { signedIn: true, name: "Sam" } : { signedIn: false }));
}
async function mockRedeem(page, status, body) {
  await page.route("**/api/beta/redeem", (route) => json(route, status, body));
}
async function capture(page, name) {
  await expect(page.locator("#message")).not.toHaveText("");
  await expect(page).toHaveScreenshot(name, { fullPage: true });
}

test.describe("Beta sign-in page snapshots", () => {
  test("snapshot: beta page, checking your sign-in", async ({ page }) => {
    await page.route("**/api/auth/me", NEVER);
    await page.goto("/beta/a234e");
    await expect(page.locator("#message")).toHaveText("Checking your sign-in…");
    await capture(page, "beta-checking.png");
  });

  test("snapshot: beta page, signed out", async ({ page }) => {
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    await expect(page.getByRole("link", { name: "Sign in to join the beta" })).toBeVisible();
    await capture(page, "beta-signed-out.png");
  });

  test("snapshot: beta page, joining", async ({ page }) => {
    await mockMe(page, true);
    await page.route("**/api/beta/redeem", NEVER);
    await page.goto("/beta/a234e");
    await expect(page.locator("#message")).toHaveText("Joining the beta…");
    await capture(page, "beta-joining.png");
  });

  test("snapshot: beta page, success opening Community", async ({ page }) => {
    await mockMe(page, true);
    await mockRedeem(page, 200, { ok: true });
    // The redirect target answers 204 No Content, which leaves the page where it is on the success message.
    await page.route("**/community", (route) => route.fulfill({ status: 204 }));
    await page.goto("/beta/a234e", { waitUntil: "commit" });
    await expect(page.locator("#message")).toHaveText("Opening Community…");
    await capture(page, "beta-success.png");
  });

  test("snapshot: beta page, code already used by another account", async ({ page }) => {
    await mockMe(page, true);
    await mockRedeem(page, 409, { error: "That beta link has already been used." });
    await page.goto("/beta/a234e");
    await expect(page.getByRole("link", { name: "Use a different account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Community" })).toBeVisible();
    await capture(page, "beta-already-used.png");
  });

  test("snapshot: beta page, link withdrawn", async ({ page }) => {
    await mockMe(page, true);
    await mockRedeem(page, 410, { error: "That beta link has been withdrawn." });
    await page.goto("/beta/a234e");
    await expect(page.locator("#message")).toContainText("withdrawn");
    await capture(page, "beta-withdrawn.png");
  });

  test("snapshot: beta page, invalid link", async ({ page }) => {
    await page.goto("/beta/AB");
    await expect(page.locator("#message")).toContainText("isn't valid");
    await capture(page, "beta-invalid.png");
  });

  test("snapshot: beta page, server error with Retry", async ({ page }) => {
    await mockMe(page, true);
    await page.route("**/api/beta/redeem", (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Bad gateway</h1>" }));
    await page.goto("/beta/a234e");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await capture(page, "beta-server-error.png");
  });

  test("snapshot: beta page, storage error", async ({ page }) => {
    await mockMe(page, true);
    await mockRedeem(page, 503, { error: "Storage unavailable. Try again." });
    await page.goto("/beta/a234e");
    await expect(page.locator("#message")).toContainText("Storage unavailable. Try again.");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await capture(page, "beta-storage-error.png");
  });

  test.describe("dark", () => {
    test.use({ colorScheme: "dark" });

    test("snapshot: beta page, signed out, dark", async ({ page }) => {
      await mockMe(page, false);
      await page.goto("/beta/a234e");
      await expect(page.getByRole("link", { name: "Sign in to join the beta" })).toBeVisible();
      await capture(page, "beta-signed-out-dark.png");
    });

    test("snapshot: beta page, code already used, dark", async ({ page }) => {
      await mockMe(page, true);
      await mockRedeem(page, 409, { error: "That beta link has already been used." });
      await page.goto("/beta/a234e");
      await expect(page.getByRole("link", { name: "Use a different account" })).toBeVisible();
      await capture(page, "beta-already-used-dark.png");
    });
  });

  test.describe("no JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("snapshot: beta page, no JavaScript", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "desktop only");
      await page.goto("/beta/a234e");
      await expect(page.locator("noscript p")).toBeVisible();
      await expect(page).toHaveScreenshot("beta-nojs.png", { fullPage: true });
    });
  });
});

// The admin dashboard is a desk tool: desktop only.
const TRACKS = { locations: [], clicks: [], meta: { storeName: "tracking-test", context: "test", windowDays: 30 } };
const CODES = [
  { code: "a234e", note: "Simon", createdAt: "2026-11-01T10:00:00.000Z", status: "claimed", claimedAt: "2026-11-02T09:00:00.000Z" },
  { code: "b345f", note: "Ann", createdAt: "2026-10-30T10:00:00.000Z", status: "open" },
  { code: "c456g", note: "", createdAt: "2026-10-29T10:00:00.000Z", status: "revoked" },
];

async function openBeta(page, handler) {
  await skipOnboarding(page);
  await page.route(/\/api\/admin\/me/, (route) => json(route, 200, { signedIn: true, name: "Test Admin" }));
  await page.route(/\/api\/admin\/tracks/, (route) => json(route, 200, TRACKS));
  await page.route(/\/api\/beta\/codes/, (route) => {
    const req = route.request();
    return handler(route, req.method() === "POST" ? JSON.parse(req.postData() || "{}") : null);
  });
  await page.goto("/admin");
  await expect(page.locator("#loginScreen")).toBeHidden();
  await expect(page.locator("#adminUserList")).toContainText("All users");
  await page.getByRole("button", { name: "Beta", exact: true }).click();
  return page.locator("#adminBeta");
}
const okHandler = (extra) => (route, body) => {
  if (route.request().method() === "GET") return json(route, 200, { codes: CODES });
  if (extra) { const r = extra(route, body); if (r) return r; }
  return json(route, 200, { ok: true });
};

test.describe("Admin beta page snapshots", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the admin dashboard is desktop only");
  });

  test("snapshot: admin beta codes, loading", async ({ page }) => {
    const panel = await openBeta(page, (route) => (route.request().method() === "GET" ? NEVER() : json(route, 200, { ok: true })));
    await expect(panel.locator("#adminBetaStatus")).toHaveText("Loading…");
    await expect(panel).toHaveScreenshot("admin-beta-loading.png");
  });

  test("snapshot: admin beta codes, open, claimed and revoked", async ({ page }) => {
    const panel = await openBeta(page, okHandler());
    await expect(panel.locator("li")).toHaveCount(3);
    await expect(panel.locator("li").nth(0)).toContainText(/claimed/i);
    await expect(panel.locator("li").nth(1)).toContainText(/open/i);
    await expect(panel.locator("li").nth(2)).toContainText(/revoked/i);
    await expect(panel).toHaveScreenshot("admin-beta-list.png");
  });

  test("snapshot: admin beta codes, empty list", async ({ page }) => {
    const panel = await openBeta(page, (route) => json(route, 200, { codes: [] }));
    await expect(panel.locator("#adminBetaNote")).toBeEnabled();
    await expect(panel.locator("li")).toHaveCount(0);
    await expect(panel).toHaveScreenshot("admin-beta-empty.png");
  });

  test("snapshot: admin beta codes, after create", async ({ page }) => {
    const panel = await openBeta(page, okHandler((route, body) => {
      if (body.action === "create") return json(route, 200, { code: "z999q", note: body.note, createdAt: "2026-11-22T10:00:00.000Z", status: "open" });
    }));
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByLabel("Name").fill("For Bob");
    await panel.getByRole("button", { name: "Create code" }).click();
    await expect(panel.locator("li")).toHaveCount(4);
    const status = panel.locator("#adminBetaStatus");
    await expect(status).toContainText("/beta/z999q");
    await expect(status.getByRole("button", { name: "Share link for z999q" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Copy link for z999q" })).toBeVisible();
    await fixOrigin(panel);
    await expect(panel).toHaveScreenshot("admin-beta-created.png");
  });

  test("snapshot: admin beta codes, copy fallback message", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
    });
    const panel = await openBeta(page, okHandler());
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.locator("li").nth(1).getByRole("button", { name: /Copy link/ }).click();
    await expect(panel.locator("#adminBetaStatus")).toContainText("Could not copy automatically. Copy this link:");
    await expect(panel.locator("#adminBetaStatus")).toContainText("/beta/b345f");
    await fixOrigin(panel);
    await expect(panel).toHaveScreenshot("admin-beta-copy-fallback.png");
  });

  test("snapshot: admin beta codes, revoke armed", async ({ page }) => {
    const panel = await openBeta(page, okHandler());
    await expect(panel.locator("li")).toHaveCount(3);
    await panel.getByRole("button", { name: "Revoke code b345f" }).click();
    await expect(panel.getByRole("button", { name: "Confirm revoke code b345f" })).toBeVisible();
    await expect(panel.locator("#adminBetaStatus")).toContainText(/sure|confirm/i);
    await expect(panel).toHaveScreenshot("admin-beta-revoke-armed.png");
  });

  test("snapshot: admin beta codes, load error with Retry", async ({ page }) => {
    const panel = await openBeta(page, (route) => json(route, 503, { error: "x" }));
    await expect(panel.locator("#adminBetaStatus")).toContainText("Could not load");
    await expect(panel.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(panel).toHaveScreenshot("admin-beta-load-error.png");
  });

  test("snapshot: admin beta codes, name field empty and disabled", async ({ page }) => {
    const panel = await openBeta(page, (route) => json(route, 503, { error: "x" }));
    await expect(panel.locator("#adminBetaStatus")).toContainText("Could not load");
    await expect(panel.locator("label[for=adminBetaNote]")).toHaveText("Name (required)");
    await expect(panel.getByLabel("Name")).toBeDisabled();
    await expect(panel.getByLabel("Name")).toHaveValue("");
    await expect(panel.getByRole("button", { name: "Create code" })).toBeDisabled();
    await expect(panel.locator(".admin-beta-create")).toHaveScreenshot("admin-beta-name-disabled.png");
  });
});
