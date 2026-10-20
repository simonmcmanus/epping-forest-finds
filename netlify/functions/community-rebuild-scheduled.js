// Hourly: rebuild the community snapshot (overlay + score shards) from the report ledger so that
// requests never have to, then file any new conflicting-report issues. Schedule is in netlify.toml.
const { openStore } = require("./lib/community-store");
const { rebuildComputed } = require("./lib/community-computed");
const { escalateConflicts } = require("./lib/community-escalation");
const { originOf, makeGithubIssuePoster } = require("./lib/community-fetch");

exports.handler = async (event) => {
  const store = openStore(event);
  const computed = await rebuildComputed(store);
  const escalated = await escalateConflicts(store, computed, { post: process.env.CONTEXT === "production" ? makeGithubIssuePoster() : null, siteUrl: originOf(event) });
  console.log("community-rebuild", JSON.stringify({ reports: computed.reportCount, targets: Object.keys(computed.overlay).length, escalated }));
  return { statusCode: 200, body: JSON.stringify({ reports: computed.reportCount, escalated }) };
};
