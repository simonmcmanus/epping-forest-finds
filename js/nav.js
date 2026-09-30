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

// The radius itself stays a continuous value (see applyWalkingRadiusGesture) so the ring tracks
// a pinch or wheel gesture smoothly; only the label rounds, to the nearest whole minute, so the
// displayed number doesn't twitch between fractions as the gesture moves.
//
// The same value with its unit, for anywhere the radius is shown to the user. Sub-minute radii
// (reachable since the floor started tracking finds closer than a minute's walk) read as
// seconds: "15 sec" is how anyone describes that walk, "0.3 min" is not.
function formatWalkingRadius(minutes) {
  if (minutes < 1) return `${Math.round(minutes * 60)} sec`;
  return `${Math.round(minutes)} min`;
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
  );
}

// state.selected is truthy for the Settings/Report pseudo-selections (type "settings"/
// "report") as well as for a real tree/landmark/etc selection, but overview-only rendering
// (the walking-radius ring, the browse-anchor marker and its cone, the off-ring user pointer)
// should stay visible for the pseudo-selections exactly as it does for plain overview/Filters
// -- only a real selection should hide it. Shared by every such renderer.js draw so they can't
// drift out of sync with each other again (they did: the old ambient route lines used to check
// `state.selected` directly and hid themselves on Settings/Report).
function hasRealSelection() {
  return Boolean(state.selected && !["settings", "report"].includes(state.selected.type));
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
}

function applySwUpdate() {
  if (state.swWaiting) {
    state.swPendingReload = true;
    state.swWaiting.postMessage({ type: "SKIP_WAITING" });
    setTimeout(() => location.reload(), 2000);
  } else {
    location.reload();
  }
}

// The three Settings refresh buttons, keyed by the scope of cached state each one throws away.
// They were one "Force refresh" button that always cleared everything — which on this app means
// re-downloading ~67 MB of map data just to pick up a CSS tweak. Splitting them lets the common
// case (a stale build) cost the app shell alone.
const REFRESH_SCOPES = {
  data: { buttonId: "refreshDataButton" },
  app: { buttonId: "refreshAppButton" },
  all: { buttonId: "refreshAllButton" },
};

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

// Does this cache name belong to the scope being refreshed? Cache names gain a "dev-" segment
// when served by the local dev server (injectDevFlag in server.js), so both spellings have to be
// matched or a local "Refresh data" would silently clear nothing.
function cacheMatchesRefreshScope(name, scope) {
  if (!name.startsWith("forest-finds-")) return false;
  if (scope === "all") return true;
  return name.startsWith(`forest-finds-${scope}-`) || name.startsWith(`forest-finds-dev-${scope}-`);
}

// Manual escape hatch for stale PWA state: the normal update flow (setupPwa below)
// relies on the browser noticing sw.js changed and silently activating a new worker
// in the background, which the open tab's own "App version" display only reflects
// after a full reload — sometimes two, since the reload that triggers the update
// check can itself still be served by the outgoing worker. Clearing the cached state
// before reloading sidesteps that timing entirely.
//
//   "data" — drops the cached datasets only. The service worker registration and the cached
//            app shell survive, so the reload re-downloads map data and nothing else.
//   "app"  — unregisters every service worker and drops the cached app shell, leaving the map
//            data alone. This is the "I'm not on the latest build" case, and the one that used
//            to needlessly cost a full data re-download.
//   "all"  — both, i.e. a completely cold start.
//
// Requires connectivity in every scope, since it briefly leaves the app with no offline
// fallback until the fresh install completes.
async function refreshCachedState(scope) {
  if (!navigator.onLine) {
    updateRefreshButtonsOnlineState();
    return;
  }

  const active = REFRESH_SCOPES[scope] && document.getElementById(REFRESH_SCOPES[scope].buttonId);
  refreshScopeButtons().forEach((button) => {
    button.disabled = true;
  });
  if (active) active.textContent = "Refreshing…";

  try {
    // Only an app-level refresh needs the worker itself gone; unregistering for a data refresh
    // would throw away the cached app shell as collateral on the very next install.
    if (scope !== "data" && "serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.filter((name) => cacheMatchesRefreshScope(name, scope)).map((name) => caches.delete(name))
      );
    }
  } catch (error) {
    console.error(error);
  } finally {
    location.reload();
  }
}

