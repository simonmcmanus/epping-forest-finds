// Sign-in for community accounts. The provider (Auth0, configured by env vars) does the login;
// we keep only a signed, HttpOnly cookie holding the provider's subject id and a display name.
// No session store: the cookie is an HMAC over its own JSON, checked with AUTH_SECRET.
const crypto = require("crypto");

const SESSION_COOKIE = "ff_session";
const STATE_COOKIE = "ff_auth_state";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;
const DEFAULT_RETURN = "/community";

// Null until all four are set, so an unconfigured deploy answers "sign-in isn't set up" instead of failing.
function authConfig() {
  const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH_SECRET } = process.env;
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET || !AUTH_SECRET || AUTH_SECRET.length < 32) return null;
  return { domain: AUTH0_DOMAIN, clientId: AUTH0_CLIENT_ID, clientSecret: AUTH0_CLIENT_SECRET, secret: AUTH_SECRET };
}

function sign(payload, key) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${mac}`;
}

// Returns the payload only when the signature matches and the token has not expired.
function verify(token, key, now = Date.now()) {
  if (typeof token !== "string" || !key) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const expected = crypto.createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  return payload && payload.exp > now ? payload : null;
}

function header(event, name) {
  const wanted = name.toLowerCase();
  const key = Object.keys(event.headers || {}).find((k) => k.toLowerCase() === wanted);
  return key ? event.headers[key] : "";
}

function parseCookies(text) {
  const out = {};
  for (const part of String(text || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore a malformed cookie */ }
  }
  return out;
}

// The signed-in account for this request, or null. Never throws, so an anonymous visitor is never an error.
function sessionFrom(event, now = Date.now()) {
  const config = authConfig();
  if (!config) return null;
  return verify(parseCookies(header(event, "cookie"))[SESSION_COOKIE], config.secret, now);
}

// Only same-site paths may be used after sign-in, so ?return= cannot send people off-site.
function safeReturnPath(value) {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) && value.length < 200 ? value : DEFAULT_RETURN;
}

function baseUrl(event) {
  const host = header(event, "host");
  const proto = header(event, "x-forwarded-proto") || (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

// Secure whenever the request came in over https. A browser will not send a Secure cookie back over plain
// http, so over http (local development on localhost, which baseUrl() treats as http) it is left off or
// the sign-in could never complete.
function isSecureRequest(event) {
  return baseUrl(event).startsWith("https:");
}

function cookie(name, value, maxAgeSeconds, secure = true) {
  return `${name}=${value}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

const sessionCookie = (session, secure = true) => cookie(SESSION_COOKIE, sign(session, authConfig().secret), SESSION_MS / 1000, secure);
const clearSessionCookie = (secure = true) => cookie(SESSION_COOKIE, "", 0, secure);
const stateCookie = (state, key, secure = true) => cookie(STATE_COOKIE, sign({ ...state, exp: Date.now() + STATE_MS }, key), STATE_MS / 1000, secure);
const clearStateCookie = (secure = true) => cookie(STATE_COOKIE, "", 0, secure);
const readState = (event, key) => verify(parseCookies(header(event, "cookie"))[STATE_COOKIE], key);

// Providers return the email address as `name` for email logins; never show or store it.
function displayName(user) {
  const usable = [user.name, user.nickname].find((n) => typeof n === "string" && n.trim() && !n.includes("@"));
  return (usable || "Walker").trim().slice(0, 40);
}

module.exports = {
  SESSION_MS,
  authConfig,
  sign,
  verify,
  parseCookies,
  sessionFrom,
  safeReturnPath,
  baseUrl,
  isSecureRequest,
  header,
  sessionCookie,
  clearSessionCookie,
  stateCookie,
  clearStateCookie,
  readState,
  displayName,
};
