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

    await expect(page.locator("h1")).toHaveText("Your guide to Epping Forest.No Signal Necessary.");
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
    await expect(page.locator(".hero + .pillars + #find-trees")).toHaveCount(1);
    for (const card of await page.locator(".pillars article").all()) {
      await expect(card).toHaveCSS("border-radius", "14px");
      await expect(card).not.toHaveCSS("box-shadow", "none");
      const centred = await card.evaluate(el => {
        const cardRect = el.getBoundingClientRect();
        const iconRect = el.querySelector("img").getBoundingClientRect();
        return iconRect.width === 80 && Math.abs(iconRect.x + iconRect.width / 2 - cardRect.x - cardRect.width / 2) < 1;
      });
      expect(centred).toBe(true);
    }
  });

  test("groups the map inventory like the app filters and uses the oak-leaf brand mark", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".brand-mark")).toHaveAttribute("src", "assets/home/map-icons/oak.png");
    await expect(page.locator(".inventory-total")).toContainText("31,000");
    await expect(page.locator(".inventory-group h3")).toContainText([
      "Nature25,017", "Food771", "Transport1,864", "History12", "Locations30", "Stories42"
    ]);
    await expect(page.locator(".inventory-group h3 img")).toHaveCount(6);
    await expect(page.locator(".inventory-group dt img")).toHaveCount(22);
    const iconAlignment = await page.locator(".inventory-group").evaluateAll(groups => groups.map(group => {
      const parent = group.querySelector("h3 img").getBoundingClientRect();
      return [...group.querySelectorAll("dt img")].every(icon => {
        const child = icon.getBoundingClientRect();
        return Math.abs(parent.x + parent.width / 2 - child.x - child.width / 2) < 1;
      });
    }));
    expect(iconAlignment.every(Boolean)).toBe(true);
    await expect(page.locator(".inventory-always")).toContainText("Gates, benches & other facilities");
    await expect(page.locator(".inventory-always")).toContainText("3,264");
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
      "1. Search its tag number. Enter the number on the tree’s physical tag to find its record on the map.",
      "2. Navigate to that tree. Select it for a route from your location. We try to find a more scenic way through forest paths and alleyways. Check its tag number when you arrive.",
      "3. Discover its estimated age. We use the recorded girth and species to make an educated guess, where the data is available — not an exact birthday."
    ]);
    await expect(trees.locator(".app-shot img")).toHaveCount(3);
    await expect(trees.locator(".steps")).toHaveCount(0);
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

  test("highlights signup and the Ledger before the practical questions", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".signup-intro")).toContainText("weekly Epping Forest Ledger updates once the site launches");
    await expect(page.locator(".consent")).toContainText("weekly Epping Forest Ledger updates once the site launches");
    await expect(page.locator(".ledger + .signup + .how + .faq")).toHaveCount(1);
    await expect(page.locator("main > section:last-child")).toHaveClass("faq");
    await expect(page.locator(".faq")).not.toContainText("Does it drain my battery?");
    await expect(page.locator(".site-foot")).not.toContainText("Map data ©");
    await expect(page.locator(".offline-note")).toContainText("A note on the moving herd");
    await expect(page.locator(".signup")).toHaveCSS("border-left-color", "rgb(243, 211, 107)");
    await expect(page.locator(".signup")).toHaveCSS("border-top-width", "1px");
    const signupWidths = await page.locator(".signup").evaluate(el => {
      const style = getComputedStyle(el);
      const available = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return [".signup-intro", ".signup-form"].map(selector =>
        Math.abs(el.querySelector(selector).getBoundingClientRect().width - available));
    });
    expect(signupWidths.every(difference => difference < 1)).toBe(true);
    const ledger = page.locator(".ledger");
    expect(await ledger.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
    await expect(page.locator(".hero-photo figcaption")).toHaveCSS("background-color", "rgb(29, 74, 47)");
    await expect(page.locator(".hero-photo figcaption")).toHaveCSS("color", "rgb(255, 255, 255)");
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