// Asks the active service worker to revalidate the cached map data out of band (syncData in
// sw.js). Called once the map is up and interactive rather than during boot, so the freshness
// pass never competes with the render — the load itself is served entirely from cache, and any
// genuinely changed file lands quietly afterwards. The worker throttles this internally, so
// calling it on every load is cheap.
function requestBackgroundDataSync(options) {
  if (!("serviceWorker" in navigator)) return;
  if (!navigator.onLine) return;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return; // First load — nothing cached yet to refresh
  controller.postMessage({ type: "SYNC_DATA", force: Boolean(options && options.force) });
}

// The background sync found newer map data and has already cached it; it only becomes visible
// on the next load, so flag it the same way a pending app update is flagged.
function _markDataUpdateAvailable() {
  state.dataUpdateAvailable = true;
  if (els.settingsToggle) els.settingsToggle.classList.add("has-update");
  refreshSettingsVersionDisplay();
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

    navigator.serviceWorker.register("sw.js")
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          _markSwUpdateAvailable(reg.waiting);
        }
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              _markSwUpdateAvailable(installing);
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
// area, so we use it to shift/shrink the sheet above the keyboard. Scoped to the screens with a
// text input that can summon a keyboard: the Report screen and the Search screen (Settings uses
// a <select>, Filter has no text input).
const REPORT_KEYBOARD_INSET_MIN_PX = 40; // ignore sub-keyboard-sized viewport jitter (e.g. browser chrome show/hide)

function setupReportKeyboardAvoidance() {
  if (!window.visualViewport) return;
  window.visualViewport.addEventListener("resize", handleReportViewportChange);
  window.visualViewport.addEventListener("scroll", handleReportViewportChange);
}

