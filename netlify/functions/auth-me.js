// GET /api/auth/me — who is signed in on this device, for the Community screen. Never an error for
// an anonymous visitor.
const auth = require("./lib/auth-session");
const { openStore } = require("./lib/community-store");
const { accountKey, accountOf } = require("./lib/community-account");

exports.handler = async (event) => {
  const session = auth.sessionFrom(event);
  let account = "";
  if (session) {
    // After a merge the account is the one this login was merged into; a store failure falls back to its own.
    try { account = await accountOf(openStore(event), session); } catch { account = accountKey(session.sub); }
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(session ? { signedIn: true, name: session.name, account } : { signedIn: false }),
  };
};
