// Epping Forest Finds — application boot and wiring.
//
// Extracted from the inline <script> in index.html so the page stays markup-only,
// per spec/agents.md "Project Structure". Loads last, after every js/*.js module.
const TREE_URL = "Veteran_Tree_Register.json";
const TREE_ENRICHED_URL = "Veteran_Tree_Register.enriched.with_named_trees.json";
const TREE_CHUNK_INDEX_URL = "data/trees/index.json";
const LANDMARK_URLS = [
  "data/local-landmarks-food.geojson",
  "data/local-landmarks-transport.geojson",
  "data/local-landmarks-gates.geojson",
  "data/local-landmarks-facilities.geojson",
  "data/local-landmarks-historic.geojson",
  "data/local-landmarks-tourism.geojson",
  "data/local-landmarks-misc.geojson"
];
const FOLKLORE_URL = "data/epping_forest_folklore_locations.json";
const PATHS_URL = "data/local-paths.geojson";
const ROADS_URL = "data/local-roads.geojson";
const ENVIRONMENT_URL = "data/local-environment.geojson";
const BUILDINGS_URL = "data/local-environment-buildings.geojson";
const COW_PROXY_URL_BASE = "/api/cows?center=";
const COW_SOURCE_URL_BASE = "https://account.nofence.no/api/open/data/?center=";
const COW_DATA_CACHE_KEY = "forest-finds-cow-data-v1";
const REPORT_DRAFT_KEY = "forest-finds-report-draft-v1";
const REPORT_REQUEST_ID_KEY = "forest-finds-report-request-id-v1";
const FILTER_STATE_KEY = "forest-finds-filter-state-v1";
const FILTER_HINT_KEY = "forest-finds-filter-hint-v1";
// Matches onboarding.js's own default selection and spec.md's "Default filters" section:
// only Trees and Cows are pre-selected before onboarding ever runs.
const DEFAULT_FILTERS = ["trees", "cows"];
const COW_REFRESH_MS = 5 * 60 * 1000;
const IS_LOCAL_COW_CACHE_MODE = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const DEFAULT_COW_CENTER = { longitude: 0.06371428038973509, latitude: 51.656022523996725 };
const FEATURE_LAYERS = [
  { key: "forest", label: "Epping Forest land", url: "data/epping-forest-land.geojson" },
  { key: "buffer", label: "Buffer land", url: "data/epping-buffer-land.geojson" },
];
const EARTH_RADIUS_METRES = 6371008.8;

// Named camera-animation durations. Each replaces an exact pre-existing literal that
// was independently repeated across multiple call sites for the same transition, so
// this changes nothing about how any of them feel -- it just gives the recurring
// values one name instead of several copies. One-off durations tuned for a single
// specific transition are left as plain literals rather than forced into single-use
// names.
const NEARBY_ORIGIN_TRANSITION_MS = 520; // slide between two browse origins -- see nearbyRenderOriginPoint()
const NEARBY_REVEAL_MS = 180; // how quickly the new nearby set fades in once a slide lands -- see nearbyRevealOpacity()
const OVERVIEW_REFIT_ANIMATION_MS = 420; // recompute the overview/secondary-screen camera fit after a UI state change (filter change, opening Filter/Settings/Report, radius toggle, a late location fix)
const OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS = 520; // ensureOverviewTargetsVisible's (and centerOverviewOnUserLocation's) own default when a caller doesn't specify one
const HEADING_UP_NAV_ANIMATION_MS = 500; // standard duration for heading-up alignment and selection-commit transitions (goToInitialView, zoomToSelection)
const MIN_HEADING_UP_ANIMATION_MS = 200; // floor for animateToHeadingUpNavigationViewport's duration
const DEFAULT_VIEWPORT_ANIMATION_MS = 480; // generic fallback duration for the low-level viewport animators when nothing else is specified
const MIN_VIEWPORT_ANIMATION_MS = 180; // floor for animateViewportTo's duration
const FIRST_LOAD_REVEAL_ANIMATION_MS = 700; // the first-time "reveal the map" animation, in all its variants (fit to user+items, centered-on-user, or the no-location zoom pulse)
const HEADING_UP_CANVAS_OVERSCAN_RATIO = 1.5; // sqrt(2)≈1.414 is the 45° corner case minimum; 1.5 keeps safety margin
const DEFAULT_FIT_PADDING_PX = 54; // default screen-space padding for fitToPoints (around content bounds)
const OVERVIEW_FIT_PADDING_PX = 28; // tighter padding for overview targets fit
const TILT_BETA_THRESHOLD = 12;    // deg above flat before perspective kicks in
const TILT_BETA_MAX = 85;          // deg where max perspective angle is reached
const TILT_HORIZON_GROUND_RATIO = 0.62; // fraction of the space above the pivot that shows ground (vs. sky) at TILT_ROTATEX_MAX -- see tiltPerspectivePx()
const TILT_PERSPECTIVE_MIN_PX = 260;    // floor so very short/cramped viewports don't collapse the camera distance towards an unstable near-0 value
const TILT_PERSPECTIVE_MAX_PX = 2600;   // ceiling so very tall viewports (tablets) don't stretch the camera distance into an implausibly flat, barely-tilted look
const TILT_ROTATEX_MAX = 75;       // max rotateX deg — 2× overscan hides the canvas edge even at this angle
// Precomputed once: calibrating tiltPerspectivePx() against this fixed reference
// angle (rather than the live, ever-changing tiltRotateXDeg()) keeps the camera
// distance from collapsing at low/mid tilt angles -- see tiltPerspectivePx().
const TILT_HORIZON_REFERENCE_TAN = Math.tan(TILT_ROTATEX_MAX * Math.PI / 180);
// Tilt is projected in JS (see tiltProjectOffsets), not by CSS-rotating the finished
// bitmap, so the canvas never needs to be oversized for tilt — only for the heading-up
// rotation, which HEADING_UP_CANVAS_OVERSCAN_RATIO already covers. The former
// HEADING_UP_CANVAS_OVERSCAN_RATIO_TILT (3.5) and its grow/shrink hysteresis are gone:
// extra canvas below the pivot actively *caused* the 3D drop-outs it was meant to fix,
// by pushing the rotated plane through the camera at ever lower tilt angles.

// Smallest rotateX difference between the drawn main canvas and the live camera worth a
// redraw for (see tiltRenderStale). Small enough that no drift is visible, large enough that
// sensor noise on a phone held still doesn't repaint the map every frame.
const TILT_RENDER_STALE_DEG = 0.05;
const TILT_NEAR_PLANE_RATIO = 0.98; // fraction of the camera distance the near clip sits at — see tiltProjectOffsets
// Perspective scale below which ground is deep enough into the horizon haze to be
// invisible, and so not worth drawing. Bounds how much world the draw loop walks in 3D
// ("to the horizon" must not mean "every road in the dataset"). The clip lands this
// fraction of the pivot-to-horizon distance below the horizon, i.e. well inside the
// fully-erased end of drawTiltDistanceFade's gradient — keep it small enough that the
// clip stays hidden there, or the ground visibly stops short of the horizon again.
const TILT_FAR_FADE_RATIO = 0.1;
// Ahead of the pivot the tilt projection compresses distance into the horizon
// asymptotically: a point deep enough ahead stays technically inside the focus rect at
// ANY scale while rendering as a speck in the horizon haze. So the tilt-aware fit
// (maxScaleForHeadingUpPoints with projectTilt) caps how deep the farthest fitted point
// may sit, expressed as the perspective scale it renders at -- the same language as
// TILT_FAR_FADE_RATIO above, and comfortably above it (0.1 is where the distance fade
// has erased the ground completely). Chosen by measurement: see
// claude/heading-up-tilt-aware-fit.md.
const TILT_FIT_MIN_PERSPECTIVE_SCALE = 0.45;
const TILT_PIN_COLLAPSE_BAND_PX = 130; // screen-px width of the ahead/behind transition band pins shrink across
const TILT_PIN_COLLAPSE_MIN_SCALE = 0.3; // size pins settle at once fully behind, rather than vanishing
const MAX_CANVAS_DIMENSION = 3072;
const MAX_CANVAS_PIXEL_COUNT = 9437184;
const APP_VERSION = "v31"; // Fallback shown before state.swVersion loads from caches.keys() (see setupPwa in nav.js) — keep in sync with APP_CACHE_NAME in sw.js.
const COMPASS_PERMISSION_KEY = "forest-finds-compass-permission-v1";
// Declared up here with the other boot-time constants, not next to the compass
// functions below that use them: setupVisibilityRecovery() runs inside boot(), which
// is called long before that point in the file, and a const is in its temporal dead
// zone until its declaration executes -- reading one from boot() throws and takes the
// whole app down.
// How long without a heading-bearing orientation event before the compass counts as
// stalled. iOS stops delivering deviceorientation while the screen is off or the tab is
// backgrounded, and does not reliably resume on its own when it comes back.
const COMPASS_STALE_MS = 15000;
// How often the foreground watchdog re-checks the sensors. Everything it calls is a
// no-op unless something has actually gone quiet. Deliberately the same cadence the
// GPS-only check used before the compass joined it: restartStaleGpsWatch() can tear down
// and re-create the watch, which lands a fresh fix and a repaint, and running that twice
// as often measurably destabilised the e2e specs that diff two consecutive canvas draws.
const SENSOR_WATCHDOG_INTERVAL_MS = 10000;
// Orientation events arriving with no usable heading (no alpha / webkitCompassHeading)
// mean the sensor is alive but the magnetometer wants re-calibrating -- common after the
// phone has been asleep. Re-registering listeners cannot fix that; physically moving the
// phone can, so past this long we surface the existing "move your phone" prompt instead.
const COMPASS_HEADINGLESS_PROMPT_MS = 2500;
// Heading sources, worst to best. Chrome on Android fires BOTH `deviceorientationabsolute`
// (alpha referenced to magnetic north) and `deviceorientation` (alpha referenced to an
// arbitrary zero picked when the sensor started, and free to drift), and both land in
// onDeviceOrientation. Feeding the two into one heading as if they meant the same thing made
// compassHeadingTarget flip between a true bearing and an arbitrary one many times a second:
// "sometimes a bit off, sometimes completely wrong". It also meant the calibration gate never
// saw four readings agree within 6deg, so a cold start always fell through its 6s safety valve
// and trusted whatever mix of the two streams it happened to be holding. Ranking the sources
// and never letting a worse one overwrite a better one is what keeps the two apart. Ranked
// rather than simply requiring absolute so that a browser which only ever fires the relative
// event still gets a compass -- a drifting heading is worse than a true one but much better
// than none, and it is dropped the moment a north-referenced reading arrives.
// Declared up here with the other boot-time constants because `state` below reads
// HEADING_SOURCE_NONE at module-eval time, and a const is in its temporal dead zone until
// its own declaration has run.
const HEADING_SOURCE_NONE = 0;
const HEADING_SOURCE_RELATIVE = 1; // alpha with no north reference -- drifts, arbitrary zero
const HEADING_SOURCE_ABSOLUTE = 2; // webkitCompassHeading, or alpha flagged absolute
// How long a requested animation frame may stay pending before the foreground watchdog
// treats the loop that asked for it as wedged. A frame runs within ~16ms; two seconds is
// far past any plausible scheduling delay on a loaded phone.
const ANIMATION_FRAME_WEDGED_MS = 2000;
const STORED_COMPASS_PERMISSION = (() => {
  try {
    const stored = localStorage.getItem(COMPASS_PERMISSION_KEY) || "unknown";
    // iOS requires DeviceOrientationEvent.requestPermission() from a user gesture
    // each session before orientation events fire — even if previously granted.
    // Restoring "granted" would skip that per-session call, so treat it as "unknown"
    // to ensure the gate shows and the user can tap to re-enable.
    if (stored === "granted"
        && typeof DeviceOrientationEvent !== "undefined"
        && typeof DeviceOrientationEvent.requestPermission === "function") {
      return "unknown";
    }
    return stored;
  } catch {
    return "unknown";
  }
})();
// Filter groups, tag functions, and display mappings live in js/categories.js

const state = {
  trees: [],
  landmarks: [],
  paths: [],
  roads: [],
  environmentFeatures: [],
  waterFeatures: [],
  layers: [],
  bounds: null,
  namedTreeStoriesByName: new Map(),
  fitScale: 1,
  baseFitScale: 1,
  viewport: { scale: 1, tx: 0, ty: 0 },
  selected: null,
  userLocation: null,
  // Browse override for the Nearby view: set by tapping open map ground -- anywhere, at
  // any distance (see focusNearbyOnMapPoint in js/nav.js). Never touches the real
  // GPS fix (userLocation) -- the "You" dot, compass bearings, and real navigation-to-a-
  // selection all stay keyed to userLocation; only the radius circle, the nearby list,
  // and the overview camera fit read through nearbyOrigin() (js/nav.js), which prefers
  // this over userLocation when set.
  nearbyAnchor: null,
  // In-flight slide between two browse origins -- see nearbyRenderOriginPoint().
  nearbyOriginTransition: null,
  activePointers: new Map(),
  pinchActive: false,
  pinchBaseDistance: null,
  pinchBaseMinutes: null,
  multiTouchOccurred: false,
  // The selection (by object identity) whose camera the user has taken over by panning or
  // zooming by hand. While it matches state.selected, the GPS-driven "keep user + target
  // framed" follow stands down -- see shouldAutoRepositionSelection(). Without it the
  // follow re-fitted the camera on every pointermove and every GPS fix, so a selected
  // location's map could not be dragged anywhere at all. Keyed on the selection rather
  // than held as a flag so picking a different location hands the camera straight back,
  // with nothing to remember to reset.
  manualCameraOverrideFor: null,
  userInMapArea: false,
  nearestTree: null,
  nearestCow: null,
  nearestPub: null,
  nearestRestaurant: null,
  nearestLandmark: null,
  nearestPlace: null,
  cows: [],
  cowPastures: [],
  cowLastUpdatedAt: null,
  cowRefreshTimerId: null,
  cowDetailTimerId: null,
  cowFetchInFlight: false,
  // Filter keys just switched on that have nothing inside the walking radius, so the Nearby
  // camera reaches their nearest match once -- see refreshOutOfRadiusReveal/outOfRadiusFitPoints.
  outOfRadiusRevealFilters: [],
  overviewFilters: (() => {
    try {
      const d = JSON.parse(localStorage.getItem(FILTER_STATE_KEY) || "null");
      if (d && Array.isArray(d.filters)) return sanitizeOverviewFilters(d.filters);
    } catch {}
    return DEFAULT_FILTERS.slice();
  })(),
  overviewExpandedGroups: (() => {
    try {
      const d = JSON.parse(localStorage.getItem(FILTER_STATE_KEY) || "null");
      if (d && Array.isArray(d.expandedGroups)) return sanitizeExpandedGroups(d.expandedGroups);
    } catch {}
    return [];
  })(),
  filterScreenOpen: false,
  distanceWarningShown: false,
  nearestItemsCount: 10,
  walkingDistanceMinutes: 5,
  walkingRadiusAtFloor: false,
  // The wheel/trackpad radius gesture's running (unrounded) value and its settle timer --
  // a wheel has no pointerup to end on, so the gesture ends on a timeout instead
  // (updateNearbyRadiusWheel/endNearbyRadiusWheel, js/nav.js).
  wheelRadiusMinutes: null,
  wheelRadiusSettleTimer: null,
  // Safari's trackpad pinch (gesturestart/change/end) measures from where the gesture began,
  // like the two-finger pinch does -- see startNearbyRadiusGesture, js/nav.js.
  gestureRadiusBaseMinutes: null,
  showAllOutsideRadius: false,
  compassHeading: null,
  compassHeadingTarget: null,
  nearbyListHeading: null, // heading the Nearby list is ordered by -- see headsUpSortedEntries
  compassPermission: STORED_COMPASS_PERMISSION,
  compassCalibrationSamples: [],
  compassCalibrationStartedAt: null,
  compassCalibrationPromptVisible: false,
  compassCalibrationPromptDismissed: false,
  calibrationViewportSyncFrame: null,
  locationWatchId: null,
  dragging: false,
  moved: false,
  dragStart: null,
  installPrompt: null,
  swUpdateAvailable: false,
  dataUpdateAvailable: false,
  swVersion: "",
  swWaiting: null,
  swPendingReload: false,
  animationFrame: null,
  overlayAnimationFrame: null,
  compassAnimationFrame: null,
  // When each parked handle above was requested, cleared when its callback actually runs --
  // see recoverWedgedAnimationFrames().
  animationFrameRequestedAt: null,
  overlayAnimationFrameRequestedAt: null,
  compassAnimationFrameRequestedAt: null,
  viewportAnimationFrameRequestedAt: null,
  compassAnimationTime: null,
  compassArrowAngle: null,
  compassLastEventAt: null,
  orientationLastEventAt: null,
  // Best heading source seen so far this session -- see orientationHeadingSource().
  compassHeadingSource: HEADING_SOURCE_NONE,
  headingUpScaleEaseAt: null, // timestamp the heading-up scale ease last integrated (see resolveHeadingUpTargetScale)
  headingUpScaleEasing: false, // latch: the heading-up scale ease is mid-glide (see resolveHeadingUpTargetScale)
  lastLocationUpdateAt: null,
  rawUserLocation: null, // the unfiltered GPS fix; state.userLocation is the smoothed one (see ingestLocationFix)
  locationGlide: null, // in-flight glide of the smoothed position toward the latest fix
  locationSmoothedAt: null, // timestamp the location low-pass last ran
  navigationHeadingUp: false,
  renderedNavigationHeading: null,
  headingUpEntryAnim: null,
  tiltBetaTarget: 0,
  tiltBetaSmoothed: 0,
  // rotateX angle baked into the main canvas by the last draw() -- see tiltRenderStale().
  renderedTiltRotateXDeg: 0,
  tiltWasActive: false,
  selectionViewportTransitionPending: false,
  viewportAnimationFrame: null,
  viewportAnimationFrom: null,
  viewportAnimationTo: null,
  viewportAnimationStartTime: null,
  viewportAnimationDuration: 0,
  emojiScaleAnimated: null,
  inspectorDragging: false,
  inspectorDragStart: null,
  inspectorHeightPercent: null,
  reportDraftLocation: null,
  reportSubmitting: false,
  buildingFeatures: [],
  buildingsLoaded: false,
  buildingsLoading: false,
  buildingsRevealStartTime: null,
  routingGraph: null,
  routingGraphReady: false,
  routingGraphBuilding: false,
  selectedRouteCache: null,
  overviewOutsideRadiusFallback: false,
  clusterZoomed: false,
  clusterExpanded: null,
  transportLookupCache: new Map(),
  transportLookupRequests: new Map(),
  dataLoaded: false,
  canvasInsetX: 0,
  canvasInsetY: 0,
  canvasVisibleWidth: 0,
  canvasVisibleHeight: 0,
};

// Per-frame cache for the non-assume-open overlap rect. undefined = uncached;
// null = cached "no overlap". Cleared at start of each draw() and compass tick.
let _overlapRectCache = undefined;
// Per-frame snapshot of the tilt camera (see tiltProjection). Shares its invalidation
// points with _overlapRectCache — the camera distance is derived from the same visible
// rect, so anything that invalidates one invalidates the other.
let _tiltProjectionCache = undefined;
// Per-frame freeze of the interpolated browse origin -- see computeNearbyRenderOriginPoint().
// Keyed on the anchor object it was computed for, so any reassignment of state.nearbyAnchor
// invalidates it without the assigning code having to remember to (focusNearbyOnMapPoint's
// exit-a-selection path sets the anchor directly, and a frame-old cached origin there framed
// the camera on the spot the user had just left).
let _nearbyRenderOriginCache = undefined;
let _nearbyRenderOriginCacheAnchor = null;

