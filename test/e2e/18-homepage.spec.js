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
    await expect(page.locator("#find-trees")).toContainText("Search its tag number.");
    await expect(page.locator(".signup-intro")).toContainText("Alpha invitations aren’t open yet");

    await context.close();
  });

  test("states the offline promise, the trees and the cattle", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Works where your phone doesn't/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Every veteran tree in the register/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Follow the longhorns/i })).toBeVisible();
  });

  test("explains finding a specific tree by its tag and treating its age as an estimate", async ({ page }) => {
    await page.goto("/");
    const trees = page.locator("#find-trees");
    await expect(trees.getByRole("heading", { name: "Find the tree behind the tag" })).toBeVisible();
    await expect(trees).toContainText("Search its tag number.");
    await expect(trees).toContainText("Navigate to that tree.");
    await expect(trees).toContainText("recorded girth and species");
    await expect(trees).toContainText("not an exact birthday");
    await expect(trees.locator(".tag-photo img")).toHaveAttribute(
      "alt",
      /metal tree tag stamped with the number 27400/i
    );
    await expect(trees.locator(".tag-story figcaption")).toHaveText([
      "The tag you spot: 27400",
      "1. Search the number",
      "2. Follow the route",
      "3. Find it nearby"
    ]);
    await expect(trees.locator(".app-shot img")).toHaveCount(3);
  });

  test("offers release news and major updates while alpha invitations are not open", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Be first to hear", exact: true }).click();
    await expect(page.locator(".cta-note")).toContainText("Alpha invitations aren’t open yet");
    await expect(page.locator(".signup-intro")).toContainText("Alpha invitations aren’t open yet");
    await expect(page.locator(".signup-intro")).toContainText("major updates");
    await expect(page.getByRole("button", { name: "Keep me updated" })).toBeVisible();
    await expect(page.locator(".consent")).toContainText("release, alpha invitations and major updates");
    await expect(page.locator("#consent")).not.toBeChecked();
  });

  test("explains periodic network requests and stale offline cow positions in copy and search data", async ({ page }) => {
    await page.goto("/");
    const cattle = page.locator(".pillars article").filter({ hasText: "Follow the longhorns" });
    await expect(cattle).toContainText("periodically makes a network request");
    await expect(cattle).toContainText("last saved positions");
    await expect(page.locator(".how").filter({ hasText: "How it works offline" })).toContainText("offline positions may be out of date");
    const faqs = await page.locator('script[type="application/ld+json"]').textContent();
    const questions = JSON.parse(faqs)["@graph"].find(item => item["@type"] === "FAQPage").mainEntity;
    for (const name of ["Does it really work without a phone signal?", "How do you know where the cattle are?"]) {
      const question = questions.find(item => item.name === name);
      await expect(page.locator(".faq dd").filter({ hasText: question.acceptedAnswer.text })).toBeVisible();
      expect(question.acceptedAnswer.text).toContain("last saved positions");
    }
    await expect(page.locator(".faq")).not.toContainText("makes no network requests");
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

  test("loads its own assets without fetching app code, icons or data", async ({ page }) => {
    const requests = [];
    page.on("request", request => requests.push(new URL(request.url()).pathname));
    await page.goto("/");

    const localAssets = await page.locator('script[src], link[rel="stylesheet"], link[rel="icon"], img').evaluateAll(
      elements => elements.map(el => el.src || el.href)
        .filter(url => new URL(url).origin === location.origin)
    );
    expect(localAssets.length).toBeGreaterThan(0);
    for (const url of localAssets) {
      expect(new URL(url).pathname).toMatch(/^\/assets\/home\//);
    }
    await expect(page.locator(".hero-photo img")).toBeVisible();
    await expect.poll(() => page.locator("img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
    expect(requests.filter(path => /^\/(js|css|data)\//.test(path))).toEqual([]);
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

  test("gives a neutral success message that also covers an existing address", async ({ page }) => {
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

    await expect(page.locator("#formMsg")).toContainText(
      "Confirmation is needed — check your inbox. The email might be in your spam folder."
    );
    await expect(page.locator("#email")).toBeDisabled();
    await expect(page.locator("#consent")).toBeDisabled();
    await expect(page.locator("#signupForm button[type=submit]")).toBeDisabled();
    await expect(page.locator("#signupForm button[type=submit]")).toHaveText("Request received");
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
