// GET /api/auth/me — who is signed in on this device, for the Community screen. Never an error for
// an anonymous visitor.
const auth = require("./lib/auth-session");
const { accountKey } = require("./lib/community-account");

exports.handler = async (event) => {
  const session = auth.sessionFrom(event);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(session ? { signedIn: true, name: session.name, account: accountKey(session.sub) } : { signedIn: false }),
  };
};