const els = {
  canvas: document.getElementById("mapCanvas"),
  overlayCanvas: document.getElementById("overlayCanvas"),
  mapStage: document.querySelector(".map-stage"),
  compassArrow: document.getElementById("compassArrow"),
  compassCalibrationBanner: document.getElementById("compassCalibrationBanner"),
  compassCalibrationBannerDismiss: document.getElementById("compassCalibrationBannerDismiss"),
  filterToggle: document.getElementById("filterToggle"),
  filterCount: document.getElementById("filterCount"),
  nearbyToggle: document.getElementById("nearbyToggle"),
  locateButton: document.getElementById("locateButton"),
  installButton: document.getElementById("installButton"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  locationGate: document.getElementById("locationGate"),
  locationGateTitle: document.getElementById("locationGateTitle"),
  locationGateMessage: document.getElementById("locationGateMessage"),
  locationGateButton: document.getElementById("locationGateButton"),
  distanceWarning: document.getElementById("distanceWarning"),
  distanceWarningMessage: document.getElementById("distanceWarningMessage"),
  distanceWarningButton: document.getElementById("distanceWarningButton"),
  inspector: document.getElementById("inspector"),
  inspectorBack: document.getElementById("inspectorBack"),
  inspectorTitleEmoji: document.getElementById("inspectorTitleEmoji"),
  inspectorTitle: document.getElementById("inspectorTitle"),
  inspectorType: document.getElementById("inspectorType"),
  inspectorBody: document.getElementById("inspectorBody"),
  inspectorTools: document.querySelector(".inspector-tools"),
  inspectorHeader: document.querySelector(".inspector-header"),
  nearbyAnchorBar: document.getElementById("nearbyAnchorBar"),
  closeInspector: document.getElementById("closeInspector"),
  treeSearchToggle: document.getElementById("treeSearchToggle"),
  treeSearchPanel: document.getElementById("treeSearchPanel"),
  treeSearchInput: document.getElementById("treeSearchInput"),
  treeSearchButton: document.getElementById("treeSearchButton"),
  reportToggle: document.getElementById("reportToggle"),
  settingsToggle: document.getElementById("settingsToggle"),
  inspectorActions: document.querySelector(".inspector-actions"),
};

boot();

async function boot() {
  initTracker();
  setupPwa();
  setupUiZoomLock();
  setupInteractions();
  resizeCanvas();
  draw();

  // Capture URL hash before any selectOverview() call clears it via syncHashFromSelection()
  const startHash = window.location.hash;

  // Start data loading immediately so it runs in parallel with location and onboarding
  const hasCachedCowData = applyCachedCowData();
  setLoadStep("cows", "loading");
  const cowPromise = IS_LOCAL_COW_CACHE_MODE && hasCachedCowData
    ? Promise.resolve(true)
    : refreshCowData({ force: true, timeoutMs: 7000 });
  const mapPromise = loadMapData();

  // Kick off location request — this fires the browser permission dialog automatically
  // and runs in parallel with data loading so the map can open centred on the user.
  let locationPromise = null;
  let locationAskedInOnboarding = false;

  if (!hasCompletedOnboarding()) {
    // First visit: show onboarding while data loads behind it.
    // The location request is fired from within the onboarding tap handler so the
    // browser dialog appears at the natural moment; we just pick up the live promise.
    if (els.loadingOverlay) els.loadingOverlay.hidden = true;
    const onboardResult = await showOnboarding();
    state.overviewFilters = sanitizeOverviewFilters(onboardResult.filters);
    saveFilterState();
    if (els.loadingOverlay) els.loadingOverlay.hidden = false;
    if (onboardResult.locationPromise) {
      setLoadStep("location", "loading");
      locationPromise = onboardResult.locationPromise;
      locationAskedInOnboarding = true;
    }
  } else if (navigator.geolocation) {
    // Returning user: start location request immediately so the browser dialog
    // appears while data loads — no tap needed to trigger it.
    setLoadStep("location", "loading");
    locationPromise = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ ok: true, position: pos }),
        () => resolve({ ok: false }),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  } else {
    setLocationGateVisible(true, "This browser does not support location access.");
  }

  try {
    await mapPromise;

    state.bounds = calculateBounds();
    const cowBootstrapOk = await cowPromise;
    setLoadStep("cows", cowBootstrapOk || state.cows.length > 0 ? "done" : "error", state.cows.length);
    scheduleCowRefresh();
    fitToBounds();
    els.locateButton.disabled = false;
    updateLocateButtonVisibility();

    state.dataLoaded = true;

    if (locationPromise) {
      // Await the location request that was started in parallel with data loading,
      // but never unconditionally -- see withBootLocationTimeout.
      const locResult = await withBootLocationTimeout(locationPromise);

      if (locResult.ok) {
        const { latitude, longitude } = applyLocationFix(locResult.position);
        setLoadStep("location", "done");
        updateLocateButtonVisibility();
        setLocationGateVisible(false);
        checkDistanceToForest(latitude, longitude);
        ensureLocationWatch();

        // Request compass only if not already handled (e.g. by onboarding).
        if (state.compassPermission === "unknown") {
          if (compassPermissionCanBeRequested()) {
            showCompassAccessPrompt();
          } else {
            requestCompassPermissionIfNeeded({ fromGesture: false });
          }
        }

        // Populate overview list and render map while overlay is still up.
        selectOverview();
        draw();

        // Snap the camera onto the walking-radius circle before the reveal animation --
        // the same thing the Nearby view frames once it is live (see nearbyCameraFitPoints),
        // so the reveal eases from a slightly wider version of the final view rather than
        // starting on a tight fit of whichever items happened to be nearest and then pulling
        // back out to the circle.
        {
          const focusRect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
          const targetScale = maxScaleForRadiusVisible(focusRect);
          centerOverviewOnUserLocation({ scale: targetScale * 0.82, focusVisibleArea: true });
        }
        draw();

        // Brief pause so the user sees the completed step list.
        await new Promise((resolve) => setTimeout(resolve, 320));

        // selectOverview() above clears the hash via syncHashFromSelection(); restore it
        // so applySelectionFromHash() can honour deep-link URLs like /#tree=11383.
        if (startHash && !window.location.hash) {
          history.replaceState(null, "", location.pathname + location.search + startHash);
        }

        // Apply any URL hash selection after the wait so it overrides the overview snap.
        applySelectionFromHash();

        // Fade overlay and animate camera to final position simultaneously.
        // Use fresh points (not stale pre-wait revealPoints) to avoid animating back
        // to a wider viewport if a GPS update arrived during the 320 ms wait.
        if (state.selected) {
          ensureUserAndSelectionVisible({ animate: true, force: true, durationMs: FIRST_LOAD_REVEAL_ANIMATION_MS });
        } else {
          ensureOverviewTargetsVisible({ animate: true, durationMs: FIRST_LOAD_REVEAL_ANIMATION_MS });
        }
        triggerInspectorEntry();
        hideWithFade(els.loadingOverlay);
      } else {
        // Location denied or timed out — reveal map without centering.
        // On first visit the user already had the chance to grant via the onboarding
        // button, so we don't show a second blocking prompt; the "Use my location"
        // button in the inspector is available if they change their mind.
        // On returning visits the auto-request failed, so show the gate so they can retry.
        setLoadStep("location", "error");
        if (!locationAskedInOnboarding) {
          setLocationGateVisible(
            true,
            "Tap below to allow location so the map can centre on you and show nearby finds.",
            "Enable location"
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        selectOverview();
        draw();
        if (startHash && !window.location.hash) {
          history.replaceState(null, "", location.pathname + location.search + startHash);
        }
        applySelectionFromHash();
        triggerMapRevealZoom();
        triggerInspectorEntry();
        hideWithFade(els.loadingOverlay);
        updateLocateButtonVisibility();
      }
    } else {
      // No geolocation support or user opted out — reveal map without location.
      setStatus("Offline map data loaded.");
      selectOverview();
      draw();
      if (startHash && !window.location.hash) {
        history.replaceState(null, "", location.pathname + location.search + startHash);
      }
      applySelectionFromHash();
      triggerMapRevealZoom();
      triggerInspectorEntry();
      hideWithFade(els.loadingOverlay);
    }
    showFilterHintIfFirstVisit();

    // Everything above was served from the service worker's caches on a return visit, which
    // is what makes the reload instant — but also means nothing here ever noticed newer data
    // upstream. Now that the map is interactive, ask the worker to revalidate its cached
    // datasets in the background (syncData in sw.js); anything that actually changed is
    // picked up on the next load, and Settings says so.
    requestBackgroundDataSync();
  } catch (error) {
    console.error(error);
    hideWithFade(els.loadingOverlay);
    if (els.inspectorBody) {
      els.inspectorBody.innerHTML = `<p class="empty">Could not fully load map data. Try a hard refresh. If running locally, make sure the server is started from this folder.</p>`;
    }
    setStatus("Could not load local map data. Start a local server from this folder and refresh.");
  }
}

// --- Camera-facing GPS smoothing -------------------------------------------------------
//
// watchPosition delivers a fix about once a second, and under tree cover consecutive fixes
// wander several metres either side of where you actually are. state.userLocation.point is
// the camera's anchor, the scale fit's origin and the 3D pivot all at once (see
// cameraOriginPoint), so every one of those fixes used to move the whole map at once:
// measured walking toward a destination ~80m away, the map lurched 15.8px on average and
// 26.2px at worst on each fix, then sat perfectly still for the fifteen frames until the
// next one. That once-a-second twitch is the rest of the "lots of reframing" report.
//
// Two things are wrong with a raw fix and they need different treatment:
//
//   - the wander itself, which is noise around the truth -> a low-pass filter, below,
//     weighted by the accuracy the fix reports so a good fix is trusted more than a bad one;
//   - the once-a-second delivery, which makes even a perfectly filtered position arrive as
//     a step -> a glide, advanced every frame by advanceLocationGlide().
//
// Filtering alone would only make the steps smaller; gliding alone would follow every
// wobble faithfully and smoothly. Both together is what makes the map move the way the
// walker does.
//
// This lives in the two GPS ingestion paths deliberately, not in a getter: everything that
// assigns state.userLocation directly -- the whole unit suite, and the e2e specs that place
// the walker somewhere -- keeps working exactly as before, because no glide is ever created
// for a position the browser did not deliver.
const LOCATION_SMOOTHING_MIN_TAU_S = 0.3;
const LOCATION_SMOOTHING_MAX_TAU_S = 2.5;
// Reported accuracy in metres divided by this gives the filter's time constant, so a 5m fix
// is followed almost as given (0.5s) while a 25m one is leaned on much harder (2.5s).
const LOCATION_SMOOTHING_ACCURACY_DIVISOR = 10;
// Past this, the fix is not wander. A first fix after a gap, coming out of a tunnel, or a
// genuine teleport should land at once rather than crawl there over seconds.
const LOCATION_SMOOTHING_SNAP_METRES = 30;
// How long the glide takes to reach a new fix. A little under the ~1s fix interval, so the
// position has settled by the time the next one arrives rather than permanently chasing.
const LOCATION_GLIDE_MS = 850;

// Turns one raw fix into the position the app should use, and sets up the glide toward it.
// Returns the location object for the caller to assign to state.userLocation.
function ingestLocationFix(latitude, longitude, accuracy, now = performance.now()) {
  const rawPoint = projectLonLat(longitude, latitude);
  const raw = { latitude, longitude, accuracy, point: rawPoint };
  state.rawUserLocation = raw;

  const previous = state.userLocation;
  const previousTarget = state.locationGlide ? state.locationGlide.to : (previous && previous.point);
  const lastAt = state.locationSmoothedAt;
  const landRaw = () => {
    state.locationGlide = null;
    state.locationSmoothedAt = now;
    return raw;
  };
  if (!previous || !previous.point || !previousTarget || !Number.isFinite(lastAt)) return landRaw();

  const dt = (now - lastAt) / 1000;
  if (!(dt > 0)) return previous;
  state.locationSmoothedAt = now;
  const movedMetres = distanceMetres(previous.latitude, previous.longitude, latitude, longitude);
  if (!Number.isFinite(movedMetres) || movedMetres >= LOCATION_SMOOTHING_SNAP_METRES) return landRaw();

  // Low-pass against the previous *target*, not the previous rendered position: filtering
  // against a value that is itself mid-glide would fold the glide's own lag back into the
  // filter and drag the position permanently behind the walker.
  const tau = clamp(
    (Number.isFinite(accuracy) ? accuracy : 10) / LOCATION_SMOOTHING_ACCURACY_DIVISOR,
    LOCATION_SMOOTHING_MIN_TAU_S,
    LOCATION_SMOOTHING_MAX_TAU_S
  );
  const alpha = 1 - Math.exp(-dt / tau);
  const to = {
    x: previousTarget.x + (rawPoint.x - previousTarget.x) * alpha,
    y: previousTarget.y + (rawPoint.y - previousTarget.y) * alpha,
  };
  state.locationGlide = { from: { x: previous.point.x, y: previous.point.y }, to, startedAt: now, durationMs: LOCATION_GLIDE_MS };
  return locationAtPoint(previous.point, accuracy);
}

// The location object for a projected point, with lat/lon kept consistent with it so
// nothing downstream can read a position and a coordinate that disagree.
function locationAtPoint(point, accuracy) {
  const lonLat = unprojectPoint(point);
  return { latitude: lonLat.latitude, longitude: lonLat.longitude, accuracy, point: { x: point.x, y: point.y } };
}

// Moves state.userLocation along the in-flight glide. Progress is a pure function of the
// clock (the same shape nearbyOriginTransitionEasedProgress uses) rather than an
// accumulator, so a dropped frame just means further along and a stale clock lands it --
// neither can freeze the position or leave it somewhere the fit was not solved for.
function advanceLocationGlide(now = performance.now()) {
  const glide = state.locationGlide;
  if (!glide || !state.userLocation) return false;
  const progress = clamp((now - glide.startedAt) / glide.durationMs, 0, 1);
  const eased = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  const point = {
    x: glide.from.x + (glide.to.x - glide.from.x) * eased,
    y: glide.from.y + (glide.to.y - glide.from.y) * eased,
  };
  if (progress >= 1) state.locationGlide = null;
  const moved = Math.abs(point.x - state.userLocation.point.x) > 0 || Math.abs(point.y - state.userLocation.point.y) > 0;
  if (!moved) return false;
  state.userLocation = locationAtPoint(point, state.userLocation.accuracy);
  state.userInMapArea = pointInsideBounds(point, state.bounds);
  return true;
}

function applyLocationFix(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const previousPoint = state.userLocation && state.userLocation.point;
  state.userLocation = ingestLocationFix(latitude, longitude, accuracy);
  const point = state.userLocation.point;
  state.userInMapArea = pointInsideBounds(point, state.bounds);
  const nearestTrees = nearestTreesTo(latitude, longitude, state.nearestItemsCount);
  state.nearestTree = nearestTrees.length > 0 ? nearestTrees[0] : null;
  state.nearestCow = nearestCowTo(latitude, longitude);
  state.nearestPub = nearestPlaceByFilter(latitude, longitude, (place) => isPubCategory(place));
  state.nearestRestaurant = nearestPlaceByFilter(latitude, longitude, (place) => isRestaurantCategory(place));
  state.nearestLandmark = nearestPlaceByFilter(latitude, longitude, (place) => !isPubCategory(place) && !isRestaurantCategory(place) && !isCafeCategory(place) && !isShopCategory(place) && !isTransportCategory(place));
  state.nearestPlace = nearestPlacesTo(latitude, longitude, 1)[0] || null;
  state.selected = null;
  return { latitude, longitude, previousPoint };
}

function triggerInspectorEntry() {
  const el = els.inspector;
  if (!el) return;
  el.classList.remove("entering");
  void el.offsetWidth;
  el.classList.add("entering");
  el.addEventListener("animationend", () => el.classList.remove("entering"), { once: true });
}

function triggerMapRevealZoom(durationMs = FIRST_LOAD_REVEAL_ANIMATION_MS) {
  const target = { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty };
  const f = 0.85;
  state.viewport.scale = target.scale * f;
  state.viewport.tx = target.tx + els.canvas.width * (1 - f) / 2;
  state.viewport.ty = target.ty + els.canvas.height * (1 - f) / 2;
  draw();
  animateViewportTo(target, durationMs);
}

// The Geolocation API's own `timeout` option does not start counting until the
// permission decision has been made. A prompt left unanswered on the screen, or an
// OS location service that stalls, therefore means getCurrentPosition never calls
// back at all -- neither the success nor the error handler. Boot awaits that
// request before revealing the map, so without a bound of our own the map sits
// behind the loading screen for ever.
//
// Falling back to { ok: false } takes the same path a genuine failure takes: the
// map opens uncentred and the location gate offers a retry. The bound sits just
// above the 8s the request itself asks for, so it only ever bites when the browser
// is not honouring that timeout -- someone who has already granted location is
// answered long before this fires.
const BOOT_LOCATION_TIMEOUT_MS = 10000;

function withBootLocationTimeout(locationPromise) {
  return Promise.race([
    locationPromise,
    new Promise((resolve) => setTimeout(() => resolve({ ok: false }), BOOT_LOCATION_TIMEOUT_MS)),
  ]);
}

function locateUser({ initial }) {
  if (!navigator.geolocation) {
    setLocationGateVisible(true, "You need to enable location to continue.");
    if (!initial) setStatus("This browser does not support location access.");
    return;
  }

  els.locateButton.disabled = true;
  setStatus(initial ? "Finding your location..." : "Getting your location...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      els.locateButton.disabled = false;
      const { latitude, longitude, previousPoint } = applyLocationFix(position);
      setLocationGateVisible(false);
      updateLocateButtonVisibility();
      ensureLocationWatch();
      if (compassPermissionCanBeRequested()) {
        // iOS: requestPermission() must come from a real user-gesture call stack.
        // The geolocation callback is async and doesn't qualify, so show the gate
        // and let the user's tap on the button be the actual gesture.
        if (state.compassPermission !== "granted") showCompassAccessPrompt();
      } else {
        // Non-iOS: no user gesture required; auto-grant if not already set.
        requestCompassPermissionIfNeeded({ fromGesture: false });
      }

      checkDistanceToForest(latitude, longitude);

      if (isOverviewScreenActive()) selectOverview();
      if (!previousPoint) {
        setInspectorMinimized(false);
        ensureOverviewTargetsVisible({ animate: true, durationMs: 1000 });
      } else {
        ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
        keepOverviewCenteredOnUser(previousPoint);
      }
      if (!initial) {
        const nearestTreeText = state.nearestTree
          ? formatDistance(state.nearestTree.metres)
          : "Not recorded";
        const nearestPlaceText = state.nearestPlace
          ? ` Nearest place: ${placeTitle(state.nearestPlace.place)} (${formatDistance(state.nearestPlace.metres)}).`
          : "";
        setStatus(`Nearest tree: ${nearestTreeText} away.${nearestPlaceText}`);
      } else {
        setStatus("");
      }
      updateCompassOverlay();
      requestDraw();
    },
    (error) => {
      els.locateButton.disabled = false;
      const denied = error && error.code === 1;
      if (denied) {
        const gateMessage = "Location permission was blocked. Use the browser site settings to allow location for this page, then tap Enable location again.";
        setLocationGateVisible(true, gateMessage);
      } else {
        setLocationGateVisible(
          true,
          "Location was not available yet. Check that location services are on, then tap below to try again.",
          "Try location again"
        );
      }
      setStatus(initial
        ? "Location was not available yet. Use the button when you are ready."
        : error.message || "Location access was not available.");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

function checkDistanceToForest(latitude, longitude) {
  // Don't show warning if already shown
  if (state.distanceWarningShown) return;
  
  // Find the forest layer
  const forestLayer = state.layers.find(layer => layer.key === "forest");
  if (!forestLayer || !forestLayer.data || !forestLayer.data.features) return;
  
  // Calculate minimum distance to forest boundary
  const minDistance = getMinDistanceToForest(latitude, longitude, forestLayer);
  
  // 15 minutes walk at 5 km/h = ~1250 meters
  const FIFTEEN_MIN_WALK_METRES = 1250;
  
  if (minDistance > FIFTEEN_MIN_WALK_METRES) {
    const distanceKm = (minDistance / 1000).toFixed(1);
    const walkMins = Math.ceil(minDistance / 80); // 80m/min walking speed
    
    if (els.distanceWarningMessage) {
      els.distanceWarningMessage.textContent = `You're about ${formatDistance(minDistance)} from the forest boundary — roughly ${Math.round(minDistance / (5000 / 60))} minutes on foot. The map is fully loaded and ready to explore when you visit.`;
    }
    
    if (els.distanceWarning) {
      els.distanceWarning.hidden = false;
    }
  }
}

function getMinDistanceToForest(userLat, userLon, forestLayer) {
  let minDistance = Infinity;
  
  for (const feature of forestLayer.data.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    
    const polygons = geometry.type === "Polygon" 
      ? [geometry.coordinates] 
      : geometry.coordinates;
    
    for (const polygon of polygons) {
      // Check exterior ring
      if (polygon.length > 0) {
        const ring = polygon[0];
        const distance = getMinDistanceToRing(userLat, userLon, ring);
        minDistance = Math.min(minDistance, distance);
      }
    }
  }
  
  return minDistance;
}

function getMinDistanceToRing(userLat, userLon, ring) {
  let minDistance = Infinity;
  
  // Check distance to each segment of the ring
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    
    const distance = distanceToLineSegment(userLat, userLon, lat1, lon1, lat2, lon2);
    minDistance = Math.min(minDistance, distance);
  }
  
  // Also check distance to first and last point to close the ring
  if (ring.length > 0) {
    const [lon1, lat1] = ring[0];
    const [lon2, lat2] = ring[ring.length - 1];
    const distance = distanceToLineSegment(userLat, userLon, lat1, lon1, lat2, lon2);
    minDistance = Math.min(minDistance, distance);
  }
  
  return minDistance;
}

function visibleCanvasRect() {
  if (state.canvasVisibleWidth > 0) {
    return { x: state.canvasInsetX, y: state.canvasInsetY, width: state.canvasVisibleWidth, height: state.canvasVisibleHeight };
  }
  // Fallback before first resizeCanvas() (early-boot only): read CSS layout dimensions.
  // Using els.canvas.width would return the oversized bitmap, not the visible viewport size.
  const stageEl = els.mapStage || els.canvas;
  const dpr = window.devicePixelRatio || 1;
  const r = stageEl.getBoundingClientRect();
  return { x: 0, y: 0, width: Math.max(1, Math.round(r.width * dpr)), height: Math.max(1, Math.round(r.height * dpr)) };
}

function resizeCanvas() {
  _overlapRectCache = undefined;
  _tiltProjectionCache = undefined;
  _nearbyRenderOriginCache = undefined;
  const rect = (els.mapStage || els.canvas).getBoundingClientRect();
  const requestedDpr = window.devicePixelRatio || 1;
  const rawWidth = Math.max(1, rect.width);
  const rawHeight = Math.max(1, rect.height);
  // Overscan while heading-up is active, to cover the corners the CSS heading rotation
  // sweeps in. Tilt adds nothing here any more: it is projected per point rather than
  // applied to the finished bitmap, so no amount of canvas has to be hidden off-screen
  // for it — and oversizing for tilt was actively harmful, since the extra canvas below
  // the pivot is what used to swing through the camera plane and take the whole layer
  // with it.
  const overscanRatio = headingUpActive() ? HEADING_UP_CANVAS_OVERSCAN_RATIO : 1;
  const requestedOverscanWidth = Math.round(rawWidth * requestedDpr * overscanRatio);
  const requestedOverscanHeight = Math.round(rawHeight * requestedDpr * overscanRatio);
  let overscanWidth = Math.max(1, Math.min(MAX_CANVAS_DIMENSION, requestedOverscanWidth));
  let overscanHeight = Math.max(1, Math.min(MAX_CANVAS_DIMENSION, requestedOverscanHeight));
  const cappedPixels = overscanWidth * overscanHeight;
  if (cappedPixels > MAX_CANVAS_PIXEL_COUNT) {
    const scaleDown = Math.sqrt(MAX_CANVAS_PIXEL_COUNT / cappedPixels);
    overscanWidth = Math.max(1, Math.floor(overscanWidth * scaleDown));
    overscanHeight = Math.max(1, Math.floor(overscanHeight * scaleDown));
  }
  // Derive effective DPR from the capped overscan dimensions so bitmap allocation
  // stays within safe limits while preserving as much detail as possible.
  const dpr = Math.max(1, Math.min(
    requestedDpr,
    overscanWidth / (rawWidth * overscanRatio),
    overscanHeight / (rawHeight * overscanRatio)
  ));
  const visibleWidth = Math.max(1, Math.min(overscanWidth, Math.round(rawWidth * dpr)));
  const visibleHeight = Math.max(1, Math.min(overscanHeight, Math.round(rawHeight * dpr)));
  const insetX = Math.max(0, Math.round((overscanWidth - visibleWidth) / 2));
  const insetY = Math.max(0, Math.round((overscanHeight - visibleHeight) / 2));

  state.canvasInsetX = insetX;
  state.canvasInsetY = insetY;
  state.canvasVisibleWidth = visibleWidth;
  state.canvasVisibleHeight = visibleHeight;

  els.canvas.width = overscanWidth;
  els.canvas.height = overscanHeight;
  els.canvas.dataset.dpr = String(dpr);
  els.canvas.style.position = "absolute";
  els.canvas.style.left = `${-insetX / dpr}px`;
  els.canvas.style.top = `${-insetY / dpr}px`;
  els.canvas.style.width = `${overscanWidth / dpr}px`;
  els.canvas.style.height = `${overscanHeight / dpr}px`;
  if (els.overlayCanvas) {
    els.overlayCanvas.width = overscanWidth;
    els.overlayCanvas.height = overscanHeight;
    els.overlayCanvas.dataset.dpr = String(dpr);
    els.overlayCanvas.style.position = "absolute";
    els.overlayCanvas.style.left = `${-insetX / dpr}px`;
    els.overlayCanvas.style.top = `${-insetY / dpr}px`;
    els.overlayCanvas.style.width = `${overscanWidth / dpr}px`;
    els.overlayCanvas.style.height = `${overscanHeight / dpr}px`;
  }
}

function calculateBounds() {
  const points = [];
  for (const tree of state.trees) points.push(tree.point);
  for (const place of state.landmarks) points.push(place.point);
  for (const layer of state.layers) {
    forEachGeojsonCoordinate(layer.data, ([longitude, latitude]) => {
      points.push(projectLonLat(longitude, latitude));
    });
  }
  if (!points.length) {
    const fallback = [
      projectLonLat(-0.03, 51.55),
      projectLonLat(0.13, 51.73),
    ];
    points.push(...fallback);
  }
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function fitToBounds(announce = true, options = {}) {
  if (!state.bounds) return;
  applyBoundsToViewport(state.bounds, options);
  state.baseFitScale = state.fitScale;
  requestDraw();
}

function fitToPoints(points, announce = true, options = {}) {
  if (!points.length) return fitToBounds(announce);
  const bounds = points.reduce((next, point) => expandBounds(next, point), {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });
  applyBoundsToViewport(bounds, options);
  if (announce) setStatus("Showing nearby trees and boundaries.");
  requestDraw();
}

function applyBoundsToViewport(bounds, options = {}) {
  const padding = (options.padding != null ? options.padding : DEFAULT_FIT_PADDING_PX) * pixelRatio();
  // Grow the bounds about their own centre before fitting. Used when the caller knows the
  // points it passed are an under-estimate of what will eventually be drawn -- see
  // ROUTE_UNKNOWN_FIT_SLACK -- so the fit leaves room rather than having to be corrected.
  if (options.boundsSlack > 1) {
    const centreX = (bounds.minX + bounds.maxX) / 2;
    const centreY = (bounds.minY + bounds.maxY) / 2;
    const halfWidth = ((bounds.maxX - bounds.minX) / 2) * options.boundsSlack;
    const halfHeight = ((bounds.maxY - bounds.minY) / 2) * options.boundsSlack;
    bounds = {
      minX: centreX - halfWidth,
      maxX: centreX + halfWidth,
      minY: centreY - halfHeight,
      maxY: centreY + halfHeight,
    };
  }
  const defaultRect = visibleCanvasRect();
  const focusRect = options.customFocusRect
    || (options.focusVisibleArea
      ? bestVisibleCanvasRect({ assumeInspectorOpen: Boolean(options.assumeInspectorOpen) })
      : defaultRect);
  const viewportWidth = Math.max(1, focusRect.width);
  const viewportHeight = Math.max(1, focusRect.height);
  const rangeX = Math.max(0.0001, bounds.maxX - bounds.minX);
  const rangeY = Math.max(0.0001, bounds.maxY - bounds.minY);
  state.fitScale = Math.min((viewportWidth - padding * 2) / rangeX, (viewportHeight - padding * 2) / rangeY);
  if (options.minScale > 0) {
    state.fitScale = Math.max(state.fitScale, options.minScale);
  }

  const targetScale = state.fitScale;
  const targetTx = focusRect.x + (viewportWidth - rangeX * targetScale) / 2 - bounds.minX * targetScale;
  const targetTy = focusRect.y + (viewportHeight - rangeY * targetScale) / 2 - bounds.minY * targetScale;

  if (options.animate) {
    animateViewportTo({ scale: targetScale, tx: targetTx, ty: targetTy }, options.durationMs || DEFAULT_VIEWPORT_ANIMATION_MS);
    return;
  }

  stopViewportAnimation();
  state.viewport.scale = targetScale;
  state.viewport.tx = targetTx;
  state.viewport.ty = targetTy;
}

function stopViewportAnimation() {
  if (state.viewportAnimationFrame != null) {
    cancelAnimationFrame(state.viewportAnimationFrame);
  }
  state.viewportAnimationFrame = null;
  state.viewportAnimationFrameRequestedAt = null;
  state.viewportAnimationFrom = null;
  state.viewportAnimationTo = null;
  state.viewportAnimationStartTime = null;
  state.viewportAnimationDuration = 0;
}

// How close a newly-requested animation target has to be to the one already in flight to be
// treated as the same destination. Scale is compared as a ratio (0.5%), position in device
// pixels -- both well below what reads as a different framing on screen.
const VIEWPORT_ANIMATION_SAME_TARGET_SCALE_RATIO = 0.005;
const VIEWPORT_ANIMATION_SAME_TARGET_PX = 6;

// True when an animation is already running toward effectively this same viewport.
// The repeat callers here -- the GPS watch, the compass tick, the inspector resize drag --
// all re-request their fit many times a second while the target itself barely moves. Each
// request used to cancel the running ease and start a fresh one from the current position,
// so the camera decelerated toward the end of every ease and then accelerated again from
// zero: the motion arrived in visible steps instead of gliding. Cancelling here collapses
// any pile-up back to the single smooth animation the spec asks for ("all state-change
// transitions produce exactly one smooth animation with no intermediate jumps").
function viewportAnimationAlreadyHeadedTo(targetViewport) {
  const inFlight = state.viewportAnimationTo;
  if (!inFlight || state.viewportAnimationFrame == null) return false;
  const scaleRatio = Math.abs(inFlight.scale - targetViewport.scale) / Math.max(inFlight.scale, 0.000001);
  return scaleRatio < VIEWPORT_ANIMATION_SAME_TARGET_SCALE_RATIO
    && Math.abs(inFlight.tx - targetViewport.tx) < VIEWPORT_ANIMATION_SAME_TARGET_PX
    && Math.abs(inFlight.ty - targetViewport.ty) < VIEWPORT_ANIMATION_SAME_TARGET_PX;
}

function animateViewportTo(targetViewport, durationMs) {
  const safeDuration = Math.max(MIN_VIEWPORT_ANIMATION_MS, Number(durationMs) || DEFAULT_VIEWPORT_ANIMATION_MS);
  if (viewportAnimationAlreadyHeadedTo(targetViewport)) return;
  stopViewportAnimation();

  const from = {
    scale: state.viewport.scale,
    tx: state.viewport.tx,
    ty: state.viewport.ty,
  };

  if (
    Math.abs(from.scale - targetViewport.scale) < 0.000001
    && Math.abs(from.tx - targetViewport.tx) < 0.5
    && Math.abs(from.ty - targetViewport.ty) < 0.5
  ) {
    state.viewport.scale = targetViewport.scale;
    state.viewport.tx = targetViewport.tx;
    state.viewport.ty = targetViewport.ty;
    requestDraw();
    return;
  }

  state.viewportAnimationFrom = from;
  state.viewportAnimationTo = targetViewport;
  state.viewportAnimationDuration = safeDuration;

  const tick = (timestamp) => {
    state.viewportAnimationFrameRequestedAt = null;
    if (!state.viewportAnimationFrom || !state.viewportAnimationTo) {
      stopViewportAnimation();
      return;
    }

    if (state.viewportAnimationStartTime == null) {
      state.viewportAnimationStartTime = timestamp;
    }

    const elapsed = timestamp - state.viewportAnimationStartTime;
    const progress = clamp(elapsed / state.viewportAnimationDuration, 0, 1);
    // Cubic ease-in-out: smooth acceleration then gentle deceleration
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    state.viewport.scale = state.viewportAnimationFrom.scale + (state.viewportAnimationTo.scale - state.viewportAnimationFrom.scale) * eased;
    state.viewport.tx = state.viewportAnimationFrom.tx + (state.viewportAnimationTo.tx - state.viewportAnimationFrom.tx) * eased;
    state.viewport.ty = state.viewportAnimationFrom.ty + (state.viewportAnimationTo.ty - state.viewportAnimationFrom.ty) * eased;
    requestDraw();

    if (progress >= 1) {
      state.viewport.scale = state.viewportAnimationTo.scale;
      state.viewport.tx = state.viewportAnimationTo.tx;
      state.viewport.ty = state.viewportAnimationTo.ty;
      stopViewportAnimation();
      requestDraw();
      return;
    }

    state.viewportAnimationFrame = requestAnimationFrame(tick);
    state.viewportAnimationFrameRequestedAt = timestamp;
  };

  state.viewportAnimationFrame = requestAnimationFrame(tick);
  state.viewportAnimationFrameRequestedAt = performance.now();
}

function bestVisibleCanvasRect({ assumeInspectorOpen = false } = {}) {
  const full = visibleCanvasRect();
  const overlapRaw = inspectorCanvasOverlapRect({ assumeInspectorOpen });
  if (!overlapRaw) return full;
  const clampedOverlapX = clamp(overlapRaw.x, full.x, full.x + full.width);
  const clampedOverlapY = clamp(overlapRaw.y, full.y, full.y + full.height);
  const overlap = {
    x: clampedOverlapX,
    y: clampedOverlapY,
    width: clamp(overlapRaw.width, 0, full.x + full.width - clampedOverlapX),
    height: clamp(overlapRaw.height, 0, full.y + full.height - clampedOverlapY),
  };

  const allRegions = [
    { x: full.x, y: full.y, width: full.width, height: overlap.y - full.y },
    { x: full.x, y: full.y, width: overlap.x - full.x, height: full.height },
    { x: overlap.x + overlap.width, y: full.y, width: (full.x + full.width) - (overlap.x + overlap.width), height: full.height },
    { x: full.x, y: overlap.y + overlap.height, width: full.width, height: (full.y + full.height) - (overlap.y + overlap.height) },
  ]
    .map((rect) => ({
      x: Math.max(full.x, rect.x),
      y: Math.max(full.y, rect.y),
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height),
    }));

  // Prefer candidates >= 80x80; if none exist, use the largest available region
  const candidates = allRegions.filter((rect) => rect.width >= 80 && rect.height >= 80);
  const selected = candidates.length > 0 ? candidates : allRegions;
  return selected.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || full;
}

function inspectorCanvasOverlapRect({ assumeInspectorOpen = false } = {}) {
  if (!els.inspector || els.inspector.hidden) return null;
  if (!assumeInspectorOpen && _overlapRectCache !== undefined) return _overlapRectCache;

  const wasMinimized = els.inspector.classList.contains("minimized");
  if (assumeInspectorOpen && wasMinimized) {
    els.inspector.classList.remove("minimized");
  }

  // Use mapStage as the reference rect when available: its left/top align with
  // the canvas visible origin, so adding canvasInsetX/Y converts to bitmap coords.
  // When falling back to els.canvas, the element's left/top already incorporate
  // the CSS −insetX/Y offset, so (overlap − canvas.left) * dpr already lands in
  // bitmap coords and canvasInsetX/Y must not be added again.
  const useMapStage = Boolean(els.mapStage);
  const canvasRect = (els.mapStage || els.canvas).getBoundingClientRect();
  const inspectorRect = els.inspector.getBoundingClientRect();

  if (assumeInspectorOpen && wasMinimized) {
    els.inspector.classList.add("minimized");
  }

  const overlapLeft = Math.max(canvasRect.left, inspectorRect.left);
  const overlapTop = Math.max(canvasRect.top, inspectorRect.top);
  const overlapRight = Math.min(canvasRect.right, inspectorRect.right);
  const overlapBottom = Math.min(canvasRect.bottom, inspectorRect.bottom);

  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
    if (!assumeInspectorOpen) _overlapRectCache = null;
    return null;
  }

  const dpr = pixelRatio();
  const result = {
    x: (useMapStage ? state.canvasInsetX : 0) + (overlapLeft - canvasRect.left) * dpr,
    y: (useMapStage ? state.canvasInsetY : 0) + (overlapTop - canvasRect.top) * dpr,
    width: (overlapRight - overlapLeft) * dpr,
    height: (overlapBottom - overlapTop) * dpr,
  };
  if (!assumeInspectorOpen) _overlapRectCache = result;
  return result;
}

function zoomAt(factor, screenPoint) {
  if (!state.bounds) return;
  stopViewportAnimation();
  // Heading-up mode (nearby or selected-navigation) locks pan/zoom to the fitted
  // target -- see alignHeadingUpNavigationViewport() and the pointermove handler in
  // js/nav.js, which treats drag the same way. Applying the raw pointer-anchored
  // zoom below first (as this used to) fought that fit on every wheel tick: pan
  // always snapped back to the user anchor while the scale was only sometimes
  // overridden, so scrolling didn't reliably zoom toward the cursor or settle
  // anywhere predictable. Route wheel input through the same re-fit as everything
  // else instead, with force:true since this is an explicit user gesture.
  if (navigationAnchorActive()) {
    alignHeadingUpNavigationViewport({ force: true });
    requestDraw();
    return;
  }
  // A selection's auto-reposition is not a lock (unlike heading-up above): wheel/trackpad
  // zoom is an explicit request, so take the camera over and apply it. Re-running the fit
  // here instead -- as this used to -- meant the wheel did nothing at all whenever a
  // location was selected with the inspector open, since the fit is already satisfied.
  if (shouldAutoRepositionSelection()) markManualCameraOverride();
  const before = screenToWorld(screenPoint.x, screenPoint.y);
  state.viewport.scale = clamp(state.viewport.scale * factor, state.fitScale * 0.65, state.fitScale * 220);
  state.viewport.tx = screenPoint.x - before.x * state.viewport.scale;
  state.viewport.ty = screenPoint.y - before.y * state.viewport.scale;
  requestDraw();
}

function renderFilterBodyHtml() {
  return `<div class="filter-body">
    <div class="filter-actions">
      <button class="filter-action-btn filter-clear-all" type="button" data-filter-clear-all>
        Clear all filters
      </button>
    </div>
    <div class="filter-groups">
      ${FILTER_GROUPS.map((group) => `
        <section class="filter-group-card" data-filter-group-section="${escapeHtml(group.key)}">
          <header class="filter-group-header" data-filter-group="${escapeHtml(group.key)}">
            <div class="filter-group-title">
              ${group.icon ? appIconHtml(group.icon, "app-icon filter-group-icon") : ""}
              <span class="filter-group-label">${escapeHtml(group.label)}</span>
            </div>
            <span class="filter-group-count" data-group-count="${escapeHtml(group.key)}">0 of ${group.subfilters.length}</span>
          </header>
          <div class="filter-group-grid">
            ${group.subfilters.map((subfilter) => `
              <button class="filter-chip" type="button" data-filter-subfilter="${escapeHtml(subfilter.key)}">
                ${subfilter.icon ? appIconHtml(subfilter.icon, "app-icon filter-chip-icon") : ""}
                <span class="filter-chip-label">${escapeHtml(subfilter.label)}</span>
                <span class="filter-chip-check" aria-hidden="true">✓</span>
              </button>
            `).join("")}
          </div>
          <p class="filter-group-outside" data-filter-group-outside="${escapeHtml(group.key)}" hidden></p>
        </section>
      `).join("")}
    </div>
  </div>`;
}

function attachFilterScrollHints() {
  const rows = els.inspectorBody.querySelectorAll(".filter-subfilters-row");
  for (const row of rows) {
    row.addEventListener("scroll", () => updateSingleSubfilterScrollHint(row), { passive: true });
    updateSingleSubfilterScrollHint(row);
  }
}

function updateSingleSubfilterScrollHint(row) {
  if (!row) return;
  const maxScrollLeft = row.scrollWidth - row.clientWidth;
  const isScrollable = maxScrollLeft > 6;
  const isAtStart = !isScrollable || row.scrollLeft <= 2;
  const isAtEnd = !isScrollable || row.scrollLeft >= maxScrollLeft - 2;
  row.classList.toggle("is-scrollable", isScrollable);
  row.classList.toggle("is-scroll-start", isAtStart);
  row.classList.toggle("is-scroll-end", isAtEnd);
}

function updateSubfilterScrollHints() {
  const rows = els.inspectorBody ? els.inspectorBody.querySelectorAll(".filter-subfilters-row") : [];
  for (const row of rows) {
    updateSingleSubfilterScrollHint(row);
  }
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function setSubfilterPanelExpanded(panel, expanded) {
  if (!panel) return;

  const wasExpanded = panel.dataset.expanded === "true";

  if (wasExpanded === expanded && panel.dataset.animating !== "true") {
    panel.hidden = !expanded;
    if (!expanded) {
      panel.style.maxHeight = "";
      panel.style.opacity = "";
      panel.style.transform = "";
    } else {
      updateSubfilterScrollHints();
    }
    return;
  }

  panel.dataset.expanded = expanded ? "true" : "false";

  if (prefersReducedMotion()) {
    panel.hidden = !expanded;
    panel.classList.remove("animating");
    panel.style.maxHeight = "";
    panel.style.opacity = "";
    panel.style.transform = "";
    updateSubfilterScrollHints();
    return;
  }

  if (expanded) {
    if (panel.dataset.animating === "true") return;
    panel.hidden = false;
    panel.classList.add("animating");
    panel.dataset.animating = "true";
    panel.style.maxHeight = "0px";
    panel.style.opacity = "0";
    panel.style.transform = "translateY(-12px)";

    requestAnimationFrame(() => {
      panel.style.maxHeight = `${panel.scrollHeight}px`;
      panel.style.opacity = "1";
      panel.style.transform = "translateY(0)";
    });

    const onExpandDone = () => {
      panel.classList.remove("animating");
      panel.dataset.animating = "false";
      panel.style.maxHeight = "";
      panel.style.opacity = "";
      panel.style.transform = "";
      updateSubfilterScrollHints();
    };

    panel.addEventListener("transitionend", onExpandDone, { once: true });
    return;
  }

  if (panel.hidden) return;
  if (panel.dataset.animating === "true") return;

  panel.classList.add("animating");
  panel.dataset.animating = "true";
  panel.style.maxHeight = `${panel.scrollHeight}px`;
  panel.style.opacity = "1";
  panel.style.transform = "translateY(0)";

  requestAnimationFrame(() => {
    panel.style.maxHeight = "0px";
    panel.style.opacity = "0";
    panel.style.transform = "translateY(-10px)";
  });

  const onCollapseDone = () => {
    panel.hidden = true;
    panel.classList.remove("animating");
    panel.dataset.animating = "false";
    panel.style.maxHeight = "";
    panel.style.opacity = "";
    panel.style.transform = "";
    updateSubfilterScrollHints();
  };

  panel.addEventListener("transitionend", onCollapseDone, { once: true });
}

function sanitizeOverviewFilters(filters) {
  return Array.from(new Set((Array.isArray(filters) ? filters : []).filter((key) => ALL_OVERVIEW_FILTER_KEYS.has(key))));
}

function sanitizeExpandedGroups(groups) {
  return Array.from(new Set((Array.isArray(groups) ? groups : []).filter((key) => FILTER_GROUPS_BY_KEY.has(key))));
}

function activeOverviewFilterSet() {
  return new Set(sanitizeOverviewFilters(state.overviewFilters));
}

function activeOverviewExpandedSet() {
  return new Set(sanitizeExpandedGroups(state.overviewExpandedGroups));
}

function getActiveSubfiltersForGroup(groupKey, currentSet = activeOverviewFilterSet()) {
  const group = FILTER_GROUPS_BY_KEY.get(groupKey);
  if (!group) return [];
  return group.subfilters.map((subfilter) => subfilter.key).filter((key) => currentSet.has(key));
}

function isGroupActive(groupKey, currentSet = activeOverviewFilterSet()) {
  return getActiveSubfiltersForGroup(groupKey, currentSet).length > 0;
}

function isSubfilterActive(filterKey, currentSet = activeOverviewFilterSet()) {
  return currentSet.has(filterKey);
}

function getActiveGroupKeys(currentSet = activeOverviewFilterSet()) {
  return FILTER_GROUPS.filter((group) => isGroupActive(group.key, currentSet)).map((group) => group.key);
}

function getActivePlaceFilterKeys(currentSet = activeOverviewFilterSet()) {
  return Array.from(currentSet).filter((key) => PLACE_FILTER_KEYS.has(key));
}

function getActivePointFilterKeys(currentSet = activeOverviewFilterSet()) {
  return Array.from(currentSet).filter((key) => !LAYER_FILTER_KEYS.has(key));
}

function pointFilterKeysForNearestFallback() {
  const activePointFilters = getActivePointFilterKeys();
  if (state.overviewFilters.length > 0) return activePointFilters;
  return FILTER_SUBFILTERS
    .map((subfilter) => subfilter.key)
    .filter((key) => !LAYER_FILTER_KEYS.has(key));
}

function saveFilterState() {
  try {
    localStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
      filters: state.overviewFilters,
      expandedGroups: state.overviewExpandedGroups,
    }));
  } catch {}
}

function setOverviewFilters(nextFilters) {
  const previousFilters = state.overviewFilters;
  state.overviewFilters = sanitizeOverviewFilters(nextFilters);
  // Before the camera work below: a filter switched on with nothing inside the walking radius
  // is what lets the fit reach its nearest match (outOfRadiusFitPoints).
  refreshOutOfRadiusReveal(previousFilters);
  saveFilterState();
  updateFilterUi();
  if (isOverviewScreenActive() && !state.filterScreenOpen) {
    selectOverview();
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
  } else if (state.filterScreenOpen) {
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS, force: true });
  }
  requestDraw();
}

function setOverviewExpandedGroups(nextGroups) {
  state.overviewExpandedGroups = sanitizeExpandedGroups(nextGroups);
  saveFilterState();
  updateFilterUi();
}

function toggleOverviewGroupExpansion(groupKey) {
  if (!FILTER_GROUPS_BY_KEY.has(groupKey)) return;
  const expanded = activeOverviewExpandedSet();
  if (expanded.has(groupKey)) expanded.delete(groupKey);
  else expanded.add(groupKey);
  setOverviewExpandedGroups(Array.from(expanded));
}

function toggleOverviewFilterGroup(groupKey) {
  const group = FILTER_GROUPS_BY_KEY.get(groupKey);
  if (!group) return;
  const current = activeOverviewFilterSet();
  const keys = group.subfilters.map((subfilter) => subfilter.key);
  const groupIsActive = keys.some((key) => current.has(key));
  if (groupIsActive) keys.forEach((key) => current.delete(key));
  else keys.forEach((key) => current.add(key));
  setOverviewFilters(Array.from(current));
}

function toggleOverviewSubfilter(filterKey) {
  if (!ALL_OVERVIEW_FILTER_KEYS.has(filterKey)) return;
  const current = activeOverviewFilterSet();
  if (current.has(filterKey)) current.delete(filterKey);
  else current.add(filterKey);
  setOverviewFilters(Array.from(current));
}

function updateFilterUi() {
  const currentSet = activeOverviewFilterSet();

  // Update group cards - show active state and counts
  for (const group of FILTER_GROUPS) {
    const groupKey = group.key;
    const activeSubfilters = getActiveSubfiltersForGroup(groupKey, currentSet);
    const groupActive = activeSubfilters.length > 0;

    const groupCard = els.inspectorBody.querySelector(`[data-filter-group-section="${groupKey}"]`);
    if (groupCard) {
      groupCard.classList.toggle("active", groupActive);
    }

    const countEl = els.inspectorBody.querySelector(`[data-group-count="${groupKey}"]`);
    if (countEl) {
      countEl.textContent = `${activeSubfilters.length} of ${group.subfilters.length}`;
      countEl.classList.toggle("has-active", activeSubfilters.length > 0);
    }

    const outsideEl = els.inspectorBody.querySelector(`[data-filter-group-outside="${groupKey}"]`);
    const outsideRadiusCount = outOfRadiusCountForGroup(groupKey);
    if (outsideEl) {
      outsideEl.hidden = outsideRadiusCount === 0;
      outsideEl.textContent = outsideRadiusCount > 0
        ? `${outsideRadiusCount} outside selected walking radius`
        : "";
    }
  }

  // Update subfilter chips
  const subfilterButtons = els.inspectorBody.querySelectorAll("[data-filter-subfilter]");
  for (const button of subfilterButtons) {
    const filterKey = button.dataset.filterSubfilter;
    button.classList.toggle("active", currentSet.has(filterKey));
  }

  // Update "Clear all" button visibility
  const clearAllBtn = els.inspectorBody.querySelector("[data-filter-clear-all]");
  if (clearAllBtn) {
    clearAllBtn.hidden = currentSet.size === 0;
  }

  // Update filter toggle button
  if (els.filterToggle) {
    const activeGroupCount = getActiveGroupKeys(currentSet).length;
    const hasActiveFilter = activeGroupCount > 0;
    const locationSelected = Boolean(state.selected);
    els.filterToggle.hidden = locationSelected;
    els.filterToggle.classList.toggle("active", hasActiveFilter);
    els.filterToggle.classList.toggle("screen-active", state.filterScreenOpen);
    els.filterToggle.setAttribute("aria-pressed", hasActiveFilter ? "true" : "false");
    els.filterToggle.setAttribute("aria-label", hasActiveFilter
      ? `${activeGroupCount} top-level filter${activeGroupCount === 1 ? "" : "s"} selected`
      : "Show filters");
    if (els.filterCount) {
      els.filterCount.hidden = !hasActiveFilter;
      els.filterCount.textContent = String(activeGroupCount);
    }
  }
}

function filterMeta(filterKey) {
  return FILTER_SUBFILTERS_BY_KEY.get(filterKey) || null;
}

function clearNavScreenActive() {
  [els.nearbyToggle, els.filterToggle, els.settingsToggle, els.reportToggle].forEach((el) => {
    if (el) el.classList.remove("screen-active", "active");
  });
}

function openFiltersScreen() {
  state.filterScreenOpen = true;
  state.selected = null;
  setInspectorSelectionChrome({ emoji: appIconHtml("filter", "app-icon title-icon"), showBack: false });
  if (els.nearbyToggle) els.nearbyToggle.hidden = false;
  clearNavScreenActive();
  if (els.filterToggle) els.filterToggle.classList.add("screen-active");
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Filters";
  els.inspectorType.textContent = "";
  transitionInspectorBody(renderFilterBodyHtml(), "forward");
  updateFilterUi();
  setInspectorMinimized(false);
  syncHashFromSelection();
  requestDraw();
  if (state.userLocation) {
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
  }
}

function openSettings() {
  state.selected = { type: "settings", item: null };
  setInspectorSelectionChrome({ emoji: appIconHtml("settings", "app-icon title-icon"), showBack: true });
  clearNavScreenActive();
  els.settingsToggle.classList.add("screen-active");
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Settings";
  els.inspectorType.textContent = "App preferences";
  transitionInspectorBody(settingsFormHtml(), "forward");
  bindSettingsHandlers();
  setInspectorMinimized(false);
  updateCompassOverlay();
  requestDraw();
  if (state.userLocation) {
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
  }
}

