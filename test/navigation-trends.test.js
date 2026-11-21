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

// ---- topDestinationsThisWeek ----
const NOW = Date.parse("2026-11-10T12:00:00Z");
const DAY = 24 * 60 * MIN;
const dest = (id, name, lat = 51.5, lng = 0.1) => ({ target: { id, name, type: "place", targetLat: lat, targetLng: lng } });

test("topDestinationsThisWeek leaves out a journey that started 8 days ago", () => {
  const rows = M.topDestinationsThisWeek([
    journey(NOW - 8 * DAY, 5, dest("a", "Fictional Pond")),
    journey(NOW - 2 * DAY, 5, dest("b", "Fictional Gate")),
  ], { now: NOW });
  assert.deepEqual(rows.map((r) => r.name), ["Fictional Gate"]);
});

test("topDestinationsThisWeek adds up the same destination across journeys", () => {
  const rows = M.topDestinationsThisWeek([
    journey(NOW - 3 * DAY, 4, dest("a", "Fictional Pond")),
    journey(NOW - 2 * DAY, null, dest("a", "Fictional Pond")),
    journey(NOW - 1 * DAY, 8, dest("a", "Fictional Pond")),
  ], { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].started, 3);
  assert.equal(rows[0].completed, 2);
  assert.equal(rows[0].completionRate, 2 / 3);
  assert.equal(rows[0].share, 1);
});

test("topDestinationsThisWeek orders ties on started by completed, then name", () => {
  const rows = M.topDestinationsThisWeek([
    journey(NOW - DAY, null, dest("a", "Alpha Glade")),
    journey(NOW - DAY, null, dest("a", "Alpha Glade")),
    journey(NOW - DAY, 3, dest("b", "Beta Hollow")),
    journey(NOW - DAY, null, dest("b", "Beta Hollow")),
    journey(NOW - DAY, 3, dest("c", "Aardvark Mound")),
    journey(NOW - DAY, 3, dest("c", "Aardvark Mound")),
    journey(NOW - DAY, 3, dest("d", "Zed Mound")),
    journey(NOW - DAY, 3, dest("d", "Zed Mound")),
  ], { now: NOW });
  assert.deepEqual(rows.map((r) => r.name), ["Aardvark Mound", "Zed Mound", "Beta Hollow", "Alpha Glade"]);
});

test("topDestinationsThisWeek shows at most 5 of 7 destinations, most started first", () => {
  const js = [];
  for (let i = 0; i < 7; i++) for (let k = 0; k <= i; k++) js.push(journey(NOW - DAY, 3, dest(`d${i}`, `Place ${i}`)));
  const rows = M.topDestinationsThisWeek(js, { now: NOW });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.started), [7, 6, 5, 4, 3]);
  assert.equal(rows[0].share, 1);
  assert.equal(M.topDestinationsThisWeek(js, { now: NOW, limit: 2 }).length, 2);
});

test("topDestinationsThisWeek takes the median time from completed journeys only", () => {
  const rows = M.topDestinationsThisWeek([
    journey(NOW - DAY, 4, dest("a", "Fictional Pond")),
    journey(NOW - DAY, 10, dest("a", "Fictional Pond")),
    journey(NOW - DAY, null, dest("a", "Fictional Pond")),
    journey(NOW - DAY, null, dest("b", "Fictional Gate")),
  ], { now: NOW });
  assert.equal(rows[0].medianMinutesToArrive, 7);
  assert.equal(rows[1].medianMinutesToArrive, null);
});

test("topDestinationsThisWeek groups by rounded coordinates without an id, and names unnamed places", () => {
  const noId = (lat, lng) => ({ target: { id: null, name: null, targetLat: lat, targetLng: lng } });
  const rows = M.topDestinationsThisWeek([
    journey(NOW - DAY, 3, noId(51.500001, 0.1)),
    journey(NOW - DAY, 3, noId(51.500002, 0.1)),
  ], { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].started, 2);
  assert.equal(rows[0].name, "Unnamed place");
});

test("topDestinationsThisWeek gives an empty list for no journeys", () => {
  assert.deepEqual(M.topDestinationsThisWeek([], { now: NOW }), []);
  assert.deepEqual(M.topDestinationsThisWeek(undefined, { now: NOW }), []);
});
