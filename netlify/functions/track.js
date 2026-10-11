// POST /api/track  — store batches of location & click events.
// GET  /api/admin/tracks?pw=... — return all stored events (admin only).
//
// Storage strategy:
//   - Netlify deployment: @netlify/blobs (one blob per batch, no conflict on concurrent writes)
//   - local development fallback: NDJSON files in data/tracking/ (same as server.js)
//
// The file fallback is intentionally local-only. In deployed Lambda functions,
// Blob storage errors should be visible instead of being hidden by ephemeral files.

const fs = require("fs");
const path = require("path");
const { connectLambda, getStore } = require("@netlify/blobs");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TRACKING_DIR = path.join(__dirname, "..", "..", "data", "tracking");

// Blob count grows without bound (one blob per POST batch, forever -- see Storage
// section of spec-admin.md), and each one is a separate network round-trip to fetch.
// Once a deployment has been live long enough, downloading all of them in one admin
// read blows past the Netlify function execution limit and the request 504s. Blob
// keys embed their write time (`location/<ms-timestamp>_<rand>.json`), so the default
// window is applied before any blob content is downloaded, not after.
const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseWindowDays(event) {
  const raw = queryParam(event, "days");
  if (raw === "all") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WINDOW_DAYS;
}

function windowSinceMs(windowDays) {
  return windowDays == null ? null : Date.now() - windowDays * DAY_MS;
}

function blobKeyTimestampMs(key) {
  const match = /\/(\d+)_/.exec(key || "");
  return match ? Number(match[1]) : null;
}

// A key this function doesn't recognise is kept rather than dropped, so a future key
// format never silently loses data -- it just skips the fast-path filter for that key.
function blobKeyWithinWindow(key, sinceMs) {
  if (sinceMs == null) return true;
  const ts = blobKeyTimestampMs(key);
  return ts == null || ts >= sinceMs;
}

function eventWithinWindow(storedEvent, sinceMs) {
  if (sinceMs == null) return true;
  const ts = Date.parse(storedEvent && storedEvent.ts);
  return !Number.isFinite(ts) || ts >= sinceMs;
}

// ---- Environment-scoped blob store ----
// Production uses "tracking"; preview/branch deploys use "tracking-<branch>" so
// test data never appears in the production admin dashboard.
function getTrackingStoreName() {
  const context = process.env.CONTEXT;
  if (context === "production") return "tracking";
  const branch = (process.env.BRANCH || "dev")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 48);
  return `tracking-${branch}`;
}

function ensureTrackingDir() {
  if (!fs.existsSync(TRACKING_DIR)) fs.mkdirSync(TRACKING_DIR, { recursive: true });
}

// ---- File-based storage (local fallback) ----

function fileAppend(filename, objects) {
  ensureTrackingDir();
  const lines = objects.map((o) => JSON.stringify(o)).join("\n") + "\n";
  fs.appendFileSync(path.join(TRACKING_DIR, filename), lines, "utf8");
}

function fileRead(filename) {
  const file = path.join(TRACKING_DIR, filename);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

// ---- Blob-based storage (Netlify) ----

async function listAllBlobs(store, prefix) {
  const results = [];
  let cursor;
  do {
    const page = await store.list({ prefix, ...(cursor ? { cursor } : {}) });
    results.push(...(page.blobs || []));
    cursor = page.cursor;
  } while (cursor);
  return results;
}

// ---- Shared helpers ----

function logTrack(action, details = {}) {
  console.log(`[track] ${action} ${JSON.stringify(details)}`);
}

function warnTrack(action, details = {}) {
  console.warn(`[track] ${action} ${JSON.stringify(details)}`);
}

function errorDetails(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    code: error?.code || null,
    status: error?.status || null,
  };
}

