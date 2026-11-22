// GET /api/admin/me   Who is signed in to the dashboard. 200 { signedIn: true, name }, or 401 { error }.
// Needs the X-Requested-With: admin header like every cookie-authenticated admin request.
const { adminFromRequest } = require("./lib/admin-auth");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: { ...JSON_HEADERS, Allow: "GET" }, body: JSON.stringify({ error: "Method not allowed" }) };
  const admin = adminFromRequest(event);
  if (!admin) return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "Unauthorized" }) };
  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ signedIn: true, name: admin.name }) };
};
