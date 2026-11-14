// Community data and actions are private to signed-in visitors. Keep the check in one place so
// every community endpoint fails closed in the same way.
const { sessionFrom } = require("./auth-session");

function signedInSession(event) {
  return sessionFrom(event);
}

function unauthorized() {
  return {
    statusCode: 401,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "WWW-Authenticate": "Session",
    },
    body: JSON.stringify({ error: "Sign in to use Community." }),
  };
}

function requireCommunitySession(event) {
  const session = signedInSession(event);
  return session ? { session } : { response: unauthorized() };
}

module.exports = { signedInSession, unauthorized, requireCommunitySession };
