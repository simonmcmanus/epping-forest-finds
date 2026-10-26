// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE, waitForFrames } = require("./helpers");

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
    await expect(page.locator("#communityAccount")).toContainText("Sign in to take your points with you");
    await expect(page.locator("#communityAccount a[href^='/api/auth/login']")).toBeVisible();
    await expect(page.locator(".community-contributions")).toBeVisible();
  });

  test("the sign-in banner can be put away and leaves a quiet link", async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false }) })
    );
    await setup(page, "/community");
    await expect(page.locator(".community-account-quiet a[href^='/api/auth/login']")).toBeVisible();
  });

  test("the screen is drawn once as a skeleton and later renders only update values in place", async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: true, name: "Sam Walker", account: "acct-sam" }) })
    );
    await page.route(LINK_URL, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
    await setup(page, "/community");
    // The skeleton as first drawn: every slot is there, empty, and the hero is marked as loading.
    const skeleton = await page.evaluate(() => {
      const box = document.createElement("div");
      box.innerHTML = communityScreenHtml();
      const hero = box.querySelector("#communityContributions");
      return {
        loading: hero.classList.contains("is-loading"),
        slots: [...hero.querySelectorAll("[data-hero]")].map((el) => el.dataset.hero),
        filled: [...hero.querySelectorAll("[data-hero='rank'], [data-hero='points']")].map((el) => el.textContent),
      };
    });
    expect(skeleton.loading).toBe(true);
    expect(skeleton.slots).toEqual(expect.arrayContaining(["rank", "points", "verified", "confirmed", "reports", "bar", "chips"]));
    expect(skeleton.filled).toEqual(["", ""]);
    await expect(page.locator("#communityAccount")).toContainText("Signed in as Sam Walker");
    await expect(page.locator("#communityContributions")).not.toHaveClass(/is-loading/);
    await expect(page.locator("#communityContributions [data-hero='rank']")).toHaveText("Seedling");
    // Rendering again writes into the same elements rather than replacing them.
    await page.evaluate(() => { document.querySelector("#communityContributions [data-hero='points']").dataset.kept = "1"; });
    await page.evaluate(() => communityRenderContributions());
    await expect(page.locator("#communityContributions [data-hero='points'][data-kept='1']")).toHaveCount(1);
  });

  test("a signed-in visitor sees their name, can sign out, and their device is linked once", async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: true, name: "Sam Walker", account: "acct-sam" }) })
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

  test("Sign in leaves the app for the login page instead of opening a screen", async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false }) })
    );
    await page.route("**/api/auth/login**", (route) =>
      route.fulfill({ status: 302, headers: { Location: "https://auth.example.test/authorize" }, body: "" })
    );
    await page.route("https://auth.example.test/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/plain", body: "login page" })
    );
    await setup(page, "/community");
    // The click must reach the server. If the in-app link handler swallowed it, the app would open a screen and
    // no request for the login route would ever be made. (The redirect hop to the provider is not asserted: whether
    // a browser lets a mocked cross-origin redirect through differs between Chromium builds.)
    const login = page.waitForRequest(/\/api\/auth\/login/);
    await page.click("#communityAccount a[href^='/api/auth/login']");
    await login;
  });

  test("a device already linked to another account shows why, and the page still works", async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: true, name: "Sam", account: "acct-sam" }) })
    );
    await page.route(LINK_URL, (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "This device is already linked to another account." }) })
    );
    await setup(page, "/community");
    await expect(page.locator("#communityAccount .community-account-note")).toContainText("already linked to another account");
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
    // The server only returns the account's other devices' reports to someone who is signed in.
    await page.route(LIST_URL, (route) => route.fulfill(json({ generatedAt: 1, reports: me.signedIn ? reports : [] })));
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
    await expect(page.locator("#communityAccount")).toContainText("Sign in to take your points with you");
    await expect(page.locator(".community-log-item")).toHaveCount(0);
    me = { signedIn: true, name: "Alex", account: "acct-bbbb" };
    await page.reload();
    await expect.poll(() => linked.length).toBe(3);
  });

  test("a second account on a browser already linked to someone else gets its own identity and sees none of the first account's data", async ({ page }) => {
    // A small stand-in for the server: device ownership, the 409 on a taken device, and reads limited to what the
    // signed-in account may see.
    const owners = {};
    const serverReports = {};
    const requested = [];
    const posted = [];
    let me = { signedIn: false };
    const visible = (deviceId) => {
      if (!me.signedIn) return [deviceId];
      const own = Object.keys(owners).filter((d) => owners[d] === me.account);
      if (own.includes(deviceId)) return own;
      if (owners[deviceId] && owners[deviceId] !== me.account) return own;
      return [deviceId];
    };
    await page.route(ME_URL, (route) => route.fulfill(json(me)));
    await page.route(LINK_URL, (route) => {
      const { deviceId } = route.request().postDataJSON();
      if (owners[deviceId] && owners[deviceId] !== me.account) return route.fulfill(json({ error: "This device is already linked to another account." }, 409));
      owners[deviceId] = me.account;
      return route.fulfill(json({ ok: true }));
    });
    await page.route(/\/api\/community\/overlay\?me=/, (route) => {
      const url = new URL(route.request().url());
      const deviceId = url.searchParams.get("me");
      requested.push(deviceId);
      const devices = visible(deviceId);
      if (url.searchParams.get("list")) {
        return route.fulfill(json({ generatedAt: 1, reports: devices.flatMap((d) => serverReports[d] || []) }));
      }
      return route.fulfill(json({ points: 3 * devices.flatMap((d) => serverReports[d] || []).length, reports: 0, verified: 0, confirmed: 0, validated: 0, fixed: 0, generatedAt: 1 }));
    });
    await page.route("**/api/community/report", (route) => {
      const report = route.request().postDataJSON();
      posted.push(report);
      (serverReports[report.deviceId] ||= []).push({ id: report.id, kind: "tree", target: report.target, status: report.status, ts: Date.now(), outcome: "pending" });
      return route.fulfill(json({ ok: true }));
    });

    // 1. Nobody is signed in: this browser makes a report under its own id.
    await setup(page, "/community");
    const primary = await page.evaluate(() => communityDeviceId());
    await page.evaluate(() => communitySubmitReport({ kind: "tree", target: "tree:1", status: "VERIFIED", targetLat: 51.66, targetLon: 0.04 }));
    await expect.poll(() => posted.some((r) => r.target === "tree:1")).toBe(true);
    expect(posted.find((r) => r.target === "tree:1").deviceId).toBe(primary);

    // 2. Account A signs in: this browser links to A and A's history shows.
    me = { signedIn: true, name: "Ada", account: "acct-aaaa" };
    await page.reload();
    await expect(page.locator("#communityAccount")).toContainText("Signed in as Ada");
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    await expect.poll(() => owners[primary]).toBe("acct-aaaa");

    // 3. Account B signs in on the same browser: the link is refused (409), so B gets an identity of its own.
    me = { signedIn: true, name: "Ben", account: "acct-bbbb" };
    await page.reload();
    await expect(page.locator("#communityAccount")).toContainText("Signed in as Ben");
    await expect(page.locator("#communityAccount .community-account-note")).toContainText("starting fresh");
    const bens = await page.evaluate(() => communityDeviceId());
    expect(bens).not.toBe(primary);
    expect(owners[bens]).toBe("acct-bbbb");
    await expect(page.locator(".community-log-item")).toHaveCount(0);
    await expect(page.locator(".community-rank-points")).toContainText("0 points");
    // Requests the old page still had in flight when it reloaded can land at any point, so what the
    // new page asks for is checked from here: clear, make the page ask afresh, and look only at that.
    requested.length = 0;
    await page.evaluate(() => Promise.all([communityRefreshScore(true), communityRefreshLog()]));
    await expect.poll(() => requested.length).toBeGreaterThan(0);
    expect(requested.includes(primary)).toBe(false);
    expect(requested.every((id) => id === bens)).toBe(true);
    expect(await page.evaluate((id) => localStorage.getItem(`ff-community-local-v1:${id}`), bens)).toBeNull();
    expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ff-community-local-v1"))).length)).toBe(1);

    // 4. B reports under B's own id, which the server files under B.
    await page.evaluate(() => communitySubmitReport({ kind: "tree", target: "tree:2", status: "VERIFIED", targetLat: 51.66, targetLon: 0.04 }));
    await expect.poll(() => posted.some((r) => r.target === "tree:2")).toBe(true);
    expect(posted.find((r) => r.target === "tree:2").deviceId).toBe(bens);
    await page.reload();
    await expect(page.locator(".community-log-item")).toHaveCount(1);

    // 5. A signs back in: A's own history is back and B's report is not in it.
    me = { signedIn: true, name: "Ada", account: "acct-aaaa" };
    await page.reload();
    await expect(page.locator("#communityAccount")).toContainText("Signed in as Ada");
    expect(await page.evaluate(() => communityDeviceId())).toBe(primary);
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    await expect(page.locator(".community-log-item")).toContainText("Verified here");
    expect(new Set(posted.filter((r) => r.deviceId === primary).map((r) => r.id)).size).toBe(1);
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

  test("the previous account's rows and name are never drawn while a new sign-in is still being resolved", async ({ page }) => {
    let me = { signedIn: true, name: "Sam", account: "acct-aaaa" };
    const mine = [{ id: "sams-report-0001", kind: "tree", target: `tree:${FIXTURE_TREE.recordNumber}`, status: "VERIFIED", ts: Date.now() - 1000, outcome: "confirmed" }];
    let release;
    let hold = false;
    const seenWhileWaiting = [];
    await page.route(ME_URL, async (route) => {
      if (hold) {
        // The identity answer is still on its way: record what the screen shows right now.
        seenWhileWaiting.push(await page.evaluate(() => ({
          rows: document.querySelectorAll(".community-log-item").length,
          text: (document.getElementById("communityAccount") || {}).textContent || "",
        })));
        await new Promise((resolve) => { release = resolve; });
      }
      return route.fulfill(json(me));
    });
    await page.route(LINK_URL, (route) => route.fulfill(json({ ok: true })));
    await page.route(LIST_URL, (route) => route.fulfill(json({ generatedAt: 1, reports: me.account === "acct-aaaa" ? mine : [] })));
    await setup(page, "/community");
    await expect(page.locator(".community-log-item")).toHaveCount(1);

    me = { signedIn: true, name: "Alex", account: "acct-bbbb" };
    hold = true;
    await page.reload();
    await expect.poll(() => seenWhileWaiting.length).toBe(1);
    expect(seenWhileWaiting[0].rows).toBe(0);
    expect(seenWhileWaiting[0].text).not.toContain("Sam");
    release();
    await expect(page.locator("#communityAccount")).toContainText("Signed in as Alex");
    await expect(page.locator(".community-log-item")).toHaveCount(0);
  });

  test("when the browser cannot save the account's device id the card says history will not be remembered", async ({ page }) => {
    await page.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "ff-community-account-devices-v1") throw new Error("blocked");
        return set.call(this, key, value);
      };
    });
    await page.route(ME_URL, (route) => route.fulfill(json({ signedIn: true, name: "Sam", account: "acct-aaaa" })));
    await page.route(LINK_URL, (route) => route.fulfill(json({ ok: true })));
    await setup(page, "/community");
    await expect(page.locator("#communityAccount .community-account-note")).toContainText("can't save your sign-in");
    // Within the page the account's id stays stable.
    const ids = await page.evaluate(() => [communityDeviceId(), communityDeviceId()]);
    expect(ids[0]).toBe(ids[1]);
  });

  test("reopening the screen after the account changed elsewhere clears the old account at once", async ({ page }) => {
    let me = { signedIn: true, name: "Sam", account: "acct-aaaa" };
    const mine = [{ id: "sams-report-0001", kind: "tree", target: `tree:${FIXTURE_TREE.recordNumber}`, status: "VERIFIED", ts: Date.now() - 1000, outcome: "confirmed" }];
    const releases = [];
    let hold = false;
    await page.route(ME_URL, async (route) => {
      if (hold) await new Promise((resolve) => { releases.push(resolve); });
      return route.fulfill(json(me));
    });
    await page.route(LINK_URL, (route) => route.fulfill(json({ ok: true })));
    await page.route(LIST_URL, (route) => route.fulfill(json({ generatedAt: 1, reports: me.account === "acct-aaaa" ? mine : [] })));
    await setup(page, "/community");
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    await expect(page.locator("#communityAccount")).toContainText("Sam");

    // The same page, same DOM: the account changes elsewhere and the screen is opened again.
    me = { signedIn: true, name: "Alex", account: "acct-bbbb" };
    hold = true;
    await page.evaluate(() => { window.__reopen = communityOpenContributions(); });
    // Read the DOM in one step: the held request is aborted by the app after 6 s, so slow assertions here would race it.
    const whileHeld = await page.evaluate(() => ({ rows: document.querySelectorAll(".community-log-item").length, account: document.getElementById("communityAccount").textContent }));
    expect(whileHeld.rows).toBe(0);
    expect(whileHeld.account).not.toContain("Sam");
    await expect.poll(() => releases.length).toBeGreaterThan(0);
    hold = false;
    releases.forEach((release) => release());
    await expect(page.locator("#communityContributions")).not.toContainText("Couldn't check");
    await expect(page.locator("#communityAccount")).toContainText("Signed in as Alex");
  });

  test("when /api/auth/me fails and a signed-in account is remembered, no score or log request goes out for it", async ({ page }) => {
    const requested = [];
    await page.addInitScript(() => {
      localStorage.setItem("ff-community-account-v1", JSON.stringify({ signedIn: true, name: "Sam", account: "acct-aaaa" }));
    });
    await page.route(ME_URL, (route) => route.fulfill(json({ error: "down" }, 500)));
    await page.route(/\/api\/community\/overlay\?me=/, (route) => {
      requested.push(route.request().url());
      return route.fulfill(json({ generatedAt: 1, reports: [] }));
    });
    await setup(page, "/community");
    await expect(page.locator("#communityContributions")).toContainText("Couldn't check who is signed in");
    // Give the page's own background refreshes (they run about a second after load) time to fire.
    await page.evaluate(() => Promise.all([communityRefreshScore(false), communityRefreshLog()]));
    await waitForFrames(page, 90);
    expect(requested).toEqual([]);
  });

  test("Settings has an Account section: Sign in goes to the login page and returns to Settings", async ({ page }) => {
    await page.route(ME_URL, (route) => route.fulfill(json({ signedIn: false })));
    let loginUrl = "";
    await page.route("**/api/auth/login**", (route) => {
      loginUrl = route.request().url();
      return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>provider login</h1>" });
    });
    await setup(page, "/settings");
    const link = page.locator("#settingsAccount #settingsSignIn");
    await expect(link).toBeVisible();
    await expect(link).toHaveText("Sign in");
    await link.click();
    await expect(page.locator("h1")).toHaveText("provider login");
    expect(new URL(loginUrl).searchParams.get("return")).toBe("/settings");
  });

  test("Settings shows who is signed in, with Sign out", async ({ page }) => {
    await page.route(ME_URL, (route) => route.fulfill(json({ signedIn: true, name: "Sam", account: "acct-aaaa" })));
    await page.route(LINK_URL, (route) => route.fulfill(json({ ok: true })));
    await setup(page, "/settings");
    await expect(page.locator("#settingsAccount")).toContainText("Signed in as Sam");
    await expect(page.locator("#settingsSignOut")).toHaveAttribute("href", "/api/auth/logout?return=/settings");
    await expect(page.locator("#settingsSignIn")).toHaveCount(0);
  });

  test("Settings offers to merge another sign-in, and says how the merge went once", async ({ page, context }) => {
    await page.route(ME_URL, (route) => route.fulfill(json({ signedIn: true, name: "Sam", account: "acct-bbbb" })));
    await page.route(LINK_URL, (route) => route.fulfill(json({ ok: true })));
    await context.addCookies([{ name: "ff_merge_result", value: "merged", url: "http://localhost:8080" }]);
    await setup(page, "/settings");
    const merge = page.locator("#settingsMerge");
    await expect(merge).toHaveText("Merge another sign-in");
    await expect(merge).toHaveAttribute("href", "/api/auth/login?return=/settings&merge=1");
    await expect(page.locator("#settingsAccount")).toContainText("points and devices are now in this account");
    // Shown once: the outcome cookie is cleared as soon as it has been read.
    expect((await context.cookies()).some((c) => c.name === "ff_merge_result")).toBe(false);
    await page.reload();
    await expect(page.locator("#settingsAccount")).not.toContainText("points and devices are now in this account");
  });
});
