// GET /api/auth/login?return=/community — start sign-in with the provider's hosted login page.
const crypto = require("crypto");
const auth = require("./lib/auth-session");
const { openStore } = require("./lib/community-store");
const { accountOf } = require("./lib/community-account");

// Tests hand in a store of their own so nothing touches disk.
let storeOverride = null;
const getStore = (event) => storeOverride || openStore(event);
exports.setStore = (store) => { storeOverride = store; };

exports.handler = async (event) => {
  const config = auth.authConfig();
  if (!config) return { statusCode: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Sign-in isn't set up yet." };
  const state = crypto.randomBytes(16).toString("base64url");
  const returnTo = auth.safeReturnPath(event.queryStringParameters?.return);
  // ?merge=1 asks to bring a second sign-in into the account this person is signed in as right now. It is
  // honoured only when they are signed in, and the account is sealed into the signed state cookie, so the
  // callback can check that the same person is still signed in as the same account.
  let merge;
  if (event.queryStringParameters?.merge === "1") {
    const session = auth.sessionFrom(event);
    if (session) { try { merge = await accountOf(getStore(event), session); } catch { merge = undefined; } }
  }
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
    multiValueHeaders: { "Set-Cookie": [auth.stateCookie({ state, ret: returnTo, ...(merge ? { merge } : {}) }, config.secret, auth.isSecureRequest(event))] },
    body: "",
  };
};