function settingsFormHtml() {
  const minutes = state.walkingDistanceMinutes;
  const online = navigator.onLine;
  // The floor keeps the slider from being dragged down to a radius with nothing in it (see
  // walkingRadiusFloorMinutes, js/nav.js); a native <input type="range"> min attribute
  // enforces it directly, so there's no separate clamp to keep in sync here.
  // Snapped up onto the value grid (ceilWalkingMinutes): a range input steps from its own
  // min, so a raw floor like 0.41 would put every reachable value off the grid the label and
  // the pinch gesture use.
  const floorMinutes = ceilWalkingMinutes(walkingRadiusFloorMinutes(state.userLocation));
  // A floor below a minute means something is close enough to be worth the finer step.
  const stepMinutes = floorMinutes < 1 ? WALKING_RADIUS_FINE_STEP_MINUTES : WALKING_RADIUS_STEP_MINUTES;
  const sliderValue = clamp(minutes, floorMinutes, WALKING_RADIUS_MAX_MINUTES);
  const ticks = WALKING_RADIUS_PRESET_MINUTES
    .filter((m) => m >= floorMinutes && m <= WALKING_RADIUS_MAX_MINUTES)
    .map((m) => `<option value="${m}"></option>`)
    .join("");
  return `<div class="settings-form">
    <section class="settings-section">
      <h3 class="settings-section-title">Walking radius</h3>
      <p class="settings-description">How far to walk when listing nearby places. A circle is drawn on the map at this distance.</p>
      <label for="settingsWalkMins" class="settings-label">Walking time
        <span class="walk-radius-row">
          <input type="range" id="settingsWalkMins" class="walk-radius-range"
            min="${floorMinutes}" max="${WALKING_RADIUS_MAX_MINUTES}" step="${stepMinutes}"
            value="${sliderValue}" list="walkRadiusTicks">
          <span class="walk-radius-value" id="settingsWalkMinsValue">${formatWalkingRadius(sliderValue)}</span>
        </span>
        <datalist id="walkRadiusTicks">${ticks}</datalist>
      </label>
      <p class="source-note walk-radius-floor-note" id="settingsWalkMinsFloorNote"${sliderValue > floorMinutes ? " hidden" : ""}>This is as close as it gets — nothing closer to show nearby.</p>
    </section>
    <section class="settings-section">
      <h3 class="settings-section-title">About</h3>
      <p class="settings-description">App version: <span id="appVersionDisplay" class="app-version-display${state.swUpdateAvailable ? " sw-update-available" : ""}">${state.swVersion || APP_VERSION}</span></p>
      <p class="settings-description">Vibe coded by <a href="https://simonmcmanus.com" target="_blank" rel="noopener noreferrer">Simon McManus</a></p>
      <p id="dataUpdateNote" class="report-note"${state.dataUpdateAvailable ? "" : " hidden"}>New map data has been downloaded — reload to see it.</p>
      <div class="settings-refresh">
        <div class="settings-refresh-row">
          <button id="refreshDataButton" class="settings-refresh-btn" type="button"${online ? "" : " disabled"}>Refresh data</button>
          <button id="refreshAppButton" class="settings-refresh-btn" type="button"${online ? "" : " disabled"}>Refresh app</button>
          <button id="refreshAllButton" class="settings-refresh-btn" type="button"${online ? "" : " disabled"}>Refresh both</button>
        </div>
        <p class="settings-description">Map missing or out of date? <strong>Refresh data</strong> re-downloads the trees, paths and places. Not seeing the latest version? <strong>Refresh app</strong> clears the cached app. <strong>Refresh both</strong> starts completely cold.</p>
        <p id="refreshOfflineNote" class="report-note report-offline-note"${online ? " hidden" : ""}>Refreshing needs an internet connection — you\'re offline right now.</p>
      </div>
    </section>
  </div>`;
}

function bindSettingsHandlers() {
  refreshSettingsVersionDisplay();
  const range = document.getElementById("settingsWalkMins");
  if (range) {
    // If the floor has grown since this radius was last set (e.g. the user has moved
    // somewhere sparser), the browser silently clamps the slider's own displayed value to
    // its new min -- reconcile state.walkingDistanceMinutes to match so the ring, list, and
    // camera fit all agree with what's actually shown.
    const floorMinutes = Number(range.min);
    if (state.walkingDistanceMinutes < floorMinutes) {
      applyWalkingRadiusChange(floorMinutes, { animate: false });
    }

    const valueLabel = document.getElementById("settingsWalkMinsValue");
    const floorNote = document.getElementById("settingsWalkMinsFloorNote");

    // applyWalkingRadiusChange (js/nav.js) is the shared path the pinch-to-resize gesture
    // uses: it re-derives the nearest list and re-fits the camera through
    // ensureOverviewTargetsVisible, so the new radius is framed by whichever fit is
    // actually active (heading-up/3D included). This used to run its own flat, centred
    // animateViewportTo, which the next compass frame then re-fitted on top of.
    // "input" fires continuously while dragging -- animate:false snaps the camera straight
    // to each intermediate fit rather than queuing an animation per tick; "change" fires
    // once on release for the smooth settling motion (default animate:true).
    range.addEventListener("input", () => {
      // Snapped to the same grid the pinch gesture applies, so a fine-step slider (offered
      // when something sits less than a minute away) still lands on whole half-minutes once
      // it is dragged up past a minute.
      const value = roundWalkingMinutes(Number(range.value));
      if (valueLabel) valueLabel.textContent = formatWalkingRadius(value);
      if (floorNote) floorNote.hidden = value > floorMinutes;
      applyWalkingRadiusChange(value, { animate: false });
    });
    range.addEventListener("change", () => {
      refreshNearbyRadiusView();
    });
  }

  for (const scope of Object.keys(REFRESH_SCOPES)) {
    const button = document.getElementById(REFRESH_SCOPES[scope].buttonId);
    if (button) button.addEventListener("click", () => refreshCachedState(scope));
  }
  // Settings HTML is rebuilt fresh every time the screen opens (see openSettings above),
  // so remove before re-adding — otherwise every open leaks another window-level listener.
  window.removeEventListener("online", updateRefreshButtonsOnlineState);
  window.removeEventListener("offline", updateRefreshButtonsOnlineState);
  window.addEventListener("online", updateRefreshButtonsOnlineState);
  window.addEventListener("offline", updateRefreshButtonsOnlineState);
  updateRefreshButtonsOnlineState();
}

function openReportModal() {
  state.selected = { type: "report", item: null };
  setInspectorSelectionChrome({ emoji: appIconHtml("feedback", "app-icon title-icon"), showBack: true });
  clearNavScreenActive();
  els.reportToggle.classList.add("screen-active");
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Report";
  els.inspectorType.textContent = "Missing data / feature request";
  transitionInspectorBody(reportFormHtml(), "forward", () => {
    const detailsInput = document.getElementById("reportDetails");
    if (detailsInput) {
      detailsInput.focus();
      detailsInput.scrollIntoView({ block: "nearest" });
    }
  });
  bindReportFormHandlers();
  setReportStatus("");
  updateReportLocationLabel();
  setInspectorMinimized(false);
  updateCompassOverlay();
  requestDraw();
  if (state.userLocation) {
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
  }
}

function reportFormHtml() {
  let draft = {};
  try {
    const raw = localStorage.getItem(REPORT_DRAFT_KEY);
    if (raw) draft = JSON.parse(raw);
  } catch {}
  const detailsValue = draft.details || "";
  const online = navigator.onLine;
  return `<form id="reportForm" class="report-form">
      <label for="reportDetails">What did you notice?
        <textarea id="reportDetails" class="report-textarea" placeholder="Describe what's missing or what you'd like to see…" required>${escapeHtml(detailsValue)}</textarea>
      </label>
      <p id="reportStatus" class="report-status" aria-live="polite"></p>
      <p id="reportOfflineNote" class="report-note report-offline-note"${online ? " hidden" : ""}>Submission requires an internet connection. Your report is saved and will be ready to submit when you\'re back online.</p>
      <div class="report-form-actions">
        <button id="reportCancel" class="button button-ghost" type="button">Cancel</button>
        <button id="reportSubmit" class="button" type="submit"${online ? "" : " disabled"}>Submit</button>
      </div>
    </form>`;
}

function bindReportFormHandlers() {
  populateReportLocation();

  const cancelButton = document.getElementById("reportCancel");
  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      goToInitialView();
    });
  }

  const form = document.getElementById("reportForm");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitReportForm();
    });
  }

  // Save draft to localStorage as the user types
  function saveDraft() {
    const detailsInput = document.getElementById("reportDetails");
    try {
      localStorage.setItem(REPORT_DRAFT_KEY, JSON.stringify({
        details: detailsInput ? detailsInput.value : "",
      }));
    } catch {}
  }
  const detailsInput = document.getElementById("reportDetails");
  if (detailsInput) detailsInput.addEventListener("input", saveDraft);

  // Disable/enable submit when connectivity changes
  function updateOnlineState() {
    const submitBtn = document.getElementById("reportSubmit");
    const offlineNote = document.getElementById("reportOfflineNote");
    if (!submitBtn) return; // form has been removed from DOM
    const online = navigator.onLine;
    submitBtn.disabled = !online;
    if (offlineNote) offlineNote.hidden = online;
  }
  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);
}

function setReportStatus(message, tone = "") {
  const statusEl = document.getElementById("reportStatus");
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.classList.remove("error", "success");
  if (tone) statusEl.classList.add(tone);
}

function currentReportLocation() {
  const sourceLocation = state.reportDraftLocation || state.userLocation;
  if (!sourceLocation) return null;
  return {
    latitude: Number(sourceLocation.latitude.toFixed(6)),
    longitude: Number(sourceLocation.longitude.toFixed(6)),
  };
}

function updateReportLocationLabel() {
  const locationLabel = document.getElementById("reportLocationLabel");
  if (!locationLabel) return;
  const loc = currentReportLocation();
  if (!loc) {
    locationLabel.hidden = true;
    return;
  }
  locationLabel.hidden = false;
  locationLabel.textContent = `📍 ${loc.latitude}, ${loc.longitude}`;
}

async function populateReportLocation() {
  if (state.userLocation) return;
  if (!navigator.geolocation) return;
  await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition((position) => {
      state.reportDraftLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      resolve();
    }, resolve, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

function getOrCreateReportRequestId() {
  try {
    const existing = localStorage.getItem(REPORT_REQUEST_ID_KEY);
    if (existing) return existing;
  } catch {}
  const id = (window.crypto && window.crypto.randomUUID)
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem(REPORT_REQUEST_ID_KEY, id); } catch {}
  return id;
}

async function submitReportForm() {
  // Guard against duplicate GitHub issues from double-taps or a submit
  // firing again while the previous request is still in flight.
  if (state.reportSubmitting) return;

  const reportDetailsInput = document.getElementById("reportDetails");
  if (!reportDetailsInput) return;

  if (!navigator.onLine) {
    setReportStatus("No internet connection. Your report is saved and ready to submit when you\'re back online.", "error");
    return;
  }

  const details = String(reportDetailsInput.value || "").trim();
  if (!details) {
    setReportStatus("Please add details before submitting.", "error");
    return;
  }

  const payload = {
    reportType: "feedback",
    details,
    location: currentReportLocation(),
    appVersion: state.swVersion || APP_VERSION,
    userAgent: navigator.userAgent,
    pageUrl: window.location.href,
    // Stable per-report ID: stays the same across retries of this same
    // report so the server can recognise and skip a resubmission.
    requestId: getOrCreateReportRequestId(),
  };

  state.reportSubmitting = true;
  const submitButton = document.getElementById("reportSubmit");
  if (submitButton) submitButton.disabled = true;
  setReportStatus("Submitting report…");

  try {
    const response = await fetch("/.netlify/functions/report-missing-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorText = data && data.error ? data.error : `Request failed (${response.status})`;
      setReportStatus(errorText, "error");
      return;
    }

    const issueText = data && data.issueUrl ? ` Issue: ${data.issueUrl}` : "";
    setReportStatus(`Report submitted successfully.${issueText}`, "success");
    reportDetailsInput.value = "";
    try {
      localStorage.removeItem(REPORT_DRAFT_KEY);
      localStorage.removeItem(REPORT_REQUEST_ID_KEY);
    } catch {}
  } catch (error) {
    setReportStatus("Could not submit report. Please try again.", "error");
  } finally {
    state.reportSubmitting = false;
    if (submitButton) submitButton.disabled = !navigator.onLine;
  }
}

function resolvePlaceKind(place) {
  if (isPubCategory(place)) return "pubs";
  if (isRestaurantCategory(place)) return "restaurants";
  if (isCafeCategory(place)) return "cafes";
  if (isShopCategory(place)) return "shops";
  if (isParkingCategory(place)) return "parking";
  if (isBusCategory(place)) return "bus";
  if (isUndergroundCategory(place)) return "underground";
  if (isNationalRailCategory(place)) return "national_rail";
  if (isWw2Category(place)) return "ww2";
  if (isRoyalCategory(place)) return "royal";
  if (isSocialHistoryCategory(place)) return "social_history";
  if (isPlaqueCategory(place)) return "plaques";
  if (isBluePlaqueCategory(place)) return "blue_plaques";
  if (isHistoryCategory(place)
    && !isRoyalCategory(place)
    && !isWw2Category(place)
    && !isSocialHistoryCategory(place)
    && !isPlaqueCategory(place)
    && !isBluePlaqueCategory(place)) return "history_general";
  if (isCelebrityAssociationCategory(place)) return "celebrity_association";
  if (isScienceCategory(place)) return "science";
  if (isEducationCategory(place)) return "education";
  if (isMedicineCategory(place)) return "medicine";
  if (isLiteratureCategory(place)) return "literature";
  if (isTheatreCategory(place)) return "theatre";
  if (isPoliticsCategory(place)) return "politics";
  if (isArtCategory(place)) return "art";
  if (isChurchCategory(place)) return "church";
  if (isLegendCategory(place)) return "legends";
  if (isFilmTvCategory(place)) return "film_tv";
  return "landmark";
}

function outOfRadiusCountForGroup(groupKey) {
  if (!state.userLocation) return 0;

  const group = FILTER_GROUPS_BY_KEY.get(groupKey);
  if (!group || !Array.isArray(group.subfilters) || !group.subfilters.length) return 0;

  const currentSet = activeOverviewFilterSet();
  const activeSubfilters = group.subfilters.filter((subfilter) => currentSet.has(subfilter.key));
  const subfiltersToCount = state.overviewFilters.length > 0 ? activeSubfilters : group.subfilters;
  if (!subfiltersToCount.length) return 0;

  const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
  const { latitude, longitude } = state.userLocation;
  const unique = new Set();

  for (const subfilter of subfiltersToCount) {
    const filterKey = subfilter.key;
    if (filterKey === "trees") {
      for (const tree of state.trees) {
        const metres = distanceMetres(latitude, longitude, tree.latitude, tree.longitude);
        if (metres > radiusMetres) unique.add(`tree:${treeHashKey(tree)}`);
      }
      continue;
    }
    if (filterKey === "cows") {
      for (const cow of state.cows) {
        const metres = distanceMetres(latitude, longitude, cow.latitude, cow.longitude);
        if (metres > radiusMetres) unique.add(`cow:${cowKey(cow)}`);
      }
      continue;
    }

    if (filterKey === "waymarked_trails") {
      for (const path of state.paths) {
        if (!isWaymarkedTrail(path)) continue;
        const metres = distanceFromUserToPath(path);
        if (metres > radiusMetres) unique.add(`path:${pathHashKey(path)}`);
      }
      continue;
    }

    for (const place of state.landmarks) {
      if (!matchesPlaceFilter(place, filterKey)) continue;
      const metres = distanceMetres(latitude, longitude, place.latitude, place.longitude);
      if (metres > radiusMetres) unique.add(`place:${placeHashKey(place)}`);
    }
  }

  return unique.size;
}

function isLayerVisibleForFilter(layerKey) {
  if (!state.overviewFilters.length) return true;
  return isSubfilterActive(layerKey);
}

function isTreeVisibleForFilter() {
  return state.overviewFilters.length === 0 || isSubfilterActive("trees");
}

function isCowVisibleForFilter() {
  return state.overviewFilters.length === 0 || isSubfilterActive("cows");
}

function isPlaceVisibleForFilter(place) {
  if (state.overviewFilters.length === 0) return true;
  const activePlaceFilters = getActivePlaceFilterKeys();
  if (!activePlaceFilters.length) return false;
  return activePlaceFilters.some((filterKey) => matchesPlaceFilter(place, filterKey));
}

function overviewEntryKey(entry) {
  if (!entry || !entry.item) return "";
  if (entry.type === "tree") return `tree:${treeHashKey(entry.item)}`;
  if (entry.type === "cow") return `cow:${cowKey(entry.item)}`;
  if (entry.type === "path") return `path:${pathHashKey(entry.item)}`;
  if (entry.type === "water") return `water:${waterHashKey(entry.item)}`;
  return `place:${placeHashKey(entry.item)}`;
}

function uniqueSortedOverviewEntries(entries) {
  const unique = new Map();
  for (const entry of entries) {
    const key = overviewEntryKey(entry);
    if (!key) continue;
    const existing = unique.get(key);
    if (!existing || entry.metres < existing.metres) unique.set(key, entry);
  }
  return Array.from(unique.values()).sort((a, b) => a.metres - b.metres);
}

function nearestOverviewEntriesForFilter(filterKey, latitude, longitude, limit) {
  if (filterKey === "trees") {
    return nearestTreesTo(latitude, longitude, limit).map(({ tree, metres }) => ({ kind: "tree", type: "tree", item: tree, metres }));
  }
  if (filterKey === "cows") {
    return nearestCowsTo(latitude, longitude, limit).map(({ cow, metres }) => ({ kind: "cow", type: "cow", item: cow, metres }));
  }
  if (filterKey === "waymarked_trails") {
    return nearestWaymarkedPathsToUser(limit, latitude, longitude).map(({ path, metres }) => ({ kind: "waymarked_trails", type: "path", item: path, metres }));
  }
  if (filterKey === "ponds_streams") {
    if (!state.userLocation) return [];
    return nearestWaterFeaturesTo(latitude, longitude, limit).map(({ water, metres }) => ({ kind: "ponds_streams", type: "water", item: water, metres }));
  }
  return nearestPlacesByFilter(latitude, longitude, (place) => matchesPlaceFilter(place, filterKey), limit)
    .map(({ place, metres }) => ({ kind: filterKey, type: "landmark", item: place, metres }));
}

function nearestOverviewEntryForFilter(filterKey, latitude, longitude) {
  if (filterKey === "trees") {
    const nearest = nearestTreeTo(latitude, longitude);
    return nearest ? { kind: "tree", type: "tree", item: nearest.tree, metres: nearest.metres } : null;
  }
  if (filterKey === "cows") {
    const nearest = nearestCowTo(latitude, longitude);
    return nearest ? { kind: "cow", type: "cow", item: nearest.cow, metres: nearest.metres } : null;
  }
  if (filterKey === "waymarked_trails") {
    const nearest = nearestWaymarkedPathToUser(latitude, longitude);
    return nearest ? { kind: "waymarked_trails", type: "path", item: nearest.path, metres: nearest.metres } : null;
  }
  if (filterKey === "ponds_streams") {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const nearest = nearestWaterFeatureTo(latitude, longitude);
    return nearest ? { kind: "ponds_streams", type: "water", item: nearest.water, metres: nearest.metres } : null;
  }
  const nearest = nearestPlaceByFilter(latitude, longitude, (place) => matchesPlaceFilter(place, filterKey));
  return nearest ? { kind: filterKey, type: "landmark", item: nearest.place, metres: nearest.metres } : null;
}

function nearestFallbackEntriesForActiveFilter(latitude, longitude) {
  const entries = [];
  for (const filterKey of pointFilterKeysForNearestFallback()) {
    const entry = nearestOverviewEntryForFilter(filterKey, latitude, longitude);
    if (entry) entries.push(entry);
  }
  return uniqueSortedOverviewEntries(entries);
}

function overviewItemsUnlimited(latitude, longitude, limit = state.nearestItemsCount) {
  const hasFilters = state.overviewFilters.length > 0;
  if (hasFilters) {
    const activePointFilters = getActivePointFilterKeys();
    if (!activePointFilters.length) return [];
    const entries = [];
    for (const filterKey of activePointFilters) {
      entries.push(...nearestOverviewEntriesForFilter(filterKey, latitude, longitude, limit));
    }
    return uniqueSortedOverviewEntries(entries);
  }
  const entries = [];
  entries.push(...nearestTreesTo(latitude, longitude, limit).map(({ tree, metres }) => ({ kind: "tree", type: "tree", item: tree, metres })));
  entries.push(...nearestCowsTo(latitude, longitude, limit).map(({ cow, metres }) => ({ kind: "cow", type: "cow", item: cow, metres })));
  entries.push(...nearestWaymarkedPathsToUser(limit, latitude, longitude).map(({ path, metres }) => ({ kind: "waymarked_trails", type: "path", item: path, metres })));
  entries.push(...nearestWaterFeaturesTo(latitude, longitude, limit).map(({ water, metres }) => ({ kind: "ponds_streams", type: "water", item: water, metres })));
  entries.push(...nearestPlacesByFilter(latitude, longitude, () => true, limit).map(({ place, metres }) => ({ kind: resolvePlaceKind(place), type: "landmark", item: place, metres })));
  return entries.sort((a, b) => a.metres - b.metres);
}

// overviewItemsForActiveFilter is the shared source of "what's within the walking radius"
// for the nearby list, the map pin lookup (buildNearbyIconLookup in js/renderer.js, called
// twice per animation frame), the overview route lines, and the camera fit -- all of which
// want the *complete* set of matches (so growing the radius via pinch or Settings actually
// reveals everything now inside it), not a truncated one. Recomputing that full distance
// scan from scratch on every draw() call was the actual freeze at a large radius (tens of
// thousands of trees within range), not the size of the result itself -- filtering the raw
// dataset is a few milliseconds even for the full ~25k trees (measured), it just shouldn't
// happen 60+ times a second when nothing that affects the result has changed. Memoize it
// instead, and let each *consumer* decide how much of the full list it actually needs to
// render (see the .slice() calls in overviewNearestHtml and overviewRouteTargets).
let _overviewItemsCache = null;

// The cache key above covers everything that changes the *filter* (origin, radius, active
// filters, cow refresh) but not the underlying datasets themselves -- those only ever
// change once, at load, in the real app. The unit test harness reassigns state.trees/etc.
// to fresh arrays between test cases while reusing the same running module (so module-level
// caches like this one persist across tests), which a key built only from primitives can't
// see; comparing array references catches that too, at effectively no cost.
function overviewItemsDatasetsUnchanged(cache) {
  return cache.trees === state.trees
    && cache.cows === state.cows
    && cache.landmarks === state.landmarks
    && cache.paths === state.paths
    && cache.waterFeatures === state.waterFeatures;
}

function storeOverviewItemsCache(cacheKey, result) {
  _overviewItemsCache = {
    key: cacheKey,
    result,
    outsideRadiusFallback: state.overviewOutsideRadiusFallback,
    trees: state.trees,
    cows: state.cows,
    landmarks: state.landmarks,
    paths: state.paths,
    waterFeatures: state.waterFeatures,
  };
  return result;
}

function overviewItemsForActiveFilter() {
  // nearbyOrigin() everywhere, Filter/Settings/Report included: those screens draw the
  // walking-radius ring around the browse anchor like the Nearby screen does, and the anchor
  // can now be moved, reset and resized from them (updateNearbyAnchorBar/startNearbyRadius-
  // Pinch, js/nav.js). Reading the raw GPS fix here instead left the ring centred on the
  // browsed spot while the matches inside it were still scanned from wherever the user
  // actually stood. With no anchor set -- the usual case -- this is the GPS fix as before.
  const origin = nearbyOrigin();
  if (!origin) return [];
  const { latitude, longitude } = origin;

  if (state.showAllOutsideRadius) {
    state.overviewOutsideRadiusFallback = false;
    return overviewItemsUnlimited(latitude, longitude);
  }

  const cacheKey = `${latitude}|${longitude}|${state.walkingDistanceMinutes}|${state.overviewFilters.join(",")}|${state.cowLastUpdatedAt}`;
  if (_overviewItemsCache && _overviewItemsCache.key === cacheKey && overviewItemsDatasetsUnchanged(_overviewItemsCache)) {
    state.overviewOutsideRadiusFallback = _overviewItemsCache.outsideRadiusFallback;
    return _overviewItemsCache.result;
  }

  state.overviewOutsideRadiusFallback = false;
  const maxMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);

  const hasFilters = state.overviewFilters.length > 0;
  if (hasFilters) {
    const activePointFilters = getActivePointFilterKeys();
    if (!activePointFilters.length) {
      return storeOverviewItemsCache(cacheKey, []);
    }
    const selectedEntries = [];
    const filterTypesWithResults = new Set();

    for (const filterKey of activePointFilters) {
      let entriesForFilter = [];

      if (filterKey === "trees") {
        entriesForFilter = nearbyTreesWithinDistance(latitude, longitude, maxMetres).map(({ tree, metres }) => ({
          kind: "tree",
          type: "tree",
          item: tree,
          metres,
        }));
      } else if (filterKey === "cows") {
        entriesForFilter = nearbyCowsWithinDistance(latitude, longitude, maxMetres).map(({ cow, metres }) => ({
          kind: "cow",
          type: "cow",
          item: cow,
          metres,
        }));
      } else if (filterKey === "waymarked_trails") {
        entriesForFilter = nearbyWaymarkedPathsWithinDistance(latitude, longitude, maxMetres).map(({ path, metres }) => ({
          kind: "waymarked_trails",
          type: "path",
          item: path,
          metres,
        }));
      } else if (filterKey === "ponds_streams") {
        entriesForFilter = nearbyWaterFeaturesWithinDistance(latitude, longitude, maxMetres).map(({ water, metres }) => ({
          kind: "ponds_streams",
          type: "water",
          item: water,
          metres,
        }));
      } else {
        entriesForFilter = nearbyPlacesByFilterWithinDistance(latitude, longitude, (place) => matchesPlaceFilter(place, filterKey), maxMetres).map(({ place, metres }) => ({
          kind: filterKey,
          type: "landmark",
          item: place,
          metres,
        }));
      }

      if (entriesForFilter.length > 0) {
        selectedEntries.push(...entriesForFilter);
        filterTypesWithResults.add(filterKey);
      } else {
        // No items within radius for this filter - add nearest 3 as fallback.
        // outOfRadiusFilterKey records *which* filter went unanswered: entry.kind is the item's
        // own kind ("tree" for the "trees" filter), so it cannot be matched back to a filter key
        // on its own, and the camera reveal below needs exactly that mapping.
        const fallbackEntries = nearestOverviewEntriesForFilter(filterKey, latitude, longitude, 3);
        for (const entry of fallbackEntries) {
          entry.outOfRadius = true;
          entry.outOfRadiusFilterKey = filterKey;
          selectedEntries.push(entry);
        }
      }
    }

    const sortedEntries = uniqueSortedOverviewEntries(selectedEntries);
    const hasAnyFallback = sortedEntries.some(entry => entry.outOfRadius);
    state.overviewOutsideRadiusFallback = hasAnyFallback && filterTypesWithResults.size === 0;

    return storeOverviewItemsCache(cacheKey, sortedEntries);
  }

  const entries = [];
  entries.push(
    ...nearbyTreesWithinDistance(latitude, longitude, maxMetres).map(({ tree, metres }) => ({
      kind: "tree",
      type: "tree",
      item: tree,
      metres,
    }))
  );
  entries.push(
    ...nearbyCowsWithinDistance(latitude, longitude, maxMetres).map(({ cow, metres }) => ({
      kind: "cow",
      type: "cow",
      item: cow,
      metres,
    }))
  );
  entries.push(
    ...nearbyWaymarkedPathsWithinDistance(latitude, longitude, maxMetres).map(({ path, metres }) => ({
      kind: "waymarked_trails",
      type: "path",
      item: path,
      metres,
    }))
  );
  entries.push(
    ...nearbyWaterFeaturesWithinDistance(latitude, longitude, maxMetres).map(({ water, metres }) => ({
      kind: "ponds_streams",
      type: "water",
      item: water,
      metres,
    }))
  );
  entries.push(
    ...nearbyPlacesByFilterWithinDistance(latitude, longitude, () => true, maxMetres).map(({ place, metres }) => ({
      kind: resolvePlaceKind(place),
      type: "landmark",
      item: place,
      metres,
    }))
  );
  const sortedEntries = entries.sort((a, b) => a.metres - b.metres);
  if (!sortedEntries.length) {
    const fallbackEntries = nearestFallbackEntriesForActiveFilter(latitude, longitude);
    state.overviewOutsideRadiusFallback = fallbackEntries.length > 0;
    return storeOverviewItemsCache(cacheKey, fallbackEntries);
  }
  return storeOverviewItemsCache(cacheKey, sortedEntries);
}

// --- Heads-up ordering ---------------------------------------------------------------
//
// The Nearby list is a heads-up view, not a distance table: of two things the same walk
// away, the one you are facing is the one you are about to walk into, so it belongs above
// the one at your back. Each entry is scored as an *effective* distance --
//
//   metres * (1 + HEADS_UP_BEHIND_PENALTY * (1 - cos(delta)) / 2)
//
// -- where delta is the angle between your heading and the bearing to the item. Dead ahead
// keeps its true distance, dead behind counts as (1 + penalty) times as far, and the sides
// fall smoothly in between. Distance still dominates: at penalty 1 something behind you only
// loses to something ahead that is less than twice as far, so the list never promotes a
// far-off thing over one you could reach in seconds.
const HEADS_UP_BEHIND_PENALTY = 1;

// How far you have to turn before the list re-sorts. The compass is smoothed but never
// still, and re-ranking on every frame would have the list shuffling under your thumb; a
// deliberate turn crosses this in one movement, and the reorder animates (see
// animateNearestItemReorder, js/inspector.js) so the change is legible rather than abrupt.
const HEADS_UP_REORDER_DEGREES = 12;

// The heading the list is currently ordered by -- deliberately *not* the live compass value,
// for the reason above. Latched to the live heading the first time one is available, and
// afterwards only by syncNearbyListHeading().
function nearbyListHeading() {
  if (!Number.isFinite(state.compassHeading)) return null;
  if (!Number.isFinite(state.nearbyListHeading)) {
    state.nearbyListHeading = normalizeDegrees(state.compassHeading);
  }
  return state.nearbyListHeading;
}

// Called from the compass smoothing loop. Adopts the live heading once it has moved a real
// turn away from the one the list is ordered by, and reports whether it did, so the caller
// can re-render.
function syncNearbyListHeading() {
  if (!Number.isFinite(state.compassHeading)) return false;
  const live = normalizeDegrees(state.compassHeading);
  const settled = state.nearbyListHeading;
  if (Number.isFinite(settled) && Math.abs(shortestCompassDelta(settled, live)) < HEADS_UP_REORDER_DEGREES) {
    return false;
  }
  state.nearbyListHeading = live;
  return true;
}

function headsUpScore(entry, origin, heading) {
  const metres = Number(entry && entry.metres);
  if (!Number.isFinite(metres)) return Number.POSITIVE_INFINITY;
  if (!origin || !Number.isFinite(heading)) return metres;
  const item = entry.item;
  // Trails and water features are lines/areas with no single coordinate to take a bearing
  // to, so they keep their plain distance rank rather than being guessed at.
  if (!item || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return metres;
  const bearing = bearingDegrees(origin.latitude, origin.longitude, item.latitude, item.longitude);
  const delta = toRadians(shortestCompassDelta(heading, bearing));
  return metres * (1 + HEADS_UP_BEHIND_PENALTY * (1 - Math.cos(delta)) / 2);
}

// Returns a new array (never the memoized overviewItemsForActiveFilter() result, which the
// renderer also reads) ordered by heads-up score. With no compass -- desktop, or location
// without orientation -- this is the plain nearest-first order it has always been.
function headsUpSortedEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2) return entries;
  const heading = nearbyListHeading();
  const origin = nearbyOrigin();
  if (!Number.isFinite(heading) || !origin) return entries;
  return entries
    .map((entry, index) => ({ entry, index, score: headsUpScore(entry, origin, heading) }))
    // Ties fall back to the incoming distance order, so the sort stays deterministic.
    .sort((a, b) => (a.score - b.score) || (a.index - b.index))
    .map((scored) => scored.entry);
}

function overviewNearestHtml() {
  if (!state.userLocation) {
    return `<p class="empty">Use your location to list the nearest trees, cows, cafés, transport links, pubs, and landmarks.</p>`;
  }

  // The "showing places near where you tapped / use my location" notice is no longer part of
  // this list -- it is the persistent #nearbyAnchorBar in the inspector chrome, so it stays
  // reachable from Filters/Settings/Report too (updateNearbyAnchorBar, js/nav.js).

  // Set by the pinch-to-resize gesture (updateNearbyRadiusPinch, js/nav.js) while the user
  // is actively squeezing past the walking-radius floor -- visual feedback for a gesture
  // that has no slider to show it on. Transient: cleared as soon as the pinch ends.
  const floorNotice = state.walkingRadiusAtFloor
    ? `<p class="source-note walk-radius-floor-notice">This is as close as it gets — nothing closer to show.</p>`
    : "";

  // overviewItemsForActiveFilter() now returns every match within the radius (see its
  // comment) so the map can show all of them -- this scrollable text list still only
  // wants to display the nearest handful, so cap it here instead.
  // Heads-up ordering is applied to the *whole* in-radius set before the display cap, so a
  // find you are walking straight at can climb into the visible handful rather than being
  // cut off by a closer one behind your shoulder.
  const allEntries = headsUpSortedEntries(overviewItemsForActiveFilter());
  const entries = allEntries.slice(0, state.nearestItemsCount);
  const activePointFilters = getActivePointFilterKeys();
  if (!allEntries.length) {
    if (state.overviewFilters.length > 0 && activePointFilters.length === 0) {
      return `<p class="empty">Selected map layers are shown on the map. Add Trees, Cows, or another point filter to list nearby items.</p>`;
    }
    if (activePointFilters.length === 1) {
      const meta = filterMeta(activePointFilters[0]);
      return `<p class="empty">No nearby ${escapeHtml(meta ? meta.title : "items")} found.</p>`;
    }
    return `<p class="empty">No nearby places found.</p>`;
  }

  // The radius is the whole premise of this list, so the heading names it rather than the
  // vaguer "around you" -- "Trees within 5 min walk" answers "how far is this list reaching?"
  // without the user having to go and read the walk chip. The radius chip can be toggled off
  // (showAllOutsideRadius), in which case there is no radius to name and the heading says so.
  const radiusLabel = state.showAllOutsideRadius
    ? null
    : `${formatWalkingRadius(state.walkingDistanceMinutes)} walk`;
  // Filter titles are stored lower case ("trees", "pubs and bars") because they read as a
  // fragment everywhere else they are used; at the head of a sentence they need a capital.
  // .nearby-heading uppercases the whole thing visually, but the underlying text is what a
  // screen reader announces.
  const rawTitle = activePointFilters.length === 1
    ? (filterMeta(activePointFilters[0])?.title || "items")
    : null;
  const singleFilterTitle = rawTitle ? rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1) : null;
  const heading = singleFilterTitle
    ? (radiusLabel ? `${singleFilterTitle} within ${radiusLabel}` : `Nearest ${singleFilterTitle} around you`)
    : state.overviewFilters.length > 0
      ? (radiusLabel ? `Nearest selected filters within ${radiusLabel}` : "Nearest selected filters around you")
      : (radiusLabel ? `Nearest within ${radiusLabel}` : "Nearest around you");

  const itemsHtml = entries.map((entry) => {
    const name = entry.type === "tree"
      ? treeDisplayName(entry.item)
      : entry.type === "cow"
        ? "Cow"
        : entry.type === "path"
          ? displayValue(entry.item.name || entry.item.ref || "Waymarked trail")
      : entry.type === "water"
        ? entry.item.name
      : placeTitle(entry.item);
    const emoji = entry.type === "tree"
      ? (treeSpeciesIconHtml(entry.item.commonName, entry.item.latinName) || filterKindEmoji(entry.kind))
      : (filterKindEmoji(entry.kind) || landmarkEmoji(entry.item));
    const key = entry.type === "tree" ? treeHashKey(entry.item) : entry.type === "cow" ? cowKey(entry.item) : entry.type === "path" ? pathHashKey(entry.item) : entry.type === "water" ? waterHashKey(entry.item) : placeHashKey(entry.item);
    const walkChip = walkInfoHtml(entry.metres);
    const typeLabel = filterMeta(entry.kind)?.label || (entry.type === "tree" ? "Tree" : entry.type === "cow" ? "Cow" : entry.type === "path" ? "Trail" : entry.type === "water" ? "Water" : "Place");
    const treeTag = entry.type === "tree" ? treeTagLabel(entry.item) : null;
    const treeTagChip = treeTag ? ` · #${escapeHtml(treeTag)}` : "";
    const outOfRadiusClass = entry.outOfRadius ? " out-of-radius" : "";
    return `<li><button class="nearest-item${outOfRadiusClass}" type="button" data-overview-type="${entry.type}" data-overview-key="${escapeHtml(key)}">
      <div class="nearest-header">
        <span class="nearest-icon" aria-hidden="true">${emoji}</span>
        <span class="nearest-name">${escapeHtml(name)}</span>
      </div>
      <div class="nearest-footer">
        <span class="nearest-meta">${walkChip ? `${walkChip} · ` : ""}${escapeHtml(typeLabel)}${treeTagChip}</span>
        <span class="nearest-arrow" data-item-lat="${entry.item.latitude ?? ""}" data-item-lon="${entry.item.longitude ?? ""}" aria-hidden="true">↑</span>
      </div>
    </button></li>`;
  }).join("");

  const fallbackNotice = state.overviewOutsideRadiusFallback
    ? `<p class="source-note"><strong>Nothing found within ${formatWalkingRadius(state.walkingDistanceMinutes)} walking distance.</strong><br><small>Showing the closest match for each selected type instead.</small></p>`
    : "";
  const radiusActive = !state.showAllOutsideRadius;
  const chipTitle = radiusActive
    ? `Showing within ${formatWalkingRadius(state.walkingDistanceMinutes)} walk — tap to show all`
    : `Showing all distances — tap to filter to ${formatWalkingRadius(state.walkingDistanceMinutes)} walk`;
  const chipLabel = radiusActive ? formatWalkingRadius(state.walkingDistanceMinutes) : "All";
  const walkChip = `<button class="walk-chip walk-chip-toggle${radiusActive ? "" : " walk-chip-toggle--off"}" type="button" data-action="toggle-radius" aria-pressed="${radiusActive}" title="${chipTitle}"><span class="walk-time">${chipLabel}</span> ${appIconHtml("walking", "app-icon walk-icon")}</button>`;
  return `<div class="nearby-heading"><strong>${escapeHtml(heading)}</strong></div>${floorNotice}${fallbackNotice}<ul class="nearest-list">${itemsHtml}</ul>`;
}

