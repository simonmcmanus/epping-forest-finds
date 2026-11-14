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
const BUSINESS_SLUGS_URL = "data/business-slugs.json";
const EVENTS_URL = "data/events.json";
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
// Matches the onboarding dialog and filter-state.js. Keep the initial map interesting
// without turning it into a dense wall of pins.
const DEFAULT_FILTERS = DEFAULT_OVERVIEW_FILTER_KEYS.slice();
const COW_REFRESH_MS = 5 * 60 * 1000;
const IS_LOCAL_COW_CACHE_MODE = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const DEFAULT_COW_CENTER = { longitude: 0.06371428038973509, latitude: 51.656022523996725 };
const FEATURE_LAYERS = [
  { key: "forest", label: "Epping Forest land", url: "data/epping-forest-land.geojson" },
  { key: "buffer", label: "Buffer land", url: "data/epping-buffer-land.geojson" },
];
// Named camera-animation durations. Each replaces an exact pre-existing literal that
// was independently repeated across multiple call sites for the same transition, so
// this changes nothing about how any of them feel -- it just gives the recurring
// values one name instead of several copies. One-off durations tuned for a single
// specific transition are left as plain literals rather than forced into single-use
// names.
const NEARBY_ORIGIN_TRANSITION_MS = 520; // slide between two browse origins -- see nearbyRenderOriginPoint()
const NEARBY_REVEAL_START_FRACTION = 0.1; // share of a browse-origin slide that passes before the new pins start to appear -- see nearbyRevealOpacity()
const NEARBY_REVEAL_MS = 180; // how quickly the new nearby set fades in once a slide lands -- see nearbyRevealOpacity()
const SELECTION_MARKER_EXIT_MS = 120; // fade the outgoing marker set before the destination arrives
const SELECTION_MARKER_EXIT_STAGGER_MS = 5; // small per-marker offset so the old set leaves in a wave
const SELECTION_MARKER_EXIT_MAX_STAGGER_MS = 60; // keep a dense view's exit short and readable
const SELECTION_MARKER_REVEAL_DELAY_MS = 180; // let the old Nearby pins leave before the destination arrives
const SELECTION_MARKER_REVEAL_MS = 220; // selected destination fade-in after that handoff gap
const OVERVIEW_REFIT_ANIMATION_MS = 420; // recompute the overview/secondary-screen camera fit after a UI state change (filter change, opening Filter/Settings/Report, radius toggle, a late location fix)
const OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS = 520; // ensureOverviewTargetsVisible's (and centerOverviewOnUserLocation's) own default when a caller doesn't specify one
const HEADING_UP_NAV_ANIMATION_MS = 500; // standard duration for heading-up alignment and selection-commit transitions (goToInitialView, zoomToSelection)
const MIN_HEADING_UP_ANIMATION_MS = 200; // floor for animateToHeadingUpNavigationViewport's duration
const DEFAULT_VIEWPORT_ANIMATION_MS = 480; // generic fallback duration for the low-level viewport animators when nothing else is specified
const MIN_VIEWPORT_ANIMATION_MS = 180; // floor for moveCamera's duration
const FIRST_LOAD_REVEAL_ANIMATION_MS = 700; // the first-time "reveal the map" animation, in all its variants (fit to user+items, centered-on-user)
const FIRST_LOCATION_FLY_TO_ANIMATION_MS = 1250; // the High Beach stand-in -> real GPS handoff, with a cinematic fly-to arc
const DEFAULT_FIT_PADDING_PX = 54; // default screen-space padding for fitToPoints (around content bounds)
const OVERVIEW_FIT_PADDING_PX = 28; // tighter padding for overview targets fit
const TILT_BETA_THRESHOLD = 12;    // deg above flat before perspective kicks in
const TILT_BETA_MAX = 85;          // deg where max perspective angle is reached
const TILT_HORIZON_GROUND_RATIO = 0.62; // fraction of the space above the pivot that shows ground (vs. sky) at TILT_ROTATEX_MAX -- see tiltPerspectivePx()
const TILT_PERSPECTIVE_MIN_PX = 260;    // floor so very short/cramped viewports don't collapse the camera distance towards an unstable near-0 value
const TILT_PERSPECTIVE_MAX_PX = 2600;   // ceiling so very tall viewports (tablets) don't stretch the camera distance into an implausibly flat, barely-tilted look
const TILT_ROTATEX_MAX = 75;       // max rotateX deg — the angle the horizon and tilt fit are calibrated to (see tiltPerspectivePx)
const TILT_GENTLE_ROTATEX_MAX = 64; // visible depth while keeping the surrounding map in view
const TILT_GENTLE_BETA_MAX = 60;    // reach the default tilt at a normal viewing angle
// Precomputed once: calibrating tiltPerspectivePx() against this fixed reference
// angle (rather than the live, ever-changing tiltRotateXDeg()) keeps the camera
// distance from collapsing at low/mid tilt angles -- see tiltPerspectivePx().
const TILT_HORIZON_REFERENCE_TAN = Math.tan(TILT_ROTATEX_MAX * Math.PI / 180);
// Tilt is projected in JS (see tiltProjectOffsets), not by CSS-rotating the finished
// bitmap, so the canvas never needs to be oversized for tilt. Heading-up does not oversize
// it either: the bitmap is exactly the visible stage (see resizeCanvas), so the pivot, the
// fit and the culls all share one rect. Extra canvas below the pivot used to push the
// rotated plane through the camera at low tilt angles, which is why tilt never grew it.

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
// Android phones report a device pixel ratio of 2.6-3.5 and their WebView rasterises a 2D canvas
// on the CPU path for much of the range, so the app shell draws them at a lower budget.
const MAX_CANVAS_PIXEL_COUNT = Native.platform === "android" ? 4194304 : 9437184;
const MAX_DEVICE_PIXEL_RATIO = Native.platform === "android" ? 2 : Infinity;
// While the camera is moving the canvas is drawn at this device pixel ratio at most, and returns to
// full resolution after MOTION_STILL_MS without movement. Raster work scales with the bitmap pixel
// count, so a moving frame is the one that has to be cheap. See syncCanvasMotionResolution().
const MOTION_CANVAS_PIXEL_RATIO = 1.5;
const MOTION_STILL_MS = 350;
function cappedDevicePixelRatio() {
  return Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
}
const APP_VERSION = APP_CACHE_VERSION; // Fallback shown before state.swVersion loads from caches.keys() (see setupPwa in nav.js).
const COMPASS_PERMISSION_KEY = "forest-finds-compass-permission-v1";
// "declined" once the motion ask (showMotionPrompt) was refused, so it is not raised again on a later visit.
const MOTION_CHOICE_KEY = "ff-motion-v1";
// The person's own answer to the in-app location ask (storedLocationChoice). Up here because boot()
// reads it, and boot() runs before the rest of this file's declarations have.
const LOCATION_CHOICE_KEY = "ff-location-v1";
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
const HEADING_SOURCE_NATIVE = 3; // the app shell's true-north heading plugin (js/native.js)
// A native reading at or under this many degrees of reported uncertainty is trusted on arrival.
const NATIVE_HEADING_TRUSTED_ACCURACY_DEG = 25;
// How long a requested animation frame may stay pending before the foreground watchdog
// treats the loop that asked for it as wedged. A frame runs within ~16ms; two seconds is
// far past any plausible scheduling delay on a loaded phone.
const ANIMATION_FRAME_WEDGED_MS = 2000;
// Full 3D (the steeper perspective and pin collapse) is not offered to users. Pitch gives
// only the gentle tilt. Nothing reads or writes a stored choice any more.
const FULL_3D_ENABLED = false;
const STORED_COMPASS_PERMISSION = (() => {
  try {
    const stored = localStorage.getItem(COMPASS_PERMISSION_KEY) || "unknown";
    // iOS requires DeviceOrientationEvent.requestPermission() from a user gesture
    // each session before orientation events fire — even if previously granted.
    // Restoring "granted" would skip that per-session call, so treat it as "unknown"
    // so the next location/navigation tap can request access if no heading has arrived.
    if (stored === "granted"
        && Native.compassNeedsPrompt
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

// True from the moment a location request starts until it answers (setLocationRequestPending). Declared
// with the other state so boot can read it before the spin/arrow code below has run.
let locationRequestPending = false;

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
  // In-flight slide of cameraOriginPoint()'s own pivot across the moment it switches *basis* --
  // nearby browsing to selected navigation, or back -- see cameraOriginPoint().
  cameraOriginTransition: null,
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
  // Live events already alerted on this session -- never re-shown even if the user lingers
  // in range or walks in and out of the radius (see checkEventProximityAlert, js/nav.js).
  eventNearbyAlertedIds: new Set(),
  eventNearbyBannerEventId: null,
  // Filter keys just switched on that have nothing inside the walking radius. Secondary screens
  // may reach their nearest match once; the Nearby screen itself remains anchored to the radius.
  // See refreshOutOfRadiusReveal/outOfRadiusFitPoints.
  outOfRadiusRevealFilters: [],
  // A filter change must not make the automatic empty-ring recovery widen the user's radius to a
  // distant fallback. It is cleared once the reader has actually moved away from this origin.
  nearbyFilterChangeOrigin: null,
  overviewFilters: loadStoredOverviewFilters(),
  // Set by setOverviewFilters(persist:false) -- see its comment -- never true on first load.
  overviewFiltersEphemeral: false,
  // The rail level is normally derived from the current /nearby/<slug> path. A rail tap keeps
  // the level it was displayed at, in memory only: a reload starts the rail at its top level.
  nearbyRailGroupKey: undefined,
  overviewExpandedGroups: (() => {
    try {
      const d = JSON.parse(localStorage.getItem(FILTER_STATE_KEY) || "null");
      if (d && Array.isArray(d.expandedGroups)) return sanitizeExpandedGroups(d.expandedGroups);
    } catch {}
    return [];
  })(),
  // Kept as a compatibility state for callers that still model the old /nearby/filter route.
  // The current Map setup modal deliberately does not set it: Nearby stays active underneath.
  filterScreenOpen: false,
  // The Search screen and the text currently in its field. The query is held here rather than
  // read back off the input so re-entering Search from a result restores what was typed.
  searchScreenOpen: false,
  searchQuery: "",
  // The top SEARCH_HIGHLIGHT_LIMIT results for the current query, kept so the renderer can ring
  // them on the map and the camera can frame all of them at once (updateSearchHighlight). Reset
  // to [] wherever Search stands down (setInspectorSelectionChrome, js/inspector.js).
  searchHighlightResults: [],
  farNoticeShown: false,
  farNoticeOpen: false,
  farNoticeWaiting: false,
  // A real fix more than FAR_FROM_FOREST_METRES from the forest boundary (updateFarFromForest):
  // Nearby is centred on High Beach and no directions are offered.
  farFromForest: false,
  nearestItemsCount: 10,
  walkingDistanceMinutes: DEFAULT_WALKING_DISTANCE_MINUTES,
  walkingRadiusAtFloor: false,
  // The wheel/trackpad radius gesture's running (unrounded) value and its settle timer --
  // a wheel has no pointerup to end on, so the gesture ends on a timeout instead
  // (updateNearbyRadiusWheel/endNearbyRadiusWheel, js/nav.js).
  wheelRadiusMinutes: null,
  wheelRadiusSettleTimer: null,
  // Where the wheel gesture is heading (the radius glides there frame by frame, js/nav.js), and
  // whether the wheel asked for less than the radius floor allows (the limit notice).
  wheelRadiusTargetMinutes: null,
  wheelRadiusOvershoot: false,
  // True while a single pointer is down on the map in an anchored state (navigationAnchorActive):
  // the drag owns the camera until release, so GPS fixes, compass ticks and refits must not
  // re-anchor it underneath the finger. See alignHeadingUpNavigationViewport.
  anchoredDragHold: false,
  // The pan ({dx, dy}) the current press has applied to the viewport so far (js/nav.js).
  dragApplied: null,
  // The map-scale wheel zoom in flight (zoomAt): { target, screenPoint, world, frame, last }.
  zoomChase: null,
  // Safari's trackpad pinch (gesturestart/change/end) measures from where the gesture began,
  // like the two-finger pinch does -- see startNearbyRadiusGesture, js/nav.js.
  gestureRadiusBaseMinutes: null,
  showAllOutsideRadius: false,
  compassHeading: null,
  compassHeadingTarget: null,
  compassTargetMovedAt: 0,
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
  swActivatedElsewhere: false,
  appUpdateStatus: "idle",
  appUpdateVersion: "",
  appUpdateCheckedAt: 0,
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
  // The heading/tilt loop can run at sensor frame rate, but the camera fit is much more
  // expensive than updating the compass overlay. Keep its last solve so a fast sensor stream
  // cannot make the viewport chase every tiny heading sample.
  compassViewportAlignmentAt: null,
  compassArrowAngle: null,
  compassLastEventAt: null,
  orientationLastEventAt: null,
  // Canvas resolution while the camera moves -- see syncCanvasMotionResolution().
  canvasMotion: { sig: null, lastMotionAt: -Infinity, capped: false, scale: 1, stillTimer: null },
  canvasLogicalWidth: 0,
  canvasLogicalHeight: 0,
  // Best heading source seen so far this session -- see orientationHeadingSource().
  compassHeadingSource: HEADING_SOURCE_NONE,
  headingUpScaleEaseAt: null, // timestamp the heading-up scale ease last integrated (see resolveHeadingUpTargetScale)
  headingUpScaleEasing: false, // latch: the heading-up scale ease is mid-glide (see resolveHeadingUpTargetScale)
  headingUpAnchorFractionSmoothed: null, // the heading-up navigation anchor actually on screen, as a fraction of the focus rect's height -- see resolveHeadingUpAnchorFraction
  headingUpAnchorEaseAt: null, // timestamp the heading-up anchor ease last integrated (see resolveHeadingUpAnchorFraction)
  headingUpAnchorEasing: false, // latch: the heading-up anchor ease is mid-glide (see resolveHeadingUpAnchorFraction)
  headingUpAnchorTargetFor: null, // the selectedCompassTarget() headingUpAnchorFractionSmoothed was last resolved for
  lastLocationUpdateAt: null,
  rawUserLocation: null, // the unfiltered GPS fix; state.userLocation is the smoothed one (see ingestLocationFix)
  locationFixHistory: [], // recent raw fixes, for telling travel from wander (recordFixAndDetectFastTravel)
  locationGlide: null, // in-flight glide of the smoothed position toward the latest fix
  locationGlideFrame: null, // rAF handle for the loop that advances it (see ensureLocationGlideLoop)
  locationSmoothedAt: null, // timestamp the location low-pass last ran
  navigationHeadingUp: false,
  renderedNavigationHeading: null,
  headingUpEntryAnim: null,
  // Set true the first time heading-up actually renders a heading this session -- see
  // animateToHeadingUpNavigationViewport/prepareCanvasForDraw. That first activation is
  // never animated in from north: the map simply waits until a trusted heading exists
  // (headingUpActive() already gates on one) and then shows it, so nothing appears to
  // spin on first load. Every later (re-)activation still animates, as before.
  headingUpEverEntered: false,
  // GPS fix recorded the moment the tab was last hidden, so recoverStalledCompass can tell
  // a phone that was actually carried somewhere from one that was simply put down --
  // see hasMovedSinceBackgrounding().
  backgroundedUserLocation: null,
  tiltBetaTarget: 0,
  tiltBetaSmoothed: 0,
  // Full 3D is fixed off (see FULL_3D_ENABLED): gentle tilt is the only tilt.
  map3dEnabled: FULL_3D_ENABLED,
  // rotateX angle baked into the main canvas by the last draw() -- see tiltRenderStale().
  renderedTiltRotateXDeg: 0,
  tiltWasActive: false,
  // One owner for the selection-driven camera hold: the viewport move a selection has queued but not
  // yet started (viewportPending), and whether the Nearby map is held hidden until that move lands (mapHeld).
  selectionTransition: {
    viewportPending: false,
    mapHeld: false,
    startedAt: null,
    outgoingIconLookup: null,
  },
  inspectorMinimizeTransitionPending: false,
  selectionMapTransitionToken: null,
  viewportAnimationFrame: null,
  viewportAnimationFrom: null,
  viewportAnimationTo: null,
  locationRevealAnimationActive: false,
  // Canvas-pixel focus used to hold the walking-radius ring in place while the cinematic
  // High Beach -> real-location handoff is still moving the camera. The live GPS point is
  // already the destination during that tween, so projecting it against the in-flight camera
  // would make the ring jump away from the map's focus until the animation landed.
  locationRevealFocusPoint: null,
  inspectorDragging: false,
  inspectorDragStart: null,
  inspectorHeightPercent: null,
  viewportAnimationStartTime: null,
  viewportAnimationDuration: 0,
  emojiScaleAnimated: null,
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
  // The radius in effect just before a cluster tap grew it to cover the group's own members
  // (focusNearbyOnClusterGroup) -- restored by exitClusterExpansion (js/nav.js) wherever
  // clusterExpanded is cleared, so leaving that exact-membership view leaves its radius behind
  // too, rather than permanently shrinking (or growing) the ring to whatever the last tapped
  // group needed.
  preClusterWalkingDistanceMinutes: null,
  transportLookupCache: new Map(),
  transportLookupRequests: new Map(),
  dataLoaded: false,
  // Always 0 now that the bitmap is exactly the visible stage (see resizeCanvas). Kept because the
  // e2e helpers convert canvas to client coordinates through them.
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
// See flatProjectionFrame. Declared up here, not beside it: boot() runs before the script reaches the
// bottom of this file, and a `let` that late would still be in its temporal dead zone.
let _flatProjectionFrame = null;
let _flatProjectionEpoch = 0;
// Per-frame freeze of the interpolated browse origin -- see computeNearbyRenderOriginPoint().
// Keyed on the anchor object it was computed for, so any reassignment of state.nearbyAnchor
// invalidates it without the assigning code having to remember to (focusNearbyOnMapPoint's
// exit-a-selection path sets the anchor directly, and a frame-old cached origin there framed
// the camera on the spot the user had just left).
let _nearbyRenderOriginCache = undefined;
let _nearbyRenderOriginCacheAnchor = null;

// "near=<lat>,<lon>" -- state.nearbyAnchor's own hash route, so a tapped browse point
// (focusNearbyOnMapPoint, js/nav.js) is shareable like any real selection instead of living only
// in history.state (nearbyAnchorSnapshot above, which back/forward within one session already
// covered on its own). Kept out of SELECTION_ROUTES below: every entry there resolves to a real
// state.selected item, where this never does -- "browse around here", not "look at this one
// thing" -- so it gets its own narrower value/parse pair rather than a find/show pair.
// Every selectable thing, with the URL parameter that names it, the key it is written as and
// how it is resolved and shown again. Trees and places were the only two with a URL before
// the router; the rest are here so that a screen change can never leave the URL describing a
// screen the user is no longer on.
const SELECTION_ROUTES = [
  {
    type: "tree",
    param: "tree",
    toKey: (item) => treeHashKey(item),
    find: (key) => findTreeByHashKey(key),
    show: (item) => showTreeDetails(item, distanceFromUser(item), "Tree link"),
  },
  {
    type: "landmark",
    param: "place",
    toKey: (item) => placeHashKey(item),
    find: (key) => findPlaceByHashKey(key),
    show: (item) => showLandmarkDetails(item, distanceFromUser(item)),
  },
  {
    type: "addedtree",
    param: "addedtree",
    toKey: (item) => item.tag,
    find: (key) => communityFindAddedTree(key),
    show: (item) => showAddedTreeDetails(item),
  },
  {
    type: "cow",
    param: "cow",
    toKey: (item) => cowKey(item),
    find: (key) => findCowByKey(key),
    show: (item) => showCowDetails(item, distanceFromUser(item)),
  },
  {
    type: "path",
    param: "path",
    toKey: (item) => pathHashKey(item),
    find: (key) => findPathByHashKey(key),
    show: (item) => showPathDetails(item, distanceFromUserToPath(item)),
  },
  {
    type: "water",
    param: "water",
    toKey: (item) => waterHashKey(item),
    find: (key) => findWaterByHashKey(key),
    show: (item) => showWaterDetails(item, distanceFromUser(item)),
  },
  {
    type: "environment",
    param: "area",
    toKey: (item) => environmentHashKey(item),
    find: (key) => findEnvironmentByHashKey(key),
    show: (item) => showEnvironmentDetails(item),
  },
  {
    type: "road",
    param: "road",
    toKey: (item) => roadHashKey(item),
    find: (key) => findRoadByHashKey(key),
    show: (item) => showRoadDetails(item, distanceFromUserToRoad(item)),
  },
  {
    type: "railway",
    param: "railway",
    toKey: (item) => railwayHashKey(item),
    find: (key) => findRailwayByHashKey(key),
    show: (item) => showRailwayDetails(item),
  },
];

// Screen changes made while one of these is set are the URL's own doing, not the user's, so
// they must not write a history entry: routeApplyDepth covers applyRoute(), routerBooting
// covers the boot sequence, which puts the app on the screen the launch URL asked for.
let routeApplyDepth = 0;
let routerBooting = true;
// /find/<slug>/ landings start with a server-rendered place panel, but unlike /nearby/<slug>/
// landings they do not use _serverRenderedNearbyList. Keep their initial selection pending so
// incremental data arrivals cannot paint Nearby over the requested place before it is resolved.
let findLandingSelectionPending = false;

// A first, "cold" enableHighAccuracy fix routinely takes longer than a few seconds,
// and tree canopy -- this app's whole subject -- slows GPS lock further still. A
// short request timeout here does not fail safe: getCurrentPosition's error
// callback looks identical whether the user denied permission or simply hadn't
// gotten a fix yet by the deadline, so a too-short bound reliably shows someone
// whose location *is* available the same High Beach stand-in and "Get a more
// custom experience" invite (revealNoRealLocation) a denial would -- on every
// visit, not a one-off flake. 20s gives a cold outdoor fix room to land before
// treating it as a failure. Declared above boot() -- not just above its first use
// below -- since boot() is called synchronously a few lines down, and a const
// declared later in the script is still in its temporal dead zone at that point.
const BOOT_GEOLOCATION_TIMEOUT_MS = 20000;

// The Geolocation API's own `timeout` option does not start counting until the
// permission decision has been made. A prompt left unanswered on the screen, or an
// OS location service that stalls, therefore means getCurrentPosition never calls
// back at all -- neither the success nor the error handler. Boot awaits that
// request before revealing the map, so without a bound of our own the map sits
// behind the loading screen for ever.
//
// Falling back to { ok: false } takes the same path a genuine failure takes: the
// map opens uncentred and the location gate offers a retry. The bound sits just
// above BOOT_GEOLOCATION_TIMEOUT_MS, so it only ever bites when the browser is not
// honouring that timeout -- someone who has already granted location is answered
// long before this fires.
const BOOT_LOCATION_TIMEOUT_MS = BOOT_GEOLOCATION_TIMEOUT_MS + 2000;

boot();

// Snaps the camera onto the walking-radius circle around state.userLocation, pauses on it, then
// animates to the final framing -- shared by boot's real-fix success path and, via
// applyDefaultLocation(), its no-real-fix one (revealNoRealLocation below), so both get the same
// polished reveal rather than one of them settling for a plain zoom pulse.
async function revealMapCenteredOnUser() {
  // A /find/ landing's place is selected by applySelectionFromHash below, so the Nearby list is not
  // painted over the server-rendered panel first.
  if (!findLandingSlug() && !communityScreenOpen()) selectOverview();
  draw();

  // Snap the camera onto the walking-radius circle before the reveal animation -- the same
  // thing the Nearby view frames once it is live (see nearbyCameraFitPoints), so the reveal
  // eases from a slightly wider version of the final view rather than starting on a tight fit
  // of whichever items happened to be nearest and then pulling back out to the circle.
  {
    const focusRect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
    const startFrame = bottomEdgeRadiusFrame(focusRect, 0.82);
    const origin = nearbyOrigin();
    if (startFrame && origin) {
      stopViewportAnimation();
      state.viewport.scale = startFrame.scale;
      state.viewport.tx = startFrame.centreX - origin.point.x * startFrame.scale;
      state.viewport.ty = startFrame.centreY - origin.point.y * startFrame.scale;
    } else {
      const targetScale = maxScaleForRadiusVisible(focusRect);
      centerOverviewOnUserLocation({ scale: targetScale * 0.82, focusVisibleArea: true });
    }
  }
  draw();

  // Brief pause so the user sees the completed step list.
  await new Promise((resolve) => setTimeout(resolve, 320));

  // Apply the launch URL's own screen after the wait so it overrides the overview snap. A /find/
  // landing the loader has already selected keeps its panel rather than re-rendering the same one.
  if ((!findLandingSlug() || !state.selected) && !communityScreenOpen()) applySelectionFromHash();

  // Fade overlay and animate camera to final position simultaneously.
  // Use fresh points (not stale pre-wait revealPoints) to avoid animating back
  // to a wider viewport if a GPS update arrived during the 320 ms wait.
  if (state.selected) {
    ensureUserAndSelectionVisible({ animate: true, force: true, durationMs: FIRST_LOAD_REVEAL_ANIMATION_MS });
  } else {
    ensureOverviewTargetsVisible({ animate: true, durationMs: FIRST_LOAD_REVEAL_ANIMATION_MS });
  }
  // Fades away the pre-reveal veil over the canvas (css/base.css, .map-stage::after) in the
  // same beat as the inspector's own entrance and the camera's animated pan/zoom above, so the
  // whole first reveal reads as one choreographed moment rather than three separate things
  // happening to independently finish loading.
  els.mapStage?.classList.add("map-revealed");
  // The reveal is over, so from here on the list is ordinary live content again -- except bare
  // /nearby's static list, which stays as drawn until a real fix (serverRenderedNearbyListStillValid).
  // The loading strip stays visible while the remaining datasets arrive; boot hides it once the
  // background promise has settled, so the user can see that locations and map layers are still
  // being added without blocking the map they are already using.
  _serverRenderedNearbyList = (isNearbyCategoryLandingPath() || _staticNearbyIndex)
    && serverRenderedNearbyListStillValid();
}


// ?nuke=true clears exactly what Settings' "Refresh both" clears, then returns to the same URL
// without the flag. The flag is stripped before refreshCachedState reloads the page: otherwise the
// reload would land back on ?nuke=true and wipe everything again, forever. Online, boot must pause
// while the clear is in flight or the normal route setup can rewrite the URL before reload. Offline
// there is nothing to clear, so the flag is simply dropped and boot carries on as normal.
function nukeIfRequested() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("nuke") !== "true") return false;

  // A stale service worker can serve this app shell before the current app code is available.
  // Hand the request to the uncached recovery page so it can unregister that worker and delete
  // its caches before returning to the requested route.
  const recovery = new URL("/nuke.html", window.location.origin);
  recovery.search = url.search;
  recovery.hash = url.hash;
  window.location.replace(recovery.href);
  return true;
}

async function boot() {
  if (nukeIfRequested()) return;
  floatConsentPrompts();

  // A /nearby/<slug>/ landing already shows its server-rendered list (see
  // _serverRenderedNearbyList, js/inspector.js); keep it there until a real fix or the reveal.
  _staticNearbyIndex = Boolean(document.querySelector("[data-server-rendered-nearby]"));
  _serverRenderedNearbyList = isNearbyCategoryLandingPath() || (_staticNearbyIndex && staticNearbyIndexFiltersAreDefault());
  findLandingSelectionPending = Boolean(findLandingSlug());
  initSelectedIconMotion();
  initRouter();
  // Keep the launch route available while the first GPS fix is arriving. applyLocationFix()
  // normally clears a live selection because locating from an already-open detail view returns
  // to Nearby, but a deep link must keep naming the screen the reader opened.
  const bootRoute = routeValueFromLocation();
  initTracker();
  setupPwa();
  setupBackgroundDataSync();
  setupUiZoomLock();
  setupInteractions();
  resizeCanvas();
  draw();
  // The first draw may only contain the fallback/loading canvas, but it is still useful map
  // surface and must not sit behind the pre-reveal veil while network requests are in flight.
  // Actual layers and the final camera fit are added incrementally below.
  els.mapStage?.classList.add("map-revealed");

  // Keep loading non-blocking in every context, including installed/native launches. The map
  // shell and its fallback viewport must be visible while the first network responses arrive;
  // a full-screen splash here made a cold launch appear stuck until a refresh populated caches.
  if (els.loadingOverlay) {
    els.loadingOverlay.classList.add("inline");
    els.loadingOverlay.hidden = false;
  }

  // The banner starts hidden in app.html and in the generated business pages; the generated Nearby
  // pages show it pre-JS so a no-JS visitor sees the ask too. Only this boot decides whether it stays:
  // hidden at once when the answer is known now, otherwise once the permission state has answered
  // (a millisecond or two), so a returning visitor never sees it flash on and off.
  // Bare /nearby's static index shows the same banner pre-JS (renderNearbyIndexPage), so it takes the
  // landing-page path here too. First visits use the same card and offer onboarding from its slot.
  // The inline setup hint belongs to the plain Nearby screen, where the persistent Map setup
  // control is present. Category/business landings, selected locations, and secondary screens may
  // still show their own permission card, but must not suggest a control that is hidden there.
  const onboardsFirst = !hasCompletedOnboarding()
    && routeValueFromLocation() === ""
    && !isLandingPageArrival();
  const asksFromBanner = onboardsFirst || isLandingPageArrival() || _staticNearbyIndex;
  const locationChoice = storedLocationChoice();
  const permissionPromise = Native.geolocation ? Native.locationPermissionState() : Promise.resolve("unsupported");
  if (els.consentBanner && (!asksFromBanner || (!onboardsFirst && locationChoice !== null && analyticsChoice() !== "undecided"))) {
    els.consentBanner.hidden = true;
  }

  // A cold load of /community paints the Community screen straight away: it needs no map data,
  // and the Nearby list would otherwise show first and be swapped out once data and location land.
  if (routeValueFromLocation() === ROUTE_COMMUNITY) {
    // boot() is called mid-script: wait one microtask so the declarations below it (the document
    // title constants openCommunity() uses) have initialised before the screen is built.
    await Promise.resolve();
    // Not yet told whether Community is on for this person: ask, briefly, rather than flash the wrong screen.
    if (!communityFeaturesKnown()) await Promise.race([communityRefreshFeatures(), new Promise((resolve) => setTimeout(resolve, 2500))]);
    try { openCommunityOrFeedback(); } catch (error) { console.error(error); }
  }
  applyFeatureGates();
  communityRefreshFeatures();

  // Start data loading immediately so it runs in parallel with location and onboarding
  const hasCachedCowData = applyCachedCowData();
  setLoadStep("cows", "loading");
  const cowPromise = IS_LOCAL_COW_CACHE_MODE && hasCachedCowData
    ? Promise.resolve(true)
    : refreshCowData({ force: true, timeoutMs: 7000 });
  const mapPromise = loadMapData();

  // Runs in parallel with data loading so the map can open centred on the user -- but only ever
  // without a cold system prompt (bootMayRequestLocation): otherwise the app asks in its own words.
  let locationPromise = null;
  // Set once an interactive prompt -- showConsentBanner()'s location stage, or a previous choice --
  // asked this boot, win or lose, so
  // revealNoRealLocation() below knows not to draw a second prompt for the same question.
  let locationAlreadyAsked = false;
  // The permission is refused below the app (browser site settings, or the OS): the invite then
  // explains where to change it instead of offering a button that could not work.
  let locationBlocked = false;

  const permission = await permissionPromise;
  const locationUnasked = Boolean(Native.geolocation) && locationChoice === null
    && permission !== "granted" && permission !== "denied";
  const analyticsUnasked = analyticsChoice() === "undecided";
  if (locationUnasked || analyticsUnasked || onboardsFirst) {
    // Every unanswered question is asked in the one non-blocking card, which floats over the map so the map is
    // usable immediately. A first visit moves from the permission card to the guided setup in
    // this same slot; the dialog opens only after the reader explicitly chooses it.
    showConsentBanner({
      askLocation: locationUnasked,
      askAnalytics: analyticsUnasked,
      offerOnboarding: onboardsFirst,
    });
  } else if (els.consentBanner) {
    els.consentBanner.hidden = true;
  }
  if (locationUnasked) {
    locationAlreadyAsked = true;
  } else if (Native.geolocation && bootMayRequestLocation(permission, locationChoice)) {
    setLoadStep("location", "loading");
    setLocationRequestPending(true);
    locationPromise = new Promise((resolve) => {
      Native.geolocation.getCurrentPosition(
        (pos) => {
          setLocationRequestPending(false);
          resolve({ ok: true, position: pos });
        },
        (error) => {
          setLocationRequestPending(false);
          resolve({ ok: false, code: error && error.code });
        },
        // maximumAge 0: a position the browser cached before this page opened can be tens of metres
        // behind the device. Boot would land it raw (it is far from the High Beach stand-in) and the
        // first live fix would then snap the You marker back, so boot asks for a live fix instead.
        { enableHighAccuracy: true, timeout: BOOT_GEOLOCATION_TIMEOUT_MS, maximumAge: 0 }
      );
    });
  } else if (locationChoice === "declined") {
    locationAlreadyAsked = true;
  } else if (permission === "denied") {
    locationBlocked = true;
  }
  // No request started: nothing to await, so this falls straight through to
  // revealNoRealLocation() below (locationPromise stays null), which offers the invite if one is due.

  try {
    const mapData = await mapPromise;
    // A tree deep link cannot be resolved until its register has arrived. Other screens,
    // including places and Filters, intentionally become usable while tree chunks continue
    // downloading in the background.
    if (new URLSearchParams(window.location.hash.replace(/^#/, "")).has("tree")) {
      await mapData.treePromise;
    }
    // Water features arrive with the environment layer. A water deep link is the one filtered
    // landing that cannot be applied against the initial interactive map state, so wait for just
    // that dataset while leaving ordinary category pages map-first and non-blocking.
    if (new URLSearchParams(window.location.hash.replace(/^#/, "")).has("water")) {
      await mapData.environmentPromise;
    }
    // Named places and railway features arrive with the same environment dataset. Wait for it
    // before the first reveal as well, otherwise the initial route lookup treats a valid #area
    // link as stale and clears it before the layer has arrived.
    if (new URLSearchParams(window.location.hash.replace(/^#/, "")).has("area")
      || new URLSearchParams(window.location.hash.replace(/^#/, "")).has("railway")) {
      await mapData.environmentPromise;
    }
    // Paths and roads have their own asynchronous layers, so preserve their deep links until the
    // corresponding feature register is available rather than letting the early route pass fall
    // back to Nearby and erase a valid link.
    if (new URLSearchParams(window.location.hash.replace(/^#/, "")).has("path")) {
      await mapData.pathsPromise;
    }
    if (new URLSearchParams(window.location.hash.replace(/^#/, "")).has("road")) {
      await mapData.roadsPromise;
    }
    // A place deep link is resolved from the landmarks plus business metadata. Wait for just
    // those sources before the first interactive reveal, otherwise their incremental updates
    // briefly call selectOverview() and replace the requested detail panel.
    if (new URLSearchParams(window.location.hash.replace(/^#/, "")).has("place")) {
      await mapData.placesPromise;
    }
    // Likewise a walker-added tree link needs the community overlay it is looked up in.
    if (new URLSearchParams(window.location.hash.replace(/^#/, "")).has("addedtree") && typeof communityEnsureOverlay === "function") {
      await communityEnsureOverlay();
    }

    state.bounds = calculateBounds();
    fitToBounds();
    state.dataLoaded = true;
    // The map must not wait for a first-run location prompt or a GPS timeout. Those are useful
    // for centring the later reveal, but the forest outline is already drawable now and should
    // be visible immediately on a cold load as well as on a refresh.
    els.mapStage?.classList.add("map-revealed");
    requestDraw();
    // Once the first useful map data is available, turn even the installed-app splash into the
    // same non-blocking progress strip used by browser tabs. The map and the requested category
    // can now be used while roads, water, trees and the other locations continue in the background.
    if (els.loadingOverlay) {
      els.loadingOverlay.classList.add("inline");
      els.loadingOverlay.classList.remove("fading-out");
      els.loadingOverlay.hidden = false;
    }

    const cowBootstrapPromise = Promise.resolve(cowPromise)
      .then((cowBootstrapOk) => {
        setLoadStep("cows", cowBootstrapOk || state.cows.length > 0 ? "done" : "error", state.cows.length);
        scheduleCowRefresh();
        requestDraw();
        return cowBootstrapOk;
      })
      .catch(() => {
        setLoadStep("cows", state.cows.length > 0 ? "done" : "error", state.cows.length);
        scheduleCowRefresh();
        requestDraw();
        return false;
      });
    // This is independent of the GPS request below: the map's progress strip should disappear
    // when map datasets and cattle are ready, even if a permission prompt or cold GPS fix is
    // still pending while the camera is sitting at the High Beach fallback.
    Promise.all([mapData.backgroundPromise, cowBootstrapPromise])
      .then(() => hideWithFade(els.loadingOverlay))
      .catch(() => hideWithFade(els.loadingOverlay));
    // render:false -- state.userLocation isn't set yet (the location/default-location branch
    // below hasn't run), so selectOverview() would render the no-location dataset-order list and
    // get thrown away the instant revealMapCenteredOnUser()/revealNoRealLocation() render the
    // real one moments later. See setOverviewFilters' own comment.
    applyShowFilterFromQuery({ render: false });
    applySearchQueryFromQuery();
    applyRadiusFromQuery();

    if (locationPromise) {
      // Give the map a useful origin immediately while the browser is still asking for GPS. The
      // first reveal deliberately uses High Beach (the same fallback as a denied request), then
      // the real fix animates the already-visible camera across to the user below. Starting this
      // before awaiting the location promise is what keeps an unanswered permission prompt from
      // turning the whole first render into a loading screen.
      const fallbackRevealPromise = revealNoRealLocation({
        locationAlreadyAsked,
        deferLocationInvite: true,
      });
      // Await the location request that was started in parallel with data loading, but never
      // unconditionally -- see withBootLocationTimeout. The fallback reveal is allowed to finish
      // first so a quick fix still transitions from the same stable High Beach starting view.
      const locResult = await withBootLocationTimeout(locationPromise);
      await fallbackRevealPromise;

      if (locResult.ok) {
        const { latitude, longitude } = applyLocationFix(locResult.position);
        if (bootRoute && routeValueFromLocation() === bootRoute && !state.selected) {
          applyRoute(bootRoute, false);
        }
        setLoadStep("location", "done");
        updateFarFromForest(latitude, longitude);
        ensureLocationWatch();

        // Request compass only if not already handled (e.g. by onboarding).
        if (state.compassPermission === "unknown" && !compassPermissionCanBeRequested()) {
          requestCompassPermissionIfNeeded({ fromGesture: false });
        }
        // iOS only allows the motion prompt from a tap. A returning visitor whose location was already
        // allowed never sees the first card's tap, so the same card offers the one tap that enables 3D.
        if (compassPermissionCanBeRequested() && state.compassPermission !== "granted") showMotionPrompt();

        // The map is already visible at High Beach. Fly to the real origin on a longer, gently
        // zoomed-out arc so the camera has time to establish the journey instead of jolting
        // through a one-pass fit from the stand-in to the GPS position.
        // The fallback reveal may still have its short camera ease in flight: revealMapCenteredOnUser
        // deliberately starts it without awaiting the animation so the progress strip and the
        // map can appear together. Retargeting an existing tween is blocked by the navigation-fit
        // guard, which otherwise leaves the camera at the High Beach framing even though the GPS
        // fix and the location dot have moved. The fallback view is already painted, so it is safe
        // to hand the camera to the real-location fly-to now.
        stopViewportAnimation();
        // The Community screen has no map target for the selection fit, so it takes the overview fit,
        // which frames the user's own marks when they are away from the forest.
        if (state.selected && !communityScreenOpen()) {
          ensureUserAndSelectionVisible({
            animate: true,
            cinematic: true,
            force: true,
            durationMs: FIRST_LOCATION_FLY_TO_ANIMATION_MS,
          });
        } else {
          ensureOverviewTargetsVisible({
            animate: true,
            cinematic: true,
            force: true,
            durationMs: FIRST_LOCATION_FLY_TO_ANIMATION_MS,
          });
        }
        requestDraw();
      } else if (locResult.code === 1) {
        // The system dialog was just refused: that is this person's answer, so it is remembered
        // and not followed by an in-app card asking the same thing again.
        setLoadStep("location", "error");
        rememberLocationChoice("declined");
      } else {
        // Timed out or no fix. The fallback reveal already happened, so only mark the step and
        // offer the non-blocking invite as a retry.
        setLoadStep("location", "error");
        if (!locationAlreadyAsked) offerLocationInvite();
      }
    } else {
      // No geolocation support, nothing to request without a cold prompt, a first-time user
      // skipped the card, or the landing-page card is asking (locationAlreadyAsked).
      setStatus("Offline map data loaded.");
      // The strip's location step settles the same way a refused request settles it, unless a
      // tap on the landing card has already started a request of its own.
      if (!locationRequestPending && !hasRealLocation()) setLoadStep("location", "error");
      await revealNoRealLocation({ locationAlreadyAsked, locationBlocked });
    }
    showFilterHintIfFirstVisit();

    // Everything above was served from the service worker's caches on a return visit, which
    // is what makes the reload instant — but also means nothing here ever noticed newer data
    // upstream. Now that the map is interactive, ask the worker to revalidate its cached
    // datasets in the background (syncData in sw.js); anything that actually changed is
    // picked up on the next load, and Settings says so.
    requestBackgroundDataSync();
    // The native app's counterpart: changed datasets are fetched from the website for the next launch.
    if (Native.data) Native.data.checkForUpdates();
  } catch (error) {
    console.error(error);
    hideWithFade(els.loadingOverlay);
    if (els.inspectorBody) {
      els.inspectorBody.innerHTML = `<p class="empty">Could not fully load map data. Try a hard refresh. If running locally, make sure the server is started from this folder.</p>`;
    }
    setStatus("Could not load local map data. Start a local server from this folder and refresh.");
  } finally {
    // Boot is over: from here a screen change is the user navigating, and writes a history
    // entry. Until now every one of them was the launch URL being honoured (see
    // routerBooting), which must not bury the entry the user arrived on.
    routerBootFinished();
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
//   - the once-a-second delivery, which would make even a perfectly filtered position
//     arrive as a step.
//
// One mechanism answers both: advanceLocationGlide() eases the position toward the newest
// raw fix every frame, with a time constant taken from that fix's reported accuracy. While
// fixes keep arriving each new one moves the target before the last has been reached, so
// the wander averages out; when they stop, it converges on the fix rather than resting
// short of it. Filtering per fix instead would only have made the steps smaller, and would
// have left the position permanently behind the last thing the device told us.
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
// genuine teleport should land at once rather than crawl there over seconds. This is the floor
// for a good fix; a fix is only as sure as its reported accuracy, so walkingSnapMetres() scales
// the threshold up for a poor one (see there).
const LOCATION_SMOOTHING_SNAP_METRES = 30;
// A fix can be out by roughly its reported accuracy, and the wander across a few fixes is of
// that order: a 20-30m fix routinely lands 30m or more from where the walker stands. A step is
// only a real move once it is this many times the fix's accuracy, and never beyond the cap.
const LOCATION_SNAP_ACCURACY_MULTIPLE = 4;
const LOCATION_SNAP_MAX_METRES = 150;
// The accuracy scaling is for wander between consecutive fixes. A fix that comes after a longer gap
// (a tunnel, a dead signal) is the first fix back and keeps the plain LOCATION_SMOOTHING_SNAP_METRES.
const LOCATION_WANDER_GAP_MS = 3000;
// Smoothing is for walking-pace wander. Travelling faster than this -- a bike, a bus, a train --
// the wander is nothing against the motion, and easing toward each fix trails the real position
// by speed x time constant. So above it the position is carried between fixes along the track
// the recent fixes describe instead (see ingestLocationFix), which keeps it moving every frame
// rather than stepping once a second.
const LOCATION_FAST_TRAVEL_MPS = 5;
// Consecutive fixes cannot tell travel from wander (two fixes 12m apart a second apart is
// ordinary wander under trees), so without the device's own speed reading the speed is judged
// over at least this long, where the wander averages out and real travel does not.
const LOCATION_SPEED_BASELINE_MIN_MS = 8000;
const LOCATION_SPEED_HISTORY_MS = 15000;
// Travel is carried between fixes, not stepped to (see ingestLocationFix). The track is a
// straight line fitted through the fixes of the last LOCATION_TRACK_WINDOW_MS: GPS wander is
// independent from fix to fix, so across a window it averages out, where any two fixes (a
// chord) carry their own noise into the direction and speed of travel.
const LOCATION_TRACK_WINDOW_MS = 15000;
const LOCATION_TRACK_MIN_SPAN_MS = 3000;
// How far past its last fix the travelling position is carried along the track. With no new
// fix after this (a tunnel, a dead signal) it stops, rather than running on down the track.
const LOCATION_DRIFT_MAX_MS = 2000;
// Walking-pace snapping is tuned for wander, and a train covers 15-30m between one fix and the
// next. A travelling gap this long means fixes were lost, so the position lands on the new fix.
const LOCATION_FAST_SNAP_METRES = 150;
// How close counts as arrived, in projected units -- comfortably sub-metre, so the ease
// lands on the fix rather than crawling at it forever.
const LOCATION_GLIDE_EPSILON = 1e-7;

function applyLocationFix(position, { preserveSelection = false } = {}) {
  const { latitude, longitude, accuracy, speed } = position.coords;
  const previousPoint = state.userLocation && state.userLocation.point;
  state.userLocation = ingestLocationFix(latitude, longitude, accuracy, performance.now(), speed);
  const point = state.userLocation.point;
  state.userInMapArea = pointInsideBounds(point, state.bounds);
  const nearestTrees = nearestTreesTo(latitude, longitude, state.nearestItemsCount);
  state.nearestTree = nearestTrees.length > 0 ? nearestTrees[0] : null;
  state.nearestCow = nearestCowTo(latitude, longitude);
  state.nearestPub = nearestPlaceByFilter(latitude, longitude, (place) => isPubCategory(place));
  state.nearestRestaurant = nearestPlaceByFilter(latitude, longitude, (place) => isRestaurantCategory(place));
  state.nearestLandmark = nearestPlaceByFilter(latitude, longitude, (place) => !isPubCategory(place) && !isRestaurantCategory(place) && !isCafeCategory(place) && !isShopCategory(place) && !isTransportCategory(place));
  state.nearestPlace = nearestPlacesTo(latitude, longitude, 1)[0] || null;
  if (typeof adventureMaybeShow === "function") window.setTimeout(adventureMaybeShow, 250);
  // A cold load of /community has already opened its screen (boot); a fix must not wipe it. Nor
  // must Settings or Feedback: their own location actions answer in place, on the screen that
  // asked.
  // A selected destination can also opt in to staying open while a real fix replaces the
  // High Beach stand-in, so the route can be drawn from the newly shared position.
  if (!preserveSelection && !communityScreenOpen()
      && !["settings", "report"].includes(state.selected?.type)) state.selected = null;
  if (typeof communityNudgeCheck === "function") setTimeout(communityNudgeCheck, 0);
  return { latitude, longitude, previousPoint };
}

// Stands in for a real fix (see revealNoRealLocation) by running DEFAULT_LOCATION through the
// exact same pipeline applyLocationFix uses -- nearest-tree/cow/pub/etc, state.userInMapArea --
// so the Nearby list, distances and walking-radius ring all work immediately. isDefault is the
// one thing that pipeline never sets on its own, and is what hasRealLocation() (js/nav.js) reads
// to tell this apart from an actual GPS fix.
function applyDefaultLocation() {
  applyLocationFix({ coords: { latitude: DEFAULT_LOCATION.latitude, longitude: DEFAULT_LOCATION.longitude, accuracy: null } });
  state.userLocation.isDefault = true;
  if (state.walkingDistanceMinutes === DEFAULT_WALKING_DISTANCE_MINUTES) {
    state.walkingDistanceMinutes = DEFAULT_LOCATION_WALKING_DISTANCE_MINUTES;
  }
}


// Companion to allEntriesForActiveFilters' no-location list in overviewNearestHtml: without an
// origin, boot's default framing (fitToBounds, called earlier) is the whole forest boundary --
// correct in general, but not "zoomed out to this category" for a /nearby/<slug> page or a
// deliberate single-filter choice. Fits the camera to every matching pin instead, so the map
// actually shows the category (or categories) rather than an origin-less default. Returns
// false (doing nothing) when activeFiltersShowFullListWithoutLocation() says this isn't one of
// those cases, nothing matches, or a specific item is already selected (e.g. from a deep-link
// hash) whose own framing should not be overridden.
function fitMapToSingleFilterIfNoLocation(options = {}) {
  if (state.userLocation || state.selected || !activeFiltersShowFullListWithoutLocation()) return false;
  const points = allEntriesForActiveFilters()
    .filter((entry) => Number.isFinite(entry.item.latitude) && Number.isFinite(entry.item.longitude))
    .map((entry) => projectLonLat(entry.item.longitude, entry.item.latitude));
  if (!points.length) return false;
  fitToPoints(points, false, options);
  return true;
}

function withBootLocationTimeout(locationPromise) {
  return Promise.race([
    locationPromise,
    new Promise((resolve) => setTimeout(() => resolve({ ok: false }), BOOT_LOCATION_TIMEOUT_MS)),
  ]);
}

function locateUser({ initial, preserveSelection = false }) {
  if (!Native.geolocation) {
    setStatus("This browser does not support location access.");
    return;
  }

  // An interactive location invite can be accepted while a reader is looking at a find. Keep
  // that detail open while the first fix is being obtained; applyLocationFix() normally clears a
  // live selection because locating from a detail view historically meant returning to Nearby.
  // The permission prompt is an enhancement to the current view, not navigation away from it.
  const selectionToPreserve = preserveSelection && state.selected && state.selected.item
    ? state.selected
    : null;

  // A request that can change an empty Nearby list, or a landing's own list, shows a loading state in
  // its place rather than leaving the list blank or unchanged until the fix arrives. A list already
  // full of finds stays put. A refusal below restores the list.
  const landingRequest = !initial && isNearbyCategoryLandingPath() && isOverviewScreenActive();
  const listIsEmpty = isOverviewScreenActive() && !els.inspectorBody?.querySelector(".nearest-item");
  const showsLoadingState = landingRequest || listIsEmpty;
  if (showsLoadingState) showNearbyLocatingState();
  setStatus(initial ? "Finding your location..." : "Getting your location...");
  // iOS only runs the compass prompt from a real tap, and the geolocation callback is not one, so ask
  // from this tap before the fix arrives. Non-iOS needs no gesture and is handled in the callback.
  if (!initial && compassPermissionCanBeRequested()) requestCompassPermissionIfNeeded({ fromGesture: true });
  setLocationRequestPending(true);
  Native.geolocation.getCurrentPosition(
    (position) => {
      setLocationRequestPending(false);
      const shouldPreserveSelection = selectionToPreserve && state.selected === selectionToPreserve;
      const { latitude, longitude, previousPoint } = applyLocationFix(position, {
        preserveSelection: Boolean(shouldPreserveSelection),
      });
      ensureLocationWatch();
      setLoadStep("location", "done");
      syncSettingsLocationRow();
      if (!compassPermissionCanBeRequested()) {
        // Non-iOS: no user gesture required; auto-grant if not already set.
        requestCompassPermissionIfNeeded({ fromGesture: false });
      }

      updateFarFromForest(latitude, longitude);

      if (isOverviewScreenActive()) selectOverview();
      else if (shouldPreserveSelection) updateSelectedDetailFields();
      if (!previousPoint) {
        setInspectorMinimized(false);
        if (shouldPreserveSelection) {
          ensureUserAndSelectionVisible({ animate: true, force: true, assumeInspectorOpen: true, durationMs: 1000 });
        } else {
          ensureOverviewTargetsVisible({ animate: true, durationMs: 1000 });
        }
      } else {
        if (shouldPreserveSelection) {
          ensureUserAndSelectionVisible({ animate: true, force: true, assumeInspectorOpen: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
        } else {
          ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
          keepOverviewCenteredOnUser(previousPoint);
        }
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
      setLocationRequestPending(false);
      // Back to the same default boot() uses when there is no fix: the High Beach list the landing
      // showed before the request, rebuilt now that the loading state has replaced it.
      if (showsLoadingState && !hasRealLocation()) {
        if (landingRequest) applyDefaultLocation();
        selectOverview();
      }
      const denied = error && error.code === 1;
      // Refused at the system dialog: remembered, so nothing asks again unprompted.
      if (denied) rememberLocationChoice("declined");
      syncSettingsLocationRow();
      setStatus(initial
        ? (denied
          ? "Location access was denied. You can allow it in your browser settings."
          : "Location was not available yet.")
        : error.message || "Location access was not available.");
      if (!initial) explainRefusedLocationRequest({ denied });
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

// Metres from the forest boundary, or null while the outline has not loaded.
function distanceToForestMetres(latitude, longitude) {
  const forestLayer = state.layers.find(layer => layer.key === "forest");
  if (!forestLayer || !forestLayer.data || !forestLayer.data.features) return null;
  return getMinDistanceToForest(latitude, longitude, forestLayer);
}

// Keeps state.farFromForest in step with a real fix (and re-run when the outline lands). When it
// flips, the Nearby list/camera re-centre (nearbyOrigin) and the compass/route aids switch on/off,
// and the one far-from-the-forest notice is raised or cleared. Nothing here blocks the map.
function updateFarFromForest(latitude, longitude) {
  const far = isFarFromForestFix(latitude, longitude);
  if (far === state.farFromForest) return;
  state.farFromForest = far;
  if (isOverviewScreenActive()) selectOverview();
  updateCompassOverlay();
  requestDraw();
  if (far) showFarFromForestNotice();
  else hideFarFromForestNotice();
}

// Whether a real fix is far from the forest. Exact once the outline has loaded. Before that, a fix
// beyond the outline's furthest reach plus the walking limit is already far: otherwise the camera
// framed the raw fix (central London, say) until the outline arrived and then flew across to High
// Beach, and the map was blank for that whole stretch.
function isFarFromForestFix(latitude, longitude) {
  if (!hasRealLocation()) return false;
  const metres = distanceToForestMetres(latitude, longitude);
  if (metres != null) return metres > FAR_FROM_FOREST_METRES;
  return distanceMetres(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, latitude, longitude)
    > FOREST_OUTLINE_REACH_FROM_HIGH_BEACH_METRES + FAR_FROM_FOREST_METRES;
}

const FAR_FROM_FOREST_NOTICE_TITLE = "You're too far away to use the app fully";
const FAR_FROM_FOREST_NOTICE_TEXT = "We're showing you finds around High Beach. Directions and walking times come back once you're within 15 minutes' walk of the forest.";

// The far-from-the-forest message is a non-blocking card, not a modal: the map, the Nearby list and the
// High Beach framing behind it all stay usable. It reuses the location invite's floating card
// (#locationInviteBanner) with no request button, since a real fix already exists and asking again
// would only land the visitor back on the same far-away fix. Its OK does not record a location choice.
// Raised once per page load, and held back while the consent card is up so the two never overlap.
function showFarFromForestNotice() {
  if (state.farNoticeShown || state.farNoticeWaiting || !isFarFromForest()) return;
  if (els.consentBanner && !els.consentBanner.hidden) {
    if (typeof MutationObserver !== "function") return;
    state.farNoticeWaiting = true;
    const observer = new MutationObserver(() => {
      if (!els.consentBanner.hidden) return;
      observer.disconnect();
      state.farNoticeWaiting = false;
      showFarFromForestNotice();
    });
    observer.observe(els.consentBanner, { attributes: true, attributeFilter: ["hidden"] });
    return;
  }
  state.farNoticeShown = true;
  state.farNoticeOpen = true;
  showLocationInviteBanner(FAR_FROM_FOREST_NOTICE_TEXT, {
    canRequest: false,
    title: FAR_FROM_FOREST_NOTICE_TITLE,
    recordsChoice: false,
    onClose: () => { state.farNoticeOpen = false; },
  });
}

// Walking back inside the walking limit clears the notice, so it never describes a place the visitor
// is no longer far from.
function hideFarFromForestNotice() {
  if (!state.farNoticeOpen || !els.locationInviteBanner) return;
  state.farNoticeOpen = false;
  hideNoticeCard(els.locationInviteBanner);
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
    return { x: 0, y: 0, width: state.canvasVisibleWidth, height: state.canvasVisibleHeight };
  }
  // Fallback before first resizeCanvas() (early-boot only): read CSS layout dimensions.
  // The bitmap is only sized by resizeCanvas(), so this is the one place that can read the stage.
  const stageEl = els.mapStage || els.canvas;
  const dpr = cappedDevicePixelRatio();
  const r = stageEl.getBoundingClientRect();
  return { x: 0, y: 0, width: Math.max(1, Math.round(r.width * dpr)), height: Math.max(1, Math.round(r.height * dpr)) };
}

// Decides this frame's canvas resolution from whether the camera moved since the last frame. Called
// from draw() after prepareCanvasForDraw(), so the pose it reads is the one being painted. Movement
// is a change in scale, pan, 3D tilt or rotation above a small threshold, so sensor jitter on a
// phone held still does not count. A change of resolution resizes the canvas, which the frame
// about to be painted then uses. A timer schedules the restoring frame, since nothing else draws
// once the camera is still.
function syncCanvasMotionResolution() {
  const m = state.canvasMotion;
  const now = performance.now();
  const pose = { scale: state.viewport.scale, tx: state.viewport.tx, ty: state.viewport.ty,
    tilt: tiltRotateXDeg(), rotation: navigationMapRotationDegrees() };
  const prev = m.sig;
  m.sig = pose;
  if (prev && cameraPoseMoved(prev, pose)) {
    m.lastMotionAt = now;
    clearTimeout(m.stillTimer);
    m.stillTimer = setTimeout(() => { m.stillTimer = null; requestDraw(); }, MOTION_STILL_MS);
  }
  const moving = now - m.lastMotionAt < MOTION_STILL_MS;
  if (moving !== m.capped) {
    m.capped = moving;
    m.scale = moving ? Math.min(1, MOTION_CANVAS_PIXEL_RATIO / Number(els.canvas.dataset.dpr || 1)) : 1;
    applyCanvasBitmapSize();
  }
}

function cameraPoseMoved(a, b) {
  return Math.abs(a.tx - b.tx) > 0.5 || Math.abs(a.ty - b.ty) > 0.5
    || Math.abs(a.scale - b.scale) > a.scale * 1e-4
    || Math.abs(a.tilt - b.tilt) > 0.1 || Math.abs(a.rotation - b.rotation) > 0.1;
}

function resizeCanvas() {
  _overlapRectCache = undefined;
  _tiltProjectionCache = undefined;
  _nearbyRenderOriginCache = undefined;
  const rect = (els.mapStage || els.canvas).getBoundingClientRect();
  const requestedDpr = cappedDevicePixelRatio();
  const rawWidth = Math.max(1, rect.width);
  const rawHeight = Math.max(1, rect.height);
  // The bitmap is exactly the visible stage: no heading-up overscan. Tilt never needed one (it
  // is projected per point, see tiltProjectOffsets). Overscan used to make the visible rect a
  // sub-rect of the bitmap, which left the viewport fit solved against the pre-resize origin
  // (alignHeadingUpNavigationViewport runs before this in the same frame) until the next fit, and
  // spent the label and path culls on the hidden margin.
  let bitmapWidth = Math.max(1, Math.min(MAX_CANVAS_DIMENSION, Math.round(rawWidth * requestedDpr)));
  let bitmapHeight = Math.max(1, Math.min(MAX_CANVAS_DIMENSION, Math.round(rawHeight * requestedDpr)));
  const cappedPixels = bitmapWidth * bitmapHeight;
  if (cappedPixels > MAX_CANVAS_PIXEL_COUNT) {
    const scaleDown = Math.sqrt(MAX_CANVAS_PIXEL_COUNT / cappedPixels);
    bitmapWidth = Math.max(1, Math.floor(bitmapWidth * scaleDown));
    bitmapHeight = Math.max(1, Math.floor(bitmapHeight * scaleDown));
  }
  // Derive effective DPR from the capped bitmap so bitmap allocation stays within safe limits
  // while the bitmap still maps exactly onto the stage.
  const dpr = Math.max(1, Math.min(requestedDpr, bitmapWidth / rawWidth, bitmapHeight / rawHeight));

  state.canvasInsetX = 0;
  state.canvasInsetY = 0;
  state.canvasVisibleWidth = bitmapWidth;
  state.canvasVisibleHeight = bitmapHeight;
  // The logical size (what every camera, cull and hit test works in) is the full-resolution stage.
  // Only the bitmap written by applyCanvasBitmapSize() may be smaller, while the camera moves.
  state.canvasLogicalWidth = bitmapWidth;
  state.canvasLogicalHeight = bitmapHeight;
  els.canvas.dataset.dpr = String(dpr);
  els.canvas.style.position = "absolute";
  els.canvas.style.left = "0px";
  els.canvas.style.top = "0px";
  els.canvas.style.width = `${bitmapWidth / dpr}px`;
  els.canvas.style.height = `${bitmapHeight / dpr}px`;
  if (els.overlayCanvas) {
    els.overlayCanvas.dataset.dpr = String(dpr);
    els.overlayCanvas.style.position = "absolute";
    els.overlayCanvas.style.left = "0px";
    els.overlayCanvas.style.top = "0px";
    els.overlayCanvas.style.width = `${bitmapWidth / dpr}px`;
    els.overlayCanvas.style.height = `${bitmapHeight / dpr}px`;
  }
  applyCanvasBitmapSize();
}

// Writes the bitmap of both map canvases: the logical size scaled by the moving-camera factor. Every
// frame starts with that factor applied to its context (draw(), drawOverlay()), so drawing still happens
// in logical coordinates and only the pixel count changes. The browser stretches the bitmap over the
// unchanged CSS size.
function applyCanvasBitmapSize() {
  if (!state.canvasLogicalWidth) return;
  const k = state.canvasMotion.scale;
  const w = Math.max(1, Math.round(state.canvasLogicalWidth * k));
  const h = Math.max(1, Math.round(state.canvasLogicalHeight * k));
  els.canvas.width = w;
  els.canvas.height = h;
  if (els.overlayCanvas) {
    els.overlayCanvas.width = w;
    els.overlayCanvas.height = h;
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
  // A bounding box for points that are all genuinely near-coincident in world space -- a mega
  // cluster's members, say, tight enough together that they read as one pile on screen -- has a
  // near-zero range on one or both axes. The 0.0001 floor below stops that from being a literal
  // division by zero, but a floor that small still asks for a scale in the tens of thousands:
  // effectively "zoom in until this one spot fills the screen", which pins/text/everything else
  // render at nonsensical size under, or off-screen entirely. Captured before this function
  // overwrites state.fitScale itself, so the cap is relative to the real, whole-dataset fit.
  const baseFitScaleForCap = state.baseFitScale > 0 ? state.baseFitScale : state.fitScale;
  const rangeX = Math.max(0.0001, bounds.maxX - bounds.minX);
  const rangeY = Math.max(0.0001, bounds.maxY - bounds.minY);
  state.fitScale = Math.min((viewportWidth - padding * 2) / rangeX, (viewportHeight - padding * 2) / rangeY);
  if (options.minScale > 0) {
    state.fitScale = Math.max(state.fitScale, options.minScale);
  }
  // Same ceiling the manual pinch-to-zoom gesture already enforces (state.fitScale * 220 there),
  // so a fit never asks for more zoom than a user could reach by hand -- unless the caller
  // passes its own `maxScale` (see MIN_SELECTION_VIEW_METRES), which says explicitly what the
  // tightest reasonable view for *this* fit is, rather than inheriting a ceiling calibrated
  // for how far a pinch gesture or a degenerate near-coincident cluster should be allowed to
  // reach.
  if (options.maxScale > 0) {
    state.fitScale = Math.min(state.fitScale, options.maxScale);
  } else if (baseFitScaleForCap > 0) {
    state.fitScale = Math.min(state.fitScale, baseFitScaleForCap * 220);
  }

  const targetScale = state.fitScale;
  const targetTx = focusRect.x + (viewportWidth - rangeX * targetScale) / 2 - bounds.minX * targetScale;
  const targetTy = focusRect.y + (viewportHeight - rangeY * targetScale) / 2 - bounds.minY * targetScale;

  if (options.animate) {
    moveCamera(
      { scale: targetScale, tx: targetTx, ty: targetTy },
      options.durationMs || DEFAULT_VIEWPORT_ANIMATION_MS,
      undefined,
      { cinematic: Boolean(options.cinematic), deliberate: Boolean(options.deliberate), focusPoint: { x: focusRect.x + viewportWidth / 2, y: focusRect.y + viewportHeight / 2 } },
    );
    return;
  }

  stopViewportAnimation();
  state.viewport.scale = targetScale;
  state.viewport.tx = targetTx;
  state.viewport.ty = targetTy;
}

function stopViewportAnimation() {
  cancelZoomChase();
  if (state.viewportAnimationFrame != null) {
    cancelAnimationFrame(state.viewportAnimationFrame);
  }
  state.viewportAnimationFrame = null;
  state.viewportAnimationFrameRequestedAt = null;
  state.viewportAnimationFrom = null;
  state.viewportAnimationTo = null;
  state.locationRevealAnimationActive = false;
  state.locationRevealFocusPoint = null;
  state.viewportAnimationStartTime = null;
  state.viewportAnimationDuration = 0;
  // The camera has just been told "stop, you're done" -- a pin-level cluster-join animation
  // still running against a now-unmoving view is the same kind of stale motion, so it settles
  // too. See settleClusterJoinAnimations (js/renderer.js).
  if (typeof settleClusterJoinAnimations === "function") settleClusterJoinAnimations();
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

// Scale is a ratio on screen, so a zoom reads as even only when it is interpolated geometrically.
// A linear blend between a 125k and a 22k scale spends most of its change in the middle of the
// ease, which looks like the view snapping out; a geometric ramp changes by the same proportion on
// every frame. Falls back to a linear blend for a non-positive scale, which a ratio cannot express.
function zoomAlongTween(fromScale, toScale, eased) {
  if (!(fromScale > 0) || !(toScale > 0)) return fromScale + (toScale - fromScale) * eased;
  return fromScale * Math.pow(toScale / fromScale, eased);
}

// The viewport part-way through a tween. Scale is interpolated geometrically (zoomAlongTween), and
// the offsets must follow it: a screen point is `world * scale + offset`, so interpolating the
// offsets linearly while the scale is geometric lets the point under the camera focus drift
// sideways during every zoom, which reads as jitter. When the two views differ in scale, they
// agree on one world point (the zoom's invariant point); the offsets are then
// `offset0 + world0 * (scale0 - scale)`, which keeps that point still while everything zooms about
// it and lands exactly on both ends. A near-equal scale is a pure pan, so the offsets are blended
// directly.
function viewportAlongTween(from, to, eased) {
  const scale = zoomAlongTween(from.scale, to.scale, eased);
  const ratio = from.scale > 0 && to.scale > 0 ? to.scale / from.scale : 1;
  if (!(Math.abs(Math.log(ratio)) >= VIEWPORT_TWEEN_ZOOM_ABOUT_POINT_MIN_LOG_RATIO)) {
    return { scale, tx: from.tx + (to.tx - from.tx) * eased, ty: from.ty + (to.ty - from.ty) * eased };
  }
  const worldX = (to.tx - from.tx) / (from.scale - to.scale);
  const worldY = (to.ty - from.ty) / (from.scale - to.scale);
  return {
    scale,
    tx: from.tx + worldX * (from.scale - scale),
    ty: from.ty + worldY * (from.scale - scale),
  };
}

// Below this |ln(scale ratio)| (about a 5% zoom) a tween is treated as a pan: the zoom-about-a-point
// form divides by the scale difference, which is ill-conditioned for tiny zooms.
const VIEWPORT_TWEEN_ZOOM_ABOUT_POINT_MIN_LOG_RATIO = 0.05;

// A big zoom needs longer than a small one. The ease puts most of a zoom into the middle of the move,
// so a 6x zoom out in 500ms is visibly zooming for only about 250ms and reads as a snap. Beyond
// ZOOM_DURATION_MIN_RATIO (3x) the duration grows with the number of doublings, up to a cap; below
// it, and for any tween the caller marks `fixedDuration`, the requested duration stands.
const ZOOM_DURATION_MIN_RATIO = 3;
const ZOOM_DURATION_PER_DOUBLING = 0.6; // extra share of the requested duration per doubling beyond the minimum
const ZOOM_DURATION_MAX_MS = 1200;

// A deliberate, user-triggered move (selecting a place, returning to Nearby, applying filters, a
// followed link) gets the cinematic arc -- the same shallow zoom-out the first-location fly-to
// uses -- but only when it is big enough to read as a journey: the zoom changes by at least
// DELIBERATE_ARC_MIN_ZOOM_RATIO, or the camera centre travels at least this share of the shorter
// canvas side. Anything smaller stays a plain ease, and continuous camera work (GPS follow, compass,
// drag return, wheel/pinch glides, resizes) never asks for the arc. Arc moves last between
// DELIBERATE_ARC_MIN_MS and DELIBERATE_ARC_MAX_MS, so an ordinary selection does not slow down.
const DELIBERATE_ARC_MIN_ZOOM_RATIO = 1.5;
const DELIBERATE_ARC_MIN_TRAVEL_SHARE = 0.35;
const DELIBERATE_ARC_MIN_MS = 650;
const DELIBERATE_ARC_MAX_MS = 1000;

function deliberateMoveIsLarge(from, target, focusPoint) {
  if (!(from.scale > 0) || !(target.scale > 0)) return false;
  const zoomRatio = Math.max(from.scale / target.scale, target.scale / from.scale);
  if (zoomRatio >= DELIBERATE_ARC_MIN_ZOOM_RATIO) return true;
  const fromCentre = { x: (focusPoint.x - from.tx) / from.scale, y: (focusPoint.y - from.ty) / from.scale };
  const toCentre = { x: (focusPoint.x - target.tx) / target.scale, y: (focusPoint.y - target.ty) / target.scale };
  const smaller = Math.min(from.scale, target.scale);
  const travelPx = Math.hypot((toCentre.x - fromCentre.x) * smaller, (toCentre.y - fromCentre.y) * smaller);
  const shorterSide = Math.min(els.canvas ? els.canvas.width : 0, els.canvas ? els.canvas.height : 0);
  return shorterSide > 0 && travelPx >= shorterSide * DELIBERATE_ARC_MIN_TRAVEL_SHARE;
}

function zoomAwareDurationMs(baseMs, zoomRatio) {
  if (!(zoomRatio > ZOOM_DURATION_MIN_RATIO)) return baseMs;
  const extraDoublings = Math.log2(zoomRatio) - Math.log2(ZOOM_DURATION_MIN_RATIO);
  return Math.min(Math.max(baseMs, ZOOM_DURATION_MAX_MS), baseMs * (1 + ZOOM_DURATION_PER_DOUBLING * extraDoublings));
}

// The single owner of an in-flight camera move. Every tween goes through here: it decides whether the
// request is a repeat of the move already running (ignored), and otherwise replaces that move.
// The queueing of animated Nearby refits that arrive mid-move stays with the refit path
// (alignHeadingUpNavigationViewport -> deferAnimatedNearbyRefit) until its callers migrate.
// `options.reason` is a diagnostic label only; it changes nothing about the move.
function moveCamera(targetViewport, durationMs, onComplete, options = {}) {
  let safeDuration = Math.max(MIN_VIEWPORT_ANIMATION_MS, Number(durationMs) || DEFAULT_VIEWPORT_ANIMATION_MS);
  const cinematic = Boolean(options.cinematic);
  if (!cinematic && viewportAnimationAlreadyHeadedTo(targetViewport)) return "ignored";
  // options.deliberate marks a user-triggered move; whether it is big enough for the arc is
  // decided here, once, for every caller. The arc maths below is shared with `cinematic`, but a
  // deliberate arc does not take over the walking-radius ring's screen position (the reveal flags
  // stay cinematic-only) and keeps the same-target dedupe above.
  stopViewportAnimation();
  // A real camera tween owns the zoom from here, so a browse-origin slide must not keep easing back
  // towards the zoom it started from once this tween has landed.
  if (state.nearbyOriginTransition) state.nearbyOriginTransition.fromScale = null;

  const from = {
    scale: state.viewport.scale,
    tx: state.viewport.tx,
    ty: state.viewport.ty,
  };
  const focusPoint = options.focusPoint || (els.canvas ? { x: els.canvas.width / 2, y: els.canvas.height / 2 } : { x: 0, y: 0 });
  const deliberateArc = !cinematic && Boolean(options.deliberate) && !state.nearbyOriginTransition
    && !prefersReducedMotion()
    && deliberateMoveIsLarge(from, targetViewport, focusPoint);
  const arc = cinematic || deliberateArc;
  // Not while a browse-origin slide is running: its callers pass a duration chosen so the tween and the
  // slide land on the same frame (see nearbyRevealOpacity), and stretching one would pull them apart.
  if (!cinematic && !options.fixedDuration && !state.nearbyOriginTransition
    && from.scale > 0 && targetViewport.scale > 0) {
    const zoomRatio = Math.max(from.scale / targetViewport.scale, targetViewport.scale / from.scale);
    safeDuration = zoomAwareDurationMs(safeDuration, zoomRatio);
  }
  if (deliberateArc) safeDuration = clamp(safeDuration, DELIBERATE_ARC_MIN_MS, DELIBERATE_ARC_MAX_MS);

  // A normal viewport tween interpolates the transform components directly. That is right for
  // small refits, but it makes a High Beach -> GPS handoff feel like a hard yank when both the
  // camera position and scale change at once. The cinematic path interpolates the camera's world
  // centre and adds a shallow zoom-out arc, like a restrained map fly-to: the route becomes clear
  // in the middle of the move, then the camera settles into the final walking-radius fit.
  const fromCenter = arc && from.scale > 0
    ? { x: (focusPoint.x - from.tx) / from.scale, y: (focusPoint.y - from.ty) / from.scale }
    : null;
  const targetCenter = arc && targetViewport.scale > 0
    ? { x: (focusPoint.x - targetViewport.tx) / targetViewport.scale, y: (focusPoint.y - targetViewport.ty) / targetViewport.scale }
    : null;
  const centreDistancePx = fromCenter && targetCenter
    ? Math.hypot(
      (targetCenter.x - fromCenter.x) * Math.min(from.scale, targetViewport.scale),
      (targetCenter.y - fromCenter.y) * Math.min(from.scale, targetViewport.scale),
    )
    : 0;
  const zoomOutRatio = arc
    ? clamp(0.10 + (centreDistancePx / 900) * 0.045, 0.10, 0.24)
    : 0;
  const cinematicScaleFloor = cinematic && state.baseFitScale > 0
    ? state.baseFitScale * 0.92
    : deliberateArc ? Math.min(from.scale, targetViewport.scale) * 0.8 : 0;

  if (
    Math.abs(from.scale - targetViewport.scale) < 0.000001
    && Math.abs(from.tx - targetViewport.tx) < 0.5
    && Math.abs(from.ty - targetViewport.ty) < 0.5
  ) {
    state.viewport.scale = targetViewport.scale;
    state.viewport.tx = targetViewport.tx;
    state.viewport.ty = targetViewport.ty;
    requestDraw();
    if (typeof onComplete === "function") onComplete();
    return "snapped";
  }

  state.viewportAnimationFrom = from;
  state.viewportAnimationTo = targetViewport;
  state.locationRevealAnimationActive = cinematic;
  state.locationRevealFocusPoint = cinematic ? { x: focusPoint.x, y: focusPoint.y } : null;
  state.viewportAnimationDuration = safeDuration;

  const tick = (timestamp) => {
    // Keep the timestamp through rendering so a thrown frame cannot hide a stranded camera.
    // stopViewportAnimation clears it on completion; scheduling the next frame replaces it.
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

    if (arc && fromCenter && targetCenter) {
      const baseScale = zoomAlongTween(from.scale, targetViewport.scale, eased);
      const zoomArc = Math.sin(Math.PI * eased) * zoomOutRatio;
      state.viewport.scale = Math.max(cinematicScaleFloor, baseScale * (1 - zoomArc));
      const centreX = fromCenter.x + (targetCenter.x - fromCenter.x) * eased;
      const centreY = fromCenter.y + (targetCenter.y - fromCenter.y) * eased;
      state.viewport.tx = focusPoint.x - centreX * state.viewport.scale;
      state.viewport.ty = focusPoint.y - centreY * state.viewport.scale;
    } else {
      const frame = viewportAlongTween(state.viewportAnimationFrom, state.viewportAnimationTo, eased);
      state.viewport.scale = frame.scale;
      state.viewport.tx = frame.tx;
      state.viewport.ty = frame.ty;
    }
    requestDraw();

    if (progress >= 1) {
      state.viewport.scale = state.viewportAnimationTo.scale;
      state.viewport.tx = state.viewportAnimationTo.tx;
      state.viewport.ty = state.viewportAnimationTo.ty;
      // A programmatic camera move has landed: the resting layout must not depend on the path the
      // camera took, so marker grouping starts fresh (user gestures and interrupted tweens keep
      // their memory). stopViewportAnimation settles any pin animation, so this regroup is silent.
      if (typeof resetMarkerGroupMemory === "function") resetMarkerGroupMemory();
      stopViewportAnimation();
      requestDraw();
      if (typeof onComplete === "function") onComplete();
      return;
    }

    state.viewportAnimationFrame = requestAnimationFrame(tick);
    state.viewportAnimationFrameRequestedAt = timestamp;
  };

  state.viewportAnimationFrame = requestAnimationFrame(tick);
  state.viewportAnimationFrameRequestedAt = performance.now();
  return "started";
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
  const inspectorVisible = Boolean(els.inspector) && !els.inspector.hidden;
  const navVisible = Boolean(els.inspectorActions) && !els.inspectorActions.hidden;
  if (!inspectorVisible && !navVisible) return null;
  if (!assumeInspectorOpen && _overlapRectCache !== undefined) return _overlapRectCache;

  const wasMinimized = inspectorVisible && els.inspector.classList.contains("minimized");
  if (assumeInspectorOpen && wasMinimized) {
    els.inspector.classList.remove("minimized");
  }

  // The canvas sits at its stage's origin, so a stage-relative offset is already a bitmap offset.
  const canvasRect = (els.mapStage || els.canvas).getBoundingClientRect();
  // The nav bar (js/app.html's <nav class="inspector-actions">) is its own fixed bar, separate
  // from #inspector, and stays visible whatever the sheet is doing -- so the obstructed area is
  // the union of both footprints, not just the sheet's. They don't overlap in normal layout, so
  // this is just the bounding box of whichever of the two is present.
  const rects = [
    inspectorVisible ? els.inspector.getBoundingClientRect() : null,
    navVisible ? els.inspectorActions.getBoundingClientRect() : null,
  ].filter(Boolean);

  if (assumeInspectorOpen && wasMinimized) {
    els.inspector.classList.add("minimized");
  }

  const unionRect = {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };

  const overlapLeft = Math.max(canvasRect.left, unionRect.left);
  const overlapTop = Math.max(canvasRect.top, unionRect.top);
  const overlapRight = Math.min(canvasRect.right, unionRect.right);
  const overlapBottom = Math.min(canvasRect.bottom, unionRect.bottom);

  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
    if (!assumeInspectorOpen) _overlapRectCache = null;
    return null;
  }

  const dpr = pixelRatio();
  const result = {
    x: (overlapLeft - canvasRect.left) * dpr,
    y: (overlapTop - canvasRect.top) * dpr,
    width: (overlapRight - overlapLeft) * dpr,
    height: (overlapBottom - overlapTop) * dpr,
  };
  if (!assumeInspectorOpen) _overlapRectCache = result;
  return result;
}

function zoomAt(factor, screenPoint) {
  if (!state.bounds) return;
  // Read before stopViewportAnimation, which ends any wheel glide already in flight.
  const priorChase = state.zoomChase;
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
  // The wheel asks for a target scale and the camera glides to it frame by frame, so a stream of
  // small trackpad deltas reads as one continuous zoom instead of a jump per event. Successive
  // events re-aim the same glide (it is not restarted), and the point under the cursor stays fixed.
  const heading = priorChase && Number.isFinite(priorChase.target) ? priorChase.target : state.viewport.scale;
  const target = clamp(heading * factor, state.fitScale * 0.65, state.fitScale * 220);
  const last = priorChase ? priorChase.last : null;
  const now = performance.now();
  const world = screenToWorld(screenPoint.x, screenPoint.y);
  stopViewportAnimation();
  state.zoomChase = { target, screenPoint: { x: screenPoint.x, y: screenPoint.y }, world, frame: null, last: now };
  stepZoomChase(last == null ? ZOOM_CHASE_FIRST_STEP_MS : now - last);
}

// How quickly the camera closes on a wheel zoom's target: the time constant of an exponential
// chase, so the first frame already moves visibly and the last frames settle without a hard stop.
const ZOOM_CHASE_TAU_MS = 70;
const ZOOM_CHASE_FIRST_STEP_MS = 16;
const ZOOM_CHASE_DONE_LOG_RATIO = 0.002;

function zoomChaseFraction(dtMs) {
  return 1 - Math.exp(-clamp(Number(dtMs) || ZOOM_CHASE_FIRST_STEP_MS, 1, 34) / ZOOM_CHASE_TAU_MS);
}

function cancelZoomChase() {
  const chase = state.zoomChase;
  if (!chase) return;
  if (chase.frame != null) cancelAnimationFrame(chase.frame);
  state.zoomChase = null;
}

function stepZoomChase(dtMs) {
  const chase = state.zoomChase;
  if (!chase) return;
  const scale = state.viewport.scale;
  const gap = Math.log(chase.target / scale);
  const done = !Number.isFinite(gap) || Math.abs(gap) < ZOOM_CHASE_DONE_LOG_RATIO;
  const next = done ? chase.target : scale * Math.exp(gap * zoomChaseFraction(dtMs));
  state.viewport.scale = next;
  state.viewport.tx = chase.screenPoint.x - chase.world.x * next;
  state.viewport.ty = chase.screenPoint.y - chase.world.y * next;
  requestDraw();
  if (done) {
    state.zoomChase = null;
    return;
  }
  chase.frame = requestAnimationFrame((timestamp) => {
    chase.frame = null;
    if (state.zoomChase !== chase) return;
    const dt = timestamp - chase.last;
    chase.last = timestamp;
    stepZoomChase(dt);
  });
}

function attachNearbyRailScrollHints(root = els.inspectorBody) {
  if (!root?.querySelectorAll) return;
  for (const row of root.querySelectorAll(".filter-rail .rail-pills")) {
    if (row.dataset.scrollHintsAttached !== "true") {
      row.addEventListener("scroll", () => updateNearbyRailScrollHint(row), { passive: true });
      row.dataset.scrollHintsAttached = "true";
    }
    updateNearbyRailScrollHint(row);
  }
}

function updateNearbyRailScrollHint(row) {
  if (!row) return;
  const rail = row.closest(".filter-rail");
  if (!rail) return;
  const maxScrollLeft = row.scrollWidth - row.clientWidth;
  const isScrollable = maxScrollLeft > 6;
  rail.classList.toggle("has-left-overflow", isScrollable && row.scrollLeft > 2);
  rail.classList.toggle("has-right-overflow", isScrollable && row.scrollLeft < maxScrollLeft - 2);
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function setOverviewFilters(nextFilters, { persist = true, render = true, railTap = false } = {}) {
  const previousFilters = state.overviewFilters;
  const sanitizedFilters = sanitizeOverviewFilters(nextFilters);
  const filtersChanged = previousFilters.length !== sanitizedFilters.length
    || previousFilters.some((filterKey, index) => filterKey !== sanitizedFilters[index]);
  // Capture the currently visible pin set before changing state so the canvas renderer can
  // animate additions and removals by item identity. Initial boot calls this with render:false;
  // that path should remain a quiet data/setup render rather than replaying a filter animation.
  const previousPinLookup = render && filtersChanged && typeof buildNearbyIconLookup === "function"
    ? buildNearbyIconLookup()
    : null;
  state.overviewFilters = sanitizedFilters;
  if (filtersChanged) {
    const origin = state.nearbyAnchor || state.userLocation;
    state.nearbyFilterChangeOrigin = origin
      ? { latitude: origin.latitude, longitude: origin.longitude }
      : null;
  }
  // Marks the current filters as a view (a category landing or an old ?show= link) rather than the saved
  // set, so goToInitialView (the Nearby nav button) knows to put the saved filters back rather than carrying
  // a view over to the plain Nearby screen. A save (persist) clears it: a rail pick is a save.
  state.overviewFiltersEphemeral = !persist;
  // Before the camera work below: secondary screens may reach a newly selected filter's nearest
  // match when it lies outside the walking radius (outOfRadiusFitPoints). Nearby stays framed on
  // the radius itself, even when its list is using an out-of-radius fallback entry.
  refreshOutOfRadiusReveal(previousFilters);
  if (previousPinLookup && typeof beginOverviewFilterPinTransition === "function") {
    beginOverviewFilterPinTransition(previousPinLookup);
  }
  if (persist) saveFilterState();
  updateFilterUi();
  syncLiveQueryStringForScreen();
  if (railTap) {
    syncRailUrl();
    railPatchPending = true;
  }
  // render:false -- boot()'s own call, before state.userLocation exists -- skips the render
  // this would otherwise force here: without it, selectOverview() ran once against no location
  // (activeFiltersShowFullListWithoutLocation()'s dataset-order full list) and then again
  // moments later once applyDefaultLocation()/applyLocationFix() actually resolved, replacing the
  // static server-rendered list with that unsorted one and then immediately replacing it again --
  // a visible double-flicker on every /nearby/<slug> landing. boot() always calls selectOverview()
  // itself right after, with the real state already in place, so the render here would just be
  // thrown away.
  if (!render) {
    requestDraw();
    return;
  }
  if (isOverviewScreenActive() && (!state.filterScreenOpen || mapSetupModalActive())) {
    selectOverview();
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS, deliberate: true });
  }
  requestDraw();
}

function updateFilterUi() {
  const currentSet = activeOverviewFilterSet();

  // Map setup changes what Nearby shows, so its inline toggle (next to the Nearby heading
  // -- see app.html) is the way in from Nearby and opens the guided setup. The temporary
  // selection inside that dialog is rendered by js/onboarding.js and is not written to
  // state.overviewFilters until Done.
  if (els.filterToggle) {
    const activeGroupCount = getActiveGroupKeys(currentSet).length;
    const hasActiveFilter = activeGroupCount > 0;
    const locationSelected = Boolean(state.selected);
    els.filterToggle.hidden = locationSelected || findLandingAwaitingPlace() || state.searchScreenOpen
      || (state.filterScreenOpen && !mapSetupModalActive());
    els.filterToggle.classList.toggle("active", hasActiveFilter);
    els.filterToggle.classList.toggle("screen-active", state.filterScreenOpen && !mapSetupModalActive());
    els.filterToggle.setAttribute("aria-pressed", hasActiveFilter ? "true" : "false");
    els.filterToggle.setAttribute("aria-label", hasActiveFilter
      ? `Map setup: ${activeGroupCount} top-level filter${activeGroupCount === 1 ? "" : "s"} selected`
      : "Map setup");
    els.filterToggle.title = "Choose what appears on the map";
    if (els.filterCount) {
      els.filterCount.hidden = !hasActiveFilter;
      els.filterCount.textContent = String(activeGroupCount);
    }
  }
}

function mapSetupModalActive() {
  const overlay = typeof document !== "undefined" ? document.getElementById("onboardingOverlay") : null;
  return Boolean(overlay && !overlay.hidden && overlay._onboardingActive);
}

function filterMeta(filterKey) {
  return FILTER_SUBFILTERS_BY_KEY.get(filterKey) || null;
}

function navHighlightPosition(current) {
  const nav = current?.closest(".inspector-actions");
  const highlight = nav?.querySelector(".nav-highlight");
  if (!nav || !highlight || !current || current.hidden) return;

  const navRect = nav.getBoundingClientRect();
  const currentRect = current.getBoundingClientRect();
  const nextPosition = {
    x: currentRect.left - navRect.left,
    y: currentRect.top - navRect.top,
    width: currentRect.width,
    height: currentRect.height,
  };
  const previousPosition = nav._navHighlightPosition;
  const positionIsUnchanged = previousPosition
    && Object.keys(nextPosition).every((key) => Math.abs(nextPosition[key] - previousPosition[key]) < 0.25);
  if (!positionIsUnchanged) {
    nav.style.setProperty("--nav-highlight-x", `${nextPosition.x}px`);
    nav.style.setProperty("--nav-highlight-y", `${nextPosition.y}px`);
    nav.style.setProperty("--nav-highlight-width", `${nextPosition.width}px`);
    nav.style.setProperty("--nav-highlight-height", `${nextPosition.height}px`);
    nav._navHighlightPosition = nextPosition;
  }
  nav.classList.add("nav-has-highlight");
}

function previewNavScreenActive(current) {
  const nav = current?.closest(".inspector-actions");
  if (!nav || !current || current.hidden) return;
  nav.querySelectorAll(":scope > .nav-pressing").forEach((el) => el.classList.remove("nav-pressing"));
  current.classList.add("nav-pressing");
  nav._navHighlightPreviewTarget = current;
  navHighlightPosition(current);
}

function setNavScreenActive(current = null, { preserveHighlight = false } = {}) {
  const nav = document.querySelector(".inspector-actions");
  const previewTarget = nav?._navHighlightPreviewTarget;
  const keepPressingTarget = previewTarget && (previewTarget === current || (preserveHighlight && !current))
    ? previewTarget
    : null;
  [els.nearbyToggle, els.searchToggle, els.filterToggle, els.settingsToggle, els.reportToggle].forEach((el) => {
    if (!el) return;
    el.classList.toggle("screen-active", el === current);
    if (el !== keepPressingTarget) el.classList.remove("nav-pressing");
    el.classList.remove("active");
    if (el === current) el.setAttribute("aria-current", "page");
    else el.setAttribute("aria-current", "false");
  });
  if (current?.closest(".inspector-actions")) {
    nav._navHighlightPreviewTarget = null;
    if (previewTarget !== current) {
      navHighlightPosition(current);
    } else if (!current.classList.contains("nav-pressing")) {
      current.classList.add("nav-pressing");
    }
  } else if (!preserveHighlight) {
    if (nav?._navHighlightPreviewTarget) nav._navHighlightPreviewTarget.classList.remove("nav-pressing");
    if (nav) {
      nav._navHighlightPreviewTarget = null;
      nav.classList.remove("nav-has-highlight");
    }
  }
}

// Filter setup used to open a second, live panel that duplicated the onboarding controls and
// also tried to keep a nearby list in sync beneath it. Reuse the guided setup instead: edits stay
// local to the dialog until it exits, then the current staged set is applied on every exit. Done
// remains the explicit final-step action, and backing out never leaves a half-configured map
// behind. The old /nearby/filter path still enters here for bookmarked links.
function openFilterSetup() {
  if (typeof showOnboarding !== "function") return;
  const overlay = document.getElementById("onboardingOverlay");
  if (!overlay || typeof overlay.querySelector !== "function" || !overlay.querySelector(".onboarding-progress")) return;
  if (overlay._onboardingActive) return;

  if (typeof trackGaScreenView === "function") trackGaScreenView("Map setup");
  // Keep the route for bookmarks/history, but leave the Nearby inspector and its list rendered
  // underneath the modal. This is deliberately not a replacement screen.
  exitClusterExpansion();
  // The screen the dialog opens over (a landing, or plain Nearby). Opening the dialog pushes its own route,
  // so a close that saves nothing puts this URL back. The legacy /nearby/filter route has no screen of its
  // own to return to, so it closes to plain Nearby as it always has.
  const openedOverUrl = window.location.pathname === ROUTE_PATHS[ROUTE_FILTERS]
    ? null
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  state.filterScreenOpen = true;
  setHashFromSelection(ROUTE_FILTERS);

  showOnboarding({ mode: "filters" }).then((result) => {
    state.filterScreenOpen = false;
    const saved = Array.isArray(result.filters) && applyStagedFilterSet(result.filters);
    if (!saved && openedOverUrl) history.replaceState(history.state, "", openedOverUrl);
    updateFilterUi();
    if (window.location.pathname === ROUTE_PATHS[ROUTE_FILTERS]) {
      replaceHashInPlace("");
    }
  });
}

function openFiltersScreen() {
  openFilterSetup();
}

// A held rail pill edits just that category: its chips and a Done button, not the whole map setup
// flow. Done, the close button, a backdrop tap or Escape all apply the staged set, as in map setup,
// and the Nearby view behind it is left where it is (no route change).
function openCategorySetup(groupKey) {
  if (typeof showOnboarding !== "function") return;
  const overlay = document.getElementById("onboardingOverlay");
  if (!overlay || typeof overlay.querySelector !== "function" || !overlay.querySelector(".onboarding-progress")) return;
  if (overlay._onboardingActive || !FILTER_GROUPS_BY_KEY.has(groupKey)) return;

  showOnboarding({ mode: "category", groupKey }).then((result) => {
    if (Array.isArray(result.filters)) applyStagedFilterSet(result.filters);
    updateFilterUi();
  });
}

const NATIVE_DATA_STATUS_TEXT = {
  updated: "New map data downloaded. Close and reopen the app to see it.",
  current: "Map data is up to date.",
  failed: "Could not check for map updates. Try again when you have a connection.",
  unavailable: "Map updates are not available on this device.",
  skipped: "Map data is up to date.",
};

const SETTINGS_MERGE_MESSAGES = {
  merged: "Done: the other sign-in's points and devices are now in this account.",
  same: "That sign-in is already part of this account, so there was nothing to merge.",
  failed: "Couldn't merge those sign-ins. Make sure you are still signed in here, then try again.",
};

// The outcome of a merge arrives in a short-lived cookie set by the sign-in callback. It is read and cleared
// once, then kept in memory for this page load: Settings can be drawn more than once while the app starts,
// and every draw must show it. A reload no longer has it.
let settingsMergeOutcome = "";
// The Community tab's own screen: what community checks are, your contributions, add a missing
// tree, and a link on to the feedback form (openReportModal, a page of its own).
function communityScreenOpen() {
  return Boolean(state.selected && state.selected.type === "community");
}

// Community is gated (see communityEnabled): people without it get the Feedback page in its place, and the
// nav tab becomes the Feedback tab.
function openCommunityOrFeedback() {
  if (typeof dismissOnboarding === "function") dismissOnboarding();
  if (communityEnabled()) openCommunity(); else openReportModal();
}

// Declared inside: boot() calls this mid-script, before top-level constants further down have initialised.
function applyFeatureGates() {
  const NAV_COMMUNITY_ICON = '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/>';
  const NAV_FEEDBACK_ICON = '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>';
  const tab = els.reportToggle;
  if (!tab) return;
  const on = communityEnabled();
  const label = on ? "Community" : "Feedback";
  tab.setAttribute("href", on ? "/community" : "/feedback");
  tab.setAttribute("aria-label", label);
  const icon = tab.querySelector("svg");
  if (icon) icon.innerHTML = on ? NAV_COMMUNITY_ICON : NAV_FEEDBACK_ICON;
  const text = tab.querySelector(".nav-label");
  if (text) text.textContent = label;
  // The Community screen is open for someone who no longer has it (the list changed): show Feedback instead.
  if (!on && communityScreenOpen()) openReportModal();
}

function openCommunity() {
  if (typeof trackGaScreenView === "function") trackGaScreenView("Community");
  exitClusterExpansion();
  state.selected = { type: "community", item: null };
  setInspectorSelectionChrome({ emoji: appIconHtml("tree", "app-icon title-icon"), showBack: true, preserveNavHighlight: true });
  setNavScreenActive(els.reportToggle);
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Community";
  els.inspectorType.textContent = "Checks, points and new trees";
  transitionInspectorBody(communityScreenHtml(), "forward");
  communityOpenContributions();
  setInspectorMinimized(false);
  updateCompassOverlay();
  syncHashFromSelection();
  requestDraw();
}

// Frames every mark the user has made (or the whole forest when there are none), not where they stand.
function fitCommunityOwnMarks(options = {}) {
  const points = communityMapMarks().map((mark) => projectLonLat(mark.lon, mark.lat));
  fitToPoints(points, false, {
    focusVisibleArea: true,
    assumeInspectorOpen: true,
    animate: Boolean(options.animate),
    durationMs: options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS,
    minScale: state.baseFitScale > 0 ? state.baseFitScale : undefined,
    padding: OVERVIEW_FIT_PADDING_PX,
  });
}

function communityScreenHtml() {
  return `${communityAccountHtml()}
    ${communityContributionsHtml()}
    ${communityActionsHtml()}
    ${communityLogSectionHtml()}
    <a class="community-feedback-link" href="/feedback">
      <span class="community-feedback-icon">${communityIcon("help")}</span>
      <span class="community-feedback-text"><strong>Feedback</strong><span>Report a bug, add a missing tree or place, or tell us anything</span></span>
      ${communityIcon("chevron")}
    </a>`;
}

const REPORT_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

// Sends a feedback/report payload; if the device is offline, the request cannot reach the server, or
// the server is down for now (a 5xx or 408), it is parked in the outbox (js/outbox.js) and re-sent
// automatically, so the user is never asked to come back later. Only an answer the server gave on
// purpose (a 4xx with its own message) is shown as an error. Resolves {queued:true} or {response, data}.
// A send that has not answered within REPORT_SEND_TIMEOUT_MS is queued rather than awaited: on a weak
// signal the browser can hold a request for a long time, and the user should not wait on it. The
// server de-duplicates on requestId, so a request that does land late cannot file the report twice.
const REPORT_SEND_TIMEOUT_MS = 8000;

const REPORT_QUEUED_MESSAGE = "Saved. It will be sent automatically when you're back online.";
// This browser could not keep the report on disk (private window, storage blocked), so it only survives
// while the app stays open.
const REPORT_QUEUED_VOLATILE_MESSAGE = "Not sent yet. This browser can't save it, so keep the app open and it will send when you're back online.";
// The filter chip an overview entry is listed under. It names the entry's
// *type label*; the icon beside it comes from placeIconSlug, never from here.
//
// This used to restate the whole classification order itself, with a fourth
// vocabulary of its own, and returned "landmark" for anything the filter
// predicates did not claim. filterKindEmoji("landmark") is a bare pushpin
// glyph, which then won over landmarkEmoji() in the list -- so every gate,
// bench, toilet, bicycle stand, viewpoint, information board and picnic site
// was listed as a plain pin while the map drew its artwork beside it, and a
// memorial, museum or dig was listed under the generic castle.
function resolvePlaceKind(place) {
  return placeLabelFilterKey(place) || "landmark";
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
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
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

// While a cluster is expanded (state.clusterExpanded, set by focusNearbyOnClusterGroup on a map
// tap), the Nearby list reads straight from the tapped group's own items rather than running
// the ordinary within-radius scan below -- see that function's own comment for why a scan can't
// promise the list agrees with the badge's count. Builds the same {kind, type, item, metres}
// shape every other branch of overviewItemsForActiveFilter produces, so every downstream
// consumer (heads-up sort, the nearest-item cap, route targets) handles it exactly the same way.
function expandedClusterOverviewEntries(group, latitude, longitude) {
  const entries = [];
  const pushEntry = (itemType, item) => {
    if (itemType === "path") {
      entries.push({ kind: "waymarked_trails", type: "path", item, metres: distanceFromPointToPath(latitude, longitude, item) });
      return;
    }
    const metres = distanceMetres(latitude, longitude, item.latitude, item.longitude);
    if (itemType === "tree") entries.push({ kind: "tree", type: "tree", item, metres });
    else if (itemType === "cow") entries.push({ kind: "cow", type: "cow", item, metres });
    else if (itemType === "water") entries.push({ kind: "ponds_streams", type: "water", item, metres });
    else entries.push({ kind: resolvePlaceKind(item), type: "landmark", item, metres });
  };
  for (const [itemType, items] of Object.entries(clusterItemsByType(group))) {
    for (const item of items) pushEntry(itemType, item);
  }
  return entries.filter(entry => Number.isFinite(entry.metres)).sort((a, b) => a.metres - b.metres);
}

function overviewItemsForActiveFilter() {
  // nearbyOrigin() everywhere, Filter/Settings/Report included: those screens draw the
  // walking-radius ring around the browse anchor like the Nearby screen does, and the anchor
  // can now be moved, reset and resized from them (updateNearbyAnchorBar/startNearbyRadius-
  // Pinch, js/nav.js). Reading the raw GPS fix here instead left the ring centred on the
  // browsed spot while the matches inside it were still scanned from wherever the user
  // actually stood. With no anchor set -- the usual case -- this is the GPS fix as before.
  // stableNearbyOrigin() (not the raw fix) because this candidate scan feeds sampleSpread's
  // capped tree sample -- a few-metre GPS wobble reordering "nearest 60" was visible as pins
  // jumping while the phone sat still (see its own comment, js/nav.js).
  const origin = stableNearbyOrigin();
  if (!origin) return [];
  const { latitude, longitude } = origin;

  if (state.clusterExpanded) {
    state.overviewOutsideRadiusFallback = false;
    return expandedClusterOverviewEntries(state.clusterExpanded, latitude, longitude);
  }

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

function overviewHeadingText() {
  if (!state.userLocation) return "";
  const origin = nearbyOrigin();
  const activePointFilters = getActivePointFilterKeys();
  // The radius is the whole premise of this list, so the heading names it rather than the
  // vaguer "around you" -- "Trees within 5 min walk" answers "how far is this list reaching?"
  // without the user having to go and read the walk chip. The radius chip can be toggled off
  // (showAllOutsideRadius), in which case there is no radius to name and the heading says so.
  const radiusLabel = state.showAllOutsideRadius
    ? null
    : `${formatWalkingRadius(state.walkingDistanceMinutes)} walk`;
  // Filter titles are stored lower case ("trees", "pubs and bars") because they read as a
  // fragment everywhere else they are used; at the head of a sentence they need a capital.
  const rawTitle = activePointFilters.length === 1
    ? (filterMeta(activePointFilters[0])?.title || "items")
    : null;
  const singleFilterTitle = rawTitle ? rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1) : null;
  // "around you" would misname applyDefaultLocation()'s High Beach stand-in as the reader's
  // own position -- only reachable with showAllOutsideRadius on, since radiusLabel otherwise
  // always names the radius instead, but worth getting right for that case too.
  const aroundOrigin = origin.isDefault ? "around High Beach" : "around you";
  // Folds in the same "measuring from High Beach, not you" fact the list itself used to carry as
  // its own separate <p class="source-note"> paragraph (overviewNearestHtml below) -- said once,
  // here, in the one line every Nearby screen already shows, rather than twice.
  const radiusOrigin = origin.isDefault ? " of High Beach" : "";
  if (railSelection().length === 0) {
    return radiusLabel
      ? `Showing everything within ${radiusLabel}${radiusOrigin}`
      : `Showing everything ${aroundOrigin}`;
  }
  // A single category (the common case on a /nearby/<slug> page) gets its count named too --
  // "5 Pubs and bars within 5 min walk" says at a glance whether the radius is worth widening,
  // which "Pubs and bars within 5 min walk" alone left the reader to count for themselves.
  return singleFilterTitle
    ? (radiusLabel
        ? `${overviewItemsForActiveFilter().length} ${singleFilterTitle} within ${radiusLabel}${radiusOrigin}`
        : `Nearest ${singleFilterTitle} ${aroundOrigin}`)
    : state.overviewFilters.length > 0
      ? (radiusLabel ? `Nearest selected filters within ${radiusLabel}${radiusOrigin}` : `Nearest selected filters ${aroundOrigin}`)
      : (radiusLabel ? `Nearest within ${radiusLabel}${radiusOrigin}` : `Nearest ${aroundOrigin}`);
}

// The category label a /nearby/<slug>/ landing page's own heading names ("Nearby Nature",
// "Nearby Pubs & bars") in place of the generic "Nearby" the plain screen, or a reader's own
// filter choice, keeps -- the same URL-path match used by nearbyRailGroup(), so the live rail and
// the heading can never name different categories.
// The category a plain Nearby view is about, as its label: exactly one subcategory picked. A whole group,
// several picks or mixed picks have no single subcategory and return null (the path carries a group only
// on its landing page, so the rail selection cannot name one that survives a reload).
function railSelectionCategoryLabel() {
  const chosen = railSelection();
  return chosen.length === 1 ? FILTER_SUBFILTERS_BY_KEY.get(chosen[0])?.label || null : null;
}

// The label for the Nearby title, the document title and the list heading: a landing page's own
// category (its path), otherwise the rail selection's category (see railSelectionCategoryLabel).
function nearbyCategoryLabel() {
  return isNearbyCategoryLandingPath() ? landingPageCategoryLabel() : railSelectionCategoryLabel();
}

function landingPageCategoryLabel() {
  const match = /^\/nearby\/([a-z0-9-]+)\/?$/.exec(window.location.pathname);
  if (!match) return null;
  const key = match[1].replace(/-/g, "_");
  const subfilter = FILTER_SUBFILTERS_BY_KEY.get(key);
  if (subfilter) return subfilter.label;
  const group = FILTER_GROUPS_BY_KEY.get(key);
  return group ? group.label : null;
}

const DOCUMENT_TITLE_SITE_NAME = "Epping Forest Finds";

// The static SEO pages have their own richer titles in the generated HTML. Once the shared app
// shell boots, the browser title follows the screen the reader is actually looking at, including
// SPA transitions where no document navigation occurs. Keep this in app.js rather than deriving
// it from the visible heading: the heading is deliberately shorter for selected locations and
// category landings have a meaningful URL label even while their list is still server-rendered.
function updateDocumentTitle() {
  let title;
  const selected = state.selected;

  if (selected) {
    const item = selected.item || {};
    if (selected.type === "settings") {
      title = "Settings";
    } else if (selected.type === "community") {
      title = "Community";
    } else if (selected.type === "report") {
      title = "Feedback";
    } else {
      const name = selected.type === "tree"
        ? treeDisplayName(item)
        : selected.type === "cow"
          ? `Cow ${displayValue(item.serialNo)}`
          : selected.type === "railway"
            ? (item.properties?.name || item.properties?.ref || "Unnamed railway line")
            : selected.type === "environment"
              ? (item.properties?.name || "Map feature")
            : (item.name || item.ref || item.commonName || "Map location");
      title = `${name} in Epping Forest`;
    }
  } else if (state.filterScreenOpen && !mapSetupModalActive()) {
    title = "Filters for Epping Forest Finds";
  } else if (state.searchScreenOpen) {
    title = "Search Epping Forest Finds";
  } else {
    const categoryLabel = nearbyCategoryLabel();
    title = categoryLabel ? `Nearby ${categoryLabel} in Epping Forest` : "Nearby";
  }

  const nextTitle = `${title} | ${DOCUMENT_TITLE_SITE_NAME}`;
  if (typeof document !== "undefined" && document.title !== nextTitle) document.title = nextTitle;
  return nextTitle;
}

// True when the active filter set should be listed in full even without a location fix. Only a view
// qualifies (state.overviewFiltersEphemeral: a category landing, or an old ?show= link), since a view
// is what the reader is looking at right now. The reader's saved set never does, not even one
// category: listing every place in a category, with no origin to measure from, is a lot to load
// before a location is known, so the list asks for a location instead.
function activeFiltersShowFullListWithoutLocation() {
  return state.overviewFiltersEphemeral;
}

// Every place/tree/water matching one filter key, dataset order, no distance -- there is no
// origin to measure from. Used only for the no-location /nearby/<slug> fallback below; the normal
// Nearby list always has an origin and goes through overviewItemsForActiveFilter() instead.
function allEntriesForFilterKey(filterKey) {
  if (filterKey === "trees") {
    return state.trees.map((tree) => ({ kind: "tree", type: "tree", item: tree }));
  }
  if (filterKey === "ponds_streams") {
    return state.waterFeatures.map((water) => ({ kind: "ponds_streams", type: "water", item: water }));
  }
  return state.landmarks
    .filter((place) => matchesPlaceFilter(place, filterKey))
    .map((place) => ({ kind: filterKey, type: "landmark", item: place }));
}

// allEntriesForFilterKey, unioned across every active filter -- a /nearby/<slug> group page
// (e.g. /nearby/food) arrives with several filters active at once, not the one a subfilter page
// sets, and the no-location fallbacks below need every one of them listed, not just the first.
// A place matching two active filters at once is listed under each, same as the normal
// with-location path (overviewItemsForActiveFilter) already does -- not deduplicated here either.
function allEntriesForActiveFilters() {
  return state.overviewFilters.flatMap(allEntriesForFilterKey);
}

// One <li> per nearest-list entry -- shared by the normal (has an origin, sorted, distance
// chips) and the no-location /nearby/<slug> fallback (no origin, dataset order, no distance chip:
// walkInfoHtml(undefined) already renders as "") paths below.
function renderNearestItemsHtml(entries) {
  return entries.map((entry) => {
    const name = entry.type === "tree"
      ? treeDisplayName(entry.item)
      : entry.type === "cow"
        ? "Cow"
        : entry.type === "path"
          ? displayValue(entry.item.name || entry.item.ref || "Waymarked trail")
      : entry.type === "water"
        ? entry.item.name
      : placeTitle(entry.item);
    // A place takes its icon from landmarkEmoji (placeIconSlug), the same
    // resolver the map pin uses, so the two always agree. Only the types with
    // no per-place artwork -- cows, trails, water -- are drawn from the kind.
    const emoji = entry.type === "tree"
      ? (treeSpeciesIconHtml(entry.item.commonName, entry.item.latinName) || filterKindEmoji(entry.kind))
      : entry.type === "landmark"
        ? landmarkEmoji(entry.item)
        : (filterKindEmoji(entry.kind) || landmarkEmoji(entry.item));
    const key = entry.type === "tree" ? treeHashKey(entry.item) : entry.type === "cow" ? cowKey(entry.item) : entry.type === "path" ? pathHashKey(entry.item) : entry.type === "water" ? waterHashKey(entry.item) : placeHashKey(entry.item);
    const walkChip = walkInfoHtml(entry.metres);
    const typeLabel = filterMeta(entry.kind)?.label || (entry.type === "tree" ? "Tree" : entry.type === "cow" ? "Cow" : entry.type === "path" ? "Trail" : entry.type === "water" ? "Water" : "Place");
    const treeTag = entry.type === "tree" ? treeTagLabel(entry.item) : null;
    const treeTagChip = treeTag ? ` · #${escapeHtml(treeTag)}` : "";
    const outOfRadiusClass = entry.outOfRadius ? " out-of-radius" : "";
    return `<li><button class="nearest-item${outOfRadiusClass}" type="button" data-overview-type="${entry.type}" data-overview-key="${escapeHtml(key)}">
      <span class="nearest-icon" aria-hidden="true">${emoji}</span>
      <div class="nearest-content">
        <div class="nearest-header">
          <span class="nearest-name">${escapeHtml(name)}</span>
        </div>
        <div class="nearest-footer">
          <span class="nearest-meta">${walkChip ? `${walkChip} · ` : ""}${escapeHtml(typeLabel)}${treeTagChip}</span>
          <span class="nearest-arrow" data-item-lat="${escapeHtml(entry.item.latitude)}" data-item-lon="${escapeHtml(entry.item.longitude)}" aria-hidden="true"${isFarFromForest() ? " hidden" : ""}>↑</span>
        </div>
      </div>
    </button></li>`;
  }).join("");
}

// The Nearby list's rows, with the out-of-radius fallbacks (the nearest match for a selected type that
// has nothing inside the walking radius) grouped after the in-radius rows under one label naming the
// radius. Heads-up ordering can interleave the two -- a close item behind you can outscore a far one
// ahead -- so the split is by the outOfRadius flag, never by position. Without the label the greyed
// rows look disabled rather than "further than you asked for".
function renderNearestItemsWithBeyondLabel(entries) {
  const beyond = entries.filter((entry) => entry.outOfRadius);
  if (!beyond.length) return renderNearestItemsHtml(entries);
  const inRadius = entries.filter((entry) => !entry.outOfRadius);
  const label = `<li class="nearest-beyond-label">Outside the ${formatWalkingRadius(state.walkingDistanceMinutes)} walk</li>`;
  return `${renderNearestItemsHtml(inRadius)}${label}${renderNearestItemsHtml(beyond)}`;
}

// The filter rail at the top of every Nearby view: one toggle pill per category. The plain /nearby screen
// shows top-level groups; a /nearby/<category> landing shows that group's subcategories. A pill
// adds or removes its category from the current (ephemeral) filter set in place -- no screen
// slide -- so the reader can keep tapping round. It replaces the old /nearby/<slug> breadcrumb
// chips; generate-find-pages.js still server-renders anchor chips
// for crawlers and no-JS visitors, and the first render after boot swaps them for this.
// Set by a rail tap so the next selectOverview() patches the rail and list in place rather than
// rebuilding the body, which is what lets pills glide and rows animate individually.
let railPatchPending = false;

function nearbyRailGroup() {
  if (state.nearbyRailGroupKey !== undefined) {
    return state.nearbyRailGroupKey ? FILTER_GROUPS_BY_KEY.get(state.nearbyRailGroupKey) || null : null;
  }
  const match = /^\/nearby\/([a-z0-9-]+)\/?$/.exec(window.location.pathname);
  if (!match) return null;
  const key = match[1].replace(/-/g, "_");
  const group = FILTER_GROUPS_BY_KEY.get(key);
  if (group) return group;
  const subfilter = FILTER_SUBFILTERS_BY_KEY.get(key);
  return subfilter ? FILTER_GROUPS_BY_KEY.get(subfilter.groupKey) : null;
}

function railItems() {
  const group = nearbyRailGroup();
  if (group) {
    return group.subfilters.map((subfilter) => ({
      key: subfilter.key,
      label: subfilter.label,
      icon: subfilter.icon,
      filterKeys: [subfilter.key],
    }));
  }
  return FILTER_GROUPS.map((groupDefinition) => ({
    key: groupDefinition.key,
    label: groupDefinition.label,
    icon: groupDefinition.icon,
    filterKeys: groupDefinition.subfilters.map((subfilter) => subfilter.key),
  }));
}

function railItemIsActive(item) {
  const active = new Set(state.overviewFilters);
  return item.filterKeys.some((key) => active.has(key));
}

// The categories the rail treats as chosen. A set covering every category is the URL-driven
// "show all" state (?filters=false), which reads as nothing chosen so the first tap narrows to
// that one. An empty set is also an explicit show-everything state after the reader switches off
// their last pill; keeping it empty matters because it lets that pill visibly unselect.
function railSelection() {
  const chosen = state.overviewFilters.filter((key) => FILTER_SUBFILTERS_BY_KEY.has(key));
  return chosen.length >= FILTER_SUBFILTERS.length ? [] : chosen;
}

function railPillKeys() {
  return railItems().map((item) => item.key);
}

// The category a rail pill stands for, for holding it open in map setup: a group pill is its own
// group, a subcategory pill is its parent group. The Everything pill is not a category.
function railPillGroupKey(key) {
  const group = FILTER_GROUPS_BY_KEY.get(key);
  if (group) return group.key;
  const subfilter = FILTER_SUBFILTERS_BY_KEY.get(key);
  return subfilter ? subfilter.groupKey : null;
}

// The group pill that is on says how many of its subcategories are on ("2/3"), so the reader can
// see how much of the group they have chosen without opening it. A subcategory pill is one
// category, so it keeps the plain tick.
function filterRailHtml() {
  const allOn = railSelection().length === 0;
  const allStatus = `<span class="rail-check" aria-hidden="true">${allOn ? "✓" : ""}</span>`;
  const allPill = `<button class="rail-pill rail-pill--all${allOn ? " is-on" : ""}" type="button" data-rail-key="all-nearby" aria-pressed="${allOn}">${appIconHtml("nearby")}<span>Everything</span>${allStatus}</button>`;
  const groupLevel = !nearbyRailGroup();
  const activeKeys = new Set(state.overviewFilters);
  const pills = railItems().map((item) => {
    const on = railItemIsActive(item);
    if (groupLevel) {
      const shown = item.filterKeys.filter((key) => activeKeys.has(key)).length;
      const total = item.filterKeys.length;
      // The count is always shown, so "0/4" reads on a group that is off too, and the tick slot is
      // always reserved. Both are present in every state, so the pill keeps one width when it is
      // switched on or off; the tabular figures keep "0/4" and "4/4" the same width.
      const count = `<span class="rail-count${on ? "" : " is-off"}" aria-hidden="true">${shown}/${total}</span>`;
      const status = `${count}<span class="rail-check" aria-hidden="true">${on ? "✓" : ""}</span>`;
      const label = `${escapeHtml(item.label)}: ${shown} of ${total} categories shown`;
      return `<button class="rail-pill${on ? " is-on" : ""}" type="button" data-rail-key="${item.key}" aria-pressed="${on}" aria-label="${label}" title="Hold to choose ${escapeHtml(item.label)} categories">${appIconHtml(item.icon)}<span>${escapeHtml(item.label)}</span>${status}</button>`;
    }
    const status = `<span class="rail-check" aria-hidden="true">${on ? "✓" : ""}</span>`;
    return `<button class="rail-pill${on ? " is-on" : ""}" type="button" data-rail-key="${item.key}" aria-pressed="${on}">${appIconHtml(item.icon)}<span>${escapeHtml(item.label)}</span>${status}</button>`;
  }).join("");
  return `<nav class="filter-rail" aria-label="Filter nearby places">` +
    `<div class="rail-pills">${allPill}${pills}</div>` +
    `</nav>`;
}

// Where the address bar points after a rail pick: plain /nearby. A pick saves the filter set, so there is
// no ?show= to write (searchStringForPath only writes one for a view, such as an old ?show= link), and a
// rail pick never writes a category landing path (/nearby/<slug>), which stays a real arrival. Replaces
// the current history entry (a tap is a refinement, not a new place to go back to).
function syncRailUrl() {
  if (routeApplyDepth > 0 || routerBooting) return;
  const url = `${NEARBY_PATH}${searchStringForPath(NEARBY_PATH)}${window.location.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return;
  history.replaceState(history.state, "", url);
}

// Saves a filter set: the reader's own choice, which persists and moves a view (a landing or an old ?show=
// link) to plain /nearby.
function saveFilterSet(nextFilters, { railTap = false } = {}) {
  setOverviewFilters(nextFilters, { persist: true, railTap });
  syncRailUrl();
}

function filterKeysEqual(first, second) {
  const left = Array.from(new Set(first)).sort();
  const right = Array.from(new Set(second)).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

// Applies the set Map setup or a held pill's dialog ends with. The dialog starts from the saved set, so
// a set that matches it changed nothing: nothing is saved, and the screen (a landing's list, or any
// other view) and the URL stay as they are. Only a real change saves, and a save moves a view to plain
// /nearby.
// Returns whether it saved, so a caller can tell a no-change close (the screen stays as it was) from a save.
// Switching every chip off is not a set the reader can keep: an empty set saves every category, the same as
// un-pressing the last rail pill.
function applyStagedFilterSet(stagedFilters) {
  const next = stagedFilters.length > 0 ? stagedFilters : Array.from(ALL_OVERVIEW_FILTER_KEYS);
  if (filterKeysEqual(next, loadStoredOverviewFilters())) return false;
  saveFilterSet(next);
  return true;
}

function toggleRailFilter(key) {
  if (key === "all-nearby") {
    if (typeof navigator.vibrate === "function") navigator.vibrate(8);
    const displayedGroup = nearbyRailGroup();
    state.nearbyRailGroupKey = displayedGroup ? displayedGroup.key : null;
    saveFilterSet(Array.from(ALL_OVERVIEW_FILTER_KEYS), { railTap: true });
    return;
  }
  const displayedGroup = nearbyRailGroup();
  const item = railItems().find((candidate) => candidate.key === key);
  if (!item) return;
  state.nearbyRailGroupKey = displayedGroup ? displayedGroup.key : null;
  // The tap edits what is shown on screen. On a category landing that is the landing's own category set;
  // elsewhere it is the current set. Either way the result is saved.
  const current = new Set(state.overviewFilters.filter((filterKey) => FILTER_SUBFILTERS_BY_KEY.has(filterKey)));
  const showingAll = current.size === 0 || current.size >= FILTER_SUBFILTERS.length;
  // The tapped pill toggles within that set: off if any of its categories is in it, on otherwise.
  const active = item.filterKeys.some((filterKey) => current.has(filterKey));
  let next;
  if (showingAll) {
    next = item.filterKeys.slice();
  } else if (active) {
    item.filterKeys.forEach((filterKey) => current.delete(filterKey));
    next = Array.from(current);
  } else {
    item.filterKeys.forEach((filterKey) => current.add(filterKey));
    next = Array.from(current);
  }
  // Un-pressing the last pill selects Everything rather than saving an empty set. The Everything pill
  // then shows as pressed, and the list stays populated.
  if (next.length === 0) next = Array.from(ALL_OVERVIEW_FILTER_KEYS);
  if (typeof navigator.vibrate === "function") navigator.vibrate(8);
  saveFilterSet(next, { railTap: true });
}

function overviewCategoryContentHtml(content) {
  const categoryLabel = nearbyCategoryLabel();
  if (!categoryLabel) return content;
  const heading = `${categoryLabel} nearby`;
  return `<section class="nearby-category-results" aria-labelledby="nearbyResultsHeading"><h3 id="nearbyResultsHeading">${escapeHtml(heading)}</h3>${content}</section>`;
}

function overviewNearestHtml() {
  const navigationHtml = filterRailHtml();
  if (!state.userLocation) {
    // A /nearby/<slug> category page -- a subfilter's own, or a whole group's -- lands here with
    // no location yet (no prompt answered, or declined), as does a reader who has deliberately
    // narrowed to one filter of their own -- list what it actually contains rather than the
    // generic "use your location" prompt, which would otherwise hide real, specific content
    // (the whole point of a /nearby/<slug> page) behind a request nobody has answered. See
    // activeFiltersShowFullListWithoutLocation's comment for exactly which filter sets this
    // covers, and why the default boot state must not also take this branch.
    if (activeFiltersShowFullListWithoutLocation()) {
      const entries = allEntriesForActiveFilters();
      if (entries.length) {
        return `${navigationHtml}${overviewCategoryContentHtml(`<p class="source-note">Enable location to sort these by distance and get walking directions.</p><ul class="nearest-list">${renderNearestItemsHtml(entries)}</ul>`)}`;
      }
    }
    return `${navigationHtml}${overviewCategoryContentHtml(`<p class="empty">Use your location to list the nearest trees, cows, cafés, transport links, pubs, and landmarks.</p>`)}`;
  }

  // The "showing places near where you tapped / use my location" notice is no longer part of
  // this list -- it is the persistent #nearbyAnchorBar in the inspector chrome, so it stays
  // reachable from Filters/Settings/Report too (updateNearbyAnchorBar, js/nav.js).

  // applyDefaultLocation()'s High Beach stand-in used to get its own "why is this centred on
  // High Beach?" notice here, separate from the heading. It's folded into overviewHeadingText()'s
  // own "within 30 min walk of High Beach" instead now -- the type line under the Nearby heading
  // already answers that, for as long as the stand-in is what the list is actually measuring
  // from, without a second sentence saying the same thing underneath it.

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
      return `${navigationHtml}${overviewCategoryContentHtml(`<p class="empty">Selected map layers are shown on the map. Add Trees, Cows, or another point filter to list nearby items.</p>`)}`;
    }
    if (activePointFilters.length === 1) {
      const meta = filterMeta(activePointFilters[0]);
      return `${navigationHtml}${overviewCategoryContentHtml(`<p class="empty">No nearby ${escapeHtml(meta ? meta.title : "items")} found.</p>`)}`;
    }
    return `${navigationHtml}${overviewCategoryContentHtml(`<p class="empty">No nearby places found.</p>`)}`;
  }


  const itemsHtml = renderNearestItemsWithBeyondLabel(entries);

  const fallbackNotice = state.overviewOutsideRadiusFallback
    ? `<p class="source-note"><strong>Nothing found within ${formatWalkingRadius(state.walkingDistanceMinutes)} walking distance.</strong><br><small>Showing the closest match for each selected type instead.</small></p>`
    : "";
  const radiusActive = !state.showAllOutsideRadius;
  const chipTitle = radiusActive
    ? `Showing within ${formatWalkingRadius(state.walkingDistanceMinutes)} walk — tap to show all`
    : `Showing all distances — tap to filter to ${formatWalkingRadius(state.walkingDistanceMinutes)} walk`;
  const chipLabel = radiusActive ? formatWalkingRadius(state.walkingDistanceMinutes) : "All";
  const walkChip = `<button class="walk-chip walk-chip-toggle${radiusActive ? "" : " walk-chip-toggle--off"}" type="button" data-action="toggle-radius" aria-pressed="${radiusActive}" title="${chipTitle}"><span class="walk-time">${chipLabel}</span> ${appIconHtml("walking", "app-icon walk-icon")}</button>`;
  return `${navigationHtml}${overviewCategoryContentHtml(`${floorNotice}${fallbackNotice}<ul class="nearest-list">${itemsHtml}</ul>`)}`;
}

// The icon the Nearby list, search results and cluster detail show for a
// place. placeIconSlug() is the same resolver the map pins use, so a place
// reads identically wherever it appears -- it used to consult the filter
// buckets before the tag rules and could disagree with its own pin, listing
// an archaeological site under the generic castle while the map drew the
// amphora.
function landmarkEmoji(place) {
  const slug = placeIconSlug(place);
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

function directionTextFor(item) {
  if (!state.userLocation || !item || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return null;
  const bearing = bearingDegrees(state.userLocation.latitude, state.userLocation.longitude, item.latitude, item.longitude);
  return `${bearingCardinal(bearing)} (${Math.round(bearing)}°)`;
}

async function startCompassNavigation({ fromGesture = Boolean(navigator.userActivation?.isActive) } = {}) {
  // A default location is only a map-centering stand-in. Do not ask for compass access, or
  // show its blocking permission gate, until the visitor has shared a real position. The
  // no-location view already explains this in its source note and remains fully browseable.
  if (!canGuideToPlaces()) {
    updateCompassOverlay();
    return;
  }
  if (!selectedCompassTarget()) {
    updateCompassOverlay();
    return;
  }

  ensureLocationWatch();

  await requestCompassPermissionIfNeeded({ fromGesture });

  updateCompassOverlay();
}

// False inside the native shell, where motion access is the shell's to grant (Native.unlockMotionOnFirstGesture)
// and there is nothing to ask the user.
function compassPermissionCanBeRequested() {
  return Native.compassNeedsPrompt
    && typeof DeviceOrientationEvent !== "undefined"
    && typeof DeviceOrientationEvent.requestPermission === "function";
}

async function requestCompassPermissionIfNeeded({ fromGesture = false } = {}) {
  if (typeof DeviceOrientationEvent === "undefined") {
    if (fromGesture && state.userLocation) {
      const message = "Compass is not available on this device or browser. You can still use the map and tap any tree to see its distance.";
      setStatus(message);
    }
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission !== "function" || !Native.compassNeedsPrompt) {
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
    if (state.compassPermission === "granted") {
      reattachCompassListeners();
    }
  } catch {
    state.compassPermission = "denied";
    try {
      localStorage.setItem(COMPASS_PERMISSION_KEY, "denied");
    } catch {}
  }
}

function compassPermissionRequiresRequest() {
  return state.compassPermission !== "granted";
}

function setupCompassListeners() {
  reattachCompassListeners();
  Native.unlockMotionOnFirstGesture(reattachCompassListeners);
  startNativeHeading();
}

// Inside the app shell the heading comes from the native true-north plugin (Native.heading), the
// best source there is: once it delivers, WebKit's own orientation events still feed beta for the
// tilt but never the heading (onDeviceOrientation drops a worse source). Idempotent, so foreground
// resume can call it again after the plugin was stopped for the background.
function startNativeHeading() {
  if (!Native.heading) return;
  Native.heading.start(onNativeHeading);
}

function onNativeHeading(reading) {
  if (!reading) return;
  // Negative accuracy means invalid, not merely imprecise. Agreement between invalid
  // samples cannot calibrate them, and they must not refresh the last valid heading.
  const accuracy = reading.accuracy;
  if (!Number.isFinite(accuracy) || accuracy < 0) return;
  const heading = Number.isFinite(reading.trueHeading) && reading.trueHeading >= 0
    ? reading.trueHeading
    : reading.magneticHeading;
  if (!Number.isFinite(heading) || heading < 0) return;
  if (state.compassHeadingSource < HEADING_SOURCE_NATIVE) {
    state.compassHeadingSource = HEADING_SOURCE_NATIVE;
    discardCompassHeadingFromWorseSource();
  }
  applyCompassReading(heading % 360, { trusted: accuracy <= NATIVE_HEADING_TRUSTED_ACCURACY_DEG });
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

// Whether the walker has actually gone anywhere since the tab was last backgrounded
// (pauseBackgroundedTracking snapshots the fix at that moment). Compared against the
// 30m floor (LOCATION_SMOOTHING_SNAP_METRES) that ingestLocationFix applies to a fix after a gap,
// to tell a genuine relocation from wander. It is not the accuracy-scaled threshold used between
// consecutive fixes. No baseline or no current fix -- e.g. location was never granted -- is
// treated as "can't tell", which
// falls back to the old, safer assumption that the heading may no longer be trustworthy.
function hasMovedSinceBackgrounding() {
  const before = state.backgroundedUserLocation;
  const current = state.userLocation;
  if (!before || !current) return true;
  const movedMetres = distanceMetres(before.latitude, before.longitude, current.latitude, current.longitude);
  return !Number.isFinite(movedMetres) || movedMetres >= LOCATION_SMOOTHING_SNAP_METRES;
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
  // The native heading does not stall the way WebKit's events do, and it is restarted on every
  // return to the foreground (startNativeHeading): nothing here would help it.
  if (state.compassHeadingSource === HEADING_SOURCE_NATIVE) return;
  if (!compassSensorStalled(now)) return;

  // Drop a heading we can no longer trust so the map falls back to north-up rather than
  // rendering a frozen rotation as if it were live. New readings go back through the
  // calibration gate before rotation (and with it tilt, which headingUpActive() gates)
  // resumes.
  //
  // Only when the walker has actually moved, though (hasMovedSinceBackgrounding): a phone
  // that was simply put down for a while has a stalled sensor but an unchanged position, and
  // the last heading is still a perfectly good guess -- clearing it anyway was what made
  // returning to the app spin the map back to north and re-rotate to the same heading it
  // already had, with no movement to justify it. Left alone, later orientation events still
  // ease the heading toward the truth via the ordinary smoothing tick (startCompassSmoothing),
  // just without the jarring reset in between.
  if (Number.isFinite(state.compassHeading) && hasMovedSinceBackgrounding()) {
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
  state.compassViewportAlignmentAt = null;
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
// Each loop stamps when it requests a frame. Loops that retain their handle while rendering
// also retain the stamp until they finish, so an exception remains detectable by the watchdog.
// A request still pending ANIMATION_FRAME_WEDGED_MS later is a wedge by definition.
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
  startNativeHeading();
  syncNativeWalkingAids();

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
  // Nothing native is held while the app is in the background: no sensor, no awake screen.
  if (Native.heading) Native.heading.stop();
  Native.keepAwake.set(false);
  // Snapshot where we were right before going away, so recoverStalledCompass can tell a
  // phone that was actually carried somewhere from one that was simply put down -- see
  // hasMovedSinceBackgrounding().
  state.backgroundedUserLocation = state.userLocation
    ? { latitude: state.userLocation.latitude, longitude: state.userLocation.longitude }
    : null;
  if (Native.geolocation && state.locationWatchId != null) {
    Native.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
  }
  if (typeof stopLocationTracking === "function") stopLocationTracking();
}

function restartStaleGpsWatch() {
  if (!Native.geolocation || state.locationWatchId == null) return;
  const gpsAge = state.lastLocationUpdateAt == null
    ? Infinity
    : (performance.now() - state.lastLocationUpdateAt);
  if (gpsAge > 20000) {
    Native.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
    ensureLocationWatch();
  }
}

// Constants controlling the "settle before trusting" compass calibration gate below.
const COMPASS_TARGET_DEADBAND_DEG = 1.5; // raw readings closer than this to the current target are ignored
const COMPASS_PITCHING_DEADBAND_DEG = 3; // wider heading deadband while beta is still moving
const COMPASS_UPRIGHT_EXTRA_DEADBAND_DEG = 3; // extra heading deadband at a fully upright phone (pitch 90deg), scaled by (pitch/90)^2
const COMPASS_PITCHING_THRESHOLD_DEG = 1; // pitch still easing by more than this counts as the phone being pitched
const COMPASS_DEADBAND_RELAX_MS = 1500; // a reading held inside the deadband this long is accepted, so a still phone settles on the true heading
const BETA_TARGET_DEADBAND_DEG = 1; // raw pitch readings closer than this to the target are ignored
const COMPASS_SMOOTHING_MIN_RATE = 2.5; // 1/s filter rate for tiny remaining angles (sensor jitter)
const COMPASS_SMOOTHING_MAX_RATE = 14; // 1/s filter rate for a deliberate turn
const COMPASS_SMOOTHING_FAST_DEG = 40; // remaining angle at which the full rate applies
const COMPASS_CALIBRATION_WINDOW_MS = 900; // trailing window of raw readings used to judge stability
const COMPASS_CALIBRATION_STABLE_SPREAD_DEG = 6; // max spread within the window before we trust it
const COMPASS_CALIBRATION_MIN_SAMPLES = 4; // minimum readings required within the window
const COMPASS_CALIBRATION_PROMPT_DELAY_MS = 1500; // how long to stay unstable before nudging the user
const COMPASS_CALIBRATION_MAX_WAIT_MS = 6000; // safety valve -- never block heading-up forever

// How far a raw heading must move from the current target before it counts as a turn. While the
// phone is being pitched, heading readings cross-talk with the tilt, so it widens; a raised phone
// approaches gimbal lock, where the heading is noisy even when held still, so it also grows with
// pitch. Capped at COMPASS_PITCHING_DEADBAND_DEG + COMPASS_UPRIGHT_EXTRA_DEADBAND_DEG.
function compassTargetDeadbandDeg() {
  const pitching = Math.abs(state.tiltBetaTarget - state.tiltBetaSmoothed) > COMPASS_PITCHING_THRESHOLD_DEG;
  const upright = Math.pow(clamp(state.tiltBetaSmoothed / 90, 0, 1), 2);
  return (pitching ? COMPASS_PITCHING_DEADBAND_DEG : COMPASS_TARGET_DEADBAND_DEG)
    + upright * COMPASS_UPRIGHT_EXTRA_DEADBAND_DEG;
}

// Filter rate (1/s) for easing compassHeading toward its target: low for a small remaining angle
// (sensor jitter), rising to the full rate at COMPASS_SMOOTHING_FAST_DEG and beyond (a real turn).
function compassSmoothingRate(remainingDeg) {
  const turn = Math.min(Math.abs(remainingDeg), COMPASS_SMOOTHING_FAST_DEG) / COMPASS_SMOOTHING_FAST_DEG;
  return COMPASS_SMOOTHING_MIN_RATE + (COMPASS_SMOOTHING_MAX_RATE - COMPASS_SMOOTHING_MIN_RATE) * turn;
}

function onDeviceOrientation(event) {
  // Tracked separately from compassLastEventAt (set below, and only for events carrying
  // a usable heading) so recoverStalledCompass can tell a suspended sensor -- which
  // re-registering the listeners can wake -- from a live sensor whose magnetometer has
  // lost its heading, which it cannot.
  state.orientationLastEventAt = performance.now();
  const rawBeta = event.beta;
  if (Number.isFinite(rawBeta)) {
    const nextBeta = clamp(Math.abs(rawBeta), 0, 90);
    // Deadband: sub-degree pitch wobble would otherwise re-project the tilted map every frame.
    if (Math.abs(nextBeta - state.tiltBetaTarget) >= BETA_TARGET_DEADBAND_DEG) state.tiltBetaTarget = nextBeta;
    // Beta drives the 3D tilt by itself, but only startCompassSmoothing's loop eases
    // tiltBetaSmoothed toward it. Pitch is useful even while the magnetometer is still
    // calibrating (or when a browser exposes beta but not a north-referenced heading), so the
    // smoothing loop is intentionally started from beta alone. The loop keeps the map north-up
    // until a heading becomes trustworthy, but the Z axis and 3D camera remain responsive.
    startCompassSmoothing();
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
  applyCompassReading(heading);
}

// A heading reading from whichever source is currently feeding the compass. Until one is trusted,
// readings go through the calibration gate; `trusted` skips it for a reading whose own reported
// accuracy already says it is good (the native heading plugin's), which is what lets a native
// heading rotate the map at once instead of waiting for several readings to agree.
function applyCompassReading(heading, { trusted = false } = {}) {
  // A usable heading proves access, even when Safari's stored grant was reset on launch.
  // Sensor startup/calibration can be slow; neither should cause another permission request.
  if (state.compassPermission !== "granted") {
    state.compassPermission = "granted";
    try { localStorage.setItem(COMPASS_PERMISSION_KEY, "granted"); } catch {}
  }
  state.compassLastEventAt = performance.now();

  if (!Number.isFinite(state.compassHeading) && trusted) {
    completeCompassCalibration(heading);
    return;
  }

  if (Number.isFinite(state.compassHeading)) {
    // Already trust a heading -- keep tracking the live target as before.
    // Deadband: sub-degree sensor wobble is not a turn, so it never moves the target.
    const deadband = compassTargetDeadbandDeg();
    // A reading inside the deadband is wobble -- unless nothing has moved the target for a while,
    // in which case the phone is simply being held still and the target should settle on it.
    const quietFor = performance.now() - (state.compassTargetMovedAt || 0);
    if (!Number.isFinite(state.compassHeadingTarget)
        || Math.abs(shortestCompassDelta(state.compassHeadingTarget, heading)) >= deadband
        || quietFor >= COMPASS_DEADBAND_RELAX_MS) {
      if (heading !== state.compassHeadingTarget) state.compassTargetMovedAt = performance.now();
      state.compassHeadingTarget = heading;
    }
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
  state.compassTargetMovedAt = performance.now();
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
  if (els.compassCalibrationBannerText) {
    els.compassCalibrationBannerText.hidden = false;
    els.compassCalibrationBannerText.textContent = "Move your phone in a figure-8 to help it find your direction";
  }
  els.compassCalibrationBanner.classList.remove("fading-out");
  els.compassCalibrationBanner.hidden = false;
}

function hideCompassCalibrationPrompt() {
  state.compassCalibrationPromptVisible = false;
  if (!els.compassCalibrationBanner) return;
  hideWithFade(els.compassCalibrationBanner);
}

// --- Nearby-event alert ---
// In-app only (no OS push): a banner, not a modal, so it never interrupts whatever screen is
// open. Checked on every GPS fix (ensureLocationWatch) rather than against a timer, so it fires
// the moment a walk actually brings someone into range of something happening right now.

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
    // Keep the watchdog timestamp until this frame completes or queues its successor.
    // A render error must leave evidence of the stranded handle so recovery can restart it.
    _overlapRectCache = undefined;
    _tiltProjectionCache = undefined;
    _nearbyRenderOriginCache = undefined;
    const hasHeading = Number.isFinite(state.compassHeadingTarget) && Number.isFinite(state.compassHeading);
    const hasBetaWork = Math.abs(state.tiltBetaTarget - state.tiltBetaSmoothed) >= 0.05;
    if (!hasHeading && !hasBetaWork) {
      state.compassAnimationFrame = null;
      state.compassAnimationFrameRequestedAt = null;
      state.compassAnimationTime = null;
      return;
    }

    const previousTime = state.compassAnimationTime == null ? timestamp : state.compassAnimationTime;
    const dt = Math.min(0.05, Math.max(0.001, (timestamp - previousTime) / 1000));
    state.compassAnimationTime = timestamp;
    const previousHeading = state.compassHeading;

    if (hasHeading) {
      const delta = shortestCompassDelta(state.compassHeading, state.compassHeadingTarget);
      // Fixed rate 14 (70ms time constant) passed raw sensor noise straight to the screen.
      // Ease the rate with the remaining angle: small wobble is heavily damped, a real turn
      // still catches up quickly.
      const rate = compassSmoothingRate(delta);
      const smoothing = 1 - Math.exp(-rate * dt);
      const nextHeading = state.compassHeading + (delta * smoothing);
      state.compassHeading = nextHeading;
    }

    // Slower than the compass heading filter above (rate 14): beta gates pin/pointer
    // collapse (tiltInfluence) as well as the rotateX camera tilt, and a phone lifts
    // through the whole 0-12deg dead zone quickly, so a fast filter here reads as the
    // collapsing map pins snapping to size rather than easing in.
    const betaDiff = state.tiltBetaTarget - state.tiltBetaSmoothed;
    state.tiltBetaSmoothed += betaDiff * (1 - Math.exp(-4 * dt));

    const tiltNeedsFullRedraw = tiltRenderStale();
    // Beta-only tilt is supported before the compass has a usable heading. The map overlay
    // still moves through the 3D projection in that state, so refresh its directional arrows
    // too; otherwise they would keep their last flat bearing until heading calibration finishes.
    if (hasHeading || hasBetaWork) {
      updateOverviewDirectionArrows();
      updateCompassOverlay();
      if (hasHeading) refreshNearbyListForHeading();
    }
    const alignmentDue = state.compassViewportAlignmentAt == null
      || timestamp - state.compassViewportAlignmentAt >= 33;
    // A heading changes the rotation every frame, but the fit only needs solving often enough
    // to follow meaningful movement. Beta-only tilt needs a solve when the baked perspective
    // has moved enough to warrant repainting. This keeps the expensive fit math out of the
    // tight sensor loop without delaying a real camera correction.
    const shouldAlignViewport = navigationAnchorActive()
      && ((hasHeading && (alignmentDue || (previousHeading != null
        && Math.abs(shortestCompassDelta(previousHeading, state.compassHeading)) > 1)))
        || (!hasHeading && tiltNeedsFullRedraw));
    let viewportChanged = false;
    if (shouldAlignViewport) {
      viewportChanged = alignHeadingUpNavigationViewport();
      state.compassViewportAlignmentAt = timestamp;
    }
    if (headingUpActive()) {
      updateHeadingUpCanvasRotationTransform();
    }
    // In flat heading-up mode the map canvas is already rotated with CSS and the moving
    // pins/compass live on the overlay. In beta-only tilt mode the same overlay path applies
    // until the baked terrain projection has moved enough to need a repaint. Repainting the
    // entire terrain for every heading sample was the main source of the visible step/jitter.
    if (viewportChanged || tiltNeedsFullRedraw) requestDraw();
    else if (typeof drawOverlay === "function") drawOverlay();

    const remaining = hasHeading
      ? Math.abs(shortestCompassDelta(state.compassHeading, state.compassHeadingTarget))
      : 0;
    const lastEventAge = state.compassLastEventAt == null ? Infinity : (timestamp - state.compassLastEventAt);
    const sensorIsActive = lastEventAge < HEADING_UP_SENSOR_ACTIVE_MS;
    const betaSettled = Math.abs(state.tiltBetaTarget - state.tiltBetaSmoothed) < 0.1;
    if (!hasHeading && betaSettled) {
      if (tiltActive()) requestDraw();
      state.compassAnimationFrame = null;
      state.compassAnimationFrameRequestedAt = null;
      state.compassAnimationTime = null;
      return;
    }
    if (hasHeading && remaining < 0.05 && !sensorIsActive && betaSettled) {
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
      state.compassAnimationFrameRequestedAt = null;
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
  if (!Native.geolocation || state.locationWatchId != null) return;
  startLocationTracking();
  state.locationWatchId = Native.geolocation.watchPosition(
    (position) => {
      state.lastLocationUpdateAt = performance.now();
      const { latitude, longitude } = position.coords;
      const { previousPoint } = applyLocationFix(position, {
        // Once a destination is selected, a live GPS update only changes the route origin.
        // Clearing the destination here makes the route disappear immediately after the
        // one-shot location request hands over to watchPosition.
        preserveSelection: Boolean(state.selected?.item),
      });
      if (Native.heading) Native.heading.setLocation(latitude, longitude);
      const point = state.userLocation.point;
      state.userInMapArea = pointInsideBounds(point, state.bounds);
      updateFarFromForest(latitude, longitude);
      checkEventProximityAlert(latitude, longitude);
      if (typeof communityNudgeCheck === "function") communityNudgeCheck();
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
        // Do not let the first watch callback replace the cinematic High Beach -> GPS fly-to
        // with its ordinary short GPS-follow refit. The fly-to already targets this fix; later
        // callbacks resume the normal follow once it has landed.
        if (!state.locationRevealAnimationActive) {
          ensureUserAndSelectionVisible({ animate: true, durationMs: 200 });
        }
        keepOverviewCenteredOnUser(previousPoint);
        updateCompassOverlay();
        requestDraw();
      }
    },
    (error) => {
      if (error && error.code === 1) {
        // Permission revoked mid-session — clear the watch. No blocking gate: the app stays
        // usable on the last fix it had (or the High Beach stand-in) rather than forcing a
        // retry wall for a permission that was never required in the first place.
        Native.geolocation.clearWatch(state.locationWatchId);
        state.locationWatchId = null;
      }
      // Timeout / position-unavailable: watchPosition continues automatically.
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 1500 }
  );
}

function selectedCompassTarget() {
  if (!state.selected) return null;
  if (state.selected.type === "tree" || state.selected.type === "landmark" || state.selected.type === "cow" || state.selected.type === "path" || state.selected.type === "water" || state.selected.type === "environment") return state.selected.item;
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

// A flat bearing is enough for the compass and list arrows while the map is flat, but it is
// not the direction a person sees once the ground has been projected into 3D: points at different
// distances are pulled toward the horizon by different amounts. Use the same projected screen
// positions as the map overlays so every directional arrow agrees with the terrain beneath it.
function directionArrowAngleForWorldPoint(targetPoint, fallbackAngle, previousAngle = null) {
  if (!(typeof tiltActive === "function" && tiltActive()) || !state.userLocation?.point || !targetPoint) {
    return fallbackAngle;
  }
  if (typeof worldToScreenForOverlayTilted !== "function") return fallbackAngle;

  const origin = worldToScreenForOverlayTilted(state.userLocation.point);
  const target = worldToScreenForOverlayTilted(targetPoint);
  // A clipped target is behind the camera's near plane. Its clamped coordinates are only a
  // safety bound, not a real screen position; hold the last valid projected direction so the
  // arrow does not jump to an artificial angle or back to a flat bearing at the clip boundary.
  // The same hold handles a user point clipped while browsing around a distant anchor.
  if (origin.clipped || target.clipped) return Number.isFinite(previousAngle) ? previousAngle : fallbackAngle;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.001) return fallbackAngle;
  return normalizeDegrees(Math.atan2(dx, -dy) * 180 / Math.PI);
}

// The directional arrows are DOM glyphs rather than canvas pins, so give them the same visible
// ground-plane treatment as the map while tilt is active. The angle above is the projected ray;
// this transform also foreshortens the glyph itself instead of leaving a flat 2D arrow floating
// over a perspective map.
function directionArrowTransform(angle) {
  if (!(typeof tiltActive === "function" && tiltActive())) return `rotate(${angle}deg)`;
  const rotateX = typeof tiltRotateXDeg === "function" ? tiltRotateXDeg() : 0;
  // worldToScreenForOverlayTilted() has already populated the per-frame projection
  // snapshot before callers get here. Reuse its camera distance instead of asking
  // tiltPerspectivePx() to repeat the layout-heavy visible-rect calculation once for
  // every arrow in the same compass frame.
  const projection = typeof tiltProjection === "function" ? tiltProjection() : null;
  const perspective = projection?.perspectivePx
    ?? (typeof tiltPerspectivePx === "function" ? tiltPerspectivePx() : 1000);
  // The ray angle already includes the map's perspective projection. Compensate the arrow's
  // local rotation for the following rotateX so foreshortening changes the glyph shape without
  // tilting its final screen direction a second time.
  const radians = angle * Math.PI / 180;
  const compensatedAngle = Math.atan2(
    Math.sin(radians) * Math.cos(rotateX * Math.PI / 180),
    Math.cos(radians),
  ) * 180 / Math.PI;
  return `perspective(${perspective}px) rotateX(${rotateX}deg) rotate(${compensatedAngle}deg)`;
}

// The projected ray can move by several screen degrees when a target is close to the
// perspective horizon. Ease the DOM glyph toward that ray as well as easing the sensor
// values, so a tiny beta/heading fluctuation cannot make a 3D arrow twitch.
function smoothDirectionArrowAngle(previousAngle, targetAngle) {
  if (!Number.isFinite(targetAngle) || !Number.isFinite(previousAngle)) return targetAngle;
  return previousAngle + shortestCompassDelta(previousAngle, targetAngle) * 0.2;
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

// Same hysteresis as the scale fit above, applied to the balanced navigation anchor
// (balancedNavigationAnchorY/headingUpAnchorFraction) instead of the scale -- see
// resolveHeadingUpAnchorFraction. Both mirror the vertical anchor toward whichever side of the
// screen the destination/route actually needs, using the bearing (or ahead/behind split)
// relative to the *live, rotating* heading -- so simply turning on the spot, with neither
// the walker nor the destination moving an inch, swaps points between "ahead" and "behind"
// and slides the anchor -- and with it the user's own marker -- up and down the screen.
// Reported as the user's position bobbing while rotating, "even when it's not helping at
// all with navigation".
//
// Safe to hold inside a deadband exactly like the scale is: maxHeadingUpNavigationScale
// always re-solves the scale against whatever anchor is actually in use (it takes `focus`
// as an argument rather than recomputing it), so the destination never runs off-screen
// while the anchor itself sits still -- there is no separate "urgent" snap to add here, the
// existing scale fit already is one.
const HEADING_UP_ANCHOR_HOLD_RATIO = 0.12; // deadband, as a fraction of the focus rect's height

// Far from the forest the map still turns with the compass for a selected place, pivoting on the
// High Beach stand-in (navigationOriginPoint) rather than the real fix. No directions are offered
// there (canGuideToPlaces), so this only rotates the view.
function selectedNavigationHeadingUpActive() {
  return Boolean(
    state.userLocation
    && selectedCompassTarget()
    && Number.isFinite(state.compassHeading)
  );
}

// The point heading-up navigation pivots on and measures bearings from: the real fix, or the High
// Beach stand-in while far from the forest, so the view is framed as if the visitor were there.
function navigationOriginPoint() {
  return isFarFromForest() ? highBeachStandIn().point : state.userLocation.point;
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
  return Boolean(state.userLocation && !selectedCompassTarget() && !communityFramesOwnMarksOnly());
}

// The Community screen is about what the user has marked, so for someone who is not at the forest the
// camera ignores where they are (it is nowhere near the map) and frames their own marks instead.
function communityFramesOwnMarksOnly() {
  return Boolean(state.selected && state.selected.type === "community" && hasRealLocation() && !state.userInMapArea);
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
//
// The *basis* above (selected-navigation vs nearby) can itself flip between two calls -- a
// selection is made or cleared -- which switches this function from one of those sources to
// the other outright, with no slide of its own the way nearbyRenderOriginPoint() already gives
// a browse-anchor move. Left alone, the heading-up rotation and 3D tilt -- everything
// worldToScreen() projects around -- jump straight to the new basis on the very next frame,
// well before the selection's own camera ease even starts (it is still waiting on the inspector
// to settle): reported as "very jumpy" selecting an item while browsing a nearby area that is
// not nearby, since that is exactly when the two bases (the browsed anchor and the real GPS fix)
// sit furthest apart. state.cameraOriginTransition, started by startCameraOriginTransition()
// just before a caller flips the basis, smooths this the same way: this function eases the
// logical point in from wherever it was last actually drawn rather than returning it outright.
// useFinalBrowseState: see tiltRampedAnchor's comment -- skips both this function's own
// basis-switch ease (state.cameraOriginTransition) and nearbyRenderOriginPoint's browse-origin
// slide, returning the real destination point outright. Without it, the camera origin fed
// into an animate:true fit (nearbyPivotFitScale's originPoint, and this function's own
// userPoint in alignHeadingUpNavigationViewport) was wherever the slide happened to be at the
// instant the fit was solved -- not where it was headed -- which bent the fit (and the
// tx/ty built from it) around a point the camera was about to move away from.
function cameraOriginPoint(useFinalBrowseState = false) {
  const logical = selectedNavigationHeadingUpActive()
    ? navigationOriginPoint()
    : (useFinalBrowseState
      ? ((nearbyOrigin() && nearbyOrigin().point) || (state.userLocation ? state.userLocation.point : null))
      : (nearbyRenderOriginPoint() || (state.userLocation ? state.userLocation.point : null)));
  if (!logical) return logical;
  if (useFinalBrowseState) return logical;
  const transition = state.cameraOriginTransition;
  if (!transition) return logical;
  const progress = clamp((performance.now() - transition.startedAt) / transition.durationMs, 0, 1);
  if (progress >= 1) {
    state.cameraOriginTransition = null;
    return logical;
  }
  // Same cubic ease-in-out moveCamera and nearbyRenderOriginPoint use, so this reads as
  // the same family of motion as every other camera move in the app.
  const eased = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  return {
    x: transition.fromX + (logical.x - transition.fromX) * eased,
    y: transition.fromY + (logical.y - transition.fromY) * eased,
  };
}

// Captures cameraOriginPoint()'s current pivot and schedules a slide from it, for a caller
// that is about to flip the basis above -- making a selection, or clearing one -- partway
// through its own body. Call this before state.selected changes (and before any other state
// that feeds selectedNavigationHeadingUpActive()/nearbyOrigin() does), mirroring how
// startNearbyOriginTransition is called before state.nearbyAnchor changes.
function startCameraOriginTransition() {
  // Keep a render-only snapshot of the set that is leaving. Hit testing still switches to the
  // destination lookup immediately, but the old pins can now fade out in order instead of
  // disappearing as one opaque slab and leaving a blank map under the camera move.
  state.selectionTransition.outgoingIconLookup = !hasRealSelection()
    && typeof activeIconLookup === "function"
    ? activeIconLookup()
    : null;
  const fromPoint = cameraOriginPoint();
  // A selection owns the camera from this frame onward. If a Nearby anchor move is still in
  // flight, leaving its transition alive lets prepareCanvasForDraw run an old Nearby refit over
  // the new selection animation, which is an intermittent blank/snap depending on tap timing.
  state.nearbyOriginTransition = null;
  _nearbyRenderOriginCache = undefined;
  if (!fromPoint) {
    state.cameraOriginTransition = null;
    return;
  }
  state.cameraOriginTransition = {
    fromX: fromPoint.x,
    fromY: fromPoint.y,
    startedAt: performance.now(),
    durationMs: NEARBY_ORIGIN_TRANSITION_MS,
  };
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
  // Same cubic ease-in-out moveCamera uses, so a slide feels like every other camera
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
    // The zoom the slide starts from. The slide moves the map under a still ring, so a move that also
    // needs a different zoom (Back from a zoomed-in place to the browse view) would otherwise get its
    // new scale in one step on the first frame. alignHeadingUpNavigationViewport eases from this to the
    // final scale across the slide. Cleared if a real camera tween takes over (moveCamera).
    fromScale: state.viewport.scale,
    startedAt: performance.now(),
    durationMs: NEARBY_ORIGIN_TRANSITION_MS,
  };
}

// Eased 0-1 progress of the in-flight browse-origin slide, or null when none is running.
// Shares moveCamera's cubic ease-in-out, so anything blended across a slide moves in
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

// Opacity for everything that describes the *nearby set* -- the highlighted pins. A smooth ramp
// from 0 to 1 across a browse-origin slide that runs *with the camera otherwise pinned in place*,
// so the new surroundings arrive with the map instead of appearing after a blank stretch.
// (It used to be 0 for the whole slide and a fade after it, which read as a blank screen.)
//
// Those pins and lines belong to the destination, but the map underneath them is still
// travelling: drawing them straight away means a fan of lines pinned to a stationary circle
// sweeping across moving terrain, and pins sliding under a marker that is not moving. It
// reads as jitter even though every individual element is where it should be. Holding them
// back until the map settles turns a busy half-second into one clean movement followed by the
// new surroundings arriving.
//
// That reasoning assumes the ring is the only thing moving on screen -- true for a plain
// anchor move (tap open ground, a Settings/pinch radius change), where the camera itself does
// not animate and nearbyRenderOriginPoint's slide is what fakes the ring holding still while
// the terrain pans beneath it. A cluster-tap expansion also re-zooms the camera
// (focusNearbyOnClusterGroup -> ensureOverviewTargetsVisible's own moveCamera tween),
// so nothing is pinned: ring, pins and terrain are all being redrawn every frame under one
// live, moving transform, exactly like any other selection fit. Gating opacity here on top of
// that hid the group's own members for the whole ~450ms flight and then popped them in once
// both tweens happened to finish -- reported as "it animates to the position and then
// suddenly snaps afterwards". Skipping the gate whenever a viewport animation is also running
// leaves the plain-anchor-move case (no concurrent viewport tween) exactly as it was.
function nearbyRevealOpacity() {
  const transition = state.nearbyOriginTransition;
  if (!transition) return 1;
  if (state.selectionTransition.mapHeld) return 1;
  if (state.viewportAnimationTo != null) return 1;
  const sinceStart = performance.now() - transition.startedAt;
  if (sinceStart >= transition.durationMs) return 1;
  // The destination's pins fade in while the map travels, rather than being absent for the whole
  // slide and then appearing. A move between two places should show how they relate, which needs
  // the surroundings visible on the way; the pins are world-anchored, so they slide in with the
  // terrain. Starts after the first tenth so the move reads as the map leaving before the new
  // area arrives, and is fully drawn by the time it lands.
  const progress = sinceStart / transition.durationMs;
  const t = clamp((progress - NEARBY_REVEAL_START_FRACTION) / (1 - NEARBY_REVEAL_START_FRACTION), 0, 1);
  return t * t * (3 - 2 * t);
}

// True while the reveal fade still has frames left to draw, so prepareCanvasForDraw keeps
// asking for them after the slide itself has finished. See nearbyRevealOpacity: no fade to
// wait out while a viewport animation is also running, since nothing was hidden to begin with.
function nearbyRevealInProgress() {
  const transition = state.nearbyOriginTransition;
  if (!transition) return false;
  if (state.selectionTransition.mapHeld) return false;
  if (state.viewportAnimationTo != null) return false;
  return performance.now() - transition.startedAt < transition.durationMs + NEARBY_REVEAL_MS;
}

// A selection is a deliberate handoff: remove the Nearby set from drawing and hit testing, let a
// render-only copy leave in a short ordered fade, then reveal only the destination. Keeping the
// old Nearby lookup during the camera move made every other landmark/cow appear at markerOpacityFor()'s
// filter dim (0.5), while trees, paths and water stayed fully opaque.
function selectionDestinationOpacity(now = performance.now()) {
  const transition = state.selectionTransition;
  if (!hasRealSelection() || !transition.mapHeld || transition.startedAt == null || prefersReducedMotion()) return 1;
  const progress = clamp(
    (now - transition.startedAt - SELECTION_MARKER_REVEAL_DELAY_MS) / SELECTION_MARKER_REVEAL_MS,
    0,
    1,
  );
  return progress * progress * (3 - 2 * progress);
}

function selectionDestinationRevealInProgress(now = performance.now()) {
  const transition = state.selectionTransition;
  if (!hasRealSelection() || !transition.mapHeld || transition.startedAt == null || prefersReducedMotion()) return false;
  return now - transition.startedAt < SELECTION_MARKER_REVEAL_DELAY_MS + SELECTION_MARKER_REVEAL_MS;
}

function selectionOutgoingMarkerOpacity(index = 0, now = performance.now()) {
  const transition = state.selectionTransition;
  if (!hasRealSelection() || !transition.mapHeld || transition.startedAt == null || prefersReducedMotion()) return 0;
  const delay = Math.min(index * SELECTION_MARKER_EXIT_STAGGER_MS, SELECTION_MARKER_EXIT_MAX_STAGGER_MS);
  const progress = clamp((now - transition.startedAt - delay) / SELECTION_MARKER_EXIT_MS, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  return 1 - eased;
}

function selectionOutgoingRevealInProgress(now = performance.now()) {
  const transition = state.selectionTransition;
  if (!hasRealSelection() || !transition.mapHeld || transition.startedAt == null || prefersReducedMotion()) return false;
  return now - transition.startedAt < SELECTION_MARKER_EXIT_MS + SELECTION_MARKER_EXIT_MAX_STAGGER_MS;
}

function selectionOutgoingRevealDurationMs() {
  const transition = state.selectionTransition;
  if (!transition.outgoingIconLookup || prefersReducedMotion()) return 0;
  return SELECTION_MARKER_EXIT_MS + SELECTION_MARKER_EXIT_MAX_STAGGER_MS;
}

function nearbyOriginTransitionActive() {
  const transition = state.nearbyOriginTransition;
  if (!transition) return false;
  return performance.now() - transition.startedAt < transition.durationMs;
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

function headingUpAnchorFraction(isSelected, useFinalBrowseState = false) {
  const aheadAnchor = tiltRampedAnchor(isSelected, useFinalBrowseState);
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
  const origin = navigationOriginPoint();
  const dx = sumX / points.length - origin.x;
  const dy = sumY / points.length - origin.y;
  if (dx === 0 && dy === 0) return null;
  const radians = toRadians(currentNavigationMapRotationDegrees());
  const rotatedX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const rotatedY = dx * Math.sin(radians) + dy * Math.cos(radians); // same sign convention as tiltRotatedHeadingOffset
  return Math.atan2(rotatedX, -rotatedY);
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
  const selectedNavigationBasisTransition = Boolean(
    state.cameraOriginTransition
    && state.selected?.item
    && typeof selectedCompassTarget === "function"
    && selectedCompassTarget(),
  );
  return state.selectionTransition.viewportPending
    || state.viewportAnimationTo != null
    || selectedNavigationBasisTransition;
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
  // Keep a useful edge cushion without making the ordinary Nearby radius occupy only a
  // little over half of the usable width on a portrait phone. The ring is circular and its
  // camera is centred, so the larger 10% margin used by the old heading-up fit was needlessly
  // conservative here; the 12dp floor still protects rotated content from touching the edge.
  return Math.min(focusRect.width, focusRect.height) * 0.06 + 12 * pixelRatio();
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

  const origin = navigationOriginPoint();
  const radians = toRadians(currentNavigationMapRotationDegrees());
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let ahead = 0;
  let behind = 0;
  let side = 0;
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const rotatedX = dx * cos - dy * sin;
    const rotatedY = dx * sin + dy * cos;
    if (rotatedY < 0) ahead = Math.max(ahead, -rotatedY);
    else behind = Math.max(behind, rotatedY);
    side = Math.max(side, Math.abs(rotatedX));
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

  // Reaching all the way to the ends of [top, top + usable] is only the right answer when
  // ahead/behind is actually what ends up constraining the eventual zoom. For a route that is
  // short and narrow side-to-side (a nearby shop or cafe a few streets over, say), the left/
  // right extent is routinely the tighter constraint instead -- maxScaleForHeadingUpPoints
  // zooms no further than that already allows, so the ahead/behind span never uses anywhere
  // near the full room this split just reserved for it. The anchor still sat at the extreme,
  // so the (small, now-zoomed-out) route rendered in a compressed cluster stranded near one
  // edge with the rest of the available area empty -- reported from the field as a selected
  // destination landing "too high up on the screen" with the walker and the destination both
  // far from the inspector sheet below them. Measured on a real 335 m routed destination: as
  // little as 11% of the reserved ahead/behind room actually used, across roughly half of all
  // possible compass headings.
  //
  // usableWidth mirrors `usable` for the horizontal axis -- the same margin, and symmetric
  // around the rect's centre the same way maxScaleForHeadingUpPoints' own focus.x is (see its
  // availableX). side's own scale candidate is therefore usableWidth / (2 * side); at that
  // scale, span would occupy `span * usableWidth / (2 * side)` px of the `usable` vertical
  // band. fillRatio is that fraction, clamped to the [0, 1] a long/wide route (side big
  // relative to span, or span itself the binding axis) already satisfies -- for that case
  // this is a no-op and the split reaches the full extreme exactly as before (the behaviour
  // the doc comment above was measured against). Below 1, blend the split toward the centre
  // by the same fraction: proportionally less reason to favour either end the less of the
  // reserved room the route actually needs.
  const usableWidth = focusRect.width - margin * 2;
  const fillRatio = side > 0 && usableWidth > 0
    ? clamp((span * usableWidth) / (2 * side * usable), 0, 1)
    : 1;
  const aheadRatio = 0.5 + (ahead / span - 0.5) * fillRatio;
  return top + usable * aheadRatio;
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

// The screen y navigationFocusPoint() would place the user at, damped so it does not track
// every live-heading-driven wobble of balancedNavigationAnchorY/headingUpAnchorFraction --
// see resolveHeadingUpAnchorFraction. Deliberately NOT folded into navigationFocusPoint
// itself: maxHeadingUpNavigationScale/maxNearbyHeadingUpScale must keep fitting against the
// instantaneous anchor exactly as before (smoothing that input regressed the walking
// zoom-glide tests -- a scale fit chasing a *lagging* anchor swung further, and more often
// urgently, than one chasing the live anchor directly). Only where the anchor is actually
// used to *place the camera* -- here -- does the lag matter for the reported bug: the
// destination's on-screen position, still solved by the fresh fit above, is unaffected.
function dampedHeadingUpFocusY(rawFocus, focusRect, force) {
  if (!selectedNavigationHeadingUpActive() || !(focusRect.height > 0)) return rawFocus.y;
  const targetFraction = (rawFocus.y - focusRect.y) / focusRect.height;
  const resolvedFraction = resolveHeadingUpAnchorFraction(targetFraction, focusRect, selectedCompassTarget(), force);
  return focusRect.y + focusRect.height * resolvedFraction;
}

function nearbyHeadingUpFocusY(useFinalBrowseState = false) {
  return headingUpAnchorFraction(false, useFinalBrowseState);
}

// See navigationFocusPoint: the rect is the caller's, for the same reason. useFinalBrowseState
// is threaded straight through to nearbyHeadingUpFocusY/tiltRampedAnchor -- see the comment
// there.
function nearbyNavigationFocusPoint(focusRect = bestVisibleCanvasRect(), useFinalBrowseState = false) {
  return {
    x: focusRect.x + focusRect.width / 2,
    y: focusRect.y + focusRect.height * nearbyHeadingUpFocusY(useFinalBrowseState),
  };
}

function selectedNavigationTargetPoints() {
  const target = selectedCompassTarget();
  if (!target) return [];
  if (state.selected && state.selected.type === "path" && target.segments) {
    return target.segments.flat();
  }
  if (!target.point) return [];
  // Far from the forest there is no walk to frame, but the High Beach stand-in the view pivots on
  // must stay in the fit with the place, or the rotated view would not show where it is turning about.
  if (isFarFromForest()) return [navigationOriginPoint(), target.point];
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

// Holds/eases the heading-up navigation focus's vertical anchor toward targetFraction
// exactly the way resolveHeadingUpTargetScale holds/eases the scale -- see
// HEADING_UP_ANCHOR_HOLD_RATIO. Deliberately a fraction of focusRect's height rather than an
// absolute canvas y: the rect itself can shift (a window resize, the inspector opening) between
// one call and the next for reasons that have nothing to do with the compass, and holding a
// stale *absolute* pixel position across that shift places it nonsensically inside the new
// rect -- measured as a ~5.5x scale collapse when the rect's origin moved between two calls in
// the same frame. A fraction of the rect's own height is invariant to exactly that shift.
//
// state.headingUpAnchorFractionSmoothed is the anchor actually on screen; targetFraction is
// what balancedNavigationAnchorY/headingUpAnchorFraction would place it at right now, given
// the live (possibly still-rotating) heading. targetKey identifies the navigation target
// (selectedCompassTarget()) the caller is fitting: a fresh selection never eases in from
// wherever a *different* target's anchor last settled -- it takes effect immediately, same
// as manualCameraOverrideFor being keyed on selection identity elsewhere in this file. This
// also covers the very first call, when there is nothing to hold yet.
function resolveHeadingUpAnchorFraction(targetFraction, focusRect, targetKey, force = false, now = performance.now()) {
  if (!Number.isFinite(targetFraction)) {
    return Number.isFinite(state.headingUpAnchorFractionSmoothed) ? state.headingUpAnchorFractionSmoothed : targetFraction;
  }

  if (state.headingUpAnchorTargetFor !== targetKey || !Number.isFinite(state.headingUpAnchorFractionSmoothed)) {
    state.headingUpAnchorTargetFor = targetKey;
    state.headingUpAnchorEaseAt = null;
    state.headingUpAnchorEasing = false;
    state.headingUpAnchorFractionSmoothed = targetFraction;
    return targetFraction;
  }
  const previousFraction = state.headingUpAnchorFractionSmoothed;

  // HEADING_UP_POSITION_PX_THRESHOLD converted to this rect's own fraction space, so "ignore
  // sub-pixel noise" means the same physical amount of screen regardless of rect height.
  const settleFraction = focusRect.height > 0 ? HEADING_UP_POSITION_PX_THRESHOLD / focusRect.height : 0;
  if (Math.abs(previousFraction - targetFraction) <= settleFraction) {
    state.headingUpAnchorEaseAt = null;
    state.headingUpAnchorEasing = false;
    return previousFraction;
  }

  // Same exemptions as resolveHeadingUpTargetScale: an app-driven framing (force) or a
  // quiet compass takes the requested anchor immediately, since nothing is fighting it.
  if (force || !headingUpCompassSensorActive(now)) {
    state.headingUpAnchorEaseAt = null;
    state.headingUpAnchorEasing = false;
    state.headingUpAnchorFractionSmoothed = targetFraction;
    return targetFraction;
  }

  if (!state.headingUpAnchorEasing) {
    if (Math.abs(targetFraction - previousFraction) <= HEADING_UP_ANCHOR_HOLD_RATIO) {
      state.headingUpAnchorEaseAt = null;
      return previousFraction;
    }
    state.headingUpAnchorEasing = true;
  }

  const lastEaseAt = state.headingUpAnchorEaseAt;
  const gapMs = Number.isFinite(lastEaseAt) ? (now - lastEaseAt) : null;
  if (gapMs == null || gapMs > HEADING_UP_SCALE_EASE_STALE_MS) {
    state.headingUpAnchorEaseAt = now;
    return previousFraction;
  }
  if (!(gapMs > 0)) return previousFraction; // clock has not advanced (duplicate call this tick)
  const dt = Math.min(gapMs, HEADING_UP_SCALE_EASE_MAX_DT * 1000) / 1000;
  state.headingUpAnchorEaseAt = lastEaseAt + dt * 1000;
  const eased = previousFraction + (targetFraction - previousFraction) * (1 - Math.exp(-HEADING_UP_SCALE_EASE_RATE * dt));
  state.headingUpAnchorFractionSmoothed = Number.isFinite(eased) ? eased : previousFraction;
  return state.headingUpAnchorFractionSmoothed;
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
function headingUpFitTiltCamera(useFinalBrowseState = false) {
  const tiltDeg = tiltRotateXDeg();
  if (!(tiltDeg > 0)) return null;
  const radians = toRadians(tiltDeg);
  const tiltSin = Math.sin(radians);
  const tiltCos = Math.cos(radians);
  if (!(tiltSin > 0)) return null;
  const perspectivePx = tiltPerspectivePx(useFinalBrowseState);
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

// The ceiling maxHeadingUpNavigationScale clamps its own result to -- the selected-navigation
// half of the "no ceiling of its own" split described below. See minSelectionFitScale
// (js/app.js) for what it is and why. Deliberately NOT applied to the nearby ring fit
// (maxNearbyHeadingUpScale): the walking-radius floor's own "zoom in past the one-minute
// limit for a find that close" behaviour legitimately asks for more than this, and capping it
// there pinned the ring at the ceiling instead (see WALKING_RADIUS_TIGHT_MIN_MINUTES).

// Shared bounding-box scale-fit math for both heading-up modes (selected navigation
// and nearby survey): the maximum scale at which every point in `points` stays inside
// the rotated focus rect, honouring the tilt behind-heading exclusion. Returns null when
// no point constrains the fit (empty input, or every point sits exactly at the focus) so
// callers can fall back to the current viewport scale exactly as each did before this was
// factored out. This is pure fit-to-points geometry with no ceiling of its own: a ceiling
// baked in here (an arbitrary ratio against an unrelated reference scale) caused more bugs
// than it fixed, and callers now express what they want by choosing the points they pass --
// see nearbyCameraFitPoints and headingUpZoomCeiling above, where the selected-navigation
// caller applies its own.
function maxScaleForHeadingUpPoints(points, focus, focusRect, options = {}) {
  // Nearby mode's item cluster is genuinely hidden behind the user during full tilt
  // (isBehindTiltHeading), so excluding those points from the fit is correct there --
  // fitting a hidden point would force a needless zoom-out. The selected navigation
  // target (and its route) are the one exception to that hiding rule (see
  // isBehindTiltHeading's spec note), so maxHeadingUpNavigationScale passes
  // excludeBehindDuringTilt: false to keep the fit actually framing them even when
  // they're behind the user's current heading.
  const excludeBehindDuringTilt = Boolean(state.map3dEnabled) && options.excludeBehindDuringTilt !== false;
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
  const tilt = options.projectTilt ? headingUpFitTiltCamera(Boolean(options.useFinalBrowseState)) : null;
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
  let points = selectedNavigationTargetPoints();
  if (!points.length) return state.viewport.scale;
  // The routing graph is lazy. Before it is ready, selectedNavigationTargetPoints() is the
  // straight-line fallback, while the eventual route can detour well outside that line. Give
  // the first heading-up fit the same room as ensureUserAndSelectionVisible's flat fit, so a
  // selection does not visibly zoom in and then reverse when the real route arrives.
  if (!state.routingGraphReady && points.length > 1) {
    const bounds = points.reduce((next, point) => ({
      minX: Math.min(next.minX, point.x),
      minY: Math.min(next.minY, point.y),
      maxX: Math.max(next.maxX, point.x),
      maxY: Math.max(next.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const centreX = (bounds.minX + bounds.maxX) / 2;
    const centreY = (bounds.minY + bounds.maxY) / 2;
    const halfWidth = ((bounds.maxX - bounds.minX) / 2) * ROUTE_UNKNOWN_FIT_SLACK;
    const halfHeight = ((bounds.maxY - bounds.minY) / 2) * ROUTE_UNKNOWN_FIT_SLACK;
    points = [
      { x: centreX - halfWidth, y: centreY - halfHeight },
      { x: centreX + halfWidth, y: centreY + halfHeight },
    ];
  }
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
  if (maxScale == null) return state.viewport.scale;
  // See minSelectionFitScale: without a ceiling here, a target close to the user -- or a
  // routed-path point set that, once rotated into heading-up space, happens to sit tightly
  // around the focus -- had no ceiling at all and could demand an arbitrarily large scale.
  // Measured in the field as the camera suddenly zooming in far past anything sensible once
  // the routing graph replaced the straight-line fallback, and again on the next selection,
  // each one further than the last. Same MIN_SELECTION_VIEW_METRES floor the flat fit uses
  // (ensureUserAndSelectionVisible), so heading-up and flat selections agree on how tight a
  // view either will ever settle on.
  return Math.min(maxScale, minSelectionFitScale(focusRect, state.userLocation.latitude));
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

// The entries behind those points. Split out from nearestSelectedFilterPoints below because
// the Filter/Settings/Report map now *highlights* the same items it zooms out to reach
// (buildFullNearbyIconLookup, js/renderer.js) -- framing a match the map then drew nothing for
// left the zoom-out looking like it had reached for empty ground.
// nearbyOrigin(), not the raw GPS fix: those screens draw the ring around the browse anchor and
// scan the matches inside it from there (overviewItemsForActiveFilter), so the reach past the
// ring has to start from the same place or it measures "nearest" from somewhere else entirely.
function nearestSelectedFilterEntries() {
  const origin = nearbyOrigin();
  if (!origin) return [];
  if (state.overviewFilters.length === 0) return [];
  const entries = [];
  for (const filterKey of getActivePointFilterKeys()) {
    const entry = nearestOverviewEntryForFilter(filterKey, origin.latitude, origin.longitude);
    if (entry && entry.item) entries.push(entry);
  }
  return entries;
}

function nearestSelectedFilterPoints() {
  const origin = nearbyOrigin();
  if (!origin || !origin.point) return [];
  const points = [];
  for (const entry of nearestSelectedFilterEntries()) {
    const point = nearestFitPointForEntry(entry, origin.point);
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
// Secondary screens also reach the nearest match of a filter the user has *just switched on*
// that turned out to have nothing inside the ring (see outOfRadiusFitPoints). Nearby deliberately
// does not: its map is a survey of the walking radius, and changing filters must not zoom the
// map out to a distant fallback that may not even be drawn on screen.
// While a cluster is expanded (state.clusterExpanded), the camera fits the group's own member
// points instead of the ring. This is not the "fit the item cluster" design the comment above
// warns against reverting to: that one re-solved every frame against whichever matches
// happened to be nearest, which chased and re-zoomed as the set or the compass heading changed.
// This point set is a fixed snapshot -- exactly the items a deliberate tap just expanded, never
// recomputed until the next tap -- so there is nothing to chase.
//
// Without this, the ring's own floor (WALKING_RADIUS_TIGHT_MIN_MINUTES, js/nav.js, ~21m) capped
// how far in the camera could ever zoom for *any* expanded group, ring-sized or not. A group
// tighter than that floor -- two veteran trees a couple of metres apart, not unusual in a dense
// patch of forest -- never actually separated on screen no matter how many times its badge was
// tapped: each tap re-narrowed state.clusterExpanded correctly, but the camera kept framing the
// same floor-sized ring, so the same unsplit badge just redrew in the same spot. Reported as
// "I get down to a cluster that does not expand". Fitting the group's own points instead lets
// the camera zoom in exactly as far as separating them needs, capped at the same 220x-of-base
// ceiling applyBoundsToViewport already enforces for the pinch gesture.
function expandedClusterFitPoints(group) {
  const items = Object.values(clusterItemsByType(group)).flat();
  return items.map((item) => item.point).filter(Boolean);
}

// useFinalBrowseState: see cameraOriginPoint's comment -- threaded down to
// walkingRadiusCirclePoints so an animate:true fit solves the ring at the browse-origin
// slide's destination rather than wherever nearbyRenderOriginPoint's own interpolation has it
// at the instant the fit is solved. clusterExpanded's own points never went through that
// interpolation (they're the tapped group's fixed member positions), so this only matters for
// the plain-ring branch below -- the one restoreNearbyAnchorFromHistory falls back to once no
// anchor remains.
function nearbyCameraFitPoints(useFinalBrowseState = false) {
  if (state.clusterExpanded) return expandedClusterFitPoints(state.clusterExpanded);
  const ring = walkingRadiusCirclePoints(64, useFinalBrowseState);
  // Nearby is always framed by the configured walking radius. In particular, don't append
  // out-of-radius fallback matches here: selecting a category can name a distant nearest item
  // in the list, but that must not pull the camera out to it. The secondary Filter/Settings/
  // Report screens intentionally use the extra reach because their map explains the selected
  // filters rather than surveying the reader's walking area.
  if (!secondaryScreenActive()) return ring;
  const reach = ring.concat(outOfRadiusFitPoints());
  const base = reach.concat(nearestSelectedFilterPoints());
  return state.selected?.type === "community" && typeof communityFitPoints === "function" ? base.concat(communityFitPoints()) : base;
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

// useFinalBrowseState: see tiltRampedAnchor's comment -- skips the progress blend below and
// solves straight for the slide's destination, for a caller (alignHeadingUpNavigationViewport's
// animate:true path) that is about to hand the result to moveCamera and ease to it
// itself.
function maxNearbyHeadingUpScale(focus, focusRect, useFinalBrowseState = false) {
  if (!state.userLocation) return state.viewport.scale;
  const points = nearbyCameraFitPoints(useFinalBrowseState);
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
  const progress = useFinalBrowseState ? null : nearbyOriginTransitionEasedProgress();
  const fromBrowsing = progress == null ? browsing : state.nearbyOriginTransition.fromBrowsing;
  if (progress != null && fromBrowsing !== browsing) {
    const fromScale = nearbyPivotFitScale(points, fromBrowsing, focusRect);
    const toScale = nearbyPivotFitScale(points, browsing, focusRect);
    if (fromScale != null && toScale != null) {
      return fromScale + (toScale - fromScale) * progress;
    }
  }
  const maxScale = nearbyPivotFitScale(points, browsing, focusRect, focus, useFinalBrowseState);
  return maxScale == null ? state.viewport.scale : maxScale;
}

// The nearby ring fit for one end of a browse-origin slide: that end's own pivot position
// (nearbyPivotAnchorFraction) solved under that end's own behind-the-pivot rule. `focus` is
// passed only by the plain, non-blended call, which must keep using the focus point its
// caller already computed rather than re-deriving it. useFinalBrowseState: see
// cameraOriginPoint's comment -- only the non-blended call passes it through.
function nearbyPivotFitScale(points, browsing, focusRect, focus, useFinalBrowseState = false) {
  const pivotFocus = focus || {
    x: focusRect.x + focusRect.width / 2,
    y: focusRect.y + focusRect.height * nearbyPivotAnchorFraction(browsing),
  };
  const maxScale = maxScaleForHeadingUpPoints(points, pivotFocus, focusRect, {
    projectTilt: true,
    originPoint: cameraOriginPoint(useFinalBrowseState),
    useFinalBrowseState,
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

// The single animated Nearby refit waiting for an in-flight camera move to land (see the guard in
// alignHeadingUpNavigationViewport). Latest request wins: it is re-derived from current state when
// it runs, so an older request's options never need merging.
let pendingNearbyRefitOptions = null;
let pendingNearbyRefitFrame = null;

function deferAnimatedNearbyRefit(options) {
  pendingNearbyRefitOptions = { ...options };
  if (pendingNearbyRefitFrame != null) return;
  const retry = () => {
    pendingNearbyRefitFrame = null;
    if (!pendingNearbyRefitOptions) return;
    if (selectionCameraTransitionActive()) {
      pendingNearbyRefitFrame = requestAnimationFrame(retry);
      return;
    }
    const next = pendingNearbyRefitOptions;
    pendingNearbyRefitOptions = null;
    alignHeadingUpNavigationViewport(next);
  };
  pendingNearbyRefitFrame = requestAnimationFrame(retry);
}

function alignHeadingUpNavigationViewport(options = {}) {
  // Before real map data loads, state.trees/state.landmarks/etc are still empty, so the
  // points fed into maxHeadingUpNavigationScale/maxNearbyHeadingUpScale don't yet reflect
  // real nearby items -- fitting against that would either fit nothing meaningful or, for
  // a selected target, fail outright. On iOS the compass can fire (driving this via
  // startCompassSmoothing) before mapPromise resolves, so this must wait for real data.
  if (!state.dataLoaded) return false;
  if (!navigationAnchorActive()) return false;
  // A finger is dragging the anchored map: nothing re-anchors it until release, which asks for
  // the return itself with releaseDrag (js/nav.js, returnAnchoredMapAfterDrag).
  if (state.anchoredDragHold && !options.releaseDrag) return false;
  if (selectionCameraTransitionActive()) {
    // An animated refit that lands while another camera tween is running (tapping a place and
    // then Nearby quickly, or a filter pill mid-ease) used to be dropped here, so the camera
    // stopped on the earlier tween's framing until some later un-animated tick snapped it right.
    // Queue it instead and run it once the in-flight move has landed.
    if (options.animate) deferAnimatedNearbyRefit(options);
    return false;
  }
  if (state.clusterZoomed) return false;
  // This is the walking-radius ring's own framing (nearbyNavigationFocusPoint/
  // maxNearbyHeadingUpScale below), reached both directly -- every watchPosition fix calls it
  // whenever nothing is selected, which nearbyNavigationAnchorActive() makes true throughout
  // Search too -- and via ensureOverviewTargetsVisible, which every one of this function's other
  // callers (compass ticks, filter changes, GPS fixes) ultimately routes through under the same
  // "no selection" condition. Search never moves the camera (updateSearchHighlight only highlights;
  // matches off the map are marked "Off the map"), so applying the ring's framing here, unconditionally
  // and without animation, snapped an open Search back out to the Nearby ring on the next GPS fix or
  // compass tick. That held only once there were results to frame, so it still happened between opening
  // Search and typing, and after clearing a query. The camera stays wherever it was for as long as
  // Search is open; leaving Search runs its own refit (goToInitialView) after the screen is closed.
  if (state.searchScreenOpen) return false;
  // Every secondary screen (Filters, Settings, Feedback, Community) holds the camera the same way:
  // opening one leaves the camera where it was, and so does a plain GPS fix or compass tick, which
  // call this with no options. Without it, opening one from a zoomed-in place and then getting a fix
  // snapped the map out to the ring. A deliberate refit still happens: the radius slider, a filter
  // change and Filters opening (an animated survey fit) all pass `force` or `animate`.
  if (secondaryScreenActive() && !options.force && !options.animate) return false;
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
  // A caller passing animate:true is about to hand the result to moveCamera and ease
  // to it itself -- so the nearby pivot/scale/origin must solve for the browse-origin slide's
  // actual destination, not a progress snapshot of it taken at the instant the slide starts
  // (see tiltRampedAnchor's comment: that snapshot is what used to make the tween zoom past
  // the real framing and then have the next per-frame call snap it back). Scoped to the
  // nearby branch only -- selected navigation's own basis-switch ease (cameraOriginTransition)
  // is a different, still-wanted slide (see cameraOriginPoint's comment on "very jumpy").
  const useFinalBrowseState = Boolean(options.animate) && !selectedNavigationHeadingUpActive();
  // The one shared definition of where the camera is looking -- see cameraOriginPoint().
  const userPoint = cameraOriginPoint(useFinalBrowseState);
  // The plain Nearby view (nothing selected, no tilt, no expanded cluster, no secondary screen)
  // pins the ring to the bottom edge instead of centring it -- see bottomEdgeRadiusFrame. The
  // ring is a circle around the user, so this is the same framing at every compass heading.
  const bottomFrame = !selectedNavigationHeadingUpActive()
    && !tiltActive()
    && !state.clusterExpanded
    && !secondaryScreenActive()
    ? bottomEdgeRadiusFrame(focusRect)
    : null;
  const focus = bottomFrame
    ? { x: bottomFrame.centreX, y: bottomFrame.centreY }
    : selectedNavigationHeadingUpActive()
      ? navigationFocusPoint(focusRect)
      : nearbyNavigationFocusPoint(focusRect, useFinalBrowseState);
  const maxScale = bottomFrame
    ? bottomFrame.scale
    : selectedNavigationHeadingUpActive()
      ? maxHeadingUpNavigationScale(focus, focusRect)
      : maxNearbyHeadingUpScale(focus, focusRect, useFinalBrowseState);
  // Use maxScale directly: heading-up mode always fits all targets in the
  // rotated focus rect. Math.min would leave scale too low when the map
  // was previously at a wider zoom (e.g. walking-radius level on first load).
  let targetScale = resolveHeadingUpTargetScale(maxScale, previousScale, Boolean(options.force));
  // A browse-origin slide that started from a different zoom carries the zoom change with it, on the
  // slide's own curve, so the map zooms and pans as one move instead of snapping to the final scale and
  // then sliding. Un-animated per-frame calls only: an animated call already hands the whole move to a tween.
  const slideProgress = options.animate ? null : nearbyOriginTransitionEasedProgress();
  const slideFromScale = state.nearbyOriginTransition ? state.nearbyOriginTransition.fromScale : null;
  if (slideProgress != null && slideFromScale > 0 && targetScale > 0) {
    targetScale = zoomAlongTween(slideFromScale, targetScale, slideProgress);
  }
  // The scale above is fit against the instantaneous anchor (focus.y) so it always keeps the
  // destination on screen; the camera's own vertical placement is damped separately (see
  // dampedHeadingUpFocusY) so simply rotating on the spot does not bob the user's own marker.
  const focusY = dampedHeadingUpFocusY(focus, focusRect, Boolean(options.force));
  const targetViewport = {
    scale: targetScale,
    tx: focus.x - userPoint.x * targetScale,
    ty: focusY - userPoint.y * targetScale,
  };

  // focus/focusY/userPoint are all independent of scale (the Nearby pivot never rotates with
  // heading, and dampedHeadingUpFocusY is a no-op outside selected-navigation) -- so the same
  // tx/ty formula at *today's* scale is a real, reachable viewport: today's framing, re-centred
  // on the new pivot. stagePanThenZoom (focusNearbyOnClusterGroup) eases there first and only
  // then eases scale to targetScale, so a cluster that is already on screen slides into the
  // middle of it before the camera zooms in on it, rather than panning and zooming at once.
  //
  // Only worth doing when the new pivot is roughly where the old one was on screen -- the
  // premise this whole branch rests on ("it will already be in the viewport"). A cluster tap
  // while already tightly zoomed in elsewhere can land on a pivot that is world-far from here;
  // panning there at *today's* (tight) scale would cover that whole distance in screen pixels
  // within one short tween, reading as a fast, disorienting slide rather than a gentle
  // repositioning -- worse than the single combined ease it would be replacing. This is exactly
  // the "mega badge across the ring from an earlier browse anchor" case the old three-phase
  // zoom-out/pan/zoom-in tour existed for and was abandoned over (see focusNearbyOnClusterGroup's
  // own comment); staging still isn't the answer for it, so this falls back to the plain single
  // ease below instead, the same path a far jump already took before stagePanThenZoom existed.
  const panDistancePx = Number.isFinite(previousScale) && previousScale > 0
    ? Math.hypot(
      (focus.x - userPoint.x * previousScale) - previousTx,
      (focusY - userPoint.y * previousScale) - previousTy
    )
    : Infinity;
  const panIsAlreadyOnScreen = panDistancePx <= Math.hypot(focusRect.width, focusRect.height);

  if (options.animate && options.stagePanThenZoom && panIsAlreadyOnScreen) {
    const panViewport = {
      scale: previousScale,
      tx: focus.x - userPoint.x * previousScale,
      ty: focusY - userPoint.y * previousScale,
    };
    const totalMs = options.durationMs || HEADING_UP_NAV_ANIMATION_MS;
    const panMs = Math.round(totalMs * 0.4);
    const zoomMs = Math.max(MIN_VIEWPORT_ANIMATION_MS, totalMs - panMs);
    moveCamera(panViewport, panMs, () => moveCamera(targetViewport, zoomMs));
  } else if (options.animate) {
    moveCamera(
      targetViewport,
      options.durationMs || HEADING_UP_NAV_ANIMATION_MS,
      undefined,
      { cinematic: Boolean(options.cinematic), deliberate: Boolean(options.deliberate), focusPoint: { x: focus.x, y: focusY } },
    );
  } else {
    // An un-animated refit writes the viewport itself, so a wheel glide still chasing its own
    // target would overwrite it on its next frame.
    cancelZoomChase();
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

function animateToHeadingUpNavigationViewport(durationMs = HEADING_UP_NAV_ANIMATION_MS, options = {}) {
  if (!selectedNavigationHeadingUpActive()) return;
  clearHeadingUpCanvasTransform();
  state.selectionTransition.viewportPending = false;
  const safeDuration = Math.max(MIN_HEADING_UP_ANIMATION_MS, Number(durationMs) || HEADING_UP_NAV_ANIMATION_MS);
  if (state.renderedNavigationHeading == null) {
    const targetHeading = normalizeDegrees(state.compassHeading);
    if (!state.headingUpEverEntered) {
      // The very first activation this session: headingUpActive() already held off until a
      // trusted heading existed, so there is nothing to animate from -- just show it. Without
      // this, the reveal itself (which happens before calibration finishes) was immediately
      // followed by a 0-to-heading spin the user never asked for and had not moved to cause.
      state.renderedNavigationHeading = targetHeading;
      state.headingUpEverEntered = true;
    } else {
      // A later (re-)activation -- e.g. selecting a new destination -- animate
      // renderedNavigationHeading from north-up (0) toward the current compass heading, baked
      // into each canvas draw so pins always point down during the transition.
      state.renderedNavigationHeading = 0;
      if (Math.abs(shortestCompassDelta(0, targetHeading)) > 0.5) {
        state.headingUpEntryAnim = {
          from: 0,
          to: targetHeading,
          startTime: performance.now(),
          duration: safeDuration,
        };
      }
    }
  }
  // assumeInspectorOpen: a caller that has just expanded the panel (a followed link) fits against its
  // full footprint, as the flat fit does; measuring now would report the panel mid-transition.
  const focusRect = bestVisibleCanvasRect({ assumeInspectorOpen: Boolean(options.assumeInspectorOpen) });
  const focus = navigationFocusPoint(focusRect);
  const maxScale = maxHeadingUpNavigationScale(focus, focusRect);
  // Use maxScale directly so the viewport always zooms to fit the selected
  // target, even when coming from a wider zoom (e.g. walking-radius overview).
  const targetScale = maxScale;
  // force: true, matching maxScale being used directly above rather than through
  // resolveHeadingUpTargetScale -- this is a fresh selection, not the compass follow, so
  // the camera's own placement should not ease from wherever a previous selection last
  // settled (it also seeds state for the compass-follow frames that come after this one).
  const focusY = dampedHeadingUpFocusY(focus, focusRect, true);
  const userPoint = state.userLocation.point;
  moveCamera({
    scale: targetScale,
    tx: focus.x - userPoint.x * targetScale,
    ty: focusY - userPoint.y * targetScale,
  }, safeDuration, undefined, { deliberate: Boolean(options.deliberate) });
}

function prepareCanvasForDraw() {
  // Before anything reads the position this frame: walk state.userLocation along the glide
  // set up by the last GPS fix (ingestLocationFix), so the camera, the fit, the route head
  // and the You marker all move together rather than stepping once a second.
  if (advanceLocationGlide()) requestDraw();
  _overlapRectCache = undefined;
  _tiltProjectionCache = undefined;
  _nearbyRenderOriginCache = undefined;
  _flatProjectionEpoch++;
  clearHeadingUpCanvasTransform();
  // A browse-origin slide is driven from here rather than by moveCamera: the camera
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
  // The canvas size no longer depends on heading-up or tilt (see resizeCanvas), so nothing here
  // resizes it.
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
      const targetHeading = normalizeDegrees(state.compassHeading);
      if (!state.headingUpEverEntered) {
        // The very first activation this session -- see the matching comment in
        // animateToHeadingUpNavigationViewport. Show the trusted heading directly rather than
        // spinning in from north.
        state.renderedNavigationHeading = targetHeading;
        state.headingUpEverEntered = true;
      } else if (Math.abs(shortestCompassDelta(0, targetHeading)) > 0.5) {
        // Nearby heading-up re-activation: animate in from north-up to current heading
        state.renderedNavigationHeading = 0;
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
  if (!headingUpActive()) {
    clearHeadingUpCanvasTransform();
    return false;
  }
  if (!Number.isFinite(state.renderedNavigationHeading)) {
    // The last draw predates the first compass reading, so there is no drawn heading for a CSS
    // delta to spin from. Without a redraw nothing else asks for one once the camera has
    // settled -- the 3D path used to, by redrawing every frame -- and the map stayed north-up
    // while the radar turned. prepareCanvasForDraw sets the heading on that draw.
    clearHeadingUpCanvasTransform();
    requestDraw();
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
  if (!target) return;
  if (!options.force && els.inspector.classList.contains("minimized")) return;
  // force:true is an app-driven framing (a new selection, the first-load reveal, expanding
  // the inspector) and therefore also the point at which the app takes the camera back.
  // Unforced calls are the GPS follow, which must not fight a camera the user has moved by
  // hand -- the watchPosition handler calls this on every fix, so without this check a
  // panned-away map was dragged back to the fit roughly once a second.
  if (options.force) clearManualCameraOverride();
  else if (manualCameraOverrideActive()) return;
  const shouldAnimate = options.animate !== false;

  // No shared location: there is no origin to fit the selection against, so the view simply centres
  // on the selected place (no route, no walking distance, no direction arrow).
  if (!canGuideToPlaces()) {
    if (target.point) {
      // Never open deeper than the forest-wide base: keeping whatever scale the camera had (at boot,
      // the deepest zoom) left the place alone in an empty, over-zoomed view.
      // Open at about 1.2 km across the visible map, measured from the place itself: the forest-wide
      // base is too far out, and the deepest zoom leaves the place alone in an empty view.
      const focusRect = bestVisibleCanvasRect({ assumeInspectorOpen: true });
      const metresPerDegreeLon = 111320 * Math.cos(target.latitude * Math.PI / 180);
      const origin = projectLonLat(target.longitude, target.latitude);
      const eastOneKm = projectLonLat(target.longitude + 1000 / metresPerDegreeLon, target.latitude);
      const worldPerKm = Math.abs(eastOneKm.x - origin.x);
      state.viewport.scale = focusRect.width / (worldPerKm * 1.2);
      // Centre in the same visible area the scale was sized against. The whole canvas's centre
      // sits under the expanded inspector panel on a phone, which hid the place it had opened.
      centerViewportOnPointsKeepScale([target.point], { ...options, focusVisibleArea: true, assumeInspectorOpen: true });
    }
    return;
  }
  if (!state.userLocation) return;

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
  const focusRect = bestVisibleCanvasRect({
    assumeInspectorOpen: Boolean(options.assumeInspectorOpen),
  });
  if (!options.force && shouldAnimate) {
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

  // See minSelectionFitScale: the scale at which MIN_SELECTION_VIEW_METRES fills the shorter
  // side of the focus rect, overriding fitToPoints' own 220x-of-base ceiling for this fit alone.
  const maxScale = minSelectionFitScale(focusRect, state.userLocation.latitude, DEFAULT_FIT_PADDING_PX * pixelRatio());

  fitToPoints(pointsToFit, false, {
    focusVisibleArea: true,
    animate: shouldAnimate,
    cinematic: Boolean(options.cinematic),
    deliberate: Boolean(options.deliberate),
    durationMs: options.durationMs || 800,
    minScale: state.baseFitScale > 0 ? state.baseFitScale : undefined,
    maxScale: maxScale > 0 ? maxScale : undefined,
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
      const focusRect = bestVisibleCanvasRect();
      const margin = headingUpFitMarginPx(focusRect);
      const routeNeedsRefit = selectedNavigationTargetPoints().some((point) => {
        const screen = worldToScreen(point);
        return screen.x < focusRect.x + margin
          || screen.x > focusRect.x + focusRect.width - margin
          || screen.y < focusRect.y + margin
          || screen.y > focusRect.y + focusRect.height - margin;
      });
      if (!routeNeedsRefit) return;
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

// The tightest view a selected-destination fit (ensureUserAndSelectionVisible, flat; and
// maxHeadingUpNavigationScale, heading-up) will ever ask for: the scale at which this many
// real-world metres fill the shorter side of the focus rect. A destination a few metres from
// the user (reported from the field: "0 m" and "19 m" entries at the top of the Nearby list)
// has a bounding box small enough that fitToPoints' shared 220x-of-base ceiling
// (applyBoundsToViewport's baseFitScaleForCap, also the one maxScaleForHeadingUpPoints leaves
// to its own callers) is the only thing stopping the fit asking for an absurd scale -- but
// landing on that shared ceiling is itself the bug here: on this dataset it only zooms in
// enough to show a bit over a kilometre across the screen (baseFitScale is forest-wide), so a
// 19 m gap rendered as two pins a dozen screen pixels apart in the middle of an otherwise
// empty, still forest-wide-looking view -- reading as "very zoomed out" despite being at the
// camera's hardest possible zoom-in, on both the flat and heading-up fits alike. That shared
// ceiling exists for a different reason (matching what a manual pinch-zoom can reach, and
// stopping a near-coincident cluster's fit asking for literally infinite scale) and is
// deliberately left alone for every other caller of fitToPoints/maxScaleForHeadingUpPoints;
// this override says instead what a selected-destination view should show at minimum,
// regardless of how close the destination is.
const MIN_SELECTION_VIEW_METRES = 120;

function minSelectionFitScale(focusRect, latitudeDegrees, paddingPx = 0) {
  const minViewWorldUnits = metresToWorldUnits(MIN_SELECTION_VIEW_METRES, latitudeDegrees);
  if (!(minViewWorldUnits > 0)) return Infinity;
  const availablePx = Math.min(focusRect.width, focusRect.height) - paddingPx * 2;
  return availablePx > 0 ? availablePx / minViewWorldUnits : Infinity;
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

// The default Nearby framing (no selection, no tilt): the walking-radius circle touches the left and
// right edges of the visible map and sits on the bottom edge, leaving the strip above it free so the
// label can poke up into it. The radius is the width fit, or the height fit when the map is shorter
// than that allows (landscape), so the whole circle always stays on screen. Returns the scale and the
// screen point the ring's centre should land on; the caller places `worldPoint` there. `scaleFactor`
// lets the boot reveal start a little wider or tighter than the final frame.
const RADIUS_FRAME_EDGE_INSET_PX = 6;
const RADIUS_FRAME_TOP_LABEL_ROOM_PX = 44;

function bottomEdgeRadiusFrame(focusRect, scaleFactor = 1) {
  const worldRadius = walkingRadiusWorldUnits();
  if (!(worldRadius > 0)) return null;
  const px = pixelRatio();
  const edgeInset = RADIUS_FRAME_EDGE_INSET_PX * px;
  const topRoom = RADIUS_FRAME_TOP_LABEL_ROOM_PX * px;
  const radiusPx = Math.min(
    focusRect.width / 2 - edgeInset,
    (focusRect.height - edgeInset - topRoom) / 2,
  ) * scaleFactor;
  if (!(radiusPx > 0)) return null;
  return {
    scale: radiusPx / worldRadius,
    centreX: focusRect.x + focusRect.width / 2,
    centreY: focusRect.y + focusRect.height - edgeInset - radiusPx,
  };
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
function walkingRadiusCirclePoints(count = 64, useFinalBrowseState = false) {
  const point = useFinalBrowseState
    ? ((nearbyOrigin() && nearbyOrigin().point) || null)
    : nearbyRenderOriginPoint();
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
    moveCamera(
      targetViewport,
      options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS,
      undefined,
      { cinematic: Boolean(options.cinematic), deliberate: Boolean(options.deliberate), focusPoint: { x: focusRect.x + focusRect.width / 2, y: focusRect.y + focusRect.height / 2 } },
    );
    return;
  }

  stopViewportAnimation();
  state.viewport.scale = targetViewport.scale;
  state.viewport.tx = targetViewport.tx;
  state.viewport.ty = targetViewport.ty;
  requestDraw();
}

function keepOverviewCenteredOnUser(previousPoint) {
  if (!overviewFollowsUser()) return;

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
    moveCamera(targetViewport, options.durationMs || 420);
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

  if (communityFramesOwnMarksOnly()) {
    fitCommunityOwnMarks(options);
    return;
  }

  if (nearbyNavigationAnchorActive()) {
    alignHeadingUpNavigationViewport({
      animate: Boolean(options.animate),
      cinematic: Boolean(options.cinematic),
      deliberate: Boolean(options.deliberate),
      durationMs: options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS,
      force: Boolean(options.force),
      stagePanThenZoom: Boolean(options.stagePanThenZoom),
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
      cinematic: Boolean(options.cinematic),
      deliberate: Boolean(options.deliberate),
      durationMs: options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS,
      minScale: state.baseFitScale > 0 ? state.baseFitScale : undefined,
      padding: OVERVIEW_FIT_PADDING_PX,
    });
  } else {
    // No radius circle to frame (no origin, or a zero radius). Centre on the user and
    // leave the scale alone rather than fitting nothing.
    centerOverviewOnUserLocation({
      animate: Boolean(options.animate),
      cinematic: Boolean(options.cinematic),
      deliberate: Boolean(options.deliberate),
      durationMs: options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS,
      focusVisibleArea: true,
    });
  }
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
    if (placeHashKey(place).toLowerCase() === probe
      || (place.aliasIds || []).some((id) => `id:${id}`.toLowerCase() === probe)) return place;
  }
  return null;
}

// The reverse of a place's own findSlug (attached at load time, js/loader.js, from
// data/business-slugs.json) -- used only to translate a /find/<slug>/ URL back into the place it
// names (routeValueFromLocation), so popstate/back-forward within the SPA can re-select it through
// the same "landmark" SELECTION_ROUTES entry every other place selection already uses.
function findPlaceByFindSlug(slug) {
  const probe = String(slug).trim().toLowerCase();
  for (const place of state.landmarks) {
    if (place.findSlug && place.findSlug.toLowerCase() === probe) return place;
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

// True from the moment a location request starts until it answers, so the direction arrow can spin
// while it waits rather than appearing only once a fix lands (setLocationRequestPending).
function setLocationRequestPending(pending) {
  locationRequestPending = pending;
  updateCompassOverlay();
}

// Within this many metres of the find being walked to counts as arriving: a little more than a
// phone's GPS spread under tree cover, so arriving is felt once rather than flickering in and out.
const ARRIVAL_METRES = 20;

// The native app's walking aids, re-evaluated on every fix and selection change (updateCompassOverlay):
// the screen stays awake only while walking to a find in the foreground, and arriving there is felt
// as one haptic, once per find. Both are no-ops on the web.
function syncNativeWalkingAids() {
  const target = selectedCompassTarget();
  const navigating = Boolean(target) && canGuideToPlaces()
    && (typeof document === "undefined" || document.visibilityState !== "hidden");
  Native.keepAwake.set(navigating);
  if (!navigating) return;
  const metres = distanceFromUser(target);
  if (Number.isFinite(metres) && metres <= ARRIVAL_METRES && state.arrivedAtTarget !== target) {
    state.arrivedAtTarget = target;
    Native.haptics.arrive();
  }
}

function updateCompassOverlay() {
  syncNativeWalkingAids();
  const target = selectedCompassTarget();
  const arrow = els.compassArrow;
  // Waiting for the first fix: the arrow spins in place, with no bearing yet to point at.
  // The High Beach stand-in is not a real fix, so it gives no bearing either (hasRealLocation).
  if (target && !hasRealLocation() && locationRequestPending) {
    state.compassArrowAngle = null;
    if (arrow) {
      arrow.hidden = false;
      arrow.style.transform = "";
      arrow.classList.add("title-compass-arrow--searching");
      arrow.setAttribute("aria-label", "Finding your direction");
    }
    return;
  }
  if (!target || !canGuideToPlaces()) {
    if (arrow) arrow.hidden = true;
    state.compassArrowAngle = null;
    return;
  }

  const tilted = typeof tiltActive === "function" && tiltActive();
  const bearingToTarget = bearingDegrees(state.userLocation.latitude, state.userLocation.longitude, target.latitude, target.longitude);
  const hasHeading = Number.isFinite(state.compassHeading);
  const relative = hasHeading ? shortestCompassDelta(state.compassHeading, bearingToTarget) : bearingToTarget;
  const projected = directionArrowAngleForWorldPoint(target.point, relative, state.compassArrowAngle);
  const unwrapped = unwrapAngle(state.compassArrowAngle, projected);
  state.compassArrowAngle = tilted
    ? smoothDirectionArrowAngle(state.compassArrowAngle, unwrapped)
    : unwrapped;

  const title = state.selected.type === "tree"
    ? treeDisplayName(target)
    : state.selected.type === "environment"
      ? (target.properties?.name || "Map feature")
    : placeTitle(target);
  if (arrow) {
    // The first bearing after the search: spin two full turns and slow into the direction, rather
    // than snapping straight to it.
    const settlingIn = arrow.hidden || arrow.classList.contains("title-compass-arrow--searching");
    arrow.classList.remove("title-compass-arrow--searching");
    arrow.hidden = false;
    arrow.classList.toggle("title-compass-arrow--tilted", tilted);
    arrow.style.transformStyle = tilted ? "preserve-3d" : "";
    if (settlingIn) {
      arrow.style.transition = "none";
      arrow.style.transform = directionArrowTransform(tilted
        ? state.compassArrowAngle
        : state.compassArrowAngle + 720);
      if (!tilted) {
        void arrow.offsetWidth;
        arrow.style.transition = "transform 1.6s cubic-bezier(0.2, 0.7, 0.2, 1)";
        arrow.addEventListener("transitionend", () => { arrow.style.transition = ""; }, { once: true });
      }
    }
    // The tilt projection is already smoothed in the compass loop. A second, long CSS
    // interpolation makes the DOM arrow chase each new 3D angle and reads as stutter.
    if (tilted) arrow.style.transition = "none";
    else if (!settlingIn) arrow.style.transition = "";
    arrow.style.transform = directionArrowTransform(state.compassArrowAngle);
    arrow.setAttribute("aria-label", `Direction to ${title}, ${detailTypeLabel(distanceFromUser(target))}`);
  }
}

function updateOverviewDirectionArrows() {
  if (state.selected || !state.userLocation || isFarFromForest() || !els.inspectorBody) return;
  const arrows = els.inspectorBody.querySelectorAll(".nearest-arrow[data-item-lat]");
  if (!arrows.length) return;
  const { latitude, longitude } = state.userLocation;
  const tilted = typeof tiltActive === "function" && tiltActive();

  for (const arrow of arrows) {
    const itemLat = Number(arrow.dataset.itemLat);
    const itemLon = Number(arrow.dataset.itemLon);
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLon)) continue;
    const bearing = bearingDegrees(latitude, longitude, itemLat, itemLon);
    const relative = Number.isFinite(state.compassHeading)
      ? shortestCompassDelta(state.compassHeading, bearing)
      : bearing;
    const previousAngle = Number(arrow.dataset.currentAngle);
    const projected = directionArrowAngleForWorldPoint(
      projectLonLat(itemLon, itemLat),
      relative,
      previousAngle,
    );
    const unwrapped = unwrapAngle(previousAngle, projected);
    const nextAngle = tilted
      ? smoothDirectionArrowAngle(previousAngle, unwrapped)
      : unwrapped;
    arrow.dataset.currentAngle = String(nextAngle);
    if (arrow.classList?.toggle) arrow.classList.toggle("nearest-arrow--tilted", tilted);
    arrow.style.transform = directionArrowTransform(nextAngle);
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

// A selected tree or place omits empty nearby cards until their datasets arrive. Refresh an
// open detail when trees or cow positions load so it gains the newly available cards.
function refreshSelectedDetailForNearbyData() {
  const selected = state.selected;
  if (!selected || !selected.item || (selected.type !== "tree" && selected.type !== "landmark")) return;
  // The slot belongs to the current detail, including when all nearby sections are empty.
  // Patch only that slot so the surrounding detail, forms and view tracking stay intact.
  const slot = els.inspectorBody && els.inspectorBody.querySelector("[data-live-nearby]");
  if (!slot) return;
  const item = selected.item;
  const html = nearbySectionsHtml({
    latitude: item.latitude,
    longitude: item.longitude,
    name: selected.type === "tree" ? item.commonName || null : item.name,
    subfilterKey: selected.type === "tree" ? "trees" : placePrimaryFilterKey(item),
    findSlug: selected.type === "landmark" ? item.findSlug : null,
  });
  if (slot.innerHTML === html) return;
  const scroll = els.inspector.querySelector(".inspector-scroll");
  const scrollTop = scroll ? scroll.scrollTop : 0;
  slot.innerHTML = html;
  if (scroll) scroll.scrollTop = scrollTop;
}

function applyCowData(cows, pastures, updatedAt, { persist } = { persist: true }) {
  const cowsWereMissing = !state.cows || state.cows.length === 0;
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
  else if (cowsWereMissing && cows.length > 0) refreshSelectedDetailForNearbyData();
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

// null while far from the forest: no walking distance to a place the visitor cannot walk to.
function distanceFromUser(item) {
  if (!state.userLocation || isFarFromForest()) return null;
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

// roadHashKey / railwayHashKey → js/normalize.js

function findRoadByHashKey(key) {
  return state.roads.find((road) => roadHashKey(road) === key) || null;
}

function findRailwayByHashKey(key) {
  return state.environmentFeatures.find((feature) => (
    feature.properties
    && feature.properties.featureType === "railway"
    && railwayHashKey(feature) === key
  )) || null;
}

function findEnvironmentByHashKey(key) {
  return state.environmentFeatures.find((feature) => environmentHashKey(feature) === key) || null;
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
  // Overview and Nearby screens can show nearest bus stops, so hydrate them whenever a
  // detail selection is not active.
  return !navigator.onLine || !els.inspectorBody || state.selected;
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
            <span class="departure-time${d.due ? ' due' : ''}">${d.due ? 'Due' : (escapeHtml(d.minutesAway) + ' min')}</span>
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

// Flat (untilted) screen position: the raw viewport transform plus the heading-up
// rotation — the map as it would look at zero tilt. Viewport fitting and "is this point
// still on screen" checks must use this rather than worldToScreen: near the top of a
// tilted screen the projection compresses huge world distances into a few pixels, so
// tilted coordinates would read as "point near the edge" and retrigger a re-fit every
// frame.
function worldToScreenFlat(point) {
  const raw = rawWorldToScreen(point);
  const frame = flatProjectionFrame();
  if (!frame.rotating) return raw;
  // Rotates about the camera origin (cameraOriginPoint), the same point the viewport
  // transform anchors at the focus -- pivoting on the GPS fix instead would swing a browse
  // anchor's framing around the screen every time the compass moved.
  const dx = raw.x - frame.pivot.x;
  const dy = raw.y - frame.pivot.y;
  return {
    x: frame.pivot.x + dx * frame.cos - dy * frame.sin,
    y: frame.pivot.y + dx * frame.sin + dy * frame.cos,
  };
}

// The heading-up rotation and the point it pivots on, for the current frame. worldToScreenFlat runs
// for every vertex of every road, path and polygon, and each call used to re-derive both (whether
// heading-up is active, the rotation, the camera origin and its projection), none of which change
// within a frame. In the tilted view that was a large share of the frame's cost. Reused only while
// everything they are derived from is unchanged, and never past the frame they were made in, so a
// fit or hit test that changes the viewport or selection between calls still gets fresh values.
function flatProjectionFrame() {
  const cached = _flatProjectionFrame;
  const view = state.viewport;
  if (cached
    && cached.epoch === _flatProjectionEpoch
    && cached.scale === view.scale && cached.tx === view.tx && cached.ty === view.ty
    && cached.userLocation === state.userLocation
    && cached.selected === state.selected
    && cached.compassHeading === state.compassHeading
    && cached.renderedHeading === state.renderedNavigationHeading
    && cached.nearbyAnchor === state.nearbyAnchor
    && cached.slide === state.nearbyOriginTransition
    && cached.cameraSlide === state.cameraOriginTransition) {
    return cached;
  }
  const rotation = navigationMapRotationDegrees();
  const rotating = Boolean(rotation) && Boolean(state.userLocation);
  const radians = rotating ? toRadians(rotation) : 0;
  _flatProjectionFrame = {
    epoch: _flatProjectionEpoch,
    scale: view.scale, tx: view.tx, ty: view.ty,
    userLocation: state.userLocation,
    selected: state.selected,
    compassHeading: state.compassHeading,
    renderedHeading: state.renderedNavigationHeading,
    nearbyAnchor: state.nearbyAnchor,
    slide: state.nearbyOriginTransition,
    cameraSlide: state.cameraOriginTransition,
    rotating,
    pivot: rotating ? rawWorldToScreen(cameraOriginPoint()) : null,
    cos: Math.cos(radians),
    sin: Math.sin(radians),
  };
  return _flatProjectionFrame;
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
  // During heading-up entry, worldToScreenForOverlay delegates to worldToScreen so the
  // animation's intermediate camera already includes tilt. Applying tiltProjectScreenPoint
  // again here would project every overlay twice for the duration of that transition.
  if (state.headingUpEntryAnim != null) return flat;
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
    x: (event.clientX - rect.left) * dpr,
    y: (event.clientY - rect.top) * dpr,
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

function setStatus(_message) {
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
  // The first figure replaces the loading chip and opens out into its slot (.walk-chip--enter). Later
  // updates only swap the numbers, so the chip never replays its entrance.
  // No shared location: there is no walking figure to show, so the slot stays empty.
  if (distancePill && !canGuideToPlaces()) distancePill.innerHTML = "";
  if (distancePill && canGuideToPlaces() && Number.isFinite(metres)) {
    const isFirstFigure = !distancePill.querySelector(".walk-chip--ready");
    distancePill.innerHTML = walkInfoExpandableHtml(metres);
    if (isFirstFigure) distancePill.querySelector(".walk-chip--ready")?.classList.add("walk-chip--enter");
  }
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

// "When" row for an event's detail view -- "Sat 18 Oct, 10am–4pm" for a same-day range,
// "Sat 18 Oct – Sun 19 Oct" spanning days, or just the start time when there's no endsAt.
function formatEventWhen(event) {
  const starts = event && event.startsAt ? new Date(event.startsAt) : null;
  if (!starts || Number.isNaN(starts.getTime())) return null;
  const ends = event && event.endsAt ? new Date(event.endsAt) : null;
  const validEnds = ends && !Number.isNaN(ends.getTime()) ? ends : null;

  // The forest, and everyone walking in it, is in the UK -- fixed rather than the device's own
  // zone, so a visitor from elsewhere (or a CI runner in any zone) sees the same local time a
  // Londoner would, not their own offset re-applied to a UK event.
  const dateFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Europe/London" });

  if (!validEnds) return `${dateFmt.format(starts)}, ${timeFmt.format(starts)}`;
  if (starts.toDateString() === validEnds.toDateString()) {
    return `${dateFmt.format(starts)}, ${timeFmt.format(starts)}–${timeFmt.format(validEnds)}`;
  }
  return `${dateFmt.format(starts)} – ${dateFmt.format(validEnds)}`;
}

function eventStatusLabel(event, nowMs = Date.now()) {
  if (isEventLive(event, nowMs)) return "Happening now";
  const starts = event && event.startsAt ? new Date(event.startsAt).getTime() : NaN;
  return Number.isFinite(starts) && starts > nowMs ? "Upcoming" : null;
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

function pixelRatio() {
  return Number(els.canvas.dataset.dpr || cappedDevicePixelRatio());
}

