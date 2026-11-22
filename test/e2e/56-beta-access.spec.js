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
});
