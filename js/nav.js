// Walking-radius is a continuous minutes value (both the Settings slider and the Nearby
// view's pinch gesture set it directly -- neither snaps to a fixed stop anymore). These
// remaining "steps" are only tick-mark/label suggestions shown on the Settings slider.
const WALKING_RADIUS_PRESET_MINUTES = [1, 2, 5, 10, 15, 20, 30];

const WALKING_RADIUS_MIN_MINUTES = 1;
const WALKING_RADIUS_MAX_MINUTES = 30;

// How far past the single nearest real item (see walkingRadiusFloorMinutes) the floor sits,
// so that item settles clearly inside the drawn ring instead of sitting right on its edge.
const WALKING_RADIUS_FLOOR_BUFFER = 1.15;

// The walking-radius floor, in minutes, below which the Nearby view would show nothing --
// derived from whichever real item (tree/cow/path/landmark, respecting active filters; same
// priority nearestFallbackEntriesForActiveFilter (index.html) uses for the "nothing in radius"
// list fallback) sits closest to origin. Falls back to WALKING_RADIUS_MIN_MINUTES when there's
// no origin yet, or nothing to measure against (e.g. an empty dataset).
function walkingRadiusFloorMinutes(origin) {
  if (!origin) return WALKING_RADIUS_MIN_MINUTES;
  const nearest = nearestFallbackEntriesForActiveFilter(origin.latitude, origin.longitude)[0];
  if (!nearest) return WALKING_RADIUS_MIN_MINUTES;
  const floorMinutes = metresToWalkingMinutes(nearest.metres * WALKING_RADIUS_FLOOR_BUFFER);
  return clamp(floorMinutes, WALKING_RADIUS_MIN_MINUTES, WALKING_RADIUS_MAX_MINUTES);
}

// Inverse of walkingDistanceToMetres (index.html) -- kept in sync with its 5 km/h assumption.
function metresToWalkingMinutes(metres) {
  return metres * 60 / 5000;
}

// Rounds a continuous walking-radius value to the nearest half-minute: fine enough to feel
// stepless while dragging, coarse enough to avoid floating-point noise in the displayed
// "X min" label and in the overview cache key (see overviewItemsForActiveFilter, index.html).
function roundWalkingMinutes(minutes) {
  return Math.round(minutes * 2) / 2;
}

