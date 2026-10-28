// POST /api/track  — store a batch of location & click events.
// GET  /api/admin/tracks?days=N — the events in the last N days, packed (admin only).
//
// Storage strategy:
//   - Netlify deployment: @netlify/blobs, laid out by day (lib/tracking-store.js). Each POST is one
//     small blob under its day; track-compact-scheduled.js folds those into one file per day.
//   - local development fallback: NDJSON files in data/tracking/
//
// The file fallback is intentionally local-only. In deployed Lambda functions,
// Blob storage errors should be visible instead of being hidden by ephemeral files.

const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");
const tracking = require("./lib/tracking-store");
const { checkRateLimit, clientIp } = require("./lib/report-rate-limit");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
// TRACKING_DIR lets a test point the local fallback at a scratch directory.
const TRACKING_DIR = process.env.TRACKING_DIR || path.join(__dirname, "..", "..", "data", "tracking");

const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = tracking.DAY_MS;

// The app sends at most 150 events a request (js/tracker.js); an older build could send its whole
// offline queue (up to 500) at once, so that is still accepted. Anything bigger is not the app.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS_PER_REQUEST = 500;
// Per client IP, per hour. A phone on the current app sends about 12 requests an hour; mobile
// networks put many customers behind one address, so this is a brake on a script, not on people.
const DEFAULT_LIMIT_PER_IP = 600;
const RATE_SHARDS = 64;

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// How long daily files are kept. The owner decides the real figure (spec-admin.md "Retention").
function retentionDays(env = process.env) {
  if (env.TRACKING_RETENTION_DAYS === "0") return null;
  return positiveInt(env.TRACKING_RETENTION_DAYS, 365);
}

function parseWindowDays(event) {
  const raw = queryParam(event, "days");
  if (raw === "all") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : DEFAULT_WINDOW_DAYS;
}

// `days=all` still has to stop somewhere: the retention period, or a year when nothing expires.
function effectiveWindowDays(windowDays) {
  const cap = retentionDays() || 365;
  return windowDays == null ? cap : Math.min(windowDays, cap);
}

