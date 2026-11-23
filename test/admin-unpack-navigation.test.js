"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { packEvents } = require("../netlify/functions/lib/tracking-store.js");
const { buildExplicitJourneys } = require("../js/navigation-metrics.js");

// admin.js is a browser script that boots the dashboard, so run only the unpacking code from it.
const source = fs.readFileSync(path.join(__dirname, "..", "js", "admin.js"), "utf8");
const start = source.indexOf("const PACKED_FIELDS");
const end = source.indexOf("// When a window still has too much");
assert.ok(start > 0 && end > start, "unpack code found in admin.js");
const sandbox = {};
vm.runInNewContext(`${source.slice(start, end)}\nthis.unpackTrackingEvents = unpackTrackingEvents;`, sandbox);
const { unpackTrackingEvents } = sandbox;

const T0 = Date.parse("2026-06-01T10:00:00Z");
const ev = (type, min, extra) => ({ type, uid: "u1", ts: new Date(T0 + min * 60000).toISOString(), navId: "n1", ...extra });

test("the admin dashboard unpacks packed navigation events into explicit journeys with routeM and walkedM", () => {
  const events = [
    ev("navigation_start", 0, { navName: "Target", navType: "tree", targetLat: 51.66, targetLng: 0.04, userLat: 51.67, userLng: 0.05, routeM: 900 }),
    ev("navigation_arrive", 10, { targetLat: 51.66, targetLng: 0.04, userLat: 51.66, userLng: 0.04, walkedM: 1100 }),
    ev("navigation_end", 11, { userLat: 51.66, userLng: 0.04, walkedM: 1100, remainingM: 0, reason: "arrived" }),
  ];
  const unpacked = unpackTrackingEvents(JSON.parse(JSON.stringify(packEvents("navigation", events))));
  assert.deepEqual(unpacked.map((e) => e.type), ["navigation_start", "navigation_arrive", "navigation_end"]);
  assert.equal(unpacked[0].navId, "n1");
  assert.equal(unpacked[0].routeM, 900);
  assert.equal(unpacked[1].walkedM, 1100);
  assert.equal(unpacked[2].remainingM, 0);
  assert.equal(unpacked[2].reason, "arrived");

  const journeys = buildExplicitJourneys(unpacked);
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0].explicit, true);
  assert.equal(journeys[0].routeM, 900);
  assert.equal(journeys[0].walkedM, 1100);
  assert.equal(journeys[0].arrived, true);
});

test("unpacking marks beta events from the packed beta index and leaves old data without a beta key untouched", () => {
  const clicks = [
    { type: "click", uid: "u1", ts: new Date(T0).toISOString(), userLat: 51.65, userLng: 0.04, targetLat: 51.66, targetLng: 0.05, itemType: "tree", itemId: "T1", itemName: "Oak", source: "map" },
    { type: "click", uid: "u2", ts: new Date(T0 + 60000).toISOString(), userLat: 51.65, userLng: 0.04, targetLat: 51.66, targetLng: 0.05, itemType: "tree", itemId: "T1", itemName: "Oak", source: "map" },
  ];
  const packed = JSON.parse(JSON.stringify(packEvents("click", clicks)));
  const old = unpackTrackingEvents(packed);
  assert.deepEqual(old.map((e) => e.beta), [undefined, undefined], "no beta key: nothing is marked");
  packed.beta = [1];
  const marked = unpackTrackingEvents(packed);
  assert.deepEqual(marked.map((e) => e.beta === true), [false, true]);
  assert.equal(marked[0].uid, "u1");
  // A plain array (older server, fixture) passes through, including its own marks.
  assert.deepEqual(unpackTrackingEvents([{ uid: "x", beta: true }]), [{ uid: "x", beta: true }]);
});
