// @ts-check
// Visual snapshots of the Community screen and its sign-in states, so layout, wrapping and contrast are
// protected alongside the other app screens. Mobile only, like the rest of the app snapshots; the baselines
// are written by CI (never by hand). Everything the screen shows is mocked, so nothing here depends on time or
// on the network.
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE, settleMapIconsAndDraw } = require("./helpers");

const OVERLAY_ENTRIES = "**/api/community/overlay";
const ME_URL = "**/api/auth/me";
const LINK_URL = "**/api/auth/link";
const MINE_URL = /\/api\/community\/overlay\?me=/;
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SCORE = { points: 7, reports: 4, verified: 4, confirmed: 1, validated: 0, fixed: 0, generatedAt: 1 };

async function mockCommunity(page, { me, link = { status: 200, body: { ok: true } }, reports = [] }) {
  await page.route(OVERLAY_ENTRIES, (route) => route.fulfill(json({ generatedAt: 1, entries: {} })));
  await page.route(ME_URL, (route) => route.fulfill(json(me)));
  await page.route(LINK_URL, (route) => route.fulfill(json(link.body, link.status)));
  await page.route(MINE_URL, (route) => {
    const url = new URL(route.request().url());
    return route.fulfill(url.searchParams.get("list") ? json({ generatedAt: 1, reports }) : json(SCORE));
  });
}

async function settle(page) {
  await page.waitForTimeout(300);
  await settleMapIconsAndDraw(page);
}

test.describe("Community screen snapshots", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Snapshots are mobile-only");
  });

  test("snapshot: community screen, signed out", async ({ page }) => {
    await mockCommunity(page, { me: { signedIn: false } });
    await setup(page, "/community");
    await expect(page.locator("#communityAccount")).toContainText("Keep your points on any device");
    await expect(page.locator(".community-empty")).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("community-signed-out.png", { fullPage: false });
  });

  test("snapshot: community screen, signed in with history from other devices", async ({ page }) => {
    await mockCommunity(page, {
      me: { signedIn: true, name: "Sam Walker", account: "acct-snapshot" },
      reports: [
        { id: "snap-report-0001", kind: "tree", target: `tree:${FIXTURE_TREE.recordNumber}`, status: "VERIFIED", ts: 3000, outcome: "confirmed" },
        { id: "snap-report-0002", kind: "tree", target: null, tagNumber: "T-4242", status: "NEW_TREE", ts: 2000, lat: 51.66, lon: 0.04, outcome: "pending" },
        { id: "snap-report-0003", kind: "place", target: "place:id:node/77", status: "CLOSED", ts: 1000, outcome: "confirmed" },
      ],
    });
    await setup(page, "/community");
    await expect(page.locator("#communityAccount")).toContainText("Signed in as Sam Walker");
    await expect(page.locator(".community-log-item")).toHaveCount(3);
    await expect(page.locator(".community-rank-points")).toContainText("7 points");
    await page.locator(".community-stats").scrollIntoViewIfNeeded();
    await settle(page);
    await expect(page).toHaveScreenshot("community-signed-in-history.png", { fullPage: false });
  });

  test("snapshot: community screen, device already linked to another account", async ({ page }) => {
    await mockCommunity(page, {
      me: { signedIn: true, name: "Sam Walker", account: "acct-snapshot" },
      link: { status: 409, body: { error: "This device is already linked to another account." } },
    });
    await setup(page, "/community");
    await expect(page.locator("#communityAccount [role='status']")).toContainText("already linked to another account");
    await settle(page);
    await expect(page).toHaveScreenshot("community-link-conflict.png", { fullPage: false });
  });
});