function windowSinceMs(windowDays) {
  return windowDays == null ? null : Date.now() - windowDays * DAY_MS;
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

// Tests swap the store so nothing lands on disk or in Blobs.
let storeOverride = null;
function setStore(store) { storeOverride = store; }

function openAdapter() {
  return storeOverride || tracking.blobAdapter(getStore(getTrackingStoreName()));
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
  return !storeOverride && !blobContextConnected && !event?.blobs && !process.env.AWS_LAMBDA_FUNCTION_NAME;
}

function queryParam(event, name) {
  return event.queryStringParameters?.[name] || new URLSearchParams((event.rawQuery || "")).get(name);
}

function eventBody(event) {
  if (!event.isBase64Encoded) return event.body || "{}";
  return Buffer.from(event.body || "", "base64").toString("utf8");
}

function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
      ...extraHeaders,
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

// The admin response packs locations and clicks (lib/tracking-store.js packEvents); js/admin.js
// unpacks them back into the event objects the dashboard draws.
function adminBody(locations, clicks, meta) {
  return {
    format: 2,
    locations: tracking.packEvents("location", locations),
    clicks: tracking.packEvents("click", clicks),
    meta,
  };
}

// The counters are spread over 64 small documents keyed by a hash of the address, so no single
// document grows with the number of visitors or is rewritten by every request on the site.
async function rateLimited(adapter, event) {
  const ip = clientIp(event);
  if (!ip) return { ok: true };
  const shard = parseInt(createHash("sha256").update(ip).digest("hex").slice(0, 4), 16) % RATE_SHARDS;
  const store = { get: (key) => adapter.getJSON(key).catch(() => null), put: (key, value) => adapter.setJSON(key, value) };
  const perIp = positiveInt(process.env.TRACK_LIMIT_PER_IP, DEFAULT_LIMIT_PER_IP);
  return checkRateLimit(store, { ip, limits: { perIp, perDevice: perIp, global: Number.MAX_SAFE_INTEGER }, key: `track-rate/${shard}` });
}

// ---- Handler ----

exports.handler = async (event) => {
  const blobContextConnected = configureBlobContext(event);
  const allowFileFallback = canUseFileFallback(event, blobContextConnected);

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
    const windowDays = parseWindowDays(event);
    const days = effectiveWindowDays(windowDays);
    const baseMeta = { storeName: getTrackingStoreName(), context: process.env.CONTEXT || "local", windowDays };

    try {
      const result = await tracking.readWindow(openAdapter(), { windowDays: days });
      logTrack("read-ok", { windowDays, locations: result.locations.length, clicks: result.clicks.length, partial: result.partial, oldestDay: result.oldestDay });
      return response(200, adminBody(result.locations, result.clicks, {
        ...baseMeta,
        ...(result.partial ? { partial: true, oldestDay: result.oldestDay, oldestDayIncomplete: result.oldestDayIncomplete } : {}),
      }));
    } catch (blobErr) {
      warnTrack("blob-read-failed", errorDetails(blobErr));
      if (!allowFileFallback) {
        return response(500, { error: "Blob storage read failed", details: errorDetails(blobErr) });
      }

      // Local NDJSON files: small enough locally that windowing is just applied to the read events.
      try {
        const sinceMs = windowSinceMs(days);
        const locations = fileRead("location.ndjson").filter((e) => eventWithinWindow(e, sinceMs));
        const clicks = fileRead("click.ndjson").filter((e) => eventWithinWindow(e, sinceMs));
        return response(200, adminBody(locations, clicks, baseMeta));
      } catch (fileErr) {
        return response(500, { error: String(fileErr.message) });
      }
    }
  }

  // Store events
  if (event.httpMethod === "POST") {
    const raw = eventBody(event);
    if (raw.length > MAX_BODY_BYTES) return response(413, { error: "Batch too large" });
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return response(400, { error: "Invalid JSON" });
    }

    const incoming = Array.isArray(payload && payload.events) ? payload.events : [];
    if (incoming.length > MAX_EVENTS_PER_REQUEST) return response(413, { error: "Too many events in one batch" });
    const now = Date.now();
    const events = incoming.map((e) => tracking.sanitizeEvent(e, { now })).filter(Boolean);

    if (events.length === 0) {
      return response(200, { ok: true, received: incoming.length, stored: 0, storage: "none" });
    }

    try {
      const adapter = openAdapter();
      const limited = await rateLimited(adapter, event);
      if (!limited.ok) {
        return response(429, { error: "Too many requests" }, { "Retry-After": String(limited.retryAfter) });
      }
      await tracking.storeBatch(adapter, events, { now });
      return response(200, { ok: true, received: incoming.length, stored: events.length, storage: "blobs" });
    } catch (blobErr) {
      warnTrack("blob-write-failed", errorDetails(blobErr));
      if (!allowFileFallback) {
        return response(500, { error: "Blob storage write failed", details: errorDetails(blobErr) });
      }

      try {
        const locationEvents = events.filter((e) => e.type === "location");
        const clickEvents = events.filter((e) => e.type === "click");
        if (locationEvents.length) fileAppend("location.ndjson", locationEvents);
        if (clickEvents.length) fileAppend("click.ndjson", clickEvents);
        return response(200, { ok: true, received: incoming.length, stored: events.length, storage: "file-fallback" });
      } catch (fileErr) {
        return response(500, { error: String(fileErr.message) });
      }
    }
  }

  return response(405, { error: "Method not allowed" });
};

exports.DEFAULT_WINDOW_DAYS = DEFAULT_WINDOW_DAYS;
exports.MAX_EVENTS_PER_REQUEST = MAX_EVENTS_PER_REQUEST;
exports.parseWindowDays = parseWindowDays;
exports.retentionDays = retentionDays;
exports.windowSinceMs = windowSinceMs;
exports.eventWithinWindow = eventWithinWindow;
exports.getTrackingStoreName = getTrackingStoreName;
exports.openAdapter = openAdapter;
exports.setStore = setStore;
