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

module.exports = { ukDate, TZ };
