// @ts-check
// Re-tapping the Nearby nav button while already on Nearby: the sheet shakes in place rather than
// sliding out and back in, and a browse anchor set from the list is cleared with the panel
// showing the Nearby list on the first tap. See spec.md "nav button re-tap" (Nearby bullet).
const { test, expect } = require("@playwright/test");
const { setup, waitForUiToSettle } = require("./helpers");

const FOREST_LOCATION = { latitude: 51.6650, longitude: 0.0450, accuracy: 10 };

test.use({ geolocation: FOREST_LOCATION, permissions: ["geolocation"] });

const nearbyButton = (page) => page.locator("#nearbyToggle");
const listed = (page) => page.locator("#inspectorBody .nearest-item");

/** Counts every screen-entry ghost the panel slide would add from now on. */
async function watchForPanelSlide(page) {
  await page.evaluate(() => {
    window.__slides = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains("inspector-screen-ghost")) window.__slides += 1;
        });
      }
    }).observe(document.querySelector(".inspector-scroll"), { childList: true, subtree: true });
  });
}

test.describe("Nearby re-tap", () => {
  test("re-tapping Nearby on the Nearby screen shakes the sheet in place without a slide", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    await watchForPanelSlide(page);

    await nearbyButton(page).click();

    // The sheet's own shake animation runs, and no outgoing-screen ghost is created.
    await expect.poll(() => page.evaluate(() =>
      document.getElementById("inspector").getAnimations().some((a) => a.animationName === "sheet-shake")
    )).toBe(true);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
    await expect(listed(page).first()).toBeVisible();
  });

  test("tapping Nearby after picking a place from the list returns to the list on the first tap", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    const title = page.locator("#inspectorTitle");

    // Opening a place from the list moves the panel off the Nearby list.
    await listed(page).first().click();
    await expect(title).not.toHaveText("Nearby");

    await nearbyButton(page).click();

    // One tap is enough: the panel is back on the Nearby list without a second press.
    await expect(title).toHaveText("Nearby");
    await expect(listed(page).first()).toBeVisible();
  });
  test("tapping Nearby after moving the browse origin updates the panel on the first tap", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(listed(page).first()).toBeVisible();
    // A tap on open ground moves the browse origin away from the real fix.
    await page.evaluate(() => {
      const latitude = state.userLocation.latitude + 0.02;
      const longitude = state.userLocation.longitude;
      setNearbyAnchor(latitude, longitude, projectLonLat(longitude, latitude));
    });
    await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();

    await nearbyButton(page).click();

    // One tap is enough: the panel shows the Nearby list for the moved origin.
    await expect(page.locator("#inspectorTitle")).toHaveText("Nearby");
    await expect(listed(page).first()).toBeVisible();
    await expect(page.locator("[data-action='reset-nearby-anchor']")).toBeVisible();
  });
  test("re-tapping Search while on Search shakes the sheet in place without a slide", async ({ page }) => {
    await setup(page, "/nearby");
    await expect(nearbyButton(page)).toBeVisible();
    await page.locator("#searchToggle").click();
    await expect(page.locator("#searchToggle")).toHaveClass(/screen-active/);
    await watchForPanelSlide(page);

    await page.locator("#searchToggle").click();

    await expect.poll(() => page.evaluate(() =>
      document.getElementById("inspector").getAnimations().some((a) => a.animationName === "sheet-shake")
    )).toBe(true);
    expect(await page.evaluate(() => window.__slides)).toBe(0);
    await expect(page.locator("#searchToggle")).toHaveClass(/screen-active/);
  });
});
