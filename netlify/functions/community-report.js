// POST /api/community/report — store one community report (tree or place verification).
// Idempotent on the client-generated report id, so an outbox retry never double-counts.
const { openStore } = require("./lib/community-store");
const { validateReport } = require("./lib/community-consensus");

const MAX_BODY_BYTES = 8 * 1024;
const MAX_REPORTS_PER_DEVICE_PER_DAY = 200;

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  if (raw.length > MAX_BODY_BYTES) return respond(413, { error: "Report too large" });
  let input;
  try { input = JSON.parse(raw); } catch { return respond(400, { error: "Invalid JSON" }); }

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

  const store = openStore(event);
  const key = `reports/${report.id}`;
  if (await store.get(key)) return respond(200, { ok: true, duplicate: true });

  // Cheap per-device cap, counted from the device's own index so we never list every report.
  const dayKey = `devices/${report.deviceId}-${new Date().toISOString().slice(0, 10)}`;
  const day = (await store.get(dayKey)) || { n: 0 };
  if (day.n >= MAX_REPORTS_PER_DEVICE_PER_DAY) return respond(429, { error: "Too many reports today" });
  await store.put(dayKey, { n: day.n + 1 });
  await store.put(key, report);
  // Per-device index so a contributor can read their own log back without scanning the ledger.
  const mineKey = `mine/${report.deviceId}`;
  const mine = (await store.get(mineKey)) || [];
  mine.push({ id: report.id, kind: report.kind, target: report.target, status: report.status, ts: report.ts, lat: report.lat, lon: report.lon, targetLat: report.targetLat, targetLon: report.targetLon, tagNumber: report.tagNumber });
  await store.put(mineKey, mine.slice(-300));
  return respond(200, { ok: true });
};
