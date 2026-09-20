/**
 * Closed alpha gate for the map application.
 *
 * The alpha is closed, not secret: a single shared secret opens the app for
 * everyone who has it, and alpha users passing the link on is welcomed rather
 * than prevented. That is why there are no per-person tokens, no revocation
 * list and no storage here -- just one environment variable.
 *
 * The check runs on the server even though the secret is shared. A client-side
 * check would still serve the app's HTML to everyone including crawlers, and
 * the unfinished app would be indexed and turn up in search results.
 *
 * See spec/spec-alpha-access.md.
 */

const COOKIE_NAME = "ef_alpha";
const YEAR_SECONDS = 31536000;

/**
 * Parses ALPHA_SECRETS into the list of currently valid secrets.
 *
 * An empty or unset value means the gate is disabled and the app is public --
 * that is how the alpha ends: clear the variable, no deploy needed.
 */
export function parseSecrets(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Reads one cookie from a request's Cookie header. */
export function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return part.slice(index + 1).trim();
    }
  }
  return "";
}

/**
 * Builds the access cookie. The cookie stores the secret itself rather than a
 * derived token, so removing a value from ALPHA_SECRETS invalidates every
 * cookie issued for it with no extra bookkeeping.
 *
 * HttpOnly is deliberate: nothing client-side needs to read this, and it keeps
 * the value out of js/tracker.js's reach.
 */
export function buildCookie(secret, { secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(secret)}`,
    "Path=/",
    `Max-Age=${YEAR_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export default async (request, context) => {
  const secrets = parseSecrets(
    typeof Netlify !== "undefined" ? Netlify.env.get("ALPHA_SECRETS") : ""
  );

  // Gate disabled -- the app is public.
  if (secrets.length === 0) return context.next();

  const url = new URL(request.url);
  const presented = url.searchParams.get("k");

  // A valid secret in the query string buys the cookie. Redirect to the same
  // path with `k` stripped so the secret does not sit in the address bar or
  // get bookmarked and re-shared with stale state.
  if (presented && secrets.includes(presented)) {
    url.searchParams.delete("k");
    const target = url.pathname + (url.search || "") + (url.hash || "");
    return new Response(null, {
      status: 302,
      headers: {
        Location: target,
        "Set-Cookie": buildCookie(presented, {
          secure: url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
        }),
        "Cache-Control": "no-store",
      },
    });
  }

  if (secrets.includes(readCookie(request.headers.get("cookie"), COOKIE_NAME))) {
    return context.next();
  }

  // Uninvited: send them to the homepage, which explains what this is and
  // collects an address. A redirect rather than a rewrite -- the homepage and
  // the app are separate URLs, so this is honest about where they landed and
  // keeps the two pages' caches distinct.
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Cache-Control": "no-store" },
  });
};

export const config = { path: ["/app", "/app.html"] };
