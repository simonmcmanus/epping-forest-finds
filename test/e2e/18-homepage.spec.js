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
    await expect(page.locator(".hero + #find-trees + .tag-feature + .pillars")).toHaveCount(1);
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
    const brandWidth = parseFloat(await page.locator(".brand-mark").evaluate(el => getComputedStyle(el).width));
    expect(brandWidth).toBeGreaterThanOrEqual(36);
    const headerOnOneLine = await page.locator(".site-head").evaluate(head =>
      [...head.querySelectorAll(".brand span, .head-link")].every(el => el.getClientRects().length === 1 && el.getBoundingClientRect().height < 32));
    expect(headerOnOneLine).toBe(true);
    await expect(page.locator(".hero-eyebrow .hero-leaf")).toHaveAttribute("src", "assets/home/map-icons/oak.png");
    await expect(page.locator(".hero-eyebrow")).toHaveText("Epping Forest, offline");
    await expect(page.locator(".inventory-total")).toContainText("31,000");
    const totalIcon = page.locator(".inventory-total img");
    await expect(totalIcon).toHaveAttribute("src", "assets/home/map-icons/all-finds.png");
    const iconLeftOfTotal = await page.locator(".inventory-total").evaluate(total => {
      const icon = total.querySelector("img").getBoundingClientRect();
      const count = total.querySelector("strong").getBoundingClientRect();
      return icon.width === 44 && icon.right <= count.left && icon.bottom > count.top && icon.top < count.bottom;
    });
    expect(iconLeftOfTotal).toBe(true);
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
    await expect(trees.locator(".tag-story figcaption")).toHaveText([
      "1. Search its tag number. Enter the number on the tree’s physical tag to find its record on the map.",
      "2. Navigate to that tree. Select it for a route from your location. We try to find a more scenic way through forest paths and alleyways. Check its tag number when you arrive.",
      "3. Discover its estimated age. We use the recorded girth and species to make an educated guess, where the data is available — not an exact birthday."
    ]);
    await expect(trees.locator(".app-shot img")).toHaveCount(3);
    const shots = await trees.locator(".app-shot img").evaluateAll(images => images.map(img => img.getAttribute("src")));
    expect(shots).toEqual(["assets/home/app-search.jpg", "assets/home/app-nearby-route.jpg", "assets/home/app-tree-age.jpg"]);
    for (const shot of await trees.locator(".app-shot img").all()) {
      await expect(shot).toHaveCSS("border-top-color", "rgb(29, 74, 47)");
      await expect(shot).toHaveCSS("border-top-width", "4px");
    }
    for (const figure of await trees.locator(".app-shot").all()) {
      await expect(figure).toHaveCSS("border-top-width", "0px");
      const tucked = await figure.evaluate(el => {
        const phone = el.querySelector("img").getBoundingClientRect();
        const caption = el.querySelector("figcaption").getBoundingClientRect();
        return caption.top < phone.bottom && caption.bottom > phone.bottom
          && Math.abs(caption.width - phone.width) < 1 && Math.abs(caption.left - phone.left) < 1;
      });
      expect(tucked).toBe(true);
    }
    await expect(trees.locator(".steps")).toHaveCount(0);
  });

  test("shows the example tag on its own, centred in a circle with no caption", async ({ page }) => {
    await page.goto("/");
    const feature = page.locator(".tag-feature");
    const photo = feature.locator("img");
    await expect(photo).toHaveAttribute("alt", /metal tree tag stamped with the number 27400/i);
    await expect(feature.locator("figcaption")).toHaveCount(0);
    await expect(feature).toHaveText("");
    await photo.scrollIntoViewIfNeeded();
    await expect(photo).toHaveCSS("border-radius", "50%");
    const geometry = await photo.evaluate(img => {
      const box = img.getBoundingClientRect();
      const section = img.parentElement.getBoundingClientRect();
      return {
        square: Math.abs(box.width - box.height) < 1,
        centred: Math.abs(box.x + box.width / 2 - section.x - section.width / 2) < 1
      };
    });
    expect(geometry).toEqual({ square: true, centred: true });
    await expect(feature).toHaveCSS("border-top-width", "0px");
    await expect(page.locator(".tag-feature + .pillars")).toHaveCSS("border-top-width", "0px");
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

  test("highlights signup before the practical questions and ends on the Ledger", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".signup-intro")).toContainText("weekly Epping Forest Ledger updates once the site launches");
    await expect(page.locator(".consent")).toContainText("weekly Epping Forest Ledger updates once the site launches");
    await expect(page.locator(".signup + .offline-how + .faq + .ledger")).toHaveCount(1);
    await expect(page.locator(".signup .card-icon")).toHaveAttribute("src", "assets/home/mail.svg");
    await expect(page.locator(".ledger .card-icon")).toHaveAttribute("src", "assets/home/ledger.svg");
    // The eyebrow sits above, flush with the icon; the icon is centred on the title beside it.
    const iconAlignment = await page.locator(".card-head").evaluateAll(heads => heads.map(head => {
      const icon = head.querySelector(".card-icon").getBoundingClientRect();
      const heading = head.querySelector("h2").getBoundingClientRect();
      const eyebrow = head.previousElementSibling.getBoundingClientRect();
      return {
        besideTitle: icon.right <= heading.left,
        centredOnTitle: Math.abs(icon.top + icon.height / 2 - (heading.top + heading.height / 2)) < 1,
        flushWithEyebrow: Math.abs(icon.left - eyebrow.left) < 1 && eyebrow.bottom <= icon.top
      };
    }));
    expect(iconAlignment).toEqual(Array(2).fill({ besideTitle: true, centredOnTitle: true, flushWithEyebrow: true }));
    await expect(page.locator(".ledger").getByRole("link", { name: "Read the Ledger →" })).toHaveCSS("background-color", "rgb(46, 107, 68)");
    await expect(page.locator("main > section:last-child")).toHaveClass(/\bledger\b/);
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

  test("presents the offline steps as numbered cards and the questions as one divided card", async ({ page }) => {
    await page.goto("/");
    const steps = page.locator(".offline-how .steps li");
    await expect(steps).toHaveCount(3);
    await expect(steps.locator("strong")).toHaveText(["Open it once", "It downloads", "Walk out of range"]);
    for (const step of await steps.all()) {
      await expect(step).toHaveCSS("border-radius", "14px");
      await expect(step).not.toHaveCSS("box-shadow", "none");
      const badge = await step.evaluate(el => {
        const style = getComputedStyle(el, "::before");
        return { background: style.backgroundColor, radius: style.borderRadius, width: style.width };
      });
      expect(badge).toEqual({ background: "rgb(29, 74, 47)", radius: "50%", width: "38px" });
    }
    await expect(page.locator(".offline-note img")).toHaveAttribute("src", "assets/home/cow.png");

    const faq = page.locator(".faq-list");
    await expect(faq).toHaveCSS("border-radius", "14px");
    await expect(faq.locator(".faq-item")).toHaveCount(5);
    await expect(faq.locator(".faq-item + .faq-item").first()).toHaveCSS("border-top-style", "solid");
  });

  test("reveals sections gently as they scroll into view, then hands back to hover", async ({ page }) => {
    await page.goto("/");
    const faq = page.locator(".faq-list");
    await expect(faq).toHaveClass(/\breveal\b/);
    await expect(faq).toHaveCSS("opacity", "0");
    await faq.scrollIntoViewIfNeeded();
    await expect(faq).toHaveCSS("opacity", "1");
    await expect(faq).not.toHaveClass(/\breveal\b/);

    // A screenshot's caption trails its phone, so the two read as separate objects.
    const shot = page.locator(".app-shot").last();
    const [phoneDelay, captionDelay] = await shot.evaluate(fig =>
      [fig.querySelector("img"), fig.querySelector("figcaption")].map(el => parseFloat(el.style.transitionDelay) || 0));
    expect(captionDelay - phoneDelay).toBe(160);
    await shot.scrollIntoViewIfNeeded();
    await expect(shot.locator(".reveal")).toHaveCount(0);
    if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
      await shot.hover();
      const lift = el => new DOMMatrix(getComputedStyle(el).transform).m42;
      await expect.poll(() => shot.locator("img").evaluate(lift)).toBe(-6);
      await expect.poll(() => shot.locator("figcaption").evaluate(lift)).toBe(-1);
    }

    const card = page.locator(".pillars article").first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).not.toHaveClass(/\breveal\b/);
    if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
      await card.hover();
      await expect(card).not.toHaveCSS("transform", "none");
    }
  });

  test("keeps everything still and shown for visitors who ask for reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator(".reveal")).toHaveCount(0);
    await expect(page.locator(".faq-list")).toHaveCSS("opacity", "1");
    await expect(page.locator(".hero-copy h1")).toHaveCSS("animation-name", "none");
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
    const [headline, tagline] = await page.locator("h1").evaluate(h1 => [
      parseFloat(getComputedStyle(h1).fontSize),
      parseFloat(getComputedStyle(h1.querySelector(".h1-tagline")).fontSize)
    ]);
    expect(tagline).toBeLessThan(headline);
    await expect(page.locator(".hero-photo figcaption")).toHaveCSS("background-color", "rgb(29, 74, 47)");
    await expect(page.locator(".hero-photo figcaption")).toHaveCSS("color", "rgb(255, 255, 255)");
    const captionFlush = await page.locator(".hero-photo").evaluate(figure => {
      const photo = figure.querySelector("img").getBoundingClientRect();
      const caption = figure.querySelector("figcaption").getBoundingClientRect();
      return [caption.left - photo.left, photo.right - caption.right, photo.bottom - caption.bottom].every(gap => Math.abs(gap) < 1);
    });
    expect(captionFlush).toBe(true);
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
