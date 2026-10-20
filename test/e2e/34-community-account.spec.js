// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

const OVERLAY_URL = "**/api/community/overlay**";
const ME_URL = "**/api/auth/me";
const LINK_URL = "**/api/auth/link";

test.describe("Community sign-in", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) })
    );
  });

  test("an anonymous visitor is offered sign-in and keeps the anonymous check-ins", async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false }) })
    );
    await setup(page, "/community");
    await expect(page.locator("#communityAccount")).toContainText("Keep your points on any device");
    await expect(page.locator("#communityAccount a[href^='/api/auth/login']")).toBeVisible();
    await expect(page.locator(".community-contributions")).toBeVisible();
  });

  test("a signed-in visitor sees their name, can sign out, and their device is linked once", async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: true, name: "Sam Walker" }) })
    );
    let links = 0;
    await page.route(LINK_URL, (route) => {
      links += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await setup(page, "/community");
    await expect(page.locator("#communityAccount")).toContainText("Signed in as Sam Walker");
    await expect(page.locator("#communityAccount a[href^='/api/auth/logout']")).toBeVisible();
    await expect.poll(() => links).toBe(1);
  });

  test("a device already linked to another account shows why, and the page still works", async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: true, name: "Sam" }) })
    );
    await page.route(LINK_URL, (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "This device is already linked to another account." }) })
    );
    await setup(page, "/community");
    await expect(page.locator("#communityAccount [role='status']")).toContainText("already linked to another account");
    await expect(page.locator(".community-contributions")).toBeVisible();
  });
});

