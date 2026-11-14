// The "Help check this tree/place" card follows the walker: quiet while far away, a full card when
// approaching, and promoted to the top of the detail when they are really at it, with a pointer
// always left in the slot it moved from (spec/spec-community.md, "Check card by proximity").
// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE, waitForFrames, waitForUiToSettle } = require("./helpers");

const OVERLAY_URL = "**/api/community/overlay";
const REPORT_URL = "**/api/community/report";
const ISSUE_URL = "**/.netlify/functions/report-missing-data";
const METRES_PER_DEGREE = 111320;
const TREE_HASH = `/nearby#tree=${FIXTURE_TREE.hashKey}`;

const CARD = "#inspectorBody .community-check";
const TOP_CARD = '#inspectorBody [data-community-slot="top"] .community-check';
const USUAL_CARD = '#inspectorBody [data-community-slot="usual"] .community-check';
const POINTER = "#inspectorBody .detail-top-actions .community-check-pointer";
const PLACEHOLDER = '#inspectorBody [data-community-slot="usual"] .community-placeholder-btn';

test.beforeEach(async ({ page }) => {
  await page.route(OVERLAY_URL, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) }));
  await page.route(REPORT_URL, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.route(ISSUE_URL, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
});

// Puts the walker `metres` due north of the open location and waits for the app to take the fix.
async function walkTo(page, context, metres, accuracy = 5) {
  const spot = await page.evaluate(([m, acc]) => ({
    latitude: state.selected.item.latitude + m / 111320,
    longitude: state.selected.item.longitude,
    accuracy: acc,
  }), [metres, accuracy]);
  await context.setGeolocation(spot);
  // The fix itself: the You marker eases toward it, so userLocation may still be on its way.
  await page.waitForFunction((s) => state.rawUserLocation && Math.abs(state.rawUserLocation.latitude - s.latitude) < 1e-6 && state.userLocation.accuracy === s.accuracy, spot);
}

async function tierOf(page) {
  return page.locator(CARD).getAttribute("data-tier");
}

async function openPlace(page) {
  await page.click("#searchToggle");
  await page.fill("#mapSearchInput", "Railway Bell");
  await page.locator("#mapSearchResults .nearest-item").first().click();
  await expect(page.locator(CARD)).toHaveCount(1);
}

test.describe("Check card with no location", () => {
  test.use({ geolocation: undefined, permissions: [] });

  test("the tree check is one quiet row above Nearest, and the top pointer takes the user to its Verify button", async ({ page }) => {
    await setup(page, TREE_HASH);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "far");
    const toggle = card.locator(".community-quiet-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toContainText("Help check this tree");
    await expect(toggle).toContainText("Turn on location to earn points");
    await expect(toggle).not.toContainText(/verify on the spot|walk up to it/i);
    await expect(card.locator(".community-verify")).toBeHidden();
    const nearest = page.locator('h3.detail-section-heading:has-text("Nearest")');
    expect((await toggle.boundingBox()).y).toBeLessThan((await nearest.boundingBox()).y);

    // The pointer in the top row is always there while the card is lower down.
    const pointer = page.locator(POINTER);
    await expect(pointer).toBeVisible();
    await expect(pointer).toHaveAccessibleName(/check this tree/i);
    await page.locator(".inspector-scroll").evaluate((el) => { el.scrollTop = 0; });
    await pointer.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const verify = card.locator(".community-verify");
    await expect(verify).toBeVisible();
    await expect(verify).toBeFocused();
    await waitForUiToSettle(page);
    const view = await page.locator(".inspector-scroll").boundingBox();
    const box = await verify.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(view.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(view.y + view.height + 1);

    // Verifying from there still works, and the pointers go away once it is answered.
    await verify.click();
    await expect(card.locator(".community-mine")).toContainText("You reported: Verified here");
    await expect(pointer).toBeHidden();
    await expect(card).not.toHaveAttribute("data-tier", /.+/);
  });

  test("the quiet row folds and unfolds, and stays as the user left it when the page refreshes underneath", async ({ page }) => {
    await setup(page, TREE_HASH);
    const card = page.locator(CARD);
    const toggle = card.locator(".community-quiet-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".community-verify")).toBeVisible();
    await expect(card.locator(".community-range")).toContainText("You'll get 0 points from this check");
    await page.evaluate(() => {
      const data = { generatedAt: Date.now(), entries: {} };
      navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "COMMUNITY_UPDATED", data } }));
    });
    await expect(card.locator(".community-verify")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(card.locator(".community-verify")).toBeHidden();
  });

  test("at 320 px wide the pointer sits in the top row without crowding or wrapping it", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await setup(page, TREE_HASH);
    const pointer = page.locator(POINTER);
    await expect(pointer).toBeVisible();
    const row = await page.locator("#inspectorBody .detail-top-row").boundingBox();
    const p = await pointer.boundingBox();
    expect(p.width).toBeGreaterThanOrEqual(36);
    expect(p.height).toBeGreaterThanOrEqual(36);
    expect(p.x).toBeGreaterThanOrEqual(row.x);
    expect(p.y + p.height).toBeLessThanOrEqual(row.y + row.height + 1);
    const neighbours = await page.locator("#inspectorBody .detail-top-actions > *:visible").evaluateAll((els) =>
      els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top }; }));
    for (let i = 1; i < neighbours.length; i += 1) {
      expect(neighbours[i].left).toBeGreaterThanOrEqual(neighbours[i - 1].right - 0.5);
      expect(Math.abs(neighbours[i].top - neighbours[0].top)).toBeLessThan(6);
    }
  });
});

