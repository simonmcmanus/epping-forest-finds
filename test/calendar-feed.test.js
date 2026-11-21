/**
 * Calendar feed (/calendar.ics): which events a subscriber's calendar receives, and that the file is
 * valid iCalendar. The feed must show exactly what the app map shows (js/normalize.js).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { buildCalendarFeed } = require("../netlify/functions/lib/calendar-feed.js");
const calendar = require("../netlify/functions/calendar.js");

const NOW = Date.parse("2026-10-14T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

const FIXTURE = {
  events: [
    { id: "shown", name: "Shown", lat: 51.65, lon: 0.04, startsAt: iso(NOW + 2 * DAY), endsAt: iso(NOW + 2 * DAY + 3 * HOUR) },
    { id: "ended", name: "Ended", lat: 51.65, lon: 0.04, startsAt: iso(NOW - 3 * DAY), endsAt: iso(NOW - 2 * DAY) },
    { id: "far", name: "Far", lat: 51.65, lon: 0.04, startsAt: iso(NOW + 8 * DAY), endsAt: iso(NOW + 8 * DAY + HOUR) },
    { id: "nocoords", name: "No coords", startsAt: iso(NOW + DAY) },
    { id: "blankcoords", name: "Blank", lat: "", lon: null, startsAt: iso(NOW + DAY) },
    { id: "badstart", name: "Bad start", lat: 51.65, lon: 0.04, startsAt: "not a date" },
    { id: "live", name: "Live", latitude: 51.7, longitude: 0.05, startsAt: iso(NOW - 2 * HOUR), endsAt: iso(NOW + HOUR) },
    { id: "liveNoEnd", name: "Live no end", lat: 51.7, lon: 0.05, startsAt: iso(NOW - 2 * HOUR) },
    { id: "edge", name: "Edge", lat: 51.7, lon: 0.05, startsAt: iso(NOW + 7 * DAY), endsAt: iso(NOW + 7 * DAY + HOUR) },
  ],
};

function feedIds(text) {
  return [...text.matchAll(/^UID:(.+)@eppingforestfinds\.uk\r$/gm)].map((m) => m[1]);
}

function unfold(text) {
  return text.replace(/\r\n /g, "");
}

test("the feed lists only events the app would show", () => {
  const text = buildCalendarFeed(FIXTURE, { nowMs: NOW });
  assert.deepStrictEqual(feedIds(text), ["shown", "live", "liveNoEnd", "edge"]);
});

test("an event with no end time lasts 24 hours", () => {
  const text = buildCalendarFeed(FIXTURE, { nowMs: NOW });
  const start = iso(NOW - 2 * HOUR).replace(/[-:]|\.\d{3}/g, "");
  const end = iso(NOW + 22 * HOUR).replace(/[-:]|\.\d{3}/g, "");
  assert.match(text, new RegExp(`DTSTART:${start}\\r\\nDTEND:${end}\\r\\n`));
});

test("the feed is a well-formed calendar with CRLF line endings", () => {
  const text = buildCalendarFeed(FIXTURE, { nowMs: NOW });
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "every line ends CRLF");
  assert.match(text, /X-WR-CALNAME:Epping Forest Finds events/);
  assert.match(text, /METHOD:PUBLISH/);
  assert.match(text, /GEO:51\.65;0\.04/);
  assert.match(text, /DTSTAMP:20261014T120000Z/);
});

test("commas, semicolons and newlines in text are escaped", () => {
  const text = buildCalendarFeed(
    { events: [{ id: "x", name: "Tea, cake; and more", description: "Line one\nLine two \\ end", lat: 51, lon: 0, startsAt: iso(NOW + HOUR) }] },
    { nowMs: NOW }
  );
  assert.match(text, /SUMMARY:Tea\\, cake\; and more\r\n/);
  assert.match(unfold(text), /DESCRIPTION:Line one\\nLine two \\\\ end\r\n/);
});

test("the source link appears in the description and as the event URL", () => {
  const text = buildCalendarFeed(
    { events: [{ id: "x", name: "N", description: "About it", sourceUrl: "https://example.org/a", lat: 51, lon: 0, startsAt: iso(NOW + HOUR) }] },
    { nowMs: NOW }
  );
  assert.match(unfold(text), /DESCRIPTION:About it\\nhttps:\/\/example\.org\/a\r\n/);
  assert.match(text, /URL:https:\/\/example\.org\/a\r\n/);
});

test("long lines fold under 75 octets and unicode is never split", () => {
  const description = "Stalls at £5 and “quoted” words ".repeat(20);
  const text = buildCalendarFeed(
    { events: [{ id: "x", name: "Fête ".repeat(40), description, lat: 51, lon: 0, startsAt: iso(NOW + HOUR) }] },
    { nowMs: NOW }
  );
  for (const line of text.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long: ${line}`);
  }
  assert.ok(!text.includes("�"));
  assert.ok(unfold(text).includes(description.replace(/,/g, "\\,")));
  assert.ok(unfold(text).includes("Fête ".repeat(40).trim()));
});

test("the same inputs give the same feed", () => {
  assert.strictEqual(buildCalendarFeed(FIXTURE, { nowMs: NOW }), buildCalendarFeed(FIXTURE, { nowMs: NOW }));
});

test("the feed holds exactly the events the app map keeps", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "normalize.js"), "utf8");
  // projectLonLat lives in another browser script; map placement is irrelevant to which events are kept.
  const context = { projectLonLat: (lon, lat) => ({ x: lon, y: lat }) };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.normalizeEventLocations = normalizeEventLocations;`, context, { filename: "js/normalize.js" });
  const real = require("../data/events.json");
  for (const [data, nowMs] of [
    [FIXTURE, NOW],
    [FIXTURE, NOW + 6 * DAY],
    [FIXTURE, NOW - 10 * DAY],
    [real, Date.parse("2026-10-12T12:00:00Z")],
    [real, Date.parse("2026-10-10T12:00:00Z")],
  ]) {
    const appIds = context.normalizeEventLocations(data, nowMs).map((e) => e.id);
    assert.deepStrictEqual(feedIds(buildCalendarFeed(data, { nowMs })), appIds);
  }
});

test("the real events file produces a feed at a fixed time", () => {
  const real = require("../data/events.json");
  const nowMs = Date.parse("2026-10-12T12:00:00Z");
  const text = buildCalendarFeed(real, { nowMs });
  assert.ok(text.includes("BEGIN:VEVENT"));
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
});

test("requesting the feed returns a calendar file", async () => {
  const res = await calendar.handler({ httpMethod: "GET" });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers["Content-Type"], "text/calendar; charset=utf-8");
  assert.strictEqual(res.headers["Cache-Control"], "public, max-age=3600");
  assert.ok(res.body.startsWith("BEGIN:VCALENDAR"));
  assert.ok(!("Access-Control-Allow-Origin" in res.headers));
});

test("a HEAD request is accepted and other methods are refused", async () => {
  assert.strictEqual((await calendar.handler({ httpMethod: "HEAD" })).statusCode, 200);
  const res = await calendar.handler({ httpMethod: "POST" });
  assert.strictEqual(res.statusCode, 405);
  assert.strictEqual(res.headers.Allow, "GET, HEAD");
});
