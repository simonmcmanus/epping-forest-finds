// GET /api/community/overlay        — the public delta of community findings (cacheable).
// GET /api/community/overlay?me=<deviceId> — that device's score (small, per-user).
//
// The overlay is recomputed from the report ledger at most once per COMMUNITY_TTL_MINUTES
// (default a day), which is what makes other users' reports take up to a day to appear. It lives
// outside data/**, so it never moves the data cache version.
const { openStore } = require("./lib/community-store");
const { computeCommunityState } = require("./lib/community-consensus");

const DEFAULT_TTL_MINUTES = 24 * 60;

function ttlMs() {
  const minutes = Number(process.env.COMMUNITY_TTL_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TTL_MINUTES) * 60 * 1000;
}

function queryParam(event, name) {
  return event.queryStringParameters?.[name] || new URLSearchParams(event.rawQuery || "").get(name);
}

async function loadComputed(store) {
  const cached = await store.get("computed");
  if (cached && Date.now() - cached.generatedAt < ttlMs()) return cached;
  const keys = await store.list("reports/");
  const reports = (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean);
  const { overlay, conflicts, scores } = computeCommunityState(reports);
  const computed = { generatedAt: Date.now(), overlay, conflicts, scores, reportCount: reports.length };
  await store.put("computed", computed);
  return computed;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "GET only" };
  const computed = await loadComputed(openStore(event));
  const me = queryParam(event, "me");
  if (me) {
    const score = computed.scores[me] || { points: 0, reports: 0, verified: 0, confirmed: 0 };
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ ...score, generatedAt: computed.generatedAt }),
    };
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      ETag: `"c${computed.generatedAt}"`,
    },
    body: JSON.stringify({ generatedAt: computed.generatedAt, entries: computed.overlay }),
  };
};
