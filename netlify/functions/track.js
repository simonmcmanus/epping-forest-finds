// POST /api/track  — store batches of location & click events.
// GET  /api/admin/tracks?pw=... — return all stored events (admin only).
//
// Storage strategy:
//   - Netlify deployment: @netlify/blobs (one blob per batch, no conflict on concurrent writes)
//   - netlify dev / local server: NDJSON files in data/tracking/ (same as server.js)
//
// The file fallback kicks in automatically when the Blobs environment is absent,
// so `netlify dev` works without `netlify link`.

const fs = require("fs");
const path = require("path");
const { getStore } = require("@netlify/blobs");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TRACKING_DIR = path.join(__dirname, "..", "..", "data", "tracking");

// ---- Storage backend detection ----

function getBlobStore() {
  try {
    const store = getStore("tracking");
    // Trigger a quick probe — getStore itself doesn't throw, but operations do.
    // We rely on the try/catch in callers instead.
    return store;
  } catch {
    return null;
  }
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
  const pw = event.queryStringParameters?.pw || new URLSearchParams((event.rawQuery || "")).get("pw");
  if (pw === ADMIN_PASSWORD) return true;
  return false;
}

// ---- Handler ----

exports.handler = async (event) => {
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

    let store;
    try {
      store = getStore("tracking");
      const [locBlobs, clickBlobs] = await Promise.all([
        listAllBlobs(store, "location/"),
        listAllBlobs(store, "click/"),
      ]);
      const [locationArrays, clickArrays] = await Promise.all([
        Promise.all(locBlobs.map((b) => store.get(b.key, { type: "json" }).catch(() => []))),
        Promise.all(clickBlobs.map((b) => store.get(b.key, { type: "json" }).catch(() => []))),
      ]);
      return response(200, { locations: locationArrays.flat(), clicks: clickArrays.flat() });
    } catch (blobErr) {
      // Fall back to local NDJSON files
      try {
        return response(200, {
          locations: fileRead("location.ndjson"),
          clicks: fileRead("click.ndjson"),
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
      payload = JSON.parse(event.body || "{}");
    } catch {
      return response(400, { error: "Invalid JSON" });
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    const locationEvents = events.filter((e) => e?.type === "location");
    const clickEvents = events.filter((e) => e?.type === "click");

    let store;
    try {
      store = getStore("tracking");
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await Promise.all([
        locationEvents.length && store.setJSON(`location/${suffix}`, locationEvents),
        clickEvents.length && store.setJSON(`click/${suffix}`, clickEvents),
      ].filter(Boolean));
      return response(200, { ok: true, stored: events.length });
    } catch {
      // Fall back to local NDJSON files
      try {
        if (locationEvents.length) fileAppend("location.ndjson", locationEvents);
        if (clickEvents.length) fileAppend("click.ndjson", clickEvents);
        return response(200, { ok: true, stored: events.length });
      } catch (fileErr) {
        return response(500, { error: String(fileErr.message) });
      }
    }
  }

  return response(405, { error: "Method not allowed" });
};
