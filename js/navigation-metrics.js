// Navigation journey metrics derived from location pings (admin dashboard).
// Pure logic: no DOM, state or app globals. Works as a classic <script> and via require().
const NAV_ARRIVAL_RADIUS_M = 30;
const NAV_GAP_MS = 3 * 60 * 1000;

function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function navTargetHasCoords(t) {
  return !!t && Number.isFinite(t.targetLat) && Number.isFinite(t.targetLng);
}

function sameNavTarget(a, b) {
  if (!navTargetHasCoords(a) || !navTargetHasCoords(b)) return false;
  if (a.id != null && b.id != null) return a.id === b.id;
  return a.targetLat === b.targetLat && a.targetLng === b.targetLng;
}

function deriveNavJourneys(pings) {
  const byUid = new Map();
  for (const p of pings || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const time = Date.parse(p.ts);
    if (!Number.isFinite(time)) continue;
    if (!byUid.has(p.uid)) byUid.set(p.uid, []);
    byUid.get(p.uid).push({ p, time });
  }
  const journeys = [];
  for (const [uid, list] of byUid) {
    list.sort((a, b) => a.time - b.time);
    let cur = null;
    const finish = () => {
      if (!cur) return;
      if (!cur.arrived) {
        cur.remainingM = haversineMetres(cur.lastLat, cur.lastLng, cur.target.targetLat, cur.target.targetLng);
      }
      journeys.push({
        uid, target: cur.target, startedAt: cur.startedAt, endedAt: cur.endedAt,
        arrived: cur.arrived, arrivedAt: cur.arrivedAt,
        distanceWalkedM: cur.distanceWalkedM, remainingM: cur.arrived ? null : cur.remainingM,
      });
      cur = null;
    };
    for (const { p, time } of list) {
      if (cur && (time - cur.lastTime > NAV_GAP_MS || !sameNavTarget(cur.target, p.navTarget))) finish();
      if (!cur) {
        if (!navTargetHasCoords(p.navTarget)) continue;
        cur = {
          target: p.navTarget, startedAt: p.ts, endedAt: p.ts, startTime: time,
          arrived: false, arrivedAt: null, distanceWalkedM: 0,
          lastLat: p.lat, lastLng: p.lng, lastTime: time,
        };
      } else {
        cur.distanceWalkedM += haversineMetres(cur.lastLat, cur.lastLng, p.lat, p.lng);
        cur.lastLat = p.lat; cur.lastLng = p.lng; cur.lastTime = time; cur.endedAt = p.ts;
      }
      if (haversineMetres(p.lat, p.lng, cur.target.targetLat, cur.target.targetLng) <= NAV_ARRIVAL_RADIUS_M) {
        cur.arrived = true;
        cur.arrivedAt = p.ts;
        finish();
      }
    }
    finish();
  }
  return journeys.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

function navTimeBucket(minutes) {
  if (minutes < 5) return "lt5";
  if (minutes < 15) return "b5to15";
  if (minutes <= 30) return "b15to30";
  return "gt30";
}

function summariseNavJourneys(journeys) {
  const list = journeys || [];
  const timeBuckets = { lt5: 0, b5to15: 0, b15to30: 0, gt30: 0 };
  let completed = 0;
  let totalDistanceWalkedM = 0;
  const remaining = [];
  for (const j of list) {
    totalDistanceWalkedM += j.distanceWalkedM || 0;
    if (j.arrived) {
      completed++;
      timeBuckets[navTimeBucket((Date.parse(j.arrivedAt) - Date.parse(j.startedAt)) / 60000)]++;
    } else if (Number.isFinite(j.remainingM)) {
      remaining.push(j.remainingM);
    }
  }
  remaining.sort((a, b) => a - b);
  const mid = remaining.length >> 1;
  const medianRemainingM = !remaining.length ? null
    : remaining.length % 2 ? remaining[mid] : (remaining[mid - 1] + remaining[mid]) / 2;
  return {
    started: list.length,
    completed,
    completionRate: list.length ? completed / list.length : null,
    timeBuckets,
    totalDistanceWalkedM,
    abandoned: list.length - completed,
    medianRemainingM,
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    NAV_ARRIVAL_RADIUS_M, NAV_GAP_MS, haversineMetres, deriveNavJourneys, summariseNavJourneys, navTimeBucket,
  };
}
