/** Europe/London calendar helpers. Pure; no dependencies. */

"use strict";

const TZ = "Europe/London";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** The Europe/London calendar date (YYYY-MM-DD) at the given instant. */
function ukDate(nowMs) {
  const parts = {};
  for (const p of dateFmt.formatToParts(new Date(nowMs))) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const wallFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit"
});

/** London's offset from UTC in ms at the given instant (3600000 in summer, 0 in winter). */
function londonOffsetMs(utcMs) {
  const p = {};
  for (const part of wallFmt.formatToParts(new Date(utcMs))) p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant (ms) at which London's wall clock shows dateString HH:MM. */
function londonWallTimeToUtc(dateString, hhmm) {
  const [y, mo, d] = dateString.split("-").map(Number);
  const [h, mi] = String(hhmm || "00:00").split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = asUtc - londonOffsetMs(asUtc);
  guess = asUtc - londonOffsetMs(guess);
  return guess;
}

/** The calendar date after dateString (YYYY-MM-DD). */
function nextDate(dateString) {
  const [y, mo, d] = dateString.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}

module.exports = { ukDate, londonWallTimeToUtc, nextDate, TZ };
