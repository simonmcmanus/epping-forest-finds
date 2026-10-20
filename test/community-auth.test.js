/**
 * Community sign-in (netlify/functions/lib/auth-session.js and lib/community-account.js).
 *
 * The provider does the login; these tests cover what we own: the signed cookie, the same-site
 * return path, the display name that never shows an email address, and how several anonymous
 * devices add up under one account.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const auth = require("../netlify/functions/lib/auth-session.js");
const account = require("../netlify/functions/lib/community-account.js");

const KEY = "k".repeat(40);

function memoryStore() {
  const data = new Map();
  return {
    async get(key) { return data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null; },
    async put(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
  };
}

test("a signed token verifies with the same key and is rejected with another", () => {
  const token = auth.sign({ sub: "auth0|1", exp: Date.now() + 1000 }, KEY);
  assert.strictEqual(auth.verify(token, KEY).sub, "auth0|1");
  assert.strictEqual(auth.verify(token, "x".repeat(40)), null);
});

test("a tampered token is rejected, even with the signature kept", () => {
  const token = auth.sign({ sub: "auth0|1", exp: Date.now() + 1000 }, KEY);
  const [, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "auth0|2", exp: Date.now() + 1000 })).toString("base64url");
  assert.strictEqual(auth.verify(`${forged}.${mac}`, KEY), null);
});

test("an expired token is rejected", () => {
  const token = auth.sign({ sub: "auth0|1", exp: 1000 }, KEY);
  assert.strictEqual(auth.verify(token, KEY, 2000), null);
});

test("garbage and missing tokens are rejected without throwing", () => {
  for (const token of [undefined, "", "nodot", ".", "a.b", 42]) assert.strictEqual(auth.verify(token, KEY), null);
  assert.strictEqual(auth.verify(auth.sign({ sub: "x", exp: Date.now() + 1000 }, KEY), undefined), null);
});

test("sign-in only returns to a same-site path", () => {
  assert.strictEqual(auth.safeReturnPath("/community"), "/community");
  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "community", "", undefined]) {
    assert.strictEqual(auth.safeReturnPath(bad), "/community", `refused ${bad}`);
  }
});

test("a session is read from the cookie header only when the config is set", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { AUTH0_DOMAIN: "a.example", AUTH0_CLIENT_ID: "id", AUTH0_CLIENT_SECRET: "s", AUTH_SECRET: KEY });
    const token = auth.sign({ sub: "auth0|9", name: "Sam", exp: Date.now() + 1000 }, KEY);
    const event = { headers: { Cookie: `other=1; ff_session=${encodeURIComponent(token)}` } };
    assert.strictEqual(auth.sessionFrom(event).name, "Sam");
    assert.strictEqual(auth.sessionFrom({ headers: {} }), null);
    delete process.env.AUTH0_DOMAIN;
    assert.strictEqual(auth.sessionFrom(event), null, "unconfigured deploys are anonymous, not errors");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("an email address is never shown as the display name", () => {
  assert.strictEqual(auth.displayName({ name: "Sam Walker" }), "Sam Walker");
  assert.strictEqual(auth.displayName({ name: "sam@example.com", nickname: "sam" }), "sam");
  assert.strictEqual(auth.displayName({ name: "sam@example.com" }), "Walker");
  assert.strictEqual(auth.displayName({}), "Walker");
});

test("the account key hides the provider id and is stable", () => {
  const key = account.accountKey("google-oauth2|12345");
  assert.strictEqual(key, account.accountKey("google-oauth2|12345"));
  assert.ok(!key.includes("google"));
  assert.notStrictEqual(key, account.accountKey("google-oauth2|12346"));
});

test("linking a device is idempotent and a device belongs to one account only", async () => {
  const store = memoryStore();
  assert.deepStrictEqual(await account.linkDevice(store, "a", "device-one-1"), { ok: true });
  assert.deepStrictEqual(await account.linkDevice(store, "a", "device-one-1"), { ok: true });
  assert.deepStrictEqual((await store.get("accounts/a")).devices, ["device-one-1"]);
  const other = await account.linkDevice(store, "b", "device-one-1");
  assert.strictEqual(other.ok, false);
  assert.strictEqual(other.status, 409);
});

test("an account stops taking devices at its cap", async () => {
  const store = memoryStore();
  for (let i = 0; i < account.MAX_DEVICES_PER_ACCOUNT; i++) await account.linkDevice(store, "a", `device-${i}-xxxx`);
  const refused = await account.linkDevice(store, "a", "device-extra-xxxx");
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.status, 409);
});

test("a request reads all of an account's devices only when it names one of them", async () => {
  const store = memoryStore();
  await account.linkDevice(store, account.accountKey("auth0|1"), "phone-device-1");
  await account.linkDevice(store, account.accountKey("auth0|1"), "laptop-device-1");
  const session = { sub: "auth0|1" };
  assert.deepStrictEqual((await account.devicesForRequest(store, "phone-device-1", session)).sort(), ["laptop-device-1", "phone-device-1"]);
  assert.deepStrictEqual(await account.devicesForRequest(store, "stranger-device-1", session), ["stranger-device-1"]);
  assert.deepStrictEqual(await account.devicesForRequest(store, "phone-device-1", null), ["phone-device-1"]);
});

test("scores from several devices add up, keeping the newest snapshot time", () => {
  const merged = account.mergeScores([
    { points: 5, reports: 2, verified: 1, confirmed: 0, validated: 0, fixed: 0, generatedAt: 100 },
    { points: 3, reports: 1, verified: 0, confirmed: 2, validated: 1, fixed: 0, generatedAt: 200 },
  ]);
  assert.strictEqual(merged.points, 8);
  assert.strictEqual(merged.reports, 3);
  assert.strictEqual(merged.confirmed, 2);
  assert.strictEqual(merged.generatedAt, 200);
});
