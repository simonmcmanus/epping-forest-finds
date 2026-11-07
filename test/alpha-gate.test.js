/**
 * Closed alpha gate (netlify/edge-functions/alpha-gate.js), run as the edge runtime would call it:
 * a Request in, a Response (or the pass-through) out. Covers who gets into the app, how the shared link
 * is redeemed, and that every route netlify.toml serves the app on is actually behind the gate.
 * See spec/spec-alpha-access.md.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const gateUrl = pathToFileURL(path.join(root, "netlify", "edge-functions", "alpha-gate.js")).href;

// The module is ES syntax in a package without "type": "module", so Node prints a one-line reparse warning
// on import. It is expected, and it is not a failure, so it is kept out of the test output.
async function loadGate() {
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {};
  try { return await import(gateUrl); } finally { process.emitWarning = emitWarning; }
}

const PASS_THROUGH = { passed: "through to the app" };

// Runs the gate with ALPHA_SECRETS set to `secrets` (undefined = unset) for a request to `url`.
async function visit(url, { secrets, cookie } = {}) {
  const gate = await loadGate();
  globalThis.Netlify = { env: { get: (name) => (name === "ALPHA_SECRETS" ? secrets : undefined) } };
  const headers = cookie ? { cookie } : {};
  const context = { next: () => PASS_THROUGH };
  return gate.default(new Request(url, { headers }), context);
}

const cookieHeader = (response) => response.headers.get("set-cookie") || "";

test("with ALPHA_SECRETS unset the app is open to everyone", async () => {
  assert.deepEqual(await visit("https://site.example/community", { secrets: undefined }), PASS_THROUGH);
  assert.deepEqual(await visit("https://site.example/community", { secrets: "" }), PASS_THROUGH);
});

test("an uninvited visitor to the app is sent to the homepage, and no access cookie is given", async () => {
  const response = await visit("https://site.example/community", { secrets: "longhorn" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/");
  assert.equal(cookieHeader(response), "");
});

test("a wrong shared link gets the same redirect as no link and no cookie", async () => {
  const response = await visit("https://site.example/settings?k=guess", { secrets: "longhorn" });
  assert.equal(response.headers.get("location"), "/");
  assert.equal(cookieHeader(response), "");
});

test("the shared link opens the app, takes the secret out of the address and keeps everything else", async () => {
  const response = await visit("https://site.example/community?tab=log&k=longhorn#top", { secrets: "longhorn" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/community?tab=log#top", "k is removed; the other query and the hash stay");
  assert.match(cookieHeader(response), /^ef_alpha=longhorn;/);
});

test("the access cookie is HttpOnly, same-site, lasts a year and is Secure on a real site", async () => {
  const cookie = cookieHeader(await visit("https://site.example/nearby?k=longhorn", { secrets: "longhorn" }));
  for (const attribute of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=31536000", "Secure"]) {
    assert.ok(cookie.includes(attribute), `cookie should carry ${attribute}: ${cookie}`);
  }
});

test("on localhost the access cookie is not Secure, so a browser on plain http keeps it", async () => {
  const cookie = cookieHeader(await visit("http://localhost:8888/community?k=longhorn", { secrets: "longhorn" }));
  assert.ok(cookie.startsWith("ef_alpha=longhorn;"));
  assert.ok(!cookie.includes("Secure"));
});

test("a visitor who already holds the access cookie goes straight into the app", async () => {
  const result = await visit("https://site.example/community", { secrets: "longhorn", cookie: "ef_alpha=longhorn" });
  assert.deepEqual(result, PASS_THROUGH);
});

test("removing a secret from ALPHA_SECRETS locks out everyone who holds a cookie for it", async () => {
  const result = await visit("https://site.example/community", { secrets: "newer-secret", cookie: "ef_alpha=longhorn" });
  assert.equal(result.headers.get("location"), "/");
});

test("several secrets can be valid at once, with spaces and empty entries ignored", async () => {
  const secrets = "  alpha-one , ,alpha-two,";
  assert.deepEqual(await visit("https://site.example/community", { secrets, cookie: "ef_alpha=alpha-two" }), PASS_THROUGH);
  const viaLink = await visit("https://site.example/community?k=alpha-one", { secrets });
  assert.equal(viaLink.headers.get("location"), "/community");
});

test("every route netlify.toml serves the app on is behind the gate", async () => {
  const gate = await loadGate();
  const gated = new Set(gate.config.path);
  const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  const blocks = toml.split("[[redirects]]").slice(1);
  const appRoutes = blocks
    .map((block) => ({
      from: (block.match(/^\s*from\s*=\s*"([^"]+)"/m) || [])[1],
      to: (block.match(/^\s*to\s*=\s*"([^"]+)"/m) || [])[1],
    }))
    .filter((rule) => rule.to === "/app.html" && rule.from)
    .map((rule) => rule.from);
  assert.ok(appRoutes.includes("/community"), "the parse should find the app's own routes");
  assert.deepEqual(appRoutes.filter((route) => !gated.has(route)), [], "an app route that is not gated would open the alpha");
  assert.ok(gated.has("/app.html"), "the app's own entry page is gated as well");
});
