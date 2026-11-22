// POST /api/beta/redeem   { code }: a signed-in person claims a beta code and gets full Community access.
const auth = require("./lib/auth-session");
const gate = require("./lib/feature-gate");
const beta = require("./lib/beta-access");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const reply = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });

exports.setStore = gate.setStore;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "Method not allowed" });
  // Signed-out callers get only this, so they cannot probe which codes exist.
  const session = auth.sessionFrom(event);
  if (!session) return reply(401, { error: "Sign in first." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "That beta link isn't valid." }); }
  try {
    const result = await beta.redeem(gate.storeFor(event), session, body && body.code);
    return result.ok ? reply(200, { ok: true }) : reply(result.status, { error: result.error });
  } catch {
    return reply(503, { error: "Storage unavailable. Try again." });
  }
};
