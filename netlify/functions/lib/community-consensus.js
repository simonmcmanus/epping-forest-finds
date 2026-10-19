// Pure consensus + scoring for community reports (see spec/spec-community.md). No I/O, so the
// same code runs in the Netlify functions and in the unit tests.
//
// A report: { id, deviceId, kind: "tree"|"place", target, status, targetLat, targetLon,
//             lat, lon (reporter's GPS, optional), newLat, newLon (MOVED), ts }

const STATUSES = {
  tree: {
    VERIFIED: "confirm",
    NO_TAG_LIKELY_SAME: "question",
    NO_TAG_UNSURE: "question",
    DIFFERENT_TREE: "question",
    NOT_HERE: "question",
    MOVED: "question",
    NEW_TREE: "new",
  },
  place: {
    OPEN_CONFIRMED: "confirm",
    CLOSED: "question",
    MOVED: "question",
    RENAMED: "question",
    DETAILS_CHANGED: "question",
    WRONG_CATEGORY: "question",
    NEW_PLACE: "new",
  },
};

const NEAR_METRES = 60; // a reporter further than this from the thing they report is not an independent check
const NEW_MATCH_DECIMALS = 4; // ~11 m grid for "the same new tree"

function statusClass(kind, status) {
  return (STATUSES[kind] || {})[status] || null;
}

function distanceMetres(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

// Returns null when the report is acceptable, otherwise a short reason.
function validateReport(r) {
  if (!r || typeof r !== "object") return "report must be an object";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(r.id || ""))) return "bad id";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(r.deviceId || ""))) return "bad deviceId";
  const cls = statusClass(r.kind, r.status);
  if (!cls) return "unknown kind/status";
  if (cls === "new") {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return "new reports need a position";
  } else if (typeof r.target !== "string" || !r.target || r.target.length > 80) {
    return "bad target";
  }
  if (r.status === "MOVED" && (!Number.isFinite(r.newLat) || !Number.isFinite(r.newLon))) return "MOVED needs newLat/newLon";
  return null;
}

// A report counts as an independent check only if the reporter was near the thing (when we can
// tell). Reports with no reporter position are kept: GPS can be off, and one device is only ever
// one voice regardless.
function isNear(r) {
  if (![r.lat, r.lon, r.targetLat, r.targetLon].every(Number.isFinite)) return true;
  return distanceMetres(r.lat, r.lon, r.targetLat, r.targetLon) <= NEAR_METRES;
}

function newKey(r) {
  return `new:${r.kind}:${r.lat.toFixed(NEW_MATCH_DECIMALS)},${r.lon.toFixed(NEW_MATCH_DECIMALS)}`;
}

function targetOf(r) {
  return statusClass(r.kind, r.status) === "new" ? newKey(r) : r.target;
}

// Latest report per (device, target): a device can change its mind but only ever counts once.
function latestPerDevice(reports) {
  const latest = new Map();
  for (const r of reports) {
    const key = `${r.deviceId}|${targetOf(r)}`;
    const prev = latest.get(key);
    if (!prev || (r.ts || 0) >= (prev.ts || 0)) latest.set(key, r);
  }
  return [...latest.values()];
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0] || [null, 0];
}

// -> { overlay: { [target]: {s,st,n,t,...} }, conflicts: [target], scores: { [deviceId]: {...} } }
function computeCommunityState(reports) {
  const valid = reports.filter((r) => !validateReport(r));
  const latest = latestPerDevice(valid);
  const byTarget = new Map();
  for (const r of latest) {
    const key = targetOf(r);
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(r);
  }

  const overlay = {};
  const conflicts = [];
  const resolved = new Map(); // target -> {s, st}
  for (const [target, list] of byTarget) {
    const near = list.filter(isNear);
    const t = Math.max(...list.map((r) => r.ts || 0));
    if (target.startsWith("new:")) {
      const sample = near[0] || list[0];
      overlay[target] = {
        s: near.length >= 2 ? "new-confirmed" : "new",
        st: sample.status,
        n: near.length,
        lat: Number(sample.lat.toFixed(6)),
        lon: Number(sample.lon.toFixed(6)),
        t,
      };
      resolved.set(target, { s: overlay[target].s });
      continue;
    }
    const confirms = near.filter((r) => statusClass(r.kind, r.status) === "confirm");
    const questions = near.filter((r) => statusClass(r.kind, r.status) === "question");
    const [topStatus, topCount] = mostCommon(questions.map((r) => r.status));
    if (questions.length >= 2 && topCount >= 2 && questions.length > confirms.length) {
      const entry = { s: "questioned", st: topStatus, n: topCount, t };
      if (topStatus === "MOVED") {
        const moved = questions.filter((r) => r.status === "MOVED");
        entry.lat = Number((moved.reduce((a, r) => a + r.newLat, 0) / moved.length).toFixed(6));
        entry.lon = Number((moved.reduce((a, r) => a + r.newLon, 0) / moved.length).toFixed(6));
      }
      overlay[target] = entry;
      resolved.set(target, { s: "questioned", st: topStatus });
    } else if (confirms.length && questions.length) {
      conflicts.push(target);
    } else if (confirms.length) {
      overlay[target] = { s: confirms.length >= 2 ? "confirmed" : "verified", n: confirms.length, t };
      resolved.set(target, { s: "verified" });
    }
  }

  // Scores. Verify = 1 point at once; +1 when an independent device agrees. New find = 1,
  // +3 once a second device finds it. A question that the community upheld = 2.
  const scores = {};
  const ensure = (id) => (scores[id] ||= { points: 0, reports: 0, verified: 0, confirmed: 0 });
  for (const [target, list] of byTarget) {
    const near = list.filter(isNear);
    for (const r of list) {
      const score = ensure(r.deviceId);
      score.reports += 1;
      if (!isNear(r)) continue; // no points for a report made from far away
      const cls = statusClass(r.kind, r.status);
      if (cls === "confirm") {
        score.verified += 1;
        score.points += 1;
        if (near.some((o) => o.deviceId !== r.deviceId && statusClass(o.kind, o.status) === "confirm")) {
          score.confirmed += 1;
          score.points += 1;
        }
      } else if (cls === "new") {
        score.points += 1;
        if (near.some((o) => o.deviceId !== r.deviceId)) {
          score.confirmed += 1;
          score.points += 3;
        }
      } else if (cls === "question") {
        const res = resolved.get(target);
        if (res && res.s === "questioned" && res.st === r.status) {
          score.confirmed += 1;
          score.points += 2;
        }
      }
    }
  }
  return { overlay, conflicts, scores };
}

module.exports = { STATUSES, NEAR_METRES, statusClass, validateReport, computeCommunityState, distanceMetres };