test.describe("Community sign-in: history, account switching, storage", () => {
  const LIST_URL = /\/api\/community\/overlay\?me=[^&]*&list=1/;
  const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

  test.beforeEach(async ({ page }) => {
    await page.route(OVERLAY_URL, (route) => route.fulfill(json({ generatedAt: 1, entries: {} })));
  });

  test("on a second device the account's reports from other devices fill the contributions log", async ({ page }) => {
    await page.route(ME_URL, (route) => route.fulfill(json({ signedIn: true, name: "Sam", account: "acct-aaaa" })));
    await page.route(LINK_URL, (route) => route.fulfill(json({ ok: true })));
    await page.route(LIST_URL, (route) => route.fulfill(json({
      generatedAt: 1,
      reports: [
        { id: "phone-report-0001", kind: "tree", target: `tree:${FIXTURE_TREE.recordNumber}`, status: "VERIFIED", ts: Date.now() - 60000, outcome: "confirmed" },
        { id: "phone-report-0002", kind: "tree", target: null, tagNumber: "T-4242", status: "NEW_TREE", ts: Date.now() - 120000, lat: 51.66, lon: 0.04, outcome: "pending" },
        { id: "phone-report-0003", kind: "place", target: "place:id:node/77", status: "CLOSED", ts: Date.now() - 180000, outcome: "confirmed" },
      ],
    })));
    // A brand new browser: nothing on this device yet.
    await setup(page, "/community");
    const rows = page.locator(".community-log-item");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Verified here");
    await expect(rows.nth(0)).toContainText("Confirmed by others");
    await expect(rows.nth(1)).toContainText("Tree T-4242");
    await expect(rows.nth(2)).toContainText("Reported closed");
    await expect(page.locator(".community-stats")).toContainText("3");
  });

  test("a report made on this device and not yet sent is not replaced by the server's older copy", async ({ page, context }) => {
    await page.route(ME_URL, (route) => route.fulfill(json({ signedIn: true, name: "Sam", account: "acct-aaaa" })));
    await page.route(LINK_URL, (route) => route.fulfill(json({ ok: true })));
    const target = `tree:${FIXTURE_TREE.recordNumber}`;
    await page.route(LIST_URL, (route) => route.fulfill(json({ generatedAt: 1, reports: [{ id: "other-device-0001", kind: "tree", target, status: "NOT_HERE", ts: Date.now() - 3600000, outcome: "pending" }] })));
    await setup(page, "/community");
    await expect(page.locator(".community-log-item")).toContainText("No tree found here");
    // Now this device reports the same tree, offline so it stays unsent, then the screen refreshes.
    await context.setOffline(true);
    await page.evaluate(async (t) => {
      await communitySubmitReport({ kind: "tree", target: t, status: "VERIFIED", targetLat: 51.66, targetLon: 0.04 });
    }, target);
    await context.setOffline(false);
    await page.evaluate(() => communityOpenContributions());
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    await expect(page.locator(".community-log-item")).toContainText("Verified here");
  });

  test("switching account or signing out on a browser drops the last account's history and links again", async ({ page }) => {
    let me = { signedIn: true, name: "Sam", account: "acct-aaaa" };
    let reports = [{ id: "sams-report-0001", kind: "tree", target: `tree:${FIXTURE_TREE.recordNumber}`, status: "VERIFIED", ts: Date.now() - 1000, outcome: "confirmed" }];
    const linked = [];
    await page.route(ME_URL, (route) => route.fulfill(json(me)));
    await page.route(LINK_URL, (route) => { linked.push(route.request().postDataJSON().deviceId); return route.fulfill(json({ ok: true })); });
    await page.route(LIST_URL, (route) => route.fulfill(json({ generatedAt: 1, reports })));
    await setup(page, "/community");
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    await expect.poll(() => linked.length).toBe(1);

    // Same browser, same signed-in account again: the link is remembered, not repeated.
    await page.reload();
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    expect(linked.length).toBe(1);

    // Another person signs in on this browser: Sam's history goes and this device links to the new account.
    me = { signedIn: true, name: "Alex", account: "acct-bbbb" };
    reports = [];
    await page.reload();
    await expect(page.locator("#communityAccount")).toContainText("Signed in as Alex");
    await expect(page.locator(".community-log-item")).toHaveCount(0);
    await expect.poll(() => linked.length).toBe(2);

    // Signed out: nothing of either account is left, and signing back in links once more.
    reports = [{ id: "alexs-report-0001", kind: "tree", target: "tree:9999", status: "VERIFIED", ts: Date.now() - 500, outcome: "pending" }];
    await page.reload();
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    me = { signedIn: false };
    await page.reload();
    await expect(page.locator("#communityAccount")).toContainText("Keep your points on any device");
    await expect(page.locator(".community-log-item")).toHaveCount(0);
    me = { signedIn: true, name: "Alex", account: "acct-bbbb" };
    await page.reload();
    await expect.poll(() => linked.length).toBe(3);
  });

  test("when the browser cannot keep an id, one stable id is used for the whole page and the card says so", async ({ page }) => {
    await page.addInitScript(() => {
      const throwFor = (key) => key === "ff-community-device-v1";
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) { if (throwFor(key)) throw new Error("blocked"); return get.call(this, key); };
      Storage.prototype.setItem = function (key, value) { if (throwFor(key)) throw new Error("blocked"); return set.call(this, key, value); };
    });
    await page.route(ME_URL, (route) => route.fulfill(json({ signedIn: false })));
    await setup(page, "/community");
    const ids = await page.evaluate(() => [communityDeviceId(), communityDeviceId(), communityDeviceId()]);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[a-z0-9]{24}$/);
    expect(await page.evaluate(() => communityDeviceIdIsDurable())).toBe(false);
    await expect(page.locator(".community-recover .community-log-error")).toContainText("can't save your Community code");
    // A report made in this page is filed under that same id.
    const posted = [];
    await page.route("**/api/community/report", (route) => { posted.push(route.request().postDataJSON()); return route.fulfill(json({ ok: true })); });
    await page.evaluate(() => communitySubmitReport({ kind: "tree", target: "tree:1", status: "VERIFIED", targetLat: 51.66, targetLon: 0.04 }));
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].deviceId).toBe(ids[0]);
  });
});
