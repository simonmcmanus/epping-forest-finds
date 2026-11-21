/**
 * Subscribable iCalendar feed of upcoming dated forest events (data/forest-events.json), served at
 * /calendar.ics (redirect in netlify.toml). Google Calendar can subscribe with "From URL".
 *
 * The feed carries only what is in that committed file, so this path is deliberately outside the alpha gate.
 * See spec/spec-data-fetching.md, "Calendar feed".
 */

"use strict";

const { buildCalendarFeed } = require("./lib/calendar-feed.js");
const forestEvents = require("../../data/forest-events.json");

exports.handler = async (event) => {
  const method = (event && event.httpMethod) || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return {
      statusCode: 405,
      headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" },
      body: "Method not allowed",
    };
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
    body: buildCalendarFeed(forestEvents, { nowMs: Date.now() }),
  };
};