function landmarkEmoji(place) {
  for (const filterKey of PLACE_FILTER_PRIORITY) {
    if (matchesPlaceFilter(place, filterKey)) {
      return filterKindEmoji(filterKey) || "📍";
    }
  }
  const slug = landmarkIconSlug(place);
  if (slug) return appIconHtml(slug);
  return landmarkTypeEmoji(place) || "📍";
}

function landmarkTypeEmoji(place) {
  if (!place) return null;
  if (hasAnyPlaceTag(place, ["parking"])) return "🅿️";
  if (hasAnyPlaceTag(place, ["bicycle_parking", "cycle_parking"])) return "🚲";
  if (hasAnyPlaceTag(place, ["bench"])) return "🪑";
  if (hasAnyPlaceTag(place, ["toilets"])) return "🚻";
  if (hasAnyPlaceTag(place, ["drinking_water", "water_well"])) return "🚰";
  if (hasAnyPlaceTag(place, ["information"])) return "ℹ️";
  if (hasAnyPlaceTag(place, ["memorial"])) return "🕯️";
  if (hasAnyPlaceTag(place, ["monument", "boundary_stone"])) return "🗿";
  if (hasAnyPlaceTag(place, ["archaeological_site", "roman_road", "ruins"])) return "🏺";
  if (hasAnyPlaceTag(place, ["museum", "attraction", "building", "folly", "tomb", "gate_pier"])) return "🏛️";
  if (hasAnyPlaceTag(place, ["camp_site", "caravan_site"])) return "⛺";
  if (hasAnyPlaceTag(place, ["picnic_site"])) return "🧺";
  if (hasAnyPlaceTag(place, ["viewpoint"])) return "🔭";
  if (hasAnyPlaceTag(place, ["taxi"])) return "🚕";
  if (hasAnyPlaceTag(place, ["telephone"])) return "☎️";
  if (hasAnyPlaceTag(place, ["events_venue"])) return "🎟️";
  if (hasAnyPlaceTag(place, ["alcohol"])) return "🍷";
  if (hasAnyPlaceTag(place, ["chemist"])) return "⚕️";
  if (hasAnyPlaceTag(place, ["dry_cleaning"])) return "👔";
  if (hasAnyPlaceTag(place, ["cafe", "tea"])) return "☕";
  if (hasAnyPlaceTag(place, ["gate", "entrance", "stile", "kissing_gate", "cycle_barrier", "lift_gate", "swing_gate", "cattle_grid", "fence"])) return appIconHtml("gate");
  return "📍";
}

function hasAnyPlaceTag(place, tags) {
  return tags.some((tag) => hasPlaceTag(place, tag));
}

function directionLabelFor(item) {
  if (!state.userLocation || !item || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return null;
  const bearing = bearingDegrees(state.userLocation.latitude, state.userLocation.longitude, item.latitude, item.longitude);
  const arrow = bearingArrow(bearing);
  const cardinal = bearingCardinal(bearing);
  return `${arrow} ${cardinal} (${Math.round(bearing)}°)`;
}

function directionTextFor(item) {
  if (!state.userLocation || !item || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return null;
  const bearing = bearingDegrees(state.userLocation.latitude, state.userLocation.longitude, item.latitude, item.longitude);
  return `${bearingCardinal(bearing)} (${Math.round(bearing)}°)`;
}

function bearingForItem(item) {
  if (!state.userLocation || !item || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return null;
  return bearingDegrees(state.userLocation.latitude, state.userLocation.longitude, item.latitude, item.longitude);
}

async function startCompassNavigation() {
  if (!selectedCompassTarget()) {
    updateCompassOverlay();
    return;
  }

  ensureLocationWatch();

  await requestCompassPermissionIfNeeded();

  if (state.compassPermission !== "granted") {
    showCompassAccessPrompt();
  }

  updateCompassOverlay();
}

function showCompassAccessPrompt() {
  const message = "On iPhone, go to Settings → Safari → Motion & Orientation Access → On, then tap below to enable compass guidance.";
  setLocationGateVisible(true, message, "Enable compass and location", "Allow compass access");
}

function compassPermissionCanBeRequested() {
  return typeof DeviceOrientationEvent !== "undefined"
    && typeof DeviceOrientationEvent.requestPermission === "function";
}

async function requestCompassPermissionIfNeeded({ fromGesture = false } = {}) {
  if (typeof DeviceOrientationEvent === "undefined") {
    if (fromGesture && state.userLocation) {
      const message = "Compass is not available on this device or browser. You can still use the map and tap any tree to see its distance.";
      setLocationGateVisible(true, message, "Continue without compass", "Compass unavailable");
    }
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission !== "function") {
    if (state.compassPermission === "unknown") state.compassPermission = "granted";
    try {
      localStorage.setItem(COMPASS_PERMISSION_KEY, "granted");
    } catch {}
    return;
  }
  if (state.compassPermission === "granted") return;
  if (!fromGesture) return;

  try {
    const permission = await DeviceOrientationEvent.requestPermission();
    state.compassPermission = permission === "granted" ? "granted" : "denied";
    try {
      localStorage.setItem(COMPASS_PERMISSION_KEY, state.compassPermission);
    } catch {}
    if (state.compassPermission !== "granted") {
      showCompassAccessPrompt();
    }
  } catch {
    state.compassPermission = "denied";
    try {
      localStorage.setItem(COMPASS_PERMISSION_KEY, "denied");
    } catch {}
    showCompassAccessPrompt();
  }
}

function compassPermissionRequiresRequest() {
  return state.compassPermission !== "granted";
}

function setupCompassListeners() {
  reattachCompassListeners();
}

// remove-then-add is deliberate: on iOS re-registering is what nudges the orientation
// sensor back into firing after it has been suspended. A bare addEventListener would be
// a no-op for an already-registered handler and so would nudge nothing.
function reattachCompassListeners() {
  window.removeEventListener("deviceorientationabsolute", onDeviceOrientation, true);
  window.removeEventListener("deviceorientation", onDeviceOrientation, true);
  window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
  window.addEventListener("deviceorientation", onDeviceOrientation, true);
}

function compassEventAgeMs(now = performance.now()) {
  return state.compassLastEventAt == null ? Infinity : (now - state.compassLastEventAt);
}

function orientationEventAgeMs(now = performance.now()) {
  return state.orientationLastEventAt == null ? Infinity : (now - state.orientationLastEventAt);
}

// True only once the sensor HAS delivered to this handler at some point and has since
// gone quiet. Both null checks matter. Without them this is permanently true on a device
// with no compass at all (desktop, permission never granted) and the watchdog thrashes
// listeners forever. orientationLastEventAt is additionally the only one of the two that
// no one but onDeviceOrientation ever writes, so requiring it keeps the watchdog inert
// for code that drives heading state directly without any event ever firing -- the e2e
// tilt specs do exactly that, and a watchdog waking mid-assertion to clear the heading
// and repaint is a state change they have no way to see coming.
function compassSensorStalled(now = performance.now()) {
  if (state.compassLastEventAt == null || state.orientationLastEventAt == null) return false;
  return compassEventAgeMs(now) > COMPASS_STALE_MS;
}

// Single recovery path, shared by the foreground-resume hooks and the watchdog below.
// This logic used to live inline in the visibilitychange handler, which gave it exactly
// one chance per return to the foreground -- so if the sensor came back later than that
// one check (iOS routinely takes a moment, and sometimes never resumes without a nudge)
// the map was left frozen on a stale heading, or stuck north-up with no tilt, until the
// page was reloaded. That is the "put the phone down, come back, only a refresh fixes
// it" report. Running it repeatedly is what lets the app heal itself instead.
function recoverStalledCompass(now = performance.now()) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (!compassSensorStalled(now)) return;

  // Drop a heading we can no longer trust so the map falls back to north-up rather than
  // rendering a frozen rotation as if it were live. New readings go back through the
  // calibration gate before rotation (and with it tilt, which headingUpActive() gates)
  // resumes.
  if (Number.isFinite(state.compassHeading)) {
    state.compassHeading = null;
    state.compassHeadingTarget = null;
    state.nearbyListHeading = null;
    state.renderedNavigationHeading = null;
    state.headingUpEntryAnim = null;
    resetCompassCalibration();
    if (typeof updateCompassOverlay === "function") updateCompassOverlay();
    requestDraw();
  }

  // Orientation events are still arriving, just without a heading: the sensor is alive,
  // so re-registering achieves nothing and would only thrash. Ask for the movement that
  // actually re-calibrates the magnetometer instead.
  if (orientationEventAgeMs(now) <= COMPASS_HEADINGLESS_PROMPT_MS) {
    showCompassCalibrationPrompt();
    return;
  }

  reattachCompassListeners();
}

// Every animation loop here re-arms itself from inside its own requestAnimationFrame callback
// and parks the pending handle on `state`, so a second request cannot stack a duplicate loop.
// Backgrounding the page breaks that contract: rAF callbacks do not run while hidden, and a
// frame requested just before the app went away is frequently dropped outright rather than
// delivered on return (iOS does this routinely when you switch to another app). The handle is
// then set for ever, and the guard that exists to stop duplicate loops silently stops the loop
// restarting at all -- requestDraw() never paints again, startCompassSmoothing() never eases
// the heading or the tilt again, and a stranded state.viewportAnimationTo keeps
// selectionCameraTransitionActive() true, which makes alignHeadingUpNavigationViewport bail on
// every single call. Between them that is the whole "the compass and the 3D tilt stop updating
// after I come back from another app, and only a reload fixes it" report. Releasing the handles
// on the way back in lets each loop be started again from scratch.
function releaseStrandedAnimationFrames() {
  if (state.animationFrame != null) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  state.animationFrameRequestedAt = null;
  if (state.overlayAnimationFrame != null) cancelAnimationFrame(state.overlayAnimationFrame);
  state.overlayAnimationFrame = null;
  state.overlayAnimationFrameRequestedAt = null;
  if (state.compassAnimationFrame != null) cancelAnimationFrame(state.compassAnimationFrame);
  state.compassAnimationFrame = null;
  state.compassAnimationFrameRequestedAt = null;
  // A timestamp from before the break would give the first frame back a dt measured in
  // minutes; the loop clamps it, but starting from null is the honest reset.
  state.compassAnimationTime = null;
  // Clears state.viewportAnimationTo as well as the frame handle, so a camera ease that was
  // interrupted by the app going away cannot keep the heading-up fit switched off.
  stopViewportAnimation();
}

// A parked rAF handle IS the duplicate-loop guard: while it is set, the loop refuses to start
// again. That is correct only while the frame it names is really going to run. Two things break
// that. Backgrounding, which releaseStrandedAnimationFrames above already handles -- but only on
// visibilitychange/pageshow, and iOS routinely suspends and resumes a page without firing
// either, which is why the sensor watchdog exists at all. And a callback that throws before it
// re-arms: every one of these loops calls deep into fitting, overlay and draw code, and one
// exception leaves the handle set for ever. Either way the guard silently becomes a "no loop at
// all" lock -- requestDraw() never paints again, startCompassSmoothing() never eases heading or
// tilt again, and a stranded viewportAnimationTo keeps selectionCameraTransitionActive() true so
// alignHeadingUpNavigationViewport() bails on every call. That is the "the map just stops
// moving, and the 3D tilt with it" report, and nothing short of a reload recovered from it.
// So each loop now stamps when it asked for a frame and clears the stamp when that frame runs,
// and a request still pending ANIMATION_FRAME_WEDGED_MS later is a wedge by definition.
function animationFrameWedged(handle, requestedAt, now) {
  return handle != null && requestedAt != null && (now - requestedAt) > ANIMATION_FRAME_WEDGED_MS;
}

function animationLoopsWedged(now = performance.now()) {
  return animationFrameWedged(state.animationFrame, state.animationFrameRequestedAt, now)
    || animationFrameWedged(state.overlayAnimationFrame, state.overlayAnimationFrameRequestedAt, now)
    || animationFrameWedged(state.compassAnimationFrame, state.compassAnimationFrameRequestedAt, now)
    || animationFrameWedged(state.viewportAnimationFrame, state.viewportAnimationFrameRequestedAt, now);
}

// Unlike handleForegroundResume, this is safe to run on the 10-second heartbeat: it only acts
// once a frame request is provably overdue by two seconds, so a loop whose frames are actually
// running is never touched and a legitimately in-flight camera animation is never cancelled.
function recoverWedgedAnimationFrames(now = performance.now()) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (!animationLoopsWedged(now)) return false;
  releaseStrandedAnimationFrames();
  startCompassSmoothing();
  requestDraw();
  return true;
}

// Everything that needs doing when the page returns to the foreground. Hooked to
// visibilitychange and pageshow (a bfcache restore never fires visibilitychange); both
// are idempotent and cheap enough to run on each.
function handleForegroundResume() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

  releaseStrandedAnimationFrames();

  // Resume GPS watch + location-tracking interval paused on backgrounding.
  ensureLocationWatch();

  recoverStalledCompass();

  // Nudge the orientation sensor even when it is not stale yet: it may have been
  // suspended for less than COMPASS_STALE_MS, in which case there is no stale heading to
  // clear but the sensor still needs waking.
  reattachCompassListeners();

  // Restart GPS watch if it has gone silent for >20 s.
  restartStaleGpsWatch();

  // Loops released above have to be started again -- nothing else will, since the sensors that
  // normally kick them may take several seconds to resume (or may already be delivering into a
  // smoothing loop that is no longer running).
  startCompassSmoothing();
  requestDraw();
}

function setupVisibilityRecovery() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      pauseBackgroundedTracking();
      return;
    }
    handleForegroundResume();
  });

  // Two guards learned the hard way, both caught by the e2e suite. event.persisted:
  // pageshow also fires on every ordinary page load, and running the resume work there
  // started a GPS watch before boot's own flow had asked for one -- an extra stream of
  // position fixes, each repainting at an arbitrary moment. And window "focus" was hooked
  // here too and removed: it fires on every tab/window focus, so the resume work ran
  // constantly rather than on an actual resume. The watchdog below is the real safety net.
  window.addEventListener("pageshow", (event) => {
    if (event && event.persisted) handleForegroundResume();
  });

  // Foreground watchdog -- iOS can silently stall watchPosition AND deviceorientation
  // with no error and no visibilitychange at all, and a sensor that has not come back by
  // the first post-resume check would otherwise never get a second one.
  window.setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    restartStaleGpsWatch();
    recoverStalledCompass();
    recoverWedgedAnimationFrames();
  }, SENSOR_WATCHDOG_INTERVAL_MS);
}

// Stop high-accuracy GPS polling and the periodic location-tracking beacon while
// the tab/screen is not visible, so the app doesn't keep draining battery in the
// background. Both are restarted from setupVisibilityRecovery on return to visible.
function pauseBackgroundedTracking() {
  if (navigator.geolocation && state.locationWatchId != null) {
    navigator.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
  }
  if (typeof stopLocationTracking === "function") stopLocationTracking();
}

function restartStaleGpsWatch() {
  if (!navigator.geolocation || state.locationWatchId == null) return;
  const gpsAge = state.lastLocationUpdateAt == null
    ? Infinity
    : (performance.now() - state.lastLocationUpdateAt);
  if (gpsAge > 20000) {
    navigator.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
    ensureLocationWatch();
  }
}

// Constants controlling the "settle before trusting" compass calibration gate below.
const COMPASS_CALIBRATION_WINDOW_MS = 900; // trailing window of raw readings used to judge stability
const COMPASS_CALIBRATION_STABLE_SPREAD_DEG = 6; // max spread within the window before we trust it
const COMPASS_CALIBRATION_MIN_SAMPLES = 4; // minimum readings required within the window
const COMPASS_CALIBRATION_PROMPT_DELAY_MS = 1500; // how long to stay unstable before nudging the user
const COMPASS_CALIBRATION_MAX_WAIT_MS = 6000; // safety valve -- never block heading-up forever

function onDeviceOrientation(event) {
  // Tracked separately from compassLastEventAt (set below, and only for events carrying
  // a usable heading) so recoverStalledCompass can tell a suspended sensor -- which
  // re-registering the listeners can wake -- from a live sensor whose magnetometer has
  // lost its heading, which it cannot.
  state.orientationLastEventAt = performance.now();
  const rawBeta = event.beta;
  if (Number.isFinite(rawBeta)) {
    state.tiltBetaTarget = clamp(Math.abs(rawBeta), 0, 90);
    // Beta drives the 3D tilt by itself, but only startCompassSmoothing's loop eases
    // tiltBetaSmoothed toward it. The heading branch below returns early on any event whose
    // alpha/webkitCompassHeading is missing -- common indoors and on phones with a flaky
    // magnetometer -- so on a device delivering beta without a heading the target moved and
    // nothing advanced it: tilting the phone did nothing until some unrelated redraw
    // happened to restart the loop (the nudge in draw(), js/renderer.js). Restart it here on
    // the beta alone. The loop's own first guard exits immediately without a trusted
    // heading, so this cannot spin when there is nothing to smooth.
    if (Number.isFinite(state.compassHeading)) startCompassSmoothing();
  }
  const source = orientationHeadingSource(event);
  if (source === HEADING_SOURCE_NONE) return;
  // A worse source than the one already feeding the compass: on Android that is the drifting
  // relative stream still firing alongside the north-referenced one. Its beta was useful above;
  // its heading is not. Note this deliberately leaves compassLastEventAt alone, so staleness is
  // judged on the stream actually being used -- a relative stream still firing after the
  // absolute one has died must not mask the death.
  if (source < state.compassHeadingSource) return;
  if (source > state.compassHeadingSource) {
    // Upgraded to a better source. Everything the worse one produced was measured from a
    // different zero, so averaging the two would be meaningless: throw it away and re-gate.
    state.compassHeadingSource = source;
    discardCompassHeadingFromWorseSource();
  }

  const heading = extractCompassHeading(event);
  if (!Number.isFinite(heading)) return;
  state.compassLastEventAt = performance.now();

  if (Number.isFinite(state.compassHeading)) {
    // Already trust a heading -- keep tracking the live target as before.
    state.compassHeadingTarget = heading;
    startCompassSmoothing();
    return;
  }

  // No trusted heading yet. The very first orientation readings after load (or after
  // the compass goes stale and re-acquires) are frequently wrong on phones whose
  // magnetometer needs a moment of physical movement to settle -- snapping the map to
  // rotate on that first raw reading is the "dodgy state" on initial load. Instead,
  // buffer raw readings and only start trusting/rotating once they agree with each
  // other, nudging the user to help it along if that's taking a while.
  registerCompassCalibrationSample(heading, state.compassLastEventAt);
}

// Buffers a raw (not-yet-trusted) heading reading and decides whether the compass has
// settled enough to trust, is still unstable long enough to warrant the "move your
// phone" prompt, or has been unstable so long we should just give up waiting (rather
// than block heading-up navigation indefinitely on a device that never settles).
function registerCompassCalibrationSample(heading, now) {
  if (state.compassCalibrationStartedAt == null) state.compassCalibrationStartedAt = now;
  state.compassCalibrationSamples.push({ heading, time: now });
  const cutoff = now - COMPASS_CALIBRATION_WINDOW_MS;
  while (state.compassCalibrationSamples.length && state.compassCalibrationSamples[0].time < cutoff) {
    state.compassCalibrationSamples.shift();
  }

  const elapsed = now - state.compassCalibrationStartedAt;
  if (isCompassCalibrationStable() || elapsed >= COMPASS_CALIBRATION_MAX_WAIT_MS) {
    completeCompassCalibration(heading);
    return;
  }

  if (elapsed >= COMPASS_CALIBRATION_PROMPT_DELAY_MS) {
    showCompassCalibrationPrompt();
  }

  // Rotation waits for a trusted heading, but the zoom/anchor fit does not need one --
  // nearbyNavigationAnchorActive() only needs state.userLocation. Without this, the
  // very first GPS fix can race state.dataLoaded (alignHeadingUpNavigationViewport
  // bails until data is ready) and, previously, only got a second chance to correct
  // itself because compassHeading was trusted immediately and startCompassSmoothing's
  // per-frame tick kept re-running alignHeadingUpNavigationViewport regardless. Now that
  // rotation is deliberately held back during calibration, this keeps that same
  // "self-heal on the next frame" zoom correction going during the calibration window,
  // so the initial zoom is never stuck wrong until the user happens to move.
  startCalibrationViewportSync();
}

// Runs alongside calibration (see registerCompassCalibrationSample above): keeps
// re-fitting the north-up anchored zoom every frame while a heading is not yet trusted,
// exactly like startCompassSmoothing's tick does once one is -- just without the
// rotation. Stops itself once a heading is trusted (startCompassSmoothing's own tick
// takes over alignHeadingUpNavigationViewport from there) or once calibration is reset.
function startCalibrationViewportSync() {
  if (state.calibrationViewportSyncFrame != null) return;

  const tick = () => {
    if (Number.isFinite(state.compassHeading)) {
      state.calibrationViewportSyncFrame = null;
      return;
    }

    // Safety valve mirrors registerCompassCalibrationSample's MAX_WAIT check, in case
    // no further orientation events arrive to deliver it (sensor pause, permission
    // change mid-calibration) -- without this, a stalled sensor would leave this loop
    // running forever instead of the calibration ever completing.
    if (
      state.compassCalibrationStartedAt != null
      && performance.now() - state.compassCalibrationStartedAt >= COMPASS_CALIBRATION_MAX_WAIT_MS
    ) {
      const samples = state.compassCalibrationSamples;
      const fallbackHeading = samples.length ? samples[samples.length - 1].heading : null;
      state.calibrationViewportSyncFrame = null;
      if (Number.isFinite(fallbackHeading)) completeCompassCalibration(fallbackHeading);
      return;
    }

    if (navigationAnchorActive()) {
      // force: true bypasses resolveHeadingUpTargetScale's "compass sensor is actively
      // firing, defer non-urgent zoom changes" deferral. That deferral exists to stop
      // zoom fighting an in-progress rotation -- but calibration holds rotation at 0
      // the entire time (headingUpActive() is false until a heading is trusted), so
      // there's no rotation for the zoom to fight, and no reason to wait. Without force
      // here, calibration's continuous stream of raw orientation events keeps
      // headingUpCompassSensorActive() true throughout, and the deferred zoom fit only
      // ever got applied once the sensor briefly went quiet -- in practice, once
      // rotation itself kicked in and settled -- which is exactly the "zoom only
      // corrects after it rotates" symptom this fixes.
      const viewportChanged = alignHeadingUpNavigationViewport({ force: true });
      if (viewportChanged) requestDraw();
    }

    state.calibrationViewportSyncFrame = requestAnimationFrame(tick);
  };

  state.calibrationViewportSyncFrame = requestAnimationFrame(tick);
}

function stopCalibrationViewportSync() {
  if (state.calibrationViewportSyncFrame == null) return;
  cancelAnimationFrame(state.calibrationViewportSyncFrame);
  state.calibrationViewportSyncFrame = null;
}

// Circular spread (max - min, degrees) of the buffered calibration samples relative to
// the oldest sample still in the trailing window.
function compassCalibrationSpreadDegrees() {
  const samples = state.compassCalibrationSamples;
  if (!samples.length) return Infinity;
  const anchor = samples[0].heading;
  let min = 0;
  let max = 0;
  for (let i = 1; i < samples.length; i++) {
    const delta = shortestCompassDelta(anchor, samples[i].heading);
    if (delta < min) min = delta;
    if (delta > max) max = delta;
  }
  return max - min;
}

function isCompassCalibrationStable() {
  return state.compassCalibrationSamples.length >= COMPASS_CALIBRATION_MIN_SAMPLES
    && compassCalibrationSpreadDegrees() <= COMPASS_CALIBRATION_STABLE_SPREAD_DEG;
}

// Readings have settled (or we've waited as long as we're going to) -- start trusting
// and rotating to the compass heading. headingUpActive() picks this up on the next
// frame and the existing renderedNavigationHeading entry animation eases the map into
// its new rotation, so this doesn't itself need to animate anything.
function completeCompassCalibration(heading) {
  state.compassHeading = heading;
  state.compassHeadingTarget = heading;
  state.compassCalibrationSamples = [];
  state.compassCalibrationStartedAt = null;
  stopCalibrationViewportSync();
  hideCompassCalibrationPrompt();
  startCompassSmoothing();
}

// Called whenever a stale compass heading is cleared elsewhere (backgrounding,
// returning to the overview after the sensor's gone quiet) so the next readings go
// through the calibration gate again instead of being trusted immediately, and the
// "move your phone" prompt is free to reappear if the new fix takes a while too.
function resetCompassCalibration() {
  state.compassCalibrationSamples = [];
  state.compassCalibrationStartedAt = null;
  state.compassCalibrationPromptDismissed = false;
  stopCalibrationViewportSync();
  hideCompassCalibrationPrompt();
}

function showCompassCalibrationPrompt() {
  if (state.compassCalibrationPromptDismissed) return;
  if (state.compassCalibrationPromptVisible) return;
  if (!els.compassCalibrationBanner) return;
  state.compassCalibrationPromptVisible = true;
  els.compassCalibrationBanner.classList.remove("fading-out");
  els.compassCalibrationBanner.hidden = false;
}

function hideCompassCalibrationPrompt() {
  state.compassCalibrationPromptVisible = false;
  if (!els.compassCalibrationBanner) return;
  hideWithFade(els.compassCalibrationBanner);
}

// Bound to the banner's dismiss button -- lets the user hide the "move your phone"
// nudge without waiting for calibration to actually finish. Suppressed only for the
// current calibration cycle: resetCompassCalibration() (staleness recovery) clears
// the flag again so a later re-acquisition can still prompt.
function dismissCompassCalibrationPrompt() {
  state.compassCalibrationPromptDismissed = true;
  hideCompassCalibrationPrompt();
}

function startCompassSmoothing() {
  if (state.compassAnimationFrame != null) return;

  const tick = (timestamp) => {
    state.compassAnimationFrameRequestedAt = null;
    _overlapRectCache = undefined;
    _tiltProjectionCache = undefined;
    _nearbyRenderOriginCache = undefined;
    if (!Number.isFinite(state.compassHeadingTarget) || !Number.isFinite(state.compassHeading)) {
      state.compassAnimationFrame = null;
      state.compassAnimationTime = null;
      return;
    }

    const previousTime = state.compassAnimationTime == null ? timestamp : state.compassAnimationTime;
    const dt = Math.min(0.05, Math.max(0.001, (timestamp - previousTime) / 1000));
    state.compassAnimationTime = timestamp;

    const delta = shortestCompassDelta(state.compassHeading, state.compassHeadingTarget);
    const smoothing = 1 - Math.exp(-14 * dt);
    const nextHeading = state.compassHeading + (delta * smoothing);
    state.compassHeading = nextHeading;

    // Slower than the compass heading filter above (rate 14): beta gates pin/pointer
    // collapse (tiltInfluence) as well as the rotateX camera tilt, and a phone lifts
    // through the whole 0-12deg dead zone quickly, so a fast filter here reads as the
    // collapsing map pins snapping to size rather than easing in.
    const betaDiff = state.tiltBetaTarget - state.tiltBetaSmoothed;
    state.tiltBetaSmoothed += betaDiff * (1 - Math.exp(-4 * dt));

    updateOverviewDirectionArrows();
    refreshNearbyListForHeading();
    updateCompassOverlay();
    const viewportChanged = alignHeadingUpNavigationViewport();
    if (headingUpActive()) {
      updateHeadingUpCanvasRotationTransform();
      if (viewportChanged || tiltRenderStale()) requestDraw();
      else if (typeof drawOverlay === "function") drawOverlay();
    } else {
      requestDraw();
    }

    const remaining = Math.abs(shortestCompassDelta(state.compassHeading, state.compassHeadingTarget));
    const lastEventAge = state.compassLastEventAt == null ? Infinity : (timestamp - state.compassLastEventAt);
    const sensorIsActive = lastEventAge < HEADING_UP_SENSOR_ACTIVE_MS;
    const betaSettled = Math.abs(state.tiltBetaTarget - state.tiltBetaSmoothed) < 0.1;
    if (remaining < 0.05 && !sensorIsActive && betaSettled) {
      state.compassHeading = unwrapAngle(state.compassHeading, state.compassHeadingTarget);
      updateOverviewDirectionArrows();
      refreshNearbyListForHeading();
      updateCompassOverlay();
      // REVERTED (was: animate this settle call to ease in the zoom that
      // resolveHeadingUpTargetScale deferred while the sensor was live). Animating here puts
      // a viewport animation in flight just as the smoothing loop exits, and every later
      // alignHeadingUpNavigationViewport call early-returns while
      // selectionCameraTransitionActive() is true -- which suppresses the map redraws that
      // bake heading AND tilt into the canvas (see prepareCanvasForDraw). Reported in the
      // field as the map no longer rotating and no longer entering 3D. Snapping here is the
      // long-standing behaviour; the occasional zoom jump it causes is the lesser evil, and
      // wants fixing inside the loop (easing state.viewport.scale per frame) rather than by
      // handing the viewport to an animator at the moment the loop stops running.
      const finalViewportChanged = alignHeadingUpNavigationViewport();
      if (headingUpActive()) {
        updateHeadingUpCanvasRotationTransform();
        if (finalViewportChanged || tiltRenderStale()) requestDraw();
        else if (typeof drawOverlay === "function") drawOverlay();
      } else {
        requestDraw();
      }
      state.compassAnimationFrame = null;
      state.compassAnimationTime = null;
      return;
    }

    state.compassAnimationFrame = requestAnimationFrame(tick);
    state.compassAnimationFrameRequestedAt = timestamp;
  };

  state.compassAnimationFrame = requestAnimationFrame(tick);
  state.compassAnimationFrameRequestedAt = performance.now();
}

function shortestCompassDelta(fromHeading, toHeading) {
  const raw = normalizeDegrees(toHeading) - normalizeDegrees(fromHeading);
  if (raw > 180) return raw - 360;
  if (raw < -180) return raw + 360;
  return raw;
}

function extractCompassHeading(event) {
  if (!event) return null;
  if (Number.isFinite(event.webkitCompassHeading)) return normalizeDegrees(event.webkitCompassHeading);
  if (Number.isFinite(event.alpha)) return normalizeDegrees(360 - event.alpha);
  return null;
}

// How trustworthy the heading this event carries is -- see the HEADING_SOURCE_* constants.
// `absolute` is the standard flag saying alpha is referenced to the Earth, and
// `deviceorientationabsolute` carries a north-referenced alpha by definition; iOS ships neither
// and exposes the heading directly as webkitCompassHeading instead.
function orientationHeadingSource(event) {
  if (!event) return HEADING_SOURCE_NONE;
  if (Number.isFinite(event.webkitCompassHeading)) {
    return iosCompassHeadingIsValid(event) ? HEADING_SOURCE_ABSOLUTE : HEADING_SOURCE_NONE;
  }
  if (!Number.isFinite(event.alpha)) return HEADING_SOURCE_NONE;
  return (event.absolute === true || event.type === "deviceorientationabsolute")
    ? HEADING_SOURCE_ABSOLUTE
    : HEADING_SOURCE_RELATIVE;
}

// iOS reports the magnetometer's confidence in webkitCompassAccuracy alongside every
// heading, and Apple documents a NEGATIVE value as meaning the heading is not valid at all.
// It is not "imprecise": the number sitting in webkitCompassHeading next to it is arbitrary.
// Nothing read this, so an iPhone whose magnetometer had not settled -- near a car
// dashboard, in a magnetic case, or in the first moments after the screen woke -- handed a
// confident-looking but meaningless bearing straight to the heading, and the map rotated to
// it. That is the same "completely wrong" the Android stream mixing caused, reached by a
// different route, and it is why this shows up on iPhones too.
//
// Returning NONE rather than falling through to event.alpha is deliberate: iOS's alpha is
// measured from wherever the device happened to be when the sensor started, not from north
// -- that is the whole reason webkitCompassHeading exists -- so it is no better. With no
// usable heading the event still records orientationLastEventAt, which is exactly what makes
// recoverStalledCompass surface the "move your phone in a figure-8" banner: the sensor is
// alive, its magnetometer wants calibrating, and physical movement is the only thing that
// fixes it.
//
// A missing/undefined accuracy (any non-iOS browser, and older iOS) is not evidence of a bad
// heading, so it is trusted as before.
function iosCompassHeadingIsValid(event) {
  const accuracy = event.webkitCompassAccuracy;
  if (!Number.isFinite(accuracy)) return true;
  return accuracy >= 0;
}

// Drops every heading derived from a source we have just improved on. In practice the two
// Android streams start within a frame or two of each other, so this usually only clears a
// couple of buffered calibration samples -- but if a relative reading did get as far as being
// trusted, keeping it would leave the map rotated to an arbitrary zero until the next stale
// check 15s later. Sending it back through the calibration gate costs a moment north-up.
function discardCompassHeadingFromWorseSource() {
  const hadHeading = Number.isFinite(state.compassHeading);
  state.compassHeading = null;
  state.compassHeadingTarget = null;
  state.nearbyListHeading = null;
  state.renderedNavigationHeading = null;
  state.headingUpEntryAnim = null;
  resetCompassCalibration();
  if (!hadHeading) return;
  if (typeof updateCompassOverlay === "function") updateCompassOverlay();
  requestDraw();
}

