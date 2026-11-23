"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/admin-tools.js");

const LIMITS = { min: 0.85, max: 14 };
const SIZE = { width: 400, height: 600 };
// Screen position of a world point q (zoom 1, no pan) under a viewport, the way the map draws it.
const screen = (vp, q) => ({
  x: SIZE.width / 2 + vp.panX + vp.zoom * (q.x - SIZE.width / 2),
  y: SIZE.height / 2 + vp.panY + vp.zoom * (q.y - SIZE.height / 2),
});

test("pinching apart doubles the zoom and keeps the point under the fingers where it was", () => {
  const start = { zoom: 1, panX: 10, panY: -20, mid: { x: 150, y: 250 }, dist: 100 };
  const before = { x: 150 - 10 + 0, y: 250 + 20 };
  // The world point under the first midpoint (invert the screen formula).
  const q = { x: SIZE.width / 2 + (150 - SIZE.width / 2 - 10) / 1, y: SIZE.height / 2 + (250 - SIZE.height / 2 + 20) / 1 };
  assert.ok(before);
  const next = T.pinchViewport(start, { mid: { x: 150, y: 250 }, dist: 200 }, SIZE, LIMITS);
  assert.equal(next.zoom, 2);
  const at = screen(next, q);
  assert.ok(Math.abs(at.x - 150) < 1e-9 && Math.abs(at.y - 250) < 1e-9);
});

test("moving both fingers while pinching pans the map with them", () => {
  const start = { zoom: 2, panX: 0, panY: 0, mid: { x: 200, y: 300 }, dist: 80 };
  const q = { x: 200, y: 300 }; // centre world point sits at zoom-independent centre
  const next = T.pinchViewport(start, { mid: { x: 230, y: 280 }, dist: 80 }, SIZE, LIMITS);
  assert.equal(next.zoom, 2);
  const at = screen(next, q);
  assert.ok(Math.abs(at.x - 230) < 1e-9 && Math.abs(at.y - 280) < 1e-9);
});

test("pinching never zooms past the map's limits", () => {
  const start = { zoom: 10, panX: 0, panY: 0, mid: { x: 200, y: 300 }, dist: 50 };
  assert.equal(T.pinchViewport(start, { mid: start.mid, dist: 5000 }, SIZE, LIMITS).zoom, 14);
  assert.equal(T.pinchViewport(start, { mid: start.mid, dist: 1 }, SIZE, LIMITS).zoom, 0.85);
});

test("a pinch whose fingers touch (zero distance) does not produce NaN", () => {
  const next = T.pinchViewport({ zoom: 1, panX: 0, panY: 0, mid: { x: 1, y: 1 }, dist: 0 }, { mid: { x: 1, y: 1 }, dist: 0 }, SIZE, LIMITS);
  assert.ok(Number.isFinite(next.zoom) && Number.isFinite(next.panX) && Number.isFinite(next.panY));
});

test("a tap near a route line finds that user, within the tolerance only", () => {
  const tracks = [
    { uid: "a", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    { uid: "b", points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
  ];
  assert.equal(T.nearestTrackAt(tracks, 50, 10, 12).uid, "a");
  assert.equal(T.nearestTrackAt(tracks, 50, 40, 12).uid, "b");
  assert.equal(T.nearestTrackAt(tracks, 50, 25, 12), null);
  assert.equal(T.nearestTrackAt(tracks, 112, 0, 12).uid, "a"); // just past the end, still within reach
  assert.equal(T.nearestTrackAt([{ uid: "solo", points: [{ x: 5, y: 5 }] }], 8, 5, 12).uid, "solo");
});

const ping = (min, lat, lng) => ({ ts: new Date(Date.parse("2026-11-01T10:00:00Z") + min * 60000).toISOString(), lat, lng });

test("a track summary gives first and last ping, duration, ping count and straight-line distance", () => {
  // Out of order on purpose: the track is read by time.
  const s = T.summariseTrack([ping(2, 51.652, 0.04), ping(0, 51.650, 0.04), ping(1, 51.651, 0.04)]);
  assert.equal(s.count, 3);
  assert.equal(s.start.t, Date.parse("2026-11-01T10:00:00Z"));
  assert.equal(s.stop.t, Date.parse("2026-11-01T10:02:00Z"));
  assert.equal(s.start.lat, 51.65);
  assert.equal(s.stop.lat, 51.652);
  assert.equal(s.durationMs, 120000);
  assert.ok(Math.abs(s.distanceM - 222.4) < 1.5, `distance ${s.distanceM}`);
});

test("a track summary does not count the hop across a gap of more than 3 minutes as walked", () => {
  const s = T.summariseTrack([ping(0, 51.650, 0.04), ping(1, 51.651, 0.04), ping(10, 51.700, 0.04), ping(11, 51.701, 0.04)]);
  assert.equal(s.count, 4);
  assert.ok(s.distanceM < 250, `gap skipped, got ${s.distanceM}`);
  assert.equal(s.durationMs, 11 * 60000);
});

test("a track with a single ping or no usable pings summarises safely", () => {
  const one = T.summariseTrack([ping(0, 51.65, 0.04)]);
  assert.equal(one.count, 1);
  assert.equal(one.distanceM, 0);
  assert.equal(one.durationMs, 0);
  assert.equal(T.summariseTrack([]), null);
  assert.equal(T.summariseTrack([{ ts: "nonsense", lat: 1, lng: 1 }, { ts: ping(0).ts, lat: null, lng: 0.1 }]), null);
});

test("durations and distances read in plain units", () => {
  assert.equal(T.formatDuration(45000), "45 s");
  assert.equal(T.formatDuration(12 * 60000), "12 min");
  assert.equal(T.formatDuration(65 * 60000), "1 h 5 min");
  assert.equal(T.formatDistance(412.4), "412 m");
  assert.equal(T.formatDistance(1530), "1.53 km");
});

test("the time frame defaults to 30 days and unknown values fall back to it", () => {
  assert.equal(T.normaliseWindow(undefined), "30");
  assert.equal(T.normaliseWindow("7"), "7");
  assert.equal(T.normaliseWindow("ALL"), "all");
  assert.equal(T.normaliseWindow("365"), "30");
  assert.equal(T.normaliseWindow("abc"), "30");
});

test("a window that cannot load falls back to 7 then 1 days, never to a longer one", () => {
  assert.deepEqual(T.windowAttempts("30"), ["30", "7", "1"]);
  assert.deepEqual(T.windowAttempts("all"), ["all", "7", "1"]);
  assert.deepEqual(T.windowAttempts("90"), ["90", "7", "1"]);
  assert.deepEqual(T.windowAttempts("7"), ["7", "1"]);
  assert.deepEqual(T.windowAttempts("1"), ["1"]);
});

test("window wording reads naturally for 24 hours, days and all history", () => {
  assert.equal(T.windowPhrase(1), "the last 24 hours");
  assert.equal(T.windowPhrase(30), "the last 30 days");
  assert.equal(T.windowPhrase(null), "all loaded history");
  assert.equal(T.windowShort(1), "24 hours");
  assert.equal(T.windowShort(null), "All history");
});

test("the beta filter keeps only events marked beta and copes with old data that has no mark", () => {
  const events = [{ uid: "a", beta: true }, { uid: "b" }, { uid: "c", beta: false }, null];
  assert.deepEqual(T.onlyBeta(events).map((e) => e.uid), ["a"]);
  assert.deepEqual(T.onlyBeta(undefined), []);
});
