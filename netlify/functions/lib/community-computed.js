// The community snapshot: consensus recomputed from the report ledger. Shared by the public overlay
// and the City of London report so both always describe the same state.
//
// Cost shape (see spec-community.md, "Scaling"): the rebuild needs every report, so it runs on a
// schedule (community-rebuild-scheduled.js, hourly) and requests just read the stored result. The
// ledger is read through a cache (community-ledger.js), so a rebuild fetches only new reports. Scores
// are written as small shards so "my score" reads one tiny blob, not the whole snapshot, and the
// admin dashboard's usage figures are stored alongside so an admin view never reads the ledger.
const { computeCommunityState, communityAdminStats } = require("./community-consensus");
const { loadDeviceOwners } = require("./community-links");
const { loadLedger } = require("./community-ledger");
const { mapLimit } = require("./map-limit");

const DEFAULT_TTL_MINUTES = 60;
const SCORE_SHARDS = 256;
const ADMIN_STATS_KEY = "admin-stats";

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

// The adventure reward is the one client-visible bonus that needs a server-side identity check.
// Keep the register lookup out of the request path: rebuilds already run on a schedule and can
// validate every claimed record against the same public tree chunks the app uses.
async function loadAdventureTargets(fetchJson) {
  if (typeof fetchJson !== "function") return null;
  try {
    const index = await fetchJson("data/trees/index.json");
    const targets = new Map();
    await mapLimit(index.chunks || [], 25, async (chunk) => {
      const data = await fetchJson(chunk.url);
      for (const tree of data.trees || []) {
        const record = tree.recordNumber;
        const location = tree.location && tree.location.wgs84 ? tree.location.wgs84 : tree;
        const lat = Number(location.latitude);
        const lon = Number(location.longitude);
        if (record != null && Number.isFinite(lat) && Number.isFinite(lon)) {
          targets.set(`tree:${record}`, { lat, lon });
        }
      }
    });
    return targets;
  } catch {
    // A failed register fetch must not grant a register-backed adventure reward, and callers must
    // not publish a replacement snapshot that silently strips rewards already earned.
    return null;
  }
}

// `strict` (used when rebuilding after a data deletion) makes a failed read abort the rebuild, so a snapshot is
// never published from a partial ledger. The routine hourly rebuild keeps skipping records it cannot read.
async function rebuildComputed(store, { strict = false, fetchJson = null } = {}) {
  const get = strict && store.getStrict ? (k) => store.getStrict(k) : (k) => store.get(k);
  const reports = await loadLedger(store, { strict });
  const validations = ((await get("validations")) || {}).items || [];
  const owners = await loadDeviceOwners(store);
  const adventureTargets = await loadAdventureTargets(fetchJson);
  if (typeof fetchJson === "function" && adventureTargets === null) {
    throw new Error("veteran tree register unavailable; refusing to publish community scores");
  }
  const state = computeCommunityState(reports, validations, owners, { adventureTargets });
  const { overlay, conflicts, conflictDetails, scores, rewards } = state;
  const generatedAt = Date.now();
  const shards = {};
  for (const [id, score] of Object.entries(scores)) (shards[scoreShard(id)] ||= Object.create(null))[id] = score;
  await mapLimit(Object.entries(shards), 25, ([shard, map]) => store.put(`scores/${shard}`, { generatedAt, scores: map }));
  await store.put(ADMIN_STATS_KEY, { generatedAt, ...communityAdminStats(reports, state, generatedAt) });
  const computed = { generatedAt, overlay, conflicts, conflictDetails, rewards, reportCount: reports.length };
  await store.put("computed", computed);
  return computed;
}

async function loadComputed(store, { forceRebuild = false, fetchJson = null } = {}) {
  const cached = await store.get("computed");
  if (!forceRebuild && cached) {
    const age = Date.now() - cached.generatedAt;
    if (age < ttlMs()) return cached;
    // The scheduled job keeps this fresh in production, and a request never rebuilds it there: if the
    // job is failing because the ledger outgrew it, every visitor's request would fail the same way,
    // so an old snapshot is served (and logged) rather than none.
    if (process.env.CONTEXT === "production") {
      console.warn(`[community] serving a snapshot ${Math.round(age / 60000)} minutes old; check community-rebuild-scheduled`);
      return cached;
    }
  }
  return rebuildComputed(store, { fetchJson });
}

// The admin dashboard's community figures, as of the last rebuild (normally under an hour old).
async function loadAdminStats(store, { fetchJson = null } = {}) {
  const stored = await store.get(ADMIN_STATS_KEY);
  if (stored) return stored;
  await rebuildComputed(store, { fetchJson });
  return store.get(ADMIN_STATS_KEY);
}

async function loadScore(store, deviceId) {
  const shard = await store.get(`scores/${scoreShard(deviceId)}`);
  return { ...EMPTY_SCORE, ...((shard && shard.scores && shard.scores[deviceId]) || {}), generatedAt: shard ? shard.generatedAt : 0 };
}

module.exports = { loadComputed, rebuildComputed, loadAdminStats, loadScore, scoreShard, EMPTY_SCORE, loadAdventureTargets };