function ensureLocationWatch() {
  if (!navigator.geolocation || state.locationWatchId != null) return;
  startLocationTracking();
  state.locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      state.lastLocationUpdateAt = performance.now();
      const { latitude, longitude, accuracy } = position.coords;
      const previousPoint = state.userLocation && state.userLocation.point;
      state.userLocation = ingestLocationFix(latitude, longitude, accuracy);
      const point = state.userLocation.point;
      updateLocateButtonVisibility();
      state.userInMapArea = pointInsideBounds(point, state.bounds);
      const nearestTrees = nearestTreesTo(latitude, longitude, state.nearestItemsCount);
      state.nearestTree = nearestTrees.length > 0 ? nearestTrees[0] : null;
      state.nearestCow = nearestCowTo(latitude, longitude);
      state.nearestPub = nearestPlaceByFilter(latitude, longitude, (place) => isPubCategory(place));
      state.nearestRestaurant = nearestPlaceByFilter(latitude, longitude, (place) => isRestaurantCategory(place));
      state.nearestLandmark = nearestPlaceByFilter(latitude, longitude, (place) => !isPubCategory(place) && !isRestaurantCategory(place) && !isCafeCategory(place) && !isShopCategory(place) && !isTransportCategory(place));
      state.nearestPlace = nearestPlacesTo(latitude, longitude, 1)[0] || null;
      // Walked out of a radius that was framing one nearby find? Grow it back to whatever is
      // still in reach before the list and camera are re-derived below (js/nav.js).
      ensureWalkingRadiusCoversNearest();
      if (isOverviewScreenActive()) {
        selectOverview();
      }
      updateOverviewDirectionArrows();
      updateSelectedDetailFields();
      if (navigationAnchorActive()) {
        const vpChanged = alignHeadingUpNavigationViewport();
        keepOverviewCenteredOnUser(previousPoint);
        updateCompassOverlay();
        updateHeadingUpCanvasRotationTransform();
        // The route line lives on the main canvas, and the main canvas is only repainted when
        // the viewport itself moves -- so while navigating with the camera already settled,
        // every fix took the overlay-only path and the line stayed painted where the walker
        // used to be. It starts at the live position now (selectedRoutePoints, js/renderer.js),
        // which is only visible if the frame that draws it is actually requested.
        if (vpChanged || tiltRenderStale() || selectedCompassTarget()) requestDraw();
        else if (typeof drawOverlay === "function") drawOverlay();
      } else {
        ensureUserAndSelectionVisible({ animate: true, durationMs: 200 });
        keepOverviewCenteredOnUser(previousPoint);
        updateCompassOverlay();
        requestDraw();
      }
    },
    (error) => {
      if (error && error.code === 1) {
        // Permission revoked mid-session — clear the watch and surface the gate.
        navigator.geolocation.clearWatch(state.locationWatchId);
        state.locationWatchId = null;
        setLocationGateVisible(true, "Location permission was blocked. Check browser settings and tap below to try again.");
      }
      // Timeout / position-unavailable: watchPosition continues automatically.
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 1500 }
  );
}

function selectedCompassTarget() {
  if (!state.selected) return null;
  if (state.selected.type === "tree" || state.selected.type === "landmark" || state.selected.type === "cow" || state.selected.type === "path" || state.selected.type === "water") return state.selected.item;
  if (state.selected.type === "road") {
    // Resolved lazily and then cached on the selection itself: the route-line memoization
    // (selectedRoutePoints, js/renderer.js) keys on target object identity, so this must
    // return the same object every frame -- and a street selected before the first GPS fix
    // has nothing to measure from yet, so the attempt has to be repeatable.
    if (!state.selected.navTarget) state.selected.navTarget = roadNavTarget(state.selected.item);
    return state.selected.navTarget;
  }
  return null;
}