test.describe("Check card while walking up to a tree", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 5 }, permissions: ["geolocation"] });
  // The suite default is reduced motion; the animated paths (slide, fade, hint) are what is under test here.
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "no-preference" }); });

  test("far, approaching and near: the card wakes up, moves to the top, and leaves a pointer where it was", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "far");
    await expect(card.locator(".community-quiet-toggle")).toContainText(/\d+(\.\d)? (m|km) away/);
    await expect(card.locator(".community-quiet-toggle")).toContainText("points need you within 10 m");
    await expect(card.locator(".community-quiet-toggle")).not.toContainText(/walk up to it/i);

    await walkTo(page, context, 120);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await expect(page.locator(USUAL_CARD)).toHaveCount(1);
    await expect(card.locator(".community-verify")).toBeVisible();
    await expect(card.locator("[data-community-distance]:visible")).toContainText(/1[12]\d m away \u00b7 get within 10 m for the point/);
    await expect(card.locator("[data-community-distance]:visible")).toHaveCount(1);
    await expect(page.locator(POINTER)).toBeVisible();
    await expect(card.locator(".community-verify-hint")).toHaveCount(0);

    // The distance updates in place on the next fix, without re-creating the card.
    await page.evaluate(() => { document.querySelector("#inspectorBody .community-check").dataset.probe = "same-node"; });
    await walkTo(page, context, 90);
    await expect(card.locator("[data-community-distance]:visible")).toContainText(/(8|9)\d m away/);
    await expect(card).toHaveAttribute("data-probe", "same-node");

    await walkTo(page, context, 5);
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
    await expect(card.locator(".community-here-cue")).toBeVisible();
    await expect(page.locator(POINTER)).toBeHidden();
    await expect(page.locator(PLACEHOLDER)).toBeVisible();
    // The usual slot keeps the normal call to action, as a plain button pointing up at the card.
    await expect(page.locator(PLACEHOLDER).locator(".community-quiet-title")).toHaveText("Help check this tree");
    await expect(page.locator(PLACEHOLDER).locator("small")).toHaveText("You're at the tree");
    await expect(page.locator(PLACEHOLDER)).not.toHaveAttribute("aria-expanded", /.*/);
    await expect(page.locator(PLACEHOLDER)).toHaveAccessibleName(/Help check this tree\s*You're at the tree/);
    await expect(page.locator(PLACEHOLDER)).not.toContainText("moved to the top");
    await expect(card.locator(".community-here-cue")).toHaveText("You're at the tree");
    await expect(page.locator("#communityAnnounce")).toContainText("You're at this tree. You can verify it now.");
    await waitForUiToSettle(page);
    const topRow = await page.locator("#inspectorBody .detail-top-row").boundingBox();
    const box = await card.boundingBox();
    const nearest = await page.locator('h3.detail-section-heading:has-text("Nearest")').boundingBox();
    const placeholder = await page.locator(PLACEHOLDER).boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(topRow.y + topRow.height - 1);
    expect(box.y + box.height).toBeLessThan(placeholder.y);
    expect(placeholder.y).toBeLessThan(nearest.y);

    // The placeholder takes the user to the card and puts them on Verify.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.locator(PLACEHOLDER).click();
    await expect(card.locator(".community-verify")).toBeFocused();
    await expect(card.locator(".community-verify")).toBeInViewport();
  });

  test("jitter inside the hysteresis band never moves the card, and walking away puts it back with its pointer", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    const card = page.locator(CARD);
    await walkTo(page, context, 5);
    await expect(card).toHaveAttribute("data-tier", "near");
    for (const metres of [12, 17, 9, 16]) {
      await walkTo(page, context, metres);
      await waitForFrames(page, 10);
      await expect(card).toHaveAttribute("data-tier", "near");
      await expect(page.locator(TOP_CARD)).toHaveCount(1);
    }
    await walkTo(page, context, 25);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await expect(page.locator(USUAL_CARD)).toHaveCount(1);
    await expect(page.locator(PLACEHOLDER)).toBeHidden();
    await expect(page.locator(POINTER)).toBeVisible();

    // Approaching holds until 180 m, then the card goes quiet and only wakes again inside 150 m.
    await walkTo(page, context, 170);
    await waitForFrames(page, 10);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await walkTo(page, context, 200);
    await expect(card).toHaveAttribute("data-tier", "far");
    await walkTo(page, context, 165);
    await waitForFrames(page, 10);
    await expect(card).toHaveAttribute("data-tier", "far");
    await walkTo(page, context, 140);
    await expect(card).toHaveAttribute("data-tier", "approaching");
  });

  test("a card that opens while the user is already at the tree is at the top straight away, with no movement", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 4);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    const opened = await page.evaluate(() => {
      showTreeDetails(state.selected.item, 4, "Tree record");
      const section = document.querySelector("#inspectorBody .community-check");
      return {
        tier: section.dataset.tier,
        slot: section.parentElement.dataset.communitySlot,
        animations: section.getAnimations({ subtree: true }).length,
      };
    });
    expect(opened).toEqual({ tier: "near", slot: "top", animations: 0 });
  });

  test("the card stays put while the alternatives are open or focus is inside it, and moves once it is idle", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    const card = page.locator(CARD);
    await walkTo(page, context, 100);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await card.locator(".community-more").click();
    await expect(card.locator(".community-choices")).toBeVisible();
    await walkTo(page, context, 4);
    await waitForFrames(page, 20);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await expect(page.locator(USUAL_CARD)).toHaveCount(1);
    await expect(card.locator(".community-choices")).toBeVisible();

    // Folding the alternatives is not enough: the button is still focused.
    await card.locator(".community-more").click();
    await expect(card.locator(".community-choices")).toBeHidden();
    await waitForFrames(page, 20);
    await expect(card).toHaveAttribute("data-tier", "approaching");

    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
  });

  test("a tier change keeps focus where it was and never steals it", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 100);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "approaching");
    await page.locator("#inspectorBody .detail-map-link--icon").first().focus();
    await walkTo(page, context, 4);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    await expect(page.locator("#inspectorBody .detail-map-link--icon").first()).toBeFocused();
  });

  test("an answered check keeps its usual place and has no pointers however close the user is", async ({ page, context }) => {
    await page.addInitScript((target) => {
      localStorage.setItem("ff-community-local-v1", JSON.stringify({ [target]: { id: "seeded-report-id", status: "VERIFIED", ts: Date.now() } }));
    }, `tree:${FIXTURE_TREE.recordNumber}`);
    await setup(page, TREE_HASH);
    const card = page.locator(CARD);
    await expect(card.locator(".community-mine")).toContainText("You reported: Verified here");
    await walkTo(page, context, 3);
    await waitForFrames(page, 20);
    await expect(card).not.toHaveAttribute("data-tier", /.+/);
    await expect(page.locator(USUAL_CARD)).toHaveCount(1);
    await expect(page.locator(POINTER)).toBeHidden();
    await expect(page.locator(PLACEHOLDER)).toBeHidden();
    await expect(card.locator(".community-quiet-toggle")).toBeHidden();
  });

  test("verifying at the tree leaves the answered summary at the top and removes the pointers; the next render puts it in its usual place", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 4);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "near");
    await page.evaluate(() => { document.querySelector("#inspectorBody .community-check").dataset.probe = "same-node"; });
    await card.locator(".community-verify").click();
    await expect(card.locator(".community-mine")).toContainText("You reported: Verified here");
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
    await expect(card).toHaveAttribute("data-probe", "same-node");
    await expect(card).not.toHaveAttribute("data-tier", /.+/);
    await expect(page.locator(PLACEHOLDER)).toBeHidden();
    await expect(page.locator(POINTER)).toBeHidden();
    await waitForUiToSettle(page);
    // The placeholder is gone without leaving a gap, and later fixes do not move the summary.
    expect((await page.locator('#inspectorBody [data-community-slot="usual"]').boundingBox()).height).toBeLessThan(1);
    await walkTo(page, context, 30);
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
    // Rendering the detail again is the only thing that puts it in the usual slot.
    await page.evaluate(() => showTreeDetails(state.selected.item, 4, "Tree record"));
    await expect(page.locator(USUAL_CARD)).toHaveCount(1);
    await expect(page.locator(TOP_CARD)).toHaveCount(0);
  });

  test("the subtle hint plays on Verify only when the user is at the tree and the button is on screen", async ({ page, context }) => {
    // A short window, so the detail's scroll range is large enough that scrolled to the bottom the promoted
    // Verify is truly out of the panel's view (the check below proves it rather than assuming it).
    await page.setViewportSize({ width: page.viewportSize().width, height: 680 });
    await setup(page, TREE_HASH);
    const scroller = page.locator(".inspector-scroll");
    await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(40);
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await walkTo(page, context, 5);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    await waitForUiToSettle(page);
    // Promoted to the top while the panel is scrolled down: Verify is off screen, so nothing plays.
    await waitForFrames(page, 20);
    const verify = page.locator(`${CARD} .community-verify`);
    await expect.poll(() => verify.evaluate((el) => {
      const view = el.closest(".inspector-scroll").getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return Math.max(0, Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top)) / box.height;
    })).toBeLessThan(0.6);
    await expect(verify).not.toHaveAttribute("data-hint-plays", /[1-9]/);
    await expect(page.locator(".community-verify-hint")).toHaveCount(0);
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await expect(page.locator(`${CARD} .community-verify`)).toHaveClass(/community-verify-hint/);
    // It is a cue, not a loop: it rests again by itself.
    await expect(page.locator(".community-verify-hint")).toHaveCount(0);
  });

  test("focus a tap left inside the card is still there after the card moves to the top", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 100);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await page.clock.install({ time: Date.now() });
    await card.locator(".community-more").click();
    await card.locator(".community-more").click();
    await page.evaluate(() => { document.activeElement.dataset.probe = "tapped"; });
    await walkTo(page, context, 4);
    await page.clock.fastForward(11000);
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
    await expect(page.locator(`${TOP_CARD} [data-probe="tapped"]`)).toBeFocused();
  });

  test("pressing Change from the keyboard keeps focus inside the card", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 5);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "near");
    await card.locator(".community-verify").focus();
    await page.keyboard.press("Enter");
    await expect(card.locator("[data-action='community-change']")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(card.locator(".is-chosen")).toBeFocused();
  });

  test("a reader at the top stays at the top when the card is promoted and put back", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    const scroller = page.locator(".inspector-scroll");
    await walkTo(page, context, 100);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "approaching");
    await waitForUiToSettle(page);
    await walkTo(page, context, 4);
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
    await waitForUiToSettle(page);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
    const view = await scroller.boundingBox();
    const topRow = await page.locator("#inspectorBody .detail-top-row").boundingBox();
    const box = await page.locator(CARD).boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(topRow.y + topRow.height - 1);
    expect(box.y).toBeLessThan(view.y + view.height);
    await walkTo(page, context, 200);
    await expect(page.locator(USUAL_CARD)).toHaveCount(1);
    await waitForUiToSettle(page);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  });

  test("the slide ghost is inert: its card keeps its tier and slot, gets no hint, and no arrival is announced", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 100);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "approaching");
    const log = await page.evaluate(async () => {
      const out = { ghostSeen: false, mutations: [], hint: false, announced: [], scroll: [] };
      const watch = (node) => node.closest && node.closest(".inspector-screen-ghost");
      new MutationObserver((records) => records.forEach((r) => {
        if (watch(r.target)) out.mutations.push(`${r.type}:${r.attributeName || ""}`);
      })).observe(document.getElementById("inspector"), { subtree: true, attributes: true, childList: true });
      const announcer = document.getElementById("communityAnnounce");
      new MutationObserver(() => { if (announcer.textContent) out.announced.push(announcer.textContent); })
        .observe(announcer, { childList: true, characterData: true, subtree: true });
      const tree = state.selected.item;
      document.getElementById("inspectorBack").click();
      const ghost = document.querySelector(".inspector-screen-ghost");
      out.ghostSeen = Boolean(ghost);
      const baseline = out.mutations.length; // the ghost's own insertion is not a change to its card
      const here = { latitude: tree.latitude + 4 / 111320, longitude: tree.longitude, accuracy: 5 };
      state.userLocation = { ...here }; state.rawUserLocation = { ...here }; state.locationGlide = null;
      communityNudgeCheck();
      await new Promise((resolve) => {
        const tick = () => {
          const scroller = document.querySelector(".inspector-scroll");
          out.scroll.push(scroller.scrollTop);
          if (ghost && ghost.querySelector(".community-verify-hint")) out.hint = true;
          if (document.querySelector(".inspector-screen-ghost")) requestAnimationFrame(tick); else resolve();
        };
        tick();
      });
      out.ghostTier = ghost && ghost.querySelector(".community-check").dataset.tier;
      out.ghostSlot = ghost && ghost.querySelector(".community-check").parentElement.dataset.communitySlot;
      out.changed = out.mutations.slice(baseline);
      return out;
    });
    expect(log.ghostSeen).toBe(true);
    expect(log.ghostTier).toBe("approaching");
    expect(log.ghostSlot).toBe("usual");
    expect(log.changed).toEqual([]);
    expect(log.hint).toBe(false);
    expect(log.announced).toEqual([]);
    expect(log.scroll.every((top) => top === 0)).toBe(true);
  });

  test("a tier change that lands during the screen slide waits for it, then ends right with scrollTop 0 throughout", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 400);
    await page.click("#inspectorBack");
    await page.waitForFunction(() => !state.selected && !document.querySelector(".inspector-screen-ghost"));
    const log = await page.evaluate(async () => {
      const out = { during: null, scroll: [] };
      // The click runs the slide: the new screen is in place and the ghost still sliding out.
      document.querySelector('#inspectorBody .nearest-item[data-overview-type="tree"]').click();
      const item = state.selected.item;
      out.initial = document.querySelector("#inspectorBody .community-check").dataset.tier;
      const here = { latitude: item.latitude + 4 / 111320, longitude: item.longitude, accuracy: 5 };
      state.userLocation = { ...here }; state.rawUserLocation = { ...here }; state.locationGlide = null;
      communityNudgeCheck();
      out.during = document.querySelector("#inspectorBody .community-check").dataset.tier;
      out.slideSeen = Boolean(document.querySelector(".inspector-screen-ghost"));
      await new Promise((resolve) => {
        const tick = () => {
          out.scroll.push(document.querySelector(".inspector-scroll").scrollTop);
          if (document.querySelector(".inspector-screen-ghost")) requestAnimationFrame(tick); else resolve();
        };
        tick();
      });
      return out;
    });
    expect(log.slideSeen).toBe(true);
    expect(log.initial).not.toBe("near");
    expect(log.during).toBe(log.initial);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    expect(log.scroll.every((top) => top === 0)).toBe(true);
    expect(await page.locator(".inspector-scroll").evaluate((el) => el.scrollTop)).toBe(0);
  });
});

