/**
 * Usage tracking storage: netlify/functions/track.js and lib/tracking-store.js.
 *
 * The admin read used to list every blob ever written (one per POST, forever) before it could
 * apply its window, so it slowed down with every day the site was live and eventually timed out.
 * These tests drive the handler and the compaction job against an in-memory store and assert what
 * a caller sees: what is stored, what an admin read returns, and which parts of the store a read
 * has to touch.
 */

"use strict";

process.env.ADMIN_PASSWORD = "admin-pw";

const test = require("node:test");
const assert = require("node:assert");

const track = require("../netlify/functions/track.js");
const tracking = require("../netlify/functions/lib/tracking-store.js");

const DAY = 24 * 60 * 60 * 1000;

function memoryStore({ pageSize = 1000 } = {}) {
  const blobs = new Map();
  const listed = [];
  return {
    blobs,
    listed,
    async getJSON(key) { return blobs.has(key) ? JSON.parse(blobs.get(key)) : null; },
    async setJSON(key, value) { blobs.set(key, JSON.stringify(value)); },
    async delete(key) { blobs.delete(key); },
    async listKeys(prefix) { listed.push(prefix); return [...blobs.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    async firstPageKeys(prefix) { listed.push(prefix); return [...blobs.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, pageSize); },
  };
}

function location(uid, ms, extra = {}) {
  return { type: "location", uid, ts: new Date(ms).toISOString(), lat: 51.65, lng: 0.04, heading: 90, navTarget: null, ...extra };
}

function click(uid, ms, extra = {}) {
  return { type: "click", uid, ts: new Date(ms).toISOString(), userLat: 51.65, userLng: 0.04, targetLat: 51.66, targetLng: 0.05, itemType: "tree", itemId: "r1", itemName: "Oak", source: "map", ...extra };
}

let ipSeq = 0;
function post(events, { ip = `10.0.0.${++ipSeq}`, body } = {}) {
  return track.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": ip },
    body: body ?? JSON.stringify({ events }),
  });
}

async function adminRead(days) {
  const result = await track.handler({
    httpMethod: "GET",
    headers: { authorization: "Bearer admin-pw" },
    queryStringParameters: days ? { days: String(days) } : {},
  });
  const body = JSON.parse(result.body);
  return { status: result.statusCode, meta: body.meta, locations: tracking.unpackEvents(body.locations), clicks: tracking.unpackEvents(body.clicks) };
}

test("parseWindowDays defaults to 30 days when no days param is given", () => {
  assert.strictEqual(track.parseWindowDays({ queryStringParameters: {} }), track.DEFAULT_WINDOW_DAYS);
  assert.strictEqual(track.parseWindowDays({ queryStringParameters: null }), track.DEFAULT_WINDOW_DAYS);
});

test("parseWindowDays honours an explicit numeric days param, and treats days=all as no window", () => {
  assert.strictEqual(track.parseWindowDays({ queryStringParameters: { days: "7" } }), 7);
  assert.strictEqual(track.parseWindowDays({ queryStringParameters: { days: "all" } }), null);
  for (const days of ["0", "-5", "nope", ""]) {
    assert.strictEqual(track.parseWindowDays({ queryStringParameters: { days } }), track.DEFAULT_WINDOW_DAYS);
  }
});

test("an admin read with no credentials is rejected", async () => {
  const result = await track.handler({ httpMethod: "GET", queryStringParameters: {} });
  assert.strictEqual(result.statusCode, 401);
});

test("a posted batch is stored and comes back on the admin read", async () => {
  track.setStore(memoryStore());
  const now = Date.now();
  const stored = await post([location("u1", now - 60_000), click("u1", now - 30_000)]);
  assert.strictEqual(stored.statusCode, 200);
  assert.strictEqual(JSON.parse(stored.body).stored, 2);

  const read = await adminRead(1);
  assert.strictEqual(read.status, 200);
  assert.deepStrictEqual(read.locations.map((e) => [e.uid, e.lat, e.lng, e.heading]), [["u1", 51.65, 0.04, 90]]);
  assert.deepStrictEqual(read.clicks.map((e) => [e.uid, e.itemId, e.itemName]), [["u1", "r1", "Oak"]]);
});

