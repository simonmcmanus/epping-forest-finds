/**
 * Builds the iCalendar (.ics) feed served at /calendar.ics. Pure: no I/O.
 *
 * Source is data/forest-events.json (`entries`). An entry is included when it has a `date`
 * (YYYY-MM-DD) that is today or later by the UK calendar date. `startTime` is UK local time
 * (GMT or BST); an entry with no start time is an all-day event. There is no coordinate
 * requirement and no look-ahead window.
 *
 * See spec/spec-data-fetching.md, "Calendar feed".
 */

"use strict";

const UID_DOMAIN = "eppingforestfinds.uk";
const DEFAULT_DURATION_MS = 60 * 60 * 1000; // timed entries carry no end time
const DAY_MS = 24 * 60 * 60 * 1000;

const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function londonFields(ms) {
  const f = {};
  for (const part of londonParts.formatToParts(new Date(ms))) f[part.type] = part.value;
  return f;
}

/** Today's date in the UK as YYYY-MM-DD. */
function ukDate(ms) {
  const f = londonFields(ms);
  return `${f.year}-${f.month}-${f.day}`;
}

/** UTC milliseconds for a UK wall-clock date and HH:MM, correct on both sides of a clock change. */
function londonWallTimeToUtc(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i += 1) {
    const f = londonFields(guess);
    const shown = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute);
    guess += wallAsUtc - shown;
  }
  return guess;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Upcoming dated entries, in data order. */
function upcomingEntries(data, nowMs) {
  const entries = Array.isArray(data && data.entries) ? data.entries : [];
  const today = ukDate(nowMs);
  return entries.filter(
    (entry) =>
      entry &&
      typeof entry.date === "string" &&
      DATE_RE.test(entry.date) &&
      !Number.isNaN(Date.parse(entry.date)) &&
      entry.date >= today
  );
}

function formatUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line at 75 octets, never inside a multibyte character. Returns CRLF-joined text. */
function foldLine(line) {
  const lines = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > limit) {
      lines.push(current);
      current = " ";
      bytes = 1;
      limit = 75;
    }
    current += char;
    bytes += size;
  }
  lines.push(current);
  return lines.join("\r\n");
}

function compactDate(date) {
  return date.replace(/-/g, "");
}

function nextDate(date) {
  return new Date(Date.parse(date) + DAY_MS).toISOString().slice(0, 10);
}

function finite(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildCalendarFeed(data, { nowMs = Date.now() } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Epping Forest Finds//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Epping Forest Finds events",
  ];
  for (const entry of upcomingEntries(data, nowMs)) {
    lines.push("BEGIN:VEVENT", `UID:${entry.id}@${UID_DOMAIN}`, `DTSTAMP:${formatUtc(nowMs)}`);
    if (typeof entry.startTime === "string" && TIME_RE.test(entry.startTime)) {
      const start = londonWallTimeToUtc(entry.date, entry.startTime);
      lines.push(`DTSTART:${formatUtc(start)}`, `DTEND:${formatUtc(start + DEFAULT_DURATION_MS)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(entry.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDate(entry.date))}`);
    }
    lines.push(`SUMMARY:${escapeText(entry.title || "Forest event")}`);
    const sources = (Array.isArray(entry.sources) ? entry.sources : []).filter((s) => s && s.url);
    const description = [entry.body, ...sources.map((s) => (s.label ? `${s.label} ${s.url}` : s.url))]
      .filter(Boolean)
      .join("\n");
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (sources.length) lines.push(`URL:${sources[0].url}`);
    if (entry.place) lines.push(`LOCATION:${escapeText(entry.place)}`);
    const lat = finite(entry.lat);
    const lon = finite(entry.lon);
    if (lat !== null && lon !== null) lines.push(`GEO:${lat};${lon}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

exports.buildCalendarFeed = buildCalendarFeed;
exports.upcomingEntries = upcomingEntries;
exports.foldLine = foldLine;
exports.escapeText = escapeText;
