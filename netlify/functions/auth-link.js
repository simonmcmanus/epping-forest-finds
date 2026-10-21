// POST /api/auth/link {deviceId} — add this device to the signed-in account, so its reports count
// towards the account's score and log.
const auth = require("./lib/auth-session");
const { openStore } = require("./lib/community-store");
const { accountOf, linkDevice } = require("./lib/community-account");

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function respond(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });
  const session = auth.sessionFrom(event);
  if (!session) return respond(401, { error: "Sign in first." });
  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return respond(400, { error: "Invalid JSON" }); }
  if (typeof input.deviceId !== "string" || !DEVICE_ID_RE.test(input.deviceId)) return respond(400, { error: "Invalid device id" });
  const store = openStore(event);
  const result = await linkDevice(store, await accountOf(store, session), input.deviceId);
  if (!result.ok) return respond(result.status, { error: result.error });
  return respond(200, { ok: true });
};
