// GET /api/auth/logout?return=/community — clear the session cookie on this device.
const auth = require("./lib/auth-session");

exports.handler = async (event) => ({
  statusCode: 302,
  headers: { Location: auth.safeReturnPath(event.queryStringParameters?.return), "Cache-Control": "no-store" },
  multiValueHeaders: { "Set-Cookie": [auth.clearSessionCookie()] },
  body: "",
});
