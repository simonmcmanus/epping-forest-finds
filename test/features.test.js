/**
 * Testers-only features (netlify/functions/features.js, lib/feature-gate.js): who sees a gated feature, and
 * what happens when the list cannot be read or saved. A storage failure must never switch a feature on.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const features = require("../netlify/functions/features.js");
const gate = require("../netlify/functions/lib/feature-gate.js");

const ADMIN = "features-admin-pw";
const TESTER_ID = "0123456789";
const OTHER_ID = "9876543210";

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) { return data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null; },
    async getStrict(key) { return this.get(key); },
    async put(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async delete(key) { data.delete(key); },
    async list() { return []; },
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

const adminHeaders = { authorization: `Bearer ${ADMIN}` };
const readFor = (id) => features.handler({ httpMethod: "GET", queryStringParameters: { id }, headers: {} });

test("with no testers named, everyone has the feature", async () => {
  await withStore(memoryStore(), async () => {
    assert.deepEqual(JSON.parse((await readFor(OTHER_ID)).body), { community: true });
  });
});

test("once testers are named, only they have the feature", async () => {
  const store = memoryStore({ "features-allowlist": { community: [{ id: TESTER_ID, note: "" }] } });
  await withStore(store, async () => {
    assert.deepEqual(JSON.parse((await readFor(TESTER_ID)).body), { community: true });
    assert.deepEqual(JSON.parse((await readFor(OTHER_ID)).body), { community: false });
  });
});

test("when the tester list cannot be read, no one is given a tester-only feature", async () => {
  await withStore(brokenStore(), async () => {
    const response = await readFor(TESTER_ID);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { community: false });
  });
});

test("an admin's save that cannot reach storage is reported as a failure, not a success", async () => {
  await withStore(brokenStore(), async () => {
    const response = await features.handler({
      httpMethod: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ community: [{ id: TESTER_ID, note: "" }] }),
    });
    assert.equal(response.statusCode, 503, "the admin must learn that nothing was saved");
  });
});

test("an admin saves the tester list and reads it back", async () => {
  const store = memoryStore();
  await withStore(store, async () => {
    const saved = await features.handler({ httpMethod: "POST", headers: adminHeaders, body: JSON.stringify({ community: [{ id: TESTER_ID, note: "Sam" }] }) });
    assert.equal(saved.statusCode, 200);
    const listed = await features.handler({ httpMethod: "GET", queryStringParameters: { admin: "1" }, headers: adminHeaders });
    assert.deepEqual(JSON.parse(listed.body).community, [{ id: TESTER_ID, note: "Sam" }]);
  });
});

test("the tester list is only readable or writable with the admin password in the header", async () => {
  await withStore(memoryStore(), async () => {
    assert.equal((await features.handler({ httpMethod: "GET", queryStringParameters: { admin: "1" }, headers: {} })).statusCode, 401);
    assert.equal((await features.handler({ httpMethod: "POST", headers: {}, body: "{}" })).statusCode, 401);
  });
});

test("the admin password is refused in the address, even when correct", async () => {
  await withStore(memoryStore(), async () => {
    const response = await features.handler({ httpMethod: "GET", queryStringParameters: { admin: "1", pw: ADMIN }, headers: {} });
    assert.equal(response.statusCode, 401);
  });
});

test("the gate module exposes the store it uses so tests can replace it", () => {
  assert.equal(typeof gate.setStore, "function");
});
