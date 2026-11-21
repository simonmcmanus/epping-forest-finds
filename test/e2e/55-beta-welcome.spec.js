// @ts-check
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");
const { mockCowApi, skipOnboarding, gotoAndWaitForMap } = require("./helpers");

// /beta is a standalone sign-up page, not part of the app: sign in, send the Tester ID to Simon, then
// carry on to /nearby. See spec/spec-community.md "Beta sign-up page".

const SECRET = "longhorn";
const gateUrl = pathToFileURL(path.join(__dirname, "..", "..", "netlify", "edge-functions", "alpha-gate.js")).href;

const json = (body) => (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const signedIn = (page, name = "Pat Walker") => page.route("**/api/auth/me", json({ signedIn: true, name, account: "a1" }));
const signedOut = (page) => page.route("**/api/auth/me", json({ signedIn: false }));

// The local dev server does not run Netlify edge functions, so the real alpha gate is put in front of /beta
// here: the same module Netlify runs, called with the browser's own request.
async function putGateInFront(page) {
  // Playwright rewrites a literal import() to require(), which cannot load this ES module.
  const loaded = await new Function("url", "return import(url)")(gateUrl);
  // Under Playwright's loader the ES module can arrive wrapped one level deeper.
  const gate = { default: typeof loaded.default === "function" ? loaded.default : loaded.default.default };
  /** @type {any} */ (globalThis).Netlify = { env: { get: (name) => (name === "ALPHA_SECRETS" ? SECRET : undefined) } };
  await page.route((url) => url.pathname === "/beta", async (route) => {
    const request = route.request();
    const headers = await request.allHeaders();
    const result = await gate.default(new Request(request.url(), { headers }), { next: () => "pass" });
    if (result === "pass") return route.fallback();
    const responseHeaders = {};
    result.headers.forEach((value, key) => { responseHeaders[key] = value; });
    return route.fulfill({ status: result.status, headers: responseHeaders, body: "" });
  });
}

// Records every request the page makes, to prove what it does and does not load.
function recordRequests(page) {
  const urls = [];
  page.on("request", (request) => urls.push(new URL(request.url()).pathname));
  return urls;
}

const testerId = (page) => page.locator("#testerId");
const send = (page) => page.getByRole("button", { name: "Send my Tester ID to Simon" });

async function stubShare(page, behaviour) {
  await page.addInitScript((mode) => {
    if (mode === "none") { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); return; }
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        sessionStorage.setItem("ff-test-shared", JSON.stringify(data));
        if (mode === "reject") throw new DOMException("cancelled", "AbortError");
      },
    });
  }, behaviour);
}

// Mail links the page asks the browser to open are recorded and cancelled (there is no mail client here).
async function captureMailLinks(page) {
  await page.addInitScript(() => {
    document.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href^='mailto:']") : null;
      if (!link) return;
      event.preventDefault();
      sessionStorage.setItem("ff-test-mailto", link.getAttribute("href"));
    }, true);
  });
}

