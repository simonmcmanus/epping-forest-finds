/**
 * Client navigation events (js/tracker.js): navigation_start, navigation_arrive and navigation_end
 * as a walker selects a target, walks to it and clears it. Runs the real script in a vm context.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "js", "tracker.js"), "utf8");
const M_PER_DEG_LAT = 111_195;

function load({ consent = true, extra = {} } = {}) {
  const storage = new Map(consent ? [["ff-track-v1", "1"]] : []);
  const timers = [];
  const clock = { now: Date.UTC(2026, 10, 6, 9, 0) };
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(clock.now); }
    static now() { return clock.now; }
  }
  const state = { selected: null, userLocation: null, rawUserLocation: null };
  const context = {
    Date: FakeDate,
    state,
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    navigator: { onLine: true },
    document: { visibilityState: "visible", addEventListener() {} },
    window: { addEventListener() {} },
    crypto: globalThis.crypto,
    setTimeout: (fn) => { fn(); return 0; },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval() {},
    fetch: async () => ({ ok: true, status: 200 }),
    ...extra,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${SOURCE}\nglobalThis.api = { startLocationTracking, trackLocation };`, context);
  const events = () => JSON.parse(storage.get("ff-track-queue") || "[]")
    .filter((e) => e.type.startsWith("navigation_"));
  const target = { id: "place-1", name: "Somewhere", lat: 51.65, lng: 0.04 };
  const select = (t) => { state.selected = t ? { type: "landmark", item: { id: t.id, name: t.name, latitude: t.lat, longitude: t.lng } } : null; };
  // Moves the walker `metres` south of the target and ticks the tracker as the app's timers would.
  const walkTo = (metresFromTarget, t = target) => {
    state.rawUserLocation = {
      latitude: t.lat - metresFromTarget / M_PER_DEG_LAT, longitude: t.lng, receivedAt: clock.now,
    };
    timers.forEach((timer) => timer.fn());
  };
  context.api.startLocationTracking();
  return { state, clock, events, select, walkTo, target, timers };
}

test("selecting a place, walking in and clearing it gives start, one arrive, then end arrived", () => {
  const w = load();
  w.walkTo(400);
  w.select(w.target);
  w.walkTo(400);
  w.clock.now += 20_000; w.walkTo(200);
  w.clock.now += 20_000; w.walkTo(20);
  w.clock.now += 20_000; w.walkTo(10);
  w.select(null);
  w.clock.now += 20_000; w.walkTo(10);
  const types = w.events().map((e) => e.type);
  assert.deepEqual(types, ["navigation_start", "navigation_arrive", "navigation_end"]);
  const [start, arrive, end] = w.events();
  assert.equal(start.navId, "place-1");
  assert.equal(start.navName, "Somewhere");
  assert.equal(start.navType, "landmark");
  assert.equal(start.targetLat, 51.65);
  assert.ok(start.userLat < 51.65);
  assert.equal(start.routeM, null);
  assert.equal(arrive.navId, "place-1");
  assert.ok(arrive.walkedM > 300 && arrive.walkedM < 420, `walked ${arrive.walkedM}`);
  assert.equal(end.reason, "arrived");
  assert.equal(end.navId, "place-1");
  assert.ok(end.remainingM < 30);
  assert.ok(end.walkedM >= arrive.walkedM);
});

test("clearing the target before arrival ends the journey as cleared with no arrive", () => {
  const w = load();
  w.walkTo(400);
  w.select(w.target);
  w.walkTo(400);
  w.clock.now += 20_000; w.walkTo(300);
  w.select(null);
  w.walkTo(300);
  const events = w.events();
  assert.deepEqual(events.map((e) => e.type), ["navigation_start", "navigation_end"]);
  assert.equal(events[1].reason, "cleared");
  assert.ok(events[1].remainingM > 250 && events[1].remainingM < 350);
});

test("choosing another place before arrival ends the old journey as changed and starts a new one", () => {
  const w = load();
  const other = { id: "place-2", name: "Elsewhere", lat: 51.66, lng: 0.05 };
  w.walkTo(400);
  w.select(w.target);
  w.walkTo(400);
  w.select(other);
  w.walkTo(400);
  const events = w.events();
  assert.deepEqual(events.map((e) => e.type), ["navigation_start", "navigation_end", "navigation_start"]);
  assert.equal(events[1].reason, "changed");
  assert.equal(events[1].navId, "place-1");
  assert.equal(events[2].navId, "place-2");
});

test("a place without an id still carries one non-null navId on every event of the journey", () => {
  const w = load();
  w.walkTo(400);
  w.select({ ...w.target, id: null });
  w.walkTo(400);
  w.clock.now += 20_000; w.walkTo(10);
  w.select(null);
  w.walkTo(10);
  const events = w.events();
  assert.deepEqual(events.map((e) => e.type), ["navigation_start", "navigation_arrive", "navigation_end"]);
  const ids = new Set(events.map((e) => e.navId));
  assert.equal(ids.size, 1);
  assert.equal(typeof [...ids][0], "string");
  assert.ok([...ids][0].length > 0);
});

test("a gap of more than three minutes between fixes adds nothing to the walked distance", () => {
  const w = load();
  w.walkTo(1000);
  w.select(w.target);
  w.walkTo(1000);
  w.clock.now += 20_000; w.walkTo(900);
  w.clock.now += 4 * 60_000; w.walkTo(100); // 800 m "jump" after a 4 minute silence
  w.select(null);
  w.walkTo(100);
  const end = w.events().find((e) => e.type === "navigation_end");
  assert.ok(end.walkedM > 80 && end.walkedM < 120, `walked ${end.walkedM}`);
});

test("no consent means no navigation events are queued or sent", () => {
  const w = load({ consent: false });
  w.walkTo(400);
  w.select(w.target);
  w.walkTo(20);
  w.select(null);
  w.walkTo(20);
  assert.equal(w.events().length, 0);
});

test("with a ready routing graph the start event carries the routed distance", () => {
  const calls = [];
  const w = load({
    extra: {
      projectLonLat: (lng, lat) => ({ x: lng, y: lat }),
      unprojectPoint: (p) => ({ longitude: p.x, latitude: p.y }),
      distanceMetres: (a, b, c, d) => Math.hypot((c - a) * M_PER_DEG_LAT, (d - b) * M_PER_DEG_LAT),
      findRoutePoints: (graph, from, to) => {
        calls.push({ graph, from, to });
        return [from, { x: from.x, y: 51.648 }, to];
      },
    },
  });
  w.state.routingGraph = { nodes: [1] };
  w.state.routingGraphReady = true;
  w.walkTo(400);
  w.select(w.target);
  w.walkTo(400);
  w.walkTo(399);
  assert.equal(calls.length, 1);
  const start = w.events()[0];
  assert.ok(start.routeM > 380 && start.routeM < 420, `routeM ${start.routeM}`);
});

test("a routing failure leaves routeM null and never breaks the journey", () => {
  const w = load({
    extra: {
      projectLonLat: (lng, lat) => ({ x: lng, y: lat }),
      unprojectPoint: (p) => ({ longitude: p.x, latitude: p.y }),
      distanceMetres: () => 1,
      findRoutePoints: () => { throw new Error("boom"); },
    },
  });
  w.state.routingGraph = { nodes: [1] };
  w.state.routingGraphReady = true;
  w.walkTo(400);
  w.select(w.target);
  w.walkTo(400);
  assert.equal(w.events()[0].type, "navigation_start");
  assert.equal(w.events()[0].routeM, null);
});
