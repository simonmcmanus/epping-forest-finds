/**
 * CORS for the native app's API calls.
 *
 * Inside the iOS and Android shells the app is served from the bundle, at capacitor://localhost and
 * https://localhost respectively, so every /api call it makes (js/native.js points them at this
 * site) is cross-origin. This answers the preflight and adds the allow header for those two origins
 * only -- every other caller, including the website itself, passes through untouched. No
 * credentials are allowed: the native app sends no cookies, and the admin and sign-in routes are
 * excluded in netlify.toml rather than opened.
 *
 * See spec/spec-native.md "Networking".
 */

export const NATIVE_ORIGINS = ["capacitor://localhost", "https://localhost"];

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const PREFLIGHT_MAX_AGE_SECONDS = "86400";
// The only request header the app sets on an /api call. Named, not echoed back from the preflight,
// so a caller cannot widen what the browser lets through.
const ALLOWED_HEADERS = "Content-Type";

function allowHeaders(origin) {
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

export default async (request, context) => {
  const origin = request.headers.get("origin");
  if (!NATIVE_ORIGINS.includes(origin)) return context.next();

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...allowHeaders(origin),
        "Access-Control-Allow-Methods": ALLOWED_METHODS,
        "Access-Control-Allow-Headers": ALLOWED_HEADERS,
        "Access-Control-Max-Age": PREFLIGHT_MAX_AGE_SECONDS,
      },
    });
  }

  const response = await context.next();
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(allowHeaders(origin))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
