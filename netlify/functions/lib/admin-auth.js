// The admin password check shared by the admin endpoints. The password is accepted only as
// `Authorization: Bearer <password>`, never in the address: a query string is written to access logs,
// browser history and referrers. Both sides are hashed first, so the comparison takes the same time whatever
// the password looks like and reveals nothing about how much of it matched (timingSafeEqual needs equal lengths).
const crypto = require("crypto");

const digest = (text) => crypto.createHash("sha256").update(String(text)).digest();

function isAdminRequest(event, password) {
  if (!password) return false;
  const headers = (event && event.headers) || {};
  const name = Object.keys(headers).find((key) => key.toLowerCase() === "authorization");
  const presented = name ? headers[name] : "";
  return crypto.timingSafeEqual(digest(presented), digest(`Bearer ${password}`));
}

module.exports = { isAdminRequest };
