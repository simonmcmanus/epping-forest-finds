/**
 * Client-side usage tracking (js/tracker.js): events are queued and sent in batches, not one
 * request each. Runs the real script in a vm context with a scripted network.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "js", "tracker.js"), "utf8");

function loadTracker({ consent = true, respond = () => ({ ok: true, status: 200 }), state: appState } = {}) {
  const storage = new Map(consent ? [["ff-track-v1", "1"]] : []);
  const listeners = { window: new Map(), document: new Map() };
  const on = (map) => (type, fn) => { if (!map.has(type)) map.set(type, []); map.get(type).push(fn); };
  const sent = [];
  const timers = [];
  // A fake clock: the tracker reads Date.now() and new Date() for the wait between uploads and the
  // age of a GPS fix. Tests move clock.now forward instead of waiting.
  const clock = { now: Date.UTC(2026, 10, 6, 9, 0) };
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(clock.now); }
    static now() { return clock.now; }
  }
  const context = {
    Date: FakeDate,
    state: appState,
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    navigator: { onLine: true },
    document: { visibilityState: "visible", addEventListener: on(listeners.document) },
    window: { addEventListener: on(listeners.window) },
    crypto: globalThis.crypto,
    setTimeout: (fn) => { fn(); return 0; },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval() {},
    fetch: async (url, options) => {
      const events = JSON.parse(options.body).events;
      sent.push({ url, events, keepalive: options.keepalive });
      return respond(events);
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${SOURCE}\nglobalThis.api = { trackClick, trackLocation, initTracker, trackerFlushQueue, setTrackingConsent, startLocationTracking, stopLocationTracking };`, context);
  const queued = () => JSON.parse(storage.get("ff-track-queue") || "[]");
  const fire = (target, type) => Promise.all((listeners[target].get(type) || []).map((fn) => fn({ type })));
  return { api: context.api, sent, queued, timers, context, fire, clock };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function trackN(api, n) {
  for (let i = 0; i < n; i += 1) api.trackLocation(51.65, 0.04 + i / 1e4, 90);
}

test("a handful of events wait in the queue instead of each sending a request", async () => {
  const { api, sent, queued } = loadTracker();
  trackN(api, 5);
  await settle();
  assert.equal(sent.length, 0);
  assert.equal(queued().length, 5);
});

test("once enough events have built up they go up together in one request", async () => {
  const { api, sent, queued } = loadTracker();
  trackN(api, 20);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].events.length, 20);
  assert.equal(sent[0].keepalive, true);
  assert.equal(queued().length, 0);
});

test("whatever is queued is sent when the page is hidden, and on the periodic timer", async () => {
  const tracker = loadTracker();
  tracker.api.initTracker();
  await settle();
  trackN(tracker.api, 3);
  tracker.context.document.visibilityState = "hidden";
  await tracker.fire("document", "visibilitychange");
  assert.equal(tracker.sent.length, 1);
  assert.equal(tracker.sent[0].events.length, 3);

  trackN(tracker.api, 2);
  const timer = tracker.timers.find((t) => t.ms >= 60_000);
  assert.ok(timer, "a periodic flush is scheduled");
  await timer.fn();
  assert.equal(tracker.sent.length, 2);
  assert.equal(tracker.sent[1].events.length, 2);
});

test("a long offline queue is sent in batches small enough for a keepalive request", async () => {
  const { api, sent, queued, context } = loadTracker();
  context.navigator.onLine = false;
  trackN(api, 400);
  assert.equal(queued().length, 400, "offline, everything waits");
  context.navigator.onLine = true;
  await api.trackerFlushQueue();
  assert.ok(sent.length >= 3);
  assert.ok(sent.every((request) => request.events.length <= 150));
  assert.equal(sent.reduce((n, r) => n + r.events.length, 0), 400);
  assert.equal(queued().length, 0);
});

test("a failed send keeps the events for the next attempt", async () => {
  let fail = true;
  const { api, sent, queued, clock } = loadTracker({ respond: () => (fail ? { ok: false, status: 503 } : { ok: true, status: 200 }) });
  trackN(api, 20);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(queued().length, 20, "nothing is lost on a server error");
  fail = false;
  clock.now += 60_000;
  await api.trackerFlushQueue();
  assert.equal(queued().length, 0);
  assert.equal(sent[1].events.length, 20);
});

test("a batch the server refuses outright is dropped rather than retried forever", async () => {
  const { api, queued } = loadTracker({ respond: () => ({ ok: false, status: 413 }) });
  trackN(api, 20);
  await settle();
  assert.equal(queued().length, 0);
});

test("without consent nothing is queued or sent", async () => {
  const { api, sent, queued } = loadTracker({ consent: false });
  trackN(api, 25);
  await settle();
  assert.equal(sent.length, 0);
  assert.equal(queued().length, 0);
});

test("whatever is queued is sent when the page is closed", async () => {
  const tracker = loadTracker();
  tracker.api.initTracker();
  await settle();
  trackN(tracker.api, 4);
  await tracker.fire("window", "pagehide");
  assert.equal(tracker.sent.length, 1);
  assert.equal(tracker.sent[0].events.length, 4);
  assert.equal(tracker.queued().length, 0);
});

test("events queued while offline are sent once the connection comes back", async () => {
  const tracker = loadTracker();
  tracker.api.initTracker();
  tracker.context.navigator.onLine = false;
  trackN(tracker.api, 25);
  await settle();
  assert.equal(tracker.sent.length, 0, "nothing goes out offline");
  tracker.context.navigator.onLine = true;
  await tracker.fire("window", "online");
  assert.equal(tracker.sent.reduce((n, r) => n + r.events.length, 0), 25);
});

test("the offline queue keeps the newest 500 events", async () => {
  const { api, queued, context } = loadTracker();
  context.navigator.onLine = false;
  trackN(api, 520);
  const queue = queued();
  assert.equal(queue.length, 500);
  assert.equal(queue[queue.length - 1].lng, 0.04 + 519 / 1e4, "the newest is kept");
});

test("withdrawing consent discards the queued events instead of sending them later", async () => {
  const tracker = loadTracker();
  tracker.api.initTracker();
  await settle();
  trackN(tracker.api, 5);
  vm.runInContext("setTrackingConsent(false)", tracker.context);
  assert.equal(tracker.queued().length, 0);
  await tracker.fire("window", "pagehide");
  const timer = tracker.timers.find((t) => t.ms >= 60_000);
  await timer.fn();
  assert.equal(tracker.sent.length, 0);
});

test("a queue left over from a session with consent is not sent once consent is gone", async () => {
  const tracker = loadTracker({ consent: false });
  tracker.context.localStorage.setItem("ff-track-queue", JSON.stringify([{ type: "location", uid: "u", ts: new Date().toISOString(), lat: 51.6, lng: 0.04 }]));
  await tracker.api.trackerFlushQueue();
  assert.equal(tracker.sent.length, 0);
  assert.equal(tracker.queued().length, 0, "and it is dropped");
});

test("without usage-analytics consent nothing is written to the device: no device id, no queued event", async () => {
  const tracker = loadTracker({ consent: false });
  tracker.api.trackLocation(51.65, 0.04, 90);
  tracker.api.trackClick("tree", { id: "t1", commonName: "Oak", latitude: 51.6, longitude: 0.04 }, 51.6, 0.04);
  await settle();
  assert.equal(tracker.context.localStorage.getItem("ff-uid"), null);
  assert.equal(tracker.context.localStorage.getItem("ff-track-queue"), null);
  assert.equal(tracker.sent.length, 0);
});

test("withdrawing usage-analytics consent deletes the device id the events were sent under", async () => {
  const tracker = loadTracker();
  tracker.api.trackLocation(51.65, 0.04, 90);
  assert.ok(tracker.context.localStorage.getItem("ff-uid"), "an id exists while consent is given");
  vm.runInContext("setTrackingConsent(false)", tracker.context);
  assert.equal(tracker.context.localStorage.getItem("ff-uid"), null);
});

test("events whose send fails after consent is withdrawn are not kept to send later", async () => {
  let failInFlight;
  const { api, sent, queued, clock } = loadTracker({
    respond: () => (sent.length === 1 ? new Promise((resolve) => { failInFlight = () => resolve({ ok: false, status: 503 }); }) : { ok: true, status: 200 }),
  });
  trackN(api, 20);
  await settle();
  assert.equal(sent.length, 1, "the batch is on its way");
  api.setTrackingConsent(false);
  failInFlight();
  await settle();
  assert.equal(queued().length, 0, "the failed batch is not put back");
  api.setTrackingConsent(true);
  clock.now += 60_000;
  await api.trackerFlushQueue();
  assert.equal(sent.length, 1, "nothing from before the withdrawal goes out after consent is given again");
});

test("a click on an item with null coordinates is located by its geometry, not at null island", () => {
  const { api, queued } = loadTracker();
  api.trackClick("tree", { id: "t1", lat: null, lon: null, geometry: { type: "Point", coordinates: [0.04, 51.65] } }, 51.6, 0.03);
  const [event] = queued();
  assert.equal(event.targetLat, 51.65);
  assert.equal(event.targetLng, 0.04);
});

test("an item with no usable coordinates at all is recorded without a target rather than at 0,0", () => {
  const { api, queued } = loadTracker();
  api.trackClick("tree", { id: "t2", lat: null, lon: null }, 51.6, 0.03);
  const [event] = queued();
  assert.equal(event.targetLat, null);
  assert.equal(event.targetLng, null);
});

// --- A stale GPS fix is not repeated as the walker's position ---

const MINUTE = 60_000;

function locationPingTimer(tracker) {
  return tracker.timers.find((t) => t.ms === MINUTE);
}

test("Analytics does not repeat a stale location fix once GPS has stopped", async () => {
  const appState = { rawUserLocation: null, userLocation: null, compassHeading: null };
  const tracker = loadTracker({ state: appState });
  const fixAt = tracker.clock.now;
  appState.rawUserLocation = { latitude: 51.65, longitude: 0.04, receivedAt: fixAt };
  tracker.api.startLocationTracking();
  // The watch delivers nothing more, while the minute timer keeps firing for five minutes.
  for (let minute = 1; minute <= 5; minute += 1) {
    tracker.clock.now = fixAt + minute * MINUTE;
    await locationPingTimer(tracker).fn();
  }
  await tracker.api.trackerFlushQueue();
  const pings = tracker.sent.flatMap((request) => request.events);
  assert.ok(pings.length >= 1, "the fix was recorded while it was fresh");
  assert.ok(pings.every((event) => event.lat === 51.65));
  const lastPingAt = Math.max(...pings.map((event) => Date.parse(event.ts)));
  assert.ok(lastPingAt <= fixAt + 2 * MINUTE, "no ping goes out more than two intervals after the last fix");
});

test("Analytics keeps recording a walker whose GPS is still delivering fixes, once a minute", async () => {
  const appState = { rawUserLocation: null, userLocation: null, compassHeading: null };
  const tracker = loadTracker({ state: appState });
  const start = tracker.clock.now;
  tracker.api.startLocationTracking();
  for (let minute = 1; minute <= 4; minute += 1) {
    tracker.clock.now = start + minute * MINUTE;
    appState.rawUserLocation = { latitude: 51.65 + minute / 1000, longitude: 0.04, receivedAt: tracker.clock.now - 1000 };
    await locationPingTimer(tracker).fn();
  }
  await tracker.api.trackerFlushQueue();
  const pings = tracker.sent.flatMap((request) => request.events);
  assert.equal(pings.length, 4, "one ping for each of the four minutes");
  assert.equal(new Set(pings.map((event) => event.lat)).size, 4, "each ping carries that minute's fix");
});

test("a walker whose GPS resumes after a silence is recorded again at the next minute", async () => {
  const appState = { rawUserLocation: null, userLocation: null, compassHeading: null };
  const tracker = loadTracker({ state: appState });
  const start = tracker.clock.now;
  appState.rawUserLocation = { latitude: 51.65, longitude: 0.04, receivedAt: start };
  tracker.api.startLocationTracking();
  tracker.clock.now = start + 10 * MINUTE;
  await locationPingTimer(tracker).fn();
  tracker.clock.now = start + 16 * MINUTE;
  appState.rawUserLocation = { latitude: 51.66, longitude: 0.05, receivedAt: tracker.clock.now - 1_000 };
  await locationPingTimer(tracker).fn();
  await tracker.api.trackerFlushQueue();
  const lats = tracker.sent.flatMap((request) => request.events).map((event) => event.lat);
  assert.equal(lats[lats.length - 1], 51.66, "the fresh fix is sent once GPS is back");
  assert.ok(!lats.slice(0, -1).includes(51.66));
});

// --- Waiting before retrying a failed upload ---

test("Analytics waits before retrying after a failed upload, and keeps the events meanwhile", async () => {
  let failing = true;
  const tracker = loadTracker({ respond: () => (failing ? { ok: false, status: 503 } : { ok: true, status: 200 }) });
  trackN(tracker.api, 20);
  await settle();
  assert.equal(tracker.sent.length, 1, "the first upload was attempted and failed");
  trackN(tracker.api, 5);
  await settle();
  assert.equal(tracker.sent.length, 1, "no further upload is started while the wait runs");
  assert.equal(tracker.queued().length, 25, "the events wait in the queue, none dropped");
  tracker.clock.now += 29_000;
  await tracker.api.trackerFlushQueue();
  assert.equal(tracker.sent.length, 1, "still inside the wait");
  failing = false;
  tracker.clock.now += 2_000;
  await tracker.api.trackerFlushQueue();
  assert.equal(tracker.sent.length, 2, "once the wait has passed the queue is tried again");
  assert.equal(tracker.sent[1].events.length, 25);
  assert.equal(tracker.queued().length, 0);
});

test("Analytics backs off for longer after each further failed upload", async () => {
  const tracker = loadTracker({ respond: () => ({ ok: false, status: 503 }) });
  trackN(tracker.api, 20);
  await settle();
  const attemptAfter = async (ms) => {
    tracker.clock.now += ms;
    await tracker.api.trackerFlushQueue();
  };
  await attemptAfter(29_000);
  assert.equal(tracker.sent.length, 1, "30 seconds after the first failure");
  await attemptAfter(1_000);
  assert.equal(tracker.sent.length, 2, "the first retry is at 30 seconds, and fails");
  await attemptAfter(59_000);
  assert.equal(tracker.sent.length, 2, "the second wait is a minute, so nothing at 59 seconds");
  await attemptAfter(1_000);
  assert.equal(tracker.sent.length, 3, "the second retry is at a minute, and fails");
  await attemptAfter(119_000);
  assert.equal(tracker.sent.length, 3, "the third wait is two minutes");
  await attemptAfter(1_000);
  assert.equal(tracker.sent.length, 4);
});

test("Analytics never waits more than ten minutes between upload attempts", async () => {
  const tracker = loadTracker({ respond: () => ({ ok: false, status: 503 }) });
  trackN(tracker.api, 20);
  await settle();
  for (let failures = 1; failures <= 10; failures += 1) {
    tracker.clock.now += 1_000;
    await tracker.api.trackerFlushQueue();
    assert.equal(tracker.sent.length, failures, `after failure ${failures} a retry a second later waits`);
    tracker.clock.now += 10 * MINUTE - 1_000;
    await tracker.api.trackerFlushQueue();
    assert.equal(tracker.sent.length, failures + 1, `after failure ${failures} the retry ten minutes on is made`);
  }
});

test("a successful upload ends the wait, so the next failure waits the shortest time again", async () => {
  let mode = "fail";
  const tracker = loadTracker({ respond: () => (mode === "fail" ? { ok: false, status: 503 } : { ok: true, status: 200 }) });
  trackN(tracker.api, 20);
  await settle();
  assert.equal(tracker.sent.length, 1);
  mode = "ok";
  tracker.clock.now += 30_000;
  await tracker.api.trackerFlushQueue();
  assert.equal(tracker.sent.length, 2, "the retry after 30 seconds succeeds");
  mode = "fail";
  trackN(tracker.api, 20);
  await settle();
  assert.equal(tracker.sent.length, 3, "a new batch goes straight out, with no wait left over");
  tracker.clock.now += 29_000;
  await tracker.api.trackerFlushQueue();
  assert.equal(tracker.sent.length, 3, "after a failure the wait is 30 seconds again, not a minute");
  tracker.clock.now += 1_000;
  await tracker.api.trackerFlushQueue();
  assert.equal(tracker.sent.length, 4);
});