function handleReportViewportChange() {
  if (!els.inspector) return;
  if (state.selected?.type !== "report" && !state.searchScreenOpen) {
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
  const detailsInput = document.getElementById("reportDetails");
  if (detailsInput && document.activeElement === detailsInput) {
    detailsInput.scrollIntoView({ block: "nearest" });
  }
}

function clearReportKeyboardInset() {
  if (!els.inspector || !els.inspector.classList.contains("keyboard-avoiding")) return;
  els.inspector.classList.remove("keyboard-avoiding");
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

  els.locateButton.addEventListener("click", async () => {
    if (!(await ensureTrackingConsent())) return;
    locateUser({ initial: false });
  });

  if (els.locationGateButton) {
    els.locationGateButton.addEventListener("click", async () => {
      els.locationGateButton.disabled = true;
      if (!state.userLocation) {
        if (!(await ensureTrackingConsent())) {
          els.locationGateButton.disabled = false;
          return;
        }
        locateUser({ initial: false });
        // Button re-enabled by setLocationGateVisible(true) when locateUser's callbacks
        // re-show the gate (error message or compass prompt), or stays disabled if gate hides.
      } else {
        await requestCompassPermissionIfNeeded({ fromGesture: true });
        if (state.compassPermission === "granted") {
          setLocationGateVisible(false);
          updateCompassOverlay();
        } else {
          // setLocationGateVisible(true) was called by showCompassAccessPrompt inside
          // requestCompassPermissionIfNeeded, which already re-enabled the button.
          // Guard in case a code path skipped that call.
          if (els.locationGateButton.disabled) els.locationGateButton.disabled = false;
        }
      }
    });
  }

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
      if (typeof dismissCompassCalibrationPrompt === "function") dismissCompassCalibrationPrompt();
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
    els.nearbyToggle.addEventListener("click", () => {
      if (els.nearbyToggle.classList.contains("screen-active") && !els.inspector.classList.contains("minimized")) {
        pulseNavButton(els.nearbyToggle);
        return;
      }
      goToInitialView();
    });
  }

  if (els.reportToggle) {
    els.reportToggle.addEventListener("click", () => {
      if (els.reportToggle.classList.contains("screen-active") && !els.inspector.classList.contains("minimized")) {
        pulseNavButton(els.reportToggle);
        return;
      }
      openReportModal();
    });
  }

  if (els.settingsToggle) {
    els.settingsToggle.addEventListener("click", () => {
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
      // setOverviewFilters only refreshes the Filter screen's own chips/camera -- it has no
      // notion of Search, whose own "Clear all filters" row (searchResultsHtml) needs a
      // rerender too, so the row disappears now that there is nothing left to clear.
      if (state.searchScreenOpen) renderSearchResults();
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
    els.searchToggle.addEventListener("click", () => {
      if (els.searchToggle.classList.contains("screen-active") && !els.inspector.classList.contains("minimized")) {
        pulseNavButton(els.searchToggle);
        const input = document.getElementById("mapSearchInput");
        if (input) input.focus();
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
  ensureOverviewTargetsVisible({ animate, durationMs: OVERVIEW_REFIT_ANIMATION_MS, force: true });
  requestDraw();
}

function applyWalkingRadiusChange(minutes, options = {}) {
  if (state.walkingDistanceMinutes === minutes) return;
  state.walkingDistanceMinutes = minutes;
  // Resizing the ring is the user taking the camera back: whatever out-of-radius match a
  // just-added filter had the fit reaching for (outOfRadiusFitPoints, js/app.js), the ring they
  // are now dragging is the thing they want framed.
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
function setNearbyAnchor(latitude, longitude, point) {
  startNearbyOriginTransition(nearbyRenderOriginPoint());
  state.nearbyAnchor = { latitude, longitude, point };
  // Same reasoning as applyWalkingRadiusChange: moving the browse point is the user choosing
  // what the camera should be looking at.
  state.outOfRadiusRevealFilters = [];
  refreshNearbyRadiusView({ animate: false });
  pushNearbyAnchorHistory();
}

// The counterpart to pushNearbyAnchorHistory (js/app.js), run on every popstate before the URL
// itself is re-applied: puts state.nearbyAnchor back to whatever it was on the history entry
// just landed on, so moving between clusters undoes on the browser back button and the
// inspector's own back arrow exactly like a selection does, instead of leaving the ring wherever
// the last cluster tap left it.
function restoreNearbyAnchorFromHistory() {
  const entry = history.state;
  const snapshot = entry ? entry[NEARBY_ANCHOR_KEY] : null;
  const current = state.nearbyAnchor;
  const unchanged = current && snapshot
    ? current.latitude === snapshot.latitude && current.longitude === snapshot.longitude
    : !current && !snapshot;
  if (unchanged) return;
  stopViewportAnimation();
  state.clusterZoomed = false;
  startNearbyOriginTransition(nearbyRenderOriginPoint());
  state.nearbyAnchor = snapshot
    ? { latitude: snapshot.latitude, longitude: snapshot.longitude, point: projectLonLat(snapshot.longitude, snapshot.latitude) }
    : null;
  state.outOfRadiusRevealFilters = [];
  updateNearbyAnchorBar();
  refreshNearbyRadiusView({ animate: true });
}

// Tapping a grouped set of pins -- a same-category cluster or a cross-category "mega" badge
// (buildSuperClusters, js/renderer.js) alike -- moves the Nearby browse anchor to the group's
// centre and grows the walking radius just far enough to keep every member inside the ring, the
// same way a tap on open ground does (focusNearbyOnMapPoint). The Nearby list then reads "what's
// in this group" on its own, with no separate cluster-list screen to learn -- one interaction
// covers both kinds of group, which is the point: fewer states for the user to hold in mind.
//
// A cluster tap can jump a long way (a mega badge across the ring from a browse anchor set by an
// earlier tap, say), so it narrates the move in three beats rather than one plain ease: zoom out
// far enough to show both where the view is and where it's going, pan across at that width (the
// ring itself lands at its new spot for this whole beat, so it visibly travels rather than
// teleporting), then zoom in to the new ring. See the phase functions below.
const CLUSTER_TOUR_ZOOM_OUT_MS = 350;
const CLUSTER_TOUR_PAN_MS = 450;
const CLUSTER_TOUR_ZOOM_IN_MS = 450;

// Shared by focusNearbyOnClusterGroup (the real camera tour, below) and the mega badge's own
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

function focusNearbyOnClusterGroup(cluster) {
  const items = (cluster.items || []).filter(item => item && item.point
    && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  if (!items.length) return false;

  const { centerPoint, center, targetMinutes } = clusterFocusTarget(items);

  const fromPoint = nearbyRenderOriginPoint() || (nearbyOrigin() && nearbyOrigin().point);
  if (!fromPoint) return false;

  setInspectorMinimized(false);
  stopViewportAnimation();
  // Borrowed from the old cluster-zoom flow: blocks every GPS/compass-driven refit
  // (ensureOverviewTargetsVisible, alignHeadingUpNavigationViewport, the walking-radius
  // grow-back) for as long as it's set, so a fix or a heading tick landing mid-tour cannot
  // stomp the sequence below -- the same reason it existed before this tap stopped opening a
  // separate cluster-detail screen. Cleared once the tour's own final zoom lands.
  state.clusterZoomed = true;

  const focusRect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
  const focusCx = focusRect.x + focusRect.width / 2;
  const focusCy = focusRect.y + focusRect.height / 2;

  // Phase 1's scale: whatever fitting both the current spot and the new one needs, but never
  // wider than the current view already is -- a short hop (the new group already on screen)
  // should not zoom out just to zoom straight back in.
  const savedViewport = { ...state.viewport };
  fitToPoints([fromPoint, centerPoint], false, { focusVisibleArea: true, assumeInspectorOpen: true, animate: false });
  const wideScale = Math.min(state.viewport.scale, savedViewport.scale);
  state.viewport = savedViewport;
  const wideViewport = {
    scale: wideScale,
    tx: focusCx - ((fromPoint.x + centerPoint.x) / 2) * wideScale,
    ty: focusCy - ((fromPoint.y + centerPoint.y) / 2) * wideScale,
  };
  const panViewport = {
    scale: wideScale,
    tx: focusCx - centerPoint.x * wideScale,
    ty: focusCy - centerPoint.y * wideScale,
  };

  // Phase 3: the real final framing (ring + list's own camera fit), computed the normal way
  // once the state below is final -- captured via a direct (animate: false) call and then
  // undone, so it can be eased into from wherever phase 2 actually landed instead of snapping
  // there first and animating away from the snap.
  function zoomInToFinal() {
    const settledViewport = { ...state.viewport };
    // ensureOverviewTargetsVisible (and alignHeadingUpNavigationViewport under it) both refuse
    // to run at all while state.clusterZoomed is set -- the same guard that is deliberately
    // keeping every *other* GPS/compass-driven refit out of this tour would otherwise also
    // block the one call inside it that needs to compute where the tour itself is going.
    // Cleared only for this synchronous computation, restored immediately after.
    state.clusterZoomed = false;
    ensureOverviewTargetsVisible({ animate: false, force: true });
    const finalViewport = { ...state.viewport };
    state.viewport = settledViewport;
    state.clusterZoomed = true;
    animateViewportTo(finalViewport, CLUSTER_TOUR_ZOOM_IN_MS, () => {
      state.clusterZoomed = false;
    });
  }

  // Phase 2: apply the real state change -- the ring, the list and the anchor bar all land on
  // the new group immediately (nothing here is itself animated; only the camera is) -- then pan
  // the camera across to it at the wide scale phase 1 settled on.
  function moveAndSettle() {
    state.nearbyAnchor = { latitude: center.latitude, longitude: center.longitude, point: centerPoint };
    state.walkingDistanceMinutes = targetMinutes;
    state.outOfRadiusRevealFilters = [];
    state.clusterExpanded = null;
    refreshNearestTreeForNearbyOrigin();
    if (!secondaryScreenActive()) selectOverview();
    updateNearbyAnchorBar();
    syncSettingsWalkSlider();
    pushNearbyAnchorHistory();
    animateViewportTo(panViewport, CLUSTER_TOUR_PAN_MS, zoomInToFinal);
  }

  animateViewportTo(wideViewport, CLUSTER_TOUR_ZOOM_OUT_MS, moveAndSettle);
  return true;
}

function clearNearbyAnchor() {
  if (!state.nearbyAnchor) return;
  startNearbyOriginTransition(nearbyRenderOriginPoint());
  state.nearbyAnchor = null;
  state.outOfRadiusRevealFilters = [];
  refreshNearbyRadiusView({ animate: false });
  pushNearbyAnchorHistory();
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
  bar.hidden = !(state.nearbyAnchor && !hasRealSelection());
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
  // Interrupts a cluster tap's own multi-phase camera tour (focusNearbyOnClusterGroup) if one
  // is still running: that tour drives state.viewport with its own chained animateViewportTo
  // calls and leaves state.clusterZoomed set between phases (to keep GPS/compass refits out of
  // its way) until its own final phase clears it. Without this, a plain open-ground tap mid-tour
  // -- the common case here, and the one branch below that does not already route through
  // goToInitialView (which does clear it) -- left clusterZoomed stuck true, silently blocking
  // every later GPS/compass-driven refit until some other interaction happened to reset it.
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
  state.walkingDistanceMinutes = minutes;
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
      state.clusterExpanded = null;
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
    state.clusterExpanded = null;
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
  state.selected = null;
  clearManualCameraOverride();
  state.clusterZoomed = false;
  state.clusterExpanded = null;
  state.filterScreenOpen = false;
  state.searchScreenOpen = false;
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
  if (updateHash) setHashFromSelection("");
  requestDraw();
}

function updateLocateButtonVisibility() {
  const geolocationAvailable = typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  els.locateButton.hidden = !geolocationAvailable || Boolean(state.userLocation);
  syncInspectorToolsVisibility();
}

function syncInspectorToolsVisibility() {
  if (!els.inspectorTools || els.inspectorTools.hidden) return;
  const hasContent = !els.locateButton.hidden
    || (els.installButton && getComputedStyle(els.installButton).display !== "none");
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

function setLocationGateVisible(visible, message, buttonLabel, title) {
  if (!els.locationGate) return;
  if (visible) {
    els.locationGate.classList.remove("fading-out");
    els.locationGate.hidden = false;
    if (els.locationGateButton) els.locationGateButton.disabled = false;
    if (!els.locationGate._deactivateFocus) {
      els.locationGate._deactivateFocus = activateModalFocus(els.locationGate);
    }
  } else {
    if (els.locationGate._deactivateFocus) {
      els.locationGate._deactivateFocus();
      els.locationGate._deactivateFocus = null;
    }
    // When the gate is dismissed (all permissions granted), show loading overlay if data isn't ready yet
    if (!state.dataLoaded && els.loadingOverlay) {
      els.loadingOverlay.hidden = false;
    }
    hideWithFade(els.locationGate);
  }
  if (title && els.locationGateTitle) {
    els.locationGateTitle.textContent = title;
  }
  if (message && els.locationGateMessage) {
    els.locationGateMessage.textContent = message;
  }
  if (els.locationGateButton) {
    els.locationGateButton.textContent = buttonLabel || "Enable location to continue";
  }
}
