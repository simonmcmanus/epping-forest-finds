// Small helpers shared by the community functions that read the site's own public data or GitHub.
const DEFAULT_REPO = "simonmcmanus/epping-forest-finds";

function originOf(event) {
  const configured = process.env.DEPLOY_PRIME_URL || process.env.URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = (event && event.headers && (event.headers.host || event.headers.Host)) || "localhost:8080";
  return `${/^localhost|^127\./.test(host) ? "http" : "https"}://${host}`;
}

function makeFetchJson(event) {
  const origin = originOf(event);
  return async (path) => {
    const response = await fetch(`${origin}/${path}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`fetch ${path}: ${response.status}`);
    return response.json();
  };
}

// Resolves to null when no token is configured (issue rewards are then skipped, not failed).
function makeGithub() {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_FINE_GRAINED_TOKEN || process.env.GITHUB_PAT || "").trim();
  if (!token) return null;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  return async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub ${path}: ${response.status}`);
    return response.json();
  };
}

// Files one issue; null without a token. Used for conflict escalation.
function makeGithubIssuePoster() {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_FINE_GRAINED_TOKEN || process.env.GITHUB_PAT || "").trim();
  if (!token) return null;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  return async (issue) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify(issue),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub issue: ${response.status}`);
    return response.json();
  };
}

// Edits one issue (PATCH /issues/<n>); null without a token. Used to redact an issue at the reporter's request.
function makeGithubIssueEditor() {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_FINE_GRAINED_TOKEN || process.env.GITHUB_PAT || "").trim();
  if (!token) return null;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  return async (number, changes) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues/${Number(number)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify(changes),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub issue ${number}: ${response.status}`);
    return response.json();
  };
}

module.exports = { originOf, makeFetchJson, makeGithub, makeGithubIssuePoster, makeGithubIssueEditor };
