"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/navigation-metrics.js");

// Noon UTC keeps the local calendar day stable in any real timezone.
const at = (day, hour = 12) => `2026-10-${day}T${String(hour).padStart(2, "0")}:00:00Z`;
const ping = (uid, ts) => ({ type: "location", uid, ts, lat: 51.65, lng: 0.04 });
const tap = (uid, ts) => ({ type: "click", uid, ts });

test("activity by day counts distinct users, pings and taps per day, oldest first", () => {
  const rows = M.groupActivityByDay(
    [ping("a", at("21")), ping("a", at("21", 13)), ping("b", at("21")), ping("a", at("20"))],
    [tap("c", at("21"))],
  );
  assert.deepEqual(rows, [
    { day: "2026-10-20", users: 1, pings: 1, taps: 0 },
    { day: "2026-10-21", users: 3, pings: 3, taps: 1 },
  ]);
});

test("a quiet day between two active days is a row of zeros so the trend reads as a trend", () => {
  const rows = M.groupActivityByDay([ping("a", at("20")), ping("a", at("23"))], []);
  assert.deepEqual(rows.map((r) => [r.day, r.users, r.pings, r.taps]), [
    ["2026-10-20", 1, 1, 0], ["2026-10-21", 0, 0, 0], ["2026-10-22", 0, 0, 0], ["2026-10-23", 1, 1, 0],
  ]);
});

test("a user who only tapped still counts as active that day", () => {
  const [row] = M.groupActivityByDay([], [tap("a", at("20")), tap("a", at("20", 13))]);
  assert.deepEqual(row, { day: "2026-10-20", users: 1, pings: 0, taps: 2 });
});

test("days are filled across a month end", () => {
  const rows = M.groupActivityByDay([{ uid: "a", ts: "2026-10-30T12:00:00Z" }, { uid: "a", ts: "2026-11-02T12:00:00Z" }], []);
  assert.deepEqual(rows.map((r) => r.day), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
});

test("no activity, or events without a readable time, give no rows", () => {
  assert.deepEqual(M.groupActivityByDay([], []), []);
  assert.deepEqual(M.groupActivityByDay(undefined, undefined), []);
  assert.deepEqual(M.groupActivityByDay([{ uid: "a", ts: "not a time" }, null], [{ uid: "a" }]), []);
});
