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
    // The target just reached and the time of the latest ping still near it: while the walker stays
    // with the same target, lingering pings do not open another journey.
    let reached = null;
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
      if (reached) {
        if (time - reached.time <= NAV_GAP_MS && sameNavTarget(reached.target, p.navTarget)) { reached.time = time; continue; }
        reached = null;
      }
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
        reached = { target: cur.target, time };
        finish();
      }
    }
    finish();
  }
  return journeys.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

// Explicit journeys come from the app's own navigation_start / navigation_arrive / navigation_end
// events. A start opens a journey for its user; an arrive (same navId) marks arrival; an end (same
// navId) closes it, and an end with reason "arrived" also counts as arrival. A newer start by the same
// user closes the previous journey as abandoned. Arrive or end events with no open journey are ignored.
function buildExplicitJourneys(events) {
  const byUid = new Map();
  for (const e of events || []) {
    const time = Date.parse(e && e.ts);
    if (!e || !Number.isFinite(time) || typeof e.type !== "string") continue;
    if (!byUid.has(e.uid)) byUid.set(e.uid, []);
    byUid.get(e.uid).push({ e, time });
  }
  const journeys = [];
  const num = (v) => (Number.isFinite(v) ? v : null);
  for (const [uid, list] of byUid) {
    list.sort((a, b) => a.time - b.time);
    let cur = null;
    const close = () => {
      if (!cur) return;
      journeys.push({
        uid, explicit: true, navId: cur.navId, target: cur.target, startedAt: cur.startedAt, endedAt: cur.endedAt,
        arrived: cur.arrived, arrivedAt: cur.arrivedAt, distanceWalkedM: cur.walkedM || 0, walkedM: cur.walkedM,
        routeM: cur.routeM, remainingM: cur.arrived ? null : cur.remainingM, reason: cur.reason,
      });
      cur = null;
    };
    for (const { e } of list) {
      if (e.type === "navigation_start") {
        close();
        if (!Number.isFinite(e.targetLat) || !Number.isFinite(e.targetLng)) continue;
        cur = {
          navId: e.navId ?? null, startedAt: e.ts, endedAt: e.ts, arrived: false, arrivedAt: null,
          routeM: num(e.routeM), walkedM: null, remainingM: null, reason: null,
          target: { id: e.navId ?? null, name: e.navName ?? null, type: e.navType ?? null, targetLat: e.targetLat, targetLng: e.targetLng },
        };
      } else if (cur && (e.type === "navigation_arrive" || e.type === "navigation_end") && (e.navId ?? null) === cur.navId) {
        cur.endedAt = e.ts;
        if (num(e.walkedM) !== null) cur.walkedM = e.walkedM;
        if (e.type === "navigation_arrive") {
          if (!cur.arrived) { cur.arrived = true; cur.arrivedAt = e.ts; }
        } else {
          if (e.reason === "arrived" && !cur.arrived) { cur.arrived = true; cur.arrivedAt = e.ts; }
          cur.remainingM = num(e.remainingM);
          cur.reason = e.reason ?? null;
          close();
        }
      }
    }
    close();
  }
  return journeys.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

// Explicit journeys win. A derived journey (from pings) is kept only when no explicit journey of the
// same user covers it: its span overlaps an explicit journey's start to end plus NAV_GAP_MS.
function combineNavJourneys(explicit, derived) {
  const ex = explicit || [];
  const kept = (derived || []).filter((d) => {
    const ds = Date.parse(d.startedAt);
    const de = Date.parse(d.endedAt);
    return !ex.some((x) => x.uid === d.uid
      && ds <= Date.parse(x.endedAt) + NAV_GAP_MS && de >= Date.parse(x.startedAt));
  });
  return [...ex, ...kept].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
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
  const arriveMinutes = [];
  for (const j of list) {
    totalDistanceWalkedM += j.distanceWalkedM || 0;
    if (j.arrived) {
      completed++;
      const minutes = (Date.parse(j.arrivedAt) - Date.parse(j.startedAt)) / 60000;
      timeBuckets[navTimeBucket(minutes)]++;
      if (Number.isFinite(minutes)) arriveMinutes.push(minutes);
    } else if (Number.isFinite(j.remainingM)) {
      remaining.push(j.remainingM);
    }
  }
  const median = (values) => {
    values.sort((a, b) => a - b);
    const mid = values.length >> 1;
    return !values.length ? null : values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  };
  const medianRemainingM = median(remaining);
  // Detour ratio: metres walked per metre of the shortest route at the start (completed explicit journeys only; an abandoned walk is not comparable to the full route).
  const ratios = list.filter((j) => j.arrived === true && Number.isFinite(j.routeM) && j.routeM > 0 && Number.isFinite(j.walkedM))
    .map((j) => j.walkedM / j.routeM);
  return {
    started: list.length,
    completed,
    completionRate: list.length ? completed / list.length : null,
    timeBuckets,
    totalDistanceWalkedM,
    abandoned: list.length - completed,
    medianRemainingM,
    medianArriveMinutes: median(arriveMinutes),
    medianDetourRatio: median(ratios),
    detourCount: ratios.length,
  };
}

// Daily trend rows: journeys grouped by the local calendar day of their start, oldest day first.
// Only days that have journeys appear. Each row reuses summariseNavJourneys for its figures.
function groupJourneysByDay(journeys) {
  const byDay = new Map();
  for (const j of journeys || []) {
    const t = Date.parse(j && j.startedAt);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    const day = `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(j);
  }
  return [...byDay.keys()].sort().map((day) => {
    const s = summariseNavJourneys(byDay.get(day));
    return {
      day, started: s.started, completed: s.completed, completionRate: s.completionRate,
      timeBuckets: s.timeBuckets, medianDetourRatio: s.medianDetourRatio, detourCount: s.detourCount,
    };
  });
}

// Daily activity rows for the Stats page: distinct users, location pings and taps per local calendar day, oldest first.
// Unlike the journey rows, every day between the first and last active day is present (zeros included) so a trend reads
// as a trend. Events without a readable time are ignored; a user counts once a day however much they did.
function groupActivityByDay(locations, clicks) {
  const dayKey = (d) => `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const byDay = new Map();
  const slot = (event) => {
    const t = Date.parse(event && event.ts);
    if (!Number.isFinite(t)) return null;
    const day = dayKey(new Date(t));
    if (!byDay.has(day)) byDay.set(day, { uids: new Set(), pings: 0, taps: 0 });
    const entry = byDay.get(day);
    if (event.uid != null) entry.uids.add(event.uid);
    return entry;
  };
  for (const e of locations || []) { const entry = slot(e); if (entry) entry.pings++; }
  for (const e of clicks || []) { const entry = slot(e); if (entry) entry.taps++; }
  if (!byDay.size) return [];
  const days = [...byDay.keys()].sort();
  const [y0, m0, d0] = days[0].split("-").map(Number);
  const last = days[days.length - 1];
  const rows = [];
  for (let i = 0; i < 4000; i++) {
    const day = dayKey(new Date(y0, m0 - 1, d0 + i));
    const entry = byDay.get(day);
    rows.push({ day, users: entry ? entry.uids.size : 0, pings: entry ? entry.pings : 0, taps: entry ? entry.taps : 0 });
    if (day >= last) break;
  }
  return rows;
}

// Top destinations over the last `days` days counted back from `now` (ms): journeys are grouped by
// destination (navId, else the target coordinates rounded to 5 dp). Sorted by started, then completed,
// then name; `share` is started relative to the top destination (for a bar). The name comes from the
// journey's target (explicit navName, or the ping's navTarget name).
function topDestinationsThisWeek(journeys, { now, days = 7, limit = 5 } = {}) {
  const since = now - days * 24 * 60 * 60 * 1000;
  const groups = new Map();
  for (const j of journeys || []) {
    const t = Date.parse(j && j.startedAt);
    if (!Number.isFinite(t) || t < since || !j.target) continue;
    const tg = j.target;
    const key = tg.id != null ? `id:${tg.id}` : `at:${Number(tg.targetLat).toFixed(5)},${Number(tg.targetLng).toFixed(5)}`;
    if (!groups.has(key)) groups.set(key, { key, name: null, list: [] });
    const g = groups.get(key);
    if (!g.name && tg.name) g.name = String(tg.name);
    g.list.push(j);
  }
  const rows = [...groups.values()].map((g) => {
    const s = summariseNavJourneys(g.list);
    return {
      key: g.key, name: g.name || "Unnamed place", started: s.started, completed: s.completed,
      completionRate: s.completionRate, medianMinutesToArrive: s.medianArriveMinutes, share: 0,
    };
  });
  rows.sort((a, b) => b.started - a.started || b.completed - a.completed || a.name.localeCompare(b.name));
  const top = rows.slice(0, limit);
  for (const r of top) r.share = r.started / top[0].started;
  return top;
}

if (typeof module !== "undefined") {
  module.exports = {
    NAV_ARRIVAL_RADIUS_M, NAV_GAP_MS, haversineMetres, deriveNavJourneys, buildExplicitJourneys, combineNavJourneys, summariseNavJourneys, navTimeBucket, groupJourneysByDay, groupActivityByDay, topDestinationsThisWeek,
  };
}
