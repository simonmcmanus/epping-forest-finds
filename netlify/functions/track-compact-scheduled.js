// Every 10 minutes: fold the tracking store's raw batches into one file per day, migrate a page of
// the old one-blob-per-POST layout, and drop daily files past the retention period, so the admin
// read never has to list or download more than the days it shows (lib/tracking-store.js).
// Schedule is in netlify.toml; scheduled functions get 30 s, so the job stops at 20 s and the next
// run carries on.
const { connectLambda } = require("@netlify/blobs");
const tracking = require("./lib/tracking-store");
const { openAdapter, retentionDays } = require("./track");

exports.handler = async (event) => {
  if (event && event.blobs) {
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    connectLambda({ ...event, headers });
  }
  const summary = await tracking.compact(openAdapter(), { retentionDays: retentionDays() });
  console.log("track-compact", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};
