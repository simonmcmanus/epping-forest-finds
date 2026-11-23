// Pure helpers for the admin dashboard (map gestures, track hit-testing and summaries, beta filter, window labels).
// No DOM, state or app globals: works as a classic <script> (window.AdminTools) and via require().
(function (root) {
  const GAP_MS = 3 * 60 * 1000; // same 3-minute rule as the navigation journeys

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Two-finger pinch. The map's screen position is  s = c + pan + zoom * (q - c)  (c = canvas centre, q = the world point's
  // position at zoom 1 and no pan), so keeping the world point that started under the first midpoint under the current midpoint gives
  //   pan' = mid1 - c - zoom1 * (mid0 - c - pan0) / zoom0.
  // start: { zoom, panX, panY, mid:{x,y}, dist }  now: { mid:{x,y}, dist }  size: { width, height }  limits: { min, max }
  function pinchViewport(start, now, size, limits) {
    const startDist = Math.max(start.dist, 1);
    const zoom = clampNumber(start.zoom * (Math.max(now.dist, 1) / startDist), limits.min, limits.max);
    const cx = size.width / 2;
    const cy = size.height / 2;
    const ratio = zoom / start.zoom;
    return {
      zoom,
      panX: now.mid.x - cx - ratio * (start.mid.x - cx - start.panX),
      panY: now.mid.y - cy - ratio * (start.mid.y - cy - start.panY),
    };
  }

  function pointSegmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : clampNumber(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // tracks: [{ uid, points: [{x, y}, ...] }] in canvas pixels. Returns the closest track within tolerance, or null.
  function nearestTrackAt(tracks, x, y, tolerance) {
    let best = null;
    for (const track of tracks) {
      const pts = track.points;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[i + 1] || a;
        const distance = pointSegmentDistance(x, y, a.x, a.y, b.x, b.y);
        if (distance <= tolerance && (!best || distance < best.distance)) best = { uid: track.uid, distance };
      }
    }
    return best;
  }

  function metres(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
      + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // events: one user's location pings ({ts, lat, lng}). Sorted by time; pings without a readable time or position are ignored.
  // distanceM is the sum of straight-line hops, skipping any hop more than 3 minutes long (a gap, not a walk).
  function summariseTrack(events) {
    const pings = (events || [])
      .filter((e) => e && e.lat != null && e.lng != null)
      .map((e) => ({ t: Date.parse(e.ts), lat: Number(e.lat), lng: Number(e.lng) }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .sort((a, b) => a.t - b.t);
    if (!pings.length) return null;
    let distanceM = 0;
    for (let i = 1; i < pings.length; i += 1) {
      if (pings[i].t - pings[i - 1].t > GAP_MS) continue;
      distanceM += metres(pings[i - 1].lat, pings[i - 1].lng, pings[i].lat, pings[i].lng);
    }
    const first = pings[0];
    const last = pings[pings.length - 1];
    return {
      count: pings.length,
      start: { t: first.t, lat: first.lat, lng: first.lng },
      stop: { t: last.t, lat: last.lat, lng: last.lng },
      durationMs: last.t - first.t,
      distanceM,
    };
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    if (total < 60) return `${total} s`;
    const minutes = Math.round(total / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `${hours} h ${minutes % 60} min`;
  }

  function formatDistance(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
  }

  // Time frame choices: value is the `days` query value; 24 hours is one day.
  const WINDOW_OPTIONS = [
    { value: "1", label: "24 hours" },
    { value: "7", label: "7 days" },
    { value: "30", label: "30 days" },
    { value: "90", label: "90 days" },
    { value: "all", label: "All" },
  ];
  const DEFAULT_WINDOW = "30";

  function normaliseWindow(value) {
    const text = String(value == null ? "" : value).trim().toLowerCase();
    return WINDOW_OPTIONS.some((o) => o.value === text) ? text : DEFAULT_WINDOW;
  }

  // "the last 7 days", "the last 24 hours", "all loaded history"
  function windowPhrase(days) {
    if (!Number.isFinite(days)) return "all loaded history";
    return days === 1 ? "the last 24 hours" : `the last ${days} days`;
  }

  // Short form for the Stats card: "24 hours", "30 days".
  function windowShort(days) {
    if (!Number.isFinite(days)) return "All history";
    return days === 1 ? "24 hours" : `${days} days`;
  }

  // Windows to try, in order: the one asked for, then the 7 and 1 day fallbacks that are shorter than it.
  function windowAttempts(requested) {
    const asked = normaliseWindow(requested);
    const attempts = [asked];
    for (const fallback of ["7", "1"]) {
      if (asked === "all" || Number(asked) > Number(fallback)) attempts.push(fallback);
    }
    return attempts;
  }

  // Beta filter: keep events the server marked beta (event.beta === true).
  function onlyBeta(events) {
    return (events || []).filter((e) => e && e.beta === true);
  }

  const api = { pinchViewport, pointSegmentDistance, nearestTrackAt, summariseTrack, formatDuration, formatDistance, WINDOW_OPTIONS, DEFAULT_WINDOW, normaliseWindow, windowPhrase, windowShort, windowAttempts, onlyBeta };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AdminTools = api;
})(typeof window !== "undefined" ? window : globalThis);
