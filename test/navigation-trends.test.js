"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/navigation-metrics.js");

// Fictional journeys. Noon UTC keeps the local calendar day stable in any real timezone.
const MIN = 60 * 1000;
const D1 = Date.parse("2026-10-20T12:00:00Z");
const D2 = Date.parse("2026-10-21T12:00:00Z");
const iso = (t) => new Date(t).toISOString();
function journey(start, arriveAfterMin, extra = {}) {
  const arrived = arriveAfterMin !== null;
  return {
    uid: "u1", explicit: true, startedAt: iso(start), endedAt: iso(start + (arrived ? arriveAfterMin : 1) * MIN),
    arrived, arrivedAt: arrived ? iso(start + arriveAfterMin * MIN) : null,
    distanceWalkedM: 100, walkedM: null, routeM: null, ...extra,
  };
}

test("groupJourneysByDay groups journeys on two days, oldest first", () => {
  const rows = M.groupJourneysByDay([
    journey(D2, 10), journey(D1, 3), journey(D1 + 5 * MIN, null),
  ]);
  assert.deepEqual(rows.map((r) => [r.day, r.started, r.completed, r.completionRate]), [
    ["2026-10-20", 2, 1, 0.5],
    ["2026-10-21", 1, 1, 1],
  ]);
});

test("groupJourneysByDay gives an empty list for no journeys", () => {
  assert.deepEqual(M.groupJourneysByDay([]), []);
  assert.deepEqual(M.groupJourneysByDay(undefined), []);
});

test("a day with only abandoned journeys has completion rate 0 and no median detour", () => {
  const [row] = M.groupJourneysByDay([journey(D1, null), journey(D1 + MIN, null)]);
  assert.equal(row.started, 2);
  assert.equal(row.completed, 0);
  assert.equal(row.completionRate, 0);
  assert.equal(row.medianDetourRatio, null);
});

test("median detour ratio per day uses completed journeys only", () => {
  const [row] = M.groupJourneysByDay([
    journey(D1, 10, { routeM: 1000, walkedM: 1200 }),
    journey(D1 + MIN, 10, { routeM: 1000, walkedM: 1400 }),
    journey(D1 + 2 * MIN, null, { routeM: 1000, walkedM: 9000 }),
  ]);
  assert.ok(Math.abs(row.medianDetourRatio - 1.3) < 1e-9);
});

test("time buckets per day add up to the completed journeys that day", () => {
  const rows = M.groupJourneysByDay([
    journey(D1, 2), journey(D1 + MIN, 10), journey(D1 + 2 * MIN, 20), journey(D1 + 3 * MIN, 45), journey(D1 + 4 * MIN, null),
    journey(D2, 4),
  ]);
  for (const r of rows) {
    const sum = r.timeBuckets.lt5 + r.timeBuckets.b5to15 + r.timeBuckets.b15to30 + r.timeBuckets.gt30;
    assert.equal(sum, r.completed);
  }
  assert.deepEqual(rows[0].timeBuckets, { lt5: 1, b5to15: 1, b15to30: 1, gt30: 1 });
  assert.equal(rows[0].completed, 4);
});

test("summary reports the median time to arrive over completed journeys", () => {
  const s = M.summariseNavJourneys([journey(D1, 4), journey(D1 + MIN, 10), journey(D1 + 2 * MIN, 40), journey(D1 + 3 * MIN, null)]);
  assert.equal(s.medianArriveMinutes, 10);
  assert.equal(M.summariseNavJourneys([journey(D1, null)]).medianArriveMinutes, null);
});
