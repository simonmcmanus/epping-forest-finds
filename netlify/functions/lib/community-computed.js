// The daily community snapshot: consensus recomputed from the report ledger at most once per
// COMMUNITY_TTL_MINUTES (default a day). Shared by the public overlay and the City of London
// report so both always describe the same state.
const { computeCommunityState } = require("./community-consensus");

const DEFAULT_TTL_MINUTES = 24 * 60;

function ttlMs() {
  const minutes = Number(process.env.COMMUNITY_TTL_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TTL_MINUTES) * 60 * 1000;
}

async function loadComputed(store) {
  const cached = await store.get("computed");
  if (cached && Date.now() - cached.generatedAt < ttlMs()) return cached;
  const keys = await store.list("reports/");
  const reports = (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean);
  const validations = ((await store.get("validations")) || {}).items || [];
  const { overlay, conflicts, conflictDetails, scores, rewards } = computeCommunityState(reports, validations);
  const computed = { generatedAt: Date.now(), overlay, conflicts, conflictDetails, scores, rewards, reportCount: reports.length };
  await store.put("computed", computed);
  return computed;
}

module.exports = { loadComputed };