// A street has no single position of its own, so navigating to one aims at the point on its
// geometry nearest the user at the moment it was selected -- a fixed destination like any
// other, exposed as a pseudo-item the compass arrow, route line, and camera fit can all read
// (point/latitude/longitude/name). Projection is done in world (Mercator) space, which is
// flat enough over forest distances for "nearest point on this street".
function roadNavTarget(road) {
  if (!state.userLocation || !road || !Array.isArray(road.segments)) return null;
  const from = state.userLocation.point;
  let best = null;
  for (const segment of road.segments) {
    for (let i = 1; i < segment.length; i += 1) {
      const a = segment[i - 1];
      const b = segment[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared === 0
        ? 0
        : clamp(((from.x - a.x) * dx + (from.y - a.y) * dy) / lengthSquared, 0, 1);
      const point = { x: a.x + t * dx, y: a.y + t * dy };
      const distance = Math.hypot(point.x - from.x, point.y - from.y);
      if (!best || distance < best.distance) best = { point, distance };
    }
  }
  if (!best) return null;
  const lonLat = unprojectPoint(best.point);
  return {
    point: best.point,
    latitude: lonLat.latitude,
    longitude: lonLat.longitude,
    name: road.name || road.ref || "Unnamed road",
  };
}

const HEADING_UP_ANCHOR_SELECTED = 0.62; // user anchored below center so destination shows above
const HEADING_UP_ANCHOR_NEARBY = 0.5; // flat/2D nearby: dead centre, so the walking-radius circle -- the only thing this view's camera frames -- is centred in the available map space
const HEADING_UP_ANCHOR_SELECTED_TILT = 0.88; // at max tilt (full 3D), user sits near the bottom edge with a small gap so the view isn't obscured by anything behind
const HEADING_UP_ANCHOR_NEARBY_TILT = 0.94;   // at max tilt (full 3D), you sit right down at the bottom edge: a heads-up view is about what is in front of you, and every pixel spent on the ground behind you is a pixel not spent on where you are walking
const HEADING_UP_SCALE_EPSILON = 0.000001; // Ignore sub-pixel scale noise between successive fits.
const HEADING_UP_POSITION_PX_THRESHOLD = 0.5; // Ignore half-pixel translation jitter between frames.
const HEADING_UP_SCALE_BUFFER_RATIO = 0.04; // keep extra off-screen room so quick heading changes do not expose unrendered edges
const HEADING_UP_SCALE_SETTLE_RATIO = 0.02; // absorb tiny settled scale corrections as visual noise
const HEADING_UP_SCALE_SETTLE_MIN = 1; // absolute settle tolerance for low zoom values
const HEADING_UP_SENSOR_ACTIVE_MS = 350;
// Rate (per second) the scale eases toward a non-urgent fit change while compass events
// are still arriving -- deliberately the same rate startCompassSmoothing() eases
// state.tiltBetaSmoothed at, so the zoom and the tilt change it is responding to arrive
// together instead of the zoom trailing or leading the perspective it is fitting.
const HEADING_UP_SCALE_EASE_RATE = 4;
// Ceiling a single ease step may integrate, matching the compass smoothing loop's own dt
// clamp: an ordinary frame (even a slow one -- see HEADING_UP_SCALE_EASE_STALE_MS below)
// still advances the ease, just by no more than this much, rather than lurching forward
// by however long that one frame actually took.
const HEADING_UP_SCALE_EASE_MAX_DT = 0.05;
// Gap between ease frames past which the elapsed time is discarded outright (the clock
// restarts with no progress) instead of clamped and integrated. This has to sit well above
// any ordinary frame hitch -- heavy 3D redraws (a dense forest of pins/routes projected
// under tilt every frame) can occasionally run a few frames at well under 60fps, and
// clamping those to HEADING_UP_SCALE_EASE_MAX_DT is exactly the intended behaviour, not a
// bug. Below this threshold used to mean "reject the frame entirely", which is fine for one
// isolated slow frame but starves the ease completely -- permanently frozen at whatever
// scale the last *urgent* (off-screen) correction snapped to -- when frames stay in the
// 50ms-500ms range for a sustained stretch, e.g. while continuously re-tilting the phone
// (this file's own maxNearbyHeadingUpScale/maxScaleForHeadingUpPoints projectTilt math adds
// real per-frame work directly proportional to how fast tilt is changing). That read as "it
// dips zoomed-out mid-tilt and then just never comes back" -- correct immediate reaction to
// the dip, no way to recover from it. Only a gap this large -- a backgrounded tab, or a
// screen the ease genuinely did not run on for a while -- should be treated as stale and
// restart the clock instead of integrating a jump.
const HEADING_UP_SCALE_EASE_STALE_MS = 500;

// How far the fit the camera *wants* may drift from the scale actually on screen before
// the camera responds at all -- a hysteresis deadband, sized as a fraction of the current
// scale.
//
// The fit is re-solved on every compass frame against a live heading, a live GPS fix and a
// route whose head is the walker's current position, so the scale it asks for is never
// still: every step and every degree of heading noise moves it a little. Chasing that
// continuously is what made walking navigation read as the map breathing in and out. A
// 2% settle tolerance (HEADING_UP_SCALE_SETTLE_RATIO, which exists for a different job --
// absorbing sub-pixel noise between two otherwise identical fits) is nowhere near enough
// to cover it.
//
// 13% is comfortably wider than the wander a normal walking pace produces, and still well
// inside the room the fit leaves itself: with HEADING_UP_SCALE_BUFFER_RATIO holding the
// camera 4% tighter than the true fit, the worst a full band of drift can do is put the
// framed target about 8% past where a perfect fit would place it -- still inside
// headingUpFitMarginPx, which is 10% of the rect plus 12dp. Anything genuinely off-screen
// is caught by HEADING_UP_SCALE_SNAP_RATIO below rather than by this band.
//
// Once the band is broken the ease runs to completion rather than stopping the moment it
// is back inside it -- otherwise the camera would glide a token amount, halt 13% short of
// the fit, and sit there re-triggering. state.headingUpScaleEasing is that latch; it
// clears when the ease converges, and on any snap or settle path.
const HEADING_UP_SCALE_HOLD_RATIO = 0.13;

// Overshoot past which a zoom-out is applied in one frame instead of eased. Below it the
// target is merely encroaching on the fit margin and there is nothing to correct urgently;
// at or above it the target has genuinely left the framed area and waiting out an ease
// would leave the thing being navigated to off-screen.
//
// This is the asymmetry that caused the reported jumping. Zoom-*in* has always been eased,
// but ANY zoom-out -- however slight -- used to fall straight through to the snap at the
// bottom of resolveHeadingUpTargetScale. Walking with a live compass produces a steady
// trickle of small zoom-out requests, so the camera sawtoothed: snap out hard, ease back
// in over ~1s, snap out hard again. Easing both directions and reserving the snap for a
// real overshoot is what turns that into one continuous motion.
const HEADING_UP_SCALE_SNAP_RATIO = 1.25;
// Rate (per second) a zoom-*out* ease integrates at. Faster than HEADING_UP_SCALE_EASE_RATE
// because the two directions are not equally urgent: zooming out is recovering room the
// target is running out of, zooming in is only tightening a frame that is already correct.
// ~0.45s to converge against the zoom-in's ~1s.
const HEADING_UP_SCALE_EASE_OUT_RATE = 9;

function selectedNavigationHeadingUpActive() {
  return Boolean(
    state.userLocation
    && selectedCompassTarget()
    && Number.isFinite(state.compassHeading)
  );
}

function nearbyHeadingUpActive() {
  return Boolean(
    state.userLocation
    && !selectedCompassTarget()
    && Number.isFinite(state.compassHeading)
  );
}

function headingUpActive() {
  return selectedNavigationHeadingUpActive() || nearbyHeadingUpActive();
}

// Heading-agnostic counterpart to nearbyHeadingUpActive above: true as soon as we have a
// GPS fix and nothing is selected, even before any compass heading has arrived. Used to
// decide whether the map should be *anchored/fitted* on the user (scale + pan) in the
// nearby-overview case -- rotation to heading is a separate concern, still gated on an
// actual compass reading via headingUpActive() itself, and eases in on its own once one
// arrives (see the renderedNavigationHeading entry animation in prepareCanvasForDraw()).
// Letting the anchored fit establish its final scale/position as soon as location is
// known -- north-up, since currentNavigationMapRotationDegrees() stays 0 without a
// heading -- means there is nothing left to snap when the compass heading shows up
// moments (or, on a stationary phone that never gets a heading, indefinitely) later.
//
// Deliberately scoped to the nearby case only: the selected-navigation case keeps
// requiring selectedNavigationHeadingUpActive() (a real heading), because it already has
// its own consistent heading-gated fit used both at boot (ensureUserAndSelectionVisible)
// and on later GPS updates -- unlike nearby overview, which used to switch fit algorithms
// between the two. Widening this to the selected case would introduce that same
// inconsistency in reverse: boot would use one fit and a later GPS update would use
// another, before a heading ever arrived.
function nearbyNavigationAnchorActive() {
  return Boolean(state.userLocation && !selectedCompassTarget());
}

function navigationAnchorActive() {
  return selectedNavigationHeadingUpActive() || nearbyNavigationAnchorActive();
}

// The world point the camera anchors at its focus point -- and therefore the point the
// scale fit measures from and the 3D tilt projection pivots on. Selected-destination
// navigation always anchors the real GPS fix (you have to walk there from where you
// actually are); the plain Nearby view anchors nearbyOrigin(), so a browse anchor moves the
// whole camera at once: framing, fit and perspective together.
//
// These three used to disagree the moment an anchor was set. The camera centred the anchor
// while the fit and the tilt pivot stayed on the GPS fix, so the walking-radius ring was
// measured as if it sat far off to one side (collapsing the zoom another step with every
// relocation) and, in 3D, was projected around a pivot that had itself moved off screen --
// the ring ended up drawn through a perspective solved for somewhere the camera was not
// looking. Any new consumer of "where is the camera" belongs here too rather than reaching
// for state.userLocation.point directly.
function cameraOriginPoint() {
  if (selectedNavigationHeadingUpActive()) return state.userLocation.point;
  const rendered = nearbyRenderOriginPoint();
  if (rendered) return rendered;
  return state.userLocation ? state.userLocation.point : null;
}

// Where the Nearby view's origin is *drawn* this frame, which is not always where it
// logically is. Moving the browse anchor slides this from the old origin to the new one over
// NEARBY_ORIGIN_TRANSITION_MS while the camera keeps it pinned at the focus point, so the
// walking-radius circle sits still on screen and the map slides underneath it.
//
// Animating the camera instead -- the obvious way round -- looks wrong: the origin changes
// on the first frame, so the circle snaps to wherever the user tapped and is then dragged
// back to the centre as the camera catches up. The circle is the thing the view is about; it
// is the map that should move.
//
// Only rendering follows this. nearbyOrigin() itself jumps straight to the new anchor, so
// the nearby list, the highlighted set and hit testing all describe the destination
// immediately rather than being recomputed against an interpolated point every frame.
function nearbyRenderOriginPoint() {
  if (_nearbyRenderOriginCache !== undefined && _nearbyRenderOriginCacheAnchor === state.nearbyAnchor) {
    return _nearbyRenderOriginCache;
  }
  _nearbyRenderOriginCacheAnchor = state.nearbyAnchor;
  _nearbyRenderOriginCache = computeNearbyRenderOriginPoint();
  return _nearbyRenderOriginCache;
}

// Frozen for the duration of a frame (cleared wherever _tiltProjectionCache is). Without
// that, everything reading it during one draw reads a *different* interpolated point: the
// camera is solved from the origin as it was at the top of the frame, and by the time the
// circle itself is drawn -- a whole map draw later, which on a dense frame is tens of
// milliseconds -- the origin has moved on, so the circle lands slightly off the focus it was
// supposed to be pinned to. That is a visible wobble on exactly the motion this exists to
// make smooth.
function computeNearbyRenderOriginPoint() {
  const origin = typeof nearbyOrigin === "function" ? nearbyOrigin() : null;
  if (!origin || !origin.point) return null;
  const transition = state.nearbyOriginTransition;
  if (!transition) return origin.point;
  const progress = clamp((performance.now() - transition.startedAt) / transition.durationMs, 0, 1);
  if (progress >= 1) return origin.point;
  // Same cubic ease-in-out animateViewportTo uses, so a slide feels like every other camera
  // move in the app rather than like a second, differently-tuned animation system.
  const eased = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  return {
    x: transition.fromX + (origin.point.x - transition.fromX) * eased,
    y: transition.fromY + (origin.point.y - transition.fromY) * eased,
  };
}

// Starts the slide from wherever the origin is currently *drawn* -- not from the old logical
// origin -- so relocating again mid-slide continues from what is on screen instead of
// jumping back to where the last slide began.
function startNearbyOriginTransition(fromPoint) {
  // The frame freeze above would otherwise hand the camera the pre-move origin for the rest
  // of this frame -- including the align refreshNearbyRadiusView runs immediately after.
  _nearbyRenderOriginCache = undefined;
  if (!fromPoint) return;
  state.nearbyOriginTransition = {
    fromX: fromPoint.x,
    fromY: fromPoint.y,
    // Whether the view was *already* browsing when this slide started, so tiltRampedAnchor
    // can tell entering/leaving a browsed spot (where the 3D pivot moves) from hopping
    // between two browsed spots (where it does not).
    fromBrowsing: Boolean(state.nearbyAnchor),
    startedAt: performance.now(),
    durationMs: NEARBY_ORIGIN_TRANSITION_MS,
  };
}

// Eased 0-1 progress of the in-flight browse-origin slide, or null when none is running.
// Shares animateViewportTo's cubic ease-in-out, so anything blended across a slide moves in
// step with the slide itself.
function nearbyOriginTransitionEasedProgress() {
  const transition = state.nearbyOriginTransition;
  if (!transition) return null;
  const progress = clamp((performance.now() - transition.startedAt) / transition.durationMs, 0, 1);
  if (progress >= 1) return null;
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

// Opacity for everything that describes the *nearby set* -- the highlighted pins and the
// ambient route lines to them. Zero while a browse-origin slide is running, then a quick fade
// in once it lands.
//
// Those pins and lines belong to the destination, but the map underneath them is still
// travelling: drawing them straight away means a fan of lines pinned to a stationary circle
// sweeping across moving terrain, and pins sliding under a marker that is not moving. It
// reads as jitter even though every individual element is where it should be. Holding them
// back until the map settles turns a busy half-second into one clean movement followed by the
// new surroundings arriving.
function nearbyRevealOpacity() {
  const transition = state.nearbyOriginTransition;
  if (!transition) return 1;
  const sinceStart = performance.now() - transition.startedAt;
  if (sinceStart < transition.durationMs) return 0;
  return clamp((sinceStart - transition.durationMs) / NEARBY_REVEAL_MS, 0, 1);
}

// True while the reveal fade still has frames left to draw, so prepareCanvasForDraw keeps
// asking for them after the slide itself has finished.
function nearbyRevealInProgress() {
  const transition = state.nearbyOriginTransition;
  if (!transition) return false;
  return performance.now() - transition.startedAt < transition.durationMs + NEARBY_REVEAL_MS;
}

function nearbyOriginTransitionActive() {
  const transition = state.nearbyOriginTransition;
  if (!transition) return false;
  return performance.now() - transition.startedAt < transition.durationMs;
}

// 3D perspective (tiltActive()) is available on every screen — nearby overview,
// selected navigation, and the filter/settings/feedback screens all allow full tilt,
// with no exceptions, including when returning to the nearby overview.
function tiltAllowedForCurrentScreen() {
  return true;
}

function tiltActive() {
  return headingUpActive() && state.tiltBetaSmoothed > TILT_BETA_THRESHOLD;
}

function tiltRotateXDeg() {
  if (!tiltActive()) return 0;
  const t = Math.min(1, (state.tiltBetaSmoothed - TILT_BETA_THRESHOLD) / (TILT_BETA_MAX - TILT_BETA_THRESHOLD));
  return TILT_ROTATEX_MAX * t;
}

// True when the tilt angle the main canvas was last drawn at no longer matches the current
// one. The compass smoothing loop only repaints the main canvas when the viewport or the
// heading moved, so pitching the phone up or down without turning it used to redraw the
// overlay alone: pins, the radar cone and the "You" dot were re-projected at the new tilt
// over terrain still drawn at the old one. Overlay items far from the pivot sit near the
// horizon, where a fraction of a degree of rotateX moves them tens of pixels -- so the "You"
// marker slid up and down the screen while the map under it stood still, reading as a
// marker detached from the map rather than a camera moving. Callers use this to pick a full
// redraw over an overlay-only one, keeping both canvases on the same camera every frame.
function tiltRenderStale() {
  const rendered = Number.isFinite(state.renderedTiltRotateXDeg) ? state.renderedTiltRotateXDeg : 0;
  return Math.abs(tiltRotateXDeg() - rendered) > TILT_RENDER_STALE_DEG;
}

// 0 when tilt is inactive, 1 at TILT_BETA_MAX — same ramp as tiltRotateXDeg.
function tiltAnchorFraction() {
  if (!tiltActive()) return 0;
  return Math.min(1, (state.tiltBetaSmoothed - TILT_BETA_THRESHOLD) / (TILT_BETA_MAX - TILT_BETA_THRESHOLD));
}

// The vertical anchor fraction the heading-up pivot sits at within the visible map
// rect, ramping from the flat anchor to the max-tilt anchor as tiltAnchorFraction()
// goes 0 -> 1. Shared by navigationFocusPoint/nearbyHeadingUpFocusY (where the pivot
// is actually placed on screen) and tiltAvailableAheadCssPx (which needs the same
// value to size the tilt perspective distance -- see tiltPerspectivePx()).
//
// For selected navigation only, this fixed ahead-favouring anchor is then mirrored
// around the screen's vertical centre (0.5) based on where the destination actually
// is (selectedNavigationTargetBearingOffsetRadians()) -- dead ahead leaves it
// untouched (matching the previous fixed-anchor behaviour exactly), dead behind
// flips it to `1 - anchor` (as much room below the user as the old anchor gave
// above), and a target to the side lands near the centre. Without this, a
// destination behind the user got squeezed into the small margin below a pivot
// fixed near the bottom of the screen, forcing a needlessly wide zoom-out instead of
// making use of the screen space that's actually available in the destination's own
// direction. Nearby mode has no single destination to adapt toward (items are
// scattered in every direction by design), so its anchor stays exactly as before.
// Pre-mirror ramped anchor: the plain ahead-favouring anchor before any bearing-based
// mirroring is applied (see headingUpAnchorFraction below). Always >= 0.5 by
// construction (HEADING_UP_ANCHOR_* constants). Factored out so tiltAvailableAheadCssPx
// can use it as a safety floor -- see that function's comment for why.
function tiltRampedAnchor(isSelected) {
  // The forward ramp exists to give the screen to what is ahead of *you* as the phone
  // tilts up: it pushes the pivot toward the bottom edge so the ground you are walking
  // into fills the view. Browsing a spot away from yourself has no "ahead" -- the pivot is
  // a place on the map being looked at, and its whole nearest area has to fit on screen
  // (see tiltHidesWhatIsBehind). Pinned at the untilted
  // centre for that case, so the ring gets equal room above and below the pivot and can be
  // framed at a useful size rather than squeezed into the sliver below a bottom anchor.
  const t = tiltAnchorFraction();
  if (isSelected) {
    return HEADING_UP_ANCHOR_SELECTED + (HEADING_UP_ANCHOR_SELECTED_TILT - HEADING_UP_ANCHOR_SELECTED) * t;
  }
  // Crossing between the two nearby pivots -- the forward ramp above and the centred browse
  // pivot -- is eased along with the origin slide, or entering (and leaving) a browsed spot
  // in 3D would jerk the whole view up or down the screen on a single frame. Hopping between
  // two browsed spots stays put: both ends are the centred pivot.
  const to = nearbyPivotAnchorFraction(!tiltHidesWhatIsBehind());
  const progress = nearbyOriginTransitionEasedProgress();
  if (progress == null) return to;
  const from = nearbyPivotAnchorFraction(state.nearbyOriginTransition.fromBrowsing);
  return from + (to - from) * progress;
}

// The nearby pivot's vertical anchor fraction for one *end* of a browse-origin slide, rather
// than for the blend currently on screen: the centred browse pivot when that end is browsing
// a spot, the tilt-ramped forward pivot when it is you. Named separately from
// tiltRampedAnchor because maxNearbyHeadingUpScale needs each end's own value to solve that
// end's fit -- see the pivot-crossing blend there.
function nearbyPivotAnchorFraction(browsing) {
  if (browsing) return HEADING_UP_ANCHOR_NEARBY;
  const t = tiltAnchorFraction();
  return HEADING_UP_ANCHOR_NEARBY + (HEADING_UP_ANCHOR_NEARBY_TILT - HEADING_UP_ANCHOR_NEARBY) * t;
}

function headingUpAnchorFraction(isSelected) {
  const aheadAnchor = tiltRampedAnchor(isSelected);
  if (!isSelected) return aheadAnchor;
  const offset = selectedNavigationTargetBearingOffsetRadians();
  if (offset == null) return aheadAnchor;
  return 0.5 + (aheadAnchor - 0.5) * Math.cos(offset);
}

// Signed-magnitude offset (radians) of the selected navigation target's bearing from
// "straight ahead" in the current heading-up rotated frame: 0 = dead ahead, ±π/2 =
// directly to a side, π = dead behind. Reuses the exact rotation
// (currentNavigationMapRotationDegrees()) and rotated-axis convention already used by
// maxScaleForHeadingUpPoints/tiltRotatedHeadingOffset, just resolved to a full angle
// instead of a single signed ahead/behind axis distance, since headingUpAnchorFraction
// needs the whole ahead/behind/side picture. Averages every target point (so a route
// with points on both sides of "ahead" still resolves to one sensible bearing) and
// returns null when there's nothing to adapt toward, so callers fall back cleanly to
// the fixed ahead-favouring anchor.
function selectedNavigationTargetBearingOffsetRadians() {
  if (!state.userLocation) return null;
  const points = selectedNavigationTargetPoints();
  if (!points.length) return null;
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  const dx = sumX / points.length - state.userLocation.point.x;
  const dy = sumY / points.length - state.userLocation.point.y;
  if (dx === 0 && dy === 0) return null;
  const radians = toRadians(currentNavigationMapRotationDegrees());
  const rotatedX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const rotatedY = dx * Math.sin(radians) + dy * Math.cos(radians); // same sign convention as tiltRotatedHeadingOffset
  return Math.atan2(rotatedX, -rotatedY);
}

// Space (CSS px) available on the *larger* side of the tilt pivot within the
// currently visible map area -- normally the "ahead" band the tilted ground plane
// has to fill before its horizon, but see the note on the mirrored-anchor case
// below. Feeds tiltPerspectivePx() so the perspective camera distance scales with
// the actual screen instead of leaving a fixed-size "sky" gap that grows on taller
// viewports (see tiltPerspectivePx() for why that matters).
//
// Deliberately uses max(anchor, 1 - anchor), not the raw anchor: for selected
// navigation, headingUpAnchorFraction() mirrors the anchor toward the top of the
// screen when the destination is behind the user, so most of the *reach* that needs
// covering is now on the far side of the pivot from where this "ahead" name
// originally meant. Feeding the raw (now small) mirrored anchor in here would shrink
// tiltPerspectivePx() right along with it -- reintroducing, via bearing this time
// instead of tilt angle, the exact singularity-margin regression documented above
// (P collapses, so a destination/pins now rendered on the far, larger side of the
// pivot blow up or disappear near the perspective-divide singularity). Using
// whichever side is actually larger keeps the camera distance sized for the bigger
// reach regardless of which side of the pivot that is, so mirroring the on-screen
// anchor position never on its own shrinks the safety margin. In the normal
// (dead-ahead or nearby) case the anchor is already >= 0.5, so this is a no-op.
function tiltAvailableAheadCssPx() {
  const focusRect = bestVisibleCanvasRect();
  const isSelected = selectedNavigationHeadingUpActive();
  const anchor = headingUpAnchorFraction(isSelected);
  // max(anchor, 1 - anchor) alone still dips as low as 0.5 for a destination
  // directly to a side (offset ~= +-pi/2, where headingUpAnchorFraction's
  // cos(offset) mirroring passes through the screen's exact 50% centre) -- lower
  // than the historically-safe floor (tiltRampedAnchor(), always >= 0.5 by
  // construction, e.g. 0.62-0.88 for selected navigation) that this calculation
  // always used before bearing-based mirroring existed. That dip shrank the camera
  // distance (and so the singularity-margin safety net) for any destination whose
  // bearing passes near perpendicular to the current heading -- an ordinary,
  // frequent case during real walking navigation, not just the dead-behind extreme
  // already covered by max(anchor, 1 - anchor). Including tiltRampedAnchor() as a
  // third floor restores that pre-mirroring safety margin across the whole bearing
  // range: at the dead-ahead/dead-behind extremes max(anchor, 1-anchor) already
  // equals tiltRampedAnchor() exactly (so this is a no-op there), and it now also
  // holds at every bearing in between.
  const reach = Math.max(anchor, 1 - anchor, tiltRampedAnchor(isSelected));
  return Math.max(1, (focusRect.height * reach) / pixelRatio());
}

// TILT_PERSPECTIVE_PX used to be a fixed CSS-px camera distance. A rotateX-tilted
// ground plane's horizon sits at (perspective / tan(rotateX)) CSS px above the
// pivot -- a fixed distance, independent of screen size -- so a flat constant left
// the "sky" gap above the horizon covering a bigger or smaller fraction of the
// screen depending on device height, rather than a consistent fraction of it (a
// taller visible map area got proportionally *more* empty sky, not less). This
// derives the camera distance from the space actually available above the pivot
// instead, so the horizon lands at roughly the same fraction of the visible map
// (TILT_HORIZON_GROUND_RATIO) on any device -- calibrated at TILT_ROTATEX_MAX, not
// at whatever the *current* tilt angle happens to be. That distinction matters: an
// earlier version scaled the camera distance by tan(the live tiltRotateXDeg()), which
// shrinks sharply at low/mid tilt angles -- collapsing the safe "behind the user"
// distance before the perspective-divide singularity (scale = P/(P-dz), where dz
// grows with distance behind the pivot) from ~900-1500 CSS px down to as little as
// ~450 CSS px at an ordinary mid-range tilt. That regression made pins, the radar,
// and road/path lines behind the user intermittently disappear or fly off to wild
// coordinates during everyday (non-max) tilt -- see [[nearby-view-zoom]] project
// memory / the 2026-09-03 tilt-perspective incident. Using the fixed reference angle
// instead keeps that safety margin roughly constant (and no smaller than before)
// across the whole active-tilt range, while still fixing the original device-height
// bug at max tilt, where the ground-fraction target actually applies exactly.
// Used identically by the CSS canvas transform
// (updateHeadingUpCanvasRotationTransform) and by the overlay's manual perspective
// projection (worldToScreenForOverlayTilted, projectCanvasPoint) -- all three must
// agree or pins drift away from the tilted terrain beneath them.
function tiltPerspectivePx() {
  if (tiltRotateXDeg() <= 0) return TILT_PERSPECTIVE_MIN_PX;
  const desired = tiltAvailableAheadCssPx() * TILT_HORIZON_GROUND_RATIO * TILT_HORIZON_REFERENCE_TAN;
  return clamp(desired, TILT_PERSPECTIVE_MIN_PX, TILT_PERSPECTIVE_MAX_PX);
}

// In full 3D (tilt active), map/landmark/cow/path pins and road/path lines behind the
// user's heading are not drawn at all — full 3D is a "look ahead" view, and anything
// behind is meant to be revealed by physically turning around rather than staying
// visible in a squashed/ballooned state at the bottom of the tilted view. Returns false
// (nothing hidden) whenever tilt is not active, so this only changes rendering in 3D mode.
// Whether 3D should hide what is behind the camera at all. The cull models a first-person
// view: you are standing at the pivot facing forward, and content behind you is revealed by
// physically turning around rather than by keeping a squashed copy of it on screen. Browsing
// a spot away from yourself is not first-person -- the pivot is a place on the map being
// looked at, and its whole nearest area is deliberately framed on screen (see
// maxNearbyHeadingUpScale) -- so culling half of it would leave the framed circle empty of
// roads, paths and full-size pins. Shared by the cull, the pin collapse and the camera fit
// so the three cannot disagree about which half of the view exists.
function tiltHidesWhatIsBehind() {
  return !state.nearbyAnchor;
}

function isBehindTiltHeading(worldPoint) {
  if (!tiltActive() || !state.userLocation || !worldPoint) return false;
  if (!tiltHidesWhatIsBehind()) return false;
  return tiltRotatedHeadingOffset(worldPoint) > 0;
}

// Signed distance (world units) of a point from the ahead/behind boundary used by
// isBehindTiltHeading: negative is ahead, positive is behind, zero is the boundary itself.
function tiltRotatedHeadingOffset(worldPoint) {
  const rotation = currentNavigationMapRotationDegrees();
  const radians = toRadians(rotation);
  // Measured from the camera pivot, not the GPS fix: "behind" here means behind the point
  // the perspective divide is solved around (cameraOriginPoint), which is what actually
  // determines whether the projection compresses a point toward the horizon or blows it up.
  const origin = cameraOriginPoint() || state.userLocation.point;
  const dx = worldPoint.x - origin.x;
  const dy = worldPoint.y - origin.y;
  return dx * Math.sin(radians) + dy * Math.cos(radians);
}

// Continuous companion to isBehindTiltHeading for pins: rather than a hard cutoff, this
// shrinks smoothly toward TILT_PIN_COLLAPSE_MIN_SCALE across a band straddling the same
// boundary, so turning the heading reads as pins growing/shrinking from their own point
// instead of popping in and out. The band is sized in screen px via viewport.scale so it
// covers a consistent visual width regardless of zoom level.
//
// Gated on headingUpActive() rather than tiltActive(), and blended in by tiltInfluence()
// (0 at TILT_BETA_THRESHOLD, ramping to 1 by TILT_BETA_MAX — the same active-tilt range
// as tiltRotateXDeg/tiltAnchorFraction) rather than switched on at the tiltActive()
// threshold itself: this keeps pins close to full size as tilt begins and only collapses
// them toward minimum size near max tilt, instead of hitting minimum collapse the instant
// tilt engages and sitting there for nearly the whole active-tilt range. Because the ramp's
// lower bound is exactly TILT_BETA_THRESHOLD (where tiltActive() itself flips), influence
// is already 0 right as tilt deactivates, so leaving 3D still eases smoothly with no jump.
function tiltInfluence() {
  if (!headingUpActive()) return 0;
  return clamp((state.tiltBetaSmoothed - TILT_BETA_THRESHOLD) / (TILT_BETA_MAX - TILT_BETA_THRESHOLD), 0, 1);
}

function tiltPinScale(worldPoint) {
  const influence = tiltInfluence();
  if (influence <= 0 || !state.userLocation || !worldPoint) return 1;
  if (!tiltHidesWhatIsBehind()) return 1;
  const bandWorld = TILT_PIN_COLLAPSE_BAND_PX / state.viewport.scale;
  const raw = clamp(0.5 - tiltRotatedHeadingOffset(worldPoint) / bandWorld, 0, 1);
  const eased = raw * raw * (3 - 2 * raw);
  const collapsedScale = TILT_PIN_COLLAPSE_MIN_SCALE + (1 - TILT_PIN_COLLAPSE_MIN_SCALE) * eased;
  return influence >= 1 ? collapsedScale : 1 + (collapsedScale - 1) * influence;
}

function navigationMapRotationDegrees() {
  if (!headingUpActive()) return 0;
  const heading = Number.isFinite(state.renderedNavigationHeading)
    ? state.renderedNavigationHeading
    : state.compassHeading;
  return -normalizeDegrees(heading);
}

function currentNavigationMapRotationDegrees() {
  return headingUpActive() ? -normalizeDegrees(state.compassHeading) : 0;
}

function selectionCameraTransitionActive() {
  return state.selectionViewportTransitionPending || state.viewportAnimationTo != null;
}

// Takes the rect the caller already measured. Previously this measured its own, which meant
// the anchor position and the scale fit in alignHeadingUpNavigationViewport came from two
// independent bestVisibleCanvasRect() calls -- fine while they always agreed, but they stop
// agreeing the moment a caller measures with assumeInspectorOpen, leaving the map scaled for
// the open inspector but anchored for the closed one.
// The inset maxScaleForHeadingUpPoints fits inside. Shared with navigationFocusPoint so the
// anchor and the fit agree on where the usable band actually is -- an anchor placed outside
// it leaves one side no room at all and collapses the fit (see balancedNavigationAnchorY).
function headingUpFitMarginPx(focusRect) {
  return Math.min(focusRect.width, focusRect.height) * 0.1 + 12 * pixelRatio();
}

// Where to put the user when the points being fitted lie on BOTH sides of "ahead".
//
// headingUpAnchorFraction picks the anchor from the target's average bearing alone, which is
// right when everything is on one side: a destination behind you mirrors the anchor toward
// the top so there is room behind. But once the fit includes the whole route
// (selectedNavigationTargetPoints) a walk routinely has points ahead AND behind, and an
// anchor mirrored hard to one edge leaves the other side less than the fit's own margin --
// so maxScaleForHeadingUpPoints divides by a near-zero (or negative) gap and the scale
// collapses. Measured at full tilt with a behind destination and a route looping ahead: the
// anchor landed at 0.146 while the margin alone is ~0.13 of the rect, and the fit came out
// ~25x more zoomed out than the destination needed.
//
// With extents on both sides, the scale-maximising anchor is the one that splits the usable
// band in proportion to them: room above / room below = ahead extent / behind extent. That
// is returned here; single-sided fits keep the bearing anchor untouched.
function balancedNavigationAnchorY(focusRect, anchorFraction) {
  const anchoredY = focusRect.y + focusRect.height * anchorFraction;
  if (!state.userLocation) return anchoredY;
  const points = selectedNavigationTargetPoints();
  // Exactly two points is selectedRoutePoints' crow-flies fallback -- the walker and the
  // destination, nothing in between (no routing graph yet, or no walkable route found).
  // One of those two IS the pivot this measures from, so there is no shape to balance and
  // headingUpAnchorFraction's bearing-mirrored anchor is the whole answer. Only a real
  // routed line, with junctions of its own, has an ahead/behind split worth taking.
  if (points.length < 3) return anchoredY;

  const radians = toRadians(currentNavigationMapRotationDegrees());
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let ahead = 0;
  let behind = 0;
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const dx = point.x - state.userLocation.point.x;
    const dy = point.y - state.userLocation.point.y;
    const rotatedY = dx * sin + dy * cos;
    if (rotatedY < 0) ahead = Math.max(ahead, -rotatedY);
    else behind = Math.max(behind, rotatedY);
  }
  // No "is there anything on both sides?" guard. There used to be one -- `ahead <= 0 ||
  // behind <= 0` fell back to `anchoredY` -- and it was a cliff, because the two formulas
  // are nowhere near each other at the boundary while the thing deciding between them is a
  // single vertex.
  //
  // Walking a route that runs behind you, the last junction you have not yet reached sits a
  // few metres ahead and is the only thing on that side. It contributes essentially nothing
  // to the split, so the balanced branch returns almost exactly `top`. Walk past it -- or
  // let a 20m route re-solve (SELECTED_ROUTE_RECOMPUTE_MIN_METRES) drop it -- and the guard
  // fired instead and the anchor stepped straight to `anchoredY`. Measured in the browser
  // with the heading held still so nothing else could move the camera: 138px of anchor in
  // one frame, reframing the map by 97px and snapping the zoom 23%. That is the "lots of
  // reframing" half of the jarring-zoom report.
  //
  // Letting the split run all the way to the ends of its own range removes the step without
  // a threshold to tune, because the limits ARE the right answers: with nothing ahead it
  // gives `top`, the walker at the top of the rect with the whole route below -- which is
  // both continuous with the almost-nothing-ahead case and a tighter fit than `anchoredY`
  // was (measured on the route fixture at beta 20, the route fills 0.75+ of the binding axis
  // this way against 0.61 falling back). With nothing behind it gives the bottom of the
  // rect, everything above, which is the same statement mirrored.
  //
  // The collapse the doc comment above describes is still avoided: every value this can
  // return lies inside [top, top + usable], which is the rect inset by the fit's own margin
  // on both sides, so maxScaleForHeadingUpPoints always has real room to divide by.
  const span = ahead + behind;
  if (!(span > 0)) return anchoredY;

  const margin = headingUpFitMarginPx(focusRect);
  const top = focusRect.y + margin;
  const usable = focusRect.height - margin * 2;
  if (!(usable > 0)) return anchoredY;
  return top + usable * (ahead / span);
}

function navigationFocusPoint(focusRect = bestVisibleCanvasRect()) {
  const anchor = headingUpAnchorFraction(selectedNavigationHeadingUpActive());
  return {
    x: focusRect.x + focusRect.width / 2,
    y: selectedNavigationHeadingUpActive()
      ? balancedNavigationAnchorY(focusRect, anchor)
      : focusRect.y + focusRect.height * anchor,
  };
}

function nearbyHeadingUpFocusY() {
  return headingUpAnchorFraction(false);
}

// See navigationFocusPoint: the rect is the caller's, for the same reason.
function nearbyNavigationFocusPoint(focusRect = bestVisibleCanvasRect()) {
  return {
    x: focusRect.x + focusRect.width / 2,
    y: focusRect.y + focusRect.height * nearbyHeadingUpFocusY(),
  };
}

function selectedNavigationTargetPoints() {
  const target = selectedCompassTarget();
  if (!target) return [];
  if (state.selected && state.selected.type === "path" && target.segments) {
    return target.segments.flat();
  }
  if (!target.point) return [];
  // Frame the whole walk, not just its far end. This is the fit used by
  // maxHeadingUpNavigationScale (and the bearing behind headingUpAnchorFraction) in
  // heading-up navigation -- the mode in use outdoors whenever the compass is live -- and
  // returning the bare destination meant a route that loops out via real roads/paths was
  // routinely drawn well outside the framed area. selectedRoutePoints (js/renderer.js) is
  // the same memoized route the dashed line is drawn from and it ends at target.point, so
  // this is a superset of the old behaviour, never a narrower fit.
  //
  // While the routing graph is still building it yields the straight-line fallback, and the
  // real route arrives via ensureRoutingGraph's re-fit
  // (refitSelectionAfterRoutingGraphReady) exactly as it does for the non-heading-up path.
  if (state.userLocation && typeof selectedRoutePoints === "function") {
    const routePoints = selectedRoutePoints(target);
    if (routePoints && routePoints.length) return routePoints;
  }
  return [target.point];
}

function headingUpCompassSensorActive(now = performance.now()) {
  if (!Number.isFinite(state.compassLastEventAt)) return false;
  return (now - state.compassLastEventAt) < HEADING_UP_SENSOR_ACTIVE_MS;
}

function resolveHeadingUpTargetScale(maxScale, previousScale, force = false, now = performance.now()) {
  if (!Number.isFinite(maxScale) || maxScale <= 0) return previousScale;
  const bufferedScale = maxScale * (1 - HEADING_UP_SCALE_BUFFER_RATIO);
  const nextScale = Number.isFinite(bufferedScale) && bufferedScale > 0 ? bufferedScale : maxScale;
  if (!Number.isFinite(previousScale) || previousScale <= 0) return nextScale;
  const settleTolerance = Math.max(HEADING_UP_SCALE_SETTLE_MIN, previousScale * HEADING_UP_SCALE_SETTLE_RATIO);

  // While the compass is quiet, or a caller has explicitly asked for this fit, the camera
  // goes straight there: nothing is fighting it, so there is no jitter to smooth over.
  // force=true is explicit navigation (returning from the filter screen's wide survey view
  // back to the nearby screen, committing a selection), where the whole point is that the
  // requested framing takes effect.
  //
  // The one case that still snaps with the sensor live is an urgent zoom-out: previousScale
  // more than HEADING_UP_SCALE_SNAP_RATIO past what fits means the target has genuinely
  // left the framed area, and easing that over half a second would leave the destination
  // off-screen while it ran. Everything short of that is eased below.
  const urgent = previousScale > maxScale * HEADING_UP_SCALE_SNAP_RATIO;
  if (force || urgent || !headingUpCompassSensorActive(now)) {
    state.headingUpScaleEaseAt = null;
    state.headingUpScaleEasing = false;
    if (Math.abs(previousScale - nextScale) <= settleTolerance) return previousScale;
    return nextScale;
  }

  // Converged: stop, and drop the latch so the deadband below guards the next move.
  if (Math.abs(previousScale - nextScale) <= settleTolerance) {
    state.headingUpScaleEaseAt = null;
    state.headingUpScaleEasing = false;
    return previousScale;
  }

  // Hysteresis deadband (HEADING_UP_SCALE_HOLD_RATIO). The fit moves a little on every
  // frame -- live heading, live GPS, a route re-headed at the walker's current position --
  // and responding to all of it is what read as the map breathing. Hold the scale that is
  // on screen until the fit has drifted a real amount away from it, then glide the whole
  // way there. `headingUpScaleEasing` latches that glide so it is not cut short the moment
  // it re-enters the band; holding does not freeze the frame, since
  // alignHeadingUpNavigationViewport still re-derives tx/ty every frame.
  if (!state.headingUpScaleEasing) {
    if (Math.abs(nextScale - previousScale) <= previousScale * HEADING_UP_SCALE_HOLD_RATIO) {
      state.headingUpScaleEaseAt = null;
      return previousScale;
    }
    state.headingUpScaleEasing = true;
  }

  const lastEaseAt = state.headingUpScaleEaseAt;
  const gapMs = Number.isFinite(lastEaseAt) ? (now - lastEaseAt) : null;
  // The first frame of an ease only starts the clock, and so does a gap past
  // HEADING_UP_SCALE_EASE_STALE_MS -- a genuinely stale timestamp (a backgrounded tab, a
  // screen the ease did not run on) would otherwise be integrated as one enormous dt and
  // snap, which is exactly the jump the ease exists to avoid.
  if (gapMs == null || gapMs > HEADING_UP_SCALE_EASE_STALE_MS) {
    state.headingUpScaleEaseAt = now;
    return previousScale;
  }
  if (!(gapMs > 0)) return previousScale; // clock has not advanced (duplicate call this tick)
  // Ordinary frames (including an occasional slow one well short of the stale
  // threshold -- see HEADING_UP_SCALE_EASE_STALE_MS) integrate a dt clamped to
  // HEADING_UP_SCALE_EASE_MAX_DT, so a single frame still never steps more than that
  // bounded amount. The clock only advances by the clamped amount actually integrated (not
  // all the way to `now`), carrying the remainder over onto the next frame instead of
  // dropping it -- a fixed-step accumulator, so a stretch of moderately slow frames (heavy
  // per-frame tilt-projection work while the phone is actively being re-tilted, well short
  // of a background-tab gap) still converges, just a little slower, rather than freezing
  // indefinitely because every individual frame's gap kept resetting the clock without
  // ever integrating anything.
  const dt = Math.min(gapMs, HEADING_UP_SCALE_EASE_MAX_DT * 1000) / 1000;
  state.headingUpScaleEaseAt = lastEaseAt + dt * 1000;
  // Zoom-out runs at the faster rate: see HEADING_UP_SCALE_EASE_OUT_RATE.
  const rate = nextScale < previousScale ? HEADING_UP_SCALE_EASE_OUT_RATE : HEADING_UP_SCALE_EASE_RATE;
  const eased = previousScale + (nextScale - previousScale) * (1 - Math.exp(-rate * dt));
  return Number.isFinite(eased) && eased > 0 ? eased : previousScale;
}

// The tilt camera as the viewport fit needs it. For a point `m` canvas px from the pivot
// along the screen's vertical axis (negative ahead, positive behind), the projected
// offset the renderer will actually draw it at is
//
//   projected = m * tiltCos / (1 - m * k),      k = sin(T) / (P * dpr)
//
// which is tiltProjectScreenPoint()'s arithmetic rearranged into canvas px. Deliberately
// reads the same tiltRotateXDeg() and tiltPerspectivePx() the renderer's tiltProjection()
// does (and so its own bestVisibleCanvasRect(), not the fit caller's) -- the fit has to
// agree with the draw, not with its caller's measurement, or the route lands somewhere
// other than where it was fitted. Returns null when tilt is inactive: there the
// relationship is the identity and the flat arithmetic is already exact.
//
// Because P depends only on the visible rect and the target's bearing -- never on
// viewport.scale -- everything downstream of this solves in closed form. That is what
// keeps worldToScreenFlat()'s no-feedback guarantee intact: the fit still never reads a
// tilted coordinate back off the screen, it just solves for the scale whose tilted
// result is right (see claude/3d-tilt-rendering.md).
function headingUpFitTiltCamera() {
  const tiltDeg = tiltRotateXDeg();
  if (!(tiltDeg > 0)) return null;
  const radians = toRadians(tiltDeg);
  const tiltSin = Math.sin(radians);
  const tiltCos = Math.cos(radians);
  if (!(tiltSin > 0)) return null;
  const perspectivePx = tiltPerspectivePx();
  const dpr = pixelRatio();
  if (!(perspectivePx > 0) || !(dpr > 0)) return null;
  return {
    tiltCos,
    tiltSin,
    k: tiltSin / (perspectivePx * dpr),
    // Canvas px above the pivot the ground converges on infinitely far ahead: the hard
    // ceiling on how much screen an ahead point can occupy at any scale whatsoever.
    horizonPx: perspectivePx * (tiltCos / tiltSin) * dpr,
  };
}

// Shared bounding-box scale-fit math for both heading-up modes (selected navigation
// and nearby survey): the maximum scale at which every point in `points` stays inside
// the rotated focus rect, honouring the tilt behind-heading exclusion. Returns null when
// no point constrains the fit (empty input, or every point sits exactly at the focus) so
// callers can fall back to the current viewport scale exactly as each did before this was
// factored out. This is pure fit-to-points geometry with no ceiling of its own: a ceiling
// baked in here (an arbitrary ratio against an unrelated reference scale) caused more bugs
// than it fixed, and callers now express what they want by choosing the points they pass --
// see nearbyCameraFitPoints.
function maxScaleForHeadingUpPoints(points, focus, focusRect, options = {}) {
  // Nearby mode's item cluster is genuinely hidden behind the user during full tilt
  // (isBehindTiltHeading), so excluding those points from the fit is correct there --
  // fitting a hidden point would force a needless zoom-out. The selected navigation
  // target (and its route) are the one exception to that hiding rule (see
  // isBehindTiltHeading's spec note), so maxHeadingUpNavigationScale passes
  // excludeBehindDuringTilt: false to keep the fit actually framing them even when
  // they're behind the user's current heading.
  const excludeBehindDuringTilt = options.excludeBehindDuringTilt !== false;
  // The point the camera will place at `focus`, which every constraint below measures its
  // point offsets from. It has to be the same point alignHeadingUpNavigationViewport
  // translates to `focus`, or the fit solves one framing and the camera applies another:
  // with a browse anchor set, this used to stay on the real GPS fix while the camera
  // centred the anchor, so the ring was measured as if it sat hundreds of metres off to one
  // side and the scale collapsed to squeeze that into the rect -- each relocation left the
  // Nearby view a step further zoomed out. Defaults to the real fix, which is what selected
  // navigation always wants (you have to walk there from where you actually are).
  const originPoint = options.originPoint || state.userLocation.point;
  const margin = headingUpFitMarginPx(focusRect);
  const dpr = pixelRatio();
  const left = focusRect.x + margin;
  const right = focusRect.x + focusRect.width - margin;
  const top = focusRect.y + margin;
  const bottom = focusRect.y + focusRect.height - margin;
  const rotation = currentNavigationMapRotationDegrees();
  const radians = toRadians(rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Fit where the renderer will actually draw these points, not where flat arithmetic
  // says they land. Without this the fit is solved on untilted coordinates while
  // worldToScreen() projects through the tilt camera, which compresses everything ahead
  // of the pivot towards the horizon -- so the scale the fit believes fills the screen
  // renders the target into a fraction of it. Measured on a 1000x800 stage with a
  // destination 580 m dead ahead: the framed band came out 1.17x too wide at beta 30,
  // 1.96x at beta 60 and 5.27x at beta 85 (claude/heading-up-tilt-aware-fit.md). Every
  // constraint below is the same inequality as before with the projection substituted
  // in, so with tilt inactive (or projectTilt off) tiltCos is 1, k is 0, and each one
  // collapses back to the exact flat expression it replaced.
  const tilt = options.projectTilt ? headingUpFitTiltCamera() : null;
  const tiltCos = tilt ? tilt.tiltCos : 1;
  const k = tilt ? tilt.k : 0;
  // Ahead of the pivot the projection is asymptotic, so "inside the rect" alone stops
  // constraining the fit at all once the top margin sits above the horizon -- which it
  // routinely does, since TILT_HORIZON_GROUND_RATIO puts the horizon at 62% of the band
  // above the pivot. Cap the projected ahead depth at the point where the perspective
  // divide has shrunk the ground to TILT_FIT_MIN_PERSPECTIVE_SCALE instead, so the
  // farthest fitted point is framed as far out as it can be while still being legible
  // rather than dissolved into the haze.
  const maxAheadPx = tilt
    ? Math.min(focus.y - top, tilt.horizonPx * (1 - TILT_FIT_MIN_PERSPECTIVE_SCALE))
    : focus.y - top;
  let maxScale = Number.POSITIVE_INFINITY;

  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const dx = point.x - originPoint.x;
    const dy = point.y - originPoint.y;
    const rotatedX = dx * cos - dy * sin;
    const rotatedY = dx * sin + dy * cos;

    // Points behind the user (rotatedY > 0) are only excluded from the fit while tilt
    // is active, since that's the only time isBehindTiltHeading() actually hides them
    // from the canvas (see that function) — fitting a hidden point there would force an
    // unnecessarily wide zoom-out, and under the tilt perspective transform a point that
    // close behind the camera balloons in size and looms over the view instead of
    // receding like points ahead do. When tilt is inactive, or when the caller says
    // these points are exempt from tilt culling (excludeBehindDuringTilt: false),
    // behind points are still drawn, so they must still constrain the bottom edge or
    // they end up off-screen.
    if (rotatedY > 0) {
      if (tiltActive() && excludeBehindDuringTilt) continue;
      // For behind points, add extra vertical buffer (20% of focus rect height) to ensure
      // the route from user to destination has adequate visibility. Without this, points
      // far behind can be technically "inside" the focus rect but still visually cramped
      // or partially obscured at extreme tilt angles. Only apply this buffer while tilt
      // is active AND we're using the default behind-point exclusion behavior (when
      // excludeBehindDuringTilt is false, behind points are treated like normal points).
      const behindBuffer = (tiltActive() && excludeBehindDuringTilt) ? focusRect.height * 0.2 : 0;
      // Behind the pivot the projection magnifies rather than compresses (the point is
      // closer to the camera), so this is the same bottom-edge inequality with a
      // denominator that grows with depth -- always bounded, and never anywhere near the
      // near-plane singularity tiltProjectOffsets clips at.
      const availableBelow = bottom - focus.y - behindBuffer;
      maxScale = Math.min(maxScale, availableBelow / (rotatedY * (tiltCos + availableBelow * k)));
      // Deliberately falls through to the horizontal constraint below rather than
      // `continue`-ing past it: a behind point still has a left/right position, and skipping
      // it let anything behind-and-to-the-side sail off the side of the screen however far
      // out it was, constrained only by how far below the pivot it sat. Seen on the Filter
      // screen, whose fit reaches for the nearest match of each selected filter regardless
      // of distance: a pub 1.4km behind-right was fitted vertically and then drawn 89px past
      // the right edge. The x formula below already handles behind points correctly -- its
      // `availableX * k * rotatedY` term is positive there, which is exactly the perspective
      // magnification that applies behind the pivot.
    }

    if (rotatedX !== 0) {
      // Horizontal: |rotatedX| * scale * perspective <= availableX. The perspective
      // factor depends on the point's own depth, which is itself proportional to scale,
      // so the two cancel into a single linear solve. A non-positive denominator means
      // the point's projected x converges inside the edge however far the scale goes
      // (only possible ahead of the pivot, where perspective shrinks faster than the
      // offset grows) -- no constraint, rather than a spurious negative one.
      const availableX = rotatedX > 0 ? right - focus.x : focus.x - left;
      const xDenom = Math.abs(rotatedX) + availableX * k * rotatedY;
      if (xDenom > 0) maxScale = Math.min(maxScale, availableX / xDenom);
    }
    if (rotatedY < 0) {
      const aheadDenom = -rotatedY * (tiltCos - maxAheadPx * k);
      // tiltCos - maxAheadPx * k is tiltCos * TILT_FIT_MIN_PERSPECTIVE_SCALE whenever the
      // horizon cap binds, so it is strictly positive there; it only reaches zero or
      // below when maxAheadPx itself is degenerate (focus above the top margin), which
      // the old arithmetic reported the same way -- as a non-positive maxScale, i.e. null.
      if (aheadDenom > 0) maxScale = Math.min(maxScale, maxAheadPx / aheadDenom);
      else maxScale = Math.min(maxScale, maxAheadPx);
    }
  }

  if (!Number.isFinite(maxScale) || maxScale <= 0) return null;
  return maxScale;
}

function maxHeadingUpNavigationScale(focus, focusRect) {
  if (!state.userLocation) return state.viewport.scale;
  const points = selectedNavigationTargetPoints();
  if (!points.length) return state.viewport.scale;
  // See maxScaleForHeadingUpPoints's comment: the selected destination/route stay
  // visible even when behind the user during full tilt, so the fit must keep framing
  // them there too, unlike nearby mode's item cluster.
  // projectTilt: fit where the tilt camera will actually draw the route. Selected
  // navigation only, deliberately: nearby survey mode has the identical flat-fit defect,
  // but its fit is wrapped in a walking-radius floor and a min-distance extension that
  // were both calibrated against flat geometry ([[nearby-view-zoom]] project memory), so
  // that one wants measuring and testing on its own rather than riding along here.
  const maxScale = maxScaleForHeadingUpPoints(points, focus, focusRect, {
    excludeBehindDuringTilt: false,
    projectTilt: true,
  });
  return maxScale == null ? state.viewport.scale : maxScale;
}

// The nearest single match for each filter the user has currently selected, ignoring the
// walking radius entirely. Only the Filter/Settings/Report screens fit against these (see
// nearbyCameraFitPoints): those screens are where you choose what you are looking for, so
// the map has to show that the nearest pub/pond/veteran tree exists at all -- even when it
// is a long walk outside the radius ring. One point per filter, not every match: the fit
// only ever has to reach the closest of each kind.
// Where on a matched item the camera should reach to. For a pin that is simply its own
// point; for a path (waymarked trails) it is the closest vertex to the origin, NOT
// `path.point` -- that is the label anchor at the midpoint of the path's longest segment
// (see pathLabelAnchor in js/normalize.js), which on a long-distance trail can sit
// kilometres from the stretch that actually runs past you. Fitting the anchor would zoom
// the whole map out to reach a part of the trail nobody asked about. Closest vertex rather
// than the exact perpendicular foot on the segment: the two differ by at most one segment
// length, far below the fit's own margin, and this needs no projection maths.
function nearestFitPointForEntry(entry, originPoint) {
  if (!entry || !entry.item) return null;
  const { segments } = entry.item;
  if (Array.isArray(segments) && segments.length) {
    let best = null;
    let bestDistance = Infinity;
    for (const segment of segments) {
      for (const vertex of segment) {
        if (!vertex || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) continue;
        const distance = Math.hypot(vertex.x - originPoint.x, vertex.y - originPoint.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = vertex;
        }
      }
    }
    if (best) return best;
  }
  return entry.item.point || null;
}

function nearestSelectedFilterPoints() {
  if (!state.userLocation) return [];
  if (state.overviewFilters.length === 0) return [];
  const { latitude, longitude, point: originPoint } = state.userLocation;
  const points = [];
  for (const filterKey of getActivePointFilterKeys()) {
    const entry = nearestOverviewEntryForFilter(filterKey, latitude, longitude);
    const point = nearestFitPointForEntry(entry, originPoint);
    if (point) points.push(point);
  }
  return points;
}

// Everything the nearby/secondary-screen camera frames.
//
// On the Nearby screen this is the walking-radius ring and nothing else. The ring is what
// the screen is about ("how far can I get in N minutes"), it is centred on nearbyOrigin()
// and it is perfectly circular -- so the fit is a fixed calculation that does not depend on
// the compass heading at all, and the camera stops moving as soon as the circle does.
// Fitting the item cluster instead (what this used to do, via a min-distance clamp) made the
// camera chase whichever matches happened to be nearest: zoomed in past the ring and clipped
// it when they were clustered close, zoomed out past it when one sat near the edge, and
// re-solved on every compass frame.
//
// The Filter/Settings/Report screens add the nearest match for each selected filter, so the
// view zooms out past the ring far enough to show that each selected kind exists and which
// way it lies -- see nearestSelectedFilterPoints.
//
// Every screen also reaches the nearest match of a filter the user has *just switched on* that
// turned out to have nothing inside the ring (see outOfRadiusFitPoints). Without that, adding a
// filter whose nearest match is beyond the ring -- Underground stations from inside the forest,
// say -- changed the list and left the map framed on a ring with nothing new in it, so the
// station the list had just named was nowhere to be seen.
function nearbyCameraFitPoints() {
  const ring = walkingRadiusCirclePoints();
  const reach = ring.concat(outOfRadiusFitPoints());
  if (!secondaryScreenActive()) return reach;
  return reach.concat(nearestSelectedFilterPoints());
}

// How far past the walking radius the Nearby camera will reach for an out-of-radius match,
// as a multiple of the radius itself. There has to be a limit: some filters have their
// nearest match hundreds of kilometres away (a category with no local example at all), and
// framing that would shrink the walking radius -- the thing the screen is actually about --
// to a speck and put the user's own surroundings off the map entirely. At 12x the ring still
// occupies a legible slice of the view, which covers the case this exists for: a 5-minute
// radius reaching a few kilometres out to the nearest Underground station. Beyond that the
// list still names the match (and marks it out-of-radius); the map just stays where the user
// can read it.
const NEARBY_OUT_OF_RADIUS_FIT_MAX_RATIO = 12;

// The single nearest fallback match for each filter that has nothing at all inside the
// walking radius -- exactly the entries overviewItemsForActiveFilter marks `outOfRadius`, and
// exactly what the Nearby list is showing for those filters. One per kind, not the three the
// list offers: the camera only has to reach far enough to show that the nearest one exists
// and which way it lies. Reads the memoized scan, so this costs a walk of an array the list
// has already built.
function outOfRadiusFitPoints() {
  // Only for filters the user has just turned on (state.outOfRadiusRevealFilters, set by
  // setOverviewFilters). This is a response to an action, not a standing property of the
  // camera: reaching for every unanswered filter all the time would mean a saved filter set
  // with one far-off kind in it left the Nearby view permanently zoomed out, with the walking
  // radius -- the thing the screen is about -- a quarter of its proper size on every boot.
  if (!state.outOfRadiusRevealFilters.length) return [];
  // Not while browsing a tapped spot either. That view is "show me what is around *there*",
  // and the ring around the tapped spot is the whole of it.
  if (state.nearbyAnchor) return [];
  const origin = nearbyOrigin();
  if (!origin || !origin.point) return [];
  const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
  if (!(radiusMetres > 0)) return [];
  const maxMetres = radiusMetres * NEARBY_OUT_OF_RADIUS_FIT_MAX_RATIO;
  const revealing = new Set(state.outOfRadiusRevealFilters);
  const nearestByFilter = new Map();
  for (const entry of overviewItemsForActiveFilter()) {
    if (!entry.outOfRadius || !revealing.has(entry.outOfRadiusFilterKey)) continue;
    if (!(entry.metres <= maxMetres)) continue;
    const existing = nearestByFilter.get(entry.outOfRadiusFilterKey);
    if (!existing || entry.metres < existing.metres) nearestByFilter.set(entry.outOfRadiusFilterKey, entry);
  }
  const points = [];
  for (const entry of nearestByFilter.values()) {
    const point = nearestFitPointForEntry(entry, origin.point);
    if (point) points.push(point);
  }
  return points;
}

// The filter keys whose nearest match the camera should currently reach past the ring for:
// the ones just switched on that turned out to have nothing inside the walking radius at all.
// Recomputed on every filter change, so switching one off (or switching anything on that *is*
// in range) hands the camera straight back to the ring with nothing to reset.
function refreshOutOfRadiusReveal(previousFilters) {
  const previous = new Set(previousFilters || []);
  const added = state.overviewFilters.filter((key) => !previous.has(key));
  if (!added.length) {
    state.outOfRadiusRevealFilters = [];
    return;
  }
  const addedSet = new Set(added);
  const unanswered = new Set();
  for (const entry of overviewItemsForActiveFilter()) {
    if (entry.outOfRadius && addedSet.has(entry.outOfRadiusFilterKey)) unanswered.add(entry.outOfRadiusFilterKey);
  }
  state.outOfRadiusRevealFilters = Array.from(unanswered);
}

function maxNearbyHeadingUpScale(focus, focusRect) {
  if (!state.userLocation) return state.viewport.scale;
  const points = nearbyCameraFitPoints();
  if (!points.length) return state.viewport.scale;
  // projectTilt: solve against where the tilt camera will actually draw these points rather
  // than flat geometry -- see maxScaleForHeadingUpPoints.
  //
  // excludeBehindDuringTilt stays at its default (true), so in full 3D only the half of the
  // ring ahead of the heading constrains the fit. That matches what 3D actually renders
  // (isBehindTiltHeading culls everything behind the user) and is what fixes the "far too
  // zoomed out in 3D" case: with the pivot anchored near the bottom of the screen at tilt,
  // forcing the behind half of the ring into the few pixels below it collapsed the scale to
  // roughly a third of what the visible half needs. The behind half is still drawn
  // (drawWalkingRadius always draws the full circle) -- it simply runs off the bottom edge,
  // the same way the ground immediately behind you does in any first-person view.
  // Same origin alignHeadingUpNavigationViewport anchors the nearby camera on, so a browse
  // anchor moves the framing without changing how tightly the ring is framed.
  // excludeBehindDuringTilt is the first-person rule (see tiltHidesWhatIsBehind): when the
  // pivot is you, the ground behind you legitimately runs off the bottom edge, and forcing
  // that half of the ring on screen collapsed the 3D zoom to about a third of what the
  // visible half needs (the "far too zoomed out in 3D" report). Browsing turns it off, so
  // the whole nearest area stays inside the available map area.
  //
  // Which of those two rules applies flips on the frame the browse anchor is set, a whole
  // slide before the pivot it belongs to has finished moving there. Solved as-is, that put
  // the behind half of the ring into the fit while the pivot was still pinned near the
  // bottom edge for first-person -- exactly the collapse the rule exists to avoid -- so
  // tapping a spot in 3D zoomed the map out several-fold on one frame and then crept back
  // in over the slide, which is the "it jumps instead of sliding" report. Both ends are
  // solved in their own consistent pivot+rule pair and the *scale* is blended between them
  // on the slide's own easing, the same way tiltRampedAnchor blends the pivot position, so
  // the zoom starts at exactly what was on screen and lands on the browse fit with nothing
  // in between that neither end would have chosen.
  const browsing = !tiltHidesWhatIsBehind();
  const progress = nearbyOriginTransitionEasedProgress();
  const fromBrowsing = progress == null ? browsing : state.nearbyOriginTransition.fromBrowsing;
  if (progress != null && fromBrowsing !== browsing) {
    const fromScale = nearbyPivotFitScale(points, fromBrowsing, focusRect);
    const toScale = nearbyPivotFitScale(points, browsing, focusRect);
    if (fromScale != null && toScale != null) {
      return fromScale + (toScale - fromScale) * progress;
    }
  }
  const maxScale = nearbyPivotFitScale(points, browsing, focusRect, focus);
  return maxScale == null ? state.viewport.scale : maxScale;
}

// The nearby ring fit for one end of a browse-origin slide: that end's own pivot position
// (nearbyPivotAnchorFraction) solved under that end's own behind-the-pivot rule. `focus` is
// passed only by the plain, non-blended call, which must keep using the focus point its
// caller already computed rather than re-deriving it.
function nearbyPivotFitScale(points, browsing, focusRect, focus) {
  const pivotFocus = focus || {
    x: focusRect.x + focusRect.width / 2,
    y: focusRect.y + focusRect.height * nearbyPivotAnchorFraction(browsing),
  };
  const maxScale = maxScaleForHeadingUpPoints(points, pivotFocus, focusRect, {
    projectTilt: true,
    originPoint: cameraOriginPoint(),
    excludeBehindDuringTilt: !browsing,
  });
  if (maxScale == null) return maxScale;
  return maxScale * nearbyFirstPersonFitZoom(browsing);
}

// How much tighter than "the whole ahead half of the walking-radius ring fits on screen" the
// first-person 3D camera frames. Fitting the ring exactly put its left and right extremes
// right on the screen edges, so 3D read as a small disc of forest floating in the middle of
// the map with the search area's own boundary drawn around it -- the "too zoomed out in 3D"
// report. Framing past those edges instead puts you *inside* the radius looking down it,
// which is what a heads-up view is for: the ring still runs off the sides (and behind you,
// as it already did), it is simply no longer the thing being framed.
//
// Ramped by tiltAnchorFraction(), like nearbyPivotAnchorFraction is, so the flat 2D fit --
// which is precisely about seeing the whole ring -- is untouched at 1.0, and raising the
// phone eases the zoom in rather than stepping it.
const NEARBY_TILT_FIT_ZOOM = 1.6;

function nearbyFirstPersonFitZoom(browsing) {
  // Browsing a spot away from yourself has no "ahead" to zoom into: that pivot exists to
  // show the whole nearest area around the tapped point (see tiltHidesWhatIsBehind), so it
  // keeps the plain fit.
  if (browsing) return 1;
  return 1 + (NEARBY_TILT_FIT_ZOOM - 1) * tiltAnchorFraction();
}

function alignHeadingUpNavigationViewport(options = {}) {
  // Before real map data loads, state.trees/state.landmarks/etc are still empty, so the
  // points fed into maxHeadingUpNavigationScale/maxNearbyHeadingUpScale don't yet reflect
  // real nearby items -- fitting against that would either fit nothing meaningful or, for
  // a selected target, fail outright. On iOS the compass can fire (driving this via
  // startCompassSmoothing) before mapPromise resolves, so this must wait for real data.
  if (!state.dataLoaded) return false;
  if (!navigationAnchorActive()) return false;
  if (selectionCameraTransitionActive()) return false;
  if (state.clusterZoomed) return false;
  clearHeadingUpCanvasTransform();
  const previousScale = state.viewport.scale;
  const previousTx = state.viewport.tx;
  const previousTy = state.viewport.ty;
  // assumeInspectorOpen lets a caller that has just un-minimized the inspector fit against
  // its full open footprint. Without it this measured the *current* rect, which during the
  // 180ms max-height transition (css/inspector.css) is still the minimized size -- and can
  // even be the pre-toggle size, since the plain path reads the memoized _overlapRectCache.
  // setInspectorMinimized's whole reason for calling this is to avoid fitting against the
  // smaller footprint, so it must opt in; its sibling centerViewportOnPointsKeepScale path
  // already did.
  const focusRect = bestVisibleCanvasRect({
    assumeInspectorOpen: Boolean(options.assumeInspectorOpen),
  });
  const focus = selectedNavigationHeadingUpActive()
    ? navigationFocusPoint(focusRect)
    : nearbyNavigationFocusPoint(focusRect);
  const maxScale = selectedNavigationHeadingUpActive()
    ? maxHeadingUpNavigationScale(focus, focusRect)
    : maxNearbyHeadingUpScale(focus, focusRect);
  // The one shared definition of where the camera is looking -- see cameraOriginPoint().
  const userPoint = cameraOriginPoint();
  // Use maxScale directly: heading-up mode always fits all targets in the
  // rotated focus rect. Math.min would leave scale too low when the map
  // was previously at a wider zoom (e.g. walking-radius level on first load).
  const targetScale = resolveHeadingUpTargetScale(maxScale, previousScale, Boolean(options.force));
  const targetViewport = {
    scale: targetScale,
    tx: focus.x - userPoint.x * targetScale,
    ty: focus.y - userPoint.y * targetScale,
  };

  if (options.animate) {
    animateViewportTo(targetViewport, options.durationMs || HEADING_UP_NAV_ANIMATION_MS);
  } else {
    state.viewport.scale = targetScale;
    state.viewport.tx = targetViewport.tx;
    state.viewport.ty = targetViewport.ty;
  }
  return Math.abs(previousScale - targetViewport.scale) > HEADING_UP_SCALE_EPSILON
    || Math.abs(previousTx - targetViewport.tx) > HEADING_UP_POSITION_PX_THRESHOLD
    || Math.abs(previousTy - targetViewport.ty) > HEADING_UP_POSITION_PX_THRESHOLD;
}

function clearHeadingUpCanvasTransform() {
  if (!els.canvas) return;
  els.canvas.style.transform = "";
  els.canvas.style.transformOrigin = "";
  if (els.overlayCanvas) {
    els.overlayCanvas.style.transform = "";
    els.overlayCanvas.style.transformOrigin = "";
  }
}

function animateToHeadingUpNavigationViewport(durationMs = HEADING_UP_NAV_ANIMATION_MS) {
  if (!selectedNavigationHeadingUpActive()) return;
  clearHeadingUpCanvasTransform();
  state.selectionViewportTransitionPending = false;
  const safeDuration = Math.max(MIN_HEADING_UP_ANIMATION_MS, Number(durationMs) || HEADING_UP_NAV_ANIMATION_MS);
  if (state.renderedNavigationHeading == null) {
    // Entering heading-up for the first time: animate renderedNavigationHeading
    // from north-up (0) toward the current compass heading, baked into each
    // canvas draw so pins always point down during the transition.
    state.renderedNavigationHeading = 0;
    const targetHeading = normalizeDegrees(state.compassHeading);
    if (Math.abs(shortestCompassDelta(0, targetHeading)) > 0.5) {
      state.headingUpEntryAnim = {
        from: 0,
        to: targetHeading,
        startTime: performance.now(),
        duration: safeDuration,
      };
    }
  }
  const focusRect = bestVisibleCanvasRect();
  const focus = navigationFocusPoint();
  const maxScale = maxHeadingUpNavigationScale(focus, focusRect);
  // Use maxScale directly so the viewport always zooms to fit the selected
  // target, even when coming from a wider zoom (e.g. walking-radius overview).
  const targetScale = maxScale;
  const userPoint = state.userLocation.point;
  animateViewportTo({
    scale: targetScale,
    tx: focus.x - userPoint.x * targetScale,
    ty: focus.y - userPoint.y * targetScale,
  }, safeDuration);
}

function prepareCanvasForDraw() {
  // Before anything reads the position this frame: walk state.userLocation along the glide
  // set up by the last GPS fix (ingestLocationFix), so the camera, the fit, the route head
  // and the You marker all move together rather than stepping once a second.
  if (advanceLocationGlide()) requestDraw();
  _overlapRectCache = undefined;
  _tiltProjectionCache = undefined;
  _nearbyRenderOriginCache = undefined;
  clearHeadingUpCanvasTransform();
  // A browse-origin slide is driven from here rather than by animateViewportTo: the camera
  // is re-derived from the interpolated origin every frame (see nearbyRenderOriginPoint),
  // which is what holds the walking-radius circle still while the map moves behind it.
  if (state.nearbyOriginTransition) {
    // The transition object outlives the slide itself by NEARBY_REVEAL_MS so the fade-in has
    // frames to run.
    const sliding = nearbyOriginTransitionActive();
    const fading = nearbyRevealInProgress();
    if (!fading) state.nearbyOriginTransition = null;
    // Re-derive the camera on every frame the transition object is alive, not just while the
    // slide is moving. This used to be `sliding || !fading`, which skipped exactly the frames
    // where the slide had landed but the reveal fade was still running -- and on those frames
    // nearbyRenderOriginPoint() has already snapped from the interpolated origin to the final
    // one while the camera is still the last interpolated framing. The walking-radius circle,
    // which the whole slide exists to hold still, twitched a few pixels as the slide landed
    // and hopped back when the fade ended. Once the origin has stopped moving this call is a
    // no-op that costs a fit solve for the ~180ms of the fade.
    alignHeadingUpNavigationViewport({ animate: false, force: true });
    if (fading) requestDraw();
  }
  // Resize whenever heading-up mode activates or deactivates so the canvas is only
  // oversized while the heading rotation actually needs it. Tilt no longer changes the
  // canvas size at all, so the tilt-ratio hysteresis that used to live here — and the
  // mid-gesture resize it existed to schedule safely — is gone with it.
  const needsOverscan = headingUpActive();
  const hasOverscan = state.canvasVisibleWidth > 0 && els.canvas.width > state.canvasVisibleWidth;
  if (needsOverscan !== hasOverscan) resizeCanvas();
  if (headingUpActive()) {
    if (state.headingUpEntryAnim != null) {
      const elapsed = performance.now() - state.headingUpEntryAnim.startTime;
      const progress = Math.min(1, elapsed / state.headingUpEntryAnim.duration);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const delta = shortestCompassDelta(state.headingUpEntryAnim.from, state.headingUpEntryAnim.to);
      state.renderedNavigationHeading = normalizeDegrees(state.headingUpEntryAnim.from + delta * eased);
      if (progress >= 1) {
        state.headingUpEntryAnim = null;
        state.renderedNavigationHeading = normalizeDegrees(state.compassHeading);
      } else {
        requestDraw();
      }
    } else if (state.renderedNavigationHeading === null && !selectedNavigationHeadingUpActive()) {
      // Nearby heading-up first activation: animate in from north-up to current heading
      state.renderedNavigationHeading = 0;
      const targetHeading = normalizeDegrees(state.compassHeading);
      if (Math.abs(shortestCompassDelta(0, targetHeading)) > 0.5) {
        state.headingUpEntryAnim = {
          from: 0,
          to: targetHeading,
          startTime: performance.now(),
          duration: 500,
        };
        requestDraw();
      } else {
        state.renderedNavigationHeading = targetHeading;
      }
    } else {
      state.renderedNavigationHeading = normalizeDegrees(state.compassHeading);
    }
  } else {
    state.renderedNavigationHeading = null;
    state.headingUpEntryAnim = null;
  }
  // The draw that follows projects every main-canvas point through this angle; record it so
  // later overlay-only frames can tell whether the terrain still matches (tiltRenderStale).
  state.renderedTiltRotateXDeg = tiltRotateXDeg();
}

function updateHeadingUpCanvasRotationTransform() {
  if (state.headingUpEntryAnim != null) return false; // entry animation loop interpolates renderedNavigationHeading each frame
  if (!headingUpActive() || !Number.isFinite(state.renderedNavigationHeading)) {
    clearHeadingUpCanvasTransform();
    return false;
  }
  const renderedRotation = -normalizeDegrees(state.renderedNavigationHeading);
  const currentRotation = currentNavigationMapRotationDegrees();
  const delta = shortestCompassDelta(renderedRotation, currentRotation);
  // Pivots on the camera origin, not the GPS fix: the CSS delta rotation has to spin the
  // canvas around whatever point the viewport transform anchored at the focus, or a browse
  // anchor's ring would swing across the screen as the compass turns.
  const originWorld = cameraOriginPoint();
  if (!originWorld) {
    clearHeadingUpCanvasTransform();
    return false;
  }
  const origin = rawWorldToScreen(originWorld);
  const dpr = pixelRatio();
  const originCss = `${origin.x / dpr}px ${origin.y / dpr}px`;
  els.canvas.style.transformOrigin = originCss;
  if (tiltRotateXDeg() > 0) {
    // No CSS perspective()/rotateX() any more — tilt is baked into the drawn pixels by
    // worldToScreen. That also retires the inter-frame shortcut used in the flat case
    // below (spin the finished bitmap by the heading delta instead of redrawing):
    // rolling an already-perspective image around the pivot is not the same as
    // re-projecting the ground at the new heading, and would visibly roll the horizon.
    // Redraw instead. It is requestAnimationFrame-coalesced, and in 3D the main canvas
    // carries terrain only (pins move to the overlay), so it stays one cheap draw per
    // frame for as long as the compass is actually moving.
    els.canvas.style.transform = "";
    if (Math.abs(delta) > 0.01) requestDraw();
  } else {
    els.canvas.style.transform = Math.abs(delta) < 0.01 ? "" : `rotate(${delta}deg)`;
  }
  // Overlay stays flat — pin positions are projected via worldToScreenForOverlayTilted
  // so they appear upright (billboard) rather than lying flat on the tilted surface.
  if (els.overlayCanvas) {
    els.overlayCanvas.style.transformOrigin = "";
    els.overlayCanvas.style.transform = "";
  }
  return true;
}

// True while the camera should keep re-framing the user and the selected target on its own
// (GPS follow, resize). Deliberately false once the user has moved the camera by hand: per
// spec "Expand from minimized: recenter *once*", the follow is a correction, not a lock.
// It used to have no such escape hatch, so with a selection open and the inspector expanded
// the map simply could not be panned or zoomed -- every gesture was answered by an
// immediate re-fit back to where it started.
function shouldAutoRepositionSelection() {
  if (manualCameraOverrideActive()) return false;
  return Boolean(state.userLocation && selectedCompassTarget() && !els.inspector.classList.contains("minimized"));
}

function manualCameraOverrideActive() {
  return Boolean(state.selected) && state.manualCameraOverrideFor === state.selected;
}

// Records that the user has taken the camera into their own hands for the current
// selection. Heading-up modes are exempt: those genuinely do lock the viewport to a fitted
// target (see zoomAt below), so there is no manual position to preserve.
function markManualCameraOverride() {
  if (typeof headingUpActive === "function" && headingUpActive()) return;
  state.manualCameraOverrideFor = state.selected;
}

// Hands the camera back to the app wherever a deliberate app-driven framing happens (a new
// selection, expanding the inspector, returning to Nearby), so the follow resumes instead
// of staying frozen on a pan the user made earlier.
function clearManualCameraOverride() {
  state.manualCameraOverrideFor = null;
}

// How much bigger than the straight line a real walking route's bounding box tends to be.
// While the routing graph is still building, selectedRoutePoints can only return the
// straight-line [user, destination] fallback, so fitting it exactly zooms in further than the
// eventual routed line needs -- which is then visible as a zoom-in immediately followed by a
// corrective zoom-out once the graph lands.
//
// Measured over 400 routed tree-to-tree pairs (120m-1.5km apart) against the real
// local-roads/local-paths datasets, as the ratio between the straight-line fit scale and the
// true routed fit scale: median 1.04, p75 1.12, p90 1.25, p95 1.40. Fitting with this much
// slack up front therefore leaves the finished route already inside the viewport for ~90% of
// selections, so ensureRoutingGraph's re-fit finds nothing near an edge and stays a no-op --
// one smooth movement instead of two. The remaining tail still gets corrected by that re-fit.
const ROUTE_UNKNOWN_FIT_SLACK = 1.25;

function ensureUserAndSelectionVisible(options = {}) {
  const target = selectedCompassTarget();
  if (!target || !state.userLocation) return;
  if (!options.force && els.inspector.classList.contains("minimized")) return;
  // force:true is an app-driven framing (a new selection, the first-load reveal, expanding
  // the inspector) and therefore also the point at which the app takes the camera back.
  // Unforced calls are the GPS follow, which must not fight a camera the user has moved by
  // hand -- the watchPosition handler calls this on every fix, so without this check a
  // panned-away map was dragged back to the fit roughly once a second.
  if (options.force) clearManualCameraOverride();
  else if (manualCameraOverrideActive()) return;
  const shouldAnimate = options.animate !== false;

  let pointsToFit = [state.userLocation.point];

  // If a route is being displayed (navigating to a tree/place), include all route points
  // so the viewport fits the entire path, not just the origin and destination.
  // selectedRoutePoints returns the walking route via roads/paths, which may extend
  // significantly beyond the straight-line destination.
  // selectedRoutePoints falls back to the straight line whenever the graph is not ready yet,
  // so what we are fitting is then an under-estimate of the real route (see the constant above).
  let routeIsFallback = false;
  if (target.point && typeof selectedRoutePoints === "function") {
    const routePoints = selectedRoutePoints(target);
    // Only while the graph is still resolving. ensureRoutingGraph's catch also sets
    // routingGraphReady with routingGraph left null (it deliberately does not retry), and
    // in that state the straight line IS the final route -- so testing the graph object
    // here kept the detour slack on every selection for the rest of the session, leaving
    // the view permanently ~25% looser than it should be.
    routeIsFallback = !state.routingGraphReady;
    if (routePoints && routePoints.length > 0) {
      pointsToFit.push(...routePoints);
    }
  } else if (state.selected && state.selected.type === "path" && target.segments) {
    // For path selections (e.g., forest boundaries), include all segment points
    for (const segment of target.segments) pointsToFit.push(...segment);
  } else if (target.point) {
    // Fallback: just the destination point
    pointsToFit.push(target.point);
  }

  // On GPS-triggered calls (no force flag), check if animation is needed.
  // Only animate if ANY point is near the visible area edge, preventing jarring
  // invisible viewport jumps when points are already comfortably visible.
  // Uses the ACTUAL inspector state (not assumeInspectorOpen) so mobile
  // navigation — where the inspector is collapsed — fills the larger available area.
  if (!options.force && shouldAnimate) {
    const focusRect = bestVisibleCanvasRect({
      assumeInspectorOpen: Boolean(options.assumeInspectorOpen),
    });
    const edgeMargin = Math.min(focusRect.width, focusRect.height) * 0.14;

    // Check if ANY point is near the edge (needs animation) vs ALL points are safe
    const anyNearEdge = pointsToFit.some((pt) => {
      const s = worldToScreen(pt);
      const nearLeft = s.x < focusRect.x + edgeMargin;
      const nearRight = s.x > focusRect.x + focusRect.width - edgeMargin;
      const nearTop = s.y < focusRect.y + edgeMargin;
      const nearBottom = s.y > focusRect.y + focusRect.height - edgeMargin;
      return nearLeft || nearRight || nearTop || nearBottom;
    });

    if (!anyNearEdge) return;  // All points safely visible, no animation needed
  }

  fitToPoints(pointsToFit, false, {
    focusVisibleArea: true,
    animate: shouldAnimate,
    durationMs: options.durationMs || 800,
    minScale: state.baseFitScale > 0 ? state.baseFitScale : undefined,
    boundsSlack: routeIsFallback ? ROUTE_UNKNOWN_FIT_SLACK : 1,
    // Callers that have just expanded the inspector must opt in: its max-height transition
    // (180ms, css/inspector.css) has not run yet, so measuring now reports the minimized
    // footprint and the bottom of the route ends up behind the finished sheet.
    assumeInspectorOpen: Boolean(options.assumeInspectorOpen),
  });
}

// Building the regional routing graph is lazy and takes seconds (see ensureRoutingGraph in
// js/loader.js), so the viewport fit that ran the moment a selection was made could only see
// whatever selectedRoutePoints could return *then* -- which, with the graph still building,
// is the straight-line [user, destination] fallback. A route that actually winds via mapped
// roads/paths is routinely far longer than that crow-flies line (the ~230m-straight /
// ~548m-walked case this was reported for), so by the time the real route is drawn it can
// run well outside the fitted viewport or sit behind the inspector.
//
// ensureRoutingGraph calls this from its completion handler, as the viewport counterpart to
// the updateSelectedDetailFields() call that fixes the equally stale distance/walk-time chip.
//
// Deliberately NOT forced: ensureUserAndSelectionVisible's own near-edge check then makes
// this a no-op whenever the real route already sits comfortably on screen, so a settled map
// is never yanked out from under someone seconds after they selected something. The wait for
// any in-flight viewport animation exists because that near-edge check reads the live
// viewport -- judging it against a half-way-through animation frame would both give the wrong
// answer and retarget an animation mid-flight.
const ROUTING_REFIT_MAX_WAIT_FRAMES = 90;

function refitSelectionAfterRoutingGraphReady() {
  let framesWaited = 0;

  const run = () => {
    if (!state.userLocation || !selectedCompassTarget()) return;
    if (state.viewportAnimationTo != null && framesWaited < ROUTING_REFIT_MAX_WAIT_FRAMES) {
      framesWaited += 1;
      requestAnimationFrame(run);
      return;
    }
    // Heading-up navigation has its own camera (anchor + rotation aware); going through
    // ensureUserAndSelectionVisible there would be overwritten by the next compass frame.
    if (selectedNavigationHeadingUpActive()) {
      alignHeadingUpNavigationViewport({ animate: true, durationMs: 520, force: true });
      return;
    }
    ensureUserAndSelectionVisible({ animate: true, durationMs: 520 });
  };

  run();
}

// The walking radius in world/projected units (same units as state.viewport.scale
// multiplies against). Shared by maxScaleForRadiusVisible (the centred, non-heading-up
// fit) and walkingRadiusCirclePoints (the heading-up fit) so both agree on how big the
// radius actually is.
function walkingRadiusWorldUnits() {
  const origin = nearbyOrigin();
  if (!origin) return 0;
  const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
  const edgeWorld = projectLonLat(
    origin.longitude + (radiusMetres / (111320 * Math.cos(origin.latitude * Math.PI / 180))),
    origin.latitude
  );
  return Math.abs(edgeWorld.x - origin.point.x);
}

// Metres represented by one world-projection unit (projectLonLat's x/y) at a given
// latitude. The projection is locally conformal (see projectLonLat), so this single
// figure applies equally to both axes -- same 111320*cos(lat) constant
// walkingRadiusWorldUnits() above already uses for the reverse conversion, kept as a
// named, independently-testable helper for any metres<->world-unit conversion.
function metresPerWorldUnit(latitudeDegrees) {
  return 111320 * Math.cos(latitudeDegrees * Math.PI / 180);
}

function metresToWorldUnits(metres, latitudeDegrees) {
  return metres / metresPerWorldUnit(latitudeDegrees);
}

// The centred, north-up counterpart to maxNearbyHeadingUpScale: the largest scale that
// still leaves the whole walking-radius circle inside focusRect. Uses the same
// headingUpFitMarginPx() inset the heading-up fit does, so the flat fit (boot reveal,
// Settings walking-radius change) and the heading-up fit frame the circle at the same
// size -- a smaller inset here read as the map jumping a step wider the moment a compass
// heading arrived and the heading-up fit took over.
function maxScaleForRadiusVisible(focusRect) {
  if (!state.userLocation) return Number.POSITIVE_INFINITY;
  const worldRadius = walkingRadiusWorldUnits();
  if (worldRadius <= 0) return Number.POSITIVE_INFINITY;
  const availableHalf = Math.min(focusRect.width / 2, focusRect.height / 2) - headingUpFitMarginPx(focusRect);
  if (availableHalf <= 0) return Number.POSITIVE_INFINITY;
  return availableHalf / worldRadius;
}

// A ring of points approximating the walking-radius circle around the user, in world
// coordinates. Feeding these through the same maxScaleForHeadingUpPoints() bounding-box
// math used for selected navigation keeps the radius fit consistent with map rotation, the
// heading-up anchor, and the tilt behind-heading exclusion, instead of duplicating that
// geometry with a separate formula.
//
// 64 samples, not 16: a circle's fit is heading-independent in principle, so as you turn on
// the spot the Nearby camera should hold perfectly still. What breaks that is polygon
// sampling error -- whichever sample happens to land nearest the constraining edge changes
// as the ring rotates, by roughly (1 - cos(pi/count)): 1.9% at 16 samples, 0.12% at 64. The
// extra points cost one cheap arithmetic pass each in a fit that runs once per compass
// frame, and buy a fit that no longer wobbles (and a circle no longer clipped by up to 2%).
function walkingRadiusCirclePoints(count = 64) {
  const point = nearbyRenderOriginPoint();
  if (!point) return [];
  const worldRadius = walkingRadiusWorldUnits();
  if (worldRadius <= 0) return [];
  const points = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    points.push({
      x: point.x + worldRadius * Math.cos(theta),
      y: point.y + worldRadius * Math.sin(theta),
    });
  }
  return points;
}

