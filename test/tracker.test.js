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

function loadTracker({ consent = true, respond = () => ({ ok: true, status: 200 }) } = {}) {
  const storage = new Map(consent ? [["ff-track-v1", "1"]] : []);
  const listeners = { window: new Map(), document: new Map() };
  const on = (map) => (type, fn) => { if (!map.has(type)) map.set(type, []); map.get(type).push(fn); };
  const sent = [];
  const timers = [];
  const context = {
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
  vm.runInContext(`${SOURCE}\nglobalThis.api = { trackClick, trackLocation, initTracker, trackerFlushQueue };`, context);
  const queued = () => JSON.parse(storage.get("ff-track-queue") || "[]");
  const fire = (target, type) => Promise.all((listeners[target].get(type) || []).map((fn) => fn({ type })));
  return { api: context.api, sent, queued, timers, context, fire };
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
  const { api, sent, queued } = loadTracker({ respond: () => (fail ? { ok: false, status: 503 } : { ok: true, status: 200 }) });
  trackN(api, 20);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(queued().length, 20, "nothing is lost on a server error");
  fail = false;
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
