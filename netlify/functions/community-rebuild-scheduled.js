// Hourly: rebuild the community snapshot (overlay + score shards) from the report ledger so that
// requests never have to. Schedule is declared in netlify.toml.
const { openStore } = require("./lib/community-store");
const { rebuildComputed } = require("./lib/community-computed");

exports.handler = async (event) => {
  const computed = await rebuildComputed(openStore(event));
  console.log("community-rebuild", JSON.stringify({ reports: computed.reportCount, targets: Object.keys(computed.overlay).length }));
  return { statusCode: 200, body: JSON.stringify({ reports: computed.reportCount }) };
};