test.describe("Check card with reduced motion", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 5 }, permissions: ["geolocation"] });

  test("it swaps to the top at once, with no animation and no pulsing hint", async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page, TREE_HASH);
    await walkTo(page, context, 120);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "approaching");
    await walkTo(page, context, 4);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    const state = await page.evaluate(() => {
      const section = document.querySelector("#inspectorBody .community-check");
      return {
        slot: section.parentElement.dataset.communitySlot,
        animations: [...document.querySelectorAll('#inspectorBody .community-slot, #inspectorBody .community-check, #inspectorBody .community-pointer-slot')]
          .flatMap((el) => el.getAnimations({ subtree: true })).filter((a) => a.playState === "running").length,
      };
    });
    expect(state).toEqual({ slot: "top", animations: 0 });
    await waitForFrames(page, 60);
    await expect(page.locator(".community-verify-hint")).toHaveCount(0);
    await expect(page.locator(`${CARD} .community-verify`)).toBeVisible();
  });
});

test.describe("Place check by proximity", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 5 }, permissions: ["geolocation"] });
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "no-preference" }); });

  test("a place is quiet, then promoted inside its 40 m zone, and confirming still works", async ({ page, context }) => {
    const sent = [];
    await page.route(ISSUE_URL, (route) => { sent.push("issue"); route.fulfill({ status: 200, body: "{}" }); });
    await setup(page);
    await openPlace(page);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "far");
    await expect(card.locator(".community-quiet-toggle")).toContainText("Help check this place");
    await expect(card.locator(".community-quiet-toggle")).toContainText(/\d+(\.\d)? (m|km) away \u00b7 confirm it when you visit/);
    await expect(card.locator(".community-quiet-toggle")).not.toContainText(/point/i);
    await expect(page.locator(POINTER)).toBeVisible();
    await expect(page.locator(POINTER)).toHaveAccessibleName(/check this place/i);

    await walkTo(page, context, 100);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await expect(card.locator("[data-community-distance]:visible")).toContainText(/^\d+ m away$/);
    await expect(card.locator("[data-community-distance]:visible")).not.toContainText(/point|10 m/i);
    await expect(card.locator("[data-action='community-place-choose'][data-status='OPEN_CONFIRMED']")).toBeVisible();

    // 30 m is outside a tree's 10 m zone but inside a place's 40 m one.
    await walkTo(page, context, 30);
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(page.locator('#inspectorBody [data-community-slot="top"] .community-check')).toHaveCount(1);
    await expect(page.locator(PLACEHOLDER)).toBeVisible();
    await expect(page.locator("#communityAnnounce")).toContainText("You're at this place. You can confirm it now.");
    await expect(card.locator(".community-here-cue")).toHaveText("You're at the place");
    await expect(page.locator(PLACEHOLDER).locator(".community-quiet-title")).toHaveText("Help check this place");
    await expect(page.locator(PLACEHOLDER).locator("small")).toHaveText("You're at the place");
    await expect(page.locator(PLACEHOLDER)).not.toHaveAttribute("aria-expanded", /.*/);
    await walkTo(page, context, 46);
    await waitForFrames(page, 10);
    await expect(card).toHaveAttribute("data-tier", "near");
    await walkTo(page, context, 55);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await expect(page.locator('#inspectorBody [data-community-slot="usual"] .community-check')).toHaveCount(1);
    await expect(page.locator(POINTER)).toBeVisible();

    await walkTo(page, context, 20);
    await expect(card).toHaveAttribute("data-tier", "near");
    await page.locator(PLACEHOLDER).click();
    await expect(card.locator(".community-verify")).toBeFocused();
    await card.locator(".community-verify").click();
    await expect(card.locator(".community-mine")).toContainText("You reported: Confirmed still right");
    await expect(page.locator('#inspectorBody [data-community-slot="top"] .community-check')).toHaveCount(1);
    await expect(page.locator(PLACEHOLDER)).toBeHidden();
    await expect(page.locator(POINTER)).toBeHidden();
    await expect(page.locator(".detail-top-row .community-verified-chip")).toContainText("1");
    await waitForFrames(page, 20);
    expect(sent).toHaveLength(0);
  });
});

