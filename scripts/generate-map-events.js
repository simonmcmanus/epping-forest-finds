#!/usr/bin/env node
/**
 * Generates data/events.json (the map's events) from the located, upcoming dated entries in
 * data/forest-events.json. Depends on the current time, so it runs in the weekly ledger, not in a build.
 *
 *   node scripts/generate-map-events.js [--dry-run] [--file data/forest-events.json] [--out data/events.json]
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ukDate, londonWallTimeToUtc, nextDate } = require("./lib/uk-time.js");

const HOUR_MS = 60 * 60 * 1000;

function toMapEvent(entry) {
  let startMs;
  let endMs;
  if (entry.startTime) {
    startMs = londonWallTimeToUtc(entry.date, entry.startTime);
    endMs = startMs + HOUR_MS;
  } else {
    startMs = londonWallTimeToUtc(entry.date, "00:00");
    endMs = londonWallTimeToUtc(nextDate(entry.date), "00:00");
  }
  const event = {
    id: entry.id,
    name: entry.title,
    description: entry.body,
    lat: entry.lat,
    lon: entry.lon,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString()
  };
  const url = entry.sources && entry.sources[0] && entry.sources[0].url;
  if (url) event.sourceUrl = url;
  return event;
}

function generateMapEvents(forestData, { nowMs = Date.now() } = {}) {
  const today = ukDate(nowMs);
  const events = (forestData.entries || [])
    .filter((e) =>
      e.date && e.date >= today && e.locationStatus !== "unlocated" &&
      Number.isFinite(e.lat) && Number.isFinite(e.lon))
    .map(toMapEvent);
  return { events };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const file = arg("--file", path.join(__dirname, "..", "data", "forest-events.json"));
  const out = arg("--out", path.join(__dirname, "..", "data", "events.json"));
  const result = generateMapEvents(JSON.parse(fs.readFileSync(file, "utf8")));
  console.log(`Map events: ${result.events.length}${result.events.length ? " (" + result.events.map((e) => e.id).join(", ") + ")" : ""}`);
  if (args.includes("--dry-run")) console.log("Dry run: nothing written.");
  else fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
}

module.exports = { generateMapEvents };
