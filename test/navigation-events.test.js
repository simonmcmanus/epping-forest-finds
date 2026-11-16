/**
 * Explicit navigation events: POSTed to /api/track, stored, returned by the admin read, and turned
 * into journeys by js/navigation-metrics.js (preferred over journeys derived from pings).
 */

"use strict";

process.env.ADMIN_PASSWORD = "admin-pw";

const test = require("node:test");
const assert = require("node:assert/strict");

const track = require("../netlify/functions/track.js");
const tracking = require("../netlify/functions/lib/tracking-store.js");
const M = require("../js/navigation-metrics.js");

function memoryStore() {
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

const MIN = 60 * 1000;
const T0 = Date.now() - 60 * MIN;
const iso = (min) => new Date(T0 + min * MIN).toISOString();

const start = (uid, min, extra = {}) => ({ type: "navigation_start", uid, ts: iso(min), navId: "t1", navName: "Oak", navType: "tree", targetLat: 51.66, targetLng: 0.04, userLat: 51.65, userLng: 0.04, routeM: 1200, ...extra });
const arrive = (uid, min, extra = {}) => ({ type: "navigation_arrive", uid, ts: iso(min), navId: "t1", targetLat: 51.66, targetLng: 0.04, userLat: 51.6599, userLng: 0.04, walkedM: 1500, ...extra });
const end = (uid, min, extra = {}) => ({ type: "navigation_end", uid, ts: iso(min), navId: "t1", reason: "arrived", userLat: 51.6599, userLng: 0.04, remainingM: 10, walkedM: 1500, ...extra });

let ip = 0;
function post(events) {
  return track.handler({ httpMethod: "POST", headers: { "x-nf-client-connection-ip": `10.9.0.${++ip}` }, body: JSON.stringify({ events }) });
}
async function adminRead() {
  const result = await track.handler({ httpMethod: "GET", headers: { authorization: "Bearer admin-pw" }, queryStringParameters: { days: "7" } });
  const body = JSON.parse(result.body);
  return { status: result.statusCode, body, navigation: tracking.unpackEvents(body.navigation) };
}

test("navigation start, arrive and end posted to the tracker come back from the admin read", async () => {
  const store = memoryStore();
  track.setStore(store);
  const res = await post([start("u1", 0), arrive("u1", 20), end("u1", 21)]);
  assert.equal(JSON.parse(res.body).stored, 3);
  const read = await adminRead();
  assert.equal(read.status, 200);
  assert.deepEqual(read.navigation.map((e) => e.type), ["navigation_start", "navigation_arrive", "navigation_end"]);
  const s = read.navigation[0];
  assert.equal(s.navId, "t1");
  assert.equal(s.navName, "Oak");
  assert.equal(s.routeM, 1200);
  assert.equal(s.targetLat, 51.66);
  assert.equal(read.navigation[1].walkedM, 1500);
  assert.equal(read.navigation[2].reason, "arrived");
  assert.equal(read.navigation[2].remainingM, 10);
  assert.deepEqual(read.body.meta.windowDays, 7);
  track.setStore(null);
});

test("sanitizeEvent drops navigation events without a valid uid, ts or target, and nulls bad numbers", () => {
  const now = Date.now();
  const clean = (e) => tracking.sanitizeEvent(e, { now });
  assert.equal(clean(start("bad uid!", 0)), null);
  assert.equal(clean(start("u1", 0, { ts: "nonsense" })), null);
  assert.equal(clean(start("u1", 0, { targetLat: null })), null);
  assert.equal(clean(start("u1", 0, { targetLng: 999 })), null);
  assert.equal(clean(arrive("u1", 0, { targetLat: "x" })), null);
  assert.equal(clean(start("u1", -60 * 24 * 100)), null, "older than the age window");
  const s = clean(start("u1", 0, { routeM: -5, userLat: 500, navName: "n".repeat(500), extra: "x" }));
  assert.equal(s.routeM, null);
  assert.equal(s.userLat, null);
  assert.equal(s.navName.length, 120);
  assert.equal("extra" in s, false);
  assert.equal(clean(arrive("u1", 0, { walkedM: Infinity })).walkedM, null);
  const e = clean(end("u1", 0, { reason: "r".repeat(100), remainingM: "abc", targetLat: undefined }));
  assert.equal(e.reason.length, 30);
  assert.equal(e.remainingM, null);
  assert.equal(clean(end("u1", 0, { uid: "" })), null);
});

test("pack and unpack round-trip navigation events", () => {
  const now = Date.now();
  const events = [start("u1", 0), arrive("u1", 5), end("u2", 6, { navId: null })].map((e) => tracking.sanitizeEvent(e, { now }));
  const packed = tracking.packEvents("navigation", events);
  assert.deepEqual(tracking.unpackEvents(JSON.parse(JSON.stringify(packed))), events);
});

test("compaction keeps start, arrive and end for the same user and time as separate events", async () => {
  const store = memoryStore();
  track.setStore(store);
  await post([start("u1", 0), arrive("u1", 0), end("u1", 0)]);
  await post([start("u1", 0)]);
  const summary = await tracking.compact(store, {});
  assert.ok(summary.compacted >= 1);
  assert.equal([...store.blobs.keys()].some((k) => k.startsWith("raw/navigation/")), false);
  const read = await adminRead();
  assert.deepEqual(read.navigation.map((e) => e.type).sort(), ["navigation_arrive", "navigation_end", "navigation_start"]);
  track.setStore(null);
});

test("a large day of navigation events still counts toward the response size budget", async () => {
  const store = memoryStore();
  const now = Date.now();
  const events = Array.from({ length: 50 }, (_, i) => tracking.sanitizeEvent(start("u1", i % 50, { navId: `n${i}` }), { now }));
  await tracking.storeBatch(store, events, { now });
  const result = await tracking.readWindow(store, { windowDays: 2, maxBytes: 64 * 10 });
  assert.equal(result.partial, true);
  assert.ok(result.navigation.length > 0 && result.navigation.length < 50);
});

// ---- Admin: explicit journeys, preference and detour ratio ----

const ev = (e) => tracking.sanitizeEvent(e, { now: Date.now() });

test("buildExplicitJourneys pairs a start with its arrive and end", () => {
  const js = M.buildExplicitJourneys([start("u1", 0), arrive("u1", 20), end("u1", 21)].map(ev));
  assert.equal(js.length, 1);
  const j = js[0];
  assert.equal(j.uid, "u1");
  assert.equal(j.explicit, true);
  assert.equal(j.arrived, true);
  assert.equal(j.arrivedAt, iso(20));
  assert.equal(j.distanceWalkedM, 1500);
  assert.equal(j.routeM, 1200);
  assert.equal(j.remainingM, null);
  assert.equal(j.target.targetLat, 51.66);
});

test("buildExplicitJourneys treats an end that is not arrived as abandoned with remaining distance", () => {
  const js = M.buildExplicitJourneys([start("u1", 0), end("u1", 5, { reason: "cleared", remainingM: 800, walkedM: 400 })].map(ev));
  assert.equal(js[0].arrived, false);
  assert.equal(js[0].remainingM, 800);
  assert.equal(js[0].distanceWalkedM, 400);
  assert.equal(js[0].endedAt, iso(5));
});

test("buildExplicitJourneys: an end reason of arrived counts as arrival, a new start ends the old journey, orphans are ignored", () => {
  const js = M.buildExplicitJourneys([
    end("u9", 0), arrive("u9", 1),
    start("u1", 10, { navId: "a" }), start("u1", 15, { navId: "b" }),
    end("u1", 30, { navId: "b", reason: "arrived", walkedM: null }),
    start("u2", 12, { navId: "c" }), end("u2", 13, { navId: "other", reason: "cleared" }),
  ].map(ev));
  const byKey = Object.fromEntries(js.map((j) => [`${j.uid}/${j.target.id}`, j]));
  assert.equal(js.length, 3);
  assert.equal(byKey["u1/a"].arrived, false);
  assert.equal(byKey["u1/b"].arrived, true);
  assert.equal(byKey["u1/b"].arrivedAt, iso(30));
  assert.equal(byKey["u2/c"].arrived, false, "an end for another navId does not close it");
});

test("combineNavJourneys prefers explicit journeys and keeps derived ones only for uncovered users and periods", () => {
  const explicit = M.buildExplicitJourneys([start("u1", 0), end("u1", 10)].map(ev));
  const d = (uid, min, endMin) => ({ uid, target: { targetLat: 1, targetLng: 1 }, startedAt: iso(min), endedAt: iso(endMin), arrived: false, arrivedAt: null, distanceWalkedM: 5, remainingM: 9 });
  const derived = [d("u1", 2, 8), d("u1", 11, 12), d("u1", 200, 210), d("u2", 2, 8)];
  const out = M.combineNavJourneys(explicit, derived);
  assert.equal(out.length, 3, "explicit + derived that is later than the gap + other user");
  assert.equal(out.filter((j) => j.explicit).length, 1);
  assert.ok(!out.some((j) => !j.explicit && j.uid === "u1" && j.startedAt === iso(2)));
  assert.ok(!out.some((j) => !j.explicit && j.uid === "u1" && j.startedAt === iso(11)), "within the gap after the explicit end is covered");
  assert.ok(out.some((j) => !j.explicit && j.uid === "u2"));
  assert.ok(out.some((j) => !j.explicit && j.startedAt === iso(200)));
  assert.equal(M.combineNavJourneys([], derived).length, derived.length, "no explicit journeys: every derived one is kept");
  assert.deepEqual(M.combineNavJourneys(null, null), []);
});

test("summariseNavJourneys reports the median detour ratio over journeys with route and walked distance", () => {
  const j = (routeM, walkedM) => ({ uid: "u", startedAt: iso(0), arrived: true, arrivedAt: iso(3), distanceWalkedM: walkedM || 0, routeM, walkedM });
  const s = M.summariseNavJourneys([j(1000, 1200), j(1000, 1500), j(500, 500), j(null, 700), j(800, null), { uid: "u", startedAt: iso(0), arrived: false, distanceWalkedM: 1 }]);
  assert.equal(s.detourCount, 3);
  assert.equal(s.medianDetourRatio, 1.2);
  const none = M.summariseNavJourneys([{ uid: "u", startedAt: iso(0), arrived: false, distanceWalkedM: 1 }]);
  assert.equal(none.detourCount, 0);
  assert.equal(none.medianDetourRatio, null);
  assert.equal(M.summariseNavJourneys([]).medianDetourRatio, null);
});

test("detour ratio counts completed explicit journeys only, not abandoned ones", () => {
  const events = [
    start("u1", 0, { navId: "a", routeM: 1000 }), arrive("u1", 20, { navId: "a", walkedM: 1100 }), end("u1", 21, { navId: "a", walkedM: 1100 }),
    start("u2", 0, { navId: "b", routeM: 1200 }), end("u2", 5, { navId: "b", reason: "cleared", remainingM: 800, walkedM: 300 }),
  ].map(ev);
  const s = M.summariseNavJourneys(M.buildExplicitJourneys(events));
  assert.equal(s.started, 2);
  assert.equal(s.detourCount, 1);
  assert.equal(s.medianDetourRatio, 1.1);
});

test("an explicit end (changed) and the next start sharing a millisecond keep the old journey's data", async () => {
  const store = memoryStore();
  const now = Date.now();
  const at = new Date(now - 10 * MIN).toISOString();
  const events = [
    start("u1", 0, { navId: "a" }),
    { ...end("u1", 0, { navId: "a", reason: "changed", remainingM: 400, walkedM: 120 }), ts: at },
    { ...start("u1", 0, { navId: "b" }), ts: at },
  ];
  events[0].ts = new Date(now - 20 * MIN).toISOString();
  await tracking.storeBatch(store, events.map((e) => tracking.sanitizeEvent(e, { now })), { now });
  const result = await tracking.readWindow(store, { windowDays: 2, now });
  const journeys = M.buildExplicitJourneys(result.navigation);
  const a = journeys.find((j) => j.navId === "a");
  assert.equal(a.reason, "changed");
  assert.equal(a.remainingM, 400);
  assert.equal(a.walkedM, 120);
  assert.ok(journeys.some((j) => j.navId === "b"));
});

test("a navigation_end with an absurd walkedM is stored as unknown, a plausible one is kept", () => {
  const now = Date.now();
  assert.equal(tracking.sanitizeEvent(end("u1", 0, { walkedM: 1e15 }), { now }).walkedM, null);
  assert.equal(tracking.sanitizeEvent(end("u1", 0, { remainingM: 1e15 }), { now }).remainingM, null);
  assert.equal(tracking.sanitizeEvent(start("u1", 0, { routeM: 1e15 }), { now }).routeM, null);
  assert.equal(tracking.sanitizeEvent(end("u1", 0, { walkedM: 2000 }), { now }).walkedM, 2000);
});