// --- Repair round: accuracy, focus, announcements, reduced motion, layout ---

test.describe("Check card with no location (places)", () => {
  test.use({ geolocation: undefined, permissions: [] });

  test("a place with no location says how to see the distance, not that it needs location to verify", async ({ page }) => {
    await setup(page);
    await openPlace(page);
    const toggle = page.locator(CARD).locator(".community-quiet-toggle");
    await expect(toggle).toContainText("Turn on location to see how far it is");
    await expect(toggle).not.toContainText(/verify on the spot|walk up to it|point/i);
  });
});

test.describe("Check card accuracy, focus and announcements", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 5 }, permissions: ["geolocation"] });
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "no-preference" }); });

  test("a poor fix inside the zone is capped at approaching, and a card already near stays near when accuracy degrades", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    const card = page.locator(CARD);
    await page.evaluate(() => {
      window.__announced = [];
      new MutationObserver(() => { const t = document.getElementById("communityAnnounce").textContent; if (t) window.__announced.push(t); })
        .observe(document.getElementById("communityAnnounce"), { childList: true, characterData: true, subtree: true });
    });
    await walkTo(page, context, 5, 500);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await waitForFrames(page, 20);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await expect(page.locator(USUAL_CARD)).toHaveCount(1);
    await expect(card.locator(".community-here-cue")).toBeHidden();
    expect(await page.evaluate(() => window.__announced)).toEqual([]);

    await walkTo(page, context, 4.5, 5);
    await expect(card).toHaveAttribute("data-tier", "near");
    await walkTo(page, context, 6, 500);
    await waitForFrames(page, 20);
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
  });

  test("the announcement region exists, empty, before the arrival and receives the text once", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await expect(page.locator("#communityAnnounce")).toHaveText("");
    await page.evaluate(() => {
      window.__announced = [];
      new MutationObserver(() => { const t = document.getElementById("communityAnnounce").textContent; if (t) window.__announced.push(t); })
        .observe(document.getElementById("communityAnnounce"), { childList: true, characterData: true, subtree: true });
    });
    await walkTo(page, context, 5);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    await expect.poll(() => page.evaluate(() => window.__announced.length)).toBe(1);
    await walkTo(page, context, 6);
    await walkTo(page, context, 4);
    await waitForFrames(page, 30);
    expect(await page.evaluate(() => window.__announced)).toEqual(["You're at this tree. You can verify it now."]);
  });

  test("keyboard-only verify at the tree puts focus on Change, leaves the card at the top and announces the save once", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 5);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
    await page.evaluate(() => {
      window.__announced = [];
      new MutationObserver(() => { const t = document.getElementById("communityAnnounce").textContent; if (t) window.__announced.push(t); })
        .observe(document.getElementById("communityAnnounce"), { childList: true, characterData: true, subtree: true });
    });
    await card.locator(".community-verify").focus();
    await page.keyboard.press("Enter");
    await expect(card.locator(".community-mine")).toContainText("You reported: Verified here");
    await expect(card.locator("[data-action='community-change']")).toBeFocused();
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
    await waitForFrames(page, 20);
    expect(await page.evaluate(() => window.__announced.filter((t) => /Saved/.test(t)))).toHaveLength(1);
    await expect(page.locator("#communityAnnounce")).toContainText(/Saved.*Verified here/);
  });

  test("a pointer that has keyboard focus is never hidden under the user", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 100);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await page.locator(POINTER).focus();
    await walkTo(page, context, 5);
    await waitForFrames(page, 20);
    const active = await page.evaluate(() => document.activeElement && (document.activeElement.className || document.activeElement.tagName));
    expect(active).not.toBe("BODY");
    await expect(page.locator(POINTER)).toBeFocused();
    await expect(card).toHaveAttribute("data-tier", "approaching");
    // Moving on is what lets it promote, and focus is still somewhere sensible.
    await page.keyboard.press("Tab");
    await expect(card).toHaveAttribute("data-tier", "near");
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  });

  test("activating the pointer from the keyboard puts focus on Verify, even on a folded far card", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "far");
    await expect(card.locator(".community-verify")).toBeHidden();
    await page.locator(POINTER).focus();
    await page.keyboard.press("Enter");
    await expect(card.locator(".community-verify")).toBeVisible();
    await expect(card.locator(".community-verify")).toBeFocused();
  });

  test("focus a tap left on a button stops holding the card once the card has been untouched for a while, but real use still holds it", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 100);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await page.clock.install({ time: Date.now() });
    // A tap on the alternatives toggle and on it again leaves focus on it, with nothing in progress.
    await card.locator(".community-more").click();
    await card.locator(".community-more").click();
    await walkTo(page, context, 4);
    await page.clock.fastForward(3000);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await page.clock.fastForward(8000);
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
  });

  test("an open set of alternatives holds the card however long it is left", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 100);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await page.clock.install({ time: Date.now() });
    await card.locator(".community-more").click();
    await walkTo(page, context, 4);
    await page.clock.fastForward(30000);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await expect(card.locator(".community-choices")).toBeVisible();
  });

  test("a COMMUNITY_UPDATED refresh while at the tree keeps the card at the top, unfolded and in its tier", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 4);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "near");
    await page.evaluate(() => {
      document.querySelector("#inspectorBody .community-check").dataset.probe = "same-node";
      const data = { generatedAt: Date.now(), entries: { "tree:17338": { s: "verified", n: 3 } } };
      navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "COMMUNITY_UPDATED", data } }));
    });
    await expect(page.locator(".detail-top-row .community-verified-chip")).toContainText("3");
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(card).toHaveAttribute("data-probe", "same-node");
    await expect(page.locator(TOP_CARD)).toHaveCount(1);
    await expect(card.locator(".community-verify")).toBeVisible();
    await expect(page.locator(PLACEHOLDER)).toBeVisible();
  });

  test("a place note step while promoted: the card stays at the top on fixes while the note is pending, and sending shows the summary", async ({ page, context }) => {
    const sent = [];
    await page.route(ISSUE_URL, (route) => { sent.push(route.request().postDataJSON()); route.fulfill({ status: 200, body: "{}" }); });
    await setup(page);
    await openPlace(page);
    const card = page.locator(CARD);
    await walkTo(page, context, 20);
    await expect(card).toHaveAttribute("data-tier", "near");
    await card.locator(".community-more").click();
    await card.locator("[data-action='community-place-choose'][data-status='CLOSED']").click();
    await expect(card.locator(".community-note-input")).toBeVisible();
    await walkTo(page, context, 120);
    await walkTo(page, context, 300);
    await waitForFrames(page, 20);
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(page.locator('#inspectorBody [data-community-slot="top"] .community-check')).toHaveCount(1);
    await card.locator(".community-note-input").fill("It has closed down");
    await card.locator("[data-action='community-send-place']").click();
    await expect(card.locator(".community-mine")).toContainText("You reported");
    await expect(page.locator('#inspectorBody [data-community-slot="top"] .community-check')).toHaveCount(1);
    await expect(card.locator("[data-action='community-change']")).toBeFocused();
    await expect.poll(() => sent.length).toBeGreaterThan(0);
  });

  test("the placeholder's focus ring is inside its clip", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 5);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    await waitForUiToSettle(page);
    await page.locator(PLACEHOLDER).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator(PLACEHOLDER)).toBeFocused();
    const ring = await page.locator(PLACEHOLDER).evaluate((btn) => {
      const cs = getComputedStyle(btn);
      const r = btn.getBoundingClientRect();
      const inner = btn.closest(".community-placeholder-inner").getBoundingClientRect();
      const grow = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth);
      return { style: cs.outlineStyle, bottom: r.bottom + Math.max(grow, 0), clip: inner.bottom, left: r.left - Math.max(grow, 0), clipLeft: inner.left };
    });
    expect(ring.style).not.toBe("none");
    expect(ring.bottom).toBeLessThanOrEqual(ring.clip + 0.5);
    expect(ring.left).toBeGreaterThanOrEqual(ring.clipLeft - 0.5);
  });
});

