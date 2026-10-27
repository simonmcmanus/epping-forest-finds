// Usage-tracking storage (spec-admin.md "Storage"). The layout keeps every read bounded by the
// days it asks for, however long the site has been live:
//
//   raw/<type>/<YYYY-MM-DD>/<ms>_<rand>.json   one POSTed batch, filed under its events' own day
//   daily/<type>/<YYYY-MM-DD>.json             that day's events, merged by the compaction job
//   location/<ms>_<rand>.json, click/...       the old flat layout: one blob per POST, forever,
//                                              which had to be listed in full on every admin read.
//                                              The compaction job migrates it into daily files.
//
// Daily files and admin responses are packed (see packEvents) so a day of events is one read of a
// few MB rather than tens of thousands of small blobs.
const { mapLimit } = require("./map-limit");

const TYPES = ["location", "click"];
const DAY_MS = 24 * 60 * 60 * 1000;
const READ_CONCURRENCY = 25;
// The app queues events offline (js/tracker.js keeps the newest 500), so a batch can arrive late,
// but nothing legitimate is months old or dated in the future.
const MAX_EVENT_AGE_MS = 90 * DAY_MS;
const COORD_DP = 5; // ~1 m, finer than a phone's GPS fix

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const rawPrefix = (type, day) => `raw/${type}/${day}/`;
const dailyKey = (type, day) => `daily/${type}/${day}.json`;
const legacyPrefix = (type) => `${type}/`;

function eventMs(event) {
  const ms = Date.parse(event && event.ts);
  return Number.isFinite(ms) ? ms : null;
}

// ---- Incoming events: keep only known fields, bounded in size ----

function text(value, max) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

function number(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function coord(value, limit) {
  const n = number(value);
  if (n == null || n < -limit || n > limit) return null;
  return Number(n.toFixed(COORD_DP));
}

function sanitizeEvent(event, { now = Date.now(), maxAgeMs = MAX_EVENT_AGE_MS } = {}) {
  if (!event || typeof event !== "object") return null;
  const ms = eventMs(event);
  if (ms == null || ms > now + DAY_MS || ms < now - maxAgeMs) return null;
  const uid = text(event.uid, 64);
  if (!uid) return null;
  const base = { type: event.type, uid, ts: new Date(ms).toISOString() };

  if (event.type === "location") {
    const lat = coord(event.lat, 90);
    const lng = coord(event.lng ?? event.lon, 180);
    if (lat == null || lng == null) return null;
    const heading = number(event.heading);
    const nav = event.navTarget && typeof event.navTarget === "object" ? event.navTarget : null;
    return {
      ...base,
      lat,
      lng,
      heading: heading == null ? null : Math.round(heading),
      navTarget: nav ? {
        id: text(nav.id, 80),
        name: text(nav.name, 120),
        type: text(nav.type, 30),
        targetLat: coord(nav.targetLat, 90),
        targetLng: coord(nav.targetLng, 180),
      } : null,
    };
  }

  if (event.type === "click") {
    return {
      ...base,
      userLat: coord(event.userLat, 90),
      userLng: coord(event.userLng, 180),
      targetLat: coord(event.targetLat, 90),
      targetLng: coord(event.targetLng, 180),
      itemType: text(event.itemType, 30),
      itemId: text(event.itemId, 80),
      itemName: text(event.itemName, 120),
      source: text(event.source, 30),
    };
  }

  return null;
}

// ---- Packed form: a shared uid (and nav target) table plus one short array per event ----

const LOCATION_FIELDS = ["lat", "lng", "heading"];
const CLICK_FIELDS = ["userLat", "userLng", "targetLat", "targetLng", "itemType", "itemId", "itemName", "source"];

function packEvents(type, events) {
  const uids = [];
  const uidIndex = new Map();
  const targets = [];
  const targetIndex = new Map();
  const indexOf = (map, list, key, value) => {
    if (!map.has(key)) { map.set(key, list.length); list.push(value); }
    return map.get(key);
  };
  const fields = type === "location" ? LOCATION_FIELDS : CLICK_FIELDS;
  const rows = events.map((event) => {
    const row = [indexOf(uidIndex, uids, event.uid, event.uid), eventMs(event), ...fields.map((f) => event[f] ?? null)];
    if (type === "location") {
      const nav = event.navTarget;
      row.push(nav ? indexOf(targetIndex, targets, JSON.stringify(nav), nav) : -1);
    }
    return row;
  });
  return type === "location" ? { v: 2, type, uids, targets, rows } : { v: 2, type, uids, rows };
}

function unpackEvents(packed) {
  if (!packed || !Array.isArray(packed.rows)) return [];
  const type = packed.type;
  const fields = type === "location" ? LOCATION_FIELDS : CLICK_FIELDS;
  return packed.rows.map((row) => {
    const event = { type, uid: packed.uids[row[0]], ts: new Date(row[1]).toISOString() };
    fields.forEach((field, i) => { event[field] = row[i + 2]; });
    if (type === "location") {
      const t = row[fields.length + 2];
      event.navTarget = t >= 0 ? packed.targets[t] : null;
    }
    return event;
  });
}

// A crash between writing a daily file and deleting the batches it absorbed would merge those
// batches twice on the next run; an event's own fields identify it well enough to drop the copy.
function eventIdentity(event) {
  return [event.type, event.uid, event.ts, event.lat ?? event.userLat, event.lng ?? event.userLng, event.itemId ?? ""].join("|");
}

function mergeEvents(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const event of list) {
      const id = eventIdentity(event);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(event);
    }
  }
  return merged.sort((a, b) => eventMs(a) - eventMs(b));
}

