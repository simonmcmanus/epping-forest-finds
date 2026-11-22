// GET  /api/beta/codes   the beta codes and their status (admin only)
// POST /api/beta/codes   { action: "create", note } or { action: "revoke", code } (admin only)
const { isAdminRequest } = require("./lib/admin-auth");
const gate = require("./lib/feature-gate");
const beta = require("./lib/beta-access");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const reply = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });

exports.setStore = gate.setStore;

exports.handler = async (event) => {
  if (!isAdminRequest(event, process.env.ADMIN_PASSWORD || "")) return reply(401, { error: "Unauthorized" });
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return reply(405, { error: "Method not allowed" });
  let body;
  if (event.httpMethod === "POST") {
    try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Bad JSON" }); }
    if (!body || (body.action !== "create" && body.action !== "revoke")) return reply(400, { error: "Unknown action" });
  }
  try {
    const store = gate.storeFor(event);
    if (!body) return reply(200, { codes: await beta.listCodes(store) });
    if (body.action === "create") {
      const made = await beta.createCode(store, body.note);
      return made ? reply(200, made) : reply(400, { error: "Add a name for the person this code is for." });
    }
    const result = await beta.revokeCode(store, body.code);
    return result.ok ? reply(200, { ok: true }) : reply(result.status, { error: "Unknown code" });
  } catch {
    return reply(503, { error: "Storage unavailable: nothing was saved. Try again." });
  }
};
