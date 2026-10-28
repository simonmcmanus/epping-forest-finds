// @ts-check
const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

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
    await page.addInitScript(() => localStorage.removeItem("ff-features-v1"));
    await page.route(FEATURES_URL, answer(true));
    await setup(page, "/community");
    await expect(page.locator("#reportToggle .nav-label")).toHaveText("Community");
    await expect(page.locator(".community-contributions")).toBeVisible();
  });

  test("the server's answer replaces a stale stored one", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ff-features-v1", JSON.stringify({ community: true })));
    await page.route(FEATURES_URL, answer(false));
    await setup(page, "/nearby");
    await expect(page.locator("#reportToggle .nav-label")).toHaveText("Feedback");
  });

  test("Settings shows a short Tester ID to give to the admin, not the device id", async ({ page }) => {
    await page.route(FEATURES_URL, answer(true));
    await setup(page, "/settings");
    const shown = (await page.locator("#testerIdDisplay").innerText()).trim();
    expect(shown).toMatch(/^[a-f0-9]{10}$/);
    const deviceId = await page.evaluate(() => communityPrimaryDeviceId());
    expect(shown).not.toContain(deviceId);
  });
});
