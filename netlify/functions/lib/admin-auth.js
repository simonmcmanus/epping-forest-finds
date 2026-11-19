// The admin password check shared by the admin endpoints. The password is accepted only as
// `Authorization: Bearer <password>`, never in the address: a query string is written to access logs,
// browser history and referrers. Both sides are hashed first, so the comparison takes the same time whatever
// the password looks like and reveals nothing about how much of it matched (timingSafeEqual needs equal lengths).
//
// The dashboard signs in once with the password (POST /api/admin/session) and then sends a session token
// instead. The token is stateless, so any function instance can check it: `<expiresMs>.<hex HMAC-SHA256>`, keyed by
// the admin password, so changing ADMIN_PASSWORD invalidates every token. The password still works as a Bearer
// value for scripts.
const crypto = require("crypto");

const digest = (text) => crypto.createHash("sha256").update(String(text)).digest();

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

const sessionMac = (password, expiresMs) =>
  crypto.createHmac("sha256", String(password)).update(`admin-session:${expiresMs}`).digest("hex");

function signSessionToken(password, now = Date.now()) {
  const expiresAt = now + SESSION_LIFETIME_MS;
  return { token: `${expiresAt}.${sessionMac(password, expiresAt)}`, expiresAt };
}

function isValidSessionToken(token, password, now = Date.now()) {
  if (!password || typeof token !== "string") return false;
  const match = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const expiresMs = Number(match[1]);
  const valid = crypto.timingSafeEqual(Buffer.from(match[2], "hex"), Buffer.from(sessionMac(password, expiresMs), "hex"));
  return valid && expiresMs > now;
}

function bearerValue(event) {
  const headers = (event && event.headers) || {};
  const name = Object.keys(headers).find((key) => key.toLowerCase() === "authorization");
  return name ? String(headers[name]) : "";
}

function isPasswordRequest(event, password) {
  if (!password) return false;
  return crypto.timingSafeEqual(digest(bearerValue(event)), digest(`Bearer ${password}`));
}

function isAdminRequest(event, password) {
  if (!password) return false;
  if (isPasswordRequest(event, password)) return true;
  const presented = bearerValue(event);
  return presented.startsWith("Bearer ") && isValidSessionToken(presented.slice(7), password);
}

module.exports = { isAdminRequest, isPasswordRequest, signSessionToken, isValidSessionToken, SESSION_LIFETIME_MS };
