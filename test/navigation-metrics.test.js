"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/navigation-metrics.js");

// 0.0003 deg latitude is about 33.4 m; 0.0001 deg is about 11.1 m.
const LAT0 = 51.66;
const LNG0 = 0.04;
const MIN = 60 * 1000;
const T0 = Date.parse("2026-06-01T10:00:00Z");
const target = { id: "t1", name: "Target", type: "tree", targetLat: LAT0, targetLng: LNG0 };
// Metres north of the target, via a known metres-per-degree figure (independent of the module).
const northOf = (m) => LAT0 + m / 111195;
function ping(min, metresNorth, nav = target, uid = "u1") {
  return { uid, ts: new Date(T0 + min * MIN).toISOString(), lat: northOf(metresNorth), lng: LNG0, navTarget: nav };
}
const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ""} expected ${expected} +/- ${tol}, got ${actual}`);

test("haversineMetres matches a known 0.0003 degree latitude offset", () => {
  near(M.haversineMetres(LAT0, LNG0, LAT0 + 0.0003, LNG0), 33.4, 0.5);
});

test("constants are 30 m and 3 minutes", () => {
  assert.equal(M.NAV_ARRIVAL_RADIUS_M, 30);
  assert.equal(M.NAV_GAP_MS, 3 * MIN);
});

test("a walker who arrives in under 5 minutes is counted, bucketed and measured", () => {
  const pings = [ping(0, 300), ping(1, 200), ping(2, 100), ping(3, 20)];
  const journeys = M.deriveNavJourneys(pings);
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0].arrived, true);
  near(journeys[0].distanceWalkedM, 280, 3);
  const s = M.summariseNavJourneys(journeys);
  assert.equal(s.started, 1);
  assert.equal(s.completed, 1);
  assert.equal(s.completionRate, 1);
  assert.equal(s.timeBuckets.lt5, 1);
  assert.equal(s.abandoned, 0);
  assert.equal(s.medianRemainingM, null);
  near(s.totalDistanceWalkedM, 280, 3);
});

test("a journey that never gets within 30 m is abandoned with the remaining distance", () => {
  const journeys = M.deriveNavJourneys([ping(0, 500), ping(1, 400), ping(2, 250)]);
  assert.equal(journeys[0].arrived, false);
  near(journeys[0].remainingM, 250, 3);
  const s = M.summariseNavJourneys(journeys);
  assert.equal(s.completed, 0);
  assert.equal(s.completionRate, 0);
  assert.equal(s.abandoned, 1);
  near(s.medianRemainingM, 250, 3);
});

test("median remaining distance of abandoned journeys uses the middle value", () => {
  const mk = (uid, m) => [ping(0, m + 100, target, uid), ping(1, m, target, uid)];
  const s = M.summariseNavJourneys(M.deriveNavJourneys([...mk("a", 100), ...mk("b", 200), ...mk("c", 900)]));
  assert.equal(s.abandoned, 3);
  near(s.medianRemainingM, 200, 3);
});

test("after a 4-minute gap the first journey ends where it stopped and distance excludes the jump", () => {
  const journeys = M.deriveNavJourneys([ping(0, 500), ping(1, 400), ping(5, 100), ping(6, 90)]);
  assert.equal(journeys.length, 2, "pings after the gap start a fresh journey");
  const first = journeys[0];
  assert.equal(first.arrived, false);
  near(first.distanceWalkedM, 100, 2);
  near(first.remainingM, 400, 3);
});

test("a gap of exactly 3 minutes does not end the journey", () => {
  const journeys = M.deriveNavJourneys([ping(0, 200), ping(3, 10)]);
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0].arrived, true);
  near(journeys[0].distanceWalkedM, 190, 3);
});

// Offsets of 29.9 m and 30.5 m straddle the boundary, allowing for ~0.01 m metres-per-degree rounding.
test("30 m arrives and 31 m does not", () => {
  assert.equal(M.deriveNavJourneys([ping(0, 100), ping(1, 29.9)])[0].arrived, true);
  assert.equal(M.deriveNavJourneys([ping(0, 100), ping(1, 30.5)])[0].arrived, false);
});

test("the start ping within 30 m arrives immediately", () => {
  const j = M.deriveNavJourneys([ping(0, 10), ping(1, 5)])[0];
  assert.equal(j.arrived, true);
  assert.equal(j.arrivedAt, new Date(T0).toISOString());
});

test("the walk ends at arrival, so later pings are not counted", () => {
  const j = M.deriveNavJourneys([ping(0, 200), ping(1, 20), ping(2, 300)])[0];
  near(j.distanceWalkedM, 180, 3);
});

test("pings with no navTarget never start a journey", () => {
  assert.deepEqual(M.deriveNavJourneys([ping(0, 100, null), ping(1, 50, null)]), []);
  const noCoords = { id: "x", name: "x", type: "tree" };
  assert.deepEqual(M.deriveNavJourneys([ping(0, 100, noCoords)]), []);
});

test("pings with non-finite coordinates are ignored", () => {
  const bad = { ...ping(1, 100), lat: NaN };
  const journeys = M.deriveNavJourneys([ping(0, 200), bad, ping(2, 150)]);
  assert.equal(journeys.length, 1);
  near(journeys[0].distanceWalkedM, 50, 2);
});

test("a journey that changes target is split into two", () => {
  const other = { id: "t2", name: "Other", type: "tree", targetLat: LAT0 + 0.01, targetLng: LNG0 };
  const journeys = M.deriveNavJourneys([ping(0, 500), ping(1, 400), ping(2, 400, other), ping(3, 380, other)]);
  assert.equal(journeys.length, 2);
  assert.equal(journeys[0].target.id, "t1");
  assert.equal(journeys[1].target.id, "t2");
});

test("clearing the navTarget ends the journey, and a new target starts another", () => {
  const journeys = M.deriveNavJourneys([ping(0, 500), ping(1, 400, null), ping(2, 300), ping(3, 290, null), ping(4, 250)]);
  assert.equal(journeys.length, 3);
});

test("journeys are derived per user and from unsorted input", () => {
  const journeys = M.deriveNavJourneys([ping(1, 20, target, "b"), ping(1, 20), ping(0, 200, target, "b"), ping(0, 200)]);
  assert.equal(journeys.length, 2);
  assert.ok(journeys.every((j) => j.arrived));
});

test("targets without an id match by coordinates", () => {
  const a = { targetLat: LAT0, targetLng: LNG0 };
  const b = { targetLat: LAT0, targetLng: LNG0 };
  assert.equal(M.deriveNavJourneys([ping(0, 200, a), ping(1, 100, b)]).length, 1);
});

test("time buckets have the right edges", () => {
  const b = M.navTimeBucket;
  assert.equal(b(4 + 59 / 60), "lt5");
  assert.equal(b(5), "b5to15");
  assert.equal(b(14 + 59 / 60), "b5to15");
  assert.equal(b(15), "b15to30");
  assert.equal(b(30), "b15to30");
  assert.equal(b(30 + 1 / 60), "gt30");
});

test("an arrival after exactly 5 minutes of a 3-minute-gap-free walk lands in the 5 to 15 bucket", () => {
  const pings = [ping(0, 400), ping(2.5, 300), ping(5, 20)];
  const s = M.summariseNavJourneys(M.deriveNavJourneys(pings));
  assert.equal(s.timeBuckets.b5to15, 1);
  assert.equal(s.timeBuckets.lt5, 0);
});

test("an empty summary has a null completion rate", () => {
  const s = M.summariseNavJourneys([]);
  assert.equal(s.started, 0);
  assert.equal(s.completionRate, null);
  assert.equal(s.medianRemainingM, null);
  assert.equal(s.totalDistanceWalkedM, 0);
});

test("a walker lingering at the target after arriving does not start more journeys", () => {
  const journeys = M.deriveNavJourneys([ping(0, 300), ping(1, 100), ping(2, 20), ping(5, 15), ping(6, 12), ping(7, 18), ping(8, 10)]);
  assert.equal(journeys.length, 1);
  const s = M.summariseNavJourneys(journeys);
  assert.equal(s.started, 1);
  assert.equal(s.completed, 1);
  near(s.totalDistanceWalkedM, 280, 3);
});

test("after arriving, the same target starts a fresh journey once the target clears or a long gap passes", () => {
  const cleared = M.deriveNavJourneys([ping(0, 20), ping(1, 10), ping(2, 500, null), ping(3, 20)]);
  assert.equal(cleared.length, 2);
  const gap = M.deriveNavJourneys([ping(0, 20), ping(1, 10), ping(10, 20)]);
  assert.equal(gap.length, 2);
});
