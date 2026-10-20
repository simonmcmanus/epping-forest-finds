// Abuse protection for the public report endpoint (report-missing-data.js). Every report that reaches
// GitHub can create an issue with the server's token, and the device id and request id come from the
// caller, so nothing the caller sends can be trusted to identify them. Three hourly caps are kept in
// one small store document: per client IP (set by Netlify, not by the caller), per device id, and a
// global one that bounds the whole site however many addresses and ids an attacker invents.
// The document resets each hour and holds at most a couple of entries per accepted report, so it
// stays small. Counts are read-modify-write and not atomic, so a burst can overshoot a little; the
// caps are a brake, not an exact meter. If the store cannot be reached the report is let through
// rather than lost.
const { createHash } = require("crypto");

const DEFAULT_LIMITS = { perIp: 20, perDevice: 10, global: 300 };
const HOUR_MS = 60 * 60 * 1000;
const KEY = "report-rate";
// The community-report endpoint (tree checks and new trees) is much chattier than issue creation, so it
// has its own document and larger caps.
const COMMUNITY_LIMITS = { perIp: 120, perDevice: 120, global: 5000 };

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function configuredLimits(env = process.env) {
  return {
    perIp: positiveInt(env.REPORT_LIMIT_PER_IP, DEFAULT_LIMITS.perIp),
    perDevice: positiveInt(env.REPORT_LIMIT_PER_DEVICE, DEFAULT_LIMITS.perDevice),
    global: positiveInt(env.REPORT_LIMIT_GLOBAL, DEFAULT_LIMITS.global),
  };
}

function configuredCommunityLimits(env = process.env) {
  return {
    perIp: positiveInt(env.COMMUNITY_LIMIT_PER_IP, COMMUNITY_LIMITS.perIp),
    perDevice: positiveInt(env.COMMUNITY_LIMIT_PER_DEVICE, COMMUNITY_LIMITS.perDevice),
    global: positiveInt(env.COMMUNITY_LIMIT_GLOBAL, COMMUNITY_LIMITS.global),
  };
}

function clientIp(event) {
  const headers = Object.fromEntries(Object.entries((event && event.headers) || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return String(headers["x-nf-client-connection-ip"] || String(headers["x-forwarded-for"] || "").split(",")[0] || "").trim();
}

const hashed = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

// Resolves { ok: true } and counts the report, or { ok: false, retryAfter } (seconds) when a cap is hit.
async function checkRateLimit(store, { ip = "", deviceId = "", now = Date.now(), limits = configuredLimits(), key = KEY } = {}) {
  try {
    const hour = Math.floor(now / HOUR_MS);
    let doc = await store.get(key);
    if (!doc || doc.hour !== hour || typeof doc.counts !== "object" || !doc.counts) doc = { hour, counts: {} };
    const scopes = [["g", limits.global]];
    if (ip) scopes.push([`i:${hashed(ip)}`, limits.perIp]);
    if (deviceId) scopes.push([`d:${deviceId}`, limits.perDevice]);
    if (scopes.some(([key, max]) => (doc.counts[key] || 0) >= max)) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil(((hour + 1) * HOUR_MS - now) / 1000)) };
    }
    for (const [key] of scopes) doc.counts[key] = (doc.counts[key] || 0) + 1;
    await store.put(key, doc);
    return { ok: true };
  } catch {
    return { ok: true, skipped: true };
  }
}

module.exports = { checkRateLimit, configuredLimits, configuredCommunityLimits, clientIp, DEFAULT_LIMITS, COMMUNITY_LIMITS };
