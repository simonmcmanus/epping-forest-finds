/**
 * The marketing homepage at / — the public front door during the closed alpha.
 *
 * The alpha gate itself is a Netlify edge function and does not exist under
 * server.js, so these specs cover what the homepage does, not who may reach
 * the app. See spec/spec-alpha-access.md section 3.4.
 */

const { test, expect } = require("@playwright/test");

test.describe("the marketing homepage", () => {
  test("explains what the app is without needing JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.locator("h1")).toContainText("The forest has no signal");
    await expect(page.getByText("24,906", { exact: false }).first()).toBeVisible();
    await expect(page.locator("#signupForm")).toBeVisible();

    await context.close();
  });

  test("states the offline promise, the trees and the cattle", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Works where your phone doesn't/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Every veteran tree in the register/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Follow the longhorns/i })).toBeVisible();
  });

  test("uses the longhorn photograph as the accessible hero", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".hero-photo img")).toHaveAttribute(
      "alt",
      /GPS-collared English Longhorn cattle grazing in Epping Forest/i
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      /assets\/home\/epping-longhorns-social\.jpg$/
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  });

  test("does not load the app's code or offer the app as an installable page", async ({ page }) => {
    await page.goto("/");

    const appScripts = await page.locator('script[src*="js/app.js"]').count();
    expect(appScripts).toBe(0);

    const baseStylesheet = await page.locator('link[href*="css/base.css"]').count();
    expect(baseStylesheet).toBe(0);

    // Linking the manifest here would let visitors install the marketing page
    // as a PWA instead of the app.
    const manifest = await page.locator('link[rel="manifest"]').count();
    expect(manifest).toBe(0);
  });

  test("points search engines at itself and links onward to the app and the ledger", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://www.eppingforestfinds.uk/"
    );
    await expect(page.locator('a[href="/reports/"]').first()).toBeVisible();
    await expect(page.locator('a[href="/terms.html"]').first()).toBeVisible();
  });

  test("tells the visitor to check their inbox rather than claiming they are subscribed", async ({ page }) => {
    await page.route("**/api/subscribe", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    );

    await page.goto("/");
    await page.fill("#email", "walker@example.com");
    await page.check("#consent");
    await page.click("#signupForm button[type=submit]");

    await expect(page.locator("#formMsg")).toContainText(/check your inbox/i);
  });

  test("refuses to submit without consent", async ({ page }) => {
    let called = false;
    await page.route("**/api/subscribe", (route) => {
      called = true;
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/");
    await page.fill("#email", "walker@example.com");
    await page.click("#signupForm button[type=submit]");

    await expect(page.locator("#formMsg")).toContainText(/tick the box/i);
    expect(called).toBe(false);
  });

  test("surfaces the error the endpoint returns", async ({ page }) => {
    await page.route("**/api/subscribe", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Sign-up is temporarily unavailable. Please try again later." }),
      })
    );

    await page.goto("/");
    await page.fill("#email", "walker@example.com");
    await page.check("#consent");
    await page.click("#signupForm button[type=submit]");

    await expect(page.locator("#formMsg")).toContainText(/temporarily unavailable/i);
  });
});

test.describe("the app's own URL", () => {
  test("serves the map at /app", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("#mapCanvas")).toBeAttached();
  });
});
