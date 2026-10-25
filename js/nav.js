// Walking-radius is a continuous minutes value (both the Settings slider and the Nearby
// view's pinch gesture set it directly -- neither snaps to a fixed stop anymore). These
// remaining "steps" are only tick-mark/label suggestions shown on the Settings slider.
const WALKING_RADIUS_PRESET_MINUTES = [1, 2, 5, 10, 15, 20, 30];

// The floor's fallback when there is nothing real to measure against -- not a limit on how far
// in the user can go. A highlighted location closer than a minute's walk lowers the floor all
// the way to WALKING_RADIUS_TIGHT_MIN_MINUTES, so the ring (and the camera fitted to it) keeps
// closing in on it; the map used to stop a minute out however close the thing being walked to
// was, which on a phone meant standing next to a tree looking at a 200 m-wide circle.
const WALKING_RADIUS_MIN_MINUTES = 1;
const WALKING_RADIUS_MAX_MINUTES = 30;

// The tightest radius any origin can reach: ~21 m at the shared 5 km/h assumption. Close enough
// to stand over a single find, far enough that the ring is still a circle with map around it
// rather than a camera buried in one pin.
const WALKING_RADIUS_TIGHT_MIN_MINUTES = 0.25;

// The grid radius values snap to. Half a minute reads as stepless across most of the 1-30 min
// range, but below a minute it is a third of everything left, so sub-minute radii step by a
// quarter minute (15 seconds) instead.
const WALKING_RADIUS_STEP_MINUTES = 0.5;
const WALKING_RADIUS_FINE_STEP_MINUTES = 0.25;

// How far past the single nearest real item (see walkingRadiusFloorMinutes) the floor sits,
// so that item settles clearly inside the drawn ring instead of sitting right on its edge.
const WALKING_RADIUS_FLOOR_BUFFER = 1.15;

// The walking-radius floor, in minutes, below which the Nearby view would show nothing --
// derived from whichever real item (tree/cow/path/landmark, respecting active filters; same
// priority nearestFallbackEntriesForActiveFilter (index.html) uses for the "nothing in radius"
// list fallback) sits closest to origin. Falls back to WALKING_RADIUS_MIN_MINUTES when there's
// no origin yet, or nothing to measure against (e.g. an empty dataset).
//
// A real nearest item is what licenses going below that fallback: the floor tracks it down to
// WALKING_RADIUS_TIGHT_MIN_MINUTES, so a find seconds away can be zoomed right in on, while an
// origin with nothing to measure still can't be squeezed below a minute of empty ground.
function walkingRadiusFloorMinutes(origin) {
  if (!origin) return WALKING_RADIUS_MIN_MINUTES;
  const nearest = nearestFallbackEntriesForActiveFilter(origin.latitude, origin.longitude)[0];
  if (!nearest) return WALKING_RADIUS_MIN_MINUTES;
  const floorMinutes = metresToWalkingMinutes(nearest.metres * WALKING_RADIUS_FLOOR_BUFFER);
  return clamp(floorMinutes, WALKING_RADIUS_TIGHT_MIN_MINUTES, WALKING_RADIUS_MAX_MINUTES);
}

// Inverse of walkingDistanceToMetres (index.html) -- kept in sync with its 5 km/h assumption.
function metresToWalkingMinutes(metres) {
  return metres * 60 / 5000;
}

// The step a given radius snaps to (see the constants above).
function walkingMinutesStep(minutes) {
  return minutes < 1 ? WALKING_RADIUS_FINE_STEP_MINUTES : WALKING_RADIUS_STEP_MINUTES;
}

// Rounds a continuous walking-radius value onto that grid: fine enough to feel stepless while
// dragging the Settings slider (a native `<input type="range">`, which needs a `step`), coarse
// enough to avoid floating-point noise in the overview cache key (see
// overviewItemsForActiveFilter, index.html). The pinch/wheel gesture applies its raw value
// directly instead (see applyWalkingRadiusGesture) so the ring itself is never snapped to this
// grid.
function roundWalkingMinutes(minutes) {
  const step = walkingMinutesStep(minutes);
  return Math.round(minutes / step) * step;
}

// Same grid, rounded up. Used wherever a value has to stay at or above a floor after snapping --
// the Settings slider's min attribute, and the automatic grow-back below -- since rounding to
// nearest could otherwise land just under the floor it was derived from. The epsilon keeps a
// value already exactly on the grid from being pushed up a whole step by binary rounding noise.
function ceilWalkingMinutes(minutes) {
  const step = walkingMinutesStep(minutes);
  return Math.ceil(minutes / step - 1e-9) * step;
}

// The effective centre for everything the Nearby view shows (walking-radius circle, nearest-
// item list, overview camera fit): state.nearbyAnchor when the user has tapped outside the
// radius to browse another spot, otherwise the real GPS fix. Deliberately NOT used by the
// "You" dot, the compass, or real navigation-to-a-selection -- those always reflect where the
// user actually is.
function nearbyOrigin() {
  return state.nearbyAnchor || state.userLocation;
}

// A real GPS fix never holds perfectly still -- even standing on one spot, especially under
// forest canopy, consecutive fixes wander by a few metres. overviewItemsForActiveFilter caches
// on the origin's raw coordinates and re-sorts/re-samples its candidate lists (sampleSpread's
// tree cap in particular) whenever they change, so every such wobble could swap which items
// landed in a capped sample -- visible as map pins jumping while the phone sat still. This holds
// the origin used for that candidate selection fixed until the live fix has moved further than a
// real, deliberate distance away from it, so imperceptible GPS noise no longer reaches the
// pin/list selection at all.
let _stableNearbyOrigin = null;
const STABLE_NEARBY_ORIGIN_HYSTERESIS_METRES = 15;

function stableNearbyOrigin() {
  const origin = nearbyOrigin();
  if (!origin) {
    _stableNearbyOrigin = null;
    return null;
  }
  if (origin === _stableNearbyOrigin) return _stableNearbyOrigin;
  if (!_stableNearbyOrigin
      || distanceMetres(_stableNearbyOrigin.latitude, _stableNearbyOrigin.longitude, origin.latitude, origin.longitude) > STABLE_NEARBY_ORIGIN_HYSTERESIS_METRES) {
    _stableNearbyOrigin = origin;
  }
  return _stableNearbyOrigin;
}

// Search, Filter, Settings, and Report screens all show the map in the background and must
// present the same fixed "zoomed out to show all highlighted locations" view (see
// nearbyCameraFitPoints/ensureOverviewTargetsVisible in index.html and
// drawWalkingRadius/buildNearbyIconLookup in renderer.js).
function secondaryScreenActive() {
  return Boolean(
    state.filterScreenOpen
    || state.searchScreenOpen
    || state.selected?.type === "settings"
    || state.selected?.type === "report"
    || state.selected?.type === "community"
  );
}

const INSPECTOR_NAVIGATION_ARRIVAL_METRES = 15;

function updateInspectorNavigationHeight() {
  if (!els.inspector) return;
  const target = typeof selectedCompassTarget === "function" ? selectedCompassTarget() : null;
  const navigating = Boolean(target);
  const metres = navigating && state.userLocation && typeof distanceFromUser === "function"
    ? distanceFromUser(target)
    : null;
  const arrived = navigating && Number.isFinite(metres) && metres <= INSPECTOR_NAVIGATION_ARRIVAL_METRES;
  els.inspector.classList.toggle("inspector-navigation", navigating);
  els.inspector.classList.toggle("inspector-navigation-arrived", arrived);
}

// state.selected is truthy for the Settings/Report pseudo-selections (type "settings"/
// "report") as well as for a real tree/landmark/etc selection, but overview-only rendering
// (the walking-radius ring, the browse-anchor marker and its cone, the off-ring user pointer)
// should stay visible for the pseudo-selections exactly as it does for plain overview/Filters
// -- only a real selection should hide it. Shared by every such renderer.js draw so they can't
// drift out of sync with each other again (they did: the old ambient route lines used to check
// `state.selected` directly and hid themselves on Settings/Report).
function hasRealSelection() {
  return Boolean(state.selected && !["settings", "report", "community"].includes(state.selected.type));
}

function refreshSettingsVersionDisplay() {
  // The background data sync (syncData in sw.js) caches newer map data without disturbing the
  // running session, so the only thing left to tell the user is that a reload will show it.
  const dataNote = document.getElementById("dataUpdateNote");
  if (dataNote) dataNote.hidden = !state.dataUpdateAvailable;

  const el = document.getElementById("appVersionDisplay");
  if (!el) return;
  if (state.swVersion) el.textContent = state.swVersion;
  if (state.swUpdateAvailable) {
    el.classList.add("sw-update-available");
    if (!el.dataset.updateBound) {
      el.dataset.updateBound = "1";
      el.addEventListener("click", applySwUpdate);
    }
  }
}

function _markSwUpdateAvailable(waiting) {
  if (waiting) state.swWaiting = waiting;
  state.swUpdateAvailable = true;
  if (els.settingsToggle) els.settingsToggle.classList.add("has-update");
  refreshSettingsVersionDisplay();
  showUpdateBanner();
}

// One "update ready" prompt for everything that needs a reload: a downloaded app worker (which
// already carries its own data shell) and/or newer map data. It is only ever shown once the
// download has finished, so a single tap restarts into the complete new version. Community
// findings are applied to the open map live (COMMUNITY_UPDATED) and never need this.
function showUpdateBanner() {
  if (document.getElementById("updateBanner")) return;
  const banner = document.createElement("div");
  banner.id = "updateBanner";
  banner.className = "update-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = '<span class="update-banner-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg></span>'
    + '<span class="update-banner-text"><strong>Update ready</strong><span>Restart to load the latest fixes and map data. It only takes a moment.</span></span>'
    + '<button id="updateBannerButton" type="button">Restart</button>';
  document.body.appendChild(banner);
  banner.querySelector("button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Restarting…";
    const started = (state.swWaiting || state.swUpdateAvailable) ? await applySwUpdate() : (location.reload(), true);
    if (!started) {
      button.disabled = false;
      button.textContent = "Restart";
    }
  });
}

// Before announcing a waiting worker, let it finish its own data sync so the one restart brings
// the app and the map data together instead of a second "reload for new data" prompt after it.
// A failed or timed-out sync still announces the update: the worker's shell is complete either way.
async function prepareWaitingUpdate(waiting) {
  // Recorded up front: the worker's own sync broadcasts DATA_UPDATED, which must not show the
  // banner (or send a tap down the plain-reload path) until this worker is ready to activate.
  state.swWaiting = waiting;
  await requestDataRefresh({ target: waiting, force: false });
  _markSwUpdateAvailable(waiting);
}

async function applySwUpdate() {
  if (state.swWaiting) {
    state.swPendingReload = true;
    try {
      state.swWaiting.postMessage({ type: "SKIP_WAITING" });
    } catch {
      state.swPendingReload = false;
      return;
    }
    // controllerchange normally reloads the page. Keep a long safety net for browsers that do
    // not deliver controllerchange after a worker has already finished installing; this path is
    // only reachable after the complete replacement worker was downloaded.
    setTimeout(() => location.reload(), 10000);
    return true;
  }

  // The update marker can arrive through controllerchange without carrying the waiting
  // registration on some browsers. Never turn that marker into an unconditional reload:
  // downloadAppUpdate() must first produce a fully installed worker, otherwise an offline
  // refresh could strand the current page without a replacement shell.
  const waiting = await downloadAppUpdate();
  if (!waiting) {
    setRefreshStatus("No complete app update is ready. Your current offline app is still safe.", { error: true });
    return false;
  }
  return activateDownloadedAppUpdate(waiting);
}

// The three Settings refresh buttons, keyed by the part of the offline release they check.
// Refreshes keep the current cache until the replacement has been downloaded successfully.
const REFRESH_SCOPES = {
  data: { buttonId: "refreshDataButton" },
  app: { buttonId: "refreshAppButton" },
  all: { buttonId: "refreshAllButton" },
};

// The worker throttles actual network work to six hours, so this inexpensive foreground check
// can run often enough to retry a dropped connection and to notice a connection returning while
// the app is still open. It never runs while the document is hidden.
const BACKGROUND_DATA_SYNC_CHECK_INTERVAL_MS = 15 * 60 * 1000;
let backgroundDataSyncListenersBound = false;

function refreshScopeButtons() {
  return Object.keys(REFRESH_SCOPES)
    .map((scope) => document.getElementById(REFRESH_SCOPES[scope].buttonId))
    .filter(Boolean);
}

// Keeps the Settings refresh buttons (and their shared offline note) in sync with
// connectivity, both on first render and whenever the browser's online/offline
// events fire while Settings happens to be open.
function updateRefreshButtonsOnlineState() {
  const buttons = refreshScopeButtons();
  if (buttons.length === 0) return; // Settings screen isn't currently open
  const note = document.getElementById("refreshOfflineNote");
  const online = navigator.onLine;
  buttons.forEach((button) => {
    button.disabled = !online;
  });
  if (note) note.hidden = online;
}