function configureBlobContext(event) {
  if (!event?.blobs) return false;
  try {
    const headers = Object.fromEntries(
      Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    connectLambda({ ...event, headers });
    return true;
  } catch (error) {
    warnTrack("blob-context-failed", errorDetails(error));
    return false;
  }
}

function canUseFileFallback(event, blobContextConnected) {
  return !blobContextConnected && !event?.blobs && !process.env.AWS_LAMBDA_FUNCTION_NAME;
}

function queryParam(event, name) {
  return event.queryStringParameters?.[name] || new URLSearchParams((event.rawQuery || "")).get(name);
}

function eventBody(event) {
  if (!event.isBase64Encoded) return event.body || "{}";
  return Buffer.from(event.body || "", "base64").toString("utf8");
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function checkAuth(event) {
  if (!ADMIN_PASSWORD) return false;
  const auth = event.headers?.authorization || "";
  if (auth === `Bearer ${ADMIN_PASSWORD}`) return true;
  const pw = queryParam(event, "pw");
  if (pw === ADMIN_PASSWORD) return true;
  return false;
}

// ---- Handler ----

exports.handler = async (event) => {
  const blobContextConnected = configureBlobContext(event);
  const allowFileFallback = canUseFileFallback(event, blobContextConnected);

  logTrack("request", {
    method: event.httpMethod,
    hasBlobContext: Boolean(event.blobs),
    blobContextConnected,
    allowFileFallback,
    storeName: getTrackingStoreName(),
  });

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  // Admin read
  if (event.httpMethod === "GET") {
    if (!checkAuth(event)) return response(401, { error: "Unauthorized" });
    const debug = queryParam(event, "debug") === "1";
    const windowDays = parseWindowDays(event);
    const sinceMs = windowSinceMs(windowDays);

    let store;
    try {
      store = getStore(getTrackingStoreName());
      const [locBlobs, clickBlobs] = await Promise.all([
        listAllBlobs(store, "location/"),
        listAllBlobs(store, "click/"),
      ]);
      const locBlobsInWindow = locBlobs.filter((b) => blobKeyWithinWindow(b.key, sinceMs));
      const clickBlobsInWindow = clickBlobs.filter((b) => blobKeyWithinWindow(b.key, sinceMs));
      const [locationArrays, clickArrays] = await Promise.all([
        Promise.all(locBlobsInWindow.map((b) => store.get(b.key, { type: "json" }).catch(() => []))),
        Promise.all(clickBlobsInWindow.map((b) => store.get(b.key, { type: "json" }).catch(() => []))),
      ]);
      const locations = locationArrays.flat();
      const clicks = clickArrays.flat();
      logTrack("blob-read-ok", {
        windowDays,
        locationBlobCount: locBlobsInWindow.length,
        locationBlobCountTotal: locBlobs.length,
        clickBlobCount: clickBlobsInWindow.length,
        clickBlobCountTotal: clickBlobs.length,
        locations: locations.length,
        clicks: clicks.length,
      });
      return response(200, {
        locations,
        clicks,
        meta: {
          storeName: getTrackingStoreName(),
          context: process.env.CONTEXT || "local",
          windowDays,
          ...(debug ? {
            storage: "blobs",
            locationBlobCount: locBlobsInWindow.length,
            locationBlobCountTotal: locBlobs.length,
            clickBlobCount: clickBlobsInWindow.length,
            clickBlobCountTotal: clickBlobs.length,
          } : {}),
        },
      });
    } catch (blobErr) {
      warnTrack("blob-read-failed", errorDetails(blobErr));
      if (!allowFileFallback) {
        return response(500, { error: "Blob storage read failed", details: errorDetails(blobErr) });
      }

      // Fall back to local NDJSON files. Small enough locally that windowing is just
      // applied to the already-read events rather than filtering file content up front.
      try {
        const locations = fileRead("location.ndjson").filter((e) => eventWithinWindow(e, sinceMs));
        const clicks = fileRead("click.ndjson").filter((e) => eventWithinWindow(e, sinceMs));
        logTrack("file-read-fallback-ok", { locations: locations.length, clicks: clicks.length });
        return response(200, {
          locations,
          clicks,
          meta: {
            storeName: getTrackingStoreName(),
            context: process.env.CONTEXT || "local",
            windowDays,
            ...(debug ? { storage: "file-fallback", blobError: errorDetails(blobErr) } : {}),
          },
        });
      } catch (fileErr) {
        return response(500, { error: String(fileErr.message) });
      }
    }
  }

  // Store events
  if (event.httpMethod === "POST") {
    let payload;
    try {
      payload = JSON.parse(eventBody(event));
    } catch {
      return response(400, { error: "Invalid JSON" });
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    const locationEvents = events.filter((e) => e?.type === "location");
    const clickEvents = events.filter((e) => e?.type === "click");
    const acceptedEvents = locationEvents.length + clickEvents.length;

    logTrack("post-events", {
      received: events.length,
      accepted: acceptedEvents,
      locations: locationEvents.length,
      clicks: clickEvents.length,
    });

    if (acceptedEvents === 0) {
      return response(200, { ok: true, received: events.length, stored: 0, storage: "none" });
    }

    let store;
    try {
      store = getStore(getTrackingStoreName());
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const locationKey = locationEvents.length ? `location/${suffix}.json` : null;
      const clickKey = clickEvents.length ? `click/${suffix}.json` : null;
      const keys = [locationKey, clickKey].filter(Boolean);
      await Promise.all([
        locationKey && store.setJSON(locationKey, locationEvents),
        clickKey && store.setJSON(clickKey, clickEvents),
      ].filter(Boolean));
      logTrack("blob-write-ok", { stored: acceptedEvents, locations: locationEvents.length, clicks: clickEvents.length, keys });
      return response(200, {
        ok: true,
        received: events.length,
        stored: acceptedEvents,
        storage: "blobs",
      });
    } catch (blobErr) {
      warnTrack("blob-write-failed", errorDetails(blobErr));
      if (!allowFileFallback) {
        return response(500, { error: "Blob storage write failed", details: errorDetails(blobErr) });
      }

      // Fall back to local NDJSON files
      try {
        if (locationEvents.length) fileAppend("location.ndjson", locationEvents);
        if (clickEvents.length) fileAppend("click.ndjson", clickEvents);
        logTrack("file-write-fallback-ok", {
          stored: acceptedEvents,
          locations: locationEvents.length,
          clicks: clickEvents.length,
        });
        return response(200, {
          ok: true,
          received: events.length,
          stored: acceptedEvents,
          storage: "file-fallback",
        });
      } catch (fileErr) {
        return response(500, { error: String(fileErr.message) });
      }
    }
  }

  return response(405, { error: "Method not allowed" });
};

exports.DEFAULT_WINDOW_DAYS = DEFAULT_WINDOW_DAYS;
exports.parseWindowDays = parseWindowDays;
exports.windowSinceMs = windowSinceMs;
exports.blobKeyTimestampMs = blobKeyTimestampMs;
exports.blobKeyWithinWindow = blobKeyWithinWindow;
exports.eventWithinWindow = eventWithinWindow;