function centerOverviewOnUserLocation(options = {}) {
  if (!state.userLocation) return;
  if (state.selected && !secondaryScreenActive()) return;
  const requestedScale = Number.isFinite(options.scale) ? options.scale : state.viewport.scale;

  const focusRect = options.focusVisibleArea
    ? bestVisibleCanvasRect({ assumeInspectorOpen: true })
    : visibleCanvasRect();
  const targetScale = Math.min(requestedScale, maxScaleForRadiusVisible(focusRect));
  const focusCenter = {
    x: focusRect.x + focusRect.width / 2,
    y: focusRect.y + focusRect.height / 2,
  };
  const targetViewport = {
    scale: targetScale,
    tx: focusCenter.x - state.userLocation.point.x * targetScale,
    ty: focusCenter.y - state.userLocation.point.y * targetScale,
  };

  if (options.animate) {
    animateViewportTo(targetViewport, options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS);
    return;
  }

  stopViewportAnimation();
  state.viewport.scale = targetViewport.scale;
  state.viewport.tx = targetViewport.tx;
  state.viewport.ty = targetViewport.ty;
  requestDraw();
}

function keepOverviewCenteredOnUser(previousPoint) {
  if (!state.dataLoaded) return;
  if (!state.userLocation) return;
  if (state.selected && !secondaryScreenActive()) return;
  if (state.clusterZoomed) return;
  if (els.inspector.classList.contains("minimized")) return;
  if (nearbyNavigationAnchorActive()) return;

  const previousScreen = previousPoint ? worldToScreen(previousPoint) : null;
  const nextScreen = worldToScreen(state.userLocation.point);
  const screenMovement = previousScreen
    ? Math.hypot(nextScreen.x - previousScreen.x, nextScreen.y - previousScreen.y)
    : Infinity;

  const significantMove = !previousPoint || screenMovement >= 24;
  const focusRect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
  // Skip the off-screen check while a programmatic animation is running — mid-animation
  // the points are naturally mid-transition, and interrupting causes a visible snap.
  const anyOffscreen = !significantMove && !state.viewportAnimationFrame && nearbyCameraFitPoints().some((pt) => {
    const s = worldToScreen(pt);
    return s.x < focusRect.x || s.x > focusRect.x + focusRect.width
      || s.y < focusRect.y || s.y > focusRect.y + focusRect.height;
  });
  if (significantMove || anyOffscreen) {
    // Always animate. Snapping sub-200px corrections instantly (as this used to) was meant
    // to avoid jitter, but a 24-200px jump landing on each GPS fix *is* the jitter -- the
    // map visibly ticked sideways once a second while walking. Easing the same correction
    // over a short, distance-scaled duration covers it smoothly, and repeated fixes no
    // longer restart the ease (see viewportAnimationAlreadyHeadedTo) so they blend instead
    // of stacking. Only the very first fit, which has no previous position to ease from,
    // stays instant.
    const animate = Boolean(previousPoint);
    const durationMs = screenMovement >= 200 ? 620 : 300;
    ensureOverviewTargetsVisible({ animate, durationMs });
  }
}

function centerViewportOnPointsKeepScale(points, options = {}) {
  if (!Array.isArray(points) || points.length === 0) return;
  const validPoints = points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!validPoints.length) return;

  const bounds = validPoints.reduce((next, point) => expandBounds(next, point), {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });

  const centerWorld = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };

  const focusRect = options.focusVisibleArea
    ? bestVisibleCanvasRect({ assumeInspectorOpen: Boolean(options.assumeInspectorOpen) })
    : visibleCanvasRect();
  const focusCenter = {
    x: focusRect.x + focusRect.width / 2,
    y: focusRect.y + focusRect.height / 2,
  };

  const targetViewport = {
    scale: state.viewport.scale,
    tx: focusCenter.x - centerWorld.x * state.viewport.scale,
    ty: focusCenter.y - centerWorld.y * state.viewport.scale,
  };

  if (options.animate) {
    animateViewportTo(targetViewport, options.durationMs || 420);
    return;
  }

  stopViewportAnimation();
  state.viewport.tx = targetViewport.tx;
  state.viewport.ty = targetViewport.ty;
  requestDraw();
}

function ensureOverviewTargetsVisible(options = {}) {
  if (!state.dataLoaded) return;
  if (!state.userLocation) return;
  if (state.selected && !secondaryScreenActive()) return;
  if (state.clusterZoomed) return;
  setInspectorMinimized(false);

  if (nearbyNavigationAnchorActive()) {
    alignHeadingUpNavigationViewport({
      animate: Boolean(options.animate),
      durationMs: options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS,
      force: Boolean(options.force),
    });
    return;
  }

  // North-up fallback (a real selection while a secondary screen is open, so the
  // heading-up anchor above does not apply): same points, fitted as a plain bounding box.
  const points = nearbyCameraFitPoints();

  if (points.length) {
    fitToPoints(points, false, {
      focusVisibleArea: true,
      assumeInspectorOpen: true,
      animate: Boolean(options.animate),
      durationMs: options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS,
      minScale: state.baseFitScale > 0 ? state.baseFitScale : undefined,
      padding: OVERVIEW_FIT_PADDING_PX,
    });
  } else {
    // No radius circle to frame (no origin, or a zero radius). Centre on the user and
    // leave the scale alone rather than fitting nothing.
    centerOverviewOnUserLocation({
      animate: Boolean(options.animate),
      durationMs: options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS,
      focusVisibleArea: true,
    });
  }
}

function syncHashFromSelection() {
  const selection = state.selected;

  // Filter screen has a special hash
  if (state.filterScreenOpen) {
    setHashFromSelection("filters");
    return;
  }

  if (!selection || !selection.item) {
    setHashFromSelection("");
    return;
  }
  if (selection.type === "tree") {
    const params = new URLSearchParams();
    params.set("tree", treeHashKey(selection.item));
    setHashFromSelection(params.toString());
    return;
  }
  if (selection.type === "landmark") {
    const params = new URLSearchParams();
    params.set("place", placeHashKey(selection.item));
    setHashFromSelection(params.toString());
    return;
  }
  setHashFromSelection("");
}

function setHashFromSelection(value) {
  const nextHash = value ? `#${value}` : "";
  if (window.location.hash === nextHash) return;
  const url = `${window.location.pathname}${window.location.search}${nextHash}`;
  history.replaceState(null, "", url);
}

function applySelectionFromHash(announceMissing = true) {
  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw) return false;

  // Handle special screens
  if (raw === "filters") {
    openFiltersScreen();
    return true;
  }

  const params = new URLSearchParams(raw);

  // #report opens the report-a-problem form. The weekly reports link here
  // so a reader who spots a mistake lands straight on the form, and
  // #report=<text> pre-fills it with which report they were reading.
  if (params.has("report")) {
    openReportModal();
    const prefill = params.get("report");
    const detailsInput = document.getElementById("reportDetails");
    if (prefill && detailsInput && !detailsInput.value) {
      detailsInput.value = `${prefill}: `;
    }
    return true;
  }

  const treeKey = params.get("tree");
  const placeKey = params.get("place");

  if (treeKey) {
    const tree = findTreeByHashKey(treeKey);
    if (tree) {
      state.selected = { type: "tree", item: tree };
      showTreeDetails(tree, distanceFromUser(tree), "Tree link");
      // Deep-linked selections behave like a map-tap selection: the inspector opens
      // expanded immediately on both mobile and desktop (spec.md "Inspector modes").
      // Force it open (not just skip minimizing) so a hashchange to a new linked
      // location while the inspector was already minimized doesn't stay collapsed.
      setInspectorMinimized(false);
      startCompassNavigation();
      if (state.userLocation) ensureUserAndSelectionVisible({ animate: true, force: true, assumeInspectorOpen: true });
      else fitToPoints([tree.point], false, { animate: true });
      requestDraw();
      return true;
    }
  }

  if (placeKey) {
    const place = findPlaceByHashKey(placeKey);
    if (place) {
      state.selected = { type: "landmark", item: place };
      showLandmarkDetails(place, distanceFromUser(place));
      // See the matching comment in the treeKey branch above.
      setInspectorMinimized(false);
      startCompassNavigation();
      if (state.userLocation) ensureUserAndSelectionVisible({ animate: true, force: true, assumeInspectorOpen: true });
      else fitToPoints([place.point], false, { animate: true });
      requestDraw();
      return true;
    }
  }

  if (announceMissing) setStatus("Linked location was not found in this dataset.");
  return false;
}

// The identity of a tree, used for the #tree= deep link, for the Nearby list's own
// de-duplication (overviewEntryKey/uniqueSortedOverviewEntries) and for resolving a tapped
// list row back to a tree (findTreeByHashKey). recordNumber first, and only recordNumber:
// it is the one field the Veteran Tree Register guarantees unique (verified: 24,906 records,
// 24,906 distinct recordNumbers). `id` -- which this used to prefer -- is "0" on the 6,504
// untagged trees, so every one of them hashed to the same key. That collapsed all of them to
// a single row in the Nearby list (hiding every untagged tree closer than the one that
// survived the de-dupe), and made tapping that row open whichever "0" tree happened to sit
// first in the dataset -- a tree nowhere near the user. Reported as "Tree 0 is listed as the
// closest tree when it is nowhere nearby".
//
// The key is prefixed so it cannot be confused with the old id/tag-based one: record numbers and
// tag numbers are separate numbering spaces that overlap (11383 is both a real tag and a real,
// different, record), so an unprefixed key would make every link ambiguous about which scheme it
// was written in. With the prefix, findTreeByHashKey can tell them apart and links shared before
// this change still open the tree they always did.
const TREE_RECORD_KEY_PREFIX = "r";

function treeHashKey(tree) {
  if (!tree) return "";
  const recordNumber = tree.recordNumber;
  if (recordNumber !== null && recordNumber !== undefined && recordNumber !== "") {
    return TREE_RECORD_KEY_PREFIX + normalizeTreeNumber(recordNumber);
  }
  // No record number at all. Never true of the real register, but a future source (or a test
  // fixture) may lack one, and returning a blank key would silently drop the tree from every
  // de-duplicated list. Fall back to the position, which is what actually tells two trees
  // apart -- kept alphanumeric, and with the sign spelled out, so normalizeTreeNumber (which
  // strips "-" and ".") cannot merge a coordinate with its mirror image.
  if (Number.isFinite(tree.latitude) && Number.isFinite(tree.longitude)) {
    const axis = (value) => (value < 0 ? "n" : "p") + Math.round(Math.abs(value) * 1e6);
    return `ll${axis(tree.latitude)}${axis(tree.longitude)}`;
  }
  return normalizeTreeNumber(tree.id ?? tree.tagNumber ?? "");
}

// The 6,504 untagged records in the Veteran Tree Register carry tagNumber "0" rather than
// null, so a plain `commonName || tagNumber || recordNumber` chain rendered them as a tree
// called "0" wherever the species was also unrecorded. "0" is a placeholder, not a tag.
function treeTagLabel(tree) {
  const tag = tree && (tree.tagNumber ?? tree.nationalDatabaseTagNumber);
  if (tag === null || tag === undefined) return null;
  const text = String(tag).trim();
  if (!text || Number(text) === 0) return null;
  return text;
}

function treeDisplayName(tree) {
  if (!tree) return "Unknown tree";
  return tree.commonName || treeTagLabel(tree) || "Veteran tree";
}

function placeHashKey(place) {
  if (place.id !== null && place.id !== undefined && place.id !== "") {
    return `id:${String(place.id)}`;
  }
  return `ll:${Number(place.latitude).toFixed(6)},${Number(place.longitude).toFixed(6)}`;
}

// Links shared before treeHashKey moved to recordNumber carry the old, unprefixed id/tag-based
// key. Those are still accepted -- but only once no record-number key has matched, and never for
// a key that is ambiguous under the old scheme ("0" matched 6,504 trees), which would otherwise
// resolve to an arbitrary one of them.
function findTreeByHashKey(key) {
  const normalized = normalizeTreeNumber(key);
  if (!normalized) return null;
  for (const tree of state.trees) {
    if (treeHashKey(tree) === normalized) return tree;
  }
  let legacyMatch = null;
  for (const tree of state.trees) {
    const legacyKeys = [tree.id, tree.tagNumber, tree.nationalDatabaseTagNumber];
    if (!legacyKeys.some((value) => value != null && value !== "" && normalizeTreeNumber(value) === normalized)) continue;
    if (legacyMatch) return null;
    legacyMatch = tree;
  }
  return legacyMatch;
}

function findPlaceByHashKey(key) {
  const probe = String(key).trim().toLowerCase();
  for (const place of state.landmarks) {
    if (placeHashKey(place).toLowerCase() === probe) return place;
  }
  return null;
}

function cowKey(cow) {
  return `cow:${String(cow.serialNo)}`;
}

function findCowByKey(key) {
  const probe = String(key).trim().toLowerCase().replace(/^cow:/, "");
  for (const cow of state.cows) {
    if (String(cow.serialNo).toLowerCase() === probe) return cow;
  }
  return null;
}

function updateCompassOverlay() {
  const target = selectedCompassTarget();
  if (!target || !state.userLocation) {
    if (els.compassArrow) els.compassArrow.hidden = true;
    state.compassArrowAngle = null;
    return;
  }

  const bearingToTarget = bearingDegrees(state.userLocation.latitude, state.userLocation.longitude, target.latitude, target.longitude);
  const hasHeading = Number.isFinite(state.compassHeading);
  const relative = hasHeading ? shortestCompassDelta(state.compassHeading, bearingToTarget) : bearingToTarget;
  state.compassArrowAngle = unwrapAngle(state.compassArrowAngle, relative);

  const title = state.selected.type === "tree"
    ? treeDisplayName(target)
    : placeTitle(target);
  if (els.compassArrow) {
    els.compassArrow.hidden = false;
    els.compassArrow.style.transform = `rotate(${state.compassArrowAngle}deg)`;
    els.compassArrow.setAttribute("aria-label", `Direction to ${title}, ${detailTypeLabel(distanceFromUser(target))}`);
  }
}

function updateOverviewDirectionArrows() {
  if (state.selected || !state.userLocation || !els.inspectorBody) return;
  const arrows = els.inspectorBody.querySelectorAll(".nearest-arrow[data-item-lat]");
  if (!arrows.length) return;
  const { latitude, longitude } = state.userLocation;

  for (const arrow of arrows) {
    const itemLat = Number(arrow.dataset.itemLat);
    const itemLon = Number(arrow.dataset.itemLon);
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLon)) continue;
    const bearing = bearingDegrees(latitude, longitude, itemLat, itemLon);
    const relative = Number.isFinite(state.compassHeading)
      ? shortestCompassDelta(state.compassHeading, bearing)
      : bearing;
    const previousAngle = Number(arrow.dataset.currentAngle);
    const nextAngle = unwrapAngle(previousAngle, relative);
    arrow.dataset.currentAngle = String(nextAngle);
    arrow.style.transform = `rotate(${nextAngle}deg)`;
  }
}

// Re-renders the Nearby list when you have turned far enough for its heads-up order to
// change (see headsUpSortedEntries). Called from the compass smoothing loop alongside
// updateOverviewDirectionArrows, which spins the per-item arrows every frame; the list
// itself only re-sorts on a real turn, and selectOverview's own list-key check drops the
// re-render when the new heading happens to leave the order alone.
function refreshNearbyListForHeading() {
  if (!syncNearbyListHeading()) return;
  if (!isOverviewScreenActive()) return;
  if (typeof selectOverview !== "function") return;
  selectOverview();
}

function unwrapAngle(previous, target) {
  if (!Number.isFinite(target)) return previous;
  if (!Number.isFinite(previous)) return target;
  return previous + shortestCompassDelta(previous, target);
}

function normalizeDegrees(value) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const lambda1 = toRadians(lon1);
  const lambda2 = toRadians(lon2);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

function bearingArrow(degrees) {
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const index = Math.round(degrees / 45) % 8;
  return arrows[index];
}