function setRefreshStatus(message, { error = false } = {}) {
  const status = document.getElementById("refreshStatus");
  if (!status) return;
  status.textContent = message || "";
  status.hidden = !message;
  status.classList.toggle("error", Boolean(error));
}

function waitForInstallingWorker(registration, installing) {
  return new Promise((resolve) => {
    let timer = setTimeout(() => {
      installing.removeEventListener("statechange", onStateChange);
      resolve(null);
    }, 30000);

    function onStateChange() {
      if (installing.state === "installed") {
        clearTimeout(timer);
        installing.removeEventListener("statechange", onStateChange);
        resolve(registration.waiting || installing);
      } else if (installing.state === "redundant") {
        clearTimeout(timer);
        installing.removeEventListener("statechange", onStateChange);
        resolve(null);
      }
    }

    installing.addEventListener("statechange", onStateChange);
    onStateChange();
  });
}

// Checks for an app update without touching the current cache. A refresh is allowed to activate
// an app worker only after registration.update() has produced a fully installed waiting worker;
// an offline/failed check simply leaves the current app in place.
async function downloadAppUpdate() {
  if (!("serviceWorker" in navigator)) return null;
  let registration;
  try {
    // `ready` never resolves for a first install whose worker is still waiting. Refreshing an
    // old troubleshooting URL must not hang boot in that state, so inspect the registration
    // directly and treat an absent one as "no downloaded update".
    registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return null;
    if (!registration.waiting) await registration.update();
  } catch {
    return null;
  }

  if (registration.waiting) return registration.waiting;
  if (registration.installing) return waitForInstallingWorker(registration, registration.installing);
  return null;
}

function activateDownloadedAppUpdate(waiting) {
  if (!waiting) return false;
  state.swWaiting = waiting;
  state.swPendingReload = true;
  try {
    waiting.postMessage({ type: "SKIP_WAITING" });
    return true;
  } catch {
    state.swWaiting = null;
    state.swPendingReload = false;
    return false;
  }
}

