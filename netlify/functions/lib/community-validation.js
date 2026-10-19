// Rewards that arrive after the fact (spec-community.md, "Rewards"):
//  - register: the City of London's next Veteran Tree Register update agrees with a report -> 10 points
//  - fix: a feedback / bug report issue is closed as completed -> 1 point
//  - placeConfirmed: a report that a business is wrong is closed as completed after review -> 3 points
// Pure checks live here; runValidation() wires them to the register, the report ledger and GitHub.
const { validateReport, normalizeTag, distanceMetres, REWARD_POINTS } = require("./community-consensus");
const { rebuildComputed } = require("./community-computed");

const POINTS = REWARD_POINTS;
const MOVED_FROM_LISTED_METRES = 10; // the register's position must have changed by at least this...
const MOVED_TO_REPORTED_METRES = 30; // ...and now be this close to where the reporter stood

const recordOf = (target) => String(target || "").replace(/^tree:/, "");

// register: { hasRecord(rn), record(rn) -> {lat, lon} | null, hasTag(tag) }
// A report only counts if it was made before the new register was first seen, so nobody can claim a
// reward by posting what an already-published register says.
function validateAgainstRegister(reports, register, seenAt) {
  const found = new Map();
  for (const r of reports) {
    if (validateReport(r)) continue;
    if (r.kind !== "tree" || !(r.ts <= seenAt)) continue;
    let reason = null;
    if (r.status === "NEW_TREE") {
      if (register.hasTag(normalizeTag(r.tagNumber))) reason = "its tag is now in the register";
    } else if (r.status === "NOT_HERE") {
      if (!register.hasRecord(recordOf(r.target))) reason = "the record was removed from the register";
    } else if (r.status === "MOVED") {
      const now = register.record(recordOf(r.target));
      if (now && Number.isFinite(r.newLat) && Number.isFinite(r.newLon) && Number.isFinite(r.targetLat) && Number.isFinite(r.targetLon)
        && distanceMetres(now.lat, now.lon, r.targetLat, r.targetLon) >= MOVED_FROM_LISTED_METRES
        && distanceMetres(now.lat, now.lon, r.newLat, r.newLon) <= MOVED_TO_REPORTED_METRES) {
        reason = "the register now places it where the reporter found it";
      }
    }
    if (!reason) continue;
    const key = `${r.deviceId}|${r.target || `new:${normalizeTag(r.tagNumber)}`}|${r.status}`;
    if (!found.has(key)) found.set(key, { kind: "register", deviceId: r.deviceId, target: r.target || `new:tree:tag:${normalizeTag(r.tagNumber)}`, status: r.status, reason, at: seenAt });
  }
  return [...found.values()];
}

// Builds the lookups validateAgainstRegister needs from the public tree chunks.
async function loadRegister(fetchJson) {
  const index = await fetchJson("data/trees/index.json");
  const records = new Map();
  const tags = new Set();
  await Promise.all((index.chunks || []).map(async (chunk) => {
    const data = await fetchJson(chunk.url);
    for (const tree of data.trees || []) {
      const loc = tree.location && tree.location.wgs84 ? tree.location.wgs84 : {};
      const lat = tree.latitude ?? loc.latitude;
      const lon = tree.longitude ?? loc.longitude;
      records.set(String(tree.recordNumber), { lat, lon });
      const tag = normalizeTag(tree.tagNumber);
      if (tag) tags.add(tag);
    }
  }));
  return {
    signature: `${index.generatedAt}|${index.sourceGeneratedAt}|${index.recordCount}`,
    hasRecord: (rn) => records.has(String(rn)),
    record: (rn) => records.get(String(rn)) || null,
    hasTag: (tag) => Boolean(tag) && tags.has(tag),
  };
}

const REF_PATTERN = /reporter-ref:([a-f0-9]{16,64})/g;
const refsIn = (text) => [...String(text || "").matchAll(REF_PATTERN)].map((m) => m[1]);

// Closed-as-completed `user-report` issues -> rewards for whoever reported them (the first reporter
// and anyone whose later report was added as a comment). `github(path)` resolves parsed JSON.
async function rewardsFromIssues(state, github, resolveRef, now = Date.now()) {
  const processed = state.processedIssues || {};
  const since = state.issuesSince ? `&since=${encodeURIComponent(state.issuesSince)}` : "";
  const issues = await github(`/issues?state=closed&labels=user-report&sort=updated&direction=desc&per_page=100${since}`);
  const items = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (issue.pull_request || issue.state_reason !== "completed" || processed[issue.number]) continue;
    const labels = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
    const comments = issue.comments > 0 ? await github(`/issues/${issue.number}/comments?per_page=100`).catch(() => []) : [];
    const refs = new Set([...refsIn(issue.body), ...(comments || []).flatMap((c) => refsIn(c.body))]);
    const devices = new Set();
    for (const ref of refs) {
      const deviceId = await resolveRef(ref);
      if (deviceId) devices.add(deviceId);
    }
    for (const deviceId of devices) {
      items.push({ kind: labels.includes("place-check") ? "placeConfirmed" : "fix", deviceId, issue: issue.number, at: Date.parse(issue.closed_at) || now });
    }
    processed[issue.number] = 1;
  }
  const keep = Object.keys(processed).slice(-5000);
  state.processedIssues = Object.fromEntries(keep.map((k) => [k, 1]));
  state.issuesSince = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  return items;
}

// One full pass. `deps`: { store, fetchJson, github|null, now }. Safe to run as often as wanted.
async function runValidation(deps) {
  const { store, fetchJson, github } = deps;
  const now = deps.now || Date.now();
  const state = (await store.get("validations")) || { items: [], register: null, processedIssues: {} };
  state.items = state.items || [];
  const summary = { registerChecked: false, baseline: false, newRegisterRewards: 0, issueRewards: 0 };
  const has = (item) => state.items.some((x) => x.kind === item.kind && x.deviceId === item.deviceId
    && (item.kind === "register" ? x.target === item.target && x.status === item.status : x.issue === item.issue));

  try {
    const register = await loadRegister(fetchJson);
    summary.registerChecked = true;
    if (!state.register) {
      state.register = { signature: register.signature, seenAt: now }; // baseline: nothing to compare against yet
      summary.baseline = true;
    } else if (state.register.signature !== register.signature) {
      const keys = await store.list("reports/");
      const reports = (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean);
      for (const item of validateAgainstRegister(reports, register, now)) {
        if (!has(item)) { state.items.push(item); summary.newRegisterRewards += 1; }
      }
      state.register = { signature: register.signature, seenAt: now };
    }
  } catch (error) {
    summary.registerError = String(error.message || error);
  }

  if (github) {
    try {
      const rewards = await rewardsFromIssues(state, github, async (ref) => {
        const record = await store.get(`refs/${ref}`);
        return record && record.deviceId;
      }, now);
      for (const item of rewards) if (!has(item)) { state.items.push(item); summary.issueRewards += 1; }
    } catch (error) {
      summary.issueError = String(error.message || error);
    }
  }

  state.lastRunAt = now;
  await store.put("validations", state);
  await rebuildComputed(store); // so the overlay and scores include the new rewards at once
  return summary;
}

module.exports = { POINTS, validateAgainstRegister, loadRegister, rewardsFromIssues, runValidation, refsIn };
