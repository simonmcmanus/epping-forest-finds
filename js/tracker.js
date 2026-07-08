// User analytics & location tracking module.
// Consent must be given (see showTrackingConsent) before any data is sent.

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

async function ensureTrackingConsent() {
  if (hasTrackingConsent()) return true;
  return showTrackingConsent();
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

// Show the T&C/consent modal. Returns Promise<boolean> — true if accepted.
function showTrackingConsent() {
  return new Promise((resolve) => {
    const modal = document.getElementById("trackingConsentModal");
    if (!modal) { resolve(false); return; }

    modal.hidden = false;
    modal.classList.remove("tc-fading-out");

    const acceptBtn = modal.querySelector(".tc-accept");
    const declineBtn = modal.querySelector(".tc-decline");

    function done(accepted) {
      acceptBtn.removeEventListener("click", onAccept);
      declineBtn.removeEventListener("click", onDecline);
      modal.classList.add("tc-fading-out");
      modal.addEventListener("transitionend", () => {
        modal.hidden = true;
        modal.classList.remove("tc-fading-out");
      }, { once: true });
      resolve(accepted);
    }

    function onAccept() { setTrackingConsent(true); done(true); }
    function onDecline() { done(false); }

    acceptBtn.addEventListener("click", onAccept);
    declineBtn.addEventListener("click", onDecline);
  });
}

// --- Offline queue ---

function trackerEnqueueEvent(event) {
  try {
    const raw = localStorage.getItem(TRACKER_QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    queue.push(event);
    if (queue.length > 500) queue.splice(0, queue.length - 500);
    localStorage.setItem(TRACKER_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

let _trackerFlushing = false;

async function trackerFlushQueue() {
  if (_trackerFlushing || !navigator.onLine) return;
  _trackerFlushing = true;
  let queue;
  try {
    const raw = localStorage.getItem(TRACKER_QUEUE_KEY);
    if (!raw) { _trackerFlushing = false; return; }
    queue = JSON.parse(raw);
    if (!queue || queue.length === 0) { _trackerFlushing = false; return; }
    localStorage.removeItem(TRACKER_QUEUE_KEY);
  } catch {
    _trackerFlushing = false;
    return;
  }

  try {
    const resp = await fetch(TRACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: queue }),
      keepalive: true,
    });
    if (!resp.ok) queue.forEach(trackerEnqueueEvent);
  } catch {
    queue.forEach(trackerEnqueueEvent);
  }
  _trackerFlushing = false;
}

function trackerSendEvent(event) {
  if (!hasTrackingConsent()) return;
  trackerEnqueueEvent(event);
  if (navigator.onLine) trackerFlushQueue();
}

// --- Nav target (resolved from state.selected at event time) ---

function _getNavTarget() {
  if (typeof state === "undefined" || !state.selected?.item) return null;
  const item = state.selected.item;
  return {
    id: item.tagNumber || item.id || item.osmId || null,
    name: item.commonName || item.name || null,
    type: state.selected.type || null,
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

function startLocationTracking() {
  if (_trackerInterval) return;
  if (typeof state !== "undefined" && state.userLocation) {
    trackLocation(state.userLocation.latitude, state.userLocation.longitude,
      typeof state !== "undefined" ? state.compassHeading : null);
  }
  _trackerInterval = setInterval(() => {
    if (typeof state !== "undefined" && state.userLocation) {
      trackLocation(state.userLocation.latitude, state.userLocation.longitude, state.compassHeading);
    }
  }, 60_000);
}

function stopLocationTracking() {
  clearInterval(_trackerInterval);
  _trackerInterval = null;
}

// --- Click / selection tracking ---

function trackClick(itemType, item, userLat, userLng) {
  trackerSendEvent({
    type: "click",
    uid: trackerGetOrCreateUserId(),
    ts: new Date().toISOString(),
    userLat: userLat ?? null,
    userLng: userLng ?? null,
    itemType,
    itemId: item.tagNumber || item.id || item.osmId || null,
    itemName: item.commonName || item.name || null,
  });
}

// --- Init ---

function initTracker() {
  window.addEventListener("online", trackerFlushQueue);
  if (hasTrackingConsent()) trackerFlushQueue();
}
