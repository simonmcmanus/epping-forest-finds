// POST /api/community/report — store one community report (tree or place verification).
// Idempotent on the client-generated report id, so an outbox retry never double-counts.
const { openStore, MINE_LOG_MAX } = require("./lib/community-store");
const { validateReport } = require("./lib/community-consensus");
const { checkRateLimit, configuredCommunityLimits, clientIp } = require("./lib/report-rate-limit");
const { parsePhoto, savePhoto, PRIVATE_TREE_PHOTOS } = require("./lib/report-photo");
const { requireCommunitySession } = require("./lib/community-auth");

// Large enough for one tag photo (base64 of REPORT_PHOTO_MAX_BYTES plus its JSON wrapper); a report
// without a photo is a few hundred bytes.
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_REPORTS_PER_DEVICE_PER_DAY = 200;

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

// Tests swap the store so nothing lands on disk.
let storeOverride = null;
exports.setStore = (store) => { storeOverride = store; };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  if (raw.length > MAX_BODY_BYTES) return respond(413, { error: "Report too large" });
  let input;
  try { input = JSON.parse(raw); } catch { return respond(400, { error: "Invalid JSON" }); }
  if (!input || typeof input !== "object") return respond(400, { error: "Invalid report" });
  const access = requireCommunitySession(event);
  if (access.response) return access.response;

  const report = {
    id: input.id,
    deviceId: input.deviceId,
    kind: input.kind,
    target: input.target,
    status: input.status,
    targetLat: Number(input.targetLat),
    targetLon: Number(input.targetLon),
    lat: input.lat == null ? undefined : Number(input.lat),
    lon: input.lon == null ? undefined : Number(input.lon),
    tagNumber: typeof input.tagNumber === "string" || typeof input.tagNumber === "number" ? String(input.tagNumber).trim().slice(0, 20) : undefined,
    accuracy: input.accuracy == null ? undefined : Number(input.accuracy),
    newLat: input.newLat == null ? undefined : Number(input.newLat),
    newLon: input.newLon == null ? undefined : Number(input.newLon),
    note: typeof input.note === "string" ? input.note.slice(0, 500) : undefined,
    ts: Date.now(),
  };
  const problem = validateReport(report);
  if (problem) return respond(400, { error: problem });
  let photo;
  try { photo = parsePhoto(input.photo); } catch (error) { return respond(400, { error: error.message }); }

  const store = storeOverride || openStore(event);
  const key = `reports/${report.id}`;
  if (await store.get(key)) return respond(200, { ok: true, duplicate: true });

  // The device id is chosen by the caller, so it cannot prove a second report is from a second person.
  // Cap what one network and the whole site can add per hour, so fresh ids cannot be minted without
  // limit to confirm, question or farm points (lib/report-rate-limit.js).
  const link = await store.get(`devicelink/${report.deviceId}`);
  const limited = await checkRateLimit(store, { ip: clientIp(event), deviceId: report.deviceId, account: link && link.account ? link.account : "", limits: configuredCommunityLimits(), key: "community-report-rate" });
  if (!limited.ok) {
    const refused = respond(429, { error: "Too many reports right now. Please try again in a little while." });
    refused.headers["Retry-After"] = String(limited.retryAfter);
    return refused;
  }

  // Cheap per-device cap, counted from the device's own index so we never list every report.
  const dayKey = `devices/${report.deviceId}-${new Date().toISOString().slice(0, 10)}`;
  const day = (await store.get(dayKey)) || { n: 0 };
  if (day.n >= MAX_REPORTS_PER_DEVICE_PER_DAY) return respond(429, { error: "Too many reports today" });
  // The photo of the tree tag is kept for the review. It is stored privately and never published: a tree
  // report is not a public issue (spec/spec-community.md). Saved after the duplicate check, so a retry
  // does not store a second copy; a storage failure is a 503, so the outbox sends the report again.
  if (photo) {
    try { report.photoId = await savePhoto(event, photo, { namespace: PRIVATE_TREE_PHOTOS }); } catch { return respond(503, { error: "Could not save the photo. Please try again." }); }
  }
  await store.put(dayKey, { n: day.n + 1 });
  await store.put(key, report);
  // Per-device index so a contributor can read their own log back without scanning the ledger.
  const mineKey = `mine/${report.deviceId}`;
  const mine = (await store.get(mineKey)) || [];
  mine.push({ id: report.id, kind: report.kind, target: report.target, status: report.status, ts: report.ts, lat: report.lat, lon: report.lon, targetLat: report.targetLat, targetLon: report.targetLon, tagNumber: report.tagNumber });
  await store.put(mineKey, mine.slice(-MINE_LOG_MAX));
  return respond(200, { ok: true });
};
