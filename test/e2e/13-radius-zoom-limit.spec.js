// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

test.describe("Radius zoom limit feedback", () => {
  test.use({
    geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 },
    permissions: ["geolocation"],
  });

  for (const input of ["wheel", "pinch", "safari"]) {
    for (const limit of ["floor", "ceiling"]) {
      test(`${input} at the ${limit} softly fades the border red then clears it`, async ({ page }, testInfo) => {
        await skipOnboarding(page);
        await mockCowApi(page);
        await gotoAndWaitForMap(page);
        await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
        await expect.poll(() => page.evaluate(() => state.viewportAnimationFrame == null)).toBe(true);
        await page.clock.install();
        await page.clock.pauseAt(new Date());
        await page.evaluate((limit) => {
          state.walkingDistanceMinutes = limit === "floor" ? walkingRadiusFloorMinutes(nearbyOrigin()) : WALKING_RADIUS_MAX_MINUTES;
          ensureOverviewTargetsVisible({ animate: false, force: true });
          // Render the actual rim on a transparent canvas to measure the colour independently
          // of map tiles, labels and camera movement. The centre must remain transparent.
          window.__sampleRim = () => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 160;
            const ctx = canvas.getContext("2d");
            drawWalkingRadiusRimHighlight(ctx, { x: 80, y: 80 }, 60, false, 1);
            const data = ctx.getImageData(0, 0, 160, 160).data;
            let red = 0;
            for (let i = 0; i < data.length; i += 4) red += Math.max(0, data[i] - data[i + 1]) * data[i + 3] / 255;
            return { red, centreAlpha: ctx.getImageData(80, 80, 1, 1).data[3], image: canvas.toDataURL() };
          };
        }, limit);
        const before = await page.evaluate(() => window.__sampleRim());
        await page.evaluate(({ input, limit }) => {
          const canvas = els.canvas;
          const rect = canvas.getBoundingClientRect();
          const x = rect.left + rect.width / 2, y = rect.top + rect.height / 3;
          if (input === "wheel") {
            canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: limit === "floor" ? -100 : 100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
          } else if (input === "safari") {
            canvas.dispatchEvent(new Event("gesturestart", { bubbles: true, cancelable: true }));
            const event = new Event("gesturechange", { bubbles: true, cancelable: true });
            Object.defineProperty(event, "scale", { value: limit === "floor" ? 2 : 0.5 });
            canvas.dispatchEvent(event);
          } else {
            canvas.setPointerCapture = () => {};
            for (const [type, id, dx] of [["pointerdown", 7101, -40], ["pointerdown", 7102, 40], ["pointermove", 7102, limit === "floor" ? 120 : 0]]) {
              canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: x + dx, clientY: y, bubbles: true, cancelable: true }));
            }
          }
        }, { input, limit });
        await page.clock.runFor(60);
        const rising = await page.evaluate(() => window.__sampleRim());
        expect(rising.red).toBeGreaterThan(before.red + 100);
        await page.clock.runFor(50);
        const peak = await page.evaluate(() => window.__sampleRim());
        expect(peak.red).toBeGreaterThan(rising.red);
        expect(peak.centreAlpha).toBe(0);
        await page.clock.runFor(140);
        const falling = await page.evaluate(() => window.__sampleRim());
        expect(falling.red).toBeLessThan(peak.red);
        await page.clock.runFor(180);
        const after = await page.evaluate(() => window.__sampleRim());
        expect(after.red).toBe(before.red);
        for (const [name, sample] of [["before", before], ["red-feedback", peak], ["after", after]]) {
          await testInfo.attach(name, { body: Buffer.from(sample.image.split(",")[1], "base64"), contentType: "image/png" });
        }
      });
    }
  }
});
