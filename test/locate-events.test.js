/**
 * Event locating (scripts/locate-events.js): dated forest events without coordinates get a real map
 * location from a geocoder, or are marked unlocated. The geocoder is always a stub here.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { locateEvents, runFile } = require("../scripts/locate-events.js");

const INSIDE = { lat: "51.6500001234", lon: "0.0300009876" };
const OUTSIDE = { lat: "53.4808", lon: "-2.2426" };

function stubFetch(answers) {
  const calls = [];
  const fetchStub = async (url, options) => {
    const q = new URL(url).searchParams.get("q");
    calls.push({ q, url, options });
    const hit = answers[q];
    return { ok: true, json: async () => (hit ? [hit] : []) };
  };
  fetchStub.calls = calls;
  return fetchStub;
}

const noSleep = async () => {};

function entry(extra) {
  return { id: "e1", title: "T", place: "Some Hall, Loughton", date: "2099-12-05", body: "A fair.", ...extra };
}

test("a place that geocodes inside the forest area is written with its source", async () => {
  const fetch = stubFetch({ "Some Hall, Loughton": INSIDE });
  const data = { entries: [entry()] };
  const result = await locateEvents(data, { fetch, sleep: noSleep });
  assert.strictEqual(data.entries[0].lat, 51.650000);
  assert.strictEqual(data.entries[0].lon, 0.030001);
  assert.strictEqual(data.entries[0].locationSource, "nominatim: Some Hall, Loughton");
  assert.deepStrictEqual(result.located, ["e1"]);
  assert.match(fetch.calls[0].options.headers["User-Agent"], /^EppingForestFinds\/1\.0/);
});

test("a result outside the forest area is rejected and the next candidate is tried", async () => {
  const fetch = stubFetch({
    "Some Hall, Loughton": OUTSIDE,
    "The Village Hall": INSIDE
  });
  const data = { entries: [entry({ body: "Held at The Village Hall, from 10am." })] };
  await locateEvents(data, { fetch, sleep: noSleep });
  assert.strictEqual(data.entries[0].lat, 51.65);
  assert.strictEqual(data.entries[0].locationSource, "nominatim: The Village Hall");
  assert.deepStrictEqual(fetch.calls.map((c) => c.q), ["Some Hall, Loughton", "The Village Hall"]);
});

test("an entry with manual coordinates is untouched and never geocoded", async () => {
  const fetch = stubFetch({ "Some Hall, Loughton": INSIDE });
  const data = { entries: [entry({ lat: 51.7, lon: 0.1 })] };
  await locateEvents(data, { fetch, sleep: noSleep });
  assert.deepStrictEqual(data.entries[0], entry({ lat: 51.7, lon: 0.1 }));
  assert.strictEqual(fetch.calls.length, 0);
});

test("an undated entry is untouched and never geocoded", async () => {
  const fetch = stubFetch({ "Some Hall, Loughton": INSIDE });
  const data = { entries: [entry({ date: null, recurring: true })] };
  await locateEvents(data, { fetch, sleep: noSleep });
  assert.deepStrictEqual(data.entries[0], entry({ date: null, recurring: true }));
  assert.strictEqual(fetch.calls.length, 0);
});

test("a fully unresolved entry is marked unlocated and gets no coordinates", async () => {
  const fetch = stubFetch({});
  const data = { entries: [entry()] };
  const result = await locateEvents(data, { fetch, sleep: noSleep });
  assert.deepStrictEqual(data.entries[0], entry({ locationStatus: "unlocated" }));
  assert.deepStrictEqual(result.unlocated, ["e1"]);
});

test("an earlier unlocated entry is retried and the flag cleared once it resolves", async () => {
  const fetch = stubFetch({ "Some Hall, Loughton": INSIDE });
  const data = { entries: [entry({ locationStatus: "unlocated" })] };
  await locateEvents(data, { fetch, sleep: noSleep });
  assert.strictEqual(data.entries[0].locationStatus, undefined);
  assert.strictEqual(data.entries[0].lat, 51.65);
});

test("at most three distinct queries are tried per entry", async () => {
  const fetch = stubFetch({});
  const data = { entries: [entry({ body: "At The Old Hall, and at Another Place. Held at Third Barn, too." })] };
  await locateEvents(data, { fetch, sleep: noSleep });
  assert.strictEqual(fetch.calls.length, 3);
});

test("the written file keeps two-space JSON with a trailing newline, and dry run writes nothing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "locate-"));
  const file = path.join(dir, "events.json");
  const original = JSON.stringify({ _comment: "c", entries: [entry()], sourceNotes: [] }, null, 2) + "\n";
  fs.writeFileSync(file, original);
  const fetch = stubFetch({ "Some Hall, Loughton": INSIDE });
  const quiet = () => {};

  await runFile(file, { dryRun: true, fetch, sleep: noSleep, log: quiet });
  assert.strictEqual(fs.readFileSync(file, "utf8"), original);

  await runFile(file, { dryRun: false, fetch, sleep: noSleep, log: quiet });
  const written = fs.readFileSync(file, "utf8");
  assert.strictEqual(written, JSON.stringify(JSON.parse(written), null, 2) + "\n");
  assert.strictEqual(JSON.parse(written).entries[0].lat, 51.65);
});

test("a past event is untouched and never geocoded, while today's event is located", async () => {
  const fetch = stubFetch({ "Some Hall, Loughton": INSIDE });
  const nowMs = Date.parse("2026-12-05T23:30:00Z"); // 23:30 GMT: still 5 December in London
  const data = { entries: [entry({ id: "old", date: "2026-12-04" }), entry({ id: "today", date: "2026-12-05" })] };
  const result = await locateEvents(data, { fetch, sleep: noSleep, nowMs });
  assert.deepStrictEqual(data.entries[0], entry({ id: "old", date: "2026-12-04" }));
  assert.deepStrictEqual(result.located, ["today"]);
  assert.strictEqual(fetch.calls.length, 1);
});

test("the UK date decides whether an event is past, not the UTC date", async () => {
  const fetch = stubFetch({ "Some Hall, Loughton": INSIDE });
  const nowMs = Date.parse("2026-07-05T23:30:00Z"); // 00:30 BST on 6 July
  const data = { entries: [entry({ date: "2026-07-05" })] };
  await locateEvents(data, { fetch, sleep: noSleep, nowMs });
  assert.strictEqual(fetch.calls.length, 0);
});
