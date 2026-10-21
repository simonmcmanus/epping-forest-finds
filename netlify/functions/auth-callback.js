// GET /api/auth/callback — the provider sends the user back here with a one-time code. We exchange it
// on the server (the client secret never reaches the browser), read the subject id and name, and set
// the session cookie.
const auth = require("./lib/auth-session");
const { openStore } = require("./lib/community-store");
const { accountKey, accountOf, mergeAccounts } = require("./lib/community-account");

// Tests hand in a store of their own so nothing touches disk.
let storeOverride = null;
const getStore = (event) => storeOverride || openStore(event);
exports.setStore = (store) => { storeOverride = store; };

function back(event, query, cookies) {
  return { statusCode: 302, headers: { Location: `${query}`, "Cache-Control": "no-store" }, multiValueHeaders: { "Set-Cookie": cookies }, body: "" };
}

exports.handler = async (event) => {
  const config = auth.authConfig();
  if (!config) return { statusCode: 503, body: "Sign-in isn't set up yet." };
  const params = event.queryStringParameters || {};
  const pending = auth.readState(event, config.secret);
  const secure = auth.isSecureRequest(event);
  const cleared = auth.clearStateCookie(secure);
  if (!params.code || !pending || params.state !== pending.state) return back(event, "/community?signin=failed", [cleared]);
  try {
    const token = await fetch(`https://${config.domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: params.code,
        redirect_uri: `${auth.baseUrl(event)}/api/auth/callback`,
      }),
    });
    if (!token.ok) throw new Error(`token ${token.status}`);
    const { access_token: accessToken } = await token.json();
    const profile = await fetch(`https://${config.domain}/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!profile.ok) throw new Error(`userinfo ${profile.status}`);
    const user = await profile.json();
    if (!user.sub) throw new Error("no subject");
    if (pending.merge) {
      // A merge: this login is the *second* one. The person must still be signed in, as the same account the
      // merge was started from; then the new login's devices move into that account and the new login is
      // aliased to it. The session cookie is left exactly as it was (still the first account).
      let outcome = "failed";
      try {
        const current = auth.sessionFrom(event);
        const store = getStore(event);
        if (current && (await accountOf(store, current)) === pending.merge) {
          const result = await mergeAccounts(store, accountKey(String(user.sub)), pending.merge);
          outcome = result.ok ? (result.same ? "same" : "merged") : "failed";
        }
      } catch { outcome = "failed"; }
      return back(event, pending.ret, [auth.mergeResultCookie(outcome, secure), cleared]);
    }
    const session = { sub: String(user.sub), name: auth.displayName(user), exp: Date.now() + auth.SESSION_MS };
    return back(event, pending.ret, [auth.sessionCookie(session, secure), cleared]);
  } catch {
    return back(event, "/community?signin=failed", [cleared]);
  }
};
