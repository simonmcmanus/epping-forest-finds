// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

const REPORT_URL = "**/api/community/report";
const OVERLAY_URL = "**/api/community/overlay";

test.describe("Community tree verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) })
    );
  });

  test("a tree's detail screen offers the community checks", async ({ page }) => {
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator(".community-check")).toContainText("Help check this tree");
    await expect(page.locator("[data-action='community-report']")).toHaveCount(6);
  });

  test("verifying a tree shows the user's report at once and sends it to the server", async ({ page }) => {
    const posted = [];
    await page.route(REPORT_URL, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await page.click("[data-action='community-report'][data-status='VERIFIED']");
    await expect(page.locator(".community-mine")).toContainText("Other people may take up to a day to see this");
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ kind: "tree", target: `tree:${FIXTURE_TREE.recordNumber}`, status: "VERIFIED" });
  });

  test("a report made offline is kept and sent when the connection returns", async ({ page, context }) => {
    const posted = [];
    await page.route(REPORT_URL, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await context.setOffline(true);
    await page.click("[data-action='community-report'][data-status='NOT_HERE']");
    await expect(page.locator(".community-mine")).toContainText("No tree found here");
    expect(posted).toHaveLength(0);
    await context.setOffline(false);
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].status).toBe("NOT_HERE");
  });

  test("Settings shows a log of the user's own contributions with their state", async ({ page }) => {
    await page.route(REPORT_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    );
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await page.click("[data-action='community-report'][data-status='VERIFIED']");
    await expect(page.locator(".community-mine")).toBeVisible();
    await page.click("#settingsToggle");
    await expect(page.locator(".community-contributions")).toContainText("Your contributions");
    await expect(page.locator(".community-rank")).toContainText("Seedling");
    await expect(page.locator(".community-log-item")).toHaveCount(1);
    await expect(page.locator(".community-log-item")).toContainText("Verified here");
  });

  test("a tree the community has questioned is flagged but keeps its official details", async ({ page }) => {
    await page.unroute(OVERLAY_URL);
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ generatedAt: 1, entries: { [`tree:${FIXTURE_TREE.recordNumber}`]: { s: "questioned", st: "NOT_HERE", n: 2, t: 1 } } }),
      })
    );
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator(".community-badge-questioned")).toContainText("Questioned by the community");
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
  });

  test("adding a missing tree needs a real location and sends a NEW_TREE report", async ({ page, context }) => {
    // no location granted: the app answers "denied", so the button explains what is needed
    await setup(page, "/feedback");
    await page.click("#communityAddTree");
    await expect(page.locator("#communityAddTreeStatus")).toContainText("Turn on location");
  });
});

test.describe("Community tree verification with location shared", () => {
  test.use({ geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 }, permissions: ["geolocation"] });

  test("a missing tree is reported from the user's own position", async ({ page }) => {
    await page.route(OVERLAY_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ generatedAt: 1, entries: {} }) })
    );
    const posted = [];
    await page.route(REPORT_URL, async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await setup(page, "/feedback");
    await page.click("#communityAddTree");
    await expect(page.locator("#communityAddTreeStatus")).toContainText("second person finds it too");
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ kind: "tree", status: "NEW_TREE" });
    expect(posted[0].lat).toBeCloseTo(51.665, 2);
  });
});
