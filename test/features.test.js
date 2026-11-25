/**
 * /api/features (netlify/functions/features.js): Community is for beta members only. The endpoint is read-only:
 * there is no tester list to read or edit. Beta codes and redeem are covered in beta-access.test.js.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../netlify/functions/lib/auth-session.js");
const features = require("../netlify/functions/features.js");
const codes = require("../netlify/functions/beta-codes.js");
const redeem = require("../netlify/functions/beta-redeem.js");

const ADMIN = "features-admin-pw";
const KEY = "k".repeat(40);
const ENV = { AUTH0_DOMAIN: "tenant.example.auth0.test", AUTH0_CLIENT_ID: "id", AUTH0_CLIENT_SECRET: "s", AUTH_SECRET: KEY, ADMIN_PASSWORD: ADMIN };

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) { return data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null; },
    async getStrict(key) { return this.get(key); },
    async put(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async delete(key) { data.delete(key); },
    async list(prefix = "") { return [...data.keys()].filter((k) => k.startsWith(prefix)); },
    dump: () => Object.fromEntries(data),
  };
}

const brokenStore = () => {
  const fail = async () => { throw new Error("blob store unavailable"); };
  return { get: fail, getStrict: fail, put: fail, delete: fail, list: fail };
};

async function withStore(store, run) {
  const saved = {};
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  features.setStore(store);
  try { return await run(); } finally {
    features.setStore(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const cookieFor = (sub) => `ff_session=${auth.sign({ sub, name: "Sam", exp: Date.now() + 60000 }, KEY)}`;
const read = (sub, extra = {}) => features.handler({ httpMethod: "GET", queryStringParameters: {}, headers: sub ? { cookie: cookieFor(sub) } : {}, ...extra });
const answer = async (sub, extra) => JSON.parse((await read(sub, extra)).body);
const adminHeaders = { authorization: `Bearer ${ADMIN}` };
const newCode = async () => JSON.parse((await codes.handler({ httpMethod: "POST", headers: adminHeaders, body: JSON.stringify({ action: "create", note: "t" }) })).body).code;
const redeemAs = (sub, code) => redeem.handler({ httpMethod: "POST", headers: { cookie: cookieFor(sub) }, body: JSON.stringify({ code }) });

test("someone who is signed out does not get Community", async () => {
  await withStore(memoryStore(), async () => {
    const response = await read(null);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { community: false });
  });
});

test("a signed-in account that is not a beta member does not get Community", async () => {
  await withStore(memoryStore(), async () => {
    assert.deepEqual(await answer("auth0|nobody"), { community: false });
  });
});

test("a beta member gets Community, and only that account", async () => {
  await withStore(memoryStore(), async () => {
    assert.equal((await redeemAs("auth0|a", await newCode())).statusCode, 200);
    assert.deepEqual(await answer("auth0|a"), { community: true });
    assert.deepEqual(await answer("auth0|b"), { community: false });
    assert.deepEqual(await answer(null), { community: false });
  });
});

test("a Tester ID in the request does nothing", async () => {
  await withStore(memoryStore(), async () => {
    assert.deepEqual(await answer(null, { queryStringParameters: { id: "0123456789" } }), { community: false });
  });
});

test("a revoked beta member loses Community", async () => {
  await withStore(memoryStore(), async () => {
    const code = await newCode();
    await redeemAs("auth0|a", code);
    assert.deepEqual(await answer("auth0|a"), { community: true });
    await codes.handler({ httpMethod: "POST", headers: adminHeaders, body: JSON.stringify({ action: "revoke", code }) });
    assert.deepEqual(await answer("auth0|a"), { community: false });
  });
});

test("when storage is unreadable Community stays off, never on", async () => {
  await withStore(brokenStore(), async () => {
    const response = await read("auth0|a");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { community: false });
  });
});

test("posting a list or asking for the admin list is the same read-only answer and writes nothing", async () => {
  const store = memoryStore();
  await withStore(store, async () => {
    const before = JSON.stringify(store.dump());
    const posted = await features.handler({ httpMethod: "POST", headers: adminHeaders, body: JSON.stringify({ community: [{ id: "0123456789", note: "x" }] }) });
    assert.equal(posted.statusCode, 200);
    assert.deepEqual(JSON.parse(posted.body), { community: false });
    const listed = await read(null, { queryStringParameters: { admin: "1" }, headers: adminHeaders });
    assert.deepEqual(JSON.parse(listed.body), { community: false });
    assert.equal(JSON.stringify(store.dump()), before, "nothing is written and no list exists");
    // Even an id the POST named does not gain access.
    assert.deepEqual(await answer(null, { queryStringParameters: { id: "0123456789" } }), { community: false });
  });
});
