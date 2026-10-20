// GET /api/auth/login?return=/community — start sign-in with the provider's hosted login page.
const crypto = require("crypto");
const auth = require("./lib/auth-session");

exports.handler = async (event) => {
  const config = auth.authConfig();
  if (!config) return { statusCode: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Sign-in isn't set up yet." };
  const state = crypto.randomBytes(16).toString("base64url");
  const returnTo = auth.safeReturnPath(event.queryStringParameters?.return);
  const url = new URL(`https://${config.domain}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: `${auth.baseUrl(event)}/api/auth/callback`,
    scope: "openid profile",
    state,
  }).toString();
  return {
    statusCode: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
    multiValueHeaders: { "Set-Cookie": [auth.stateCookie({ state, ret: returnTo }, config.secret)] },
    body: "",
  };
};