// ---- Store adapter: the Netlify Blobs store, or any object with the same five methods ----

function blobAdapter(store) {
  return {
    getJSON: (key) => store.get(key, { type: "json" }),
    setJSON: (key, value) => store.setJSON(key, value),
    delete: (key) => store.delete(key),
    async listKeys(prefix) {
      const keys = [];
      let cursor;
      do {
        const page = await store.list({ prefix, ...(cursor ? { cursor } : {}) });
        keys.push(...(page.blobs || []).map((b) => b.key));
        cursor = page.cursor;
      } while (cursor);
      return keys;
    },
    // One page only, so the legacy migration never has to list the whole old layout in one run.
    async firstPageKeys(prefix) {
      const pages = store.list({ prefix, paginate: true });
      if (pages && typeof pages[Symbol.asyncIterator] === "function") {
        for await (const page of pages) return (page.blobs || []).map((b) => b.key);
        return [];
      }
      return ((await pages).blobs || []).map((b) => b.key);
    },
  };
}

// ---- Write ----

async function storeBatch(adapter, events, { now = Date.now(), rand = Math.random().toString(36).slice(2, 8) } = {}) {
  const groups = new Map();
  for (const event of events) {
    const group = `${event.type}|${dayOf(eventMs(event))}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(event);
  }
  const keys = [...groups.keys()].map((group, i) => {
    const [type, day] = group.split("|");
    return `${rawPrefix(type, day)}${now}_${rand}${i}.json`;
  });
  await Promise.all([...groups.values()].map((list, i) => adapter.setJSON(keys[i], list)));
  return keys;
}

// ---- Read ----

// A key whose read throws is left out of `read`, so compaction (which deletes what it read) leaves it for
// the next run instead of deleting events it never saw. A key that reads as missing is already gone.
async function readKeysUntil(adapter, keys, deadline, clock) {
  const read = [];
  let partial = false;
  await mapLimit(keys, READ_CONCURRENCY, async (key) => {
    if (clock() > deadline) { partial = true; return; }
    let value;
    try {
      value = await adapter.getJSON(key);
    } catch {
      return;
    }
    read.push({ key, events: Array.isArray(value) ? value : [] });
  });
  return { read, partial };
}

// Raw batches first, the daily file last. Compaction writes the daily file before deleting the batches
// it absorbed, so a batch gone by the time it is read is already in the daily file read after it, and
// one read before it went is de-duplicated against that file. A daily file that fails to read marks the
// day partial rather than quietly showing only its uncompacted batches.
async function readDay(adapter, type, day, deadline, clock) {
  const rawKeys = await adapter.listKeys(rawPrefix(type, day));
  const { read, partial } = await readKeysUntil(adapter, rawKeys, deadline, clock);
  let daily = null;
  let dailyFailed = false;
  try {
    daily = await adapter.getJSON(dailyKey(type, day));
  } catch {
    dailyFailed = true;
  }
  return { events: mergeEvents(unpackEvents(daily), ...read.map((r) => r.events)), partial: partial || dailyFailed };
}

// Rough size of an event once packed into the admin response.
function packedSize(event) {
  return event.type === "location" ? 48 : 64 + JSON.stringify([event.itemType, event.itemId, event.itemName, event.source]).length;
}

// Newest day first, a few days at a time, until the window, the time budget or the response size
// runs out. A response bigger than Netlify's 6 MB limit fails outright, so the size budget sits
// well under it, and the newest events win when a single day is bigger than that. When reading stops
// part-way through a day, that day's events are still returned (dropping them would return nothing
// when a single day is over budget), and `oldestDayIncomplete` says the earliest day is only in part.
async function readWindow(adapter, { windowDays, now = Date.now(), budgetMs = 7000, maxBytes = 4_500_000, clock = Date.now, dayGroup = 3 } = {}) {
  const deadline = clock() + budgetMs;
  const days = Array.from({ length: windowDays }, (_, i) => dayOf(now - i * DAY_MS));
  const kept = { location: [], click: [] };
  let bytes = 0;
  let partial = false;
  let oldestDay = null;
  let oldestDayIncomplete = false;

  outer:
  for (let i = 0; i < days.length; i += dayGroup) {
    if (clock() > deadline) { partial = true; break; }
    const group = days.slice(i, i + dayGroup);
    const results = await Promise.all(group.map(async (day) => {
      const [location, click] = await Promise.all(TYPES.map((type) => readDay(adapter, type, day, deadline, clock)));
      return { day, location, click };
    }));
    for (const result of results) {
      const events = [...result.location.events, ...result.click.events].sort((a, b) => eventMs(b) - eventMs(a));
      for (const event of events) {
        const size = packedSize(event);
        if (bytes + size > maxBytes) { partial = true; oldestDay = result.day; oldestDayIncomplete = true; break outer; }
        bytes += size;
        kept[event.type].push(event);
      }
      oldestDay = result.day;
      if (result.location.partial || result.click.partial) { partial = true; oldestDayIncomplete = true; break outer; }
    }
  }

  return { locations: kept.location.reverse(), clicks: kept.click.reverse(), partial, oldestDay, oldestDayIncomplete };
}

// ---- Compaction (track-compact-scheduled.js) ----

// A failed read of the existing daily file must stop the merge: writing over it with only the new events
// would lose the whole day. The error ends this run with the batches still in place for the next one.
async function mergeIntoDaily(adapter, type, day, events) {
  const existing = unpackEvents(await adapter.getJSON(dailyKey(type, day)));
  await adapter.setJSON(dailyKey(type, day), packEvents(type, mergeEvents(existing, events)));
}

// Folds raw batches into daily files, migrates a page of the old flat layout, and drops data past the
// retention period. Each step stops at the deadline and leaves the rest for the next run; a batch is
// deleted only after the daily file holding its events has been written.
//
// Every raw batch is swept, whatever day it is filed under: an offline queue can deliver events weeks
// late, and those must be merged (or, past retention, deleted) like any other. Listing all of `raw/`
// stays cheap because this job runs every ten minutes, so it only ever holds the last few minutes'
// batches plus the odd late one.
async function compact(adapter, { now = Date.now(), budgetMs = 20000, clock = Date.now, retentionDays = null } = {}) {
  const deadline = clock() + budgetMs;
  const summary = { compacted: 0, migrated: 0, expired: 0, partial: false };
  const remove = (keys) => mapLimit(keys, READ_CONCURRENCY, (key) => adapter.delete(key).catch(() => {}));
  const cutoff = retentionDays ? dayOf(now - retentionDays * DAY_MS) : null;

  for (const type of TYPES) {
    if (clock() > deadline) { summary.partial = true; return summary; }
    const byDay = new Map();
    for (const key of await adapter.listKeys(`raw/${type}/`)) {
      const day = key.split("/")[2];
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(key);
    }
    for (const day of [...byDay.keys()].sort().reverse()) {
      if (clock() > deadline) { summary.partial = true; return summary; }
      const keys = byDay.get(day);
      if (cutoff && day < cutoff) {
        await remove(keys);
        summary.expired += keys.length;
        continue;
      }
      const { read, partial } = await readKeysUntil(adapter, keys, deadline, clock);
      if (read.length) {
        await mergeIntoDaily(adapter, type, day, read.flatMap((r) => r.events));
        await remove(read.map((r) => r.key));
        summary.compacted += read.length;
      }
      if (partial) { summary.partial = true; return summary; }
    }
  }

  for (const type of TYPES) {
    if (clock() > deadline) { summary.partial = true; return summary; }
    const keys = await adapter.firstPageKeys(legacyPrefix(type));
    if (!keys.length) continue;
    const { read, partial } = await readKeysUntil(adapter, keys, deadline, clock);
    const byDay = new Map();
    for (const { events } of read) {
      for (const raw of events) {
        // Old batches predate the age check, so keep them whatever their date.
        const event = sanitizeEvent({ ...raw, type }, { now, maxAgeMs: Number.POSITIVE_INFINITY });
        if (!event) continue;
        const day = dayOf(eventMs(event));
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(event);
      }
    }
    for (const [day, events] of byDay) await mergeIntoDaily(adapter, type, day, events);
    await remove(read.map((r) => r.key));
    summary.migrated += read.length;
    if (partial) { summary.partial = true; return summary; }
  }

  if (cutoff) {
    for (const type of TYPES) {
      const expired = (await adapter.listKeys(`daily/${type}/`))
        .filter((key) => key.slice(`daily/${type}/`.length, -".json".length) < cutoff);
      await remove(expired);
      summary.expired += expired.length;
    }
  }

  return summary;
}

module.exports = {
  TYPES,
  DAY_MS,
  dayOf,
  dailyKey,
  rawPrefix,
  sanitizeEvent,
  packEvents,
  unpackEvents,
  mergeEvents,
  blobAdapter,
  storeBatch,
  readWindow,
  compact,
};