test("unknown fields and malformed events are dropped rather than stored", async () => {
  const store = memoryStore();
  track.setStore(store);
  const now = Date.now();
  const result = await post([
    location("u1", now, { secret: "x".repeat(10_000) }),
    location("u2", now, { lat: "not a number" }),
    { type: "pageview", uid: "u3", ts: new Date(now).toISOString() },
    location("u4", now + 10 * DAY),
  ]);
  assert.strictEqual(JSON.parse(result.body).stored, 1);
  const read = await adminRead(1);
  assert.deepStrictEqual(read.locations.map((e) => e.uid), ["u1"]);
  assert.strictEqual(read.locations[0].secret, undefined);
});

test("a batch too big for the app to have sent is refused", async () => {
  track.setStore(memoryStore());
  const now = Date.now();
  const tooMany = Array.from({ length: track.MAX_EVENTS_PER_REQUEST + 1 }, (_, i) => location("u1", now - i));
  assert.strictEqual((await post(tooMany)).statusCode, 413);
  assert.strictEqual((await post(null, { body: JSON.stringify({ events: [], pad: "x".repeat(300 * 1024) }) })).statusCode, 413);
});

test("one address sending far more than a phone would is told to slow down", async () => {
  process.env.TRACK_LIMIT_PER_IP = "2";
  try {
    track.setStore(memoryStore());
    const now = Date.now();
    assert.strictEqual((await post([location("u1", now)], { ip: "192.0.2.1" })).statusCode, 200);
    assert.strictEqual((await post([location("u1", now + 1)], { ip: "192.0.2.1" })).statusCode, 200);
    const third = await post([location("u1", now + 2)], { ip: "192.0.2.1" });
    assert.strictEqual(third.statusCode, 429);
    assert.ok(Number(third.headers["Retry-After"]) > 0);
    assert.strictEqual((await post([location("u2", now)], { ip: "192.0.2.2" })).statusCode, 200, "another address is unaffected");
  } finally {
    delete process.env.TRACK_LIMIT_PER_IP;
  }
});

test("an admin read only looks at the days in its window, however much history is stored", async () => {
  const store = memoryStore();
  track.setStore(store);
  const now = Date.now();
  for (let d = 0; d < 60; d += 1) await tracking.storeBatch(store, [location("u1", now - d * DAY)], { now: now - d * DAY });
  await store.setJSON("location/1700000000000_old.json", [location("u0", 1700000000000)]);
  store.listed.length = 0;

  const read = await adminRead(7);
  assert.strictEqual(read.locations.length, 7);
  const days = new Set(Array.from({ length: 7 }, (_, i) => tracking.dayOf(now - i * DAY)));
  for (const prefix of store.listed) {
    assert.ok([...days].some((day) => prefix.endsWith(`${day}/`)), `listed ${prefix}, outside the 7-day window`);
  }
});

test("when a window holds more than one response can carry, the newest events are returned and the read says where it stopped", async () => {
  const store = memoryStore();
  const now = Date.now();
  for (let d = 0; d < 5; d += 1) {
    await tracking.storeBatch(store, Array.from({ length: 10 }, (_, i) => location(`u${i}`, now - d * DAY - i * 1000)), { now });
  }
  const result = await tracking.readWindow(store, { windowDays: 5, now, maxBytes: 48 * 25 });
  assert.strictEqual(result.partial, true);
  assert.strictEqual(result.locations.length, 25);
  assert.strictEqual(result.oldestDay, tracking.dayOf(now - 2 * DAY));
  const newest = Math.max(...result.locations.map((e) => Date.parse(e.ts)));
  assert.strictEqual(newest, now, "the newest event is kept");
});

