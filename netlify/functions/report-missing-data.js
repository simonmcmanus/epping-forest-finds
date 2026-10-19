const DEFAULT_REPO = "simonmcmanus/epping-forest-finds";
const { randomUUID, createHmac } = require("crypto");
const { openStore } = require("./lib/community-store");
const { connectLambda, getStore } = require("@netlify/blobs");
const REPORT_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const REPORT_PHOTO_STORE = "report-photos";

function configureBlobContext(event) {
  if (!event?.blobs) return false;
  try {
    const headers = Object.fromEntries(
      Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    connectLambda({ ...event, headers });
    return true;
  } catch {
    return false;
  }
}

function parsePhoto(photo) {
  if (photo == null) return null;
  if (!photo || typeof photo !== "object") throw new Error("Photo must be an image file");
  const contentType = String(photo.contentType || "").toLowerCase();
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  if (!extensions[contentType]) throw new Error("Please use a JPEG, PNG, or WebP photo");
  const match = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(String(photo.dataUrl || ""));
  if (!match || match[1].toLowerCase() !== contentType) throw new Error("Photo data is invalid");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > REPORT_PHOTO_MAX_BYTES) throw new Error("Photo is too large");
  return { contentType, extension: extensions[contentType], bytes };
}

function reportPhotoUrl(photoId, pageUrl) {
  // `URL` is the production site even during a deploy preview, while Blobs are scoped to
  // the active deploy context. Prefer the deploy's own URL so a preview report points back to
  // the preview function that can read its photo, rather than production returning 405.
  let origin = process.env.DEPLOY_PRIME_URL || process.env.URL || "";
  if (!origin && /^https:\/\//.test(pageUrl)) {
    try { origin = new URL(pageUrl).origin; } catch {}
  }
  return origin ? `${origin.replace(/\/$/, "")}/.netlify/functions/report-missing-data?photo=${encodeURIComponent(photoId)}` : "";
}

async function sendPhoto(event, photoId) {
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(photoId)) return response(404, { error: "Photo not found" });
  if (!configureBlobContext(event)) return response(404, { error: "Photo not found" });
  try {
    const bytes = await getStore(REPORT_PHOTO_STORE).get(`photos/${photoId}`, { type: "arrayBuffer" });
    if (!bytes) return response(404, { error: "Photo not found" });
    const contentType = photoId.endsWith(".png") ? "image/png" : photoId.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return {
      statusCode: 200,
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" },
      body: Buffer.from(bytes).toString("base64"),
      isBase64Encoded: true,
    };
  } catch {
    return response(404, { error: "Photo not found" });
  }
}

// Place checks (spec-community.md): a person says a listed place has closed / moved / changed.
// They are never applied automatically: each becomes a GitHub issue for manual review, and a
// second report about the same place is added to that open issue as a comment instead.
const PLACE_CHECK_LABELS = {
  CLOSED: "It's closed",
  MOVED: "It has moved",
  RENAMED: "The name has changed",
  DETAILS_CHANGED: "The details are wrong",
  WRONG_CATEGORY: "Wrong type of place",
};
const PLACE_KEY_PATTERN = /^[A-Za-z0-9:_.,-]{1,120}$/;

function parsePlaceCheck(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = String(raw.status || "");
  const key = String(raw.key || "");
  if (!PLACE_CHECK_LABELS[status] || !PLACE_KEY_PATTERN.test(key)) return null;
  return {
    status,
    key,
    label: PLACE_CHECK_LABELS[status],
    name: String(raw.name || "").trim().slice(0, 120),
    category: String(raw.category || "").trim().slice(0, 60),
  };
}

// A reporter is credited later (spec-community.md, Rewards) when their issue is closed as completed.
// The public issue carries only an opaque reference; the server keeps the reference -> device id
// mapping, so nobody can read a device id off GitHub.
function reporterRef(deviceId, secret) {
  return createHmac("sha256", secret || "forest-finds").update(deviceId).digest("hex").slice(0, 24);
}

async function recordReporter(event, deviceId, ref, entry) {
  try {
    const store = openStore(event);
    await store.put(`refs/${ref}`, { deviceId });
    const mineKey = `mine/${deviceId}`;
    const mine = (await store.get(mineKey)) || [];
    mine.push({ ...entry, ts: Date.now() });
    await store.put(mineKey, mine.slice(-300));
  } catch {
    // Rewards are a bonus: a storage hiccup must never fail the report itself.
  }
}

