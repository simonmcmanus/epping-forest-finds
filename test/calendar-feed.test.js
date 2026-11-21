/**
 * Calendar feed (/calendar.ics): which dated forest events a subscriber's calendar receives, and that
 * the file is valid iCalendar. Source is data/forest-events.json (see spec/spec-data-fetching.md).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { buildCalendarFeed } = require("../netlify/functions/lib/calendar-feed.js");
const calendar = require("../netlify/functions/calendar.js");

const BS = String.fromCharCode(92); // a single backslash, the iCalendar escape character
const NOW = Date.parse("2026-11-21T12:00:00Z");

function entry(over) {
  return { id: "e", title: "Title", place: "Somewhere", date: "2026-12-05", body: "Body", sources: [], ...over };
}
const feed = (entries, nowMs = NOW) => buildCalendarFeed({ entries }, { nowMs });
const unfold = (text) => text.replace(/\r\n /g, "");
const uids = (text) => [...text.matchAll(/^UID:(.+)@eppingforestfinds\.uk\r$/gm)].map((m) => m[1]);

test("a future dated entry appears; past, undated and today-or-later boundaries are respected", () => {
  const text = feed([
    entry({ id: "future", date: "2026-12-05" }),
    entry({ id: "past", date: "2026-11-20" }),
    entry({ id: "undated", date: null }),
    entry({ id: "today", date: "2026-11-21" }),
    entry({ id: "nodate-key", date: undefined }),
  ]);
  assert.deepStrictEqual(uids(text), ["future", "today"]);
});

test("today counts by the UK calendar date, not UTC", () => {
  // In summer the UK is an hour ahead of UTC, so late evening UTC is already the next UK day.
  const summerLate = Date.parse("2026-07-10T23:30:00Z"); // 11 July 00:30 in the UK
  const text = feed([entry({ id: "yesterday", date: "2026-07-10" }), entry({ id: "today", date: "2026-07-11" })], summerLate);
  assert.deepStrictEqual(uids(text), ["today"]);
});

test("an impossible calendar date is left out and a real leap day is kept", () => {
  const text = feed([
    entry({ id: "feb30", date: "2028-02-30" }),
    entry({ id: "feb31", date: "2028-02-31" }),
    entry({ id: "notleap", date: "2027-02-29" }),
    entry({ id: "leap", date: "2028-02-29" }),
  ]);
  assert.deepStrictEqual(uids(text), ["leap"]);
  assert.match(text, /DTSTART;VALUE=DATE:20280229\r\n/);
});

test("an entry with no id still gets a well-formed UID", () => {
  const text = feed([entry({ id: undefined }), entry({ id: "" }), entry({ id: "kept" })]);
  const found = uids(text);
  assert.strictEqual(found.length, 3);
  assert.strictEqual(found[2], "kept");
  assert.strictEqual(new Set(found).size, 3, "fallback UIDs are distinct");
  for (const uid of found) assert.ok(uid && !uid.includes("undefined"));
});

test("an entry with no start time is an all-day event", () => {
  const text = feed([entry({ date: "2026-12-31" })]);
  assert.match(text, /DTSTART;VALUE=DATE:20261231\r\n/);
  assert.match(text, /DTEND;VALUE=DATE:20270101\r\n/);
});

test("a winter start time is UTC, a summer start time is an hour earlier in UTC", () => {
  const winter = feed([entry({ date: "2026-12-05", startTime: "10:00" })]);
  assert.match(winter, /DTSTART:20261205T100000Z\r\nDTEND:20261205T110000Z\r\n/);
  const summer = feed([entry({ date: "2026-07-18", startTime: "10:00" })], Date.parse("2026-07-01T00:00:00Z"));
  assert.match(summer, /DTSTART:20260718T090000Z\r\nDTEND:20260718T100000Z\r\n/);
});

test("the clocks changing night does not shift start times", () => {
  const before = feed([entry({ date: "2027-03-27", startTime: "00:30" })], NOW);
  assert.match(before, /DTSTART:20270327T003000Z/);
  const after = feed([entry({ date: "2027-03-28", startTime: "12:00" })], NOW);
  assert.match(after, /DTSTART:20270328T110000Z/);
});

test("each event carries title, place, description with sources, and link", () => {
  const text = unfold(
    feed([
      entry({
        id: "full",
        title: "Fair",
        place: "Hall",
        body: "About it",
        sources: [
          { label: "Organiser", url: "https://example.org/a" },
          { label: "Other", url: "https://example.org/b" },
        ],
      }),
    ])
  );
  assert.match(text, /UID:full@eppingforestfinds\.uk\r\n/);
  assert.match(text, /DTSTAMP:20261121T120000Z\r\n/);
  assert.match(text, /SUMMARY:Fair\r\n/);
  assert.match(text, /LOCATION:Hall\r\n/);
  assert.ok(
    text.includes(`DESCRIPTION:About it${BS}nOrganiser https://example.org/a${BS}nOther https://example.org/b\r\n`)
  );
  assert.match(text, /URL:https:\/\/example\.org\/a\r\n/);
  assert.ok(!text.includes("GEO:"), "no coordinates, so no GEO");
});

test("GEO appears only when the entry has coordinates", () => {
  assert.match(feed([entry({ lat: 51.69, lon: 0.04 })]), /GEO:51\.69;0\.04\r\n/);
});

test("the feed is a well-formed calendar with CRLF line endings", () => {
  const text = feed([entry({})]);
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "every line ends CRLF");
  assert.match(text, /X-WR-CALNAME:Epping Forest Finds events/);
  assert.match(text, /METHOD:PUBLISH/);
});

test("commas, semicolons and newlines in title, place and description are escaped", () => {
  const text = unfold(
    feed([entry({ title: "Fair; stalls, music", place: "Hall; High St, Town", body: `One\nTwo ${BS} end` })])
  );
  assert.ok(text.includes(`SUMMARY:Fair${BS};`.concat(` stalls${BS}, music\r\n`)));
  assert.ok(text.includes(`LOCATION:Hall${BS}; High St${BS}, Town\r\n`));
  assert.ok(text.includes(`DESCRIPTION:One${BS}nTwo ${BS}${BS} end\r\n`));
});

test("long lines fold under 75 octets and unicode is never split", () => {
  const body = "Stalls at £5 and “quoted” words ".repeat(20);
  const title = "Fête ".repeat(40).trim();
  const text = feed([entry({ title, body })]);
  for (const line of text.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long: ${line}`);
  }
  assert.ok(!text.includes("�"));
  assert.ok(unfold(text).includes(`SUMMARY:${title.replace(/,/g, `${BS},`)}`));
  assert.ok(unfold(text).includes(body.trim().replace(/,/g, `${BS},`)));
});

test("the same inputs give the same feed", () => {
  const entries = [entry({ id: "a" }), entry({ id: "b", startTime: "09:00" })];
  assert.strictEqual(feed(entries), feed(entries));
});

test("the real forest events file gives the upcoming dated events on 21 November 2026", () => {
  const real = require("../data/forest-events.json");
  const text = buildCalendarFeed(real, { nowMs: Date.parse("2026-11-21T12:00:00Z") });
  const starts = {};
  for (const block of text.split("BEGIN:VEVENT\r\n").slice(1)) {
    starts[block.match(/UID:(.+)@/)[1]] = block.match(/DTSTART[^:]*:(\S+)\r/)[1];
  }
  assert.deepStrictEqual(starts, {
    "theydon-bois-christmas-market-2026-11-27": "20261127T170000Z",
    "waltham-abbey-cavalcade-of-light-2026-11-27": "20261127",
    "epping-christmas-market-2026-12-04": "20261204T120000Z",
    "highams-park-christmas-fayre-2026-12-06": "20261206T110000Z",
    "loughton-staples-road-christmas-fair-2026-12-06": "20261206T120000Z",
    "waltham-abbey-christmas-market-2026-12-12": "20261212T090000Z",
    "north-chingford-christmas-market-2026-12-19": "20261219T110000Z",
  });
  assert.ok(!text.includes("archives-on-show"), "the undated recurring entry is left out");
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
