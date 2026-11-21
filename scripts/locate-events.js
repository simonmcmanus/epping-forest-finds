#!/usr/bin/env node
/**
 * Finds a real map location for each dated event in data/forest-events.json that has none.
 * Candidates (the place field, then venue phrases in the body) are geocoded with OpenStreetMap
 * Nominatim and accepted only inside the forest area. Coordinates are never typed or guessed.
 *
 *   node scripts/locate-events.js [--dry-run] [--file data/forest-events.json]
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const AREA_BOUNDS = { minLat: 51.54, maxLat: 51.78, minLon: -0.05, maxLon: 0.20 };
const USER_AGENT = "EppingForestFinds/1.0 (+https://www.eppingforestfinds.uk)";
const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const MAX_QUERIES = 3;
const DELAY_MS = 1100;

function inArea(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= AREA_BOUNDS.minLat && lat <= AREA_BOUNDS.maxLat &&
    lon >= AREA_BOUNDS.minLon && lon <= AREA_BOUNDS.maxLon;
}

function venuePhrases(body) {
  const out = [];
  const re = /\bat\s+((?:the\s+)?[A-Z][\w'’&.-]*(?:\s+(?:(?:of|and|&|the)\s+)?[A-Z][\w'’&.-]*)*)/g;
  let m;
  while ((m = re.exec(String(body || "")))) {
    const phrase = m[1].replace(/[.\s]+$/, "").trim();
    if (phrase) out.push(phrase);
  }
  return out;
}

function candidateQueries(entry) {
  const list = [];
  if (typeof entry.place === "string" && entry.place.trim()) list.push(entry.place.trim());
  list.push(...venuePhrases(entry.body));
  return [...new Set(list)].slice(0, MAX_QUERIES);
}

function needsLocation(entry) {
  return Boolean(entry.date) && !(Number.isFinite(entry.lat) && Number.isFinite(entry.lon));
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

async function geocode(query, fetchFn) {
  const url = `${ENDPOINT}?format=jsonv2&limit=1&countrycodes=gb&bounded=0&q=${encodeURIComponent(query)}`;
  const res = await fetchFn(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) return null;
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  return inArea(lat, lon) ? { lat: round6(lat), lon: round6(lon) } : null;
}

/** Mutates data.entries. Returns { located: [ids], unlocated: [ids] }. */
async function locateEvents(data, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const located = [];
  const unlocated = [];
  let first = true;
  for (const entry of data.entries || []) {
    if (!needsLocation(entry)) continue;
    let found = null;
    for (const query of candidateQueries(entry)) {
      if (!first) await sleep(DELAY_MS);
      first = false;
      try {
        found = await geocode(query, fetchFn);
      } catch (_) {
        found = null;
      }
      if (found) {
        entry.lat = found.lat;
        entry.lon = found.lon;
        entry.locationSource = `nominatim: ${query}`;
        delete entry.locationStatus;
        break;
      }
    }
    if (found) located.push(entry.id);
    else {
      entry.locationStatus = "unlocated";
      unlocated.push(entry.id);
    }
  }
  return { located, unlocated };
}

async function runFile(file, options = {}) {
  const log = options.log || console.log;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = await locateEvents(data, options);
  log(`Located: ${result.located.join(", ") || "none"}`);
  log(`Unlocated: ${result.unlocated.join(", ") || "none"}`);
  if (options.dryRun) log("Dry run: nothing written.");
  else fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");
  const file = fileIdx >= 0 ? args[fileIdx + 1] : path.join(__dirname, "..", "data", "forest-events.json");
  runFile(file, { dryRun: args.includes("--dry-run") }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { locateEvents, runFile, candidateQueries, AREA_BOUNDS };
