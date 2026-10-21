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
    async list(prefix) { return [...data.keys()].filter((k) => k.startsWith(prefix)); },
    async delete(key) { data.delete(key); },
    has: (key) => data.has(key),
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
  assert.deepStrictEqual(await store.list("accountdevices/a/"), ["accountdevices/a/device-one-1"]);
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

// --- Linking ownership, and one account as one voice ---
const consensus = require("../netlify/functions/lib/community-consensus.js");
const links = require("../netlify/functions/lib/community-links.js");
const rateLimit = require("../netlify/functions/lib/report-rate-limit.js");

// A store whose every call yields, so concurrent callers really interleave. `delays` can hold a call back.
function slowStore({ failPut } = {}) {
  const data = new Map();
  const tick = (n = 1) => new Promise((resolve) => setTimeout(resolve, n));
  return {
    data,
    async get(key) { await tick(); return data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null; },
    async put(key, value) {
      await tick();
      if (failPut && failPut(key)) throw new Error("store down");
      data.set(key, JSON.parse(JSON.stringify(value)));
    },
    async list(prefix) { await tick(); return [...data.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

test("two accounts linking the same device at once end with exactly one owner, and the other can never read it", async () => {
  for (const [delayA, delayB] of [[0, 0], [0, 3], [3, 0], [1, 2], [2, 1]]) {
    const store = slowStore();
    const A = account.accountKey("auth0|a");
    const B = account.accountKey("auth0|b");
    const later = (ms, fn) => new Promise((resolve) => setTimeout(resolve, ms)).then(fn);
    await Promise.all([
      later(delayA, () => account.linkDevice(store, A, "contested-device")),
      later(delayB, () => account.linkDevice(store, B, "contested-device")),
    ]);
    const owner = (await store.get("devicelink/contested-device")).account;
    assert.ok(owner === A || owner === B, "one authoritative owner");
    const ownerSub = owner === A ? "auth0|a" : "auth0|b";
    const otherSub = owner === A ? "auth0|b" : "auth0|a";
    // Both accounts may hold a marker (a link that lost the race can still write one), but only the owner's
    // account reads the device as part of its set; the other gets nothing from it.
    assert.deepStrictEqual(await account.devicesForRequest(store, "contested-device", { sub: ownerSub }), ["contested-device"]);
    assert.deepStrictEqual(await account.devicesForRequest(store, "contested-device", { sub: otherSub }), [], "the account that lost the race gets none of that device");
    await store.put(`accountdevices/${account.accountKey(otherSub)}/phantom-device-1`, {});
    const otherSet = await account.devicesForRequest(store, "contested-device", { sub: otherSub });
    assert.ok(!otherSet.includes("phantom-device-1") || otherSet.length === 1, "a marker without the owner record is never trusted");
    const ownerSet = await account.devicesForRequest(store, "contested-device", { sub: ownerSub });
    assert.ok(ownerSet.includes("contested-device"));
  }
});

test("a stray marker is not trusted: a device owned by someone else is not returned", async () => {
  const store = slowStore();
  const A = account.accountKey("auth0|a");
  await store.put(`accountdevices/${A}/phone-device-1`, {});
  await store.put(`accountdevices/${A}/stolen-device-1`, {});
  await store.put("devicelink/phone-device-1", { account: A });
  await store.put("devicelink/stolen-device-1", { account: "someone-else" });
  assert.deepStrictEqual(await account.devicesForRequest(store, "phone-device-1", { sub: "auth0|a" }), ["phone-device-1"]);
  assert.deepStrictEqual(await account.devicesForRequest(store, "stolen-device-1", { sub: "auth0|a" }), ["phone-device-1"], "someone else's device is never returned; the account sees only its own");
});

test("a signed-in account never reads a device that belongs to another account, and an anonymous caller still reads the device alone", async () => {
  const store = slowStore();
  const A = account.accountKey("auth0|a");
  const B = account.accountKey("auth0|b");
  await account.linkDevice(store, A, "shared-browser-1");
  await account.linkDevice(store, B, "bobs-phone-0001");
  assert.strictEqual((await account.linkDevice(store, B, "shared-browser-1")).status, 409, "B cannot take A's device");
  assert.deepStrictEqual(await account.devicesForRequest(store, "shared-browser-1", { sub: "auth0|b" }), ["bobs-phone-0001"], "B asking about A's device gets only B's own devices");
  assert.deepStrictEqual(await account.devicesForRequest(store, "shared-browser-1", { sub: "auth0|a" }), ["shared-browser-1"], "A still reads it");
  assert.deepStrictEqual(await account.devicesForRequest(store, "shared-browser-1", null), ["shared-browser-1"], "no session: the device alone, as before");
  const nobody = account.accountKey("auth0|c");
  assert.deepStrictEqual(await account.devicesForRequest(store, "shared-browser-1", { sub: "auth0|c" }), [], "an account with no devices of its own gets nothing from someone else's");
  assert.ok(nobody);
  assert.deepStrictEqual(await account.devicesForRequest(store, "unowned-device-1", { sub: "auth0|c" }), ["unowned-device-1"], "an unowned device is read alone until it is linked");
});

test("a failure between the two writes leaves the device owned but not a member, and linking again finishes the job", async () => {
  let fail = true;
  const store = slowStore({ failPut: (key) => fail && key.startsWith("accountdevices/") });
  const A = account.accountKey("auth0|a");
  await assert.rejects(account.linkDevice(store, A, "half-linked-1"), /store down/);
  assert.deepStrictEqual(await store.get("devicelink/half-linked-1"), { account: A }, "the owner record was written first");
  assert.deepStrictEqual(await store.list(`accountdevices/${A}/`), []);
  assert.strictEqual((await account.linkDevice(store, account.accountKey("auth0|b"), "half-linked-1")).status, 409, "nobody else can take it meanwhile");
  fail = false;
  assert.deepStrictEqual(await account.linkDevice(store, A, "half-linked-1"), { ok: true });
  assert.deepStrictEqual(await store.list(`accountdevices/${A}/`), [`accountdevices/${A}/half-linked-1`]);
});

test("concurrent links of different devices to one account all stick: there is no shared list to overwrite", async () => {
  const store = slowStore();
  const A = account.accountKey("auth0|a");
  const devices = ["device-aaaa-1", "device-bbbb-2", "device-cccc-3", "device-dddd-4", "device-eeee-5"];
  await Promise.all(devices.map((d) => account.linkDevice(store, A, d)));
  assert.strictEqual((await store.list(`accountdevices/${A}/`)).length, devices.length);
  assert.deepStrictEqual((await account.devicesForRequest(store, "device-cccc-3", { sub: "auth0|a" })).sort(), [...devices].sort());
});

test("owners are read from the owner records, with nothing stored for unlinked devices", async () => {
  const store = slowStore();
  await store.put("devicelink/phone-device-1", { account: "acct-1" });
  await store.put("accountdevices/acct-1/phone-device-1", {});
  const owners = await links.loadDeviceOwners(store);
  assert.strictEqual(owners["phone-device-1"], "acct-1");
  assert.strictEqual(owners["laptop-device-1"], undefined);
  assert.deepStrictEqual(await links.loadDeviceOwners({ list() { throw new Error("down"); }, get() {} }), Object.create(null), "a failing store means no merging, not a failing rebuild");
});

function treeReport(id, deviceId, status = "VERIFIED", extra = {}) {
  return { id, deviceId, kind: "tree", target: "tree:42", status, targetLat: 51.64, targetLon: 0.01, lat: 51.64, lon: 0.01, ts: 1, ...extra };
}

test("devices linked to one account are one voice: they cannot confirm each other's checks", () => {
  const reports = [treeReport("report-0001", "phone-device-1"), treeReport("report-0002", "laptop-device-1")];
  const alone = consensus.computeCommunityState(reports);
  assert.strictEqual(alone.overlay["tree:42"].s, "confirmed", "anonymous devices are separate voices");
  const owners = { "phone-device-1": "acct-1", "laptop-device-1": "acct-1" };
  const linked = consensus.computeCommunityState(reports, [], owners);
  assert.strictEqual(linked.overlay["tree:42"].s, "verified", "one account is one voice");
  assert.strictEqual(linked.overlay["tree:42"].n, 1);
  const bonus = Object.values(linked.scores).reduce((sum, score) => sum + score.confirmed, 0);
  assert.strictEqual(bonus, 0, "no confirmed-by-others bonus between one person's own devices");
  const third = consensus.computeCommunityState([...reports, treeReport("report-0003", "stranger-device-1")], [], owners);
  assert.strictEqual(third.overlay["tree:42"].s, "confirmed", "a different person still confirms it");
});

test("several linked devices cannot make a tree 'questioned' on their own", () => {
  const reports = ["phone-device-1", "laptop-device-1", "tablet-device-1"].map((d, i) => treeReport(`report-q${i}-xx`, d, "NOT_HERE"));
  const owners = { "phone-device-1": "acct-1", "laptop-device-1": "acct-1", "tablet-device-1": "acct-1" };
  assert.strictEqual(consensus.computeCommunityState(reports).overlay["tree:42"].s, "questioned");
  assert.strictEqual(consensus.computeCommunityState(reports, [], owners).overlay["tree:42"], undefined, "one voice is not two agreeing people");
  const withOther = consensus.computeCommunityState([...reports, treeReport("report-q9-xx", "stranger-device-1", "NOT_HERE")], [], owners);
  assert.strictEqual(withOther.overlay["tree:42"].s, "questioned");
});

test("a signed-in account's linked devices share one reporting allowance", async () => {
  const store = memoryStore();
  const limits = { perIp: 100, perDevice: 2, global: 100 };
  const send = (deviceId) => rateLimit.checkRateLimit(store, { ip: "", deviceId, account: "acct-1", limits });
  assert.strictEqual((await send("phone-device-1")).ok, true);
  assert.strictEqual((await send("laptop-device-1")).ok, true);
  assert.strictEqual((await send("tablet-device-1")).ok, false, "a third device on the same account gets nothing extra");
});

// --- The OAuth handlers themselves (auth-login, auth-callback, auth-logout, auth-link, auth-me) ---
const login = require("../netlify/functions/auth-login.js");
const callback = require("../netlify/functions/auth-callback.js");
const logout = require("../netlify/functions/auth-logout.js");
const linkHandler = require("../netlify/functions/auth-link.js");
const meHandler = require("../netlify/functions/auth-me.js");

const AUTH_ENV = { AUTH0_DOMAIN: "tenant.example.auth0.test", AUTH0_CLIENT_ID: "client-id-1", AUTH0_CLIENT_SECRET: "client-secret-1", AUTH_SECRET: KEY };

async function withAuthEnv(run, { env = AUTH_ENV, fetchImpl } = {}) {
  const saved = {};
  for (const name of Object.keys(AUTH_ENV)) saved[name] = process.env[name];
  const originalFetch = global.fetch;
  const calls = [];
  for (const name of Object.keys(AUTH_ENV)) delete process.env[name];
  Object.assign(process.env, env);
  if (fetchImpl) global.fetch = async (url, options = {}) => { calls.push({ url: String(url), options }); return fetchImpl(String(url), options); };
  try {
    return await run(calls);
  } finally {
    global.fetch = originalFetch;
    for (const name of Object.keys(AUTH_ENV)) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  }
}

const HOST = { host: "example.test", "x-forwarded-proto": "https" };
const cookiesOf = (result) => (result.multiValueHeaders && result.multiValueHeaders["Set-Cookie"]) || [];
const cookieNamed = (result, name) => cookiesOf(result).find((c) => c.startsWith(`${name}=`));
const cookieValue = (cookie) => decodeURIComponent(cookie.split(";")[0].slice(cookie.indexOf("=") + 1));

// Runs a login and returns what the browser would hold: the state value and the signed state cookie.
async function startLogin(returnTo = "/community") {
  const result = await login.handler({ queryStringParameters: { return: returnTo }, headers: HOST });
  const location = new URL(result.headers.Location);
  const stateCookie = cookieNamed(result, "ff_auth_state");
  return { result, location, state: location.searchParams.get("state"), stateCookie };
}
const callbackEvent = (query, cookie) => ({ queryStringParameters: query, headers: { ...HOST, ...(cookie ? { cookie } : {}) } });
const providerOk = (user = { sub: "auth0|abc123", name: "Sam Walker" }) => (url) => {
  if (url.endsWith("/oauth/token")) return { ok: true, status: 200, json: async () => ({ access_token: "tok-1" }) };
  if (url.endsWith("/userinfo")) return { ok: true, status: 200, json: async () => user };
  throw new Error(`unexpected ${url}`);
};
const failed = (result) => result.headers.Location === "/community?signin=failed";

test("login without configuration answers 503 and starts nothing", async () => {
  await withAuthEnv(async () => {
    const result = await login.handler({ queryStringParameters: {}, headers: HOST });
    assert.strictEqual(result.statusCode, 503);
    assert.strictEqual(cookiesOf(result).length, 0);
  }, { env: {} });
  await withAuthEnv(async () => {
    const result = await login.handler({ queryStringParameters: {}, headers: HOST });
    assert.strictEqual(result.statusCode, 503, "a secret under 32 characters counts as not configured");
  }, { env: { ...AUTH_ENV, AUTH_SECRET: "short" } });
});

test("login redirects to the provider with a fresh state that is also in a signed, short-lived, HttpOnly cookie", async () => {
  await withAuthEnv(async () => {
    const first = await startLogin("/community");
    assert.strictEqual(first.result.statusCode, 302);
    assert.strictEqual(first.location.origin, "https://tenant.example.auth0.test");
    assert.strictEqual(first.location.pathname, "/authorize");
    assert.strictEqual(first.location.searchParams.get("response_type"), "code");
    assert.strictEqual(first.location.searchParams.get("client_id"), "client-id-1");
    assert.strictEqual(first.location.searchParams.get("redirect_uri"), "https://example.test/api/auth/callback");
    assert.strictEqual(first.location.searchParams.get("scope"), "openid profile");
    assert.ok(first.state && first.state.length >= 16);
    const attributes = first.stateCookie.split(";").map((p) => p.trim());
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=600"]) assert.ok(attributes.includes(attribute), `state cookie has ${attribute}`);
    const payload = auth.verify(cookieValue(first.stateCookie), KEY);
    assert.strictEqual(payload.state, first.state);
    assert.strictEqual(payload.ret, "/community");
    const second = await startLogin();
    assert.notStrictEqual(second.state, first.state, "every sign-in gets its own state");
  });
});

test("login remembers only a same-site return path", async () => {
  await withAuthEnv(async () => {
    const own = await startLogin("/community#top");
    assert.strictEqual(auth.verify(cookieValue(own.stateCookie), KEY).ret, "/community#top");
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example"]) {
      const attempt = await startLogin(bad);
      assert.strictEqual(auth.verify(cookieValue(attempt.stateCookie), KEY).ret, "/community", `${bad} falls back to /community`);
    }
  });
});

test("callback: a good sign-in exchanges the code, sets a signed session cookie and returns to where it started", async () => {
  await withAuthEnv(async (calls) => {
    const { state, stateCookie } = await startLogin("/community");
    const result = await callback.handler(callbackEvent({ code: "code-1", state }, `ff_auth_state=${encodeURIComponent(cookieValue(stateCookie))}`));
    assert.strictEqual(result.statusCode, 302);
    assert.strictEqual(result.headers.Location, "/community");
    const [tokenCall, profileCall] = calls;
    assert.strictEqual(tokenCall.url, "https://tenant.example.auth0.test/oauth/token");
    assert.strictEqual(tokenCall.options.method, "POST");
    assert.deepStrictEqual(JSON.parse(tokenCall.options.body), {
      grant_type: "authorization_code", client_id: "client-id-1", client_secret: "client-secret-1", code: "code-1", redirect_uri: "https://example.test/api/auth/callback",
    });
    assert.strictEqual(profileCall.url, "https://tenant.example.auth0.test/userinfo");
    assert.strictEqual(profileCall.options.headers.Authorization, "Bearer tok-1");
    const session = cookieNamed(result, "ff_session");
    const attributes = session.split(";").map((p) => p.trim());
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", `Max-Age=${auth.SESSION_MS / 1000}`]) assert.ok(attributes.includes(attribute), `session cookie has ${attribute}`);
    const payload = auth.verify(cookieValue(session), KEY);
    assert.strictEqual(payload.sub, "auth0|abc123");
    assert.strictEqual(payload.name, "Sam Walker");
    assert.ok(payload.exp > Date.now() && payload.exp <= Date.now() + auth.SESSION_MS + 1000);
    assert.deepStrictEqual(Object.keys(payload).sort(), ["exp", "name", "sub"], "nothing else, such as an email address, is kept in the cookie");
    assert.ok(cookieNamed(result, "ff_auth_state").includes("Max-Age=0"), "the one-time state cookie is cleared");
  }, { fetchImpl: providerOk() });
});

test("callback: an email address from the provider never becomes the display name", async () => {
  await withAuthEnv(async () => {
    const { state, stateCookie } = await startLogin();
    const result = await callback.handler(callbackEvent({ code: "c", state }, `ff_auth_state=${encodeURIComponent(cookieValue(stateCookie))}`));
    assert.strictEqual(auth.verify(cookieValue(cookieNamed(result, "ff_session")), KEY).name, "Walker");
  }, { fetchImpl: providerOk({ sub: "auth0|e", name: "sam@example.com", email: "sam@example.com" }) });
});

test("callback refuses a missing code, a missing or mismatched state, an expired or forged state cookie, without calling the provider", async () => {
  await withAuthEnv(async (calls) => {
    const { state, stateCookie } = await startLogin("/community");
    const goodCookie = `ff_auth_state=${encodeURIComponent(cookieValue(stateCookie))}`;
    const cases = {
      "no code": callbackEvent({ state }, goodCookie),
      "no state cookie": callbackEvent({ code: "c", state }, undefined),
      "no state in the query": callbackEvent({ code: "c" }, goodCookie),
      "state mismatch": callbackEvent({ code: "c", state: "not-the-state" }, goodCookie),
      "an expired state cookie": callbackEvent({ code: "c", state }, `ff_auth_state=${encodeURIComponent(auth.sign({ state, ret: "/community", exp: Date.now() - 1000 }, KEY))}`),
      "a state cookie signed with another key": callbackEvent({ code: "c", state }, `ff_auth_state=${encodeURIComponent(auth.sign({ state, ret: "/community", exp: Date.now() + 60000 }, "z".repeat(40)))}`),
      "a garbled state cookie": callbackEvent({ code: "c", state }, "ff_auth_state=not-a-token"),
      "a session cookie offered as the state": callbackEvent({ code: "c", state }, `ff_auth_state=${encodeURIComponent(auth.sign({ sub: "auth0|1", exp: Date.now() + 60000 }, KEY))}`),
    };
    for (const [name, event] of Object.entries(cases)) {
      const result = await callback.handler(event);
      assert.ok(failed(result), `${name}: sends the user back with signin=failed`);
      assert.strictEqual(cookieNamed(result, "ff_session"), undefined, `${name}: no session is issued`);
      assert.ok(cookieNamed(result, "ff_auth_state").includes("Max-Age=0"), `${name}: the state cookie is cleared`);
    }
    assert.strictEqual(calls.length, 0, "none of these reached the provider");
  }, { fetchImpl: providerOk() });
});

test("callback: a state cookie cannot be replayed for a different state, and the return path comes only from the signed cookie", async () => {
  await withAuthEnv(async () => {
    const mine = await startLogin("/community");
    const other = await startLogin("/community");
    const result = await callback.handler(callbackEvent({ code: "c", state: other.state }, `ff_auth_state=${encodeURIComponent(cookieValue(mine.stateCookie))}`));
    assert.ok(failed(result), "state from one sign-in against the cookie of another is refused");
    const ok = await callback.handler(callbackEvent({ code: "c", state: mine.state, return: "https://evil.example/" }, `ff_auth_state=${encodeURIComponent(cookieValue(mine.stateCookie))}`));
    assert.strictEqual(ok.headers.Location, "/community", "a return parameter on the callback is ignored");
  }, { fetchImpl: providerOk() });
});

test("callback: provider failures send the user back with signin=failed and issue no session", async () => {
  const run = async (fetchImpl) => withAuthEnv(async () => {
    const { state, stateCookie } = await startLogin();
    return callback.handler(callbackEvent({ code: "c", state }, `ff_auth_state=${encodeURIComponent(cookieValue(stateCookie))}`));
  }, { fetchImpl });
  const cases = {
    "the token exchange is refused": (url) => (url.endsWith("/oauth/token") ? { ok: false, status: 403, json: async () => ({}) } : providerOk()(url)),
    "the token response is not JSON": (url) => (url.endsWith("/oauth/token") ? { ok: true, status: 200, json: async () => { throw new Error("bad json"); } } : providerOk()(url)),
    "the profile request fails": (url) => (url.endsWith("/userinfo") ? { ok: false, status: 401, json: async () => ({}) } : providerOk()(url)),
    "the profile has no subject": (url) => (url.endsWith("/userinfo") ? { ok: true, status: 200, json: async () => ({ name: "Nobody" }) } : providerOk()(url)),
    "the network fails": () => { throw new Error("offline"); },
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    const result = await run(fetchImpl);
    assert.ok(failed(result), name);
    assert.strictEqual(cookieNamed(result, "ff_session"), undefined, `${name}: no session`);
    assert.ok(cookieNamed(result, "ff_auth_state").includes("Max-Age=0"), `${name}: state cleared`);
  }
});

test("callback without configuration answers 503", async () => {
  await withAuthEnv(async () => {
    assert.strictEqual((await callback.handler(callbackEvent({ code: "c", state: "s" }))).statusCode, 503);
  }, { env: {} });
});

test("logout clears the session cookie and only returns to a same-site path", async () => {
  await withAuthEnv(async () => {
    const result = await logout.handler({ queryStringParameters: { return: "/community" }, headers: HOST });
    assert.strictEqual(result.statusCode, 302);
    assert.strictEqual(result.headers.Location, "/community");
    const cleared = cookieNamed(result, "ff_session");
    assert.ok(cleared.includes("Max-Age=0") && cleared.includes("HttpOnly") && cleared.includes("Secure"));
    assert.strictEqual((await logout.handler({ queryStringParameters: { return: "https://evil.example" }, headers: HOST })).headers.Location, "/community");
  });
});

test("me reports who is signed in and never an error for a visitor; link refuses anyone who is not", async () => {
  await withAuthEnv(async () => {
    const token = auth.sign({ sub: "auth0|9", name: "Sam", exp: Date.now() + 60000 }, KEY);
    const signedIn = await meHandler.handler({ headers: { cookie: `ff_session=${encodeURIComponent(token)}` } });
    assert.deepStrictEqual(JSON.parse(signedIn.body), { signedIn: true, name: "Sam", account: account.accountKey("auth0|9") });
    assert.strictEqual(signedIn.body.includes("auth0|9"), false, "the provider id is not sent to the page");
    const anonymous = await meHandler.handler({ headers: {} });
    assert.strictEqual(anonymous.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(anonymous.body), { signedIn: false });
    const expired = auth.sign({ sub: "auth0|9", name: "Sam", exp: Date.now() - 1000 }, KEY);
    assert.deepStrictEqual(JSON.parse((await meHandler.handler({ headers: { cookie: `ff_session=${encodeURIComponent(expired)}` } })).body), { signedIn: false });
    assert.strictEqual((await linkHandler.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ deviceId: "phone-device-1" }) })).statusCode, 401);
    assert.strictEqual((await linkHandler.handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
    const cookie = `ff_session=${encodeURIComponent(token)}`;
    assert.strictEqual((await linkHandler.handler({ httpMethod: "POST", headers: { cookie }, body: JSON.stringify({ deviceId: "x" }) })).statusCode, 400);
    assert.strictEqual((await linkHandler.handler({ httpMethod: "POST", headers: { cookie }, body: "{not json" })).statusCode, 400);
  });
});
test("cookies are Secure over https and not over plain http on localhost, where a Secure cookie could never come back", async () => {
  await withAuthEnv(async () => {
    const local = { host: "localhost:8888" };
    const attributesOf = (cookie) => cookie.split(";").map((p) => p.trim());
    // Over https (a deploy): Secure on every cookie.
    const https = await startLogin();
    assert.ok(attributesOf(https.stateCookie).includes("Secure"));
    // Over http on localhost: no Secure, but still HttpOnly and SameSite=Lax.
    const started = await login.handler({ queryStringParameters: {}, headers: local });
    const stateCookie = cookieNamed(started, "ff_auth_state");
    const stateAttrs = attributesOf(stateCookie);
    assert.ok(!stateAttrs.includes("Secure"), "the state cookie is not Secure over http");
    assert.ok(stateAttrs.includes("HttpOnly") && stateAttrs.includes("SameSite=Lax"));
    assert.strictEqual(new URL(started.headers.Location).searchParams.get("redirect_uri"), "http://localhost:8888/api/auth/callback");
    const state = new URL(started.headers.Location).searchParams.get("state");
    const done = await callback.handler({ queryStringParameters: { code: "c", state }, headers: { ...local, cookie: `ff_auth_state=${encodeURIComponent(cookieValue(stateCookie))}` } });
    assert.strictEqual(done.headers.Location, "/community");
    const sessionAttrs = attributesOf(cookieNamed(done, "ff_session"));
    assert.ok(!sessionAttrs.includes("Secure") && sessionAttrs.includes("HttpOnly"), "the session cookie works over http on localhost");
    assert.ok(!attributesOf(cookieNamed(done, "ff_auth_state")).includes("Secure"));
    const out = await logout.handler({ queryStringParameters: {}, headers: local });
    assert.ok(!attributesOf(cookieNamed(out, "ff_session")).includes("Secure"));
    // A deployed host behind a proxy that says it is https stays Secure, and so does an unknown host with no hint.
    const proxied = await logout.handler({ queryStringParameters: {}, headers: { host: "preview.example.test", "x-forwarded-proto": "https" } });
    assert.ok(attributesOf(cookieNamed(proxied, "ff_session")).includes("Secure"));
    const bare = await logout.handler({ queryStringParameters: {}, headers: { host: "preview.example.test" } });
    assert.ok(attributesOf(cookieNamed(bare, "ff_session")).includes("Secure"), "https is assumed for a real host");
  }, { fetchImpl: providerOk() });
});


// The early-access list names a person by one Tester ID. Signing in on a second device must not lose it.
test("a person named by one device keeps early access on their other device once both are linked to the account", async () => {
  const gate = require("../netlify/functions/lib/feature-gate.js");
  const store = memoryStore();
  const session = { sub: "auth0|sam" };
  await account.linkDevice(store, account.accountKey(session.sub), "phone-device-aaaa1");
  await account.linkDevice(store, account.accountKey(session.sub), "laptop-device-bbbb2");
  // The admin added what the phone's Settings showed: the phone device's Tester ID.
  const list = gate.normalizeList({ community: [{ id: gate.testerHash("phone-device-aaaa1"), note: "Sam" }] });

  // On the laptop, signed in: its own hash is not on the list, but its account's other device is.
  const laptopIds = await gate.vouchedIds(store, gate.testerHash("laptop-device-bbbb2"), session);
  assert.strictEqual(gate.enabledFor(list, laptopIds).community, true);
  // Signed out, the laptop alone is still not on the list.
  const signedOut = await gate.vouchedIds(store, gate.testerHash("laptop-device-bbbb2"), null);
  assert.strictEqual(gate.enabledFor(list, signedOut).community, false);
});

test("early access does not leak to a different account, or to a device linked to one", async () => {
  const gate = require("../netlify/functions/lib/feature-gate.js");
  const store = memoryStore();
  await account.linkDevice(store, account.accountKey("auth0|sam"), "phone-device-aaaa1");
  await account.linkDevice(store, account.accountKey("auth0|alex"), "other-device-cccc3");
  const list = gate.normalizeList({ community: [{ id: gate.testerHash("phone-device-aaaa1"), note: "Sam" }] });
  const alexIds = await gate.vouchedIds(store, gate.testerHash("other-device-cccc3"), { sub: "auth0|alex" });
  assert.strictEqual(gate.enabledFor(list, alexIds).community, false);
});

test("a person is also let in when the admin names their account's Tester ID", async () => {
  const gate = require("../netlify/functions/lib/feature-gate.js");
  const store = memoryStore();
  const session = { sub: "auth0|sam" };
  const list = gate.normalizeList({ community: [{ id: gate.testerHash(account.accountKey(session.sub)), note: "Sam" }] });
  const ids = await gate.vouchedIds(store, gate.testerHash("brand-new-device-1"), session);
  assert.strictEqual(gate.enabledFor(list, ids).community, true);
});

// --- Merging two sign-ins ---
const sessionCookieFor = (sub) => `ff_session=${auth.sign({ sub, name: "Sam", exp: Date.now() + 60000 }, KEY)}`;

test("merging moves the old sign-in's devices into the account and both logins then see all of them", async () => {
  const store = memoryStore();
  const a = account.accountKey("auth0|a");
  const b = account.accountKey("auth0|b");
  await account.linkDevice(store, a, "device-of-a-0001");
  await account.linkDevice(store, b, "device-of-b-0001");
  await account.linkDevice(store, b, "device-of-b-0002");
  // B is the account the person is signed in as; A is the second sign-in being brought in.
  assert.deepStrictEqual(await account.mergeAccounts(store, a, b), { ok: true, same: false, moved: 1 });
  const together = ["device-of-a-0001", "device-of-b-0001", "device-of-b-0002"];
  assert.deepStrictEqual((await account.devicesForRequest(store, "device-of-b-0001", { sub: "auth0|b" })).sort(), together);
  // The merged-away login still signs in, as the same account, and sees the same devices (so the same points).
  assert.strictEqual(await account.accountOf(store, { sub: "auth0|a" }), b);
  assert.deepStrictEqual((await account.devicesForRequest(store, "device-of-a-0001", { sub: "auth0|a" })).sort(), together);
  assert.strictEqual(store.has(`accountdevices/${a}/device-of-a-0001`), false, "the old marker is gone");
  // Linking a device for the merged-away login lands on the surviving account, not a 409.
  assert.deepStrictEqual(await account.linkDevice(store, await account.accountOf(store, { sub: "auth0|a" }), "device-of-a-0002"), { ok: true });
  assert.ok((await account.devicesOfAccount(store, { sub: "auth0|b" })).includes("device-of-a-0002"));
});

test("merging an account into itself, or twice, changes nothing", async () => {
  const store = memoryStore();
  const a = account.accountKey("auth0|a");
  const b = account.accountKey("auth0|b");
  await account.linkDevice(store, a, "device-of-a-0001");
  assert.deepStrictEqual(await account.mergeAccounts(store, a, a), { ok: true, same: true, moved: 0 });
  await account.mergeAccounts(store, a, b);
  assert.deepStrictEqual(await account.mergeAccounts(store, a, b), { ok: true, same: true, moved: 0 });
});

test("a merge that would put more devices in one account than it can hold is refused and moves nothing", async () => {
  const store = memoryStore();
  const a = account.accountKey("auth0|a");
  const b = account.accountKey("auth0|b");
  for (let i = 0; i < 12; i++) await account.linkDevice(store, a, `a-device-${i}-xxxx`);
  for (let i = 0; i < 12; i++) await account.linkDevice(store, b, `b-device-${i}-xxxx`);
  const result = await account.mergeAccounts(store, a, b);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 409);
  assert.strictEqual((await store.get("devicelink/a-device-0-xxxx")).account, a);
  assert.strictEqual(await account.canonicalAccount(store, a), a, "no alias was written");
});