test.describe("Beta sign-up page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCowApi(page);
    await skipOnboarding(page);
  });

  test("with the key, a fresh visitor sees the sign-in step and nothing else", async ({ page }) => {
    await putGateInFront(page);
    await signedOut(page);
    await page.goto(`/beta?k=${SECRET}`);
    await expect(page).toHaveURL(/\/beta$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const signIn = page.getByRole("link", { name: "Sign in" });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute("href", "/api/auth/login?return=/beta");
    await expect(send(page)).toHaveCount(0);
    await expect(testerId(page)).toBeHidden();
  });

  test("without the key the gate sends the visitor to the homepage", async ({ page }) => {
    await putGateInFront(page);
    await signedOut(page);
    await page.goto("/beta");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  });

  test("signed in, the Tester ID matches the one the app shows for the same device", async ({ page }) => {
    await signedIn(page);
    await page.goto("/beta");
    await expect(page.getByText("Pat Walker")).toBeVisible();
    await expect(testerId(page)).toHaveText(/^[0-9a-f]{10}$/);
    const betaId = (await testerId(page).textContent()) || "";
    const deviceId = await page.evaluate(() => localStorage.getItem("ff-community-device-v1"));
    expect(deviceId, "the page makes the same device id the app would").toBeTruthy();
    expect(await page.locator("body").innerText()).not.toContain(deviceId);

    await gotoAndWaitForMap(page, "/settings");
    await expect(page.locator("#testerIdDisplay")).toHaveText(betaId);
  });

  test("signed in on a device the app already knows, the page shows the app's Tester ID", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ff-community-device-v1", "known-device-id-0123456789"));
    await signedIn(page);
    await gotoAndWaitForMap(page, "/settings");
    await expect(page.locator("#testerIdDisplay")).toHaveText(/^[0-9a-f]{10}$/);
    const appId = (await page.locator("#testerIdDisplay").textContent()) || "";
    await page.goto("/beta");
    await expect(testerId(page)).toHaveText(appId);
  });

  test("sending with the share sheet passes on the Tester ID only, then continues to /nearby", async ({ page }) => {
    await stubShare(page, "resolve");
    await signedIn(page);
    await page.goto("/beta");
    await expect(testerId(page)).toHaveText(/^[0-9a-f]{10}$/);
    const id = (await testerId(page).textContent()) || "";
    const deviceId = await page.evaluate(() => localStorage.getItem("ff-community-device-v1"));
    await send(page).click();
    await page.waitForURL(/\/nearby$/);
    const shared = JSON.parse((await page.evaluate(() => sessionStorage.getItem("ff-test-shared"))) || "{}");
    expect(shared.text).toContain(id);
    expect(JSON.stringify(shared)).not.toContain(deviceId);
  });

  test("a cancelled share stays on the page so the tester can try again", async ({ page }) => {
    await stubShare(page, "reject");
    await signedIn(page);
    await page.goto("/beta");
    await send(page).click();
    await expect(page.getByRole("status")).toContainText(/not sent/i);
    await expect(page).toHaveURL(/\/beta$/);
    await expect(send(page)).toBeVisible();
  });

  test("without a share sheet, Send opens an email with only the Tester ID and Continue to the map goes to /nearby", async ({ page }) => {
    await stubShare(page, "none");
    await captureMailLinks(page);
    await signedIn(page);
    await page.goto("/beta");
    await expect(testerId(page)).toHaveText(/^[0-9a-f]{10}$/);
    const id = (await testerId(page).textContent()) || "";
    const deviceId = await page.evaluate(() => localStorage.getItem("ff-community-device-v1"));
    await send(page).click();
    const mailto = (await page.evaluate(() => sessionStorage.getItem("ff-test-mailto"))) || "";
    const url = new URL(mailto);
    expect(url.pathname).toBe("mcmanus.simon@gmail.com");
    expect(url.searchParams.get("subject")).toBe("Epping Forest Finds beta: my Tester ID");
    expect(url.searchParams.get("body")).toBe(id);
    expect(mailto).not.toContain(deviceId);
    await expect(page).toHaveURL(/\/beta$/);
    const next = page.getByRole("link", { name: "Continue to the map" }).or(page.getByRole("button", { name: "Continue to the map" }));
    await expect(next).toBeVisible();
    await next.click();
    await page.waitForURL(/\/nearby$/);
  });

  test("when the Tester ID cannot be made the page says so and Try again recovers", async ({ page }) => {
    await page.addInitScript(() => {
      const original = SubtleCrypto.prototype.digest;
      let failures = 1;
      SubtleCrypto.prototype.digest = function (...args) {
        if (failures-- > 0) return Promise.reject(new Error("unavailable"));
        return original.apply(this, args);
      };
    });
    await signedIn(page);
    await page.goto("/beta");
    await expect(page.getByRole("status")).toContainText("couldn't get your Tester ID");
    await expect(send(page)).toBeHidden();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(testerId(page)).toHaveText(/^[0-9a-f]{10}$/);
    await expect(send(page)).toBeVisible();
  });

  test("when sign-in is not set up the page says so plainly", async ({ page }) => {
    await signedOut(page);
    await page.route("**/api/auth/login**", (route) =>
      route.fulfill({ status: 503, contentType: "text/plain", body: "Sign-in isn't set up yet." }));
    await page.goto("/beta");
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page.getByRole("status")).toContainText("Sign-in isn't set up yet");
    await expect(page).toHaveURL(/\/beta$/);
  });

  test("the sign-in link is there without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/beta");
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/api/auth/login?return=/beta");
    await context.close();
  });

  test("the page does not load the app", async ({ page }) => {
    const urls = recordRequests(page);
    await signedIn(page);
    await page.goto("/beta");
    await expect(testerId(page)).toHaveText(/^[0-9a-f]{10}$/);
    await page.waitForLoadState("networkidle");
    const appFiles = urls.filter((p) => p === "/app.html" || p === "/sw.js" || p.startsWith("/js/") || p.startsWith("/css/") || p.startsWith("/data/"));
    expect(appFiles).toEqual([]);
    expect(await page.evaluate(() => typeof window.state)).toBe("undefined");
  });

  test("at 320px wide there is no sideways scroll and every control is at least 44px tall", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await stubShare(page, "none");
    await signedIn(page);
    await page.goto("/beta");
    await expect(send(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const control of await page.locator("a:visible, button:visible").all()) {
      const box = await control.boundingBox();
      expect(box && box.height).toBeGreaterThanOrEqual(44);
    }
  });
});
