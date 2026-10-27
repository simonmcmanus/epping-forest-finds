// User analytics & location tracking module.
// Consent must be given (see setTrackingConsent) before any data is sent.

const TRACKER_UID_KEY = "ff-uid";
const TRACKER_CONSENT_KEY = "ff-track-v1";
const TRACKER_QUEUE_KEY = "ff-track-queue";
const TRACK_URL = "/api/track";

// --- User identity ---

function trackerGetOrCreateUserId() {
  try {
    let uid = localStorage.getItem(TRACKER_UID_KEY);
    if (!uid) {
      uid = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
      localStorage.setItem(TRACKER_UID_KEY, uid);
    }
    return uid;
  } catch {
    return "anon";
  }
}

// --- Consent ---

function hasTrackingConsent() {
  try {
    return localStorage.getItem(TRACKER_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

// Consent is implicit: tapping whichever "Enable location" button is on screen (the
// location gate or the onboarding location step) both grants consent and starts the
// location request — see the shared .privacy-note text next to each of those buttons.
function ensureTrackingConsent() {
  setTrackingConsent(true);
  return true;
}

function setTrackingConsent(value) {
  try {
    if (value) {
      localStorage.setItem(TRACKER_CONSENT_KEY, "1");
    } else {
      localStorage.removeItem(TRACKER_CONSENT_KEY);
    }
  } catch {}
}

// --- Offline queue and batching ---
//
// Events wait in the queue and go up together rather than one request each: once enough have
// built up, every few minutes, and whenever the page is hidden or closed. One request per event
// meant a request and a stored blob a minute for every walker (see spec-admin.md "Storage").

const TRACKER_QUEUE_MAX = 500;
const TRACKER_FLUSH_AT = 20;
const TRACKER_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
// A keepalive request (the one that survives the page closing) may carry at most 64 KB; 150 events
// is about 40 KB.
const TRACKER_MAX_BATCH = 150;

function trackerReadQueue() {
  try {
    const queue = JSON.parse(localStorage.getItem(TRACKER_QUEUE_KEY) || "[]");
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

function trackerWriteQueue(queue) {
  try {
    const kept = queue.length > TRACKER_QUEUE_MAX ? queue.slice(queue.length - TRACKER_QUEUE_MAX) : queue;
    if (kept.length) localStorage.setItem(TRACKER_QUEUE_KEY, JSON.stringify(kept));
    else localStorage.removeItem(TRACKER_QUEUE_KEY);
  } catch {}
}

function trackerEnqueueEvent(event) {
  const queue = trackerReadQueue();
  queue.push(event);
  trackerWriteQueue(queue);
  return queue.length;
}

let _trackerFlushing = false;
let _trackerFlushPending = false;

// Sends the queue in batches of TRACKER_MAX_BATCH. A batch leaves the queue before its request goes
// out, so events added meanwhile are kept; a failed batch goes back to the front. A refusal that
// can never succeed (400, 413) drops the batch rather than retrying it forever.
async function trackerFlushQueue() {
  if (!navigator.onLine) return;
  if (_trackerFlushing) {
    _trackerFlushPending = true;
    return;
  }
  _trackerFlushing = true;
  _trackerFlushPending = false;

  for (;;) {
    const queue = trackerReadQueue();
    if (!queue.length) break;
    const batch = queue.slice(0, TRACKER_MAX_BATCH);
    trackerWriteQueue(queue.slice(TRACKER_MAX_BATCH));
    let retry = false;
    try {
      const resp = await fetch(TRACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
      retry = !resp.ok && (resp.status >= 500 || resp.status === 408 || resp.status === 429);
    } catch {
      retry = true;
    }
    if (retry) {
      trackerWriteQueue([...batch, ...trackerReadQueue()]);
      break;
    }
  }

  _trackerFlushing = false;
  if (_trackerFlushPending) {
    _trackerFlushPending = false;
    setTimeout(trackerFlushQueue, 0);
  }
}

function trackerSendEvent(event) {
  if (!hasTrackingConsent()) return;
  const queued = trackerEnqueueEvent(event);
  if (queued >= TRACKER_FLUSH_AT && navigator.onLine) trackerFlushQueue();
}

// --- Nav target (resolved from state.selected at event time) ---

function _getNavTarget() {
  if (typeof state === "undefined" || !state.selected?.item) return null;
  const item = state.selected.item;
  const target = trackerItemLatLng(item);
  return {
    id: trackerItemId(item),
    name: trackerItemName(item),
    type: state.selected.type || null,
    targetLat: target ? target.lat : null,
    targetLng: target ? target.lng : null,
  };
}

// --- Location tracking ---

let _trackerInterval = null;

function trackLocation(lat, lng, heading) {
  trackerSendEvent({
    type: "location",
    uid: trackerGetOrCreateUserId(),
    ts: new Date().toISOString(),
    lat,
    lng,
    heading: Number.isFinite(heading) ? Math.round(heading) : null,
    navTarget: _getNavTarget(),
  });
}

// Analytics record where the walker actually was, not where the camera was told to look.
// state.userLocation is smoothed and glided for the camera's benefit (ingestLocationFix in
// js/app.js); state.rawUserLocation is the fix the browser delivered. They differ by only a
// couple of metres, but a heat-map of real visits should be built from the real readings.
function trackedLocation() {
  if (typeof state === "undefined") return null;
  return state.rawUserLocation || state.userLocation || null;
}

function startLocationTracking() {
  if (_trackerInterval) return;
  const initial = trackedLocation();
  if (initial) {
    trackLocation(initial.latitude, initial.longitude,
      typeof state !== "undefined" ? state.compassHeading : null);
  }
  _trackerInterval = setInterval(() => {
    const current = trackedLocation();
    if (current) {
      trackLocation(current.latitude, current.longitude, state.compassHeading);
    }
  }, 60_000);
}

function stopLocationTracking() {
  clearInterval(_trackerInterval);
  _trackerInterval = null;
}

// --- Click / selection tracking ---

function trackerFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function trackerGeojsonLatLng(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  const points = [];

  function collect(value) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      points.push({ lng: value[0], lat: value[1] });
      return;
    }
    value.forEach(collect);
  }

  collect(geometry.coordinates);
  if (!points.length) return null;
  const totals = points.reduce((sum, point) => ({
    lat: sum.lat + point.lat,
    lng: sum.lng + point.lng,
  }), { lat: 0, lng: 0 });
  return {
    lat: totals.lat / points.length,
    lng: totals.lng / points.length,
  };
}

function trackerPointLatLng(point) {
  if (!point || typeof unprojectPoint !== "function") return null;
  const x = trackerFiniteNumber(point.x);
  const y = trackerFiniteNumber(point.y);
  if (x == null || y == null) return null;
  const lonLat = unprojectPoint({ x, y });
  const lat = trackerFiniteNumber(lonLat && lonLat.latitude);
  const lng = trackerFiniteNumber(lonLat && lonLat.longitude);
  return lat == null || lng == null ? null : { lat, lng };
}

function trackerItemLatLng(item) {
  if (!item || typeof item !== "object") return null;

  const directLat = trackerFiniteNumber(item.latitude ?? item.lat);
  const directLng = trackerFiniteNumber(item.longitude ?? item.lng ?? item.lon);
  if (directLat != null && directLng != null) return { lat: directLat, lng: directLng };

  const pointLatLng = trackerPointLatLng(item.point);
  if (pointLatLng) return pointLatLng;

  if (item.bbox) {
    const minX = trackerFiniteNumber(item.bbox.minX);
    const maxX = trackerFiniteNumber(item.bbox.maxX);
    const minY = trackerFiniteNumber(item.bbox.minY);
    const maxY = trackerFiniteNumber(item.bbox.maxY);
    if (minX != null && maxX != null && minY != null && maxY != null) {
      const bboxLatLng = trackerPointLatLng({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
      if (bboxLatLng) return bboxLatLng;
    }
  }

  return trackerGeojsonLatLng(item.geometry || item.feature?.geometry);
}

function trackerItemId(item) {
  return item?.tagNumber || item?.id || item?.osmId || item?.key || item?.ref
    || item?.feature?.id || item?.feature?.properties?.id || null;
}

function trackerItemName(item) {
  return item?.commonName || item?.name || item?.feature?.properties?.name || null;
}

function trackClick(itemType, item, userLat, userLng, source = "map") {
  const target = trackerItemLatLng(item);
  trackerSendEvent({
    type: "click",
    uid: trackerGetOrCreateUserId(),
    ts: new Date().toISOString(),
    userLat: userLat ?? null,
    userLng: userLng ?? null,
    targetLat: target ? target.lat : null,
    targetLng: target ? target.lng : null,
    itemType,
    itemId: trackerItemId(item),
    itemName: trackerItemName(item),
    source,
  });
}

// --- Google Analytics engagement events ---
//
// Separate from trackClick/trackLocation above: those are the first-party admin-dashboard
// pipeline (/api/track), gated on the location/usage consent toggle in Settings → Privacy. These
// go to Google Analytics instead (via the gtag() loaded in app.html's <head>), gated by the
// site-wide cookie-consent banner (cookie-consent.js) rather than that toggle -- the two consents
// are deliberately independent (see spec.md "User Tracking & Analytics"). Never pass raw
// coordinates here: gtag sends to a third party, and what place or screen someone looked at is
// enough to answer "what are people doing", without exporting their GPS trail off this origin.

function trackGaEvent(name, params) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", name, params);
  }
}

function trackGaScreenView(screenName) {
  trackGaEvent("screen_view", { screen_name: screenName });
}

function trackGaItemSelected(itemType, item, source) {
  // item_type is the broad kind (tree/landmark/path/...); for a landmark that's too coarse to
  // tell a cafe from a viewpoint, so item_category carries the specific filter chip kind
  // (resolvePlaceKind, js/app.js) -- the dimension that actually shows which venues get traffic.
  const category = itemType === "landmark" && typeof resolvePlaceKind === "function"
    ? resolvePlaceKind(item)
    : itemType;
  trackGaEvent("select_map_item", {
    item_type: itemType,
    item_category: category,
    item_id: trackerItemId(item),
    item_name: trackerItemName(item),
    source,
  });
}

// --- Init ---

let _trackerFlushTimer = null;

function initTracker() {
  window.addEventListener("online", trackerFlushQueue);
  // The last chance to send what is queued before the page is frozen or closed.
  window.addEventListener("pagehide", trackerFlushQueue);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") trackerFlushQueue();
  });
  if (!_trackerFlushTimer) _trackerFlushTimer = setInterval(trackerFlushQueue, TRACKER_FLUSH_INTERVAL_MS);
  if (hasTrackingConsent()) trackerFlushQueue();
}
