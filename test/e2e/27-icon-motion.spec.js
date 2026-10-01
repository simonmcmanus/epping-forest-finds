const { test, expect } = require("@playwright/test");
const { setup, FIXTURE_TREE } = require("./helpers");

test.describe("Selected destination icon motion", () => {
  test("reduced motion keeps the selected destination still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    expect(await page.evaluate(() => selectedIconMotionFrame())).toBeNull();
    expect(await page.evaluate(() => _selectedIconMotionTimer)).toBeNull();
  });

  test("only selecting a navigation destination starts motion and returning to Nearby stops it", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page);
    expect(await page.evaluate(() => selectedIconMotionFrame())).toBeNull();
    await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    await expect(page.locator("#inspectorTitle")).toContainText(FIXTURE_TREE.commonName);
    await expect.poll(() => page.evaluate(() => _selectedIconMotionTimer !== null)).toBe(true);
    const elapsed = await page.evaluate(() => selectedIconMotionFrame().elapsed);
    await expect.poll(() => page.evaluate(() => selectedIconMotionFrame().elapsed)).toBeGreaterThan(elapsed);
    await page.click("#nearbyToggle");
    await expect.poll(() => page.evaluate(() => selectedIconMotionFrame())).toBeNull();
    await expect.poll(() => page.evaluate(() => _selectedIconMotionTimer)).toBeNull();
  });

  test("turning on reduced motion stops an active animation immediately", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    await expect.poll(() => page.evaluate(() => _selectedIconMotionTimer !== null)).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => page.evaluate(() => selectedIconMotionFrame())).toBeNull();
    await expect.poll(() => page.evaluate(() => _selectedIconMotionTimer)).toBeNull();
  });

  test("hiding the app stops motion and showing it resumes the selected destination", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await setup(page, `/app#tree=${FIXTURE_TREE.hashKey}`);
    await expect.poll(() => page.evaluate(() => _selectedIconMotionTimer !== null)).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await page.evaluate(() => _selectedIconMotionTimer)).toBeNull();
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => page.evaluate(() => _selectedIconMotionTimer !== null)).toBe(true);
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
