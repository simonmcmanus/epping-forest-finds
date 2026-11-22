/** London wall-clock helpers (scripts/lib/uk-time.js), across GMT, BST and the clock changes. */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { ukDate, londonWallTimeToUtc, nextDate } = require("../scripts/lib/uk-time.js");

const iso = (ms) => new Date(ms).toISOString();

test("winter London time is the same as UTC", () => {
  assert.strictEqual(iso(londonWallTimeToUtc("2026-12-10", "10:00")), "2026-12-10T10:00:00.000Z");
});

test("summer London time is an hour ahead of UTC", () => {
  assert.strictEqual(iso(londonWallTimeToUtc("2026-07-10", "09:00")), "2026-07-10T08:00:00.000Z");
});

test("midnight London on a summer date is the evening before in UTC", () => {
  assert.strictEqual(iso(londonWallTimeToUtc("2026-07-10", "00:00")), "2026-07-09T23:00:00.000Z");
});

test("times either side of the spring clock change use the right offset", () => {
  // Clocks go forward at 01:00 UTC on 29 March 2026.
  assert.strictEqual(iso(londonWallTimeToUtc("2026-03-29", "00:30")), "2026-03-29T00:30:00.000Z");
  assert.strictEqual(iso(londonWallTimeToUtc("2026-03-29", "02:30")), "2026-03-29T01:30:00.000Z");
});

test("times either side of the autumn clock change use the right offset", () => {
  // Clocks go back at 01:00 UTC on 25 October 2026.
  assert.strictEqual(iso(londonWallTimeToUtc("2026-10-25", "00:30")), "2026-10-24T23:30:00.000Z");
  assert.strictEqual(iso(londonWallTimeToUtc("2026-10-25", "09:00")), "2026-10-25T09:00:00.000Z");
});

test("the UK date follows London, not UTC", () => {
  assert.strictEqual(ukDate(Date.parse("2026-07-05T23:30:00Z")), "2026-07-06");
  assert.strictEqual(ukDate(Date.parse("2026-12-05T23:30:00Z")), "2026-12-05");
});

test("the next date rolls over month, year and leap day", () => {
  assert.strictEqual(nextDate("2026-12-31"), "2027-01-01");
  assert.strictEqual(nextDate("2028-02-28"), "2028-02-29");
  assert.strictEqual(nextDate("2026-03-31"), "2026-04-01");
});
