// GET /api/community/overlay        — the public delta of community findings (cacheable).
// GET /api/community/overlay?me=<deviceId> — that device's score (small, per-user).
//
// The overlay is recomputed from the report ledger at most once per COMMUNITY_TTL_MINUTES
// (default a day), which is what makes other users' reports take up to a day to appear. It lives
// outside data/**, so it never moves the data cache version.
const { openStore } = require("./lib/community-store");
const { computeCommunityState, communityAdminStats, reportOutcome } = require("./lib/community-consensus");
const { loadComputed } = require("./lib/community-computed");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function queryParam(event, name) {
  return event.queryStringParameters?.[name] || new URLSearchParams(event.rawQuery || "").get(name);
}

// Admin stats are computed fresh from the ledger (not the daily snapshot) so the dashboard is live.
async function adminStats(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  if (!ADMIN_PASSWORD || auth !== `Bearer ${ADMIN_PASSWORD}`) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  const store = openStore(event);
  const reports = (await Promise.all((await store.list("reports/")).map((k) => store.get(k)))).filter(Boolean);
  const stats = communityAdminStats(reports, computeCommunityState(reports));
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(stats),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "GET only" };
  if (queryParam(event, "admin")) return adminStats(event);
  const computed = await loadComputed(openStore(event));
  const me = queryParam(event, "me");
  if (me && queryParam(event, "list")) {
    const mine = (await openStore(event).get(`mine/${me}`)) || [];
    const reports = mine.slice().reverse().map((r) => {
      const entry = r.target ? computed.overlay[r.target] : null;
      return { id: r.id, kind: r.kind, target: r.target || null, status: r.status, ts: r.ts, lat: r.lat, lon: r.lon, outcome: reportOutcome(r, entry, computed.conflicts || []) };
    });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ generatedAt: computed.generatedAt, reports }),
    };
  }
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
