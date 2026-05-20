const DEFAULT_REPO = "simonmcmanus/epping-forest-finds";

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
  const appVersion = String(payload.appVersion || "unknown").trim();
  const pageUrl = String(payload.pageUrl || "").trim();
  const userAgent = String(payload.userAgent || "").trim();

  if (!details) {
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
  const titlePrefix = isFeature ? "Feature request" : "Missing map data";
  const title = `${titlePrefix}: ${details.slice(0, 80)}`;

  const issueBodyLines = [
    "## Report",
    details,
    "",
    "## Metadata",
    `- Type: ${reportType}`,
    `- App version: ${appVersion || "unknown"}`,
    `- Page URL: ${pageUrl || "unknown"}`,
    `- User agent: ${userAgent || "unknown"}`,
  ];

  if (location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))) {
    issueBodyLines.push(`- Reported location: ${Number(location.latitude)}, ${Number(location.longitude)}`);
    issueBodyLines.push(`- Google Maps: https://maps.google.com/?q=${Number(location.latitude)},${Number(location.longitude)}`);
  }

  const issuePayload = {
    title,
    body: issueBodyLines.join("\n"),
    labels: [isFeature ? "feature-request" : "missing-data", "user-report"],
  };

  try {
    const issueResponse = await fetch(`https://api.github.com/repos/${githubRepo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(issuePayload),
    });

    const issueData = await issueResponse.json().catch(() => ({}));

    if (!issueResponse.ok) {
      return response(issueResponse.status, {
        error: issueData && issueData.message ? issueData.message : "Failed to create GitHub issue",
      });
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
