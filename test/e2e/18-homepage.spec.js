/**
 * The marketing homepage at / — the public front door during the closed alpha.
 *
 * The alpha gate itself is a Netlify edge function and does not exist under
 * server.js, so these specs cover what the homepage does, not who may reach
 * the app. See spec/spec-alpha-access.md section 3.4.
 */

const { test, expect } = require("@playwright/test");
const { buildInventory } = require("../../scripts/report/map-inventory.js");
const { formatCount } = require("../../scripts/count-datasets.js");

test.describe("the marketing homepage", () => {
  test("links directly to every FAQ answer without requiring JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      for (const key of ["offline", "free", "tree-data", "cattle", "coverage"]) {
        await page.goto("/#faq-" + key);
        const answer = page.locator("#faq-" + key);
        await expect(answer).toBeInViewport();
        await expect(answer).toHaveCSS("background-color", "rgb(246, 241, 231)");
        await expect(answer.locator("dt a")).toHaveAttribute("href", "#faq-" + key);
      }
      await page.goto("/");
      await page.locator("#faq-tree-data dt a").click();
      await expect(page).toHaveURL(/#faq-tree-data$/);
      await expect(page.locator("#faq-tree-data")).toBeInViewport();
    } finally {
      await context.close();
    }
  });

  test("explains tree-data limitations and the trial's feedback to the City of London", async ({ page }) => {
    await page.goto("/");
    const answer = page.locator(".faq-item").filter({ hasText: "Where does the tree data come from?" }).locator("dd");
    await expect(answer).toContainText("provided by the City of London");
    await expect(answer).toContainText("some of the data may not be completely accurate");
    await expect(answer).toContainText("working to understand the issues and improve the data");
    await expect(answer).toContainText("report our findings back to the City of London");
    const data = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    const question = data["@graph"].find(item => item["@type"] === "FAQPage").mainEntity
      .find(item => item.name === "Where does the tree data come from?");
    await expect(answer).toHaveText(question.acceptedAnswer.text);
  });

  test("links every map category and subcategory to its filtered Nearby page", async ({ page }) => {
    await page.goto("/");
    const inventory = buildInventory();
    for (const group of inventory.groups) {
      await expect(page.locator(`[data-inventory-group="${group.key}"] h3 > a`)).toHaveAttribute("href", `/nearby/${group.key}/`);
      for (const subfilter of group.subfilters) {
        await expect(page.locator(`[data-inventory-key="${subfilter.key}"] dt > a`)).toHaveAttribute("href", `/nearby/${subfilter.key.replace(/_/g, "-")}/`);
      }
    }
    await expect(page.getByRole("link", { name: "Pubs & bars" })).toHaveAttribute("href", "/nearby/pubs/");
    await expect(page.locator(".inventory-toggle, .inventory-items")).toHaveCount(0);
  });

  test.skip("keeps category rows compact and marks the open list with a chevron and background", async ({ page }) => {
    await page.goto("/");
    const row = page.locator('[data-inventory-key="churches"]');
    const button = row.getByRole("button", { name: "Churches", exact: true });
    const appearance = () => button.evaluate(el => ({
      height: el.getBoundingClientRect().height,
      chevron: getComputedStyle(el, "::after").transform,
      symbol: getComputedStyle(el, "::after").content,
      background: getComputedStyle(el.closest("[data-inventory-key]")).backgroundColor,
    }));
    const closed = await appearance();
    expect(closed.height).toBeLessThan(30);
    expect(closed.symbol).toBe('""');
    await button.click();
    await expect(row.locator(".inventory-items")).toBeVisible();
    await expect(row).toHaveCSS("padding-left", "12px");
    await expect(row.locator(".inventory-items li").first()).toBeVisible();
    await expect.poll(async () => (await appearance()).chevron).not.toBe(closed.chevron);
    const opened = await appearance();
    expect(opened.background).not.toBe(closed.background);
    expect(opened.background).not.toBe("rgba(0, 0, 0, 0)");
    const card = await row.evaluate(el => {
      const style = getComputedStyle(el);
      const list = el.querySelector("ul");
      const search = el.querySelector("input");
      return {
        border: style.borderTopWidth,
        radius: parseFloat(style.borderRadius),
        padding: parseFloat(style.paddingLeft),
        shadow: style.boxShadow,
        listBackground: list && getComputedStyle(list).backgroundColor,
        searchBackground: search && getComputedStyle(search).backgroundColor,
      };
    });
    expect(card.border).toBe("1px");
    expect(card.radius).toBeGreaterThanOrEqual(10);
    expect(card.padding).toBe(12);
    expect(card.shadow).toBe("none");
    expect(card.listBackground).toBe(card.searchBackground);
    const spacing = await row.evaluate(el => {
      const header = el.querySelector("dt").getBoundingClientRect();
      const search = el.querySelector("input").getBoundingClientRect();
      const content = el.querySelector(".inventory-content").getBoundingClientRect();
      return { above: search.top - header.bottom, below: el.getBoundingClientRect().bottom - content.bottom };
    });
    expect(spacing.above).toBeLessThanOrEqual(14);
    expect(spacing.below).toBeLessThanOrEqual(14);
    await expect(row).toHaveCSS("background-color", "rgb(246, 241, 231)");
    await button.press("Enter");
    await expect(row.locator(".inventory-items")).toBeHidden();
    await expect.poll(appearance).toEqual(closed);
  });

  test.skip("expands Churches to show the map's churches and collapses with the keyboard", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: "Churches", exact: true });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.click();
    const panel = page.locator("#inventory-churches");
    const churches = require("../../assets/home/inventory/churches.json");
    await expect(panel.getByRole("listitem")).toHaveCount(Math.min(churches.length, 50));
    while (await panel.getByRole("listitem").count() < churches.length) {
      await panel.getByRole("button", { name: "Show more" }).click();
    }
    await expect(panel.getByRole("listitem")).toHaveText(churches.map(item => item.name + item.detail));
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await button.focus();
    await button.press("Enter");
    await expect(panel).toBeHidden();
  });

  test.skip("loads only opened categories, searches large lists and shows more results", async ({ page }) => {
    const requests = [];
    page.on("request", request => {
      if (request.url().includes("/assets/home/inventory/")) requests.push(request.url());
    });
    await page.goto("/");
    expect(requests).toHaveLength(0);
    const toggle = page.getByRole("button", { name: "Trees", exact: true });
    await toggle.click();
    const panel = page.locator("#inventory-trees");
    await expect(panel.getByRole("listitem")).toHaveCount(50);
    expect(requests).toHaveLength(1);
    await panel.getByRole("button", { name: "Show more" }).click();
    await expect(panel.getByRole("listitem")).toHaveCount(100);
    const search = panel.getByRole("searchbox", { name: "Search trees" });
    await search.fill("no-such-tree-species");
    await expect(panel.getByRole("status")).toHaveText("No matching places.");
    await expect(panel.getByRole("listitem")).toHaveCount(0);
    const trees = require("../../assets/home/inventory/trees.json");
    const taggedTree = trees.find(item => item.detail.startsWith("Tag "));
    await search.fill(taggedTree.detail);
    await expect(panel).toContainText(taggedTree.name);
    await expect(panel.getByRole("listitem").first()).toContainText(taggedTree.detail);
    await toggle.click();
    await toggle.click();
    await expect(search).toHaveValue(taggedTree.detail);
    expect(requests).toHaveLength(1);
  });

  test.skip("explains empty categories and lets visitors retry a failed category load", async ({ page }) => {
    let attempts = 0;
    await page.route("**/assets/home/inventory/medicine.json", route => {
      attempts += 1;
      return attempts === 1 ? route.abort() : route.continue();
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Medical sites", exact: true }).click();
    const panel = page.locator("#inventory-medicine");
    await expect(panel.getByRole("status")).toHaveText("Couldn't load these places. Please try again.");
    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(panel.getByRole("status")).toHaveText("No places in this category yet.");
    await expect(panel.getByRole("searchbox")).toBeHidden();
    await expect(panel.getByRole("button", { name: "Show more" })).toBeHidden();
  });

  test("explains what the app is without needing JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.locator("h1")).toHaveText("Your guide to Epping Forest.No Signal Necessary.");
    await expect(page.getByText("24,906", { exact: false }).first()).toBeVisible();
    await expect(page.locator(".hero-sub")).toHaveText("A free, offline map of Epping Forest. Find 24,906 veteran trees, forest paths, pubs and grazing cattle.");
    await expect(page.locator("#signupForm")).toBeVisible();
    await expect(page.locator("#find-trees")).toContainText("Search its tag number.");
    await expect(page.locator(".signup-intro")).toContainText("early testing opens");

    await context.close();
  });

  test("lets a keyboard user skip the header straight to the content", async ({ page }) => {
    await page.goto("/");

    const skipLink = page.locator(".skip-link");
    await expect(skipLink).toHaveAttribute("href", "#main");

    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();

    await skipLink.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("states the offline promise, the trees and the cattle", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Works where your phone doesn't/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Get to know the old trees/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Follow the longhorns/i })).toBeVisible();
    await expect(page.locator(".hero + .counts + .pillars + #find-trees")).toHaveCount(1);
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
    await expect(page.locator(".hero-copy > :first-child")).toHaveJSProperty("tagName", "H1");
    await expect(page.locator(".hero .eyebrow")).toHaveCount(0);
    // Counts come from the data, as the sync script writes them, so a data
    // change does not need this spec edited by hand.
    const inventory = buildInventory();
    await expect(page.locator(".inventory-total")).toContainText(formatCount(inventory.total));
    const totalIcon = page.locator(".inventory-total img");
    await expect(totalIcon).toHaveAttribute("src", "assets/home/map-icons/all-finds.png");
    const iconLeftOfTotal = await page.locator(".inventory-total").evaluate(total => {
      const icon = total.querySelector("img").getBoundingClientRect();
      const count = total.querySelector("strong").getBoundingClientRect();
      return icon.width === 44 && icon.right <= count.left && icon.bottom > count.top && icon.top < count.bottom;
    });
    expect(iconLeftOfTotal).toBe(true);
    await expect(page.locator(".inventory-group h3")).toContainText(
      inventory.groups.map(group => `${group.label}${formatCount(group.count)}`)
    );
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
    await expect(page.locator(".inventory-always")).toContainText(formatCount(inventory.alwaysShown.count));
  });

  test("explains finding a specific tree by its tag and treating its age as an estimate", async ({ page }) => {
    await page.goto("/");
    const trees = page.locator("#find-trees");
    await expect(trees.getByRole("heading", { name: "What’s with the tree tags?" })).toBeVisible();
    await expect(trees).toContainText("Search its tag number.");
    await expect(trees).toContainText("Find your way there.");
    await expect(trees).toContainText("recorded girth and species");
    await expect(trees).toContainText("not an exact birthday");
    await expect(trees.locator(".tag-story figcaption")).toHaveText([
      "1. Search its tag number. Find its record on the map.",
      "2. Find your way there. Get a route that aims to favour forest paths and alleyways. Check the tag when you arrive.",
      "3. See its estimated age. An estimate from recorded girth and species, where available — not an exact birthday."
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

  test("places the circular tag beside the introduction on desktop and above it on mobile", async ({ page }) => {
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
    await expect(page.locator("#find-trees .tag-intro .tag-feature")).toHaveCount(1);
    const layout = await page.locator(".tag-intro").evaluate(intro => {
      const copy = intro.querySelector(".tag-copy").getBoundingClientRect();
      const photo = intro.querySelector(".tag-feature").getBoundingClientRect();
      return innerWidth >= 640
        ? photo.right <= copy.left && photo.top < copy.bottom && photo.bottom > copy.top
        : photo.bottom <= copy.top;
    });
    expect(layout).toBe(true);
    await expect(page.locator("#find-trees > .tag-intro + .tag-story")).toHaveCount(1);
  });

  test("invites early testers to sign up and offers weekly ledger updates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Keep me in the loop", exact: true }).click();
    await expect(page.locator(".cta-note")).toContainText("early testing opens");
    await expect(page.locator(".signup-intro")).toContainText("early testing opens");
    await expect(page.locator(".signup-intro")).toContainText("weekly Epping Forest Ledger updates");
    await expect(page.getByRole("button", { name: "Email me updates" })).toBeVisible();
    await expect(page.locator("#signupConsent")).toContainText("By choosing “Email me updates”, you agree to receive emails from Epping Forest Finds");
    await expect(page.locator("#signup input[type=checkbox]")).toHaveCount(0);
  });

  test("highlights signup before the practical questions and ends on the Ledger", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".signup-intro")).toContainText("weekly Epping Forest Ledger updates once the site launches");
    await expect(page.locator("#signupConsent")).toContainText("weekly Epping Forest Ledger updates once the site launches");
    await expect(page.locator(".signup + .offline-how + .faq + .ledger")).toHaveCount(1);
    await expect(page.locator(".signup .card-icon")).toHaveAttribute("src", "assets/home/mail.png");
    await expect(page.locator(".ledger .card-icon")).toHaveAttribute("src", "assets/home/ledger.png");
    await expect(page.locator(".tag-copy .card-icon")).toHaveAttribute("src", "assets/home/tree-tag.png");
    await expect(page.locator(".offline-how .card-icon")).toHaveAttribute("src", "assets/home/offline.png");
    await expect(page.locator(".faq .card-icon")).toHaveAttribute("src", "assets/home/faq.png");
    await expect(page.locator("#signupEntry .eyebrow")).toHaveCount(0);
    // Icons remain centred beside their headings; only the Ledger has an eyebrow.
    const iconAlignment = await page.locator(".signup .card-head, .ledger .card-head").evaluateAll(heads => heads.map(head => {
      const icon = head.querySelector(".card-icon").getBoundingClientRect();
      const heading = head.querySelector("h2").getBoundingClientRect();
      const eyebrow = head.previousElementSibling?.getBoundingClientRect();
      return {
        besideTitle: icon.right <= heading.left,
        centredOnTitle: Math.abs(icon.top + icon.height / 2 - (heading.top + heading.height / 2)) < 1,
        flushWithEyebrow: eyebrow ? Math.abs(icon.left - eyebrow.left) < 1 && eyebrow.bottom <= icon.top : null
      };
    }));
    expect(iconAlignment).toEqual([
      { besideTitle: true, centredOnTitle: true, flushWithEyebrow: null },
      { besideTitle: true, centredOnTitle: true, flushWithEyebrow: true }
    ]);
    await expect(page.locator(".ledger").getByRole("link", { name: "Read the Ledger →" })).toHaveCSS("background-color", "rgb(46, 107, 68)");
    await expect(page.locator("main > section:last-child")).toHaveClass(/\bledger\b/);
    await expect(page.locator(".faq")).not.toContainText("Does it drain my battery?");
    await expect(page.locator(".site-foot")).not.toContainText("Map data ©");
    await expect(page.locator(".offline-note")).toContainText("Cattle locations offline");
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

  test("presents the offline steps as one divided card and the questions as one divided card", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator(".offline-how .offline-panel");
    await expect(panel).toHaveCSS("border-radius", "14px");
    await expect(panel).not.toHaveCSS("box-shadow", "none");
    const steps = panel.locator(".steps li");
    await expect(steps).toHaveCount(3);
    await expect(steps.locator("strong")).toHaveText(["Open it once", "It downloads", "Walk out of range"]);
    for (const step of await steps.all()) {
      await expect(step).toHaveCSS("box-shadow", "none");
      const badge = await step.evaluate(el => {
        const style = getComputedStyle(el, "::before");
        return { background: style.backgroundColor, radius: style.borderRadius, width: style.width };
      });
      expect(badge).toEqual({ background: "rgb(29, 74, 47)", radius: "50%", width: "38px" });
    }
    // Each step's title sits beside its badge, not on a row of its own.
    const titleBesideBadge = await steps.evaluateAll(items => items.map(el => {
      const title = el.querySelector("strong").getBoundingClientRect();
      const badge = el.getBoundingClientRect();
      return title.top - badge.top < 40;
    }));
    expect(titleBesideBadge).toEqual([true, true, true]);
    await expect(steps.nth(1)).toHaveCSS(await page.evaluate(() => innerWidth >= 640) ? "border-left-style" : "border-top-style", "solid");
    await expect(panel.locator(".offline-note")).toHaveCount(1);
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
    await expect(cattle).toContainText("Positions refresh while online");
    await expect(cattle).toContainText("last saved positions");
    await expect(page.locator(".how").filter({ hasText: "No signal? Here’s the plan" })).toContainText("offline positions may be out of date");
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
      const pathname = new URL(url).pathname;
      // cookie-consent.js is the one deliberate exception: a small shared, non-app file at the
      // site root (not under css/js, which stay app-only) that every page loads alike -- see
      // spec.md "Google tag (gtag.js) and the cookie-consent banner".
      expect(pathname === "/cookie-consent.js" || /^\/assets\/home\//.test(pathname)).toBe(true);
    }
    await expect(page.locator(".hero-photo img")).toBeVisible();
    for (const image of await page.locator('img[loading="lazy"]').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    }
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

  for (const reducedMotion of ["reduce", "no-preference"]) {
    test(`replaces the signup form with focused inbox guidance (motion: ${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      let payload;
      await page.route("**/api/subscribe", route => {
        payload = route.request().postDataJSON();
        return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      });
      await page.goto("/");
      await page.fill("#email", "walker@example.com");
      await page.getByRole("button", { name: "Email me updates" }).click();

      const confirmation = page.locator("#signupConfirmation");
      await expect(confirmation).toBeVisible();
      await expect(page.locator("#signupEntry")).toBeHidden();
      await expect(page.locator("#signupForm")).toBeHidden();
      await expect(page.locator("#confirmationHeading")).toBeFocused();
      await expect(confirmation).toContainText("Step 2 of 2");
      const reminder = confirmation.locator(".inbox-reminder");
      await expect(reminder).toBeVisible();
      await expect(reminder).toHaveText("Don’t forget");
      await expect(reminder.locator("svg")).toHaveCSS("animation-name", reducedMotion === "reduce" ? "none" : "inbox-remind");
      if (reducedMotion !== "reduce") await expect(reminder.locator("svg")).toHaveCSS("animation-iteration-count", "1");
      await expect(confirmation.locator(".inbox-step-badge")).toHaveText("2");
      await expect(confirmation.locator(".inbox-step-badge")).toBeVisible();
      await expect(page.locator("#confirmationHeading")).toHaveText("Confirm your email to finish");
      await expect(confirmation).toContainText("Check your inbox");
      await expect(confirmation).toContainText("Confirm my email");
      await expect(confirmation).toContainText("Epping Forest Finds");
      await expect(confirmation).toContainText("spam or junk");
      await expect(confirmation).toBeInViewport();
      expect(payload).toEqual({ email: "walker@example.com", consent: true, website: "" });
      await expect(page.getByText("After signing up, check your inbox", { exact: false })).toHaveCount(0);
      const iconMotion = await confirmation.locator("img").evaluate(el => ({
        name: getComputedStyle(el).animationName,
        iterations: getComputedStyle(el).animationIterationCount
      }));
      expect(iconMotion.name).toBe(reducedMotion === "reduce" ? "none" : "inbox-arrive");
      if (reducedMotion !== "reduce") expect(iconMotion.iterations).toBe("1");
      await expect.poll(() => page.locator("#signup").evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === "running" || animation.pending).length)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("keeps the form while sending and prevents duplicate submissions", async ({ page }) => {
    let finishRequest;
    let calls = 0;
    const responseReady = new Promise(resolve => { finishRequest = resolve; });
    await page.route("**/api/subscribe", async route => {
      calls++;
      await responseReady;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await page.goto("/");
    await page.fill("#email", "walker@example.com");
    await page.getByRole("button", { name: "Email me updates" }).click();
    await expect(page.locator("#signupForm")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#signupForm button")).toBeDisabled();
    await expect(page.locator("#signupConfirmation")).toBeHidden();
    await page.locator("#signupForm").evaluate(form => form.requestSubmit());
    expect(calls).toBe(1);
    finishRequest();
    await expect(page.locator("#signupConfirmation")).toBeVisible();
  });

  test("keeps the form available after a network error and allows a retry", async ({ page }) => {
    await page.route("**/api/subscribe", route => route.abort());
    await page.goto("/");
    await page.fill("#email", "walker@example.com");
    await page.getByRole("button", { name: "Email me updates" }).click();
    await expect(page.locator("#formMsg")).toContainText("Couldn't reach the server");
    await expect(page.locator("#signupForm")).toBeVisible();
    await expect(page.locator("#email")).toHaveValue("walker@example.com");
    await expect(page.locator("#signupForm button")).toBeEnabled();
    await expect(page.locator("#signupForm")).not.toHaveAttribute("aria-busy", "true");
    await page.route("**/api/subscribe", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
    await page.getByRole("button", { name: "Email me updates" }).click();
    await expect(page.locator("#signupConfirmation")).toBeVisible();
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
    await page.click("#signupForm button[type=submit]");

    await expect(page.locator("#formMsg")).toContainText(/temporarily unavailable/i);
  });
});

test.describe("the app's own URL", () => {
  test("serves the map at /nearby", async ({ page }) => {
    await page.goto("/nearby");
    await expect(page.locator("#mapCanvas")).toBeAttached();
  });

  test("/app redirects to /nearby, the app's new entry point", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/nearby$/);
    await expect(page.locator("#mapCanvas")).toBeAttached();
  });
});

for (const [label, url] of [["homepage", "/"], ["ledger", "/reports/epping-forest-ledger-2026-10-10.html"]]) {
  for (const [screen, width, deviceScaleFactor, candidate] of [["phone", 390, 1, 480], ["retina desktop", 1280, 2, 960]]) {
    test(`${label} downloads one appropriately sized cow photo on ${screen}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor });
      const page = await context.newPage();
      const photos = [];
      page.on("request", request => {
        if (/epping-longhorns.*\.(jpg|webp)$/.test(request.url())) photos.push(request.url());
      });
      await page.goto(url);
      const photo = page.locator(".hero-photo img");
      await expect(photo).toBeVisible();
      await expect.poll(() => photo.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      expect(await photo.evaluate(img => img.currentSrc)).toContain(`epping-longhorns-${candidate}.webp`);
      expect(photos).toHaveLength(1);
      const bytes = await page.evaluate(url => performance.getEntriesByName(url)[0].encodedBodySize, photos[0]);
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThan(200_000);
      await expect(photo).toHaveAttribute("src", /epping-longhorns\.jpg$/);
      // The picture wrapper must preserve the existing full-width crop.
      expect(await photo.evaluate(img => Math.abs(img.getBoundingClientRect().width - img.closest("figure").getBoundingClientRect().width))).toBeLessThan(1);
      await context.close();
    });
  }
}