// Formats a (possibly fractional) walking-time value for display: whole minutes as "5",
// half-minutes as "5.5".
function formatWalkingMinutes(minutes) {
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

// The effective centre for everything the Nearby view shows (walking-radius circle, nearest-
// item list, overview camera fit): state.nearbyAnchor when the user has tapped outside the
// radius to browse another spot, otherwise the real GPS fix. Deliberately NOT used by the
// "You" dot, the compass, or real navigation-to-a-selection -- those always reflect where the
// user actually is.
function nearbyOrigin() {
  return state.nearbyAnchor || state.userLocation;
}

// Filter, Settings, and Report screens all show the map in the background and must
// present the same fixed "zoomed out to show all highlighted locations" view (see
// nearbyCameraFitPoints/ensureOverviewTargetsVisible in index.html and
// drawWalkingRadius/buildNearbyIconLookup in renderer.js).
function secondaryScreenActive() {
  return Boolean(
    state.filterScreenOpen
    || state.selected?.type === "settings"
    || state.selected?.type === "report"
  );
}

// state.selected is truthy for the Settings/Report pseudo-selections (type "settings"/
// "report") as well as for a real tree/landmark/etc selection, but overview-only rendering
// (the walking-radius ring, the dashed routes to nearby matches) should stay visible for the
// pseudo-selections exactly as it does for plain overview/Filters -- only a real selection
// should hide it. Shared by drawWalkingRadius and drawOverviewRoutes in renderer.js so the
// two can't drift out of sync with each other again (they did: drawOverviewRoutes used to
// check `state.selected` directly and hid its route lines on Settings/Report).
function hasRealSelection() {
  return Boolean(state.selected && !["settings", "report"].includes(state.selected.type));
}

function refreshSettingsVersionDisplay() {
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

// Keeps the Settings "Force refresh" button (and its offline note) in sync with
// connectivity, both on first render and whenever the browser's online/offline
// events fire while Settings happens to be open.
function updateForceRefreshOnlineState() {
  const btn = document.getElementById("forceRefreshButton");
  if (!btn) return; // Settings screen isn't currently open
  const note = document.getElementById("forceRefreshOfflineNote");
  const online = navigator.onLine;
  btn.disabled = !online;
  if (note) note.hidden = online;
}

// Manual escape hatch for stale PWA state: the normal update flow (setupPwa below)
// relies on the browser noticing sw.js changed and silently activating a new worker
// in the background, which the open tab's own "App version" display only reflects
// after a full reload — sometimes two, since the reload that triggers the update
// check can itself still be served by the outgoing worker. Unregistering every
// registration and clearing every forest-finds-* cache before reloading sidesteps
// that timing entirely and guarantees the reload after this shows the true latest
// version. Requires connectivity, since it briefly leaves the app with no offline
// fallback until the new install completes.
async function forceRefreshServiceWorker() {
  if (!navigator.onLine) {
    updateForceRefreshOnlineState();
    return;
  }

  const btn = document.getElementById("forceRefreshButton");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Refreshing…";
  }

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.filter((name) => name.startsWith("forest-finds-")).map((name) => caches.delete(name))
      );
    }
  } catch (error) {
    console.error(error);
  } finally {
    location.reload();
  }
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
// area, so we use it to shift/shrink the sheet above the keyboard. Scoped to the Report screen —
// the only screen with a text input that can summon a keyboard (Settings uses a <select>, Filter
// has no text input).
const REPORT_KEYBOARD_INSET_MIN_PX = 40; // ignore sub-keyboard-sized viewport jitter (e.g. browser chrome show/hide)

function setupReportKeyboardAvoidance() {
  if (!window.visualViewport) return;
  window.visualViewport.addEventListener("resize", handleReportViewportChange);
  window.visualViewport.addEventListener("scroll", handleReportViewportChange);
}