function bearingCardinal(degrees) {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(degrees / 45) % 8;
  return labels[index];
}

function cowCenterForRequest() {
  return { ...DEFAULT_COW_CENTER };
}

function cowEndpointUrl(center) {
  return `${COW_PROXY_URL_BASE}${Number(center.longitude)},${Number(center.latitude)}`;
}

function normalizeCowApiData(payload) {
  const collars = Array.isArray(payload && payload.collars) ? payload.collars : [];
  const cows = collars
    .map((collar) => {
      const coords = collar && collar.position && Array.isArray(collar.position.coordinates)
        ? collar.position.coordinates
        : [];
      const longitude = Number(coords[0]);
      const latitude = Number(coords[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      return {
        serialNo: collar.serialNo,
        type: collar.type || "cattle",
        latitude,
        longitude,
        point: projectLonLat(longitude, latitude),
      };
    })
    .filter(Boolean);

  const pastures = Array.isArray(payload && payload.pastures)
    ? payload.pastures.filter((pasture) => pasture && pasture.geometry && Array.isArray(pasture.geometry.coordinates))
    : [];

  return { cows, pastures };
}

function applyCowData(cows, pastures, updatedAt, { persist } = { persist: true }) {
  state.cows = cows;
  state.cowPastures = pastures;
  state.cowLastUpdatedAt = updatedAt;

  if (state.userLocation) {
    state.nearestCow = nearestCowTo(state.userLocation.latitude, state.userLocation.longitude);
  }

  if (persist) {
    try {
      localStorage.setItem(COW_DATA_CACHE_KEY, JSON.stringify({
        updatedAt,
        cows: cows.map((cow) => ({
          serialNo: cow.serialNo,
          type: cow.type,
          latitude: cow.latitude,
          longitude: cow.longitude,
        })),
        pastures,
      }));
    } catch {}
  }

  if (isOverviewScreenActive()) selectOverview();
  // Refresh the "time ago" display if a cow detail panel is open
  updateCowTimeAgoField();
  requestDraw();
}

function applyCachedCowData() {
  try {
    const raw = localStorage.getItem(COW_DATA_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const cows = Array.isArray(parsed && parsed.cows)
      ? parsed.cows.map((cow) => ({
        ...cow,
        point: projectLonLat(Number(cow.longitude), Number(cow.latitude)),
      }))
      : [];
    const pastures = Array.isArray(parsed && parsed.pastures) ? parsed.pastures : [];
    applyCowData(cows, pastures, parsed && parsed.updatedAt ? parsed.updatedAt : null, { persist: false });
    return true;
  } catch {
    return false;
  }
}

async function refreshCowData(options = {}) {
  if (state.cowFetchInFlight && !options.force) return;
  state.cowFetchInFlight = true;
  let timeoutId = null;
  try {
    const center = cowCenterForRequest();
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 7000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const response = await fetch(cowEndpointUrl(center), {
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (timeoutId != null) clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`Cow data HTTP ${response.status}`);
    const payload = await response.json();
    const { cows, pastures } = normalizeCowApiData(payload);
    applyCowData(cows, pastures, Date.now(), { persist: true });
    return true;
  } catch {
    return false;
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
    state.cowFetchInFlight = false;
  }
}

function scheduleCowRefresh() {
  if (IS_LOCAL_COW_CACHE_MODE) return;
  if (state.cowRefreshTimerId != null) return;
  state.cowRefreshTimerId = window.setInterval(() => {
    refreshCowData();
  }, COW_REFRESH_MS);
}

function nearestTreeTo(latitude, longitude) {
  let best = null;
  for (const tree of state.trees) {
    const metres = distanceMetres(latitude, longitude, tree.latitude, tree.longitude);
    if (!best || metres < best.metres) best = { tree, metres };
  }
  return best;
}

function nearestCowTo(latitude, longitude) {
  let best = null;
  for (const cow of state.cows) {
    const metres = distanceMetres(latitude, longitude, cow.latitude, cow.longitude);
    if (!best || metres < best.metres) best = { cow, metres };
  }
  return best;
}

function nearestTreesTo(latitude, longitude, limit) {
  return state.trees
    .map((tree) => ({
      tree,
      metres: distanceMetres(latitude, longitude, tree.latitude, tree.longitude),
    }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

function nearestCowsTo(latitude, longitude, limit) {
  return state.cows
    .map((cow) => ({
      cow,
      metres: distanceMetres(latitude, longitude, cow.latitude, cow.longitude),
    }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

function nearestPlacesTo(latitude, longitude, limit) {
  return state.landmarks
    .map((place) => ({
      place,
      metres: distanceMetres(latitude, longitude, place.latitude, place.longitude),
    }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

function nearestPlaceByFilter(latitude, longitude, filter) {
  let best = null;
  for (const place of state.landmarks) {
    if (!filter(place)) continue;
    const metres = distanceMetres(latitude, longitude, place.latitude, place.longitude);
    if (!best || metres < best.metres) best = { place, metres };
  }
  return best;
}

function nearestPlacesByFilter(latitude, longitude, filter, limit) {
  return state.landmarks
    .filter((place) => filter(place))
    .map((place) => ({
      place,
      metres: distanceMetres(latitude, longitude, place.latitude, place.longitude),
    }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

function searchTreeByNumber() {
  const query = (els.treeSearchInput.value || "").trim();
  if (!query) {
    setStatus("Enter a tree number to search.");
    return;
  }

  const tree = findTreeByNumber(query);
  if (!tree) {
    setStatus(`No tree found for number \"${query}\".`);
    return;
  }

  const nearby = nearbyTreesTo(tree.latitude, tree.longitude, 24);
  const nearbyPoints = nearby.map(({ tree: item }) => item.point);
  state.selected = { type: "tree", item: tree };
  syncHashFromSelection();
  startCompassNavigation();

  const focusPoints = [
    tree.point,
    ...nearbyPoints,
  ];
  if (state.userLocation && state.userInMapArea) {
    focusPoints.push(state.userLocation.point);
  }

  fitToPoints(focusPoints, false, { animate: true });
  ensureUserAndSelectionVisible({ animate: true });
  showTreeDetails(tree, distanceFromUser(tree), "Tree search result");
  if (window.innerWidth <= 760) setInspectorMinimized(true);
  setStatus(`Found tree ${displayValue(tree.tagNumber || tree.nationalDatabaseTagNumber || tree.recordNumber)}.`);
  requestDraw();
}

function findTreeByNumber(value) {
  const normalized = normalizeTreeNumber(value);
  for (const tree of state.trees) {
    const candidates = [tree.tagNumber, tree.nationalDatabaseTagNumber, tree.recordNumber]
      .filter((item) => item !== null && item !== undefined && item !== "")
      .map((item) => normalizeTreeNumber(item));
    if (candidates.includes(normalized)) return tree;
  }
  return null;
}

function normalizeTreeNumber(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nearbyTreesTo(latitude, longitude, limit) {
  return state.trees
    .map((tree) => ({
      tree,
      metres: distanceMetres(latitude, longitude, tree.latitude, tree.longitude),
    }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

function nearbyTreesWithinDistance(latitude, longitude, maxMetres) {
  return state.trees
    .map((tree) => ({
      tree,
      metres: distanceMetres(latitude, longitude, tree.latitude, tree.longitude),
    }))
    .filter(({ metres }) => metres <= maxMetres)
    .sort((a, b) => a.metres - b.metres);
}

function nearbyCowsWithinDistance(latitude, longitude, maxMetres) {
  return state.cows
    .map((cow) => ({
      cow,
      metres: distanceMetres(latitude, longitude, cow.latitude, cow.longitude),
    }))
    .filter(({ metres }) => metres <= maxMetres)
    .sort((a, b) => a.metres - b.metres);
}

function nearbyPlacesByFilterWithinDistance(latitude, longitude, filter, maxMetres) {
  return state.landmarks
    .filter((place) => filter(place))
    .map((place) => ({
      place,
      metres: distanceMetres(latitude, longitude, place.latitude, place.longitude),
    }))
    .filter(({ metres }) => metres <= maxMetres)
    .sort((a, b) => a.metres - b.metres);
}

function nearestToViewport(items, limit) {
  const center = screenToWorld(els.canvas.width / 2, els.canvas.height / 2);
  return items
    .map((item) => ({ item, distance: Math.hypot(item.point.x - center.x, item.point.y - center.y) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ item }) => item);
}

function pointInsideBounds(point, bounds) {
  if (!bounds) return false;
  const padX = (bounds.maxX - bounds.minX) * 0.08;
  const padY = (bounds.maxY - bounds.minY) * 0.08;
  return point.x >= bounds.minX - padX
    && point.x <= bounds.maxX + padX
    && point.y >= bounds.minY - padY
    && point.y <= bounds.maxY + padY;
}

function expandBounds(bounds, point) {
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

function distanceFromUser(item) {
  if (!state.userLocation) return null;
  return distanceMetres(state.userLocation.latitude, state.userLocation.longitude, item.latitude, item.longitude);
}

function distanceFromUserToRoad(road) {
  if (!state.userLocation || !road || !road.segments || road.segments.length === 0) return null;
  
  const userLat = state.userLocation.latitude;
  const userLon = state.userLocation.longitude;
  let minDistance = Infinity;
  
  // Check all segments of the road
  for (const segment of road.segments) {
    for (let i = 1; i < segment.length; i++) {
      const p1 = segment[i - 1];
      const p2 = segment[i];
      
      // Unproject the points to get lat/lon
      const lonLat1 = unprojectPoint(p1);
      const lonLat2 = unprojectPoint(p2);
      
      // Calculate distance to this segment
      const dist = distanceToLineSegment(
        userLat, userLon,
        lonLat1.latitude, lonLat1.longitude,
        lonLat2.latitude, lonLat2.longitude
      );
      
      minDistance = Math.min(minDistance, dist);
    }
  }
  
  return minDistance === Infinity ? null : minDistance;
}

// Shared geometry behind distanceFromUserToPath (always the real GPS fix, used for real
// selection/navigation distances) and the nearby-list helpers below (which resolve their
// own origin -- the browse anchor when Nearby is showing one, real GPS otherwise).
function distanceFromPointToPath(latitude, longitude, path) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !path || !path.segments || path.segments.length === 0) return null;
  let minDistance = Infinity;

  for (const segment of path.segments) {
    for (let i = 1; i < segment.length; i += 1) {
      const p1 = segment[i - 1];
      const p2 = segment[i];
      const lonLat1 = unprojectPoint(p1);
      const lonLat2 = unprojectPoint(p2);
      const dist = distanceToLineSegment(
        latitude, longitude,
        lonLat1.latitude, lonLat1.longitude,
        lonLat2.latitude, lonLat2.longitude
      );
      minDistance = Math.min(minDistance, dist);
    }
  }

  return minDistance === Infinity ? null : minDistance;
}

function distanceFromUserToPath(path) {
  if (!state.userLocation) return null;
  return distanceFromPointToPath(state.userLocation.latitude, state.userLocation.longitude, path);
}

function nearbyWaymarkedPathsWithinDistance(latitude, longitude, maxMetres) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  return state.paths
    .filter((path) => isWaymarkedTrail(path))
    .map((path) => ({ path, metres: distanceFromPointToPath(latitude, longitude, path) }))
    .filter((entry) => Number.isFinite(entry.metres) && entry.metres <= maxMetres)
    .sort((a, b) => a.metres - b.metres);
}

// latitude/longitude are optional -- callers that already resolved the right origin
// (e.g. nearestOverviewEntryForFilter, which may be listing around the real GPS fix
// during Filter/Settings/Report) pass them through; omitting them falls back to
// nearbyOrigin() for plain Nearby-overview callers.
function nearestWaymarkedPathToUser(latitude, longitude) {
  const origin = (Number.isFinite(latitude) && Number.isFinite(longitude)) ? { latitude, longitude } : nearbyOrigin();
  if (!origin) return null;
  let best = null;
  for (const path of state.paths) {
    if (!isWaymarkedTrail(path)) continue;
    const metres = distanceFromPointToPath(origin.latitude, origin.longitude, path);
    if (!Number.isFinite(metres)) continue;
    if (!best || metres < best.metres) best = { path, metres };
  }
  return best;
}

function findPathByHashKey(key) {
  return state.paths.find((path) => pathHashKey(path) === key) || null;
}

// extractWaterFeatures, waterHashKey → js/normalize.js

function findWaterByHashKey(key) {
  return state.waterFeatures.find((w) => waterHashKey(w) === key) || null;
}

function nearbyWaterFeaturesWithinDistance(latitude, longitude, maxMetres) {
  // Deduplicate by name, keeping the nearest occurrence of each named feature
  const byName = new Map();
  for (const w of state.waterFeatures) {
    const metres = distanceMetres(latitude, longitude, w.latitude, w.longitude);
    if (metres > maxMetres) continue;
    const existing = byName.get(w.name);
    if (!existing || metres < existing.metres) byName.set(w.name, { water: w, metres });
  }
  return Array.from(byName.values()).sort((a, b) => a.metres - b.metres);
}

function nearestWaterFeatureTo(latitude, longitude) {
  let best = null;
  for (const w of state.waterFeatures) {
    const metres = distanceMetres(latitude, longitude, w.latitude, w.longitude);
    if (!best || metres < best.metres) best = { water: w, metres };
  }
  return best;
}

function nearestWaterFeaturesTo(latitude, longitude, limit) {
  return state.waterFeatures
    .map((water) => ({ water, metres: distanceMetres(latitude, longitude, water.latitude, water.longitude) }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

// latitude/longitude optional -- see nearestWaymarkedPathToUser above.
function nearestWaymarkedPathsToUser(limit, latitude, longitude) {
  const origin = (Number.isFinite(latitude) && Number.isFinite(longitude)) ? { latitude, longitude } : nearbyOrigin();
  if (!origin) return [];
  return state.paths
    .filter(isWaymarkedTrail)
    .map((path) => ({ path, metres: distanceFromPointToPath(origin.latitude, origin.longitude, path) }))
    .filter((x) => Number.isFinite(x.metres))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

function escapeCssSelector(value) {
  return typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function"
    ? CSS.escape(String(value))
    : String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function overviewLandmarkItemSelector(placeKey) {
  const escapedKey = escapeCssSelector(placeKey);
  return `.nearest-item[data-overview-type="landmark"][data-overview-key="${escapedKey}"]`;
}

function shouldSkipOverviewBusStopHydration() {
  return !navigator.onLine || !els.inspectorBody || state.selected || state.filterScreenOpen;
}

function transportCacheKey(place, type) {
  return `${type}:${placeHashKey(place)}`;
}

async function fetchTransportDeparturesData(place, type) {
  if (!place) return { error: "Transport stop missing" };
  const lookupType = type || (isBusCategory(place) ? "bus" : "train");
  const cacheKey = transportCacheKey(place, lookupType);
  if (state.transportLookupCache.has(cacheKey)) return state.transportLookupCache.get(cacheKey);
  if (state.transportLookupRequests.has(cacheKey)) return state.transportLookupRequests.get(cacheKey);
  const nameParam = lookupType === "train" && place.name ? `&name=${encodeURIComponent(place.name)}` : "";
  const url = `/.netlify/functions/transport-departures?lat=${place.latitude}&lon=${place.longitude}&type=${lookupType}${nameParam}`;
  const request = fetch(url, { signal: AbortSignal.timeout(12000) })
    .then((res) => res.json())
    .then((data) => {
      if (!data || data.error) return data;
      state.transportLookupCache.set(cacheKey, data);
      return data;
    })
    .finally(() => {
      state.transportLookupRequests.delete(cacheKey);
    });
  state.transportLookupRequests.set(cacheKey, request);
  return request;
}

function refreshOverviewBusStopName(place) {
  if (!els.inspectorBody) return;
  const placeKey = placeHashKey(place);
  const nameEls = els.inspectorBody.querySelectorAll(`${overviewLandmarkItemSelector(placeKey)} .nearest-name`);
  for (const nameEl of nameEls) nameEl.textContent = placeTitle(place);
}

function hydrateOverviewBusStopDirections() {
  if (shouldSkipOverviewBusStopHydration()) return;
  const items = els.inspectorBody.querySelectorAll('.nearest-item[data-overview-type="landmark"][data-overview-key]');
  for (const item of items) {
    const place = findPlaceByHashKey(item.dataset.overviewKey || "");
    if (!place || !isBusCategory(place)) continue;
    if (place.stopDirection || state.transportLookupCache.has(transportCacheKey(place, "bus"))) {
      refreshOverviewBusStopName(place);
      continue;
    }
    fetchTransportDeparturesData(place, "bus")
      .then((data) => {
        if (!data || data.error) return;
        refreshOverviewBusStopName(place);
      })
      .catch((error) => {
        console.error("Failed to load nearby bus stop direction", error);
      });
  }
}

async function loadTransportDepartures(place) {
  const type = isBusCategory(place) ? "bus" : "train";
  const section = document.createElement("div");
  section.className = "departures-section";
  section.innerHTML = `<p class="departures-loading">Loading departures…</p>`;
  els.inspectorBody.appendChild(section);

  try {
    const data = await fetchTransportDeparturesData(place, type);

    // Bail silently if user has navigated away
    if (!state.selected || state.selected.item !== place) return;

    if (data.error || !data.departures) {
      section.innerHTML = `<p class="departures-error">Departures unavailable.</p>`;
      return;
    }

    if (!data.departures.length) {
      section.innerHTML = `<p class="departures-empty">No departures in the next few minutes.</p>`;
      return;
    }

    const stopLabel = data.stopName ? `<p class="departures-stop-name">${escapeHtml(data.stopName)}</p>` : "";
    const stopDirection = type === "bus" && data.stopDirection
      ? `<p class="departures-stop-direction">Buses towards ${escapeHtml(data.stopDirection)}</p>`
      : "";
    section.innerHTML = `<h3 class="departures-heading">Next departures</h3>${stopLabel}${stopDirection}
      <ul class="departures-list">
        ${data.departures.map((d) => `
          <li class="departure-item">
            <span class="departure-line">${escapeHtml(d.line)}</span>
            <span class="departure-direction">${escapeHtml(d.direction)}</span>
            <span class="departure-time${d.due ? ' due' : ''}">${d.due ? 'Due' : (d.minutesAway + ' min')}</span>
          </li>`).join("")}
      </ul>`;
  } catch {
    if (state.selected && state.selected.item === place) {
      section.innerHTML = `<p class="departures-error">Departures unavailable.</p>`;
    }
  }
}

function distanceToLineSegment(lat, lon, lat1, lon1, lat2, lon2) {
  // Calculate distance from point to line segment in metres
  const d12 = distanceMetres(lat1, lon1, lat2, lon2);
  
  if (d12 === 0) {
    return distanceMetres(lat, lon, lat1, lon1);
  }
  
  // Calculate the projection of the point onto the line
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  const t = Math.max(0, Math.min(1, ((lon - lon1) * dx + (lat - lat1) * dy) / (dx * dx + dy * dy)));
  
  const projLat = lat1 + t * dy;
  const projLon = lon1 + t * dx;
  
  return distanceMetres(lat, lon, projLat, projLon);
}

// forEachGeojsonCoordinate, walkCoordinates → js/normalize.js

function projectLonLat(longitude, latitude) {
  const clamped = clamp(latitude, -85, 85);
  const rad = clamped * Math.PI / 180;
  return {
    x: longitude,
    y: -Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 180 / Math.PI,
  };
}

function unprojectPoint(point) {
  const latitude = (2 * Math.atan(Math.exp((-point.y) * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;
  return { longitude: point.x, latitude };
}

function rawWorldToScreen(point) {
  return {
    x: point.x * state.viewport.scale + state.viewport.tx,
    y: point.y * state.viewport.scale + state.viewport.ty,
  };
}

function rawScreenToWorld(x, y) {
  return {
    x: (x - state.viewport.tx) / state.viewport.scale,
    y: (y - state.viewport.ty) / state.viewport.scale,
  };
}

function rotateScreenPoint(point, center, degrees) {
  const radians = toRadians(degrees);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

// ------------------------------------------------------------------------------
// Tilt projection
//
// The ground plane is rotated by tiltRotateXDeg() about a horizontal axis through the
// user's position (the pivot) and viewed from tiltPerspectivePx() away. For a point
// dy CSS px from the pivot down the screen's vertical axis:
//
//   z     = dy * sin(T)     (+z is towards the camera)
//   scale = P / (P - z)
//
// Ahead of the pivot (dy < 0) z is negative, so scale falls smoothly towards 0 and the
// projected y converges on a *finite* horizon at -P/tan(T). That finite limit is the
// whole reason this is done in JS rather than as a CSS perspective()/rotateX() on the
// finished bitmap: a rotated bitmap runs out of pixels somewhere short of the horizon,
// leaving a band at the top of the screen with no map in it that grows with tilt angle
// and cannot be closed by any amount of overscan. Projecting per point instead lets the
// ground be drawn all the way to the horizon.
//
// Behind the pivot (dy > 0) z grows towards P, where the perspective divide is singular
// and past which points sit behind the camera — scale flips negative and coordinates
// mirror to nonsense (which is what used to make the radar cone, the destination
// pointer and pins vanish, and what made CSS clip the rotated canvas outright).
// TILT_NEAR_PLANE_RATIO clips just short of that. Nothing visible is lost: a point at
// the near plane already projects ~50x out, far below the bottom of the viewport.
function tiltProjectOffsets(dxCss, dyCss, tiltDeg, perspectivePx) {
  const rad = toRadians(tiltDeg);
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const dyMax = sin > 0 ? (perspectivePx * TILT_NEAR_PLANE_RATIO) / sin : Infinity;
  const clipped = dyCss > dyMax;
  const dy = clipped ? dyMax : dyCss;
  const scale = perspectivePx / (perspectivePx - dy * sin);
  return { dx: dxCss * scale, dy: dy * cos * scale, scale, clipped };
}

// Per-frame snapshot of everything the tilt projection needs. This must be cached:
// tiltPerspectivePx() reaches bestVisibleCanvasRect() and the navigation target points,
// and pixelRatio() reads a DOM dataset attribute — all far too expensive to repeat for
// every one of the hundreds of thousands of points a single draw projects. Invalidated
// wherever _overlapRectCache is (declaration above).
function tiltProjection() {
  if (_tiltProjectionCache !== undefined) return _tiltProjectionCache;
  const tiltDeg = tiltRotateXDeg();
  if (tiltDeg <= 0 || !state.userLocation) {
    _tiltProjectionCache = null;
    return _tiltProjectionCache;
  }
  const rad = toRadians(tiltDeg);
  const sin = Math.sin(rad);
  const perspectivePx = tiltPerspectivePx();
  const originWorld = cameraOriginPoint();
  if (!originWorld) {
    _tiltProjectionCache = null;
    return _tiltProjectionCache;
  }
  const origin = rawWorldToScreen(originWorld);
  _tiltProjectionCache = {
    sin,
    cos: Math.cos(rad),
    perspectivePx,
    dyMax: sin > 0 ? (perspectivePx * TILT_NEAR_PLANE_RATIO) / sin : Infinity,
    originX: origin.x,
    originY: origin.y,
    dpr: pixelRatio(),
  };
  return _tiltProjectionCache;
}

// Projects an already-flat (raw + heading-rotated) canvas-pixel position through the
// active tilt. Shared by the main canvas (worldToScreen), the flat overlay
// (worldToScreenForOverlayTilted) and raw canvas positions (projectCanvasPoint) so all
// three agree by construction rather than by three copies of the same arithmetic.
function tiltProjectScreenPoint(flat) {
  const cam = tiltProjection();
  if (!cam) return { x: flat.x, y: flat.y, scale: 1, clipped: false };
  const dxCss = (flat.x - cam.originX) / cam.dpr;
  const dyCss = (flat.y - cam.originY) / cam.dpr;
  const clipped = dyCss > cam.dyMax;
  const dy = clipped ? cam.dyMax : dyCss;
  const scale = cam.perspectivePx / (cam.perspectivePx - dy * cam.sin);
  return {
    x: cam.originX + dxCss * scale * cam.dpr,
    y: cam.originY + dy * cam.cos * scale * cam.dpr,
    scale,
    clipped,
  };
}

// Canvas-pixel y of the horizon: the row the ground plane converges on infinitely far
// ahead. Returns null when not tilted (a flat map has no horizon on screen).
function tiltHorizonCanvasY() {
  const cam = tiltProjection();
  if (!cam) return null;
  return cam.originY - (cam.perspectivePx * (cam.cos / cam.sin)) * cam.dpr;
}

// How far ahead of the pivot (CSS px, flat/untilted) is still worth drawing: past this
// the perspective scale has fallen below TILT_FAR_FADE_RATIO, where the distance fade
// has already erased the ground completely. Bounds the geometry the draw loop walks so
// "draw to the horizon" doesn't mean "walk every road in the dataset".
function tiltFarClipCssPx() {
  const cam = tiltProjection();
  if (!cam || cam.sin <= 0) return Infinity;
  return (cam.perspectivePx * (1 / TILT_FAR_FADE_RATIO - 1)) / cam.sin;
}

// Flat (untilted) screen position: the raw viewport transform plus the heading-up
// rotation — the map as it would look at zero tilt. Viewport fitting and "is this point
// still on screen" checks must use this rather than worldToScreen: near the top of a
// tilted screen the projection compresses huge world distances into a few pixels, so
// tilted coordinates would read as "point near the edge" and retrigger a re-fit every
// frame.
function worldToScreenFlat(point) {
  const raw = rawWorldToScreen(point);
  const rotation = navigationMapRotationDegrees();
  if (!rotation || !state.userLocation) return raw;
  // Rotates about the camera origin (cameraOriginPoint), the same point the viewport
  // transform anchors at the focus -- pivoting on the GPS fix instead would swing a browse
  // anchor's framing around the screen every time the compass moved.
  return rotateScreenPoint(raw, rawWorldToScreen(cameraOriginPoint()), rotation);
}

// Screen position everything on the main canvas is drawn at, tilt included.
function worldToScreen(point) {
  const flat = worldToScreenFlat(point);
  if (!tiltActive()) return flat;
  return tiltProjectScreenPoint(flat);
}

// Overlay elements use the current heading-up rotation so they stay aligned with
// map features while compass updates trigger full-canvas redraws.
function worldToScreenForOverlay(point) {
  if (state.headingUpEntryAnim != null) return worldToScreen(point);
  const raw = rawWorldToScreen(point);
  const rotation = currentNavigationMapRotationDegrees();
  if (!rotation || !state.userLocation) return raw;
  return rotateScreenPoint(raw, rawWorldToScreen(cameraOriginPoint()), rotation);
}

// Projects an overlay canvas position through the active tilt perspective so pins
// appear at the correct depth but remain upright (billboard) on the flat overlay canvas.
// Also returns the perspective-divide `scale` it computed (matching
// projectCanvasPoint) so callers can detect points whose scale has blown up toward the
// camera's behind-pivot singularity without recomputing the projection a second time.
// The early "flat" fallback below (tilt inactive / no user location) has no scale
// property; callers that need one in every case should treat a missing scale as "not
// tilted" rather than assuming it's always present.
function worldToScreenForOverlayTilted(point) {
  const flat = worldToScreenForOverlay(point);
  if (!tiltActive() || !state.userLocation) return flat;
  return tiltProjectScreenPoint(flat);
}

// Projects a raw canvas-pixel point through the active tilt perspective.
// Used to place radar/overlay elements in the same 3D space as the terrain canvas.
function projectCanvasPoint(px, py) {
  if (!tiltActive() || !state.userLocation) return { x: px, y: py, scale: 1, clipped: false };
  return tiltProjectScreenPoint({ x: px, y: py });
}

function screenToWorld(x, y) {
  // Handle tilt projection first (if active), then rotation
  let screenX = x, screenY = y;

  if (tiltActive() && state.userLocation) {
    const tiltDeg = tiltRotateXDeg();
    if (tiltDeg > 0) {
      const origin = rawWorldToScreen(cameraOriginPoint());
      const dpr = pixelRatio();
      const perspective = tiltPerspectivePx();
      const T = tiltDeg * Math.PI / 180;
      const c = Math.cos(T);
      const s = Math.sin(T);

      // Convert screen offset to CSS pixels
      const x_rel = (screenX - origin.x) / dpr;
      const y_rel = (screenY - origin.y) / dpr;

      // Reverse the perspective projection
      // From forward: y' = dy * cos(T) * perspective / (perspective - dy * sin(T))
      // Solving for dy: dy = y_rel * perspective / (c * perspective + y_rel * s)
      //
      // That denominator vanishes exactly at the horizon and flips sign above it, so a
      // screen row at or above the horizon (every row above it is sky, and rows near it
      // are unboundedly far away) would unproject to an infinite or negative-distance
      // world point. Clamping to the row the far clip projects to keeps the inverse
      // finite and consistent with the forward projection's own draw distance.
      const farClip = tiltFarClipCssPx();
      const yRelMin = Number.isFinite(farClip)
        ? -farClip * c * (perspective / (perspective + farClip * s))
        : -Infinity;
      const y_clamped = Math.max(y_rel, yRelMin);
      const dy = y_clamped * perspective / (c * perspective + y_clamped * s);
      const dz = dy * s;
      const scale = perspective / (perspective - dz);
      const dx = x_rel / scale;

      // Convert back to screen pixels, accounting for the un-projected values
      screenX = origin.x + dx * dpr;
      screenY = origin.y + dy * dpr;
    }
  }

  // Handle rotation (heading-up mode)
  const rotation = navigationMapRotationDegrees();
  if (!rotation || !state.userLocation) return rawScreenToWorld(screenX, screenY);
  const unrotated = rotateScreenPoint({ x: screenX, y: screenY }, rawWorldToScreen(cameraOriginPoint()), -rotation);
  return rawScreenToWorld(unrotated.x, unrotated.y);
}

function canvasPoint(event) {
  const rect = (els.mapStage || els.canvas).getBoundingClientRect();
  const dpr = pixelRatio();
  return {
    x: state.canvasInsetX + (event.clientX - rect.left) * dpr,
    y: state.canvasInsetY + (event.clientY - rect.top) * dpr,
  };
}

function centerPoint() {
  const r = visibleCanvasRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function isNearCanvas(point, margin) {
  const r = visibleCanvasRect();
  return point.x >= r.x - margin && point.y >= r.y - margin
    && point.x <= r.x + r.width + margin && point.y <= r.y + r.height + margin;
}

function requestDraw() {
  if (state.animationFrame) return;
  state.animationFrame = requestAnimationFrame(draw);
  state.animationFrameRequestedAt = performance.now();
}

function postDraw() {
  if (headingUpActive()) updateHeadingUpCanvasRotationTransform();
}

function requestOverlayDraw() {
  if (state.overlayAnimationFrame) return;
  state.overlayAnimationFrame = requestAnimationFrame(() => {
    state.overlayAnimationFrame = null;
    state.overlayAnimationFrameRequestedAt = null;
    if (typeof drawOverlay === "function") drawOverlay();
  });
  state.overlayAnimationFrameRequestedAt = performance.now();
}

function setStatus(_message) {
}

function distanceMetres(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = toRadians(lat2 - lat1);
  const dLambda = toRadians(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function formatDistance(metres) {
  if (!Number.isFinite(metres)) return "Not recorded";
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  const decimals = km < 10 ? 1 : 0;
  const kmStr = km.toFixed(decimals).replace(/\.0$/, "");
  return `${kmStr} km`;
}

function formatWalkTime(metres) {
  if (!Number.isFinite(metres)) return "Not recorded";
  const minutes = metres / (5000 / 60);
  if (minutes < 1) return "Under 1 min walk";
  if (minutes < 60) return `~${Math.round(minutes)} mins walk`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `~${hours} hr ${mins} mins walk` : `~${hours} hr walk`;
}

function walkingDistanceToMetres(minutes) {
  return minutes * (5000 / 60);
}

function updateSelectedDetailFields() {
  if (!state.selected || !state.userLocation) return;
  const item = selectedCompassTarget();
  if (!item) return;
  // Prefer the real road/path route length (matches the drawn route line) once it's
  // available; fall back to the plain straight-line distance otherwise (routing graph
  // still building, item has no routable point e.g. a path/water feature, or no route
  // could be found) so the figure is never blank.
  const routedMetres = selectedRouteMetres(item);
  const metres = routedMetres != null ? routedMetres : distanceFromUser(item);
  const distancePill = els.inspectorBody && els.inspectorBody.querySelector('[data-live-field="distance"]');
  if (distancePill) distancePill.innerHTML = walkInfoExpandableHtml(metres);
  updateCowTimeAgoField();
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return null;
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function updateCowTimeAgoField() {
  if (!state.selected || state.selected.type !== "cow") return;
  const el = els.inspectorBody && els.inspectorBody.querySelector('[data-live-field="cow-updated"]');
  if (!el) return;
  el.textContent = formatTimeAgo(state.cowLastUpdatedAt) || "Not recorded";
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  return String(value);
}

function estimateTreeAgeFromGirth(tree) {
  const girthMetres = Number(tree && tree.girthMetres);
  if (!Number.isFinite(girthMetres) || girthMetres <= 0) return null;

  const girthCentimetres = girthMetres * 100;
  const growthModel = growthModelForTree(tree);
  const estimatedYearsAtMeasurement = Math.max(1, Math.round(girthCentimetres / growthModel.cmPerYear));
  const gpsDate = parseLooseDate(tree && tree.dateGpsd);
  const today = new Date();

  let estimatedYearsToday = estimatedYearsAtMeasurement;
  if (gpsDate) {
    const elapsedYears = Math.max(0, (today.getTime() - gpsDate.getTime()) / (365.2425 * 24 * 60 * 60 * 1000));
    estimatedYearsToday = Math.max(1, Math.round(estimatedYearsAtMeasurement + elapsedYears));
  }

  const estimatedStartYear = today.getFullYear() - estimatedYearsToday;
  return `~${estimatedYearsToday} years (c.${estimatedStartYear})`;
}

function growthModelForTree(tree) {
  const speciesText = [
    tree && tree.commonName,
    tree && tree.latinName,
    tree && tree.treeForm,
  ].filter(Boolean).join(" ").toLowerCase();

  const growthRates = [
    { tokens: ["yew", "taxus"], cmPerYear: 1.5 },
    { tokens: ["oak", "quercus"], cmPerYear: 2.5 },
    { tokens: ["beech", "fagus"], cmPerYear: 2.3 },
    { tokens: ["hornbeam", "carpinus"], cmPerYear: 2.4 },
    { tokens: ["lime", "tilia"], cmPerYear: 2.7 },
    { tokens: ["ash", "fraxinus"], cmPerYear: 2.8 },
    { tokens: ["chestnut", "castanea", "aesculus"], cmPerYear: 3.0 },
    { tokens: ["sycamore", "acer pseudoplatanus"], cmPerYear: 3.2 },
    { tokens: ["maple", "acer"], cmPerYear: 3.0 },
    { tokens: ["elm", "ulmus"], cmPerYear: 2.9 },
    { tokens: ["birch", "betula"], cmPerYear: 3.5 },
    { tokens: ["alder", "alnus"], cmPerYear: 3.6 },
    { tokens: ["willow", "salix"], cmPerYear: 4.2 },
    { tokens: ["poplar", "populus"], cmPerYear: 4.8 },
  ];

  for (const model of growthRates) {
    if (model.tokens.some((token) => speciesText.includes(token))) {
      return model;
    }
  }

  return { cmPerYear: 2.9 };
}

function parseLooseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  const text = String(value).trim();
  if (!text) return null;

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  const dayMonthYear = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!dayMonthYear) return null;

  const day = Number(dayMonthYear[1]);
  const month = Number(dayMonthYear[2]);
  const rawYear = Number(dayMonthYear[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

// normalizeFolkloreLocations, isGenericFolkloreLocation, parseFolkloreCoordinates → js/normalize.js
// classifyFolklore*, normalizeTag, addExpandedTag, buildFolkloreCategoryTags,
// buildOsmCategoryTags, hasPlaceTag, filterKindEmoji, filterKindColor → js/categories.js

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pixelRatio() {
  return Number(els.canvas.dataset.dpr || window.devicePixelRatio || 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
