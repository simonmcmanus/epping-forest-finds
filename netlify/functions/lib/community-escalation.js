// Conflicting community reports about one tree (some near walkers confirm it, others say it is wrong)
// cannot be settled by counting, so each is filed once as a GitHub issue for a person to look at.
// The ledger of what has been filed lives in the store (`escalations`), so a rebuild never files the
// same tree twice, and a tree whose conflict later clears and returns is not re-filed either.
const MAX_PER_RUN = 10;

const STATUS_TEXT = {
  VERIFIED: "verified it is right",
  NO_TAG_LIKELY_SAME: "found no tag but it looks right",
  NO_TAG_UNSURE: "found no tag and doubt it",
  DIFFERENT_TREE: "found a different tree",
  NOT_HERE: "found no tree",
  MOVED: "found it at a different spot",
};

function conflictIssue(detail, siteUrl) {
  const record = String(detail.target).replace(/^tree:/, "");
  const counts = Object.entries(detail.counts || {}).map(([status, n]) => `- ${n} × ${STATUS_TEXT[status] || status}`);
  const lines = [
    "## Conflicting community reports",
    `Walkers standing at tree record ${record} disagree, so the community result is held back until a person decides.`,
    "",
    ...counts,
    "",
    "## Metadata",
    `- Record number: ${record}`,
    ...(siteUrl ? [`- Tree page: ${siteUrl}/nearby#tree=r${record}`] : []),
    ...(Number.isFinite(detail.tlat) && Number.isFinite(detail.tlon) ? [`- Listed position: ${detail.tlat}, ${detail.tlon}`, `- Google Maps: https://maps.google.com/?q=${detail.tlat},${detail.tlon}`] : []),
    `- Conflict key: community-conflict-key:${detail.target}`,
  ];
  return {
    title: `Community conflict: tree ${record}`,
    body: lines.join("\n"),
    labels: ["community-conflict", "user-report", `tree:${record}`],
  };
}

// `post(issue)` files one issue and resolves { number, html_url }. Nothing is filed without it.
async function escalateConflicts(store, computed, { post, siteUrl = "", max = MAX_PER_RUN } = {}) {
  const details = (computed && computed.conflictDetails) || [];
  if (!post) return { filed: 0, pending: details.length, skipped: "no-github" };
  const ledger = (await store.get("escalations")) || {};
  let filed = 0;
  let failed = 0;
  for (const detail of details) {
    if (ledger[detail.target]) continue;
    if (filed >= max) break;
    try {
      const issue = await post(conflictIssue(detail, siteUrl));
      ledger[detail.target] = { issue: issue.number, url: issue.html_url, at: Date.now() };
      filed += 1;
      await store.put("escalations", ledger);
    } catch {
      failed += 1; // try again next run
    }
  }
  const pending = details.filter((d) => !ledger[d.target]).length;
  return { filed, failed, pending };
}

module.exports = { escalateConflicts, conflictIssue, MAX_PER_RUN };