function handleReportViewportChange() {
  if (!els.inspector) return;
  if (state.selected?.type !== "report") {
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

  els.inspectorBack.addEventListener("click", () => {
    goToInitialView();
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

function setupSearchAndNavHandlers() {
  els.treeSearchToggle.addEventListener("click", () => {
    const isOpen = !els.treeSearchPanel.hidden;
    els.treeSearchPanel.hidden = isOpen;
    els.treeSearchToggle.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) {
      setInspectorMinimized(false);
      els.treeSearchInput.focus();
    }
  });

  els.treeSearchButton.addEventListener("click", () => {
    searchTreeByNumber();
  });

  els.treeSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchTreeByNumber();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (els.treeSearchPanel.hidden) return;
    if (target.closest("#treeSearchPanel") || target.closest("#treeSearchToggle")) return;
    els.treeSearchPanel.hidden = true;
    els.treeSearchToggle.setAttribute("aria-expanded", "false");
  });

  window.addEventListener("hashchange", () => {
    if (!window.location.hash) {
      if (!secondaryScreenActive()) goToInitialView(false);
      return;
    }
    applySelectionFromHash(false);
  });

  els.inspectorBody.addEventListener("click", (event) => {
    const shareBtn = event.target.closest("[data-action='share-location']");
    if (shareBtn) { shareCurrentLocation(); return; }
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
  ensureOverviewTargetsVisible({ animate, durationMs: OVERVIEW_REFIT_ANIMATION_MS, force: true });
  requestDraw();
}

function applyWalkingRadiusChange(minutes, options = {}) {
  if (state.walkingDistanceMinutes === minutes) return;
  state.walkingDistanceMinutes = minutes;
  refreshNearbyRadiusView(options);
}

// Moves the Nearby view's browse anchor to an arbitrary map point (see nearbyOrigin above),
// leaving the real GPS fix (state.userLocation) untouched. The move is animated by sliding the
// *origin* rather than the camera (startNearbyOriginTransition, index.html), which keeps the
// walking-radius circle still on screen and moves the map behind it -- so the camera itself is
// re-derived per frame from the interpolated origin and must not also be animated here.
function setNearbyAnchor(latitude, longitude, point) {
  startNearbyOriginTransition(nearbyRenderOriginPoint());
  state.nearbyAnchor = { latitude, longitude, point };
  refreshNearbyRadiusView({ animate: false });
}

function clearNearbyAnchor() {
  if (!state.nearbyAnchor) return;
  startNearbyOriginTransition(nearbyRenderOriginPoint());
  state.nearbyAnchor = null;
  refreshNearbyRadiusView({ animate: false });
}

// The Nearby view's "nearest area" is the walking-radius ring drawn around nearbyOrigin().
// Everything the view is about -- the list, the highlighted locations, the route lines -- lives
// inside it, so a tap beyond it reads as "show me what's over there", never as "navigate to
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
  if (!state.userLocation) {
    // No GPS fix yet, so there is no Nearby view to move -- keep the long-standing
    // reset-to-the-whole-forest behaviour rather than anchoring a radius nothing can populate.
    goToInitialView();
    return false;
  }
  if (state.selected || state.clusterExpanded) {
    state.nearbyAnchor = { latitude: lonLat.latitude, longitude: lonLat.longitude, point: worldPoint };
    refreshNearestTreeForNearbyOrigin();
    goToInitialView();
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

// Starts pinch-to-resize for the Nearby view's walking radius. Only engages while the plain
// Nearby overview is showing (no selection, no Filter/Settings/Report screen) -- elsewhere a
// second touch point is just ignored, same as before this feature existed.
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
// pointermove can fire far faster than applyWalkingRadiusChange's real work (a nearest-item
// rescan plus a list re-render) can usefully keep up with on a phone, so values are rounded to
// the nearest half-minute (roundWalkingMinutes) before being applied -- applyWalkingRadiusChange
// already no-ops when that rounded value hasn't moved, so a run of pointermove events landing in
// the same half-minute bucket costs only this arithmetic, same as the old stepped version's
// between-step moves did.
function updateNearbyRadiusPinch() {
  const distance = currentPinchDistance();
  if (distance == null || !state.pinchBaseDistance) return;
  const ratio = distance / state.pinchBaseDistance;
  const rawMinutes = state.pinchBaseMinutes / ratio;
  const floor = walkingRadiusFloorMinutes(nearbyOrigin());
  const clamped = clamp(rawMinutes, floor, WALKING_RADIUS_MAX_MINUTES);
  const atFloor = rawMinutes < floor;
  const flagChanged = atFloor !== state.walkingRadiusAtFloor;
  state.walkingRadiusAtFloor = atFloor;
  const minutes = roundWalkingMinutes(clamped);
  if (minutes === state.walkingDistanceMinutes) {
    // Rounding can pin the applied value at the floor while rawMinutes keeps drifting below (or
    // recovers back above) it -- applyWalkingRadiusChange would no-op here since the minutes
    // value itself hasn't moved, so the floor notice needs its own lightweight refresh to stay
    // in sync with the flag instead of going stale.
    if (flagChanged) { selectOverview(); requestDraw(); }
    return;
  }
  applyWalkingRadiusChange(minutes, { animate: false });
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
  refreshNearbyRadiusView();
}

function setupMapCanvasHandlers() {
  els.canvas.addEventListener("pointerdown", (event) => {
    stopViewportAnimation();
    els.canvas.setPointerCapture(event.pointerId);
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
      if (state.activePointers.size === 2 && isOverviewScreenActive() && state.userLocation) {
        startNearbyRadiusPinch();
      }
      return;
    }

    state.dragging = true;
    state.moved = false;
    state.dragStart = {
      x: event.clientX,
      y: event.clientY,
      tx: state.viewport.tx,
      ty: state.viewport.ty,
    };
    els.canvas.classList.add("dragging");
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
    if (shouldAutoRepositionSelection()) {
      ensureUserAndSelectionVisible({ animate: true, durationMs: 300 });
      return;
    }
    state.viewport.tx = state.dragStart.tx + dx;
    state.viewport.ty = state.dragStart.ty + dy;
    requestDraw();
  });

  els.canvas.addEventListener("pointerup", (event) => {
    state.activePointers.delete(event.pointerId);
    els.canvas.releasePointerCapture(event.pointerId);
    els.canvas.classList.remove("dragging");
    if (state.activePointers.size < 2) endNearbyRadiusPinch();
    // A multi-touch gesture ending (either finger lifting first, one at a time) must never
    // register as a tap -- state.moved only tracks single-finger drag distance, so it stays
    // false throughout one and would otherwise fire handleMapClick once the last finger lifts.
    // multiTouchOccurred stays true across both pointerup events for the gesture, clearing
    // only once every finger is off the glass.
    const wasClick = !state.moved && !state.multiTouchOccurred && state.activePointers.size === 0;
    state.dragging = false;
    if (state.activePointers.size === 0) state.multiTouchOccurred = false;
    if (wasClick) handleMapClick(event);
  });

  els.canvas.addEventListener("pointercancel", (event) => {
    state.activePointers.delete(event.pointerId);
    state.dragging = false;
    els.canvas.classList.remove("dragging");
    if (state.activePointers.size < 2) endNearbyRadiusPinch();
    if (state.activePointers.size === 0) state.multiTouchOccurred = false;
  });

  els.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.clusterZoomed = false;
    state.clusterExpanded = null;
    const factor = event.deltaY < 0 ? 1.22 : 1 / 1.22;
    zoomAt(factor, canvasPoint(event));
  }, { passive: false });
}

function setInspectorMinimized(minimized) {
  const wasMinimized = els.inspector.classList.contains("minimized");
  els.inspector.classList.toggle("minimized", minimized);
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
    dragHandle.setPointerCapture(event.pointerId);
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
        recentMapForInspectorChange({ animate: true, durationMs: 180 });
      });
    }
  });

  dragHandle.addEventListener("pointerup", (event) => {
    if (!state.inspectorDragging) return;
    state.inspectorDragging = false;
    els.inspector.classList.remove("is-dragging");
    dragHandle.classList.remove("dragging");
    if (dragRecenterFrame != null) {
      cancelAnimationFrame(dragRecenterFrame);
      dragRecenterFrame = null;
    }
    recentMapForInspectorChange({ animate: true, durationMs: 240 });
  });

  dragHandle.addEventListener("pointercancel", () => {
    if (!state.inspectorDragging) return;
    state.inspectorDragging = false;
    els.inspector.classList.remove("is-dragging");
    dragHandle.classList.remove("dragging");
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
      state.renderedNavigationHeading = null;
      state.headingUpEntryAnim = null;
      if (typeof resetCompassCalibration === "function") resetCompassCalibration();
    }
  }

  const wasMinimized = els.inspector.classList.contains("minimized");
  state.selected = null;
  state.clusterZoomed = false;
  state.clusterExpanded = null;
  state.filterScreenOpen = false;
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
    let refitTriggered = false;
    const triggerRefit = () => {
      if (refitTriggered) return;
      refitTriggered = true;
      refitOverview();
    };
    els.inspector.addEventListener("transitionend", triggerRefit, { once: true });
    setTimeout(triggerRefit, INSPECTOR_MINIMIZE_TRANSITION_TIMEOUT_MS);
  } else {
    refitOverview();
  }
  updateCompassOverlay();
  if (updateHash) setHashFromSelection();
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
    || !els.treeSearchPanel.hidden
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

function setLocationGateVisible(visible, message, buttonLabel, title) {
  if (!els.locationGate) return;
  if (visible) {
    els.locationGate.classList.remove("fading-out");
    els.locationGate.hidden = false;
    if (els.locationGateButton) els.locationGateButton.disabled = false;
  } else {
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
