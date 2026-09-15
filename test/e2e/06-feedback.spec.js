// @ts-check
const { test, expect } = require("@playwright/test");
const { setup } = require("./helpers");

test.describe("Feedback / Report screen", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.click("#reportToggle");
    await expect(page.locator("#reportDetails")).toBeVisible({ timeout: 5_000 });
  });

  test("feedback button opens the report form", async ({ page }) => {
    await expect(page.locator("#reportToggle")).toHaveClass(/screen-active/);
    await expect(page.locator("#reportForm")).toBeVisible();
  });

  test("report form includes the current app version", async ({ page }) => {
    // The version is displayed inside the form so the user knows which version will be reported
    await expect(page.locator("#reportForm")).toContainText("v");
  });

  test("report form has a text area for the user's description", async ({ page }) => {
    await expect(page.locator("#reportDetails")).toBeVisible();
  });

  test("report form has a Submit button", async ({ page }) => {
    await expect(page.locator("#reportSubmit")).toBeVisible();
  });

  test("report screen stays open when the map canvas is tapped", async ({ page }) => {
    await page.locator("#mapCanvas").click({ position: { x: 200, y: 200 } });
    await expect(page.locator("#reportToggle")).toHaveClass(/screen-active/);
  });

  test("Nearby button closes the report screen and returns to overview", async ({ page }) => {
    await page.click("#nearbyToggle");
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
      { timeout: 5_000 }
    );
    await expect(page.locator("#reportToggle")).not.toHaveClass(/screen-active/);
  });

  test("report form has a Cancel button that returns to overview", async ({ page }) => {
    await page.click("#reportCancel");
    // transitionInspectorBody() briefly creates two #inspectorTitle elements; use waitForFunction
    await page.waitForFunction(
      () => document.getElementById("inspectorTitle")?.textContent?.includes("Nearby"),
      { timeout: 5_000 }
    );
  });

  test("a double-tap on submit only sends one report", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/.netlify/functions/report-missing-data", async (route) => {
      requestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, issueNumber: 1, issueUrl: "https://github.com/simonmcmanus/epping-forest-finds/issues/1" }),
      });
    });

    await page.fill("#reportDetails", "Double-tap duplicate test");
    // Two submit events dispatched back-to-back, simulating a double-tap:
    // the second must be ignored while the first is still in flight.
    await page.evaluate(() => {
      const form = document.getElementById("reportForm");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await expect(page.locator("#reportStatus")).toContainText("submitted successfully", { timeout: 5_000 });
    expect(requestCount).toBe(1);
  });

  test("a failed submission keeps the same request id for a safe retry", async ({ page }) => {
    await page.route("**/.netlify/functions/report-missing-data", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Failed to reach GitHub API" }),
      })
    );

    await page.fill("#reportDetails", "Retry keeps request id test");
    await page.click("#reportSubmit");
    await expect(page.locator("#reportStatus")).toContainText("Failed to reach GitHub API", { timeout: 5_000 });
    const firstId = await page.evaluate(() => localStorage.getItem("forest-finds-report-request-id-v1"));
    expect(firstId).toBeTruthy();

    await page.click("#reportSubmit");
    await expect(page.locator("#reportStatus")).toContainText("Failed to reach GitHub API", { timeout: 5_000 });
    const secondId = await page.evaluate(() => localStorage.getItem("forest-finds-report-request-id-v1"));
    expect(secondId).toBe(firstId);
  });
});

// No Playwright engine here can trigger a genuine iOS on-screen keyboard (playwright.config.js
// only defines Chromium desktop/mobile projects). `window.visualViewport` is replaced with a
// small controllable fake before the app boots, so a "keyboard open" can be simulated exactly as
// iOS Safari reports it: `visualViewport.height` shrinks while `window.innerHeight` (the layout
// viewport the inspector sheet is positioned against) stays the same.
async function installFakeVisualViewport(page) {
  await page.addInitScript(() => {
    class FakeVisualViewport extends EventTarget {
      constructor() {
        super();
        this.height = window.innerHeight;
        this.width = window.innerWidth;
        this.offsetTop = 0;
        this.offsetLeft = 0;
      }
    }
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: new FakeVisualViewport(),
    });
  });
}

// What the user can actually see of the textarea: its box clipped to the scrolling area of the
// sheet (`.inspector-scroll` is `overflow: auto`). The raw bounding box is the *layout* box,
// which on a short landscape screen runs on past the bottom of the sheet even though those
// pixels are clipped and never drawn -- asserting on it fails a view that is behaving correctly.
async function visibleTextareaBand(page) {
  return page.evaluate(() => {
    const textarea = document.getElementById("reportDetails");
    const scroll = document.getElementById("inspector").querySelector(".inspector-scroll");
    const box = textarea.getBoundingClientRect();
    const clip = scroll ? scroll.getBoundingClientRect() : box;
    const top = Math.max(box.top, clip.top);
    const bottom = Math.min(box.bottom, clip.bottom);
    return { top, bottom, height: Math.max(0, bottom - top) };
  });
}