function normalizedToken(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['\"]|['\"]$/g, "");
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET" && event.queryStringParameters?.photo) {
    return sendPhoto(event, String(event.queryStringParameters.photo));
  }
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return response(400, { error: "Invalid JSON payload" });
  }

  const reportType = String(payload.reportType || "missing-data").trim();
  const details = String(payload.details || "").trim();
  const location = payload.location && typeof payload.location === "object" ? payload.location : null;
  const locationContextRaw = payload.locationContext && typeof payload.locationContext === "object" ? payload.locationContext : null;
  const locationContext = locationContextRaw ? {
    type: String(locationContextRaw.type || "").trim().slice(0, 60),
    name: String(locationContextRaw.name || "").trim().slice(0, 120),
  } : null;
  const appVersion = String(payload.appVersion || "unknown").trim();
  const pageUrl = String(payload.pageUrl || "").trim();
  const userAgent = String(payload.userAgent || "").trim();
  const rawDeviceId = String(payload.deviceId || "").trim();
  const deviceId = /^[A-Za-z0-9_-]{8,64}$/.test(rawDeviceId) ? rawDeviceId : "";
  const rawRequestId = String(payload.requestId || "").trim().slice(0, 100);
  const requestId = /^[a-zA-Z0-9-]+$/.test(rawRequestId) ? rawRequestId : "";
  let photo;
  try {
    photo = parsePhoto(payload.photo);
  } catch (error) {
    return response(400, { error: error.message });
  }

  const isPlaceCheck = reportType === "place-check";
  const placeCheck = isPlaceCheck ? parsePlaceCheck(payload.placeCheck) : null;
  if (isPlaceCheck && !placeCheck) {
    return response(400, { error: "Invalid place check" });
  }
  // A place check's status is the report; the free text is an optional note on top of it.
  if (!isPlaceCheck && !details) {
    return response(400, { error: "Details are required" });
  }

  const githubToken = normalizedToken(
    process.env.GITHUB_TOKEN
      || process.env.GH_TOKEN
      || process.env.GITHUB_FINE_GRAINED_TOKEN
      || process.env.GITHUB_PAT
  );
  const githubRepo = process.env.GITHUB_REPO || DEFAULT_REPO;

  if (!githubToken) {
    return response(501, {
      error: "GitHub issue integration is not configured at runtime. Set GITHUB_TOKEN (or GH_TOKEN / GITHUB_FINE_GRAINED_TOKEN / GITHUB_PAT) in Netlify Site settings → Environment variables for the active deploy context, then redeploy.",
    });
  }

  const isFeature = reportType === "feature-request";
  const isLocationIssue = reportType === "location-issue";
  const titlePrefix = isPlaceCheck ? "Place check" : isFeature ? "Feature request" : isLocationIssue ? "Location issue" : "Missing map data";
  const titleSubject = isPlaceCheck
    ? `${placeCheck.name || "Unnamed place"}: `
    : isLocationIssue && locationContext && locationContext.name ? `${locationContext.name}: ` : "";
  const title = `${titlePrefix}: ${titleSubject}${isPlaceCheck ? placeCheck.label : details.slice(0, 80)}`;

  const issueBodyLines = [
    "## Report",
    isPlaceCheck ? `**${placeCheck.label}**${details ? `\n\n${details}` : ""}` : details,
    "",
    "## Metadata",
    `- Type: ${reportType}`,
  ];
  if (isPlaceCheck) {
    issueBodyLines.push(
      `- Place: ${[placeCheck.name, placeCheck.category && `(${placeCheck.category})`].filter(Boolean).join(" ")}`,
      `- Reported status: ${placeCheck.status}`,
      `- Place key: place-key:${placeCheck.key}`
    );
  }

  if (locationContext && (locationContext.type || locationContext.name)) {
    issueBodyLines.push(`- Reported item: ${[locationContext.type, locationContext.name].filter(Boolean).join(" — ")}`);
  }

  issueBodyLines.push(
    `- App version: ${appVersion || "unknown"}`,
    `- Page URL: ${pageUrl || "unknown"}`,
    `- User agent: ${userAgent || "unknown"}`
  );

  if (location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))) {
    issueBodyLines.push(`- Reported location: ${Number(location.latitude)}, ${Number(location.longitude)}`);
    issueBodyLines.push(`- Google Maps: https://maps.google.com/?q=${Number(location.latitude)},${Number(location.longitude)}`);
  }

  if (requestId) {
    issueBodyLines.push(`- Request ID: request-id:${requestId}`);
  }
  const ref = deviceId ? reporterRef(deviceId, process.env.COMMUNITY_REF_SECRET || githubToken) : "";
  if (ref) issueBodyLines.push(`- Reporter ref: reporter-ref:${ref}`);

  const issuePayload = {
    title,
    body: issueBodyLines.join("\n"),
    labels: [isPlaceCheck ? "place-check" : isFeature ? "feature-request" : isLocationIssue ? "location-issue" : "missing-data", "user-report"],
  };

  const apiHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    // Same report retried (e.g. after a dropped response, or a double-tap
    // that slipped past the client-side guard) carries the same requestId.
    // Look for an issue we already filed for it before creating another.
    if (requestId) {
      const searchQuery = `repo:${githubRepo} in:body,comments "request-id:${requestId}"`;
      const searchResponse = await fetch(
        `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}`,
        { headers: apiHeaders }
      );
      if (searchResponse.ok) {
        const searchData = await searchResponse.json().catch(() => ({}));
        const existingIssue = Array.isArray(searchData.items) ? searchData.items[0] : null;
        if (existingIssue) {
          return response(200, {
            ok: true,
            duplicate: true,
            issueNumber: existingIssue.number,
            issueUrl: existingIssue.html_url,
          });
        }
      }
    }

    // One open issue per place: a further report about the same place is added to it.
    if (isPlaceCheck) {
      const placeQuery = `repo:${githubRepo} is:issue is:open label:place-check in:body "place-key:${placeCheck.key}"`;
      const placeSearch = await fetch(
        `https://api.github.com/search/issues?q=${encodeURIComponent(placeQuery)}`,
        { headers: apiHeaders }
      );
      if (placeSearch.ok) {
        const placeData = await placeSearch.json().catch(() => ({}));
        const openIssue = Array.isArray(placeData.items) ? placeData.items[0] : null;
        if (openIssue) {
          const commentLines = [`Another report: **${placeCheck.label}** (${placeCheck.status})`];
          if (details) commentLines.push("", details);
          if (location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))) {
            commentLines.push("", `- Reported location: ${Number(location.latitude)}, ${Number(location.longitude)}`);
          }
          if (requestId) commentLines.push(`- Request ID: request-id:${requestId}`);
          if (ref) commentLines.push(`- Reporter ref: reporter-ref:${ref}`);
          const commentResponse = await fetch(`https://api.github.com/repos/${githubRepo}/issues/${openIssue.number}/comments`, {
            method: "POST",
            headers: { ...apiHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ body: commentLines.join("\n") }),
          });
          if (commentResponse.ok) {
            if (ref) await recordReporter(event, deviceId, ref, { id: requestId, kind: "place", status: placeCheck.status, target: placeCheck.key, issue: openIssue.number });
            return response(200, { ok: true, merged: true, issueNumber: openIssue.number, issueUrl: openIssue.html_url });
          }
        }
      }
    }

    if (photo) {
      if (!configureBlobContext(event)) {
        return response(503, { error: "Photo storage is unavailable. Please try again without the photo." });
      }
      const photoId = `${randomUUID()}.${photo.extension}`;
      try {
        await getStore(REPORT_PHOTO_STORE).set(`photos/${photoId}`, photo.bytes, { metadata: { contentType: photo.contentType } });
      } catch {
        return response(503, { error: "Could not save the photo. Please try again." });
      }
      const photoUrl = reportPhotoUrl(photoId, pageUrl);
      if (!photoUrl) return response(503, { error: "Could not link the photo. Please try again." });
      issuePayload.body += `\n\n## Photo\n![Photo attached to report](${photoUrl})`;
    }

    const issueResponse = await fetch(`https://api.github.com/repos/${githubRepo}/issues`, {
      method: "POST",
      headers: { ...apiHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(issuePayload),
    });

    const issueData = await issueResponse.json().catch(() => ({}));

    if (!issueResponse.ok) {
      return response(issueResponse.status, {
        error: issueData && issueData.message ? issueData.message : "Failed to create GitHub issue",
      });
    }

    if (ref) {
      await recordReporter(event, deviceId, ref, isPlaceCheck
        ? { id: requestId, kind: "place", status: placeCheck.status, target: placeCheck.key, issue: issueData.number }
        : { id: requestId, kind: "feedback", status: "FEEDBACK", issue: issueData.number });
    }
    return response(200, {
      ok: true,
      issueNumber: issueData.number,
      issueUrl: issueData.html_url,
    });
  } catch {
    return response(502, { error: "Failed to reach GitHub API" });
  }
};

exports.REPORT_PHOTO_MAX_BYTES = REPORT_PHOTO_MAX_BYTES;
exports.parsePhoto = parsePhoto;
exports.parsePlaceCheck = parsePlaceCheck;
exports.reportPhotoUrl = reportPhotoUrl;