test("a merge another login starts only when signed in, and the account is sealed into the state cookie", async () => {
  await withAuthEnv(async () => {
    const store = memoryStore();
    login.setStore(store);
    try {
      const signedOut = await login.handler({ queryStringParameters: { return: "/settings", merge: "1" }, headers: HOST });
      assert.strictEqual(auth.verify(cookieValue(cookieNamed(signedOut, "ff_auth_state")), KEY).merge, undefined, "no session, no merge");
      const signedIn = await login.handler({ queryStringParameters: { return: "/settings", merge: "1" }, headers: { ...HOST, cookie: sessionCookieFor("auth0|b") } });
      assert.strictEqual(auth.verify(cookieValue(cookieNamed(signedIn, "ff_auth_state")), KEY).merge, account.accountKey("auth0|b"));
      const plain = await login.handler({ queryStringParameters: { return: "/settings" }, headers: { ...HOST, cookie: sessionCookieFor("auth0|b") } });
      assert.strictEqual(auth.verify(cookieValue(cookieNamed(plain, "ff_auth_state")), KEY).merge, undefined, "an ordinary sign-in never merges");
    } finally { login.setStore(null); }
  });
});

test("the callback merges the second login into the signed-in account and leaves the session as it was", async () => {
  const store = memoryStore();
  const a = account.accountKey("auth0|a");
  const b = account.accountKey("auth0|b");
  await account.linkDevice(store, a, "device-of-a-0001");
  await account.linkDevice(store, b, "device-of-b-0001");
  await withAuthEnv(async () => {
    login.setStore(store);
    callback.setStore(store);
    try {
      const started = await login.handler({ queryStringParameters: { return: "/settings", merge: "1" }, headers: { ...HOST, cookie: sessionCookieFor("auth0|b") } });
      const state = new URL(started.headers.Location).searchParams.get("state");
      const stateCookie = cookieNamed(started, "ff_auth_state");
      const cookie = `${stateCookie.split(";")[0]}; ${sessionCookieFor("auth0|b")}`;
      const result = await callback.handler(callbackEvent({ code: "c", state }, cookie));
      assert.strictEqual(result.headers.Location, "/settings");
      assert.ok(cookieNamed(result, "ff_merge_result").startsWith("ff_merge_result=merged;"));
      assert.strictEqual(cookieNamed(result, "ff_session"), undefined, "the session is not replaced by the second login");
      assert.strictEqual(await account.canonicalAccount(store, a), b);
      assert.strictEqual((await store.get("devicelink/device-of-a-0001")).account, b);
    } finally { login.setStore(null); callback.setStore(null); }
  }, { fetchImpl: providerOk({ sub: "auth0|a", name: "Sam" }) });
});

