// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE, skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

const FEATURES_URL = "**/api/features**";
const answer = (community) => (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ community }) });

test.describe("Community feature gate", () => {
  test("without the gate the tab is Feedback, /community opens the Feedback page and tree pages carry no check card", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ff-features-v1", JSON.stringify({ community: false })));
    await page.route(FEATURES_URL, answer(false));
    await setup(page, "/community");
    await expect(page.locator("#reportToggle .nav-label")).toHaveText("Feedback");
    await expect(page.locator("#reportToggle")).toHaveAttribute("href", "/feedback");
    await expect(page.locator("#inspectorTitle").last()).toContainText("Feedback");
    await expect(page.locator(".community-contributions")).toHaveCount(0);
    await page.goto(`/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorBody")).toContainText(/\S/);
    await expect(page.locator(".community-check")).toHaveCount(0);
  });

  test("a first visit with no stored answer waits for the server before choosing the screen", async ({ page }) => {
    await skipOnboarding(page);
    await page.addInitScript(() => localStorage.removeItem("ff-features-v1"));
    await mockCowApi(page);
    await page.route(FEATURES_URL, answer(true));
    await gotoAndWaitForMap(page, "/community");
    await expect(page.locator("#reportToggle .nav-label")).toHaveText("Community");
    await expect(page.locator(".community-contributions")).toBeVisible();
  });

  test("the server's answer replaces a stale stored one", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ff-features-v1", JSON.stringify({ community: true })));
    await page.route(FEATURES_URL, answer(false));
    await setup(page, "/nearby");
    await expect(page.locator("#reportToggle .nav-label")).toHaveText("Feedback");
  });

  test("a fresh device whose features lookup fails shows Feedback, not Community, and Settings shows no Tester ID", async ({ page }) => {
    // Registered after skipOnboarding's seeding, so this device really has no remembered answer.
    await skipOnboarding(page);
    await page.addInitScript(() => localStorage.removeItem("ff-features-v1"));
    await mockCowApi(page);
    await page.route(FEATURES_URL, (route) => route.fulfill({ status: 503, body: "down" }));
    await gotoAndWaitForMap(page, "/nearby");
    await expect(page.locator("#reportToggle .nav-label")).toHaveText("Feedback");
    await page.locator("#settingsToggle").click();
    await expect(page.locator("#settingsWalkMins")).toBeVisible();
    await expect(page.locator(".settings-form")).not.toContainText("Tester ID");
  });

  test("the app asks /api/features without any Tester ID", async ({ page }) => {
    const urls = [];
    await page.route(FEATURES_URL, (route) => { urls.push(route.request().url()); return answer(true)(route); });
    await setup(page, "/nearby");
    await expect(page.locator("#reportToggle .nav-label")).toHaveText("Community");
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(new URL(url).search).toBe("");
  });
});
