// The community snapshot: consensus recomputed from the report ledger. Shared by the public overlay
// and the City of London report so both always describe the same state.
//
// Cost shape (see spec-community.md, "Scaling"): the rebuild reads every report, so it runs on a
// schedule (community-rebuild-scheduled.js, hourly) and requests just read the stored result. Scores
// are written as small shards so "my score" reads one tiny blob, not the whole snapshot.
const { computeCommunityState } = require("./community-consensus");
const { loadDeviceOwners } = require("./community-links");

const DEFAULT_TTL_MINUTES = 60;
const STALE_GRACE = 3; // in production a request serves a snapshot up to this many TTLs old rather than rebuild inline
const SCORE_SHARDS = 256;

function ttlMs() {
  const minutes = Number(process.env.COMMUNITY_TTL_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TTL_MINUTES) * 60 * 1000;
}

// Deterministic two-hex-digit shard for a device id.
function scoreShard(deviceId) {
  let h = 0;
  for (const ch of String(deviceId)) h = (h * 31 + ch.charCodeAt(0)) % SCORE_SHARDS;
  return h.toString(16).padStart(2, "0");
}

const EMPTY_SCORE = { points: 0, reports: 0, verified: 0, confirmed: 0, validated: 0, fixed: 0 };

async function rebuildComputed(store) {
  const keys = await store.list("reports/");
  const reports = (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean);
  const validations = ((await store.get("validations")) || {}).items || [];
  const owners = await loadDeviceOwners(store);
  const { overlay, conflicts, conflictDetails, scores, rewards } = computeCommunityState(reports, validations, owners);
  const generatedAt = Date.now();
  const shards = {};
  for (const [id, score] of Object.entries(scores)) (shards[scoreShard(id)] ||= Object.create(null))[id] = score;
  await Promise.all(Object.entries(shards).map(([shard, map]) => store.put(`scores/${shard}`, { generatedAt, scores: map })));
  const computed = { generatedAt, overlay, conflicts, conflictDetails, rewards, reportCount: reports.length };
  await store.put("computed", computed);
  return computed;
}

async function loadComputed(store, { forceRebuild = false } = {}) {
  const cached = await store.get("computed");
  if (!forceRebuild && cached) {
    const age = Date.now() - cached.generatedAt;
    if (age < ttlMs()) return cached;
    // The scheduled job keeps this fresh in production; only rebuild inline if it has stopped.
    if (process.env.CONTEXT === "production" && age < ttlMs() * STALE_GRACE) return cached;
  }
  return rebuildComputed(store);
}

async function loadScore(store, deviceId) {
  const shard = await store.get(`scores/${scoreShard(deviceId)}`);
  return { ...EMPTY_SCORE, ...((shard && shard.scores && shard.scores[deviceId]) || {}), generatedAt: shard ? shard.generatedAt : 0 };
}

module.exports = { loadComputed, rebuildComputed, loadScore, scoreShard, EMPTY_SCORE };