test("compaction folds a day's batches into one daily file without changing what the admin sees", async () => {
  const store = memoryStore();
  track.setStore(store);
  const now = Date.now();
  for (let i = 0; i < 5; i += 1) await tracking.storeBatch(store, [location("u1", now - i * 60_000), click("u1", now - i * 60_000)], { now: now + i });
  const before = await adminRead(1);

  const summary = await tracking.compact(store, { now });
  assert.strictEqual(summary.compacted, 10);
  assert.deepStrictEqual([...store.blobs.keys()].filter((k) => k.startsWith("raw/")), [], "raw batches are removed once merged");
  assert.ok(store.blobs.has(tracking.dailyKey("location", tracking.dayOf(now))));

  const after = await adminRead(1);
  assert.deepStrictEqual(after.locations, before.locations);
  assert.deepStrictEqual(after.clicks, before.clicks);
});

test("a batch merged twice (a crash before its raw blob was deleted) is not counted twice", async () => {
  const store = memoryStore();
  const now = Date.now();
  const keys = await tracking.storeBatch(store, [location("u1", now)], { now });
  const copy = store.blobs.get(keys[0]);
  await tracking.compact(store, { now });
  store.blobs.set(keys[0], copy);
  await tracking.compact(store, { now });
  const result = await tracking.readWindow(store, { windowDays: 1, now });
  assert.strictEqual(result.locations.length, 1);
});

test("compaction that runs out of time leaves the rest for its next run and loses nothing", async () => {
  const store = memoryStore();
  const now = Date.now();
  for (let i = 0; i < 60; i += 1) await tracking.storeBatch(store, [location(`u${i}`, now - i * 1000)], { now: now + i });
  let clock = 0;
  const first = await tracking.compact(store, { now, budgetMs: 5, clock: () => (clock += 1) });
  assert.strictEqual(first.partial, true);
  assert.ok(first.compacted > 0 && first.compacted < 60);
  await tracking.compact(store, { now });
  const result = await tracking.readWindow(store, { windowDays: 1, now });
  assert.strictEqual(result.locations.length, 60);
});

test("the old one-blob-per-POST layout is migrated into daily files a page at a time", async () => {
  const store = memoryStore({ pageSize: 2 });
  const now = Date.now();
  const old = now - 3 * DAY;
  for (let i = 0; i < 3; i += 1) await store.setJSON(`location/${old + i}_abc${i}.json`, [{ uid: `u${i}`, ts: new Date(old + i).toISOString(), lat: 51.6, lng: 0.05 }]);
  await store.setJSON(`click/${old}_abc.json`, [{ uid: "u0", ts: new Date(old).toISOString(), itemType: "tree", itemId: "r9" }]);

  const first = await tracking.compact(store, { now });
  assert.strictEqual(first.migrated, 3, "one page of each old prefix per run");
  await tracking.compact(store, { now });
  assert.deepStrictEqual([...store.blobs.keys()].filter((k) => /^(location|click)\//.test(k)), []);

  const result = await tracking.readWindow(store, { windowDays: 5, now });
  assert.deepStrictEqual(result.locations.map((e) => e.uid), ["u0", "u1", "u2"]);
  assert.deepStrictEqual(result.clicks.map((e) => e.itemId), ["r9"]);
});

test("daily files older than the retention period are deleted and newer ones kept", async () => {
  const store = memoryStore();
  const now = Date.now();
  for (const age of [10, 400, 500]) {
    await store.setJSON(tracking.dailyKey("location", tracking.dayOf(now - age * DAY)), tracking.packEvents("location", [location("u1", now - age * DAY)]));
  }
  const summary = await tracking.compact(store, { now, retentionDays: 365 });
  assert.strictEqual(summary.expired, 2);
  const result = await tracking.readWindow(store, { windowDays: 30, now });
  assert.strictEqual(result.locations.length, 1);
});

test("retention defaults to a year, and TRACKING_RETENTION_DAYS=0 keeps everything", () => {
  assert.strictEqual(track.retentionDays({}), 365);
  assert.strictEqual(track.retentionDays({ TRACKING_RETENTION_DAYS: "90" }), 90);
  assert.strictEqual(track.retentionDays({ TRACKING_RETENTION_DAYS: "0" }), null);
});
