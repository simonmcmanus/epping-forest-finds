// GET /api/auth/callback — the provider sends the user back here with a one-time code. We exchange it
// on the server (the client secret never reaches the browser), read the subject id and name, and set
// the session cookie.
const auth = require("./lib/auth-session");

function back(event, query, cookies) {
  return { statusCode: 302, headers: { Location: `${query}`, "Cache-Control": "no-store" }, multiValueHeaders: { "Set-Cookie": cookies }, body: "" };
}

exports.handler = async (event) => {
  const config = auth.authConfig();
  if (!config) return { statusCode: 503, body: "Sign-in isn't set up yet." };
  const params = event.queryStringParameters || {};
  const pending = auth.readState(event, config.secret);
  const cleared = auth.clearStateCookie();
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
    const session = { sub: String(user.sub), name: auth.displayName(user), exp: Date.now() + auth.SESSION_MS };
    return back(event, pending.ret, [auth.sessionCookie(session), cleared]);
  } catch {
    return back(event, "/community?signin=failed", [cleared]);
  }
};
