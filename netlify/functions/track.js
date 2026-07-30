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

    let store;
    try {
      store = getStore(getTrackingStoreName());
      const [locBlobs, clickBlobs] = await Promise.all([
        listAllBlobs(store, "location/"),
        listAllBlobs(store, "click/"),
      ]);
      const [locationArrays, clickArrays] = await Promise.all([
        Promise.all(locBlobs.map((b) => store.get(b.key, { type: "json" }).catch(() => []))),
        Promise.all(clickBlobs.map((b) => store.get(b.key, { type: "json" }).catch(() => []))),
      ]);
      const locations = locationArrays.flat();
      const clicks = clickArrays.flat();
      logTrack("blob-read-ok", {
        locationBlobCount: locBlobs.length,
        clickBlobCount: clickBlobs.length,
        locations: locations.length,
        clicks: clicks.length,
      });
      return response(200, {
        locations,
        clicks,
        meta: {
          storeName: getTrackingStoreName(),
          context: process.env.CONTEXT || "local",
          ...(debug ? {
            storage: "blobs",
            locationBlobCount: locBlobs.length,
            clickBlobCount: clickBlobs.length,
          } : {}),
        },
      });
    } catch (blobErr) {
      warnTrack("blob-read-failed", errorDetails(blobErr));
      if (!allowFileFallback) {
        return response(500, { error: "Blob storage read failed", details: errorDetails(blobErr) });
      }

      // Fall back to local NDJSON files
      try {
        const locations = fileRead("location.ndjson");
        const clicks = fileRead("click.ndjson");
        logTrack("file-read-fallback-ok", { locations: locations.length, clicks: clicks.length });
        return response(200, {
          locations,
          clicks,
          meta: {
            storeName: getTrackingStoreName(),
            context: process.env.CONTEXT || "local",
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