async function simulateKeyboardInset(page, insetPx) {
  await page.evaluate((inset) => {
    window.visualViewport.height = window.innerHeight - inset;
    window.visualViewport.dispatchEvent(new Event("resize"));
  }, insetPx);
}

test.describe("Feedback / Report screen — keyboard avoidance (VisualViewport)", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeVisualViewport(page);
    await setup(page);
  });

  test("portrait bottom sheet: repositions above the simulated keyboard and keeps the textarea visible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("#reportToggle");
    await expect(page.locator("#reportDetails")).toBeVisible({ timeout: 5_000 });

    const beforeBox = await page.locator("#reportDetails").boundingBox();
    const insetPx = 260;
    await simulateKeyboardInset(page, insetPx);

    await expect(page.locator("#inspector")).toHaveClass(/keyboard-avoiding/);
    const afterBox = await page.locator("#reportDetails").boundingBox();
    // The sheet (and the textarea inside it) shifts up by the keyboard inset, so the
    // textarea stays above the simulated keyboard's top edge.
    expect(beforeBox.y - afterBox.y).toBeGreaterThan(insetPx - 20);

    await page.locator("#reportDetails").focus();
    const visible = await visibleTextareaBand(page);
    expect(visible.bottom, "the visible textarea must clear the keyboard").toBeLessThanOrEqual(844 - insetPx + 2);
    expect(visible.height, "and enough of it must be left to type into").toBeGreaterThan(60);

    // Closing the keyboard clears the avoidance state
    await simulateKeyboardInset(page, 0);
    await expect(page.locator("#inspector")).not.toHaveClass(/keyboard-avoiding/);
  });

  test("landscape bottom-sheet layout: repositions above the simulated keyboard and keeps the textarea visible", async ({ browser }) => {
    // The landscape bottom-sheet layout additionally requires a coarse (touch) pointer —
    // see the `(orientation: landscape) and (pointer: coarse) and (max-height: 500px)` query
    // in css/map-ui.css — which needs a dedicated touch-enabled context. A manually created
    // context does not inherit the project's `use` config, so baseURL/serviceWorkers are
    // repeated here to match playwright.config.js.
    const context = await browser.newContext({
      baseURL: "http://localhost:8080",
      serviceWorkers: "block",
      viewport: { width: 700, height: 380 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await installFakeVisualViewport(page);
    await setup(page);
    await page.click("#reportToggle");
    await expect(page.locator("#reportDetails")).toBeVisible({ timeout: 5_000 });

    const beforeBox = await page.locator("#reportDetails").boundingBox();
    const insetPx = 180;
    await simulateKeyboardInset(page, insetPx);

    await expect(page.locator("#inspector")).toHaveClass(/keyboard-avoiding/);
    const afterBox = await page.locator("#reportDetails").boundingBox();
    expect(beforeBox.y - afterBox.y).toBeGreaterThan(insetPx - 20);

    // Focus it, the way tapping it does: 380px of screen minus a 180px keyboard leaves a sheet
    // shorter than the textarea, so the form starts scrolled above it and the browser scrolls it
    // into view on focus. What matters is that the part on screen then clears the keyboard --
    // measuring the unclipped layout box instead reported the textarea 100px into the keyboard
    // while the pixels actually drawn ended a comfortable 11px above it.
    await page.locator("#reportDetails").focus();
    const visible = await visibleTextareaBand(page);
    expect(visible.bottom, "the visible textarea must clear the keyboard").toBeLessThanOrEqual(380 - insetPx + 2);
    expect(visible.height, "and enough of it must be left to type into").toBeGreaterThan(60);

    await context.close();
  });

  test("is scoped to the Report screen — Settings is unaffected by the simulated keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("#settingsToggle");
    await expect(page.locator("#settingsWalkMins")).toBeVisible({ timeout: 5_000 });

    await simulateKeyboardInset(page, 260);
    await expect(page.locator("#inspector")).not.toHaveClass(/keyboard-avoiding/);
  });
});

test.describe("Reporting a mistake from a weekly report", () => {
  test("a #report link opens the report form straight away", async ({ page }) => {
    await setup(page, "/#report");
    await expect(page.locator("#reportForm")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#reportToggle")).toHaveClass(/screen-active/);
  });

  test("the link says which report the reader was looking at", async ({ page }) => {
    await setup(page, "/#report=Mistake%20in%20the%20Epping%20Forest%20Ledger%20for%2015%20September%202026");
    await expect(page.locator("#reportDetails")).toHaveValue(
      /Mistake in the Epping Forest Ledger for 15 September 2026/
    );
  });

  test("an unsaved draft of the reader's own is never overwritten by the link", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "forest-finds-report-draft-v1",
        JSON.stringify({ details: "Half-written note I came back to" })
      );
    });
    await setup(page, "/#report=Mistake%20in%20the%20ledger");
    await expect(page.locator("#reportDetails")).toHaveValue("Half-written note I came back to");
  });
});
