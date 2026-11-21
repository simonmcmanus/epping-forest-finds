// @ts-check
const { test, expect } = require("@playwright/test");
const { mockCowApi, gotoAndWaitForMap, waitForUiToSettle, settleMapIconsAndDraw } = require("./helpers");

const FEATURES_URL = "**/api/features**";
const answer = (community) => (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ community }) });

// The beta sign-up flow lives only at /beta. A new tester for the welcome: no ff-welcome-v1 key, and no stored Community answer unless a test sets one.
// The first-run consent card and guided setup are already answered, because the welcome waits behind them
// (their own tests below leave them unanswered).
async function openAsNewVisitor(page, { community = false, path = "/beta" } = {}) {
  await mockCowApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("ff-location-v1", "declined");
    localStorage.setItem("ff-track-v1", "0");
    localStorage.setItem("forest-finds-onboarding-v1", "done");
  });
  await page.route(FEATURES_URL, answer(community));
  await gotoAndWaitForMap(page, path);
}

const dialog = (page) => page.getByRole("dialog", { name: "Thanks for testing Epping Forest Finds" });

async function goToStep2(page) {
  await expect(dialog(page)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Your Tester ID" })).toBeVisible();
}

test.describe("Beta welcome sheet", () => {
  test("a new visitor sees the welcome after the map loads and the map stays usable behind it", async ({ page }) => {
    await openAsNewVisitor(page);
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByText("Step 1 of 3")).toBeVisible();
    await expect(page.locator("#mapCanvas")).toBeVisible();
    await expect(page.locator("#nearbyToggle")).toBeVisible();
    expect(await page.evaluate(() => state.dataLoaded)).toBe(true);
  });

  test("the welcome waits behind the first-run map-setup card and opens once that card is dismissed", async ({ page }) => {
    await mockCowApi(page);
    await page.route(FEATURES_URL, answer(false));
    await page.addInitScript(() => {
      localStorage.removeItem("ff-track-v1");
      localStorage.removeItem("ff-cookie-consent");
    });
    await page.goto("/beta");
    const card = page.locator("#consentBanner");
    await expect(card).toBeVisible();
    await page.waitForFunction(() => state.dataLoaded === true);
    // Well past the welcome's first poll: the card is still up, so the sheet must not be.
    await page.waitForTimeout(1500);
    await expect(card).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    // Each answer can lead to the next question or to the map-setup hint in the same card; the welcome
    // stays out of the way until the card is finally dismissed.
    for (let i = 0; i < 4 && (await card.isVisible()); i += 1) {
      await page.locator("#consentBannerDecline").press("Enter");
      await expect(dialog(page)).toHaveCount(0);
    }
    await expect(card).toBeHidden();
    await expect(dialog(page)).toBeVisible();
  });

  test("the welcome also waits behind the guided map setup and opens once that is closed", async ({ page }) => {
    await mockCowApi(page);
    await page.route(FEATURES_URL, answer(false));
    await page.addInitScript(() => {
      localStorage.removeItem("ff-track-v1");
      localStorage.removeItem("ff-cookie-consent");
    });
    await page.goto("/beta");
    await page.locator("#consentBannerDecline").click();
    await page.locator("#filterToggle").click();
    const setup = page.getByRole("dialog", { name: "Set up Epping Forest Finds" });
    await expect(setup).toBeVisible();
    await page.waitForFunction(() => state.dataLoaded === true);
    // Take the consent card out of the picture so only the guided setup is holding the welcome back.
    await page.evaluate(() => { document.getElementById("consentBanner").hidden = true; });
    await page.waitForTimeout(2000);
    await expect(setup).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(setup).toBeHidden();
    await expect(dialog(page)).toBeVisible();
  });

  test("Skip closes the welcome, and visiting /beta again opens it at step 1", async ({ page }) => {
    await openAsNewVisitor(page);
    await expect(dialog(page)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await gotoAndWaitForMap(page, "/beta");
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByText("Step 1 of 3")).toBeVisible();
  });

  test("other paths never show the welcome, even on a fresh profile", async ({ page }) => {
    await openAsNewVisitor(page, { path: "/nearby" });
    await page.waitForTimeout(2000);
    await expect(page.locator("#mapCanvas")).toBeVisible();
    await expect(page.getByRole("dialog", { name: /Thanks for testing/ })).toHaveCount(0);
  });

  test("/beta is served as the app, not a 404", async ({ page }) => {
    const response = await page.request.get("/beta");
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('id="mapCanvas"');
  });

  test("step 2 shows the Tester ID and Send opens an email with the ID but never the device id", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      window.__mailto = null;
      document.addEventListener("click", (event) => {
        const link = event.target instanceof Element ? event.target.closest('a[href^="mailto:"]') : null;
        if (!link) return;
        event.preventDefault();
        window.__mailto = link.getAttribute("href");
      }, true);
    });
    await openAsNewVisitor(page);
    await goToStep2(page);
    const id = (await page.locator("#welcomeTesterId").innerText()).trim();
    expect(id).toMatch(/^[a-f0-9]{10}$/);
    await page.getByRole("button", { name: "Send to Simon" }).click();
    const href = await page.evaluate(() => window.__mailto);
    expect(href).toBeTruthy();
    const url = new URL(/** @type {string} */ (href));
    expect(url.pathname).toBe("mcmanus.simon@gmail.com");
    expect(url.searchParams.get("subject")).toBe("Epping Forest Finds beta: my Tester ID");
    const body = url.searchParams.get("body") || "";
    expect(body).toContain(id);
    const deviceId = await page.evaluate(() => communityPrimaryDeviceId());
    expect(body).not.toContain(deviceId);
  });

  test("step 2 tells a tester without Community to send the ID to Simon", async ({ page }) => {
    await openAsNewVisitor(page, { community: false });
    await goToStep2(page);
    await expect(page.locator("#welcomeTesterStatus")).toHaveText("Send this to Simon to turn on Community for you.");
  });

  test("step 2 says Community is on once the server lists the tester", async ({ page }) => {
    await openAsNewVisitor(page, { community: true });
    await goToStep2(page);
    await expect(page.locator("#welcomeTesterStatus")).toHaveText("You're on the list. Community is on for you.");
  });

  test("Escape closes the welcome and puts focus back on the map", async ({ page }) => {
    await openAsNewVisitor(page);
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Thanks for testing Epping Forest Finds" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#mapCanvas")).toBeFocused();
  });

  test("Settings no longer offers to show the beta welcome again", async ({ page }) => {
    await openAsNewVisitor(page, { path: "/settings" });
    await expect(page.getByText("Tester ID:")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show the beta welcome again" })).toHaveCount(0);
  });

  test("at 320px wide the page does not scroll sideways with the welcome open", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openAsNewVisitor(page);
    for (const heading of ["Thanks for testing Epping Forest Finds", "Your Tester ID", "What feedback helps"]) {
      await expect(page.getByRole("dialog", { name: heading })).toBeVisible();
      const overflow = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"][aria-labelledby]');
        const box = dlg ? dlg.getBoundingClientRect() : { left: 0, right: 0 };
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          sheet: dlg ? dlg.scrollWidth - dlg.clientWidth : 0,
          left: box.left,
          right: box.right - window.innerWidth,
        };
      });
      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.sheet).toBeLessThanOrEqual(0);
      expect(overflow.left).toBeGreaterThanOrEqual(0);
      expect(overflow.right).toBeLessThanOrEqual(0);
      if (heading !== "What feedback helps") await page.getByRole("button", { name: "Next" }).click();
    }
  });
});