test.describe("Check card folds without motion for reduced-motion users", () => {
  test.use({ geolocation: undefined, permissions: [] });

  test("toggling the far row has no transition in either direction", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page, TREE_HASH);
    const card = page.locator(CARD);
    const toggle = card.locator(".community-quiet-toggle");
    const durations = () => card.evaluate((el) => {
      const read = (node) => getComputedStyle(node).transitionDuration.split(",").map((d) => d.trim());
      return [...read(el.querySelector(".community-fold")), ...read(el), ...read(el.querySelector(".community-quiet-chevron"))];
    });
    const zero = (list) => list.every((d) => d === "0s");
    expect(zero(await durations())).toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(zero(await durations())).toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(zero(await durations())).toBe(true);
  });
});

// --- Layout at the widths people really have ---

async function geometry(page) {
  return page.evaluate(() => {
    const visible = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0; };
    const row = document.querySelector("#inspectorBody .detail-top-row");
    const panel = document.querySelector(".inspector-scroll");
    const controls = [...row.querySelectorAll("button, a")].filter(visible).map((el) => ({ name: el.className, r: el.getBoundingClientRect() }));
    const overlaps = [];
    for (let i = 0; i < controls.length; i += 1) for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i].r; const b = controls[j].r;
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push([controls[i].name, controls[j].name]);
    }
    const pill = row.querySelector('[data-live-field="distance"]');
    const pillText = pill && [...pill.querySelectorAll("*")].filter((e) => !e.children.length && e.textContent.trim()).map((e) => e.scrollWidth <= e.clientWidth + 1);
    const title = document.querySelector("#inspectorBody .community-check .community-title");
    const cue = document.querySelector("#inspectorBody .community-check .community-here-cue");
    const lineHeight = title ? parseFloat(getComputedStyle(title).lineHeight) || parseFloat(getComputedStyle(title).fontSize) * 1.3 : 0;
    return {
      // Element boxes (not the 4 px invisible hit areas that the map and share buttons carry as ::after).
      rowOverflow: Math.max(0, ...[...row.querySelectorAll("*")].filter(visible).map((el) => el.getBoundingClientRect().right - row.getBoundingClientRect().right)),
      panelOverflow: panel.scrollWidth - panel.clientWidth,
      overlaps,
      pillClipped: pillText ? pillText.includes(false) : false,
      titleLines: title && visible(title) ? Math.round(title.getBoundingClientRect().height / lineHeight) : 0,
      titleOverflow: title && visible(title) ? title.scrollWidth - title.clientWidth : 0,
      cueClipped: cue && visible(cue) ? cue.scrollWidth > cue.clientWidth + 0.5 : false,
      cueVisible: Boolean(cue && visible(cue)),
    };
  });
}

