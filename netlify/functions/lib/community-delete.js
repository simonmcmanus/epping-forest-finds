// Deleting what the Community features hold about one person, on request (privacy policy, section 13).
//
// Everything is keyed by the anonymous device id (the recovery code the person gives us), and an account
// is only a set of device ids, so one device id is enough to find everything. With `includeAccount` every
// device linked to the same account goes too, along with the account's link records.
//
// What is removed from the store: the reports, the per-device index (`mine/`), the device's link and the
// account's membership markers, the per-day counters, the reporter-ref records that credit rewards to the
// device, the reward records (`validations`), and the device's entry in its score shard. The snapshot is then
// rebuilt, so the overlay and scores no longer include it.
//
// What is only *reported*: the public GitHub issues filed from the person's place changes and feedback. They
// hold no device id (only an opaque reporter reference, which is deleted above), but their text is the
// person's. `github` (an editor) redacts and closes them; without one the issue numbers come back as `pending`
// for a person to handle by hand.
const { rebuildComputed, scoreShard } = require("./community-computed");

const REDACTED_BODY = "_The reporter asked for this report to be removed._";

// A storage failure must stop a deletion, never read as "nothing there": the caller would report `deleted: true`
// with records left behind. So listing errors propagate (the endpoint answers 503 and the request is retried).
// Every read that decides what is deleted goes through `strict`, which throws on a storage error (the Blobs
// wrapper's plain `get` turns one into "not found"). A store without `getStrict` (a test double) is used as is.
const listAll = (store, prefix) => store.list(prefix);
const strict = (store, key) => (store.getStrict ? store.getStrict(key) : store.get(key));

async function deleteCommunityData(store, { deviceId, includeAccount = false, github = null, redactIssues = false } = {}) {
  if (typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) throw new Error("a device id is required");
  const summary = { devices: 0, reports: 0, links: 0, refs: 0, rewards: 0, counters: 0, issues: { redacted: [], pending: [], failed: [] } };

  // 1. Which devices: the one asked about, and (if asked) every device on its account.
  const devices = new Set([deviceId]);
  const owner = await strict(store, `devicelink/${deviceId}`);
  const account = owner && owner.account ? owner.account : null;
  if (includeAccount && account) {
    const prefix = `accountdevices/${account}/`;
    for (const key of await listAll(store, prefix)) devices.add(key.slice(prefix.length));
  }
  summary.devices = devices.size;

  // 2. The issues to deal with, read from the per-device indexes before they are deleted.
  const issues = new Set();
  for (const device of devices) {
    // The uncapped per-issue records, plus the older capped log for issues filed before those existed.
    for (const key of await listAll(store, `issues/${device}/`)) { const n = /(\d+)$/.exec(key); if (n) issues.add(Number(n[1])); }
    for (const entry of (await strict(store, `mine/${device}`)) || []) if (entry && entry.issue) issues.add(Number(entry.issue));
  }

  // 3. Reports in the ledger.
  for (const key of await listAll(store, "reports/")) {
    const report = await strict(store, key);
    if (report && devices.has(report.deviceId)) { await store.delete(key); summary.reports += 1; }
  }

  // 4. Per-device records, links and counters.
  for (const device of devices) {
    await store.delete(`mine/${device}`);
    for (const key of await listAll(store, `issues/${device}/`)) await store.delete(key);
    const link = await strict(store, `devicelink/${device}`);
    if (link) { await store.delete(`devicelink/${device}`); summary.links += 1; if (link.account) await store.delete(`accountdevices/${link.account}/${device}`); }
    for (const key of await listAll(store, `devices/${device}-`)) { await store.delete(key); summary.counters += 1; }
  }
  if (includeAccount && account) for (const key of await listAll(store, `accountdevices/${account}/`)) await store.delete(key);

  // 5. Reporter references (they credit rewards to a device) and reward records.
  for (const key of await listAll(store, "refs/")) {
    const record = await strict(store, key);
    if (record && devices.has(record.deviceId)) { await store.delete(key); summary.refs += 1; }
  }
  const validations = await strict(store, "validations");
  if (validations && Array.isArray(validations.items)) {
    const kept = validations.items.filter((item) => !devices.has(item.deviceId));
    summary.rewards = validations.items.length - kept.length;
    if (summary.rewards) await store.put("validations", { ...validations, items: kept });
  }

  // 6. The device's entry in its score shard, which a rebuild would not rewrite if nothing else lives there.
  for (const device of devices) {
    const shardKey = `scores/${scoreShard(device)}`;
    const shard = await strict(store, shardKey);
    if (shard && shard.scores && Object.prototype.hasOwnProperty.call(shard.scores, device)) {
      delete shard.scores[device];
      await store.put(shardKey, shard);
    }
  }

  // 7. Public issues.
  for (const number of [...issues].filter(Number.isInteger)) {
    if (!github || !redactIssues) { summary.issues.pending.push(number); continue; }
    try {
      await github(number, { body: REDACTED_BODY, title: `Removed report #${number}`, state: "closed", state_reason: "not_planned" });
      summary.issues.redacted.push(number);
    } catch {
      summary.issues.failed.push(number);
    }
  }

  // 8. The snapshot, so the overlay and scores stop including it.
  await rebuildComputed(store, { strict: true });
  return summary;
}

module.exports = { deleteCommunityData, REDACTED_BODY };
