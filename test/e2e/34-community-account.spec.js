// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

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