test.describe("Check card layout across phone widths", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 5 }, permissions: ["geolocation"] });

  for (const width of [320, 360, 380, 381, 414]) {
    test(`at ${width} px a tree and a place fit their top row in far and near`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.route(OVERLAY_URL, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: { [`tree:${FIXTURE_TREE.recordNumber}`]: { s: "verified", n: 3 } } }) }));
      await setup(page, TREE_HASH);
      await expect(page.locator(".detail-top-row .community-verified-chip")).toBeVisible();
      const check = async (label, near) => {
        await waitForUiToSettle(page);
        const g = await geometry(page);
        expect(g.rowOverflow, `${label} row overflow`).toBeLessThanOrEqual(0);
        expect(g.panelOverflow, `${label} panel overflow`).toBeLessThanOrEqual(0);
        expect(g.overlaps, `${label} overlapping controls`).toEqual([]);
        expect(g.pillClipped, `${label} distance pill clipped`).toBe(false);
        if (near) {
          expect(g.cueVisible, `${label} cue shown`).toBe(true);
          expect(g.cueClipped, `${label} cue clipped`).toBe(false);
          expect(g.titleOverflow, `${label} title overflow`).toBeLessThanOrEqual(0);
          expect(g.titleLines, `${label} title lines`).toBeLessThanOrEqual(2);
        }
      };
      await check("tree far", false);
      await walkTo(page, context, 5);
      await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
      await check("tree near", true);

      await page.goto("/");
      await setup(page);
      await openPlace(page);
      await check("place far", false);
      await walkTo(page, context, 20);
      await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
      await check("place near", true);
    });
  }

  test("the empty top slot and the hidden placeholder take no room, and a promoted place has the tree's rhythm", async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const heights = () => page.evaluate(() => {
      const h = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().height : -1; };
      const card = document.querySelector("#inspectorBody .community-check").getBoundingClientRect();
      const article = document.querySelector("#inspectorBody .tree-detail, #inspectorBody .place-detail");
      // From the top row's own content (its bottom padding differs between trees and places) to the card.
      const rowContent = [...document.querySelectorAll("#inspectorBody .detail-top-row *")]
        .filter((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden")
        .reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0);
      const before = card.top - rowContent;
      const after = [...article.querySelectorAll(":scope > *, :scope > * > *")]
        .filter((el) => el.getBoundingClientRect().top >= card.bottom - 0.5 && el.getBoundingClientRect().height > 0)
        .reduce((m, el) => Math.min(m, el.getBoundingClientRect().top), Infinity) - card.bottom;
      return { top: h('[data-community-slot="top"]'), placeholder: h(".community-placeholder"), before, after };
    });
    await setup(page, TREE_HASH);
    const treeFar = await heights();
    expect(treeFar.top).toBeLessThanOrEqual(0.5);
    await walkTo(page, context, 5);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    const tree = await heights();
    await walkTo(page, context, 120);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "approaching");
    const treeApproach = await heights();
    expect(treeApproach.placeholder).toBeLessThanOrEqual(0.5);
    expect(treeApproach.top).toBeLessThanOrEqual(0.5);

    await page.goto("/");
    await setup(page);
    await openPlace(page);
    const placeFar = await heights();
    expect(placeFar.top).toBeLessThanOrEqual(0.5);
    await walkTo(page, context, 20);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    const place = await heights();
    await walkTo(page, context, 100);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "approaching");
    const placeApproach = await heights();
    expect(placeApproach.placeholder).toBeLessThanOrEqual(0.5);
    expect(placeApproach.top).toBeLessThanOrEqual(0.5);
    // Space above and below the promoted card is the same as for the tree's, give or take a pixel or two.
    expect(Math.abs(place.before - tree.before), `before ${JSON.stringify({ place, tree })}`).toBeLessThanOrEqual(3);
    expect(place.before).toBeGreaterThanOrEqual(8);
    expect(place.after).toBeGreaterThanOrEqual(8);
  });
});

