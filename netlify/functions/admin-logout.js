// POST /api/admin/logout   End the dashboard sign-in: clears the ff_admin cookie. Needs the
// X-Requested-With: admin header so another site cannot sign an admin out. The community sign-in is untouched.
const { hasCsrfHeader, clearAdminCookie } = require("./lib/admin-auth");
const auth = require("./lib/auth-session");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: { ...JSON_HEADERS, Allow: "POST" }, body: JSON.stringify({ error: "Method not allowed" }) };
  if (!hasCsrfHeader(event)) return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "Unauthorized" }) };
  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    multiValueHeaders: { "Set-Cookie": [clearAdminCookie(auth.isSecureRequest(event))] },
    body: JSON.stringify({ ok: true }),
  };
};
