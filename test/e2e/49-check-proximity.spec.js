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
async function walkTo(page, context, metres) {
  const spot = await page.evaluate((m) => ({
    latitude: state.selected.item.latitude + m / 111320,
    longitude: state.selected.item.longitude,
    accuracy: 5,
  }), metres);
  await context.setGeolocation(spot);
  // The fix itself: the You marker eases toward it, so userLocation may still be on its way.
  await page.waitForFunction((s) => state.rawUserLocation && Math.abs(state.rawUserLocation.latitude - s.latitude) < 1e-6, spot);
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
    await expect(toggle).toContainText(/location/i);
    await expect(toggle).toContainText(/verify on the spot/i);
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
    await expect(card.locator(".community-quiet-toggle")).toContainText("walk up to it to verify");

    await walkTo(page, context, 120);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await expect(page.locator(USUAL_CARD)).toHaveCount(1);
    await expect(card.locator(".community-verify")).toBeVisible();
    await expect(card.locator("[data-community-distance]:visible")).toContainText(/1[12]\d m away/);
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
    await expect(page.locator(PLACEHOLDER)).toContainText("check is at the top");
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
    await page.locator(PLACEHOLDER).click();
    await expect(card.locator(".community-verify")).toBeFocused();
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

  test("verifying at the tree returns the answered summary to its usual place and removes the pointers", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    await walkTo(page, context, 4);
    const card = page.locator(CARD);
    await expect(card).toHaveAttribute("data-tier", "near");
    await card.locator(".community-verify").click();
    await expect(card.locator(".community-mine")).toContainText("You reported: Verified here");
    await expect(page.locator(USUAL_CARD)).toHaveCount(1);
    await expect(card).not.toHaveAttribute("data-tier", /.+/);
    await expect(page.locator(PLACEHOLDER)).toBeHidden();
    await expect(page.locator(POINTER)).toBeHidden();
  });

  test("the subtle hint plays on Verify only when the user is at the tree and the button is on screen", async ({ page, context }) => {
    await setup(page, TREE_HASH);
    const scroller = page.locator(".inspector-scroll");
    await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(40);
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await walkTo(page, context, 5);
    await expect(page.locator(CARD)).toHaveAttribute("data-tier", "near");
    await waitForUiToSettle(page);
    // Promoted to the top while the panel is scrolled down: Verify is off screen, so nothing plays.
    await waitForFrames(page, 20);
    await expect(page.locator(".community-verify-hint")).toHaveCount(0);
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await expect(page.locator(`${CARD} .community-verify`)).toHaveClass(/community-verify-hint/);
    // It is a cue, not a loop: it rests again by itself.
    await expect(page.locator(".community-verify-hint")).toHaveCount(0);
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
    await expect(page.locator(POINTER)).toBeVisible();
    await expect(page.locator(POINTER)).toHaveAccessibleName(/check this place/i);

    await walkTo(page, context, 100);
    await expect(card).toHaveAttribute("data-tier", "approaching");
    await expect(card.locator("[data-community-distance]:visible")).toContainText(/\d+ m away/);
    await expect(card.locator("[data-action='community-place-choose'][data-status='OPEN_CONFIRMED']")).toBeVisible();

    // 30 m is outside a tree's 10 m zone but inside a place's 40 m one.
    await walkTo(page, context, 30);
    await expect(card).toHaveAttribute("data-tier", "near");
    await expect(page.locator('#inspectorBody [data-community-slot="top"] .community-check')).toHaveCount(1);
    await expect(page.locator(PLACEHOLDER)).toBeVisible();
    await expect(page.locator("#communityAnnounce")).toContainText("You're at this place. You can verify it now.");
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
    await expect(page.locator('#inspectorBody [data-community-slot="usual"] .community-check')).toHaveCount(1);
    await expect(page.locator(PLACEHOLDER)).toBeHidden();
    await expect(page.locator(POINTER)).toBeHidden();
    await expect(page.locator(".detail-top-row .community-verified-chip")).toContainText("1");
    await waitForFrames(page, 20);
    expect(sent).toHaveLength(0);
  });
});
