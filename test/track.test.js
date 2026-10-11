/**
 * Admin read windowing in netlify/functions/track.js.
 *
 * The GET handler used to list and download every stored blob on every admin login,
 * refresh and 5-minute auto-refresh. Blob count grows without bound (one blob per POST
 * batch, forever), so once a deployment had been live long enough the download alone
 * exceeded the Netlify function execution limit and the request 504d. These tests cover
 * the windowing logic that now filters blob keys by their embedded write time before any
 * blob content is fetched, so the default admin read stays bounded regardless of how much
 * history has accumulated.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const track = require("../netlify/functions/track.js");

test("parseWindowDays defaults to 30 days when no days param is given", () => {
  assert.strictEqual(track.parseWindowDays({ queryStringParameters: {} }), track.DEFAULT_WINDOW_DAYS);
  assert.strictEqual(track.parseWindowDays({ queryStringParameters: null }), track.DEFAULT_WINDOW_DAYS);
});

test("parseWindowDays honours an explicit numeric days param", () => {
  assert.strictEqual(track.parseWindowDays({ queryStringParameters: { days: "7" } }), 7);
});

test("parseWindowDays falls back to the default for a non-positive or nonsense days param", () => {
  for (const days of ["0", "-5", "nope", ""]) {
    assert.strictEqual(track.parseWindowDays({ queryStringParameters: { days } }), track.DEFAULT_WINDOW_DAYS);
  }
});

test("parseWindowDays treats days=all as no window", () => {
  assert.strictEqual(track.parseWindowDays({ queryStringParameters: { days: "all" } }), null);
});

test("windowSinceMs converts a window into a cutoff timestamp, or null for no window", () => {
  const now = Date.now();
  const sinceMs = track.windowSinceMs(30);
  assert.ok(sinceMs < now);
  assert.ok(Math.abs(now - sinceMs - 30 * 24 * 60 * 60 * 1000) < 1000);
  assert.strictEqual(track.windowSinceMs(null), null);
});

test("blobKeyTimestampMs reads the millisecond timestamp a batch key was written with", () => {
  assert.strictEqual(track.blobKeyTimestampMs("location/1700000000000_ab12cd.json"), 1700000000000);
  assert.strictEqual(track.blobKeyTimestampMs("click/1700000000000_ab12cd.json"), 1700000000000);
});

test("blobKeyTimestampMs returns null for a key it doesn't recognise", () => {
  assert.strictEqual(track.blobKeyTimestampMs("location/not-a-timestamp.json"), null);
  assert.strictEqual(track.blobKeyTimestampMs(""), null);
  assert.strictEqual(track.blobKeyTimestampMs(undefined), null);
});

test("blobKeyWithinWindow keeps everything when there is no window", () => {
  assert.strictEqual(track.blobKeyWithinWindow("location/1_a.json", null), true);
});

test("blobKeyWithinWindow drops a key older than the cutoff and keeps a newer one", () => {
  const sinceMs = 1_000_000;
  assert.strictEqual(track.blobKeyWithinWindow("location/999999_a.json", sinceMs), false);
  assert.strictEqual(track.blobKeyWithinWindow("location/1000000_a.json", sinceMs), true);
  assert.strictEqual(track.blobKeyWithinWindow("location/2000000_a.json", sinceMs), true);
});

test("blobKeyWithinWindow keeps a key it can't parse rather than silently dropping data", () => {
  assert.strictEqual(track.blobKeyWithinWindow("location/garbled.json", 1_000_000), true);
});

test("eventWithinWindow filters the file-fallback path by each event's own ts", () => {
  const sinceMs = Date.parse("2026-09-01T00:00:00Z");
  assert.strictEqual(track.eventWithinWindow({ ts: "2026-08-01T00:00:00Z" }, sinceMs), false);
  assert.strictEqual(track.eventWithinWindow({ ts: "2026-09-15T00:00:00Z" }, sinceMs), true);
  assert.strictEqual(track.eventWithinWindow({ ts: "not-a-date" }, sinceMs), true);
  assert.strictEqual(track.eventWithinWindow({ ts: "2026-08-01T00:00:00Z" }, null), true);
});

test("an admin read with no credentials is rejected before any windowing happens", async () => {
  const result = await track.handler({ httpMethod: "GET", queryStringParameters: {} });
  assert.strictEqual(result.statusCode, 401);
});