// --- Polish: the Check chip never costs a line, the near cue is an eyebrow, the answered head settles, nudges yield ---

// Whether the distance pill and every visible action share one line (compared by their vertical centres).
async function topRowOneLine(page) {
  return page.evaluate(() => {
    const row = document.querySelector("#inspectorBody .detail-top-row");
    const visible = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0; };
    const items = [row.querySelector('[data-live-field="distance"]'), ...row.querySelectorAll(".detail-top-actions button, .detail-top-actions a")].filter((el) => el && visible(el));
    const centres = items.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
    const label = row.querySelector(".community-check-pointer-label");
    return { oneLine: Math.max(...centres) - Math.min(...centres) <= 1, count: items.length, labelVisible: Boolean(label && visible(label)) };
  });
}

test.describe("Check chip and near cue layout on phones", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 5 }, permissions: ["geolocation"] });
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

  for (const width of [320, 360, 390, 414]) {
    for (const kind of ["tree", "place"]) {
      test(`at ${width} px the ${kind} Check chip never makes the top row wrap, and shows its label only when it fits`, async ({ page, context }) => {
        await page.setViewportSize({ width, height: 800 });
        if (kind === "tree") await setup(page, TREE_HASH); else { await setup(page); await openPlace(page); }
        for (const [metres, km] of [[2800, true], [275, false]]) {
          await walkTo(page, context, metres);
          await page.waitForFunction((wantKm) => {
            const pill = document.querySelector('#inspectorBody [data-live-field="distance"]');
            return pill && (wantKm ? /km/ : /\d+ m\b/).test(pill.textContent);
          }, km);
          await waitForUiToSettle(page);
          const withChip = await topRowOneLine(page);
          // The same detail with the chip swapped for one more plain 36 px button: what the row does on base.
          await page.evaluate(() => {
            const slot = document.querySelector("#inspectorBody .community-pointer-slot");
            slot.style.display = "none";
            const stand = document.createElement("button");
            stand.id = "standIn"; stand.style.cssText = "width:36px;height:36px;padding:0;border:0";
            slot.before(stand);
          });
          const base = await topRowOneLine(page);
          await page.evaluate(() => {
            document.getElementById("standIn").remove();
            document.querySelector("#inspectorBody .community-pointer-slot").style.display = "";
          });
          const label = `${kind} ${width}px ${km ? "km" : "short"}`;
          if (base.oneLine) expect(withChip.oneLine, `${label}: pill and buttons on one line`).toBe(true);
          if (withChip.labelVisible) expect(withChip.oneLine, `${label}: label only when it fits`).toBe(true);
          if (width === 414 && !km) expect(withChip.labelVisible, `${label}: label shown when it fits`).toBe(true);
          if (width === 320 && km) expect(withChip.labelVisible, `${label}: icon only`).toBe(false);
        }
      });

      if (width >= 360) test(`at ${width} px the ${kind} near cue is an eyebrow above the title and the subtitle stays on one line`, async ({ page, context }) => {
        await page.setViewportSize({ width, height: 800 });
        if (kind === "tree") { await setup(page, TREE_HASH); await walkTo(page, context, 4); }
        else { await setup(page); await openPlace(page); await walkTo(page, context, 20); }
        await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
        await waitForUiToSettle(page);
        const g = await page.evaluate(() => {
          const q = (s) => document.querySelector(`#inspectorBody .community-check ${s}`).getBoundingClientRect();
          const sub = document.querySelector("#inspectorBody .community-check .community-sub");
          const line = parseFloat(getComputedStyle(sub).lineHeight) || parseFloat(getComputedStyle(sub).fontSize) * 1.4;
          const cue = q(".community-here-cue"); const title = q(".community-title");
          return { cueBottom: cue.bottom, titleTop: title.top, cueLeft: cue.left, titleLeft: title.left, subLines: Math.round(sub.getBoundingClientRect().height / line) };
        });
        expect(g.subLines).toBe(1);
        expect(g.cueBottom).toBeLessThanOrEqual(g.titleTop + 0.5);
        expect(Math.abs(g.cueLeft - g.titleLeft)).toBeLessThanOrEqual(1);
      });
    }
  }

  test("answering at the tree leaves no head or cue behind: the summary is the card's only content once motion ends", async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, TREE_HASH);
    await walkTo(page, context, 4);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    await page.locator(CARD).locator(".community-verify").click();
    await expect(page.locator(CARD).locator(".community-mine")).toContainText("You reported: Verified here");
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const g = await page.evaluate(() => {
      const card = document.querySelector("#inspectorBody .community-check");
      const shown = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== "none" && cs.visibility !== "hidden" && r.height > 0; };
      return {
        head: card.querySelector(".community-head").getBoundingClientRect().height,
        cue: card.querySelector(".community-here-cue").getBoundingClientRect().height,
        headShown: shown(card.querySelector(".community-head")),
        quietShown: shown(card.querySelector(".community-quiet-toggle")),
        summaryShown: shown(card.querySelector(".community-mine")),
        title: card.querySelector(".community-title").getBoundingClientRect().height,
      };
    });
    expect(g.head).toBeLessThanOrEqual(0.5);
    expect(g.cue).toBeLessThanOrEqual(0.5);
    expect(g.headShown).toBe(false);
    expect(g.quietShown).toBe(false);
    expect(g.summaryShown).toBe(true);
  });

  test("a nudge about the tree whose check card is near is dismissed; a nudge about another tree stays", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 120);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "approaching");
    await page.evaluate(() => communityNudgeShow(state.selected.item, 100));
    await expect(page.locator("#communityNudge")).toHaveCount(1);
    await walkTo(page, context, 4);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    await expect(page.locator("#communityNudge")).toHaveCount(0);
    // Another tree's nudge is not redundant with this card.
    await page.evaluate(() => {
      const other = state.trees.find((tree) => tree !== state.selected.item && communityTreeTarget(tree) !== communityTreeTarget(state.selected.item));
      communityNudgeShow(other, 100);
      communityUpdatePresentation();
    });
    await expect(page.locator("#communityNudge")).toHaveCount(1);
    // And the same tree's nudge, shown while the card is already near, goes on the next presentation.
    await page.evaluate(() => { communityNudgeShow(state.selected.item, 100); communityUpdatePresentation(); });
    await expect(page.locator("#communityNudge")).toHaveCount(0);
  });
});