test("the callback refuses to merge when the person is no longer signed in as the account the merge began from", async () => {
  const store = memoryStore();
  const a = account.accountKey("auth0|a");
  await account.linkDevice(store, a, "device-of-a-0001");
  await withAuthEnv(async () => {
    login.setStore(store);
    callback.setStore(store);
    try {
      const started = await login.handler({ queryStringParameters: { return: "/settings", merge: "1" }, headers: { ...HOST, cookie: sessionCookieFor("auth0|b") } });
      const state = new URL(started.headers.Location).searchParams.get("state");
      const stateCookie = cookieNamed(started, "ff_auth_state").split(";")[0];
      // Signed out by the time the provider sends them back, then signed in as someone else entirely.
      for (const cookie of [stateCookie, `${stateCookie}; ${sessionCookieFor("auth0|someone-else")}`]) {
        const result = await callback.handler(callbackEvent({ code: "c", state }, cookie));
        assert.ok(cookieNamed(result, "ff_merge_result").startsWith("ff_merge_result=failed;"));
        assert.strictEqual(await account.canonicalAccount(store, a), a, "nothing was merged");
        assert.strictEqual((await store.get("devicelink/device-of-a-0001")).account, a);
      }
    } finally { login.setStore(null); callback.setStore(null); }
  }, { fetchImpl: providerOk({ sub: "auth0|a", name: "Sam" }) });
});
