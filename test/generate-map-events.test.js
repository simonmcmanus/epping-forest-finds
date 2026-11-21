/**
 * Map events (scripts/generate-map-events.js): data/events.json is generated from the located, upcoming
 * dated entries in data/forest-events.json, in the shape the app's own loader keeps.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const { generateMapEvents } = require("../scripts/generate-map-events.js");

const nowMs = Date.parse("2026-12-01T12:00:00Z");

function entry(extra) {
  return {
    id: "e1", title: "Carols", place: "A Hall", date: "2026-12-05", startTime: "18:30",
    body: "Singing.", sources: [{ label: "Org", url: "https://example.org/e1" }],
    lastVerified: "2026-11-30", lat: 51.65, lon: 0.03, ...extra
  };
}

function normalize(data, at) {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "normalize.js"), "utf8");
  const context = { projectLonLat: (lon, lat) => ({ x: lon, y: lat }) };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.normalizeEventLocations = normalizeEventLocations;`, context, { filename: "js/normalize.js" });
  return context.normalizeEventLocations(data, at);
}

test("a located future timed entry becomes a one-hour map event in London time", () => {
  const { events } = generateMapEvents({ entries: [entry()] }, { nowMs });
  assert.deepStrictEqual(events, [{
    id: "e1", name: "Carols", description: "Singing.", lat: 51.65, lon: 0.03,
    startsAt: "2026-12-05T18:30:00.000Z", endsAt: "2026-12-05T19:30:00.000Z",
    sourceUrl: "https://example.org/e1"
  }]);
});

test("a summer timed entry is shifted from London time to UTC", () => {
  const { events } = generateMapEvents({ entries: [entry({ date: "2027-07-10", startTime: "09:00" })] }, { nowMs });
  assert.strictEqual(events[0].startsAt, "2027-07-10T08:00:00.000Z");
});

test("an all-day located entry runs from London midnight to the next London midnight", () => {
  const { events } = generateMapEvents({ entries: [entry({ startTime: undefined, sources: [] })] }, { nowMs });
  assert.strictEqual(events[0].startsAt, "2026-12-05T00:00:00.000Z");
  assert.strictEqual(events[0].endsAt, "2026-12-06T00:00:00.000Z");
  assert.strictEqual("sourceUrl" in events[0], false);
});

test("past, unlocated, uncoordinated and undated entries are left out; today's entry stays", () => {
  const { events } = generateMapEvents({
    entries: [
      entry({ id: "past", date: "2026-11-30" }),
      entry({ id: "today", date: "2026-12-01" }),
      entry({ id: "flagged", locationStatus: "unlocated" }),
      entry({ id: "nocoords", lat: undefined, lon: undefined }),
      entry({ id: "undated", date: null })
    ]
  }, { nowMs });
  assert.deepStrictEqual(events.map((e) => e.id), ["today"]);
});

test("generated events load cleanly through the app's own event loader", () => {
  const data = generateMapEvents({ entries: [entry(), entry({ id: "all-day", startTime: undefined })] }, { nowMs });
  const at = Date.parse("2026-12-04T12:00:00Z");
  assert.deepStrictEqual(normalize(data, at).map((e) => e.id).sort(), ["all-day", "e1"]);
});

test("the CLI writes the events file only when run, not when imported", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genmap-"));
  const input = path.join(dir, "forest-events.json");
  const output = path.join(dir, "events.json");
  fs.writeFileSync(input, JSON.stringify({ entries: [entry({ date: "2099-01-01" })] }, null, 2) + "\n");
  const script = path.join(__dirname, "..", "scripts", "generate-map-events.js");

  assert.strictEqual(spawnSync(process.execPath, ["-e", `require(${JSON.stringify(script)})`]).status, 0);
  assert.strictEqual(fs.existsSync(output), false);

  const dry = spawnSync(process.execPath, [script, "--file", input, "--out", output, "--dry-run"], { encoding: "utf8" });
  assert.strictEqual(dry.status, 0);
  assert.match(dry.stdout, /e1/);
  assert.strictEqual(fs.existsSync(output), false);

  assert.strictEqual(spawnSync(process.execPath, [script, "--file", input, "--out", output]).status, 0);
  const written = fs.readFileSync(output, "utf8");
  assert.strictEqual(written, JSON.stringify(JSON.parse(written), null, 2) + "\n");
  assert.deepStrictEqual(JSON.parse(written).events.map((e) => e.id), ["e1"]);
});
