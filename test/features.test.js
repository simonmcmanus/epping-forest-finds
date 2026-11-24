/**
 * /api/features (netlify/functions/features.js): Community is on for everyone. The endpoint is read-only: there
 * is no tester list to read or edit. Beta access stays additive and is covered in beta-access.test.js.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const features = require("../netlify/functions/features.js");
const gate = require("../netlify/functions/lib/feature-gate.js");

const ADMIN = "features-admin-pw";

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) { return data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null; },
    async getStrict(key) { return this.get(key); },
    async put(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async delete(key) { data.delete(key); },
    async list() { return []; },
    dump: () => Object.fromEntries(data),
  };
}

const brokenStore = () => {
  const fail = async () => { throw new Error("blob store unavailable"); };
  return { get: async () => null, getStrict: fail, put: fail, delete: fail, list: fail };
};

async function withStore(store, run) {
  features.setStore(store);
  process.env.ADMIN_PASSWORD = ADMIN;
  try { return await run(); } finally { features.setStore(null); }
}

const read = (extra = {}) => features.handler({ httpMethod: "GET", queryStringParameters: {}, headers: {}, ...extra });

test("everyone has Community, with or without a Tester ID", async () => {
  await withStore(memoryStore(), async () => {
    assert.deepEqual(JSON.parse((await read()).body), { community: true });
    assert.deepEqual(JSON.parse((await read({ queryStringParameters: { id: "9876543210" } })).body), { community: true });
  });
});

test("Community stays on when storage is unavailable", async () => {
  await withStore(brokenStore(), async () => {
    const response = await read({ headers: { cookie: "ff_session=not-a-real-session" } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { community: true });
  });
});

test("posting a list or asking for the admin list does not create or reveal an editable list", async () => {
  const store = memoryStore();
  await withStore(store, async () => {
    const posted = await features.handler({ httpMethod: "POST", headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ community: [{ id: "0123456789", note: "x" }] }) });
    assert.deepEqual(JSON.parse(posted.body), { community: true });
    assert.deepEqual(store.dump(), {}, "nothing is written");
    const listed = await read({ queryStringParameters: { admin: "1" }, headers: { authorization: `Bearer ${ADMIN}` } });
    assert.deepEqual(JSON.parse(listed.body), { community: true });
    assert.deepEqual(JSON.parse((await read({ queryStringParameters: { id: "9876543210" } })).body), { community: true });
  });
});

test("the gate module exposes the store it uses so tests can replace it", () => {
  assert.equal(typeof gate.setStore, "function");
  assert.equal(typeof gate.storeFor, "function");
});
