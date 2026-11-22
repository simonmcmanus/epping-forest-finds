// POST /api/admin/session   Trade the admin password (Authorization: Bearer <password>) for a session token.
// Reply: 200 { token, expiresAt } (expiresAt is a millisecond timestamp, 8 hours ahead), or 401 { error }.
// The token is stateless (an HMAC keyed by ADMIN_PASSWORD), so every function instance accepts it and
// changing the password revokes all of them. See lib/admin-auth.js.
const { isPasswordRequest, signSessionToken } = require("./lib/admin-auth");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: { ...JSON_HEADERS, Allow: "POST" }, body: JSON.stringify({ error: "Method not allowed" }) };
  const password = process.env.ADMIN_PASSWORD || "";
  if (!isPasswordRequest(event, password)) return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "Unauthorized" }) };
  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(signSessionToken(password)) };
};
