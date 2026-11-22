// GET /api/auth/logout?return=/community — end the sign-in on this device.
// Clearing our own cookie is not enough: the provider keeps its own single sign-on session, so the next
// login would silently sign the same person straight back in (and "Merge another sign-in" could never
// pick a different account). When sign-in is configured we therefore finish at the provider's /v2/logout,
// which returns the browser to this site. The returnTo must be absolute and listed in the provider
// application's Allowed Logout URLs. We do not send `federated`: that would also sign the person out of
// an upstream identity provider (for example Google), which is too much on a shared device.
const auth = require("./lib/auth-session");

exports.handler = async (event) => {
  const returnPath = auth.safeReturnPath(event.queryStringParameters?.return);
  const config = auth.authConfig();
  let Location = returnPath;
  if (config) {
    const params = new URLSearchParams({ client_id: config.clientId, returnTo: `${auth.baseUrl(event)}${returnPath}` });
    Location = `https://${config.domain}/v2/logout?${params}`;
  }
  return {
    statusCode: 302,
    headers: { Location, "Cache-Control": "no-store" },
    multiValueHeaders: { "Set-Cookie": [auth.clearSessionCookie(auth.isSecureRequest(event))] },
    body: "",
  };
};
