// GET  /api/features?id=<tester id>   which gated features this person has: { community: boolean }
// GET  /api/features?admin=1          the allow list (admin only)
// POST /api/features                  replace the allow list (admin only), body { community: [{ id, note }] }
// The list lives in the community store, so adding a tester needs no deploy.
const auth = require("./lib/auth-session");
const gate = require("./lib/feature-gate");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function reply(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

const { isAdminRequest } = require("./lib/admin-auth");

exports.setStore = gate.setStore;

exports.handler = async (event) => {
  const query = event.queryStringParameters || {};
  const adminRequest = event.httpMethod === "POST" || Boolean(query.admin);
  try {
    if (adminRequest) {
      if (!isAdminRequest(event, process.env.ADMIN_PASSWORD || "")) return reply(401, { error: "Unauthorized" });
      if (event.httpMethod === "POST") {
        let body;
        try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Bad JSON" }); }
        return reply(200, await gate.writeList(event, body));
      }
      return reply(200, await gate.readList(event));
    }
    const session = auth.sessionFrom(event);
    const ids = await gate.vouchedIds(gate.storeFor(event), query.id, session);
    return reply(200, gate.enabledFor(await gate.readList(event), ids));
  } catch (error) {
    // A broken store must never switch a feature on: a reader gets every feature off. An admin's change that
    // could not be saved or read is reported as a failure, never as a success.
    if (adminRequest) return reply(503, { error: "Storage unavailable: nothing was saved. Try again." });
    return reply(200, Object.fromEntries(gate.FEATURES.map((f) => [f, false])));
  }
};
