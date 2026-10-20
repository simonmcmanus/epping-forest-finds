// GET /api/community/overlay        — the public delta of community findings (cacheable).
// GET /api/community/overlay?me=<deviceId> — that device's score (small, per-user).
//
// The overlay is rebuilt from the report ledger hourly (COMMUNITY_TTL_MINUTES, default 60) by
// community-rebuild-scheduled.js, which is what makes other users' reports take about an hour to appear. It lives
// outside data/**, so it never moves the data cache version.
const { openStore } = require("./lib/community-store");
const { computeCommunityState, communityAdminStats, reportOutcome, canonicalTarget } = require("./lib/community-consensus");
const { loadComputed, loadScore } = require("./lib/community-computed");
const { sessionFrom } = require("./lib/auth-session");
const { devicesForRequest, mergeScores } = require("./lib/community-account");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function queryParam(event, name) {
  return event.queryStringParameters?.[name] || new URLSearchParams(event.rawQuery || "").get(name);
}

// Admin stats are computed fresh from the ledger (not the hourly snapshot) so the dashboard is live.
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
  const me = queryParam(event, "me");
  // "My score" reads one small shard; only the other views need the whole snapshot.
  if (me && !queryParam(event, "list")) {
    const store = openStore(event);
    const devices = await devicesForRequest(store, me, sessionFrom(event));
    const score = mergeScores(await Promise.all(devices.map((d) => loadScore(store, d))));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify(score),
    };
  }
  const computed = await loadComputed(openStore(event));
  if (me && queryParam(event, "list")) {
    const store = openStore(event);
    const devices = await devicesForRequest(store, me, sessionFrom(event));
    const mine = (await Promise.all(devices.map(async (d) => ((await store.get(`mine/${d}`)) || []).map((r) => ({ ...r, deviceId: d }))))).flat().sort((a, b) => b.ts - a.ts);
    const items = ((await store.get("validations")) || {}).items || [];
    const validatedKeys = new Set(items.filter((i) => i.kind === "register").map((i) => `${i.deviceId}|${i.target}|${i.status}`));
    const issueRewards = new Map(items.filter((i) => i.kind !== "register" && devices.includes(i.deviceId)).map((i) => [i.issue, i.kind]));
    const reports = mine.map((r) => {
      const entry = canonicalTarget(r) ? computed.overlay[canonicalTarget(r)] : null;
      let outcome = reportOutcome(r, entry, computed.conflicts || [], validatedKeys);
      if (r.issue && issueRewards.has(r.issue)) outcome = issueRewards.get(r.issue) === "fix" ? "fixed" : "confirmed";
      return { id: r.id, kind: r.kind, target: r.target || null, status: r.status, ts: r.ts, lat: r.lat, lon: r.lon, tagNumber: r.tagNumber, outcome };
    });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ generatedAt: computed.generatedAt, reports }),
    };
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Browsers keep it 5 minutes; Netlify's edge shares one copy between everyone for 5 minutes
      // and may serve it a while longer while it refreshes, so cost does not grow with users.
      "Cache-Control": "public, max-age=300",
      "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      ETag: `"c${computed.generatedAt}"`,
    },
    body: JSON.stringify({ generatedAt: computed.generatedAt, entries: computed.overlay }),
  };
};