test.describe("Beta welcome snapshots", () => {
  const failTesterId = (page) =>
    page.addInitScript(() => {
      SubtleCrypto.prototype.digest = () => Promise.reject(new Error("unavailable"));
    });

  async function settle(page) {
    await waitForUiToSettle(page);
    await settleMapIconsAndDraw(page);
  }

  async function goToStep3(page) {
    await goToStep2(page);
    await page.getByRole("dialog", { name: "Your Tester ID" }).getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("dialog", { name: "What feedback helps" })).toBeVisible();
  }

  test("snapshot: beta welcome step 1", async ({ page }) => {
    await openAsNewVisitor(page);
    await expect(page.getByRole("heading", { name: "Thanks for testing Epping Forest Finds" })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("beta-welcome-step-1.png", { fullPage: false });
  });

  test("snapshot: beta welcome step 2 with Tester ID and Send", async ({ page }) => {
    await openAsNewVisitor(page, { community: false });
    await goToStep2(page);
    await expect(page.locator("#welcomeTesterStatus")).toHaveText("Send this to Simon to turn on Community for you.");
    await settle(page);
    // The Tester ID is random per browser.
    await expect(page).toHaveScreenshot("beta-welcome-step-2.png", { fullPage: false, mask: [page.locator("#welcomeTesterId")] });
  });

  test("snapshot: beta welcome step 2 when the Tester ID cannot be made", async ({ page }) => {
    await failTesterId(page);
    await openAsNewVisitor(page);
    await goToStep2(page);
    const sheet = page.getByRole("dialog", { name: "Your Tester ID" });
    await expect(page.locator("#welcomeTesterStatus")).toContainText("We couldn't get your Tester ID. Try again");
    await expect(sheet.getByRole("button", { name: "Retry" })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("beta-welcome-step-2-failed.png", { fullPage: false });
  });

  test("snapshot: beta welcome feedback step", async ({ page }) => {
    await openAsNewVisitor(page);
    await goToStep3(page);
    await settle(page);
    await expect(page).toHaveScreenshot("beta-welcome-step-3.png", { fullPage: false });
  });

  test("snapshot: beta welcome feedback step at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openAsNewVisitor(page);
    await goToStep3(page);
    await settle(page);
    await expect(page).toHaveScreenshot("beta-welcome-step-3-320.png", { fullPage: false });
  });

  test("snapshot: settings beta welcome control", async ({ page }) => {
    await openAsNewVisitor(page);
    await page.getByRole("button", { name: "Skip" }).click();
    await page.click("#settingsToggle");
    await page.getByRole("button", { name: "Show the beta welcome again" }).scrollIntoViewIfNeeded();
    await expect(page.locator("#testerIdDisplay")).not.toHaveText("…");
    await settle(page);
    await expect(page).toHaveScreenshot("beta-welcome-settings-reopen.png", {
      fullPage: false,
      mask: [page.locator("#testerIdDisplay"), page.locator("#appVersionDisplay")],
    });
  });

  test("snapshot: settings Tester ID retry after the lookup fails", async ({ page }) => {
    await failTesterId(page);
    await openAsNewVisitor(page);
    await page.getByRole("button", { name: "Skip" }).click();
    await page.click("#settingsToggle");
    await expect(page.locator("#testerIdStatus")).toContainText("We couldn't get your Tester ID. Try again");
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await retry.scrollIntoViewIfNeeded();
    await settle(page);
    await expect(page).toHaveScreenshot("beta-welcome-settings-tester-id-retry.png", { fullPage: false });
  });
});
