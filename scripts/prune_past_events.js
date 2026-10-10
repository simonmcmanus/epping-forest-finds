#!/usr/bin/env node
"use strict";

/**
 * Drops expired events from data/events.json before it's committed, so a
 * client never downloads rows for something nobody can still attend.
 *
 * The app also filters past events at load time (normalizeEventLocations in
 * js/normalize.js) as a second line of defence -- a stale cached copy of the
 * file should never show a dead event either -- but that only saves render
 * time, not bytes. Pruning the source file is what actually keeps it small:
 * run this whenever new events are added (the weekly data job, or by hand),
 * before committing data/events.json.
 *
 * An event with no endsAt is assumed to run for EVENT_DEFAULT_DURATION_MS
 * from its startsAt -- keep this in sync with js/normalize.js.
 *
 * Usage:
 *   node scripts/prune_past_events.js          # rewrite the file
 *   node scripts/prune_past_events.js --check   # report what's expired, change nothing
 */

const fs = require("node:fs");
const path = require("node:path");

const EVENTS_PATH = path.join(__dirname, "..", "data", "events.json");
const EVENT_DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

function eventEndsAt(event) {
  const starts = event && event.startsAt ? new Date(event.startsAt).getTime() : NaN;
  if (!Number.isFinite(starts)) return NaN;
  const endsRaw = event && event.endsAt ? new Date(event.endsAt).getTime() : NaN;
  return Number.isFinite(endsRaw) ? endsRaw : starts + EVENT_DEFAULT_DURATION_MS;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const raw = fs.readFileSync(EVENTS_PATH, "utf8");
  const data = JSON.parse(raw);
  const events = Array.isArray(data.events) ? data.events : [];
  const now = Date.now();

  const kept = [];
  const dropped = [];
  for (const event of events) {
    const ends = eventEndsAt(event);
    // Malformed (no parseable startsAt) is dropped too -- it can't be shown anyway.
    if (Number.isFinite(ends) && ends >= now) kept.push(event);
    else dropped.push(event);
  }

  if (!dropped.length) {
    console.log(`No expired events -- ${kept.length} kept.`);
    return;
  }

  console.log(`${dropped.length} expired event(s):`);
  for (const event of dropped) console.log(`  - ${event.id || event.name || "(unnamed)"}`);

  if (checkOnly) {
    console.log(`${kept.length} would remain. Run without --check to prune.`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(EVENTS_PATH, `${JSON.stringify({ ...data, events: kept }, null, 2)}\n`);
  console.log(`Pruned. ${kept.length} event(s) remain.`);
}

main();
