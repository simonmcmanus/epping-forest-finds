/**
 * Admin access (netlify/functions/lib/admin-auth.js and the admin sign-in endpoints).
 *
 * Two ways in: the admin password as a Bearer header (scripts), and the dashboard's signed ff_admin cookie,
 * issued after an Auth0 sign-in by an allow-listed subject (ADMIN_SUBJECTS). Cookie requests also need the
 * X-Requested-With: admin header, and stop working the moment the subject leaves the allowlist.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const adminAuth = require("../netlify/functions/lib/admin-auth.js");
const auth = require("../netlify/functions/lib/auth-session.js");
const login = require("../netlify/functions/auth-login.js");
const callback = require("../netlify/functions/auth-callback.js");
const me = require("../netlify/functions/admin-me.js");
const adminLogout = require("../netlify/functions/admin-logout.js");
const communityDelete = require("../netlify/functions/community-delete.js");

const { isAdminRequest } = adminAuth;
const KEY = "k".repeat(40);
const AUTH_ENV = { AUTH0_DOMAIN: "tenant.example.auth0.test", AUTH0_CLIENT_ID: "client-id-1", AUTH0_CLIENT_SECRET: "client-secret-1", AUTH_SECRET: KEY };
const HOST = { host: "example.test", "x-forwarded-proto": "https" };
const NAMES = [...Object.keys(AUTH_ENV), "ADMIN_SUBJECTS", "ADMIN_PASSWORD"];

async function withEnv(env, run, fetchImpl) {
  const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  const originalFetch = global.fetch;
  for (const n of NAMES) delete process.env[n];
  Object.assign(process.env, env);
  if (fetchImpl) global.fetch = async (url, options = {}) => fetchImpl(String(url), options);
  try { return await run(); } finally {
    global.fetch = originalFetch;
    for (const n of NAMES) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
  }
}
const ADMINS = { ...AUTH_ENV, ADMIN_SUBJECTS: "auth0|admin1, google-oauth2|777 ,," };

const cookieHeader = (sub, { key = KEY, exp = Date.now() + 3600000, name = "Ann" } = {}) => `ff_admin=${encodeURIComponent(auth.sign({ sub, name, exp }, key))}`;
const req = (cookie, csrf = "admin", extra = {}) => ({ httpMethod: "GET", headers: { ...HOST, cookie, ...(csrf ? { "X-Requested-With": csrf } : {}), ...extra } });
const bearer = (value) => ({ headers: { authorization: `Bearer ${value}` } });

// ---- The password as a Bearer header (unchanged) ----

test("the admin password works as a Bearer header, whatever the header's capitalisation", () => {
  assert.equal(isAdminRequest({ headers: { authorization: "Bearer s3cret-pass" } }, "s3cret-pass"), true);
  assert.equal(isAdminRequest({ headers: { Authorization: "Bearer s3cret-pass" } }, "s3cret-pass"), true);
});

test("a wrong, partial, longer or differently formed password is refused", () => {
  for (const header of ["Bearer s3cret", "Bearer s3cret-pass-extra", "Bearer S3CRET-PASS", "s3cret-pass", "Basic s3cret-pass", ""]) {
    assert.equal(isAdminRequest({ headers: { authorization: header } }, "s3cret-pass"), false, `"${header}" should be refused`);
  }
});

test("with no password configured, nobody is an admin by Bearer, even with an empty header", () => {
  assert.equal(isAdminRequest({ headers: { authorization: "Bearer " } }, ""), false);
  assert.equal(isAdminRequest({ headers: {} }, undefined), false);
});

test("a request with no headers at all is refused, not an exception", () => {
  assert.equal(isAdminRequest({}, "s3cret-pass"), false);
});

test("a password in the query string is still refused", () => {
  assert.equal(isAdminRequest({ headers: {}, queryStringParameters: { pw: "s3cret-pass" } }, "s3cret-pass"), false);
});

test("the old password-minted session token is no longer a way in", () => {
  assert.equal(isAdminRequest(bearer("1999999999999.".padEnd(78, "a")), "s3cret-pass"), false);
});

// ---- The allowlist ----

test("ADMIN_SUBJECTS is trimmed, blanks ignored, matched exactly, and empty or unset admits nobody", async () => {
  await withEnv({ ADMIN_SUBJECTS: " auth0|a , ,google-oauth2|1,, " }, async () => {
    assert.deepEqual(adminAuth.adminSubjects(), ["auth0|a", "google-oauth2|1"]);
    assert.equal(adminAuth.isAllowedSubject("auth0|a"), true);
    for (const other of ["AUTH0|A", "auth0|", "auth0|a2", "auth0", "", undefined, null]) assert.equal(adminAuth.isAllowedSubject(other), false, String(other));
  });
  await withEnv({ ADMIN_SUBJECTS: " , " }, async () => assert.equal(adminAuth.isAllowedSubject(""), false));
  await withEnv({}, async () => assert.equal(adminAuth.isAllowedSubject("auth0|a"), false));
});

// ---- The ff_admin cookie ----

test("a valid admin cookie with the CSRF header is accepted, even when no admin password is set", async () => {
  await withEnv(ADMINS, async () => {
    assert.equal(isAdminRequest(req(cookieHeader("auth0|admin1")), ""), true);
    assert.equal(isAdminRequest(req(cookieHeader("google-oauth2|777")), undefined), true);
  });
});

test("an admin cookie is refused without the X-Requested-With: admin header, for any method", async () => {
  await withEnv(ADMINS, async () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      assert.equal(isAdminRequest({ ...req(cookieHeader("auth0|admin1"), null), httpMethod: method }, ""), false, method);
    }
    assert.equal(isAdminRequest(req(cookieHeader("auth0|admin1"), "XMLHttpRequest"), ""), false);
  });
});

test("an expired, tampered, wrongly signed or unknown-subject admin cookie is refused", async () => {
  await withEnv(ADMINS, async () => {
    assert.equal(isAdminRequest(req(cookieHeader("auth0|admin1", { exp: Date.now() - 1000 })), ""), false, "expired");
    assert.equal(isAdminRequest(req(cookieHeader("auth0|admin1", { key: "x".repeat(40) })), ""), false, "wrong secret");
    assert.equal(isAdminRequest(req(cookieHeader("auth0|stranger")), ""), false, "signed but not on the list");
    const good = decodeURIComponent(cookieHeader("auth0|admin1").slice("ff_admin=".length));
    const forged = Buffer.from(JSON.stringify({ sub: "auth0|admin1", name: "x", exp: Date.now() + 9e9 })).toString("base64url");
    assert.equal(isAdminRequest(req(`ff_admin=${forged}.${good.split(".")[1]}`), ""), false, "tampered");
    assert.equal(isAdminRequest(req("ff_admin=garbage"), ""), false);
    assert.equal(isAdminRequest(req(cookieHeader("auth0|admin1").replace("ff_admin", "ff_session")), ""), false, "a community session is not an admin cookie");
  });
});

test("removing a subject from ADMIN_SUBJECTS revokes a cookie that was already issued", async () => {
  const cookie = cookieHeader("auth0|admin1");
  await withEnv(ADMINS, async () => assert.equal(isAdminRequest(req(cookie), ""), true));
  await withEnv({ ...ADMINS, ADMIN_SUBJECTS: "google-oauth2|777" }, async () => assert.equal(isAdminRequest(req(cookie), ""), false));
  await withEnv({ ...AUTH_ENV }, async () => assert.equal(isAdminRequest(req(cookie), ""), false), undefined);
});

test("without sign-in configured the cookie path admits nobody, and the password Bearer needs no CSRF header", async () => {
  await withEnv({ ADMIN_SUBJECTS: "auth0|admin1" }, async () => assert.equal(isAdminRequest(req(cookieHeader("auth0|admin1")), ""), false));
  await withEnv(ADMINS, async () => assert.equal(isAdminRequest({ headers: { authorization: "Bearer pw-1" } }, "pw-1"), true));
});

// ---- Endpoints: me, logout ----

test("/api/admin/me names the signed-in admin, and answers 401 to everyone else", async () => {
  await withEnv(ADMINS, async () => {
    const ok = await me.handler(req(cookieHeader("auth0|admin1", { name: "Ann" })));
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(JSON.parse(ok.body), { signedIn: true, name: "Ann" });
    assert.equal((await me.handler(req(cookieHeader("auth0|admin1"), null))).statusCode, 401, "no CSRF header");
    assert.equal((await me.handler(req(cookieHeader("auth0|nobody")))).statusCode, 401, "not on the list");
    assert.equal((await me.handler({ httpMethod: "GET", headers: { "x-requested-with": "admin" } })).statusCode, 401, "no cookie");
    assert.equal((await me.handler({ ...req(cookieHeader("auth0|admin1")), httpMethod: "POST" })).statusCode, 405);
  });
});

test("/api/admin/logout clears the admin cookie, needs the CSRF header, and leaves a community session alone", async () => {
  await withEnv(ADMINS, async () => {
    const out = await adminLogout.handler({ ...req(cookieHeader("auth0|admin1")), httpMethod: "POST" });
    assert.equal(out.statusCode, 200);
    const cookies = out.multiValueHeaders["Set-Cookie"];
    assert.equal(cookies.length, 1);
    assert.ok(cookies[0].startsWith("ff_admin=;") && cookies[0].includes("Max-Age=0") && cookies[0].includes("HttpOnly"));
    assert.equal((await adminLogout.handler({ ...req(cookieHeader("auth0|admin1"), null), httpMethod: "POST" })).statusCode, 401);
    assert.equal((await adminLogout.handler(req(cookieHeader("auth0|admin1")))).statusCode, 405);
  });
});

// ---- Sign-in: login state and callback ----

const cookiesOf = (result) => (result.multiValueHeaders && result.multiValueHeaders["Set-Cookie"]) || [];
const cookieNamed = (result, name) => cookiesOf(result).find((c) => c.startsWith(`${name}=`));
const cookieValue = (cookie) => decodeURIComponent(cookie.split(";")[0].slice(cookie.indexOf("=") + 1));
const providerOk = (user) => (url) => {
  if (url.endsWith("/oauth/token")) return { ok: true, status: 200, json: async () => ({ access_token: "tok-1" }) };
  if (url.endsWith("/userinfo")) return { ok: true, status: 200, json: async () => user };
  throw new Error(`unexpected ${url}`);
};

async function startAdminLogin(query = { admin: "1" }) {
  const result = await login.handler({ queryStringParameters: query, headers: HOST });
  return { result, location: new URL(result.headers.Location), stateCookie: cookieNamed(result, "ff_auth_state") };
}
async function finishAdminLogin(user, params = {}) {
  const { location, stateCookie } = await startAdminLogin();
  return callback.handler({ queryStringParameters: { code: "c1", state: location.searchParams.get("state"), ...params }, headers: { ...HOST, cookie: `ff_auth_state=${encodeURIComponent(cookieValue(stateCookie))}` } });
}

test("admin login asks the provider for a fresh sign-in and seals the admin intent, returning only to /admin", async () => {
  await withEnv(ADMINS, async () => {
    const { location, stateCookie } = await startAdminLogin({ admin: "1", return: "/community" });
    assert.equal(location.searchParams.get("prompt"), "login");
    assert.equal(location.searchParams.get("max_age"), "0");
    const payload = auth.verify(cookieValue(stateCookie), KEY);
    assert.equal(payload.admin, true);
    assert.equal(payload.ret, "/admin");
    const plain = await startAdminLogin({ return: "/community" });
    assert.equal(plain.location.searchParams.get("prompt"), null, "community sign-in is unchanged");
    assert.equal(auth.verify(cookieValue(plain.stateCookie), KEY).admin, undefined);
  });
});

test("callback: an allow-listed subject gets a signed admin cookie and goes to /admin, with no community session", async () => {
  await withEnv(ADMINS, async () => {
    const result = await finishAdminLogin({ sub: "auth0|admin1", name: "Ann Admin", email: "ann@example.com" });
    assert.equal(result.headers.Location, "/admin");
    assert.equal(cookieNamed(result, "ff_session"), undefined);
    const cookie = cookieNamed(result, "ff_admin");
    const attrs = cookie.split(";").map((p) => p.trim());
    for (const a of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", `Max-Age=${adminAuth.ADMIN_SESSION_MS / 1000}`]) assert.ok(attrs.includes(a), a);
    const payload = auth.verify(cookieValue(cookie), KEY);
    assert.deepEqual(Object.keys(payload).sort(), ["exp", "name", "sub"], "no email is kept");
    assert.equal(payload.sub, "auth0|admin1");
    assert.equal(payload.name, "Ann Admin");
    assert.ok(payload.exp > Date.now() + 7.9 * 3600000 && payload.exp <= Date.now() + 8 * 3600000 + 1000);
    assert.equal(isAdminRequest(req(`ff_admin=${encodeURIComponent(cookieValue(cookie))}`), ""), true);
  }, providerOk({ sub: "auth0|admin1", name: "Ann Admin", email: "ann@example.com" }));
});

test("callback: a subject not on the list is sent to /admin?signin=denied with no cookie and no subject in the address", async () => {
  const user = { sub: "auth0|stranger", name: "Eve" };
  await withEnv(ADMINS, async () => {
    const result = await finishAdminLogin(user);
    assert.equal(result.headers.Location, "/admin?signin=denied");
    assert.equal(cookieNamed(result, "ff_admin"), undefined);
    assert.equal(cookieNamed(result, "ff_session"), undefined);
    assert.ok(!result.headers.Location.includes("stranger"));
  }, providerOk(user));
  await withEnv(AUTH_ENV, async () => {
    const result = await finishAdminLogin({ sub: "auth0|admin1", name: "Ann" });
    assert.equal(result.headers.Location, "/admin?signin=denied", "no ADMIN_SUBJECTS fails closed");
    assert.equal(cookieNamed(result, "ff_admin"), undefined);
  }, providerOk({ sub: "auth0|admin1", name: "Ann" }));
});

test("callback: admin sign-in failures go to /admin?signin=failed and issue no cookie", async () => {
  await withEnv(ADMINS, async () => {
    const providerDown = await finishAdminLogin({ sub: "auth0|admin1" });
    assert.equal(providerDown.headers.Location, "/admin?signin=failed");
    assert.equal(cookieNamed(providerDown, "ff_admin"), undefined);
    const wrongState = await finishAdminLogin({ sub: "auth0|admin1" }, { state: "not-the-state" });
    assert.equal(wrongState.headers.Location, "/admin?signin=failed");
  }, () => ({ ok: false, status: 500, json: async () => ({}) }));
});

// ---- The destructive endpoint stays password-only ----

test("POST /api/community/delete still takes only the password Bearer, not the admin cookie", async () => {
  await withEnv({ ...ADMINS, ADMIN_PASSWORD: "pw-1" }, async () => {
    const withCookie = await communityDelete.handler({ ...req(cookieHeader("auth0|admin1")), httpMethod: "POST", body: "{}" });
    assert.equal(withCookie.statusCode, 401);
    const withPassword = await communityDelete.handler({ httpMethod: "POST", headers: { authorization: "Bearer pw-1" }, body: "{}" });
    assert.notEqual(withPassword.statusCode, 401);
  });
});
