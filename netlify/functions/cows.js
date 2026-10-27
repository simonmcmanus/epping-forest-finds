const COW_SOURCE_BASE = "https://account.nofence.no/api/open/data/?center=";
const UPSTREAM_TIMEOUT_MS = 6000;
// The only centre the app asks for (DEFAULT_COW_CENTER in js/app.js). Anything else is refused: a
// caller varying `center` would miss the shared edge copy on every request and reach Nofence each time.
const ALLOWED_CENTERS = new Set(["0.06371428038973509,51.656022523996725"]);

// Every open app polls this every 5 minutes for the same fixed centre point, so the answer is the
// same for everyone. Netlify's edge keeps one copy for a minute (and may serve it up to 30 seconds
// longer while it refreshes, so a position is at most about 90 seconds old), so Nofence sees about one
// request a minute however many people are using the app. Errors are never cached, so a failed
// upstream call is retried on the next poll.
const CACHED_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Netlify-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
  "Netlify-Vary": "query=center",
};

function headers(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...extra,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: headers(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const center = event.queryStringParameters && event.queryStringParameters.center;
  if (!center) {
    return { statusCode: 400, headers: headers(), body: JSON.stringify({ error: "Missing center query param" }) };
  }
  if (!ALLOWED_CENTERS.has(center)) {
    return { statusCode: 400, headers: headers(), body: JSON.stringify({ error: "Unknown center" }) };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${COW_SOURCE_BASE}${encodeURIComponent(center)}`, { signal: controller.signal });
    const body = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    return {
      statusCode: upstream.status,
      headers: headers({ "Content-Type": contentType, ...(upstream.ok ? CACHED_HEADERS : {}) }),
      body,
    };
  } catch (error) {
    return { statusCode: 502, headers: headers(), body: JSON.stringify({ error: "Cow data proxy failed" }) };
  } finally {
    clearTimeout(timeoutId);
  }
};
