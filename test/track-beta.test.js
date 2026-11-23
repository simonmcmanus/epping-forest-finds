/**
 * Beta tagging of tracking events: a POST /api/track sent with the cookie of a current beta member is
 * marked beta on the server, so the admin dashboard can filter to beta users. The marker is a flag only;
 * a client can never set it, and nothing about the account is stored in tracking data.
 */

"use strict";

const ADMIN = "beta-track-admin";
process.env.ADMIN_PASSWORD = ADMIN;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const auth = require("../netlify/functions/lib/auth-session.js");
const gate = require("../netlify/functions/lib/feature-gate.js");
const accounts = require("../netlify/functions/lib/community-account.js");
const track = require("../netlify/functions/track.js");
const tracking = require("../netlify/functions/lib/tracking-store.js");

const KEY = "k".repeat(40);
const ENV = { AUTH0_DOMAIN: "tenant.example.auth0.test", AUTH0_CLIENT_ID: "id", AUTH0_CLIENT_SECRET: "s", AUTH_SECRET: KEY };
const NOW = () => Date.now();

function trackingStore() {
  const blobs = new Map();
  return {
    blobs,
    async getJSON(key) { return blobs.has(key) ? JSON.parse(blobs.get(key)) : null; },
    async setJSON(key, value) { blobs.set(key, JSON.stringify(value)); },
    async delete(key) { blobs.delete(key); },
    async listKeys(prefix) { return [...blobs.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    async firstPageKeys(prefix) { return [...blobs.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
}

function communityStore(initial = {}, { failReads = false } = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    reads: 0,
    async get(key) { return data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null; },
    async getStrict(key) {
      store.reads += 1;
      if (failReads) throw new Error("store down");
      return store.get(key);
    },
    async put(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async delete(key) { data.delete(key); },
    async list(prefix) { return [...data.keys()].filter((k) => k.startsWith(prefix)); },
  };
  return store;
}

// A beta member: a claimed code and the grant for the account key of this sub.
function betaCommunity(sub, code = "abcde") {
  const account = accounts.accountKey(sub);
  return {
    [`beta-code/${code}`]: { note: "Sam", createdAt: 1, claimedBy: account, claimedAt: 2 },
    [`beta-user/${account}`]: { code, at: 2 },
  };
}

const cookieFor = (sub) => `ff_session=${encodeURIComponent(auth.sign({ sub, name: "Sam", exp: Date.now() + 60000 }, KEY))}`;

async function withStores(community, run) {
  const saved = {};
  for (const k of Object.keys(ENV)) saved[k] = process.env[k];
  Object.assign(process.env, ENV);
  const store = trackingStore();
  track.setStore(store);
  gate.setStore(community);
  try { return await run(store); } finally {
    track.setStore(null);
    gate.setStore(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

let ipSeq = 0;
const loc = (uid, extra = {}) => ({ type: "location", uid, ts: new Date(NOW()).toISOString(), lat: 51.65, lng: 0.04, heading: 90, navTarget: null, ...extra });
const clk = (uid, extra = {}) => ({ type: "click", uid, ts: new Date(NOW()).toISOString(), userLat: 51.65, userLng: 0.04, targetLat: 51.66, targetLng: 0.05, itemType: "tree", itemId: "r1", itemName: "Oak", source: "map", ...extra });
const nav = (uid, extra = {}) => ({ type: "navigation_start", uid, ts: new Date(NOW()).toISOString(), navId: "T1", navName: "Oak", navType: "tree", targetLat: 51.66, targetLng: 0.05, userLat: 51.65, userLng: 0.04, routeM: 100, ...extra });

const post = (events, sub) => track.handler({
  httpMethod: "POST",
  headers: { "x-nf-client-connection-ip": `10.9.0.${++ipSeq}`, ...(sub ? { cookie: cookieFor(sub) } : {}) },
  body: JSON.stringify({ events }),
});

async function adminRead() {
  const result = await track.handler({ httpMethod: "GET", headers: { authorization: `Bearer ${ADMIN}` }, queryStringParameters: { days: "2" } });
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body);
  return {
    body,
    locations: tracking.unpackEvents(body.locations),
    clicks: tracking.unpackEvents(body.clicks),
    navigation: tracking.unpackEvents(body.navigation),
  };
}

const betaUids = (events) => events.filter((e) => e.beta === true).map((e) => e.uid).sort();

test("every event in a batch posted by a signed-in beta member reads back as beta on the admin read", async () => {
  await withStores(communityStore(betaCommunity("auth0|a")), async () => {
    assert.equal((await post([loc("dev1"), clk("dev1"), nav("dev1")], "auth0|a")).statusCode, 200);
    const read = await adminRead();
    assert.deepEqual(betaUids(read.locations), ["dev1"]);
    assert.deepEqual(betaUids(read.clicks), ["dev1"]);
    assert.deepEqual(betaUids(read.navigation), ["dev1"]);
  });
});

test("anonymous, signed-in non-member and revoked-member batches are not beta", async () => {
  const revoked = { ...betaCommunity("auth0|r", "rrrrr"), "beta-revoked/rrrrr": { at: 5 } };
  await withStores(communityStore({ ...betaCommunity("auth0|a"), ...revoked }), async () => {
    await post([loc("anon")]);
    await post([loc("plain")], "auth0|nobody");
    await post([loc("gone")], "auth0|r");
    const read = await adminRead();
    assert.equal(read.locations.length, 3);
    assert.deepEqual(betaUids(read.locations), []);
  });
});

test("a client cannot tag its own events as beta", async () => {
  await withStores(communityStore(betaCommunity("auth0|a")), async (store) => {
    await post([loc("liar", { beta: true }), clk("liar", { beta: true }), nav("liar", { beta: true })]);
    const read = await adminRead();
    assert.deepEqual(betaUids([...read.locations, ...read.clicks, ...read.navigation]), []);
    assert.ok(![...store.blobs.values()].some((v) => v.includes("beta")), "nothing beta-like is stored");
  });
});

test("a beta member's request still stores its events when the beta check cannot read the store", async () => {
  await withStores(communityStore(betaCommunity("auth0|a"), { failReads: true }), async () => {
    const res = await post([loc("dev2")], "auth0|a");
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).stored, 1);
    const read = await adminRead();
    assert.equal(read.locations.length, 1);
    assert.deepEqual(betaUids(read.locations), []);
  });
});

test("beta marks survive compaction and mixed beta and plain events keep their own marks", async () => {
  await withStores(communityStore(betaCommunity("auth0|a")), async (store) => {
    await post([loc("one"), loc("two", { lat: 51.7 })], "auth0|a");
    await post([loc("three"), clk("three")]);
    const before = await adminRead();
    await tracking.compact(store);
    await tracking.compact(store);
    const after = await adminRead();
    assert.deepEqual(betaUids(after.locations), ["one", "two"]);
    assert.equal(after.locations.length, 3);
    assert.deepEqual(betaUids(after.clicks), []);
    assert.deepEqual(after.locations.map((e) => [e.uid, e.beta === true]).sort(), before.locations.map((e) => [e.uid, e.beta === true]).sort());
  });
});

test("an old admin response without a beta table unpacks with no beta events", () => {
  const packed = { v: 2, type: "click", uids: ["a"], rows: [[0, Date.parse("2026-01-01T00:00:00Z"), 1, 2, 3, 4, "tree", "r", "Oak", "map"]] };
  assert.equal(tracking.unpackEvents(packed)[0].beta, undefined);
});

test("a beta check reads the community store only for a signed-in request, and only a few times", async () => {
  const community = communityStore(betaCommunity("auth0|a"));
  await withStores(community, async () => {
    await post([loc("anon")]);
    assert.equal(community.reads, 0);
    await post([loc("m1"), clk("m1"), nav("m1")], "auth0|a");
    assert.ok(community.reads <= 5, `reads: ${community.reads}`);
  });
});

test("the local file fallback carries the beta mark too", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "track-beta-"));
  const saved = process.env.TRACKING_DIR;
  process.env.TRACKING_DIR = dir;
  delete require.cache[require.resolve("../netlify/functions/track.js")];
  const local = require("../netlify/functions/track.js");
  Object.assign(process.env, ENV);
  gate.setStore(communityStore(betaCommunity("auth0|a")));
  try {
    const res = await local.handler({ httpMethod: "POST", headers: { "x-nf-client-connection-ip": "10.8.0.1", cookie: cookieFor("auth0|a") }, body: JSON.stringify({ events: [loc("filer")] }) });
    assert.equal(JSON.parse(res.body).storage, "file-fallback");
    const read = await local.handler({ httpMethod: "GET", headers: { authorization: `Bearer ${ADMIN}` }, queryStringParameters: {} });
    const events = tracking.unpackEvents(JSON.parse(read.body).locations);
    assert.deepEqual(betaUids(events), ["filer"]);
  } finally {
    gate.setStore(null);
    for (const k of Object.keys(ENV)) delete process.env[k];
    if (saved === undefined) delete process.env.TRACKING_DIR; else process.env.TRACKING_DIR = saved;
    delete require.cache[require.resolve("../netlify/functions/track.js")];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