function requestDataRefresh({ target = null, force = true } = {}) {
  if (!("serviceWorker" in navigator)) return Promise.resolve(false);
  const controller = target || navigator.serviceWorker.controller;
  if (!controller) return Promise.resolve(false);

  const requestId = `refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    // A complete repair includes the large road/building files and every tree chunk. Give a
    // healthy but mobile connection enough time, while still returning control if it disappears.
    let timer;
    const finish = (ok) => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve(ok);
    };
    const onMessage = (event) => {
      if (event.data?.type !== "DATA_SYNC_COMPLETE" || event.data.requestId !== requestId) return;
      finish(event.data.ok === true);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    timer = setTimeout(() => finish(false), 120000);
    try {
      controller.postMessage({ type: "SYNC_DATA", force, requestId });
    } catch {
      finish(false);
    }
  });
}

// Unregisters the service worker and deletes the app cache (plus the data cache for "Refresh both"),
// so the reload that follows fetches a fresh shell from the network.
async function clearCachedApp(includeData) {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => /^forest-finds-(dev-)?app-/.test(name) || (includeData && name.startsWith("forest-finds-")))
      .map((name) => caches.delete(name)));
  }
}

// "Refresh data" downloads into the existing cache, then reloads. "Refresh app" and "Refresh both"
// clear the cached app (and, for both, the data after a complete data download) and then reload,
// so the page always restarts on a fresh copy.
async function refreshCachedState(scope) {
  if (!navigator.onLine) {
    updateRefreshButtonsOnlineState();
    return false;
  }

  const active = REFRESH_SCOPES[scope] && document.getElementById(REFRESH_SCOPES[scope].buttonId);
  refreshScopeButtons().forEach((button) => {
    button.disabled = true;
  });
  if (active) active.textContent = "Refreshing…";
  setRefreshStatus("");

  try {
    if (scope === "data" || scope === "all") {
      const dataReady = await requestDataRefresh();
      if (!dataReady) {
        setRefreshStatus("The latest data could not be downloaded. Your current offline map is still safe.", { error: true });
        return false;
      }
      if (scope === "data") {
        location.reload();
        return true;
      }
    }

    setRefreshStatus("Clearing the cache and restarting…");
    await clearCachedApp(scope === "all");
    location.reload();
    return true;
  } catch (error) {
    console.error(error);
    setRefreshStatus("Refresh failed; your current offline map is still safe.", { error: true });
    return false;
  } finally {
    refreshScopeButtons().forEach((button) => {
      button.disabled = false;
    });
    if (active && active.isConnected) active.textContent = scope === "data" ? "Refresh data" : scope === "app" ? "Refresh app" : "Refresh both";
    updateRefreshButtonsOnlineState();
  }
}

// Asks the active service worker to revalidate the cached map data out of band (syncData in
// sw.js). Called only while the map is visible and interactive, so freshness passes never compete
// with the render — the load itself is served entirely from cache, and any genuinely changed file
// lands quietly afterwards. The worker throttles this internally, so foreground checks are cheap.
function requestBackgroundDataSync(options) {
  if (!("serviceWorker" in navigator)) return;
  if (!navigator.onLine) return;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return; // First load — nothing cached yet to refresh
  try {
    controller.postMessage({ type: "SYNC_DATA", force: Boolean(options && options.force) });
  } catch {}
}

// Browsers only look for a new sw.js on navigation (and at most daily), which an installed app that
// is resumed rather than reopened rarely does. Ask explicitly, throttled, whenever the app is
// visible; the check is one conditional request for sw.js and its two version files.
const APP_UPDATE_CHECK_MIN_INTERVAL_MS = 10 * 60 * 1000;
let swRegistration = null;
let lastAppUpdateCheckAt = 0;

function requestAppUpdateCheck() {
  if (!swRegistration || state.swUpdateAvailable || !navigator.onLine) return;
  if (Date.now() - lastAppUpdateCheckAt < APP_UPDATE_CHECK_MIN_INTERVAL_MS) return;
  lastAppUpdateCheckAt = Date.now();
  swRegistration.update().catch(() => {});
}

function setupBackgroundDataSync() {
  if (backgroundDataSyncListenersBound) return;
  backgroundDataSyncListenersBound = true;
  const syncWhenVisible = () => {
    if (document.visibilityState === "hidden") return;
    requestBackgroundDataSync();
    requestAppUpdateCheck();
  };
  document.addEventListener("visibilitychange", syncWhenVisible);
  window.addEventListener("online", syncWhenVisible);
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("controllerchange", syncWhenVisible);
  setInterval(syncWhenVisible, BACKGROUND_DATA_SYNC_CHECK_INTERVAL_MS);
  syncWhenVisible();
}

// The background sync found newer map data and has already cached it; it only becomes visible
// on the next load, so flag it the same way a pending app update is flagged.
function _markDataUpdateAvailable() {
  state.dataUpdateAvailable = true;
  if (els.settingsToggle) els.settingsToggle.classList.add("has-update");
  refreshSettingsVersionDisplay();
  if (!state.swWaiting || state.swUpdateAvailable) showUpdateBanner();
}

// Reads the app/data cache versions out of caches.keys() for the About screen and for bug
// reports (appVersion in index.html).
//
// The local dev server rewrites APP_CACHE_NAME to "forest-finds-dev-app-vN" (injectDevFlag in
// server.js) so local/tunnelled builds are identifiable. Matching only the production spelling
// meant appVer came back "" on every dev build, and the paired "app: X, data: Y" label then
// collapsed to the bare data version -- which reads as a wrong, stale app version (e.g. a lone
// "v3") rather than as a missing one. Match both spellings, and keep the "dev-" marker in the
// label so it stays obvious which build is being looked at.
function cacheVersionLabel(keys) {
  const nameFor = (kind) => (keys || []).find((key) => (
    key.startsWith(`forest-finds-${kind}-`) || key.startsWith(`forest-finds-dev-${kind}-`)
  )) || "";
  const versionFor = (kind) => {
    const name = nameFor(kind);
    return name ? name.replace("forest-finds-", "").replace(`${kind}-`, "") : "";
  };
  const appVer = versionFor("app");
  const dataVer = versionFor("data");
  return {
    appVer,
    dataVer,
    versionString: appVer && dataVer
      ? `app: ${appVer}, data: ${dataVer}`
      : appVer || dataVer || "",
  };
}

function setupPwa() {
  if ("serviceWorker" in navigator) {
    let _firstChange = !navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "DATA_UPDATED") _markDataUpdateAvailable();
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (_firstChange) { _firstChange = false; return; }
      if (state.swPendingReload) { location.reload(); return; }
      _markSwUpdateAvailable(null);
    });

    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => {
        swRegistration = reg;
        if (reg.waiting && navigator.serviceWorker.controller) {
          prepareWaitingUpdate(reg.waiting);
        }
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              prepareWaitingUpdate(installing);
            }
          });
        });
      })
      .catch(console.error);

    navigator.serviceWorker.ready
      .then(() => caches.keys())
      .then(keys => {
        const { appVer, dataVer, versionString } = cacheVersionLabel(keys);
        const swVerEl = document.getElementById("sw-version");
        if (swVerEl) swVerEl.textContent = versionString;
        state.swVersion = versionString;
        state.appCacheVersion = appVer;
        state.dataCacheVersion = dataVer;
        refreshSettingsVersionDisplay();
      })
      .catch(() => {});
  }

  if (els.installButton) {
    els.installButton.hidden = true;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
  });

  if (els.installButton) els.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
  });
}

function setupUiZoomLock() {
  window.addEventListener("wheel", (event) => {
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });

  document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
  document.addEventListener("gesturechange", (event) => event.preventDefault(), { passive: false });
  document.addEventListener("gestureend", (event) => event.preventDefault(), { passive: false });

  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 320) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}

function showFilterHintIfFirstVisit() {
  try {
    if (localStorage.getItem(FILTER_HINT_KEY)) return;
    localStorage.setItem(FILTER_HINT_KEY, "1");
  } catch {}
  setTimeout(() => {
    els.filterToggle.classList.add("filter-toggle-hint");
    els.filterToggle.addEventListener("animationend", () => {
      els.filterToggle.classList.remove("filter-toggle-hint");
    }, { once: true });
  }, 1400);
}

function setupInteractions() {
  setupCompassListeners();
  setupVisibilityRecovery();
  setupResizeHandler();
  setupReportKeyboardAvoidance();
  setupInspectorHandlers();
  setupInspectorDragResize();
  setupFilterPanelHandlers();
  setupSearchAndNavHandlers();
  setupMapCanvasHandlers();
}

// iOS Safari doesn't shrink the layout viewport when the on-screen keyboard opens, so the
// `position: absolute; bottom: 10px` mobile inspector sheet (see css/map-ui.css) stays pinned
// behind the keyboard instead of moving with it. VisualViewport reports the actually-visible
// area, so we use it to shift the sheet above the keyboard. Scoped to the screens with a text
// input that can summon a keyboard: the Report screen and the Search screen (Settings uses a
// <select>, Filter has no text input).
//
// Report and Search only share the shift, not the rest: Report also grows the sheet to (almost)
// fill the space above the keyboard, since the form has nothing else to show and benefits from
// the room. Search does not -- its sheet keeps its normal size so the map stays visible behind
// it, which is also why the nav bar (separate from the sheet, see app.html) is left alone rather
// than made to fight the keyboard for space; it simply goes under the keyboard, the same as any
// bottom tab bar does while a field above it is focused.
const REPORT_KEYBOARD_INSET_MIN_PX = 40; // ignore sub-keyboard-sized viewport jitter (e.g. browser chrome show/hide)

function setupReportKeyboardAvoidance() {
  if (!window.visualViewport) return;
  window.visualViewport.addEventListener("resize", handleReportViewportChange);
  window.visualViewport.addEventListener("scroll", handleReportViewportChange);
}

function handleReportViewportChange() {
  if (!els.inspector) return;
  const isReport = state.selected?.type === "report" || state.selected?.type === "community";
  if (!isReport && !state.searchScreenOpen) {
    clearReportKeyboardInset();
    return;
  }
  const viewport = window.visualViewport;
  const inset = Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop));
  if (inset < REPORT_KEYBOARD_INSET_MIN_PX) {
    clearReportKeyboardInset();
    return;
  }
  els.inspector.style.setProperty("--keyboard-inset", `${inset}px`);
  els.inspector.classList.add("keyboard-avoiding");
  els.inspector.classList.toggle("keyboard-avoiding-expand", isReport);
  // In the cramped landscape bottom-sheet layout, Report's expanded sheet leaves the nav bar
  // nothing to sit in front of -- hidden there the same way it always was; Search never expands,
  // so the nav bar (now its own fixed bar, see app.html) is simply left in place for it, and the
  // keyboard is free to cover it the way any bottom tab bar gets covered while typing.
  if (els.inspectorActions) els.inspectorActions.classList.toggle("keyboard-avoiding-hide", isReport);
  const detailsInput = document.getElementById("reportDetails");
  if (detailsInput && document.activeElement === detailsInput) {
    detailsInput.scrollIntoView({ block: "nearest" });
  }
}

function clearReportKeyboardInset() {
  if (els.inspectorActions) els.inspectorActions.classList.remove("keyboard-avoiding-hide");
  if (!els.inspector || !els.inspector.classList.contains("keyboard-avoiding")) return;
  els.inspector.classList.remove("keyboard-avoiding", "keyboard-avoiding-expand");
  els.inspector.style.removeProperty("--keyboard-inset");
}

function setupResizeHandler() {
  updateFilterUi();
  window.addEventListener("resize", () => {
    updateSubfilterScrollHints();
    resizeCanvas();
    if (state.bounds) {
      if (typeof headingUpActive === "function" && headingUpActive()) {
        alignHeadingUpNavigationViewport();
      } else if (state.userLocation && selectedCompassTarget()) {
        ensureUserAndSelectionVisible({ animate: true, durationMs: 360 });
      } else if (state.userLocation && (isOverviewScreenActive() || secondaryScreenActive())) {
        ensureOverviewTargetsVisible({ animate: false });
      } else {
        fitToBounds(false);
      }
    }
    requestDraw();
  });
}

function setupInspectorHandlers() {
  if (els.closeInspector) {
    els.closeInspector.addEventListener("click", () => {
      setInspectorMinimized(!els.inspector.classList.contains("minimized"));
    });
  }

  // Retraces the trail rather than always jumping to Nearby, so the header arrow, the
  // browser back button and the phone's back gesture all do the same thing (see the Router
  // section in js/app.js). With nothing of this app's own behind the current screen -- a
  // deep link opened in a fresh tab -- it still returns to Nearby rather than leaving.
  els.inspectorBack.addEventListener("click", () => {
    navigateBack();
  });

  els.inspector.addEventListener("click", (event) => {
    if (!els.inspector.classList.contains("minimized")) return;
    if (els.closeInspector && event.target === els.closeInspector) return;
    setInspectorMinimized(false);
  });

  if (els.distanceWarningButton) {
    els.distanceWarningButton.addEventListener("click", () => {
      state.distanceWarningShown = true;
      if (els.distanceWarning._deactivateFocus) {
        els.distanceWarning._deactivateFocus();
        els.distanceWarning._deactivateFocus = null;
      }
      hideWithFade(els.distanceWarning);
    });
  }

  if (els.compassCalibrationBannerDismiss) {
    els.compassCalibrationBannerDismiss.addEventListener("click", () => {
      if (state.compassPermissionPromptVisible) {
        hideCompassPermissionPrompt();
      } else if (typeof dismissCompassCalibrationPrompt === "function") {
        dismissCompassCalibrationPrompt();
      }
    });
  }

  if (els.compassCalibrationBannerEnable) {
    els.compassCalibrationBannerEnable.addEventListener("click", () => {
      if (typeof enableCompassFromGesture === "function") enableCompassFromGesture();
    });
  }

  if (els.eventNearbyBannerOpen) {
    els.eventNearbyBannerOpen.addEventListener("click", () => {
      if (typeof openEventNearbyBanner === "function") openEventNearbyBanner();
    });
  }

  if (els.eventNearbyBannerDismiss) {
    els.eventNearbyBannerDismiss.addEventListener("click", () => {
      if (typeof hideEventNearbyBanner === "function") hideEventNearbyBanner();
    });
  }
}

function pulseNavButton(el) {
  el.classList.remove("nav-reselect");
  void el.offsetWidth;
  el.classList.add("nav-reselect");
  el.addEventListener("animationend", () => el.classList.remove("nav-reselect"), { once: true });
}

function setupFilterPanelHandlers() {
  els.filterToggle.addEventListener("click", () => {
    if (els.filterToggle.classList.contains("screen-active") && !els.inspector.classList.contains("minimized")) {
      pulseNavButton(els.filterToggle);
      return;
    }
    if (els.inspector.classList.contains("minimized")) {
      setInspectorMinimized(false);
    }
    openFiltersScreen();
  });

  if (els.nearbyToggle) {
    els.nearbyToggle.addEventListener("click", (event) => {
      event.preventDefault();
      if (els.nearbyToggle.classList.contains("screen-active") && !els.inspector.classList.contains("minimized")) {
        pulseNavButton(els.nearbyToggle);
        return;
      }
      goToInitialView();
    });
  }

  if (els.reportToggle) {
    els.reportToggle.addEventListener("click", (event) => {
      event.preventDefault();
      // The tab is lit on its Feedback sub-page too, but tapping it there goes back up to Community.
      const here = communityEnabled() ? "community" : "report";
      if (state.selected?.type === here && !els.inspector.classList.contains("minimized")) {
        pulseNavButton(els.reportToggle);
        return;
      }
      openCommunityOrFeedback();
    });
  }

  if (els.settingsToggle) {
    els.settingsToggle.addEventListener("click", (event) => {
      event.preventDefault();
      if (els.settingsToggle.classList.contains("screen-active") && !els.inspector.classList.contains("minimized")) {
        pulseNavButton(els.settingsToggle);
        return;
      }
      openSettings();
    });
  }

  // Select dropdown is part of the overview UI; listener attached in selectOverview()
  document.addEventListener("change", (event) => {
    if (event.target.id === "nearestItemsSelect") {
      state.walkingDistanceMinutes = parseInt(event.target.value, 10);
      syncLiveQueryStringForScreen();
      selectOverview();
      if (state.userLocation) {
        const { latitude, longitude } = state.userLocation;
        const maxMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
        const nearestTrees = nearbyTreesWithinDistance(latitude, longitude, maxMetres);
        state.nearestTree = nearestTrees.length > 0 ? nearestTrees[0] : null;
        ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
        requestDraw();
      }
    }
  }, true);

  els.inspectorBody.addEventListener("click", (event) => {
    const clearAllButton = event.target.closest("[data-filter-clear-all]");
    if (clearAllButton) {
      setOverviewFilters([]);
      return;
    }

    const subfilterButton = event.target.closest("[data-filter-subfilter]");
    if (subfilterButton) {
      toggleOverviewSubfilter(subfilterButton.dataset.filterSubfilter);
      return;
    }

    const groupButton = event.target.closest("[data-filter-group]");
    if (groupButton) {
      toggleOverviewFilterGroup(groupButton.dataset.filterGroup);
    }
  });
}

// Arrow-key navigation through whichever `.nearest-list` is currently rendered -- the Nearby
// list (`[data-overview-type]` rows) and the Search results list (`[data-search-type]` rows)
// share the same `.nearest-item` button markup, so one handler covers both; only one of the two
// is ever on screen at a time. Enter needs no extra handling here: a focused `<button>` already
// activates on Enter natively, which the existing delegated click handler picks up.
function handleNearestListArrowKey(event) {
  const items = Array.from(els.inspectorBody.querySelectorAll(".nearest-item"));
  if (!items.length) return;
  const currentItem = event.target.closest(".nearest-item");
  const searchInput = event.target.closest("#mapSearchInput");
  if (!currentItem && !searchInput) return; // arrow keys elsewhere in the inspector are untouched

  if (event.key === "ArrowDown") {
    const nextIndex = currentItem ? items.indexOf(currentItem) + 1 : 0;
    if (nextIndex < items.length) {
      event.preventDefault();
      items[nextIndex].focus();
      items[nextIndex].scrollIntoView({ block: "nearest" });
    }
    return;
  }

  // ArrowUp
  if (!currentItem) return; // already at the top (the search field) -- nowhere further up to go
  const index = items.indexOf(currentItem);
  event.preventDefault();
  if (index === 0) {
    // Back up into the field itself when there is one (Search); the plain Nearby list has none,
    // so the first row simply stays put.
    const input = document.getElementById("mapSearchInput");
    if (input) input.focus();
  } else {
    items[index - 1].focus();
    items[index - 1].scrollIntoView({ block: "nearest" });
  }
}

function setupSearchAndNavHandlers() {
  if (els.searchToggle) {
    els.searchToggle.addEventListener("click", (event) => {
      event.preventDefault();
      if (els.searchToggle.classList.contains("screen-active") && !els.inspector.classList.contains("minimized")) {
        pulseNavButton(els.searchToggle);
        return;
      }
      openSearchScreen();
    });
  }

  // The field and the results list are both inside #inspectorBody, which is replaced whole on
  // every screen change -- so both are bound by delegation rather than to the elements
  // themselves. Typing only re-renders the results (renderSearchResults, js/app.js).
  els.inspectorBody.addEventListener("input", (event) => {
    const input = event.target.closest("#mapSearchInput");
    if (!input) return;
    setSearchQuery(input.value);
  });

  // Tab moves focus through the scrollable Nearby/Search results list using the browser's own
  // default order -- no keydown handler of ours runs for it -- so without this the focused row
  // can land outside the visible scroll area with nothing on screen to show it moved at all.
  els.inspectorBody.addEventListener("focusin", (event) => {
    const item = event.target.closest(".nearest-item");
    if (item) item.scrollIntoView({ block: "nearest" });
  });

  els.inspectorBody.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      handleNearestListArrowKey(event);
      return;
    }
    if (event.key !== "Enter") return;
    const input = event.target.closest("#mapSearchInput");
    if (!input) return;
    // Enter on a phone dismisses the keyboard and commits the first result, which is the
    // one the list is already sorted to put under the user's thumb.
    event.preventDefault();
    input.blur();
    const first = els.inspectorBody.querySelector("[data-search-type][data-search-key]");
    if (first) openSearchResult(first.dataset.searchType, first.dataset.searchKey);
  });

  // Back, forward, the device back gesture, and a fragment edited by hand all land here: the
  // URL is the app's navigation state, so whatever it now says is what gets shown. A
  // traversal fires popstate (plus hashchange when the fragment differs) and a hand-edited
  // fragment fires hashchange alone; applyRouteFromUrl no-ops when the app is already on the
  // screen the URL names, so being called twice for one change costs nothing.
  window.addEventListener("popstate", () => {
    restoreNearbyAnchorFromHistory();
    applyRouteFromUrl();
  });
  window.addEventListener("hashchange", () => {
    applyRouteFromUrl();
  });

  if (els.nearbyAnchorBar) {
    els.nearbyAnchorBar.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='reset-nearby-anchor']")) clearNearbyAnchor();
    });
  }

  els.inspectorBody.addEventListener("click", (event) => {
    const searchClear = event.target.closest("#mapSearchClear");
    if (searchClear) {
      const input = document.getElementById("mapSearchInput");
      if (input) { input.value = ""; input.focus(); }
      setSearchQuery("");
      return;
    }
    const searchResult = event.target.closest("[data-search-type][data-search-key]");
    if (searchResult) {
      openSearchResult(searchResult.dataset.searchType, searchResult.dataset.searchKey);
      return;
    }
    const shareBtn = event.target.closest("[data-action='share-location']");
    if (shareBtn) { shareCurrentLocation(); return; }
    const walkRadiusBtn = event.target.closest("[data-action='walk-radius']");
    if (walkRadiusBtn) {
      const lat = Number(walkRadiusBtn.dataset.lat);
      const lon = Number(walkRadiusBtn.dataset.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        focusNearbyWithinWalkMinutes(lat, lon, state.walkingDistanceMinutes, walkRadiusBtn.dataset.name || null);
      }
      return;
    }
    const moreToggle = event.target.closest("[data-action='community-more']");
    if (moreToggle) { communityToggleMore(moreToggle); return; }
    const badgeTile = event.target.closest("[data-action='community-badge']");
    if (badgeTile) { communityShowBadgeDetail(badgeTile); return; }
    const logFilter = event.target.closest("[data-action='community-log-filter']");
    if (logFilter) { communityLogFilter = logFilter.dataset.filter; communityRenderContributions(); return; }
    const signinDismiss = event.target.closest("[data-action='community-signin-dismiss']");
    if (signinDismiss) { communityDismissSignin(); return; }
    const addStart = event.target.closest("[data-action='community-add-start']");
    if (addStart) { communityStartAddTree(); return; }
    const retryButton = event.target.closest("[data-action='community-retry']");
    if (retryButton) { event.preventDefault(); communityRetry(retryButton); return; }
    const recoveryAction = event.target.closest("[data-action='community-copy-code'], [data-action='community-restore']");
    if (recoveryAction) {
      event.preventDefault();
      if (recoveryAction.dataset.action === "community-restore") communityRestore(); else communityCopyCode();
      return;
    }
    const confirmAdded = event.target.closest("[data-action='community-confirm-added']");
    if (confirmAdded) { communityConfirmAddedTree(confirmAdded.dataset.tag); return; }
    const addPlaceStart = event.target.closest("[data-action='community-addplace-start']");
    if (addPlaceStart) { communityStartAddPlace(); return; }
    const addPlaceCancel = event.target.closest("[data-action='community-addplace-cancel']");
    if (addPlaceCancel) { communityCancelAddPlace(); return; }
    const addCancel = event.target.closest("[data-action='community-add-cancel']");
    if (addCancel) { communityCancelAddTree(); return; }
    const placeChoice = event.target.closest("[data-action='community-place-choose']");
    if (placeChoice) { communityHandlePlaceChoice(placeChoice); return; }
    const placeSend = event.target.closest("[data-action='community-send-place']");
    if (placeSend) { communitySendPlace(placeSend); return; }
    const placeCancel = event.target.closest("[data-action='community-cancel-note']");
    if (placeCancel) { communityCancelNote(placeCancel); return; }
    const communityChange = event.target.closest("[data-action='community-change']");
    if (communityChange) { communityHandleChange(communityChange); return; }
    const communityChoice = event.target.closest("[data-action='community-report']");
    if (communityChoice) { communityHandleChoice(communityChoice); return; }
    const reportIssueToggle = event.target.closest("[data-action='report-issue']");
    if (reportIssueToggle) { toggleLocationIssueForm(reportIssueToggle); return; }
    const cancelIssueBtn = event.target.closest("[data-action='cancel-location-issue']");
    if (cancelIssueBtn) { cancelLocationIssueForm(cancelIssueBtn.closest(".report-issue")); return; }
    const submitIssueBtn = event.target.closest("[data-action='submit-location-issue']");
    if (submitIssueBtn) { submitLocationIssueReport(submitIssueBtn.closest(".report-issue")); return; }
    const resetAnchorBtn = event.target.closest("[data-action='reset-nearby-anchor']");
    if (resetAnchorBtn) { clearNearbyAnchor(); return; }
    const radiusToggle = event.target.closest("[data-action='toggle-radius']");
    if (radiusToggle) {
      state.showAllOutsideRadius = !state.showAllOutsideRadius;
      selectOverview();
      ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
      requestDraw();
      return;
    }
    // Any plain in-app link rendered into the inspector (nearbySectionsHtml's category/
    // group chips and nearest-tree/cow cards) -- an
    // external link (Open in Maps, a website row, OSM attribution) always opens target="_blank"
    // and is left to the browser untouched; so is a modified click (open in new tab/window),
    // same as any ordinary link.
    // API routes (sign-in, sign-out) are server redirects, not app screens: leave them to the browser.
    const internalLink = event.target.closest("a[href^='/']:not([href^='/api/'])");
    if (internalLink && internalLink.target !== "_blank"
      && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      navigateInApp(internalLink.getAttribute("href"));
      return;
    }
    const button = event.target.closest("[data-overview-type][data-overview-key]");
    if (!button) return;
    focusOverviewItem(button.dataset.overviewType, button.dataset.overviewKey);
  });
}

// Re-reads state.nearestTree (the loading/status "nearest tree" readout) from whatever the
// Nearby view's current origin is -- the browse anchor when one is set, otherwise the GPS fix.
// Shared by refreshNearbyRadiusView and focusNearbyOnMapPoint's exit-a-selection path, which
// re-frames via goToInitialView rather than through refreshNearbyRadiusView.
function refreshNearestTreeForNearbyOrigin() {
  const origin = nearbyOrigin();
  if (!origin) return;
  const maxMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
  const nearestTrees = nearbyTreesWithinDistance(origin.latitude, origin.longitude, maxMetres);
  state.nearestTree = nearestTrees.length > 0 ? nearestTrees[0] : null;
}

// Re-derives the Nearby list/radius/camera fit after state.walkingDistanceMinutes or
// state.nearbyAnchor changes. Mirrors the settings-screen walking-radius change handler
// (bindSettingsHandlers in index.html) so pinch-resize and tap-to-relocate stay consistent
// with the existing Settings flow. options.animate (default true) is set to false while a
// gesture is still live (mid-pinch, mid-slider-drag) so every intermediate value jumps the
// camera straight to its fit instead of queuing an animation per tick; the gesture's own end
// handler calls this again with the default animate:true for one smooth settling motion.
function refreshNearbyRadiusView(options = {}) {
  const animate = options.animate !== false;
  refreshNearestTreeForNearbyOrigin();
  // selectOverview() replaces the inspector body with the Nearby list and forces its title/nav
  // state regardless of what's currently shown -- correct while the pinch gesture is live (it's
  // gated on isOverviewScreenActive() before it can even start), but calling it while the
  // Settings/Filter/Report screen is open would blow that screen's own content away every time
  // its walking-radius slider fires "input". ensureOverviewTargetsVisible below already knows
  // how to frame the ring correctly for those screens (see secondaryScreenActive()) without it.
  if (!secondaryScreenActive()) selectOverview();
  updateNearbyAnchorBar();
  // A caller that also just started a nearby-origin slide (focusNearbyOnClusterGroup) passes
  // its own duration so the two tweens land on the same frame -- see nearbyRevealOpacity's
  // concurrent-viewport-animation check, which otherwise has a gap to fall through if this one
  // finishes first.
  ensureOverviewTargetsVisible({
    animate,
    durationMs: options.durationMs || OVERVIEW_REFIT_ANIMATION_MS,
    force: true,
    stagePanThenZoom: Boolean(options.stagePanThenZoom),
  });
  requestDraw();
}

function applyWalkingRadiusChange(minutes, options = {}) {
  if (state.walkingDistanceMinutes === minutes) return;
  state.walkingDistanceMinutes = minutes;
  syncLiveQueryStringForScreen();
  // Resizing the ring is the user taking the camera back: whatever out-of-radius match a
  // just-added filter had the fit reaching for (outOfRadiusFitPoints, js/app.js), the ring they
  // are now dragging is the thing they want framed. Same reasoning drops an expanded cluster:
  // deliberately asking for a different-sized ring (the Settings slider, the pinch gesture) is
  // the user choosing to see more or less ground than the tapped group's own extent, which an
  // exact-membership view can no longer promise once that choice is made. The one caller that
  // could reach here while a cluster is expanded (the automatic grow-back,
  // ensureWalkingRadiusCoversNearest) already refuses to run in that case, so this never fires
  // mid-expansion on its own.
  exitClusterExpansion({ restoreRadius: false });
  state.outOfRadiusRevealFilters = [];
  refreshNearbyRadiusView(options);
}

// Is the walking-radius ring empty -- nothing of the active kinds actually inside it? Reads the
// memoized in-radius scan every draw already runs (overviewItemsForActiveFilter, index.html)
// rather than measuring again: state.overviewOutsideRadiusFallback is set by that same scan
// precisely when it had to reach past the radius to find anything at all.
function nearbyRadiusIsEmpty() {
  // "Show all distances" deliberately ignores the radius, so there is no empty ring to fix.
  if (state.showAllOutsideRadius) return false;
  const entries = overviewItemsForActiveFilter();
  return state.overviewOutsideRadiusFallback || entries.length === 0;
}

// Grows the walking radius back to whatever still has something in it, as the user walks. Zoomed
// right in on one find (now that the floor lets the ring close to ~21 m), walking away from it
// leaves a ring with nothing inside and a map zoomed into empty ground -- so a fix that empties
// the ring lifts it to the current floor, i.e. just past the nearest remaining highlighted
// location, and the camera fitted to the ring zooms out with it.
//
// Grow-only, and only as far as the floor: a deliberately wide radius is never pulled in, and
// the radius the user chose is never overridden while it still has something to show.
//
// Returns the radius to grow to, or null for "leave it alone" -- split out from the applying
// wrapper below so a caller mid-way through its own state change can fold the new radius into
// one refresh instead of triggering a second one.
function walkingRadiusGrowBackMinutes() {
  if (!state.dataLoaded || state.pinchActive) return null;
  // A real selection or an expanded cluster is its own view: refreshNearbyRadiusView would
  // replace it with the Nearby list. The radius is re-checked on the next fix after it closes.
  if (hasRealSelection() || state.clusterExpanded || state.clusterZoomed) return null;
  // Mid-slide to a browsed spot the camera is easing between two framings of the ring
  // (maxNearbyHeadingUpScale, index.html); resizing the ring underneath that is the one thing
  // that slide is built to avoid. The next fix picks it up once the slide has landed.
  if (nearbyOriginTransitionActive()) return null;
  const origin = nearbyOrigin();
  if (!origin) return null;
  if (!nearbyRadiusIsEmpty()) return null;
  const floor = ceilWalkingMinutes(walkingRadiusFloorMinutes(origin));
  return floor > state.walkingDistanceMinutes ? floor : null;
}

// Applies the above. Called from the watchPosition handler (ensureLocationWatch, index.html) on
// every fix; reports whether it actually grew the radius.
function ensureWalkingRadiusCoversNearest() {
  const minutes = walkingRadiusGrowBackMinutes();
  if (minutes == null) return false;
  applyWalkingRadiusChange(minutes, { animate: true });
  syncSettingsWalkSlider();
  return true;
}

// Re-states the Settings slider from state after something *other* than the slider changed the
// radius -- the pinch gesture (which engages over the Settings screen too), or the automatic
// grow-back above. The form is built once when the screen opens (settingsFormHtml, index.html),
// so without this its thumb, its floor and its label drift away from the ring drawn behind it.
// Deliberately not called from refreshNearbyRadiusView: a live slider drag goes through there on
// every "input", and writing the value back mid-drag would tug the thumb under the finger.
function syncSettingsWalkSlider() {
  const range = document.getElementById("settingsWalkMins");
  if (!range) return;
  const minutes = state.walkingDistanceMinutes;
  // Same origin settingsFormHtml derives the rendered floor from.
  const floorMinutes = ceilWalkingMinutes(walkingRadiusFloorMinutes(state.userLocation));
  range.min = String(floorMinutes);
  range.step = String(floorMinutes < 1 ? WALKING_RADIUS_FINE_STEP_MINUTES : WALKING_RADIUS_STEP_MINUTES);
  range.value = String(minutes);
  const valueLabel = document.getElementById("settingsWalkMinsValue");
  if (valueLabel) valueLabel.textContent = formatWalkingRadius(minutes);
  const floorNote = document.getElementById("settingsWalkMinsFloorNote");
  if (floorNote) floorNote.hidden = minutes > floorMinutes;
}

// Moves the Nearby view's browse anchor to an arbitrary map point (see nearbyOrigin above),
// leaving the real GPS fix (state.userLocation) untouched. The move is animated by sliding the
// *origin* rather than the camera (startNearbyOriginTransition, index.html), which keeps the
// walking-radius circle still on screen and moves the map behind it -- so the camera itself is
// re-derived per frame from the interpolated origin and must not also be animated here.
function setNearbyAnchor(latitude, longitude, point, label = null) {
  startNearbyOriginTransition(nearbyRenderOriginPoint());
  state.nearbyAnchor = { latitude, longitude, point, label };
  // Same reasoning as applyWalkingRadiusChange: moving the browse point is the user choosing
  // what the camera should be looking at.
  state.outOfRadiusRevealFilters = [];
  refreshNearbyRadiusView({ animate: false });
  pushNearbyAnchorHistory();
}

// A selected place's own "Everything within 15 min walk" button (nearbyWithinWalkHtml,
// js/inspector.js) -- folds setNearbyAnchor's anchor move and applyWalkingRadiusChange's radius
// change into one state update and one refresh/history push, the same way
// focusNearbyOnClusterGroup folds an anchor move and a radius change together for a cluster tap,
// rather than calling each of those two functions in turn and refreshing twice.
function focusNearbyWithinWalkMinutes(latitude, longitude, minutes, label = null) {
  state.selected = null;
  setInspectorMinimized(false);
  startNearbyOriginTransition(nearbyRenderOriginPoint());
  state.nearbyAnchor = { latitude, longitude, point: projectLonLat(longitude, latitude), label };
  state.walkingDistanceMinutes = minutes;
  state.outOfRadiusRevealFilters = [];
  // "Everything" means every category, not the reader's saved filter set -- same override the
  // /nearby?filters=false link gets (applyShowFilterFromQuery, js/app.js). Ephemeral, so the
  // saved filters come back as soon as the reader leaves this view.
  setOverviewFilters(Array.from(ALL_OVERVIEW_FILTER_KEYS), { persist: false, render: false });
  exitClusterExpansion({ restoreRadius: false });
  refreshNearbyRadiusView({ animate: false });
  pushNearbyAnchorHistory();
}

// "near=<lat>,<lon>" arriving fresh -- a shared link opened cold, or a hashchange with no
// matching history traversal (applyRouteToScreen, js/app.js). The anchor counterpart to
// showRoutedSelection there: moves the Nearby browse point via the very setNearbyAnchor a map
// tap uses, so the link reproduces exactly the view tapping that spot gave whoever shared it.
// Clears any real selection first, same as showRoutedSelection clears the anchor for the
// reverse case.
function applyNearbyAnchorFromRoute(anchor) {
  state.selected = null;
  setInspectorMinimized(false);
  setNearbyAnchor(anchor.latitude, anchor.longitude, projectLonLat(anchor.longitude, anchor.latitude), anchor.label || null);
}

// The counterpart to pushNearbyAnchorHistory (js/app.js), run on every popstate before the URL
// itself is re-applied: puts state.nearbyAnchor back to whatever it was on the history entry
// just landed on, so moving between clusters undoes on the browser back button and the
// inspector's own back arrow exactly like a selection does, instead of leaving the ring wherever
// the last cluster tap left it.
//
// Wrapped in routeApplyDepth (js/app.js) for the same reason applyRoute() is: refreshNearbyRadiusView
// below re-renders the Nearby list via selectOverview(), which unconditionally calls
// syncHashFromSelection() -- harmless once applyRouteFromUrl has already cleared a stale
// state.selected, but this runs *before* that, while state.selected can still be whatever real
// selection the popstate is navigating away from. Without the guard, that premature
// syncHashFromSelection() read the still-live selection, saw it didn't match the URL the browser
// had just reverted to, and pushed a *new* history entry restoring it -- so the back button landed
// on a screen showing the Nearby list (selectOverview had already rendered it) while the address
// bar and state.selected silently snapped back to the selection back was meant to leave, and the
// next back press had an extra entry to undo before the browser history matched what was on
// screen. Reported as the back button only updating the map (the anchor/camera) and not the
// inspector panel.
function restoreNearbyAnchorFromHistory() {
  const entry = history.state;
  const snapshot = entry ? entry[NEARBY_ANCHOR_KEY] : null;
  const current = state.nearbyAnchor;
  const unchanged = current && snapshot
    ? current.latitude === snapshot.latitude && current.longitude === snapshot.longitude
    : !current && !snapshot;
  if (unchanged) return;
  routeApplyDepth += 1;
  try {
    stopViewportAnimation();
    state.clusterZoomed = false;
    startNearbyOriginTransition(nearbyRenderOriginPoint());
    state.nearbyAnchor = snapshot
      ? { latitude: snapshot.latitude, longitude: snapshot.longitude, point: projectLonLat(snapshot.longitude, snapshot.latitude) }
      : null;
    state.outOfRadiusRevealFilters = [];
    updateNearbyAnchorBar();
    // If a cluster is still expanded here, urlMatchesCurrentScreen (js/app.js) is about to force
    // applyRouteFromUrl's caller to run applyRouteToScreen right after this returns -- which drops
    // the expanded group and restores the radius it grew (exitClusterExpansion) before its own
    // refit runs. A camera tween started here, against the still-expanded group's radius, would
    // ease toward a target sized for the group; by the time the *correct* tween (that later refit)
    // tries to start, one is already in flight and alignHeadingUpNavigationViewport refuses to
    // override it (selectionCameraTransitionActive) -- so the wrong tween is the only one that
    // ever runs, and the camera settles at the wrong zoom. Reported as the back button "zooming
    // in and out a bit" rather than one steady zoom. Snapping instead of easing here is invisible
    // (nothing has painted yet), and leaves nothing in flight for the correction to compete with,
    // so only the one, right ease -- the later refit's -- is ever seen.
    const clusterAboutToExit = Boolean(state.clusterExpanded);
    refreshNearbyRadiusView({ animate: !clusterAboutToExit, durationMs: NEARBY_ORIGIN_TRANSITION_MS });
  } finally {
    routeApplyDepth -= 1;
  }
}

// Tapping a grouped set of pins -- a same-category cluster or a cross-category "mega" badge
// (buildSuperClusters, js/renderer.js) alike -- moves the Nearby browse anchor to the group's
// centre and grows the walking radius just far enough to keep every member inside the ring, the
// same way a tap on open ground does (focusNearbyOnMapPoint). The Nearby list then reads "what's
// in this group" on its own, with no separate cluster-list screen to learn -- one interaction
// covers both kinds of group, which is the point: fewer states for the user to hold in mind.
//
// The real state change (anchor, radius, list) lands immediately, same as every other way of
// moving the Nearby view (setNearbyAnchor, restoreNearbyAnchorFromHistory); only the camera
// eases, in one direct move from wherever it already is to the group's own framing -- the same
// refreshNearbyRadiusView({ animate: true }) path a browser-back cluster undo already takes.
// An earlier version zoomed out first to show both the current and destination framing, then
// panned across, then zoomed in -- three separate tweens stitched together to narrate a long
// jump (a mega badge across the ring from an earlier browse anchor, say). In practice that read
// as the view yanking away before coming back, worse than the plain cut it was trying to avoid:
// a single ease already shows the ring and the terrain moving together, which is its own
// explanation for where the view went.
//
// Shared by focusNearbyOnClusterGroup (below) and the mega badge's own
// count display (drawMegaClusters, js/renderer.js), so the two can never disagree: the centre
// and walking radius a tap on this group will actually land on, computed once.
function clusterFocusTarget(items) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.point.x);
    maxX = Math.max(maxX, item.point.x);
    minY = Math.min(minY, item.point.y);
    maxY = Math.max(maxY, item.point.y);
  }
  const centerPoint = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const center = unprojectPoint(centerPoint);

  let maxMetres = 0;
  for (const item of items) {
    maxMetres = Math.max(maxMetres, distanceMetres(center.latitude, center.longitude, item.latitude, item.longitude));
  }
  // Same buffer walkingRadiusFloorMinutes uses to settle its nearest item clearly inside the
  // ring rather than right on its edge -- here it keeps the group's farthest member off the
  // rim too.
  // ceilWalkingMinutes, not roundWalkingMinutes: rounding to the nearest grid point can round
  // down, shrinking the ring back inside the group it was just sized to cover.
  const rawMinutes = metresToWalkingMinutes(maxMetres * WALKING_RADIUS_FLOOR_BUFFER);
  const floorMinutes = walkingRadiusFloorMinutes(center);
  const targetMinutes = ceilWalkingMinutes(clamp(rawMinutes, floorMinutes, WALKING_RADIUS_MAX_MINUTES));
  return { centerPoint, center, targetMinutes };
}

// Clears state.clusterExpanded, restoring the walking radius it grew to cover the group's own
// members (see state.preClusterWalkingDistanceMinutes) -- called from every place that leaves
// the exact-membership view (back/forward, dismissing the anchor bar, a fresh selection, the
// user taking the camera over by hand). A no-op when no cluster is expanded, so every caller
// can call it unconditionally instead of guarding first.
//
// restoreRadius: false for applyWalkingRadiusChange, the one caller where state.walkingDistanceMinutes
// has *already* been set to a new value the user just chose deliberately (the Settings slider,
// a pinch/wheel gesture) -- that choice must win, not be overwritten by the stashed one.
function exitClusterExpansion({ restoreRadius = true } = {}) {
  if (!state.clusterExpanded) return;
  state.clusterExpanded = null;
  const previousRadius = state.preClusterWalkingDistanceMinutes;
  state.preClusterWalkingDistanceMinutes = null;
  if (restoreRadius && previousRadius != null) {
    state.walkingDistanceMinutes = previousRadius;
  }
}

function focusNearbyOnClusterGroup(cluster) {
  const items = (cluster.items || []).filter(item => item && item.point
    && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  if (!items.length) return false;

  const { centerPoint, center, targetMinutes } = clusterFocusTarget(items);

  setInspectorMinimized(false);
  stopViewportAnimation();
  state.clusterZoomed = false;
  // Stashed only on the way *into* the exact-membership view, not on every nested drill-down
  // into a sub-cluster -- otherwise leaving a two-level drill-down would only undo the inner
  // tap's own radius change, not the original one from before either tap.
  if (!state.clusterExpanded) {
    state.preClusterWalkingDistanceMinutes = state.walkingDistanceMinutes;
  }
  // Expanding a cluster always surfaces the Nearby list with its members, even when the tap
  // landed on the map behind a secondary screen (Filter/Settings/Report/Search) -- unlike a tap
  // on open ground, which deliberately leaves those screens open (see handleMapClick's own
  // comment: "Neither ever dismisses the screen itself"), a cluster tap has one specific thing
  // to show right now, the group it just expanded, and that has nowhere to go but the Nearby
  // list. Mirrors the real-selection branch of focusNearbyOnMapPoint, which closes the same
  // screens for the same reason. Clearing these before refreshNearbyRadiusView runs below is
  // what lets its own `if (!secondaryScreenActive()) selectOverview()` actually fire.
  state.filterScreenOpen = false;
  state.searchScreenOpen = false;
  if (state.selected && ["settings", "report", "community"].includes(state.selected.type)) {
    state.selected = null;
  }
  // Same slide restoreNearbyAnchorFromHistory/setNearbyAnchor use for any other anchor move --
  // started from wherever the ring is currently drawn so it continues smoothly even if this
  // lands mid an earlier slide, rather than cutting straight to the new centre.
  startNearbyOriginTransition(nearbyRenderOriginPoint());
  state.nearbyAnchor = { latitude: center.latitude, longitude: center.longitude, point: centerPoint };
  state.walkingDistanceMinutes = targetMinutes;
  state.outOfRadiusRevealFilters = [];
  // Narrows the map and the Nearby list to exactly this group's own members (see
  // buildNearbyIconLookup, js/renderer.js, and expandedClusterOverviewEntries, js/app.js) --
  // not a fresh within-radius scan from the new anchor. A scan can't promise the count the
  // badge just showed: the radius above routinely reaches past the group's own farthest member
  // into whatever else is standing nearby in a dense patch of forest (its own floor and grid
  // rounding alone can double it), and a large candidate pool resamples differently after the
  // anchor/radius change this tap just made (MAX_MAP_TREES, js/renderer.js). Reading the group's
  // own items directly is the only way the list and the badge that opened it can agree. Items
  // may still re-cluster into smaller badges at the new zoom -- that's the recursive
  // drill-down findClusterHit's own comments already describe -- but the *underlying* item
  // count never grows or shrinks on the way in.
  state.clusterExpanded = cluster;
  syncSettingsWalkSlider();
  // Pan-then-zoom to the group's own framing, rather than easing position and scale at once:
  // the tapped group is already on screen (that's how it got tapped), so sliding it to the
  // middle of today's view before zooming in on it reads as "the camera found the group, then
  // moved in on it" instead of a single rushed zoom that happens to also be panning. See
  // alignHeadingUpNavigationViewport's stagePanThenZoom branch (js/app.js). Not the old
  // zoom-out/pan/zoom-in tour (three tweens, abandoned for reading as a yank away and back) --
  // this is two. refreshNearbyRadiusView handles the nearest-tree rescan, the Nearby list, the
  // anchor bar, and ensureOverviewTargetsVisible's own camera fit. Matches the nearby-origin
  // slide's own duration (started above, via startNearbyOriginTransition -- always
  // NEARBY_ORIGIN_TRANSITION_MS) so the camera's fly-to-cluster tween and the ring/pin reveal
  // land on the same frame -- see nearbyRevealOpacity.
  refreshNearbyRadiusView({ animate: true, durationMs: NEARBY_ORIGIN_TRANSITION_MS, stagePanThenZoom: true });
  pushNearbyAnchorHistory();
  return true;
}

function clearNearbyAnchor() {
  if (!state.nearbyAnchor) return;
  startNearbyOriginTransition(nearbyRenderOriginPoint());
  state.nearbyAnchor = null;
  state.outOfRadiusRevealFilters = [];
  // Dismissing the anchor bar is as much an exit from an expanded cluster as tapping open
  // ground is (focusNearbyOnMapPoint) -- left set, the list/map stayed narrowed to a group with
  // no relation to wherever GPS-based browsing resumes.
  exitClusterExpansion();
  refreshNearbyRadiusView({ animate: false });
  pushNearbyAnchorHistory();
}

// Hides the bar with the entry animation played backwards (css/inspector.css): the card fades
// out first, then the space collapses, and only when that finishes is `hidden` set. Falls back to
// hiding at once when animation is unavailable or reduced motion is requested.
function hideNearbyAnchorBar(bar) {
  if (bar.classList && bar.classList.contains("is-leaving")) return;
  const animates = bar.classList && typeof bar.getAnimations === "function"
    && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (!animates) {
    bar.hidden = true;
    return;
  }
  const finish = () => {
    cancelNearbyAnchorBarExit(bar);
    bar.hidden = true;
  };
  bar.classList.add("is-leaving");
  bar._leaveHandler = (event) => {
    if (event.animationName === "nearby-anchor-space-out") finish();
  };
  bar.addEventListener("animationend", bar._leaveHandler);
  bar._leaveTimer = setTimeout(finish, 1200);
}

function cancelNearbyAnchorBarExit(bar) {
  if (bar._leaveHandler) bar.removeEventListener("animationend", bar._leaveHandler);
  clearTimeout(bar._leaveTimer);
  bar._leaveHandler = null;
  bar._leaveTimer = null;
  if (bar.classList) bar.classList.remove("is-leaving");
}

// Shows/hides #nearbyAnchorBar, the way back from a browsed spot. It lives in the inspector
// chrome rather than inside the Nearby list's own HTML because Filters, Settings and Report all
// keep drawing the walking-radius circle around the browse anchor behind them (see
// secondaryScreenActive) -- while the notice was part of the list, opening any of those three
// left the user browsing a spot with nothing on screen offering to undo it. Hidden only for a
// real selection, which replaces that whole map view anyway (hasRealSelection).
function updateNearbyAnchorBar() {
  const bar = els.nearbyAnchorBar;
  if (!bar) return;
  const show = !!(state.nearbyAnchor && !hasRealSelection());
  if (show) {
    cancelNearbyAnchorBarExit(bar);
    bar.hidden = false;
  } else if (!bar.hidden) {
    hideNearbyAnchorBar(bar);
  }
  // Mid-exit the card keeps its old wording; the generic fallback would flash in as it fades out.
  if (bar.classList && bar.classList.contains("is-leaving")) return;
  // Names the spot when the browse point came from a place (its own inspector's walk card or a
  // related link), so the reader sees whose neighbourhood they are looking at; a bare map tap
  // keeps the generic wording.
  const text = bar.querySelector(".nearby-anchor-bar-text");
  if (text) {
    const label = state.nearbyAnchor && state.nearbyAnchor.label;
    text.textContent = label ? `Showing places near ${label}` : "Showing places near where you tapped";
  }
}

// The Nearby view's "nearest area" is the walking-radius ring drawn around nearbyOrigin().
// Everything the view is about -- the list, the highlighted locations -- lives inside it, so a tap beyond it reads as "show me what's over there", never as "navigate to
// this". handleMapClick (js/inspector.js) uses this to relocate on such a tap whatever it
// landed on: streets and waymarked trails are drawn right across the map and would otherwise
// keep opening a navigation view from the far corners of the Nearby screen.
function isOutsideNearestArea(lonLat) {
  const origin = nearbyOrigin();
  if (!origin) return false;
  const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
  return distanceMetres(origin.latitude, origin.longitude, lonLat.latitude, lonLat.longitude) > radiusMetres;
}

// Called from handleMapClick (js/inspector.js) whenever a map tap should move the Nearby view
// rather than select something: a tap on open ground anywhere, or any tap at all outside the
// nearest area (above). The tapped spot becomes the Nearby view's browse origin -- the walking
// radius is redrawn around it and the nearby list re-reads from it, without touching the real
// GPS fix. An open-ground tap relocates at any distance, including inside the current radius.
//
// A tap made while a selection or an expanded group is open also leaves that view: the anchor
// is set *before* goToInitialView() so its single re-fit already frames the tapped spot,
// rather than fitting the old origin and then animating a second time.
function focusNearbyOnMapPoint(lonLat, worldPoint) {
  // Defensive reset: state.clusterZoomed should already be false by the time any tap lands
  // (focusNearbyOnClusterGroup clears it itself, synchronously, before its own camera ease
  // starts), but clearing it here too means a plain open-ground tap can never be silently
  // blocked by a stale flag left over from some earlier interaction.
  state.clusterZoomed = false;
  stopViewportAnimation();
  if (!state.userLocation) {
    // No GPS fix yet, so there is no Nearby view to move. On the Nearby screen itself, keep the
    // long-standing reset-to-the-whole-forest behaviour rather than anchoring a radius nothing
    // can populate -- but that reset is also what closes an open screen, and a map tap must
    // never dismiss Filter/Settings/Report, so from those a tap with no fix simply does nothing.
    if (!secondaryScreenActive()) goToInitialView();
    return false;
  }
  // hasRealSelection(), not state.selected: the Settings/Report pseudo-selections are also
  // truthy, and taking this branch from them dismissed the very screen the tap must never
  // dismiss. They behave like plain Nearby here -- move the anchor, leave the screen open.
  if (hasRealSelection() || state.clusterExpanded) {
    state.nearbyAnchor = { latitude: lonLat.latitude, longitude: lonLat.longitude, point: worldPoint };
    refreshNearestTreeForNearbyOrigin();
    goToInitialView();
    updateNearbyAnchorBar();
  } else {
    setInspectorMinimized(false);
    setNearbyAnchor(lonLat.latitude, lonLat.longitude, worldPoint);
  }
  return true;
}

function currentPinchDistance() {
  const points = Array.from(state.activePointers.values());
  if (points.length < 2) return null;
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

// Starts pinch-to-resize for the Nearby view's walking radius. Engages on any screen that still
// draws that radius behind it -- the plain Nearby overview, and Filters/Settings/Report (see
// secondaryScreenActive) -- so the circle can be adjusted wherever it is visible. Over a real
// selection, which replaces the view entirely, a second touch point is still just ignored.
function startNearbyRadiusPinch() {
  const distance = currentPinchDistance();
  if (distance == null) return;
  state.pinchActive = true;
  state.pinchBaseDistance = distance;
  state.pinchBaseMinutes = state.walkingDistanceMinutes;
}

// Scales state.walkingDistanceMinutes continuously with the pinch gesture -- spreading fingers
// apart shrinks the radius, pinching together grows it, matching ordinary map pinch-zoom
// direction. Clamped to walkingRadiusFloorMinutes()..WALKING_RADIUS_MAX_MINUTES so the user
// feels the limit (state.walkingRadiusAtFloor drives the "nothing closer to show" notice in
// overviewNearestHtml, index.html) rather than the radius silently refusing to shrink further.
function updateNearbyRadiusPinch() {
  const distance = currentPinchDistance();
  if (distance == null || !state.pinchBaseDistance) return;
  const ratio = distance / state.pinchBaseDistance;
  applyWalkingRadiusGesture(state.pinchBaseMinutes / ratio);
}

// The shared body of every continuous radius gesture -- the two-finger pinch above and the
// wheel/trackpad below. Takes the radius the gesture is asking for, in minutes, and applies as
// much of it as the floor allows; returns that floor so a caller tracking its own running value
// can clamp it without paying for a second nearest-item scan.
//
// Clamped to walkingRadiusFloorMinutes()..WALKING_RADIUS_MAX_MINUTES so the user feels the limit
// (state.walkingRadiusAtFloor drives the "nothing closer to show" notice in overviewNearestHtml,
// index.html) rather than the radius silently refusing to shrink further. The applied value stays
// continuous -- no snapping to a value grid -- so the ring tracks the gesture smoothly; only the
// displayed label (formatWalkingRadius) rounds to a whole minute.
//
// The ring and the camera framing it (state.walkingDistanceMinutes plus an instant, unanimated
// ensureOverviewTargetsVisible) are updated on every call, so both track the gesture at full
// pointer rate -- canvas-only work, cheap regardless of how often it happens, now that clustering
// is O(n) rather than all-pairs (see buildScreenPointGrid, js/renderer.js). What is not cheap is
// the Nearby list's own HTML re-render and the nearest-item rescan (selectOverview,
// refreshNearestTreeForNearbyOrigin) -- a pinch or trackpad pinch can fire many pointermove events
// inside a single animation frame, and rebuilding the list on every one of them (rather than the
// coarse value-grid steps this used to be rounded to, which throttled it as a side effect) is what
// made zooming out feel jittery once the radius stopped snapping. So only that part is coalesced,
// to at most once per animation frame (the same pattern the inspector drag handle uses for
// recentreMapForInspectorChange, above): the ring and camera keep moving smoothly under the finger
// every tick, and the list catches up a frame behind rather than being rebuilt on every one of
// them and falling behind the input instead.
let _radiusGestureListRefreshFrame = null;

// Called by every gesture-end handler before it runs its own final refreshNearbyRadiusView() --
// otherwise a coalesced list refresh already queued for the next frame (above) could land right
// after it and redo the same work a second time for nothing.
function cancelPendingRadiusGestureRefresh() {
  if (_radiusGestureListRefreshFrame == null) return;
  cancelAnimationFrame(_radiusGestureListRefreshFrame);
  _radiusGestureListRefreshFrame = null;
}

function applyWalkingRadiusGesture(rawMinutes) {
  const floor = walkingRadiusFloorMinutes(nearbyOrigin());
  const atFloor = rawMinutes < floor;
  const flagChanged = atFloor !== state.walkingRadiusAtFloor;
  state.walkingRadiusAtFloor = atFloor;
  const minutes = clamp(rawMinutes, floor, WALKING_RADIUS_MAX_MINUTES);
  if (minutes === state.walkingDistanceMinutes) {
    // Clamping can pin the applied value at the floor while rawMinutes keeps drifting below (or
    // recovers back above) it -- applyWalkingRadiusChange would no-op here since the minutes
    // value itself hasn't moved, so the floor notice needs its own lightweight refresh to stay
    // in sync with the flag instead of going stale.
    // The floor notice lives in the Nearby list, so only that screen has anything to re-render;
    // on Filters/Settings/Report selectOverview() would throw the open screen away instead.
    if (flagChanged) {
      if (!secondaryScreenActive()) selectOverview();
      requestDraw();
    }
    return floor;
  }
  // Same reasoning as applyWalkingRadiusChange: deliberately resizing the ring mid-gesture is
  // the user choosing a radius of their own, which an exact-membership view can no longer
  // promise once that choice is made. Without this, a pinch/wheel gesture over an expanded
  // cluster changed state.walkingDistanceMinutes (and the ring's own drawn size) while
  // nearbyCameraFitPoints/overviewItemsForActiveFilter kept fitting and listing the cluster's
  // own members regardless -- the camera and list silently stopped tracking the gesture.
  exitClusterExpansion({ restoreRadius: false });
  state.walkingDistanceMinutes = minutes;
  syncLiveQueryStringForScreen();
  state.outOfRadiusRevealFilters = [];
  ensureOverviewTargetsVisible({ animate: false, durationMs: OVERVIEW_REFIT_ANIMATION_MS, force: true });
  requestDraw();
  if (_radiusGestureListRefreshFrame == null) {
    _radiusGestureListRefreshFrame = requestAnimationFrame(() => {
      _radiusGestureListRefreshFrame = null;
      refreshNearestTreeForNearbyOrigin();
      if (!secondaryScreenActive()) selectOverview();
      updateNearbyAnchorBar();
    });
  }
  return floor;
}

// --- Wheel and trackpad ------------------------------------------------------------------
//
// A laptop has no two fingers on the glass, so the same "zoom in on what is near me" gesture
// arrives as wheel events: a mouse wheel notch (~100px of deltaY), or a trackpad pinch, which
// every desktop browser reports as a wheel with ctrlKey set. Both resize the walking radius on
// the screens that draw it, exactly as the phone's pinch does -- the map then follows the ring,
// because the Nearby camera frames the ring and nothing else.
//
// One wheel notch takes the same 1.22x step the old map zoom did. A trackpad pinch arrives as a
// stream of much smaller deltas (a whole pinch is often under 100px in total), so it is scaled
// up -- without that, a full pinch would barely move the ring.
const WHEEL_RADIUS_RATE_PER_PIXEL = Math.log(1.22) / 100;
const TRACKPAD_PINCH_RATE_MULTIPLIER = 4;

// How long after the last wheel event the gesture counts as over: the settle animation and the
// "nothing closer to show" notice both key off it, and a wheel has no equivalent of the pinch's
// pointerup to end on. Long enough to span the gap between notches of one deliberate scroll.
const WHEEL_RADIUS_SETTLE_MS = 220;

// deltaY is in whichever unit deltaMode names -- pixels on every trackpad and most wheels, but
// Firefox reports a mouse wheel in lines, and page mode exists. Normalised to pixels so one
// notch means the same step everywhere.
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_PAGE_HEIGHT_PX = 100;

function normalizeWheelPixels(event) {
  const delta = Number(event.deltaY);
  if (!Number.isFinite(delta)) return 0;
  if (event.deltaMode === 1) return delta * WHEEL_LINE_HEIGHT_PX;
  if (event.deltaMode === 2) return delta * WHEEL_PAGE_HEIGHT_PX;
  return delta;
}

// Resizes the walking radius from one wheel event. deltaY < 0 is "zoom in", which shrinks the
// radius -- the same direction the two-finger pinch maps, and the same direction the wheel used
// to zoom the map in.
//
// The running value is kept unrounded in state.wheelRadiusMinutes rather than read back from
// state.walkingDistanceMinutes each time: a trackpad's individual deltas are small enough that
// every single one would round away to the radius it started from, and the ring would never
// move however long the user kept pinching.
function updateNearbyRadiusWheel(event) {
  const pixels = normalizeWheelPixels(event);
  if (!pixels) return;
  const rate = WHEEL_RADIUS_RATE_PER_PIXEL * (event.ctrlKey ? TRACKPAD_PINCH_RATE_MULTIPLIER : 1);
  const base = Number.isFinite(state.wheelRadiusMinutes) ? state.wheelRadiusMinutes : state.walkingDistanceMinutes;
  const rawMinutes = base * Math.exp(pixels * rate);
  const floor = applyWalkingRadiusGesture(rawMinutes);
  // Clamped, unlike the pinch's own running value: a pinch recovers by moving the fingers back,
  // but a wheel only accumulates, so an unclamped value would leave the user scrolling back
  // through everything they overshot by before the ring moved again.
  state.wheelRadiusMinutes = clamp(rawMinutes, floor, WALKING_RADIUS_MAX_MINUTES);
  clearTimeout(state.wheelRadiusSettleTimer);
  state.wheelRadiusSettleTimer = setTimeout(endNearbyRadiusWheel, WHEEL_RADIUS_SETTLE_MS);
}

// The wheel's equivalent of lifting the fingers (endNearbyRadiusPinch below): one smooth settling
// animation, the transient floor notice cleared, and the running value dropped so the next scroll
// starts from wherever the radius actually ended up.
function endNearbyRadiusWheel() {
  state.wheelRadiusSettleTimer = null;
  state.wheelRadiusMinutes = null;
  state.walkingRadiusAtFloor = false;
  cancelPendingRadiusGestureRefresh();
  refreshNearbyRadiusView();
  syncSettingsWalkSlider();
}

// Safari on a Mac does not report a trackpad pinch as a ctrl+wheel the way Chrome and Firefox do
// -- it sends its own gesturestart/gesturechange/gestureend with a cumulative `scale`, which is
// the pinch ratio the two-finger gesture already speaks in. Same mapping as the phone's pinch:
// spreading apart (scale > 1) shrinks the radius.
function startNearbyRadiusGesture() {
  state.gestureRadiusBaseMinutes = state.walkingDistanceMinutes;
}

function updateNearbyRadiusGesture(event) {
  const scale = Number(event && event.scale);
  if (!Number.isFinite(scale) || scale <= 0) return;
  const base = Number.isFinite(state.gestureRadiusBaseMinutes)
    ? state.gestureRadiusBaseMinutes
    : state.walkingDistanceMinutes;
  applyWalkingRadiusGesture(base / scale);
}

function endNearbyRadiusGesture() {
  if (!Number.isFinite(state.gestureRadiusBaseMinutes)) return;
  state.gestureRadiusBaseMinutes = null;
  state.walkingRadiusAtFloor = false;
  cancelPendingRadiusGestureRefresh();
  refreshNearbyRadiusView();
  syncSettingsWalkSlider();
}

// Every screen that draws the walking-radius ring resizes it on a wheel or a trackpad pinch;
// anywhere else (a real selection, which replaces the view) the wheel still zooms the map as it
// always has. Same gate the two-finger pinch uses in setupMapCanvasHandlers below.
function zoomInputResizesNearbyRadius() {
  return Boolean(state.userLocation && (isOverviewScreenActive() || secondaryScreenActive()));
}

function endNearbyRadiusPinch() {
  // Called on every pointerup with fewer than two fingers down (see setupMapCanvasHandlers
  // below), which includes plain single-finger taps/drags that never started a radius pinch --
  // bail out immediately for those instead of forcing selectOverview() over whatever screen
  // is actually active (e.g. a just-tapped selection).
  if (!state.pinchActive) return;
  state.pinchActive = false;
  state.pinchBaseDistance = null;
  state.pinchBaseMinutes = null;
  state.walkingRadiusAtFloor = false;
  // One smooth settling animation now that the gesture has ended, mirroring the single
  // animated re-fit a Settings-slider release triggers (bindSettingsHandlers, index.html).
  cancelPendingRadiusGestureRefresh();
  refreshNearbyRadiusView();
  // The gesture runs over the Settings screen too, where its own slider must not be left
  // showing the radius the ring had before the pinch.
  syncSettingsWalkSlider();
}

// Pointer capture throws (NotFoundError) for a pointer the browser has already finished with --
// which happens routinely on touch when a gesture is interrupted (an incoming call, the app
// backgrounding, the browser claiming the gesture for its own edge swipe). An uncaught throw
// mid-handler used to abort the rest of pointerup, leaving state.dragging true and the lifted
// finger still in state.activePointers forever: the map then ignored every subsequent gesture
// until the page was reloaded.
function capturePointerSafely(element, pointerId) {
  try { element.setPointerCapture(pointerId); } catch {}
}

function releasePointerSafely(element, pointerId) {
  try {
    if (element.hasPointerCapture && !element.hasPointerCapture(pointerId)) return;
    element.releasePointerCapture(pointerId);
  } catch {}
}

// Begins (or resumes) a single-finger pan from wherever the given pointer currently is.
// Shared by pointerdown and the pointerup/pointercancel path that drops a multi-touch gesture
// back to one finger: without the latter, lifting one of two fingers left state.dragging false
// while a finger was still on the glass, so the map went completely dead to that finger --
// the user had to lift off entirely and start again.
function beginMapDrag(clientX, clientY) {
  // The viewport has to be still before dragStart snapshots it -- otherwise the drag and a
  // running animation both write state.viewport.tx/ty and fight each other. pointerdown already
  // stops animations; the multi-touch handover does not, and the pinch it just ended queues an
  // animated settle of its own (endNearbyRadiusPinch -> refreshNearbyRadiusView).
  stopViewportAnimation();
  state.dragging = true;
  state.dragStart = {
    x: clientX,
    y: clientY,
    tx: state.viewport.tx,
    ty: state.viewport.ty,
  };
  els.canvas.classList.add("dragging");
}

function setupMapCanvasHandlers() {
  els.canvas.addEventListener("pointerdown", (event) => {
    stopViewportAnimation();
    capturePointerSafely(els.canvas, event.pointerId);
    state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (state.activePointers.size >= 2) {
      // A second (or third+) touch point arrived -- stop any single-finger drag in progress
      // and, if the Nearby overview is active, start treating the gesture as a radius pinch.
      // Either way the gesture is now multi-touch and must never end up firing handleMapClick
      // (see the pointerup handler): that holds even where the radius pinch itself is ignored
      // -- a two-finger gesture over a selected location used to release as a tap on the map
      // and drop the selection.
      state.multiTouchOccurred = true;
      state.dragging = false;
      els.canvas.classList.remove("dragging");
      // Filters/Settings/Report keep drawing the same walking-radius circle behind them, so the
      // pinch that resizes it works there too -- refreshNearbyRadiusView already knows not to
      // blow those screens' own content away when it re-derives the view.
      if (state.activePointers.size === 2 && state.userLocation
        && (isOverviewScreenActive() || secondaryScreenActive())) {
        startNearbyRadiusPinch();
      }
      return;
    }

    state.moved = false;
    beginMapDrag(event.clientX, event.clientY);
  });

  els.canvas.addEventListener("pointermove", (event) => {
    if (!state.activePointers.has(event.pointerId)) return;
    state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (state.pinchActive) {
      updateNearbyRadiusPinch();
      return;
    }

    if (!state.dragging) return;
    // Compute the drag distance up front so state.moved (which pointerup uses to tell a
    // drag from a tap) and the cluster-detail-clearing rule ("drags the map" per spec)
    // apply the same way regardless of which branch below handles the actual viewport
    // change. Previously these two early-return branches skipped both, so a drag gesture
    // performed while heading-up or auto-repositioning was active still looked like a
    // stationary tap on pointerup and fired handleMapClick -- selecting whatever was under
    // the release point (or resetting to Nearby) instead of just panning/re-fitting.
    const dx = event.clientX - state.dragStart.x;
    const dy = event.clientY - state.dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      state.moved = true;
      state.clusterZoomed = false;
      exitClusterExpansion();
    }
    if (typeof headingUpActive === "function" && headingUpActive()) {
      alignHeadingUpNavigationViewport();
      requestDraw();
      return;
    }
    // A selection's auto-reposition is a correction, not a lock (unlike heading-up above, which
    // genuinely pins the camera to a fitted target). Take the camera over and pan normally.
    // Re-running the fit on every pointermove instead -- as this used to -- meant a selected
    // location with the inspector open could not be panned at all: the fit was already
    // satisfied so most moves did nothing, and the rest restarted a 300ms animation every few
    // milliseconds, which crawled and then snapped back. It read as the map going dead.
    if (shouldAutoRepositionSelection()) markManualCameraOverride();
    state.viewport.tx = state.dragStart.tx + dx;
    state.viewport.ty = state.dragStart.ty + dy;
    requestDraw();
  });

  // Shared tail of pointerup/pointercancel. Whichever fingers are left on the glass decide what
  // happens next -- a gesture is only really over once state.activePointers is empty.
  function endMapPointer(event) {
    state.activePointers.delete(event.pointerId);
    releasePointerSafely(els.canvas, event.pointerId);
    if (state.activePointers.size < 2) endNearbyRadiusPinch();

    if (state.activePointers.size === 1) {
      // Dropped from a multi-touch gesture back to one finger. That finger is still down and
      // still moving, so hand the pan back to it from where it is now (a fresh dragStart, so
      // the map does not jump by however far the two-finger gesture travelled). state.moved
      // stays as it is: this gesture already counts as a drag, never a tap.
      const [remaining] = Array.from(state.activePointers.values());
      state.moved = true;
      beginMapDrag(remaining.x, remaining.y);
      return;
    }

    state.dragging = false;
    els.canvas.classList.remove("dragging");
  }

  els.canvas.addEventListener("pointerup", (event) => {
    // A multi-touch gesture ending (either finger lifting first, one at a time) must never
    // register as a tap -- state.moved only tracks single-finger drag distance, so it stays
    // false throughout one and would otherwise fire handleMapClick once the last finger lifts.
    // multiTouchOccurred stays true across both pointerup events for the gesture, clearing
    // only once every finger is off the glass. Read before endMapPointer, which mutates both.
    const wasClick = !state.moved
      && !state.multiTouchOccurred
      && state.activePointers.size === 1
      && state.activePointers.has(event.pointerId);
    endMapPointer(event);
    if (state.activePointers.size === 0) state.multiTouchOccurred = false;
    if (wasClick) handleMapClick(event);
  });

  els.canvas.addEventListener("pointercancel", (event) => {
    endMapPointer(event);
    if (state.activePointers.size === 0) state.multiTouchOccurred = false;
  });

  // The browser can take a captured pointer away without ever sending pointerup or
  // pointercancel (a system gesture claiming the touch, the tab being backgrounded mid-drag).
  // Without this the gesture state was never torn down and the map stayed stuck in a drag it
  // would never receive another move for.
  els.canvas.addEventListener("lostpointercapture", (event) => {
    if (!state.activePointers.has(event.pointerId)) return;
    endMapPointer(event);
    if (state.activePointers.size === 0) state.multiTouchOccurred = false;
  });

  els.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.clusterZoomed = false;
    exitClusterExpansion();
    if (zoomInputResizesNearbyRadius()) {
      updateNearbyRadiusWheel(event);
      return;
    }
    const factor = event.deltaY < 0 ? 1.22 : 1 / 1.22;
    zoomAt(factor, canvasPoint(event));
  }, { passive: false });

  // Safari's trackpad pinch (see startNearbyRadiusGesture). setupUiZoomLock already stops these
  // from zooming the page itself; here they resize the ring instead, on the same screens the
  // wheel does. Safari alone fires them, so on every other browser these never run.
  els.canvas.addEventListener("gesturestart", (event) => {
    if (!zoomInputResizesNearbyRadius()) return;
    event.preventDefault();
    startNearbyRadiusGesture();
  }, { passive: false });

  els.canvas.addEventListener("gesturechange", (event) => {
    if (!Number.isFinite(state.gestureRadiusBaseMinutes)) return;
    event.preventDefault();
    updateNearbyRadiusGesture(event);
  }, { passive: false });

  els.canvas.addEventListener("gestureend", (event) => {
    if (!Number.isFinite(state.gestureRadiusBaseMinutes)) return;
    event.preventDefault();
    endNearbyRadiusGesture();
  }, { passive: false });

  setupMapHoverHandlers();
}

// Desktop-only: a mouse can rest on a spot without pressing, which is a hover, not a drag --
// something touch has no equivalent of, so this is entirely separate from the drag/pinch
// handling above. Drives the cursor only (pointer over anything tappable, so a click reads as a
// distinct action from a drag before the click even lands -- the OS-level affordance for "this
// is clickable" that canvas content gets none of for free).
function setupMapHoverHandlers() {
  let pendingScreen = null;
  let scheduled = false;

  els.canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    if (state.dragging || state.pinchActive) return;
    // findClusterHit rebuilds every cluster from scratch (see its own comment), and the browser
    // can fire mousemove far faster than that is worth paying for. Coalesced to at most once per
    // animation frame -- only the latest position by the time the frame runs actually matters.
    pendingScreen = canvasPoint(event);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (pendingScreen) updateMapHoverState(pendingScreen);
    });
  });

  els.canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    pendingScreen = null;
    els.canvas.style.cursor = "";
  });
}

function updateMapHoverState(screen) {
  const cluster = findClusterHit(screen);
  const world = screenToWorld(screen.x, screen.y);
  const hit = cluster ? { type: cluster.itemType } : findHit(screen, world);
  els.canvas.style.cursor = (cluster || hit.type !== "none") ? "pointer" : "";
}

function setInspectorMinimized(minimized) {
  const wasMinimized = els.inspector.classList.contains("minimized");
  els.inspector.classList.toggle("minimized", minimized);
  if (wasMinimized && !minimized) {
    // Expanding the inspector is the app's one sanctioned re-frame for an existing selection
    // ("Expand from minimized: recenter once", spec-data-rendering.md), so it takes the camera
    // back from any manual pan the user made while the panel was collapsed.
    clearManualCameraOverride();
  }
  if (wasMinimized && !minimized && state.userLocation && selectedCompassTarget()) {
    if (typeof selectedNavigationHeadingUpActive === "function" && selectedNavigationHeadingUpActive()) {
      // Heading-up navigation has its own scale-fit machinery (alignHeadingUpNavigationViewport),
      // which measures the *actual* current inspector footprint via bestVisibleCanvasRect() --
      // unlike the plain centerViewportOnPointsKeepScale path below, it also honours map
      // rotation and the tilt-aware anchor. Re-centering at the old scale, as that path does,
      // would leave the fit computed against the smaller minimized-inspector footprint the
      // moment the inspector expands to its full (larger) size -- especially likely now that a
      // destination behind the user can occupy most of the screen below the anchor (see
      // headingUpAnchorFraction) -- so the destination could end up rendered behind the
      // newly-expanded inspector. Force a real rescale against the now-larger footprint instead
      // of just recentering at whatever scale was already in effect.
      if (typeof alignHeadingUpNavigationViewport === "function") {
        // assumeInspectorOpen: the class was toggled on the line above, but the inspector's
        // max-height transition has not run yet, so measuring it now reports the minimized
        // size -- the exact thing this branch exists to avoid.
        alignHeadingUpNavigationViewport({
          animate: true,
          durationMs: DEFAULT_VIEWPORT_ANIMATION_MS,
          force: true,
          assumeInspectorOpen: true,
        });
      }
    } else {
      centerViewportOnPointsKeepScale(
        [state.userLocation.point, selectedCompassTarget().point],
        { animate: true, durationMs: DEFAULT_VIEWPORT_ANIMATION_MS, focusVisibleArea: true, assumeInspectorOpen: true }
      );
    }
  } else if (!wasMinimized && minimized) {
    requestDraw();
  }
  if (typeof updateCompassOverlay === "function") updateCompassOverlay();
}

function setupInspectorDragResize() {
  const dragHandle = document.getElementById("inspectorDragHandle");
  if (!dragHandle) return;
  let dragRecenterFrame = null;

  function isMobileLayout() {
    return window.innerWidth <= 850;
  }

  function setInspectorHeight(percent) {
    if (!isMobileLayout()) return;
    const clamped = Math.max(20, Math.min(85, percent));
    state.inspectorHeightPercent = clamped;
    els.inspector.style.setProperty("--inspector-height", `${clamped}%`);
  }

  // options.animate is false while the resize drag is still live, so every intermediate height
  // re-frames the camera instantly, and true once on release for a single settling motion --
  // the same split the walking-radius slider and pinch gesture use. Requesting a fresh 180ms
  // animation on every frame of the drag instead (what this used to do, with the
  // stopViewportAnimation below cancelling the previous one each time) meant the camera never
  // got more than a few milliseconds into any ease before being restarted: it barely moved
  // while the sheet was being dragged, then lurched when the finger came off.
  function recentMapForInspectorChange(options = {}) {
    // Stop any existing viewport animation before starting a new one to prevent conflicts
    stopViewportAnimation();

    const animate = Boolean(options.animate);
    const durationMs = options.durationMs || (animate ? 220 : 0);
    if (!state.userLocation) return;
    if (state.selected && selectedCompassTarget()) {
      centerViewportOnPointsKeepScale(
        [state.userLocation.point, selectedCompassTarget().point],
        { animate, durationMs, focusVisibleArea: true, assumeInspectorOpen: true }
      );
    } else if (isOverviewScreenActive()) {
      ensureOverviewTargetsVisible({ animate, durationMs });
    }
  }

  dragHandle.addEventListener("pointerdown", (event) => {
    if (!isMobileLayout()) return;
    event.preventDefault();
    capturePointerSafely(dragHandle, event.pointerId);
    state.inspectorDragging = true;
    els.inspector.classList.add("is-dragging");
    state.inspectorDragStart = {
      y: event.clientY,
      // 48: the CSS fallback (css/map-ui.css, var(--inspector-height, 48%)) for a sheet that
      // hasn't been manually resized yet.
      heightPercent: state.inspectorHeightPercent || 48,
    };
    dragHandle.classList.add("dragging");
  });

  dragHandle.addEventListener("pointermove", (event) => {
    if (!state.inspectorDragging) return;
    const deltaY = state.inspectorDragStart.y - event.clientY;
    const viewportHeight = window.innerHeight;
    const deltaPercent = (deltaY / viewportHeight) * 100;
    const newPercent = state.inspectorDragStart.heightPercent + deltaPercent;
    setInspectorHeight(newPercent);
    if (dragRecenterFrame == null) {
      dragRecenterFrame = requestAnimationFrame(() => {
        dragRecenterFrame = null;
        recentMapForInspectorChange({ animate: false });
      });
    }
  });

  dragHandle.addEventListener("pointerup", (event) => {
    if (!state.inspectorDragging) return;
    state.inspectorDragging = false;
    els.inspector.classList.remove("is-dragging");
    dragHandle.classList.remove("dragging");
    releasePointerSafely(dragHandle, event.pointerId);
    if (dragRecenterFrame != null) {
      cancelAnimationFrame(dragRecenterFrame);
      dragRecenterFrame = null;
    }
    recentMapForInspectorChange({ animate: true, durationMs: 240 });
  });

  // An interrupted resize (system gesture, backgrounding) has to settle exactly like a normal
  // release -- otherwise the queued per-frame recentre below fires after the drag is over and
  // the map is left mid-resize with no final easing motion.
  dragHandle.addEventListener("pointercancel", (event) => {
    if (!state.inspectorDragging) return;
    state.inspectorDragging = false;
    els.inspector.classList.remove("is-dragging");
    dragHandle.classList.remove("dragging");
    releasePointerSafely(dragHandle, event.pointerId);
    if (dragRecenterFrame != null) {
      cancelAnimationFrame(dragRecenterFrame);
      dragRecenterFrame = null;
    }
    recentMapForInspectorChange({ animate: true, durationMs: 240 });
  });

  window.addEventListener("resize", () => {
    if (!isMobileLayout() && state.inspectorHeightPercent !== null) {
      els.inspector.style.removeProperty("--inspector-height");
      state.inspectorHeightPercent = null;
    }
  });
}

function goToInitialView(updateHash = true) {
  // If compass hasn't fired in >5 s, clear the heading so the map goes north-up
  // rather than showing a frozen direction when the user returns to the overview.
  // New orientation events will re-enable heading-up naturally.
  if (Number.isFinite(state.compassHeading)) {
    const compassAge = state.compassLastEventAt == null
      ? Infinity
      : (performance.now() - state.compassLastEventAt);
    if (compassAge > 5000) {
      state.compassHeading = null;
      state.compassHeadingTarget = null;
      state.nearbyListHeading = null;
      state.renderedNavigationHeading = null;
      state.headingUpEntryAnim = null;
      if (typeof resetCompassCalibration === "function") resetCompassCalibration();
    }
  }

  const wasMinimized = els.inspector.classList.contains("minimized");
  // Before state.selected changes below -- see startCameraOriginTransition (js/app.js).
  startCameraOriginTransition();
  state.selected = null;
  clearManualCameraOverride();
  state.clusterZoomed = false;
  exitClusterExpansion();
  state.filterScreenOpen = false;
  state.searchScreenOpen = false;
  // A /nearby/<slug> page's single category is that page's own lens, not a preference the reader
  // chose -- the Nearby nav button is "take me to the real Nearby", so it puts their actual
  // filters back rather than carrying that category over (see setOverviewFilters' persist:false
  // comment, js/app.js). Except when this goToInitialView() call is itself how the reader is
  // *arriving* at a different /nearby/<slug> page (a SPA link click or a popstate, routed through
  // applyRouteFromUrl -> applyRoute, both of which hold routeApplyDepth open across this call --
  // see their own comments) and the URL already names that page's own category: that arrival's
  // route value is also "", same as the plain Nearby screen's, so without this check the filters
  // applyShowFilterFromQuery() just set moments ago in the very same pass would be restored right
  // back over them before the reader ever saw the new page's own category. A direct call (the
  // Nearby nav button, the Report form's Cancel, the inspector back arrow with no history to
  // retrace) never runs inside that depth, so this never suppresses a genuine "leave" there.
  const arrivingAtLandingPage = routeApplyDepth > 0 && filterKeysFromFindPath(window.location.pathname).length > 0;
  if (state.overviewFiltersEphemeral && !arrivingAtLandingPage) setOverviewFilters(loadStoredOverviewFilters());
  // The Nearby button always shows the real list. A landing's server-rendered list is kept only
  // while the reader is still on that landing (selectOverview's own check), so clear it here.
  _serverRenderedNearbyList = false;
  selectOverview(true);
  setInspectorMinimized(false);
  const refitOverview = () => {
    if (state.userLocation) {
      ensureOverviewTargetsVisible({ animate: true, durationMs: HEADING_UP_NAV_ANIMATION_MS, force: true });
    } else {
      fitToBounds(false, { animate: true, durationMs: HEADING_UP_NAV_ANIMATION_MS });
    }
  };
  if (wasMinimized) {
    // Wait for the panel's own height transition, not whichever descendant transition happens
    // to end first -- see onInspectorHeightTransitionEnd (js/inspector.js).
    onInspectorHeightTransitionEnd(refitOverview);
  } else {
    refitOverview();
  }
  updateCompassOverlay();
  // syncHashFromSelection(), not a bare "": state.selected is cleared above but state.nearbyAnchor
  // is deliberately left alone (the Nearby nav button re-centres the current browse anchor rather
  // than resetting it -- see selectOverview's own comment on showing its back arrow), so the URL
  // this writes must still be able to come out "near=<lat>,<lon>" rather than wrongly forcing it
  // to the real-location "" every time.
  if (updateHash) syncHashFromSelection();
  requestDraw();
}

// A default High Beach location is useful for rendering nearby results, but is not a real GPS
// fix: the location gate must still ask for permission in that case.
function hasRealLocation() {
  return Boolean(state.userLocation) && !state.userLocation.isDefault;
}

function syncInspectorToolsVisibility() {
  if (!els.inspectorTools || els.inspectorTools.hidden) return;
  const hasContent = els.installButton
    && !els.installButton.hidden
    && (typeof getComputedStyle !== "function" || getComputedStyle(els.installButton).display !== "none");
  els.inspectorTools.classList.toggle("tools-empty", !hasContent);
}

function hideWithFade(el, onDone) {
  if (!el || el.hidden) { if (onDone) onDone(); return; }
  if (el.classList.contains("fading-out")) return;
  el.classList.add("fading-out");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.hidden = true;
    el.classList.remove("fading-out");
    if (onDone) onDone();
  };
  el.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 420);
}

// Focus trap + Escape-to-close for the app's modal overlays (WCAG 2.1.2 No Keyboard Trap,
// 2.4.3 Focus Order, 2.4.7 Focus Visible). Moves focus into the container, cycles Tab/Shift+Tab
// between its focusable elements instead of letting focus escape to the map behind it, and
// restores focus to whatever triggered the modal once `deactivate()` runs. `onEscape` is called
// on Escape but is not required — a modal with no dismiss action simply ignores it.
function activateModalFocus(container, { onEscape } = {}) {
  if (!container) return () => {};
  const previouslyFocused = document.activeElement;
  const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusable = () => Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null);

  const first = focusable()[0];
  if (first) first.focus();

  function onKeydown(e) {
    if (e.key === "Escape") {
      if (onEscape) { e.preventDefault(); onEscape(); }
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusable();
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }
  container.addEventListener("keydown", onKeydown);

  return function deactivateModalFocus() {
    container.removeEventListener("keydown", onKeydown);
    if (previouslyFocused && typeof previouslyFocused.focus === "function" && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
  };
}
if (typeof globalThis !== "undefined") globalThis.activateModalFocus = activateModalFocus;
