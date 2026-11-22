const { test, expect } = require("@playwright/test");

// /beta/<code> is a standalone page outside the app. Auth0 and the redeem function are mocked at the network edge.
async function mockMe(page, signedIn) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(signedIn ? { signedIn: true, name: "Sam" } : { signedIn: false }) })
  );
}
async function mockNearby(page) {
  await page.route("**/nearby", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Nearby stub</title><p>Nearby</p>" })
  );
}
function trackRedeem(page, status, body) {
  const calls = [];
  page.route("**/api/beta/redeem", (route) => {
    calls.push(route.request().postDataJSON());
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return calls;
}

test.describe("Beta sign-in page", () => {
  test("signed out, the person is offered sign-in that returns to their beta link", async ({ page }) => {
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    const signIn = page.getByRole("link", { name: "Sign in to join the beta" });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute("href", "/api/auth/login?return=/beta/a234e");
  });

  test("signed in with a valid code, the code is redeemed and the person lands on Nearby", async ({ page }) => {
    await mockMe(page, true);
    await mockNearby(page);
    const calls = trackRedeem(page, 200, { ok: true });
    await page.goto("/beta/A234E");
    await page.waitForURL("**/nearby");
    expect(calls).toEqual([{ code: "a234e" }]);
  });

  test("signed out, the status line invites the person to claim their invite", async ({ page }) => {
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    await expect(page.getByRole("status")).toHaveText("Your invite is ready. Sign in to claim it.");
  });

  test("a code already used says what to do next and offers a different account", async ({ page }) => {
    await mockMe(page, true);
    trackRedeem(page, 409, { error: "That beta link has already been used." });
    await page.goto("/beta/a234e");
    const status = page.getByRole("status");
    await expect(status).toContainText("That beta link has already been used.");
    await expect(status).toContainText("Ask whoever sent you the link for a new one, or sign in with the account you used first.");
    await expect(page.getByRole("link", { name: "Use a different account" })).toHaveAttribute("href", "/api/auth/logout?return=/beta/a234e");
  });

  test("a withdrawn link says to ask for a new one", async ({ page }) => {
    await mockMe(page, true);
    trackRedeem(page, 410, { error: "That beta link has been withdrawn." });
    await page.goto("/beta/a234e");
    await expect(page.getByRole("status")).toContainText("That beta link has been withdrawn.");
    await expect(page.getByRole("status")).toContainText("Ask whoever sent you the link for a new one.");
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });

  test("a malformed link says to ask for a new one", async ({ page }) => {
    await page.goto("/beta/AB");
    await expect(page.getByRole("status")).toContainText("Ask whoever sent you the link for a new one.");
  });

  test("an unexpected server failure offers Retry, which tries again and moves focus to the message", async ({ page }) => {
    await mockMe(page, true);
    await mockNearby(page);
    let n = 0;
    await page.route("**/api/beta/redeem", (route) => {
      n++;
      if (n === 1) return route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Bad gateway</h1>" });
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "That beta link has already been used." }) });
    });
    await page.goto("/beta/a234e");
    await expect(page.getByRole("status")).toContainText("Could not join the beta. Try again.");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("status")).toContainText("already been used");
    expect(n).toBe(2);
    await expect(page.locator("#message")).toBeFocused();
  });

  test("a 400 with no text offers Retry", async ({ page }) => {
    await mockMe(page, true);
    await page.route("**/api/beta/redeem", (route) => route.fulfill({ status: 400, contentType: "application/json", body: "{}" }));
    await page.goto("/beta/a234e");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("a code already used shows the server's message and stays on the page", async ({ page }) => {
    await mockMe(page, true);
    await mockNearby(page);
    trackRedeem(page, 409, { error: "That beta link has already been used." });
    await page.goto("/beta/a234e");
    await expect(page.getByRole("status")).toContainText("That beta link has already been used.");
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe("/beta/a234e");
  });

  test("a temporary storage failure offers Retry", async ({ page }) => {
    await mockMe(page, true);
    trackRedeem(page, 503, { error: "Storage unavailable. Try again." });
    await page.goto("/beta/a234e");
    await expect(page.getByRole("status")).toContainText("Storage unavailable. Try again.");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("a malformed link says so and calls no API", async ({ page }) => {
    const apiCalls = [];
    page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url()); });
    await page.goto("/beta/AB");
    await expect(page.getByRole("status")).toContainText("That beta link isn't valid.");
    await page.waitForTimeout(300);
    expect(apiCalls).toEqual([]);
  });

  test("the page fits a phone width without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    await expect(page.getByRole("link", { name: "Sign in to join the beta" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("signed out at 320px wide, nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    await expect(page.getByRole("link", { name: "Sign in to join the beta" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("with reduced motion, the brand mark is fully visible at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    const mark = page.locator(".brand-mark");
    await expect(mark).toBeVisible();
    expect(await mark.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("the tree rings pulse gently when motion is allowed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    const looping = await page.locator(".rings circle").evaluateAll((els) =>
      els.map((el) => el.getAnimations().some((a) => a.effect.getComputedTiming().iterations === Infinity && a.playState === "running"))
    );
    expect(looping.some(Boolean)).toBe(true);
  });

  test("with reduced motion, the tree rings stay still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    const names = await page.locator(".rings circle").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toBe("none");
  });

  test("the page has a favicon from the homepage assets", async ({ page }) => {
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    const href = await page.locator('link[rel="icon"]').getAttribute("href");
    expect(href).toMatch(/^\/assets\/home\//);
  });

  test("the primary button looks different when hovered", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockMe(page, false);
    await page.goto("/beta/a234e");
    const btn = page.getByRole("link", { name: "Sign in to join the beta" });
    await expect(btn).toBeVisible();
    const bg = () => btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    const before = await bg();
    await btn.hover();
    await expect.poll(bg).not.toBe(before);
  });
});
