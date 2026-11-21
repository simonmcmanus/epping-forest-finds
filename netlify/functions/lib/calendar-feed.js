/**
 * Builds the iCalendar (.ics) feed served at /calendar.ics. Pure: no I/O.
 *
 * The feed holds exactly the events the app shows on its map. The visibility rules below are a Node copy
 * of js/normalize.js (finiteCoordinate, eventTimeWindow, isEventPast, isEventTooFarAhead,
 * normalizeEventLocations), which a browser script cannot be required from. Keep them, and
 * EVENT_DEFAULT_DURATION_MS (also in scripts/prune_past_events.js), in sync with js/normalize.js;
 * test/calendar-feed.test.js has a parity test that fails if they drift.
 *
 * See spec/spec-data-fetching.md, "Calendar feed".
 */

"use strict";

const EVENT_DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;
const EVENT_SHOW_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const UID_DOMAIN = "eppingforestfinds.uk";

function finiteCoordinate(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function eventTimeWindow(event) {
  const starts = event && event.startsAt ? new Date(event.startsAt).getTime() : NaN;
  if (!Number.isFinite(starts)) return null;
  const endsRaw = event && event.endsAt ? new Date(event.endsAt).getTime() : NaN;
  const ends = Number.isFinite(endsRaw) ? endsRaw : starts + EVENT_DEFAULT_DURATION_MS;
  return { starts, ends };
}

/** Events the app would show at nowMs, in data order, with their resolved time window and coordinates. */
function visibleEvents(data, nowMs) {
  const input = Array.isArray(data && data.events) ? data.events : [];
  const shown = [];
  input.forEach((item, index) => {
    const lat = finiteCoordinate(item && (item.lat ?? item.latitude));
    const lon = finiteCoordinate(item && (item.lon ?? item.lng ?? item.longitude));
    if (lat == null || lon == null) return;
    const window = eventTimeWindow(item);
    if (!window || window.ends < nowMs) return;
    if (window.starts > nowMs + EVENT_SHOW_AHEAD_MS) return;
    shown.push({
      id: (item && item.id) || `event-${index + 1}`,
      name: (item && item.name) || "Forest event",
      description: (item && item.description) || null,
      sourceUrl: (item && item.sourceUrl) || null,
      lat,
      lon,
      starts: window.starts,
      ends: window.ends,
    });
  });
  return shown;
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

function buildCalendarFeed(data, { nowMs = Date.now() } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Epping Forest Finds//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Epping Forest Finds events",
  ];
  for (const event of visibleEvents(data, nowMs)) {
    const description = [event.description, event.sourceUrl].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@${UID_DOMAIN}`,
      `DTSTAMP:${formatUtc(nowMs)}`,
      `DTSTART:${formatUtc(event.starts)}`,
      `DTEND:${formatUtc(event.ends)}`,
      `SUMMARY:${escapeText(event.name)}`
    );
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (event.sourceUrl) lines.push(`URL:${event.sourceUrl}`);
    lines.push(`GEO:${event.lat};${event.lon}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

exports.buildCalendarFeed = buildCalendarFeed;
exports.visibleEvents = visibleEvents;
exports.foldLine = foldLine;
exports.escapeText = escapeText;
