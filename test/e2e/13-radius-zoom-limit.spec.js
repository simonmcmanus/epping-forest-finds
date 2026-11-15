// @ts-check
const { test, expect } = require("@playwright/test");
const { skipOnboarding, mockCowApi, gotoAndWaitForMap } = require("./helpers");

test.describe("Radius zoom limit feedback", () => {
  test.use({
    reducedMotion: "no-preference",
    geolocation: { latitude: 51.665, longitude: 0.045, accuracy: 10 },
    permissions: ["geolocation"],
  });

  for (const input of ["wheel", "pinch", "safari"]) {
    for (const limit of ["floor", "ceiling"]) {
      test(`${input} at the ${limit} gently throbs on the exact radius edge until released`, async ({ page }, testInfo) => {
        await skipOnboarding(page);
        await mockCowApi(page);
        await gotoAndWaitForMap(page);
        await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
        await expect.poll(() => page.evaluate(() => state.viewportAnimationFrame == null)).toBe(true);
        const clockTime = new Date("2026-11-15T12:00:00Z");
        await page.clock.install({ time: clockTime });
        await page.clock.pauseAt(new Date(clockTime.getTime() + 10_000));
        await page.evaluate((limit) => {
          state.walkingDistanceMinutes = limit === "floor" ? walkingRadiusFloorMinutes(nearbyOrigin()) : WALKING_RADIUS_MAX_MINUTES;
          ensureOverviewTargetsVisible({ animate: false, force: true });
          // Render the actual rim on a transparent canvas to measure the colour independently
          // of map tiles, labels and camera movement. The centre must remain transparent.
          window.__sampleRim = () => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 160;
            const ctx = canvas.getContext("2d");
            drawWalkingRadiusLimitFeedback(ctx, { x: 80, y: 80 }, 60, false, 1);
            const data = ctx.getImageData(0, 0, 160, 160).data;
            let red = 0;
            for (let i = 0; i < data.length; i += 4) red += Math.max(0, data[i] - data[i + 1]) * data[i + 3] / 255;
            const alpha = (x) => ctx.getImageData(x, 80, 1, 1).data[3];
            let brightest = 0;
            for (let x = 120; x < 159; x++) if (alpha(x) > alpha(brightest)) brightest = x;
            return { red, brightest, edgeAlpha: Math.max(alpha(139), alpha(140)), nearAlpha: alpha(145), farAlpha: alpha(155), outsideAlpha: alpha(159), centreAlpha: alpha(80), image: canvas.toDataURL() };
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
        // Flush the pinch's coalesced request once, then advance time without rendering every
        // intermediate map frame. We sample the actual canvas at each visual milestone.
        await page.clock.runFor(16);
        const advance = async (ms) => {
          if (input === "wheel") {
            // Wheel input stays live only while the reader keeps trying to scroll.
            for (let elapsed = 0; elapsed < ms; elapsed += 100) {
              await page.evaluate((limit) => els.canvas.dispatchEvent(new WheelEvent("wheel", {
                deltaY: limit === "floor" ? -100 : 100, bubbles: true, cancelable: true,
              })), limit);
              await page.clock.fastForward(Math.min(100, ms - elapsed));
            }
          } else await page.clock.fastForward(ms);
        };
        await advance(90);
        const rising = await page.evaluate(() => window.__sampleRim());
        expect(rising.red).toBeGreaterThan(before.red + 100);
        await advance(290);
        const peak = await page.evaluate(() => window.__sampleRim());
        expect(peak.red).toBeGreaterThan(rising.red);
        expect(Math.abs(peak.brightest - 140)).toBeLessThanOrEqual(1);
        expect(peak.edgeAlpha).toBeGreaterThan(peak.nearAlpha);
        expect(peak.nearAlpha).toBeGreaterThan(peak.farAlpha);
        expect(peak.farAlpha).toBeGreaterThanOrEqual(peak.outsideAlpha);
        expect(peak.centreAlpha).toBe(0);
        await advance(380);
        const trough = await page.evaluate(() => window.__sampleRim());
        expect(trough.red).toBeGreaterThan(before.red);
        expect(trough.red).toBeLessThan(peak.red);
        await advance(380);
        expect((await page.evaluate(() => window.__sampleRim())).red).toBeGreaterThan(trough.red);
        await page.evaluate((input) => {
          if (input === "pinch") {
            for (const id of [7101, 7102]) els.canvas.dispatchEvent(new PointerEvent("pointerup", {
              pointerId: id, pointerType: "touch", bubbles: true, cancelable: true,
            }));
          } else if (input === "safari") els.canvas.dispatchEvent(new Event("gestureend", { bubbles: true, cancelable: true }));
        }, input);
        await page.clock.fastForward(220);
        await page.clock.fastForward(240);
        const after = await page.evaluate(() => window.__sampleRim());
        expect(after.red).toBe(before.red);
        for (const [name, sample] of [["before", before], ["red-feedback", peak], ["after", after]]) {
          await testInfo.attach(name, { body: Buffer.from(sample.image.split(",")[1], "base64"), contentType: "image/png" });
        }
      });
    }
  }

  test("reduced motion keeps the edge steady while blocked and fades it on release", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await skipOnboarding(page);
    await mockCowApi(page);
    await gotoAndWaitForMap(page);
    await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
    await expect.poll(() => page.evaluate(() => state.viewportAnimationFrame == null)).toBe(true);
    const time = new Date("2026-11-15T12:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(new Date(time.getTime() + 10_000));
    await page.evaluate(() => {
      state.walkingDistanceMinutes = walkingRadiusFloorMinutes(nearbyOrigin());
      els.canvas.dispatchEvent(new Event("gesturestart", { bubbles: true, cancelable: true }));
      const change = new Event("gesturechange", { bubbles: true, cancelable: true });
      Object.defineProperty(change, "scale", { value: 2 });
      els.canvas.dispatchEvent(change);
    });
    const sample = () => page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const ctx = canvas.getContext("2d");
      drawWalkingRadiusLimitFeedback(ctx, { x: 80, y: 80 }, 60, false, 1);
      return ctx.getImageData(139, 80, 1, 1).data[3];
    });
    await page.clock.runFor(16);
    await page.clock.fastForward(400);
    const steady = await sample();
    expect(steady).toBeGreaterThan(0);
    await page.clock.fastForward(380);
    expect(await sample()).toBe(steady);
    await page.evaluate(() => els.canvas.dispatchEvent(new Event("gestureend", { bubbles: true, cancelable: true })));
    await page.clock.fastForward(240);
    expect(await sample()).toBe(0);
  });


  for (const tilted of [false, true]) {
    test(`the visible ${tilted ? "tilted" : "flat"} overlay lights the radius edge and clears on release`, async ({ page }) => {
      await skipOnboarding(page);
      await mockCowApi(page);
      await gotoAndWaitForMap(page);
      await expect(page.locator("[data-load-step='location']")).toHaveClass(/done/);
      await expect.poll(() => page.evaluate(() => state.viewportAnimationFrame == null)).toBe(true);
      await page.evaluate((tilted) => {
        if (tilted) {
          state.map3dEnabled = true;
          state.compassHeadingTarget = state.compassHeading = state.renderedNavigationHeading = 0;
          state.compassLastEventAt = performance.now();
          state.tiltBetaTarget = state.tiltBetaSmoothed = 50;
        }
        state.walkingDistanceMinutes = walkingRadiusFloorMinutes(nearbyOrigin());
        ensureOverviewTargetsVisible({ animate: false, force: true });
        draw();
      }, tilted);
      expect(await page.evaluate(() => tiltActive())).toBe(tilted);
      const time = new Date("2026-11-15T12:00:00Z");
      await page.clock.install({ time });
      await page.clock.pauseAt(new Date(time.getTime() + 10_000));
      const sample = () => page.evaluate(() => {
        // Exercise the actual display integration, so dropping the feedback from drawOverlay
        // cannot pass merely because an isolated helper can still paint a red circle.
        drawOverlay();
        const { center, radiusPx, tilted } = walkingRadiusScreenGeometry(true);
        const ctx = els.overlayCanvas.getContext("2d");
        const scale = state.canvasMotion.scale;
        let red = 0, samples = 0;
        for (let i = 0; i < 64; i++) {
          const a = i * Math.PI * 2 / 64;
          const flat = { x: center.x + radiusPx * Math.cos(a), y: center.y + radiusPx * Math.sin(a) };
          const point = tilted ? tiltProjectScreenPoint(flat) : flat;
          const x = Math.round(point.x * scale), y = Math.round(point.y * scale);
          if (x < 1 || y < 1 || x >= ctx.canvas.width - 1 || y >= ctx.canvas.height - 1) continue;
          samples++;
          const data = ctx.getImageData(x - 1, y - 1, 3, 3).data;
          for (let j = 0; j < data.length; j += 4) red += Math.max(0, data[j] - data[j + 1]) * data[j + 3] / 255;
        }
        return { red, samples };
      });
      const before = await sample();
      expect(before.samples).toBeGreaterThan(8);
      await page.evaluate(() => {
        els.canvas.dispatchEvent(new Event("gesturestart", { bubbles: true, cancelable: true }));
        const change = new Event("gesturechange", { bubbles: true, cancelable: true });
        Object.defineProperty(change, "scale", { value: 2 });
        els.canvas.dispatchEvent(change);
      });
      await page.clock.runFor(16);
      await page.clock.fastForward(380);
      expect((await sample()).red).toBeGreaterThan(before.red + 500);
      await page.evaluate(() => els.canvas.dispatchEvent(new Event("gestureend", { bubbles: true, cancelable: true })));
      await page.clock.fastForward(240);
      expect((await sample()).red).toBeLessThan(before.red + 100);
    });
  }

});