// --- One cue at a time on the tree's own page: the nudge pulse takes the slot, the Verify ring waits ---

test.describe("Nudge pulse and Verify ring never stack", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 5 }, permissions: ["geolocation"] });

  // The fixture tree has a neighbour a few metres away, so say plainly that this tree is the one being stood next to.
  async function installNudgeHere(page) {
    await page.evaluate(() => {
      window.nudgeHere = () => {
        state.nearestTree = { tree: state.selected.item, metres: 5 };
        communityNudgeCheck();
      };
    });
  }

  test("a nudge check that lands while the screen is still sliding in still pulses the card once it has settled", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, "/nearby");
    await page.waitForFunction(() => state.userLocation && !state.userLocation.isDefault && state.trees.length > 0);
    await installNudgeHere(page);
    await page.evaluate(() => localStorage.removeItem("ff-community-nudge-seen-v1"));
    const sliding = await page.evaluate(() => {
      focusOverviewItem("tree", treeHashKey(state.trees[0]));
      nudgeHere();
      return communitySlideActive();
    });
    expect(sliding).toBe(true);
    await expect(page.locator(".community-check.community-nudge-pulse")).toHaveCount(1);
  });

  for (const motion of ["no-preference", "reduce"]) {
    test(`a nudge check on the tree's page pulses the card even while the ring is running, and the ring yields (${motion})`, async ({ page, context }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await setup(page, TREE_HASH);
      await walkTo(page, context, 5);
      await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
      await waitForUiToSettle(page);
      await installNudgeHere(page);
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(motion === "reduce");
      // The ring is mid-play on Verify, and this tree has not been nudged about yet.
      await page.evaluate(() => {
        localStorage.removeItem("ff-community-nudge-seen-v1");
        document.querySelectorAll(".community-nudge-pulse").forEach((el) => el.classList.remove("community-nudge-pulse"));
        document.querySelector("#inspectorBody .community-verify").classList.add("community-verify-hint");
        nudgeHere();
      });
      await expect(page.locator(`${CARD}.community-nudge-pulse`)).toHaveCount(1);
      await expect(page.locator(".community-verify-hint")).toHaveCount(0);
    });

    test(`a second nudge pulse is not cut short by the first one's timer (${motion})`, async ({ page, context }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await setup(page, TREE_HASH);
      await walkTo(page, context, 5);
      await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
      await waitForUiToSettle(page);
      await installNudgeHere(page);
      await page.clock.install();
      await page.evaluate(() => {
        localStorage.removeItem("ff-community-nudge-seen-v1");
        nudgeHere();
      });
      await expect(page.locator(`${CARD}.community-nudge-pulse`)).toHaveCount(1);
      await page.clock.fastForward(2000);
      await page.evaluate(() => { localStorage.removeItem("ff-community-nudge-seen-v1"); nudgeHere(); });
      // The first pulse's 2.6 s are over; the second one's are not.
      await page.clock.fastForward(1000);
      await expect(page.locator(`${CARD}.community-nudge-pulse`)).toHaveCount(1);
      await page.clock.fastForward(2000);
      await expect(page.locator(`${CARD}.community-nudge-pulse`)).toHaveCount(0);
    });
  }
});
