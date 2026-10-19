// GET|POST /api/community/rebuild  (admin: Authorization: Bearer <ADMIN_PASSWORD>)
// Rebuilds the community snapshot (overlay + score shards) right now instead of waiting for the hourly
// schedule. Handy when testing; safe to run as often as wanted.
const { openStore } = require("./lib/community-store");
const { rebuildComputed } = require("./lib/community-computed");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

exports.handler = async (event) => {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  if (!ADMIN_PASSWORD || auth !== `Bearer ${ADMIN_PASSWORD}`) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  const computed = await rebuildComputed(openStore(event));
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify({ rebuilt: true, reports: computed.reportCount, targets: Object.keys(computed.overlay).length, generatedAt: computed.generatedAt }),
  };
};
