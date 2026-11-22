// Who counts as an admin, shared by the admin endpoints. Two ways in:
//
// 1. The admin password as `Authorization: Bearer <password>`, for scripts (never in the address: a query
//    string is written to access logs, browser history and referrers). Both sides are hashed first, so the
//    comparison takes the same time whatever the password looks like (timingSafeEqual needs equal lengths).
// 2. The dashboard's `ff_admin` cookie, set by the Auth0 callback (GET /api/auth/callback after
//    /api/auth/login?admin=1) for a subject id listed in ADMIN_SUBJECTS. It is signed with AUTH_SECRET, expires
//    after 8 hours, and is only honoured while its subject is STILL listed, so removing someone revokes them.
//    A cookie rides along on cross-site requests, so a cookie-authenticated request must also carry the
//    header `X-Requested-With: admin`; a page on another site cannot add that header without a preflight, and
//    no CORS is granted. Bearer requests need no such header (nothing sends them automatically).
const crypto = require("crypto");
const auth = require("./auth-session");

const digest = (text) => crypto.createHash("sha256").update(String(text)).digest();

const ADMIN_COOKIE = "ff_admin";
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
// ff_admin is signed with a key derived from AUTH_SECRET and carries typ "admin", so a community ff_session or
// sign-in state cookie (signed with AUTH_SECRET itself, no typ) can never be replayed as an admin cookie.
const adminKey = (secret) => crypto.createHmac("sha256", secret).update("ff-admin-cookie").digest("hex");
const CSRF_HEADER = "x-requested-with";
const CSRF_VALUE = "admin";

// ADMIN_SUBJECTS: comma-separated Auth0 subject ids, trimmed, blanks ignored. Unset or empty means nobody.
function adminSubjects(env = process.env) {
  return String(env.ADMIN_SUBJECTS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Exact string match, no case folding or prefix matching. Fails closed when the list is empty.
function isAllowedSubject(sub, env = process.env) {
  if (sub === undefined || sub === null || sub === "") return false;
  return adminSubjects(env).includes(String(sub));
}

function bearerValue(event) {
  return String(auth.header(event || {}, "authorization") || "");
}

function isPasswordRequest(event, password) {
  if (!password) return false;
  return crypto.timingSafeEqual(digest(bearerValue(event)), digest(`Bearer ${password}`));
}

function hasCsrfHeader(event) {
  return auth.header(event || {}, CSRF_HEADER) === CSRF_VALUE;
}

// The signed-in admin ({ sub, name }) from the cookie alone, or null. No CSRF check: the cookie endpoints
// that need one (everything except the callback) go through adminFromRequest.
function adminFromCookie(event, now = Date.now()) {
  const config = auth.authConfig();
  if (!config) return null;
  const payload = auth.verify(auth.parseCookies(auth.header(event || {}, "cookie"))[ADMIN_COOKIE], adminKey(config.secret), now);
  if (!payload || payload.typ !== "admin" || typeof payload.sub !== "string" || !isAllowedSubject(payload.sub)) return null;
  return { sub: payload.sub, name: typeof payload.name === "string" ? payload.name : "Admin" };
}

// A cookie-authenticated admin request: valid cookie, still allow-listed, and the CSRF header present.
function adminFromRequest(event, now = Date.now()) {
  return hasCsrfHeader(event) ? adminFromCookie(event, now) : null;
}

function isAdminRequest(event, password) {
  if (isPasswordRequest(event, password)) return true;
  return !!adminFromRequest(event);
}

function cookieAttrs(secure, maxAgeSeconds) {
  return `Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

const adminCookie = (admin, secure = true, now = Date.now()) =>
  `${ADMIN_COOKIE}=${auth.sign({ typ: "admin", sub: admin.sub, name: admin.name, exp: now + ADMIN_SESSION_MS }, adminKey(auth.authConfig().secret))}; ${cookieAttrs(secure, ADMIN_SESSION_MS / 1000)}`;
const clearAdminCookie = (secure = true) => `${ADMIN_COOKIE}=; ${cookieAttrs(secure, 0)}`;

module.exports = {
  isAdminRequest,
  isPasswordRequest,
  adminSubjects,
  isAllowedSubject,
  adminFromCookie,
  adminFromRequest,
  hasCsrfHeader,
  adminCookie,
  clearAdminCookie,
  ADMIN_COOKIE,
  adminKey,
  ADMIN_SESSION_MS,
};
