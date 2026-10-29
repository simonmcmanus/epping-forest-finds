const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE, waitForFrames, waitForUiToSettle } = require("./helpers");
// Own the destination data so weekly place updates cannot change motion coverage.
const DESTINATION = { route: "/nearby#place=id:motion-fixture-pub", name: "Motion test pub" };
const placeFixture = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [0.04, 51.66] },
    properties: { id: "motion-fixture-pub", name: DESTINATION.name, category: "pub", categoryLabel: "Pub" },
  }],
};

test.describe("Selected destination icon motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/data/local-landmarks-food.geojson", route => route.fulfill({ json: placeFixture }));
  });
  test("the location details title animates and restores its original image for reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, DESTINATION.route);
    await waitForUiToSettle(page);
    const artwork = page.locator("#inspectorTitleEmoji canvas");
    const original = page.locator("#inspectorTitleEmoji img");
    await expect(artwork).toBeVisible();
    await expect(original).toBeHidden();
    const frame = await artwork.evaluate(canvas => canvas.toDataURL());
    await expect.poll(() => artwork.evaluate(canvas => canvas.toDataURL())).not.toBe(frame);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(artwork).toBeHidden();
    await expect(original).toBeVisible();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(artwork).toBeVisible();
    await page.click("#nearbyToggle");
    await expect(artwork).toHaveCount(0);
  });

  test("reduced motion keeps the selected destination still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page, DESTINATION.route);
    await expect(page.locator("#inspectorTitle")).toContainText(DESTINATION.name);
    await expect(page.locator("#inspectorTitleEmoji img")).toBeVisible();
    await expect(page.locator("#inspectorTitleEmoji canvas")).toBeHidden();
  });

  test("only selecting a navigation destination starts motion and returning to Nearby stops it", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page);
    await expect(page.locator("#inspectorTitleEmoji canvas")).toHaveCount(0);
    await setup(page, DESTINATION.route);
    await expect(page.locator("#inspectorTitle")).toContainText(DESTINATION.name);
    const artwork = page.locator("#inspectorTitleEmoji canvas");
    const first = await artwork.evaluate((canvas) => canvas.toDataURL());
    await expect.poll(() => artwork.evaluate((canvas) => canvas.toDataURL())).not.toBe(first);
    await page.click("#nearbyToggle");
    await expect(artwork).toHaveCount(0);
  });

  test("turning on reduced motion stops an active animation immediately", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, DESTINATION.route);
    const artwork = page.locator("#inspectorTitleEmoji canvas");
    await expect(artwork).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(artwork).toBeHidden();
    await expect(page.locator("#inspectorTitleEmoji img")).toBeVisible();
  });

  test("hiding the app stops motion and showing it resumes the selected destination", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, DESTINATION.route);
    const artwork = page.locator("#inspectorTitleEmoji canvas");
    const frame = () => artwork.evaluate((canvas) => canvas.toDataURL());
    await expect(artwork).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitForFrames(page, 3);
    const paused = await frame();
    await waitForFrames(page, 60);
    expect(await frame(), "no new frames while the app is hidden").toBe(paused);
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(frame).not.toBe(paused);
  });

  test("tree details stay text-only with motion enabled", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, `/nearby#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    await expect(page.locator("#inspectorTitleEmoji")).toBeHidden();
  });

  test("every supported PNG artwork renders changing frames", async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(async () => {
      const failures = [];
      const entries = Object.entries(ICON_PATHS).filter(([slug]) => IconMotion.has(slug));
      for (const [slug, src] of entries) {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
        const ctx = canvas.getContext("2d");
        const frames = [];
        for (const elapsed of [0, 0.7, 1.9, 3.2]) {
          ctx.clearRect(0, 0, 256, 256);
          if (!IconMotion.draw(ctx, image, slug, 0, 0, 256, elapsed)) failures.push(`${slug}: not rendered`);
          frames.push(canvas.toDataURL());
        }
        if (new Set(frames).size === 1) failures.push(`${slug}: stationary`);
        if (image.getAttribute("src") !== src) failures.push(`${slug}: source changed`);
      }
      return { count: entries.length, failures };
    });
    expect(result.count).toBeGreaterThan(45);
    expect(result.failures).toEqual([]);
  });
});
