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
const NEARBY_REVEAL_MS = 180; // how quickly the new nearby set fades in once a slide lands -- see nearbyRevealOpacity()
const OVERVIEW_REFIT_ANIMATION_MS = 420; // recompute the overview/secondary-screen camera fit after a UI state change (filter change, opening Filter/Settings/Report, radius toggle, a late location fix)
const OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS = 520; // ensureOverviewTargetsVisible's (and centerOverviewOnUserLocation's) own default when a caller doesn't specify one
const HEADING_UP_NAV_ANIMATION_MS = 500; // standard duration for heading-up alignment and selection-commit transitions (goToInitialView, zoomToSelection)
const MIN_HEADING_UP_ANIMATION_MS = 200; // floor for animateToHeadingUpNavigationViewport's duration
const DEFAULT_VIEWPORT_ANIMATION_MS = 480; // generic fallback duration for the low-level viewport animators when nothing else is specified
const MIN_VIEWPORT_ANIMATION_MS = 180; // floor for animateViewportTo's duration
const FIRST_LOAD_REVEAL_ANIMATION_MS = 700; // the first-time "reveal the map" animation, in all its variants (fit to user+items, centered-on-user)
const FIRST_LOCATION_FLY_TO_ANIMATION_MS = 1250; // the High Beach stand-in -> real GPS handoff, with a cinematic fly-to arc
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
const APP_VERSION = APP_CACHE_VERSION; // Fallback shown before state.swVersion loads from caches.keys() (see setupPwa in nav.js).
const COMPASS_PERMISSION_KEY = "forest-finds-compass-permission-v1";
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
// "1" when the walker has switched on the 3D map in Settings. Off by default: pitching the phone
// leaves the map flat (heading-up still applies) until they opt in.
const MAP_3D_KEY = "ff-map-3d-v1";
const STORED_MAP_3D = (() => {
  try { return localStorage.getItem(MAP_3D_KEY) === "1"; } catch { return false; }
})();
// "1" once this device has reported a real pitch reading. Settings only offers the 3D switch
// after that: a laptop never sends one, so the switch would do nothing there.
const MOTION_SENSOR_KEY = "ff-motion-sensor-v1";
const STORED_MOTION_SENSOR = (() => {
  try { return localStorage.getItem(MOTION_SENSOR_KEY) === "1"; } catch { return false; }
})();
const STORED_COMPASS_PERMISSION = (() => {
  try {
    const stored = localStorage.getItem(COMPASS_PERMISSION_KEY) || "unknown";
    // iOS requires DeviceOrientationEvent.requestPermission() from a user gesture
    // each session before orientation events fire — even if previously granted.
    // Restoring "granted" would skip that per-session call, so treat it as "unknown"
    // to ensure the gate shows and the user can tap to re-enable.
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
  overviewFilters: loadStoredOverviewFilters(),
  // Set by setOverviewFilters(persist:false) -- see its comment -- never true on first load.
  overviewFiltersEphemeral: false,
  // The rail level is normally derived from the current /nearby/<slug> path. A rail tap keeps
  // the level it was displayed at while replacing that path with a shareable query string, so
  // a plain Nearby rail stays at groups and a category rail stays at subcategories.
  nearbyRailGroupKey: undefined,
  overviewExpandedGroups: (() => {
    try {
      const d = JSON.parse(localStorage.getItem(FILTER_STATE_KEY) || "null");
      if (d && Array.isArray(d.expandedGroups)) return sanitizeExpandedGroups(d.expandedGroups);
    } catch {}
    return [];
  })(),
  filterScreenOpen: false,
  // The Search screen and the text currently in its field. Like filterScreenOpen this is a
  // screen with no selection behind it, so the map keeps the Nearby framing while it is open
  // (secondaryScreenActive, js/nav.js). The query is held here rather than read back off the
  // input so re-entering Search from a result restores what was typed.
  searchScreenOpen: false,
  searchQuery: "",
  // The top SEARCH_HIGHLIGHT_LIMIT results for the current query, kept so the renderer can ring
  // them on the map and the camera can frame all of them at once (updateSearchHighlight). Reset
  // to [] wherever Search stands down (setInspectorSelectionChrome, js/inspector.js).
  searchHighlightResults: [],
  distanceWarningShown: false,
  nearestItemsCount: 10,
  walkingDistanceMinutes: DEFAULT_WALKING_DISTANCE_MINUTES,
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
  compassTargetMovedAt: 0,
  nearbyListHeading: null, // heading the Nearby list is ordered by -- see headsUpSortedEntries
  compassPermission: STORED_COMPASS_PERMISSION,
  compassPermissionPromptVisible: false,
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
  // Settings' "3D map" switch. Pitch is still tracked while it is off (the compass deadband
  // reads it), it just never tilts the camera or collapses pins.
  map3dEnabled: STORED_MAP_3D,
  motionSensorSeen: STORED_MOTION_SENSOR,
  // rotateX angle baked into the main canvas by the last draw() -- see tiltRenderStale().
  renderedTiltRotateXDeg: 0,
  tiltWasActive: false,
  selectionViewportTransitionPending: false,
  inspectorMinimizeTransitionPending: false,
  selectionMapTransitionActive: false,
  selectionMapTransitionToken: null,
  selectionMapTransitionIconLookup: null,
  selectionMapTransitionOriginPoint: null,
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

// --- Router ---------------------------------------------------------------------------
//
// Every screen the app can be on has a URL, and the URL is what puts it there. A screen
// change pushes a history entry, so the browser's back button, the phone's back gesture and
// the inspector's own back arrow all retrace the same trail -- Nearby -> Filters -> a tree
// comes back out a step at a time. Until this existed the app wrote the hash with
// replaceState only, so back left the site from wherever the user had got to, Settings and
// Report had no URL at all, and selecting anything that was not a tree or a place (a cow, a
// street, a trail) quietly rewrote the address bar to the Nearby screen's URL.
//
// One canonical string -- the hash payload, without the "#" -- names a screen:
//
//   ""                 Nearby (the app's home screen)
//   "filters"          Filters      "settings"  Settings      "report"  Feedback/Report
//   "tree=<key>"       a selected tree; likewise place, cow, path, water, road, railway
//
// currentScreenRoute() writes it from state, applyRoute() reads it back into state, and the
// two must agree: urlMatchesCurrentScreen() is what decides that an arriving URL is already
// on screen and needs no work.
//
// This sits above boot() deliberately: boot()'s first statement is initRouter(), and the
// module-scope bindings here have to be evaluated by the time it runs.

// Each of the four screens above now has a real path of its own (netlify.toml, server.js --
// all rewrite these to app.html, same as /app used to). Nearby (no screen name, "" in the
// route vocabulary below) is the one with no entry here: it is NEARBY_PATH, the app's new
// place-agnostic entry point, replacing /app (now a bare redirect to it). Filter and Search
// nest under /nearby/ -- both only ever change what Nearby itself is showing (a filtered set,
// a typed query), never a destination of their own -- while Settings and Report stay top-level,
// general app screens with nothing to do with the Nearby view underneath them.
// How deep inside the app's own history the current entry sits, carried in history.state.
// 0 means "this is where the user arrived", so there is nothing behind it to go back to and
// the in-app back arrow must return to Nearby itself rather than leaving the site.
// Carries the Nearby browse anchor (state.nearbyAnchor) on every history entry, so moving
// between clusters -- which has no URL of its own, unlike a selection -- still retraces on the
// browser back button and the inspector's own back arrow. Every entry snapshots the anchor in
// effect *when that entry was created*, so landing back on it (in either direction) restores
// exactly that anchor. Absent (older entries, or the initial boot entry before this existed)
// reads as "no anchor" via nearbyAnchorSnapshot's own null default.
function nearbyAnchorSnapshot() {
  const anchor = state.nearbyAnchor;
  return anchor ? { latitude: anchor.latitude, longitude: anchor.longitude } : null;
}

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

function routerBootFinished() {
  routerBooting = false;
}

// Normalises the landing entry so navDepth() has something to count from. history.state
// survives a reload, so an entry pushed before the reload keeps the depth it had.
//
// A fresh load reached by a link from another page of this site (a /nearby/<slug>/ page opened
// from a sibling page, say) has no state of its own, but the browser's back button does return
// to that page -- so the arrow must offer it too. Only a same-origin referrer in a tab that has
// history counts: a link opened in a new tab, or one from elsewhere, has nothing to go back to.
function initRouter() {
  if (navDepthOf(history.state) !== null) return;
  const cameFromThisSite = Boolean(document.referrer)
    && new URL(document.referrer).origin === window.location.origin
    && history.length > 1;
  history.replaceState(
    { [NAV_DEPTH_KEY]: cameFromThisSite ? 1 : 0, [NEARBY_ANCHOR_KEY]: nearbyAnchorSnapshot() },
    "",
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  );
}

function navDepthOf(entry) {
  const depth = entry && entry[NAV_DEPTH_KEY];
  return Number.isFinite(depth) ? depth : null;
}

function navDepth() {
  return navDepthOf(history.state) ?? 0;
}

// True when there is a screen of this app's own behind the current one. False after a deep
// link or a fresh load, where going back would leave the site entirely.
function canGoBackInApp() {
  return navDepth() > 0;
}

// The inspector's back arrow. It retraces the trail rather than always jumping to Nearby, so
// it and the device back button agree; the Nearby nav button is still the one-tap way home.
function navigateBack() {
  if (canGoBackInApp()) {
    history.back();
    return;
  }
  goToInitialView();
}

// "tree=r17338" -> "tree". Lets "report" and "report=<text>" be recognised as one screen.
// The canonical route for whatever is on screen right now -- unchanged by the four screens
// having real paths now (ROUTE_PATHS): this still speaks the same bare vocabulary
// ("filters"/"search"/"settings"/"report"/"tree=<key>"/"near=<lat>,<lon>"/"") it always has.
// Serialising that to the real URL, and reading it back, is
// urlPartsForRouteValue/routeValueFromLocation below -- everything in between (this function,
// applyRouteToScreen, SELECTION_ROUTES) never needs to know paths exist at all.
function currentScreenRoute() {
  if (state.searchScreenOpen) return ROUTE_SEARCH;
  if (state.filterScreenOpen) return ROUTE_FILTERS;
  const selection = state.selected;
  if (!selection || !selection.type) {
    // A browse anchor is the plain Nearby screen's own lens, not a selection -- see
    // NEARBY_ANCHOR_PARAM above.
    return state.nearbyAnchor ? nearbyAnchorRouteValue(state.nearbyAnchor) : "";
  }
  if (selection.type === "settings") return ROUTE_SETTINGS;
  if (selection.type === "report") return ROUTE_REPORT;
  if (selection.type === "community") return ROUTE_COMMUNITY;
  if (!selection.item) return "";
  const route = SELECTION_ROUTES.find((entry) => entry.type === selection.type);
  if (!route) return "";
  const key = route.toKey(selection.item);
  return key ? routeParam(route.param, key) : "";
}

function urlMatchesCurrentScreen(raw) {
  // An expanded cluster is a group of pins at one spot on the map, not something a link can
  // re-derive, so it has no URL of its own and never counts as matching one. That is what
  // makes any route arriving from the URL apply -- and so closes the group on back.
  if (state.clusterExpanded) return false;
  const current = currentScreenRoute();
  if (raw === current) return true;
  // #report=<text> is the Report screen carrying a pre-fill, not a different screen.
  return current === ROUTE_REPORT && routeName(raw) === ROUTE_REPORT;
}

// value -> the real URL it lives at. The four screens each have their own path and (bar
// Report's prefill, below) no hash of their own; everything else -- Nearby itself, or a
// selection -- stays on NEARBY_PATH, with the value (if any) carried as the hash fragment,
// exactly as it was universally before paths existed.
function urlPartsForRouteValue(value) {
  const name = routeName(value);
  const path = ROUTE_PATHS[name];
  if (path) {
    // report=<text> (a prefill) is the one screen value that still carries a hash alongside
    // its own path -- everywhere else, reaching a screen's path is the whole story.
    const hash = name === ROUTE_REPORT && value !== name ? `#${value}` : "";
    return { pathname: path, hash };
  }
  // A selected place that has its own crawlable /find/<slug>/ page (findSlug, attached at load
  // time from data/business-slugs.json -- the food/locations groups only) gets that real page as
  // its address-bar URL instead of #place=<hashKey> on /nearby -- the same URL a search result
  // would land on, so copying the address bar, sharing it, or search-engine indexing are all one
  // and the same link. Anything else selectable (a tree, a cow, a bus stop, a historic site) has
  // no such page and keeps the existing hash-on-/nearby form unchanged.
  if (name === "place") {
    const item = findPlaceByHashKey(new URLSearchParams(value).get("place"));
    if (item && item.findSlug) return { pathname: `/find/${item.findSlug}/`, hash: "" };
  }
  return { pathname: NEARBY_PATH, hash: value ? `#${value}` : "" };
}

// The live, shareable description of exactly what's showing, as the query string for
// whichever of Nearby's own paths (NEARBY_PATH itself, or its /filter and /search sub-paths)
// window.location.pathname names. "radius" (walking minutes) travels on all three, since it
// describes the Nearby view underneath every one of them, not a particular screen; "show" (the
// active filter set, comma-joined) is /filter's own, and "q" (the typed text) is /search's --
// built by hand rather than with URLSearchParams so a multi-value "show" keeps its plain commas
// instead of being percent-encoded. Every other path never carries any of this.
function searchStringForPath(pathname) {
  const onNearbyFamily = pathname === NEARBY_PATH
    || pathname === ROUTE_PATHS[ROUTE_FILTERS]
    || pathname === ROUTE_PATHS[ROUTE_SEARCH];
  const parts = [];
  // While a cluster tap has borrowed the radius to cover the group (focusNearbyOnClusterGroup),
  // state.walkingDistanceMinutes is that borrowed value, not the reader's real one -- the same
  // reasoning exitClusterExpansion already restores on the way out. Reading past it to
  // preClusterWalkingDistanceMinutes here keeps that borrowed ring out of the address bar, so a
  // history entry written while a group is expanded never bakes it in as if it were chosen.
  const realRadius = state.clusterExpanded && state.preClusterWalkingDistanceMinutes != null
    ? state.preClusterWalkingDistanceMinutes
    : state.walkingDistanceMinutes;
  if (onNearbyFamily && realRadius !== DEFAULT_WALKING_DISTANCE_MINUTES) {
    parts.push(`radius=${realRadius}`);
  }
  // A shared /nearby?show= link is an ephemeral landing lens just like /nearby/<slug>.
  // Keep its query visible while that lens is active; otherwise the first selectOverview() during
  // a cold/nuke refresh rewrites the URL to bare /nearby before the caller can verify the refresh.
  // Every category on is the show-everything override, written as the "All nearby" link's own
  // ?filters=false rather than a list of every key.
  if (pathname === NEARBY_PATH && state.overviewFiltersEphemeral && railSelection().length === 0) {
    parts.push("filters=false");
  } else if ((pathname === ROUTE_PATHS[ROUTE_FILTERS]
    || (pathname === NEARBY_PATH && state.overviewFiltersEphemeral)) && state.overviewFilters.length) {
    parts.push(`show=${state.overviewFilters.join(",")}`);
  }
  if (pathname === ROUTE_PATHS[ROUTE_SEARCH] && state.searchQuery) {
    parts.push(`q=${encodeURIComponent(state.searchQuery)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// The business a /find/<slug>/ landing names, or null for any other path ("events" is not a place).
function findLandingSlug() {
  const match = /^\/find\/([a-z0-9-]+)\/?$/.exec(window.location.pathname);
  return match && match[1] !== "events" ? match[1] : null;
}

// True while a /find/<slug>/ landing has not yet shown its place: the place is selected only once it
// is in the loaded landmarks, and the boot reveal and cow data both reach selectOverview() before
// that. Until then the Nearby list must not paint over the server-rendered panel. Once the data has
// loaded without the place, the landing has nothing to wait for and falls back to the Nearby list.
function findLandingAwaitingPlace() {
  const slug = findLandingSlug();
  return Boolean(slug) && !state.selected && (!state.dataLoaded || Boolean(findPlaceByFindSlug(slug)));
}

// The reverse of urlPartsForRouteValue: reconstructs the bare route value currentScreenRoute()
// and applyRouteToScreen() already speak, from the real URL on screen right now.
function routeValueFromLocation() {
  const pathname = window.location.pathname;
  const screenName = Object.keys(ROUTE_PATHS).find((name) => ROUTE_PATHS[name] === pathname);
  if (screenName) {
    const hash = window.location.hash.replace(/^#/, "").trim();
    return screenName === ROUTE_REPORT && hash ? hash : screenName;
  }
  // The reverse of urlPartsForRouteValue's own /find/<slug>/ case above: a popstate landing back
  // on one of these (reached only via that pushState -- a hard page load of the real static file
  // never runs this, since boot() hasn't happened yet) re-selects the same place through the
  // ordinary "landmark" SELECTION_ROUTES entry, exactly as if #place=<hashKey> had named it.
  // "events" is the one /find/ path that isn't a place (scripts/generate-business-pages.js's own
  // RESERVED_SLUGS) and never reaches findPlaceByFindSlug.
  const findMatch = /^\/find\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (findMatch && findMatch[1] !== "events") {
    const item = findPlaceByFindSlug(findMatch[1]);
    if (item) return routeParam("place", placeHashKey(item));
  }
  return window.location.hash.replace(/^#/, "").trim();
}

function syncHashFromSelection(options) {
  setHashFromSelection(currentScreenRoute(), options);
}

// Writes `value` into the URL as a new history entry. `force` pushes even when the URL is
// unchanged, for the cluster group screen, which has no URL of its own but is still a screen
// the back button has to be able to leave.
function setHashFromSelection(value, { force = false } = {}) {
  if (routeApplyDepth > 0 || routerBooting) return;
  const { pathname, hash } = urlPartsForRouteValue(value);
  const nextUrl = `${pathname}${searchStringForPath(pathname)}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (!force && currentUrl === nextUrl) return;
  history.pushState(
    { [NAV_DEPTH_KEY]: navDepth() + 1, [NEARBY_ANCHOR_KEY]: nearbyAnchorSnapshot() },
    "",
    nextUrl
  );
}

// Called after every Nearby browse move (a cluster tap, a tap on open ground, or clearing the
// anchor) to record it in history -- named for that purpose rather than left as a bare
// syncHashFromSelection() call so each call site still reads as "record this anchor move".
// Safe to call even when selectOverview()'s own trailing syncHashFromSelection() (via
// refreshNearbyRadiusView) already pushed the very same URL moments earlier: now that
// currentScreenRoute() carries state.nearbyAnchor itself (nearbyAnchorRouteValue), a second call
// here is just setHashFromSelection's own "URL unchanged" no-op rather than a duplicate entry --
// unlike before this existed, when the anchor had no hash of its own and every move needed a
// forced push to get a back-button step at all.
function pushNearbyAnchorHistory() {
  syncHashFromSelection();
}

// Corrects the current entry's URL without adding one, keeping the entry's depth.
function replaceHashInPlace(value) {
  const { pathname, hash } = urlPartsForRouteValue(value);
  const url = `${pathname}${searchStringForPath(pathname)}${hash}`;
  history.replaceState(history.state, "", url);
}

// While the Filters screen is open, every change to state.overviewFilters corrects /filter's
// own query string in place -- replaces rather than pushes, or every checkbox toggle would add
// its own back-button step. Arriving at Filters already gets the right query string for free
// (setHashFromSelection/replaceHashInPlace above both run searchStringForPath on push); this
// is only for a change that happens without a screen transition alongside it.
// Shared by setOverviewFilters (while on /filter) and setSearchQuery (while on /search) --
// searchStringForPath already returns "" for a path with nothing live to carry, so this is a
// no-op on every other screen without needing to ask which one called it.
function syncLiveQueryStringForScreen() {
  if (routeApplyDepth > 0 || routerBooting) return;
  const search = searchStringForPath(window.location.pathname);
  if (window.location.search === search) return;
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  history.replaceState(history.state, "", url);
}

// The back/forward buttons, the device back gesture, and a hash the user edited by hand.
// Both events reach here: pushState fires neither, a traversal fires popstate (and hashchange
// too, when the fragment differs), and a hand-edited fragment fires hashchange alone.
// Re-applying a route the app is already on is the same as doing nothing, so the shared
// entry point simply checks first.
function applyRouteFromUrl() {
  // A ?show= on whichever path was just navigated to (back/forward, or a hand-typed URL) is
  // applied before the route itself, the same way boot() applies it once up front -- so e.g.
  // routing to /nearby?show=pubs,cafes or /filter?show=pubs lands with the right filters on.
  // Guarded the same way applyRoute() guards its own screen change: setOverviewFilters() (called
  // from applyShowFilterFromQuery) looks at state.filterScreenOpen to decide whether to refresh
  // the live overview or the Filter screen's own list, and at this point that flag still
  // describes the screen being left, not the one the URL is about to open -- unguarded, that
  // stale read pushed a /nearby correction of its own before the real route ever ran, stomping
  // the forward-navigation entry the browser had just restored.
  routeApplyDepth += 1;
  let raw;
  try {
    // A real route change should derive the rail level from its new path. A rail tap uses
    // replaceState only, so it never comes through here and can retain its displayed level.
    state.nearbyRailGroupKey = undefined;
    applyShowFilterFromQuery();
    applySearchQueryFromQuery();
    applyRadiusFromQuery();
    raw = routeValueFromLocation();
    if (urlMatchesCurrentScreen(raw)) return true;
  } finally {
    routeApplyDepth -= 1;
  }
  return applyRoute(raw, false);
}

// A click on a plain <a href="/..."> generated into the inspector (nearbySectionsHtml's
// category/group chips and nearest-tree/cow cards) used to fall straight
// through to the browser's own navigation -- a full page reload that re-downloads and re-boots
// the whole app shell for content already sitting in memory, rather than the instant SPA
// transition every other in-app move (a map tap, a search result, a Nearby-list item) already
// gets. This is the click-handler counterpart to setHashFromSelection: push the target URL as a
// new history entry in the same shape, then run it through applyRouteFromUrl -- the same entry
// point the back/forward buttons and a hand-edited hash already use -- so an intercepted link
// behaves exactly like landing on that URL any other way.
function navigateInApp(href) {
  // Every href this reaches is already a root-relative internal path (every generator above
  // builds one, never a full URL), so this is plain string splitting -- same approach
  // searchStringForPath/urlPartsForRouteValue already use -- rather than the URL class.
  const raw = String(href || "");
  const hashIndex = raw.indexOf("#");
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : "";
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const searchIndex = beforeHash.indexOf("?");
  const search = searchIndex >= 0 ? beforeHash.slice(searchIndex) : "";
  const pathname = searchIndex >= 0 ? beforeHash.slice(0, searchIndex) : beforeHash;
  const targetUrl = `${pathname}${search}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (targetUrl === currentUrl) return;
  history.pushState(
    { [NAV_DEPTH_KEY]: navDepth() + 1, [NEARBY_ANCHOR_KEY]: nearbyAnchorSnapshot() },
    "",
    targetUrl
  );
  applyRouteFromUrl();
}

// Applies the route named in the URL at load time. Unlike applyRouteFromUrl this leaves an
// empty hash alone: at boot the Nearby screen has already been built behind the loading
// overlay, and there is nothing to navigate away from.
function applySelectionFromHash(announceMissing = true) {
  const raw = routeValueFromLocation();
  if (!raw) return false;
  return applyRoute(raw, announceMissing);
}

// Puts the app on the screen `raw` names. Nothing in here writes the URL -- the URL is where
// `raw` came from.
function applyRoute(raw, announceMissing = false) {
  routeApplyDepth += 1;
  try {
    return applyRouteToScreen(raw, announceMissing);
  } finally {
    routeApplyDepth -= 1;
  }
}

function applyRouteToScreen(raw, announceMissing) {
  const value = String(raw || "").replace(/^#/, "").trim();

  // Whatever the route turns out to be, arriving at one is navigating away from an expanded
  // map group -- the one screen with no URL of its own (see urlMatchesCurrentScreen).
  state.clusterZoomed = false;
  exitClusterExpansion();

  if (!value) {
    goToInitialView(false);
    return true;
  }
  if (value === ROUTE_FILTERS) {
    openFiltersScreen();
    return true;
  }
  if (value === ROUTE_SEARCH) {
    openSearchScreen();
    return true;
  }
  if (value === ROUTE_SETTINGS) {
    openSettings();
    return true;
  }
  if (value === ROUTE_COMMUNITY) {
    openCommunityOrFeedback();
    return true;
  }

  const params = new URLSearchParams(value);

  // #report opens the report-a-problem form. The weekly reports link here so a reader who
  // spots a mistake lands straight on the form, and #report=<text> pre-fills it with which
  // report they were reading.
  if (params.has(ROUTE_REPORT)) {
    openReportModal();
    const prefill = params.get(ROUTE_REPORT);
    const detailsInput = document.getElementById("reportDetails");
    if (prefill && detailsInput && !detailsInput.value) {
      detailsInput.value = `${prefill}: `;
    }
    return true;
  }

  for (const route of SELECTION_ROUTES) {
    if (!params.has(route.param)) continue;
    const item = route.find(params.get(route.param));
    if (item) {
      showRoutedSelection(route, item);
      return true;
    }
    break;
  }

  // "near=<lat>,<lon>" -- a shared or hand-edited browse-anchor link, not a selection (see
  // NEARBY_ANCHOR_PARAM). A popstate normally never reaches this: restoreNearbyAnchorFromHistory
  // (js/nav.js) already applied the target entry's anchor before applyRouteFromUrl ran, so
  // urlMatchesCurrentScreen short-circuits above. This is what actually resolves it for a fresh
  // load and for a hashchange with no matching history traversal (a hand-edited fragment, or a
  // future in-page link straight to a "near=" hash).
  if (params.has(NEARBY_ANCHOR_PARAM)) {
    const anchor = parseNearbyAnchorParam(params.get(NEARBY_ANCHOR_PARAM));
    if (anchor) {
      applyNearbyAnchorFromRoute({ ...anchor, label: params.get(NEARBY_ANCHOR_LABEL_PARAM) || null });
      return true;
    }
  }

  if (announceMissing) setStatus("Linked location was not found in this dataset.");
  // The URL names something this dataset has no answer for (a stale share link, an item
  // dropped by a data update). Leaving it in the address bar would leave the app on a screen
  // its URL does not describe -- and so make the next back press unpredictable -- so fall
  // back to Nearby and correct the entry in place rather than pushing another one.
  goToInitialView(false);
  replaceHashInPlace("");
  return false;
}

function showRoutedSelection(route, item) {
  // A real selection replaces the Nearby view entirely, so any custom browse point -- and its
  // map dot (drawNearbyAnchorMarker, js/renderer.js) -- goes back to the user's own location
  // rather than lingering for whenever Nearby is next shown.
  // Capture the currently drawn browse pivot before clearing it; otherwise entering a linked
  // selection from an anchored Nearby view makes the 3D/heading-up camera jump to the GPS fix
  // before the selection's own camera animation can take over.
  startCameraOriginTransition();
  state.nearbyAnchor = null;
  state.selected = { type: route.type, item };
  route.show(item);
  // The direction arrow for the new selection: it spins while a first fix is still out.
  updateCompassOverlay();
  // Deep-linked selections behave like a map-tap selection: the inspector opens expanded
  // immediately on both mobile and desktop (spec.md "Inspector modes"). Force it open (not
  // just skip minimizing) so arriving at a new linked location while the inspector was
  // already minimized doesn't stay collapsed.
  setInspectorMinimized(false);
  startCompassNavigation();
  if (state.userLocation) ensureUserAndSelectionVisible({ animate: true, force: true, assumeInspectorOpen: true });
  else if (item.point) {
    // A deep-linked selection can arrive before a location fix exists. The inspector has already
    // been opened above, so the first fit must use the map area that remains visible beside/above
    // that panel; fitting against the full canvas leaves the destination underneath it until a
    // later resize or camera correction happens.
    fitToPoints([item.point], false, { animate: true, focusVisibleArea: true, assumeInspectorOpen: true });
  }
  requestDraw();
}

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

// A /nearby/<slug> category page IS the app (scripts/generate-find-pages.js templates it off
// this same app.html), so the path itself names the category to land already filtered to --
// slugFor() in that script turns an underscore into a hyphen, this is the reverse. ?show=
// stays as a fallback entry point for any older link still using the query-param form.
// /nearby/<slug> is either one subfilter's own page or a whole top-level group's page
// (collectPages in scripts/generate-find-pages.js generates both) -- this is the reverse of
// either: the filter keys to apply, one for a subfilter slug, every member key for a group
// slug (e.g. /nearby/food resolves to ["pubs", "restaurants", "cafes", "shops"]). "filter" and
// "search" never match a real category (RESERVED_SLUGS in that script keeps it that way), so
// this falls through to [] for /nearby/filter and /nearby/search exactly as it should --
// those two are screens in their own right, not categories.
function filterKeysFromFindPath(pathname) {
  const match = /^\/nearby\/([a-z0-9-]+)\/?$/.exec(String(pathname || ""));
  if (!match) return [];
  const key = match[1].replace(/-/g, "_");
  if (ALL_OVERVIEW_FILTER_KEYS.has(key)) return [key];
  const group = FILTER_GROUPS_BY_KEY.get(key);
  if (!group) return [];
  return group.subfilters.map((s) => s.key).filter((k) => ALL_OVERVIEW_FILTER_KEYS.has(k));
}

// ?show=pubs,cafes -- /filter's own live query string (searchStringForPath) writes exactly
// this comma-joined form, and this is its reverse: every key /filter or a shared link named,
// filtered to ones ALL_OVERVIEW_FILTER_KEYS actually recognises so a typo or a stale key drops
// silently rather than breaking the parse.
function filterKeysFromQuery(search) {
  const raw = new URLSearchParams(search).get("show");
  if (!raw) return [];
  return raw.split(",").map((key) => key.trim()).filter((key) => ALL_OVERVIEW_FILTER_KEYS.has(key));
}

// ?filters=false -- "All nearby" links (the Nearby category-navigation chip, and the walk-radius card
// in a place's inspector). Means "ignore my saved filters and show every category", so it is read
// here as its own override rather than a ?show= list: applyShowFilterFromQuery applies every key
// ephemerally (persist:false), and the reader's own filters come back on the next plain visit.
function showsEverythingFromQuery(search) {
  return new URLSearchParams(search).get("filters") === "false";
}

// True on a /nearby/<slug>/ category page (a subfilter's own, or a whole group's) -- the landing
// whose Nearby list generate-find-pages.js server-renders, and so the one that keeps it on screen
// until the reader's own location resolves (_serverRenderedNearbyList, js/inspector.js).
function isNearbyCategoryLandingPath() {
  return filterKeysFromFindPath(window.location.pathname).length > 0;
}

// True when this load's own URL already names a landing-page pre-filter -- a /nearby/<slug>
// page's own path, a first-touch ?show= link, or a /find/<slug>/ business page's own path --
// read straight off the URL rather than off state.overviewFilters/overviewFiltersEphemeral
// (what activeFiltersShowFullListWithoutLocation() checks): boot() needs this answer before
// applyShowFilterFromQuery() has run, at the point where it decides whether to show onboarding
// at all. A reader arriving this way already has their own category -- or, for /find/, their
// own exact business -- picked for them; the first-run setup wizard (pick what to see, enable
// location) doesn't fit that arrival and is saved for a first visit to the plain Nearby screen.
// "events" is the one /find/ path that isn't a business of its own (same carve-out
// routeValueFromLocation's own findMatch makes) and falls through to the ordinary first-run check.
function isLandingPageArrival() {
  const findMatch = /^\/find\/([a-z0-9-]+)\/?$/.exec(window.location.pathname);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hasSelectionHash = SELECTION_ROUTES.some((route) => hashParams.has(route.param));
  return filterKeysFromFindPath(window.location.pathname).length > 0
    || filterKeysFromQuery(window.location.search).length > 0
    || hasSelectionHash
    || (findMatch != null && findMatch[1] !== "events");
}

// True once this load is a dedicated app launch rather than an ordinary browser tab -- an
// installed home-screen PWA (display-mode: standalone, or iOS's older navigator.standalone) or
// a Capacitor native wrapper (spec-native.md; js/native.js doesn't exist yet, so this checks
// window.Capacitor directly rather than depending on it). Only this context gets the full-screen
// #loadingOverlay boot() has always shown: a deliberate app open, usually served from the service
// worker's own caches, where a branded step-by-step wait reads as a splash screen rather than
// something hiding content the visitor already has. Every ordinary browser tab -- including
// every /nearby/<slug> and /find/<slug> SEO landing page -- never shows it: #loadingOverlay
// starts `hidden` in app.html, so a no-JS visitor or a crawler sees the server-rendered content
// immediately (spec-marketing.md §6.6/6.7), and boot() below only ever shows a thin, non-blocking
// top progress bar (the same element, styled via the "inline" class in css/loading.css) while
// the same data loads behind the map and static content, which stay visible and interactive the
// whole time.
function isInstalledAppContext() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia missing or the query unsupported -- fall through to the other checks.
  }
  if (window.navigator && window.navigator.standalone === true) return true;
  if (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform()) return true;
  return false;
}

function applyShowFilterFromQuery({ render = true } = {}) {
  if (showsEverythingFromQuery(window.location.search)) {
    setOverviewFilters(Array.from(ALL_OVERVIEW_FILTER_KEYS), { persist: false, render });
    return;
  }
  const fromPath = filterKeysFromFindPath(window.location.pathname);
  if (fromPath.length) {
    setOverviewFilters(fromPath, { persist: false, render });
    return;
  }
  // /nearby/filter's own ?show= (searchStringForPath) is a live mirror of whatever is already
  // active, not an external pre-filter -- real only when it is how the reader first arrived
  // (routeApplyDepth is still 0: boot(), or a shared /nearby/filter?show= link read fresh).
  // Retracing a history entry on /nearby/filter itself (back/forward, routeApplyDepth > 0 inside
  // applyRouteFromUrl) reads the exact value this same reader's own earlier action wrote, so
  // reapplying it would wrongly flag already-active filters -- the ordinary 1-3 filter default
  // state included -- as a page's own ephemeral lens, handing them the no-location full-list/fit
  // treatment meant only for an actual single-category or group-page arrival (for the default
  // filters, that means trying to list and fit every tree in the forest). Nothing has changed on
  // this path, so there is nothing to (re)apply.
  if (window.location.pathname === ROUTE_PATHS[ROUTE_FILTERS] && routeApplyDepth > 0) return;
  const fromQuery = filterKeysFromQuery(window.location.search);
  if (fromQuery.length) {
    setOverviewFilters(fromQuery, { persist: false, render });
    return;
  }
  // Landing on the bare Nearby path with nothing selected (no hash -- a tree/cow/landmark
  // selection without its own /find/ page also lands on NEARBY_PATH, but always carries one,
  // see urlPartsForRouteValue) while still showing a /nearby/<slug> page's own ephemeral category
  // is the reader explicitly leaving that lens -- the "All nearby" category-navigation chip, or any
  // other link/back-nav straight to the plain Nearby screen -- so put their own filters back.
  // goToInitialView() (js/nav.js) already does this same restore for the *selection* half of
  // "leaving" (the Nearby nav button, the inspector back arrow), but can't cover this case: the
  // route value is "" both before and after ("nothing selected" either way), so
  // urlMatchesCurrentScreen() reads it as no change and applyRouteFromUrl() returns before
  // applyRoute()/goToInitialView() ever run.
  if (window.location.pathname === NEARBY_PATH && !window.location.hash && state.overviewFiltersEphemeral) {
    setOverviewFilters(loadStoredOverviewFilters(), { render });
  }
}

// ?q=<text> -- /search's own live query string (searchStringForPath), reversed: whatever a
// shared link named, set directly rather than through setSearchQuery so a query arriving before
// the Search screen itself has opened (a fresh /search?q=... load, or back/forward onto it)
// needs no element on the page yet -- openSearchScreen's own render picks up state.searchQuery
// the same way it already does for a query restored within the same session (see its comment).
function applySearchQueryFromQuery() {
  const query = new URLSearchParams(window.location.search).get("q");
  if (query) state.searchQuery = query;
}

// ?radius=<minutes> -- searchStringForPath's reverse, on any of Nearby's own paths (see its
// comment). Clamped to the slider's own bounds (js/nav.js) rather than trusted outright: a
// shared link is as editable as any URL, and the dynamic per-origin floor corrects a value
// that's merely too tight for the actual nearest match on the next fix, the same way the
// Settings slider and the pinch gesture already self-correct (see "radius widens itself back
// out as you walk" in spec.md).
function applyRadiusFromQuery() {
  // Number(null) is 0, not NaN -- read the raw param first so a missing ?radius= is left alone
  // instead of silently clamping every other navigation's radius down to the 1-minute floor.
  const param = new URLSearchParams(window.location.search).get("radius");
  if (param == null) {
    // A /nearby/<slug> landing page gets the wider default unless the link itself already named
    // a radius above -- the same "arrival sets the lens" treatment applyShowFilterFromQuery
    // already gives that page's filters, so it applies every time this path is landed on, boot
    // or popstate alike, consistently with how the filters themselves are re-applied there too.
    if (filterKeysFromFindPath(window.location.pathname).length) {
      state.walkingDistanceMinutes = LANDING_PAGE_WALKING_DISTANCE_MINUTES;
    }
    return;
  }
  const raw = Number(param);
  if (!Number.isFinite(raw)) return;
  state.walkingDistanceMinutes = clamp(raw, WALKING_RADIUS_MIN_MINUTES, WALKING_RADIUS_MAX_MINUTES);
}

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
    const targetScale = maxScaleForRadiusVisible(focusRect);
    centerOverviewOnUserLocation({ scale: targetScale * 0.82, focusVisibleArea: true });
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

// --- Permission asks -----------------------------------------------------------------------
// Every ask follows the same rules (spec.md "Permissions and consent"): the app asks in its own
// words first, and a system dialog only ever follows a tap on that ask; a "not now" is remembered,
// so no later launch puts a system prompt in front of someone who already refused. The first-visit
// card uses one explicit fast path for location and usage analytics; Settings remains the way to
// review or withdraw either choice later.

// "granted" (asked for location in the app), "declined" (said not now in the app, or refused the
// system dialog), or null (never asked).
function storedLocationChoice() {
  try {
    const stored = localStorage.getItem(LOCATION_CHOICE_KEY);
    if (stored === "granted" || stored === "declined") return stored;
    // Before the choice had a key of its own, the old bundled "Enable location" tap recorded
    // usage consent and nothing else -- read that as having asked for location.
    if (localStorage.getItem("ff-track-v1") === "1") return "granted";
  } catch {}
  return null;
}

function rememberLocationChoice(choice) {
  try { localStorage.setItem(LOCATION_CHOICE_KEY, choice); } catch {}
}

// Whether boot may request a position on its own. Only when that cannot put an unexplained system
// prompt on screen: the permission is already granted (it answers silently), or this person asked
// for location in the app before, so a browser that re-asks every session is answering their own
// request. A permission state of "unknown" counts as a prompt.
function bootMayRequestLocation(permission, choice) {
  if (permission === "granted") return true;
  if (permission === "denied") return false;
  return choice === "granted";
}

function locationInviteMessage() {
  const fallbackWalk = formatWalkingRadius(state.walkingDistanceMinutes);
  return `You're viewing finds within a ${fallbackWalk} walk of High Beach. Share your location for a more custom experience — centred on you, with real distances.`;
}

// Shown in place of an "Enable location" button that could not work: the permission is refused at
// the browser or OS level, where a request fails without ever asking.
function locationBlockedMessage() {
  return Native.isNative
    ? "Location is turned off for Epping Forest Finds. Turn it on in your phone's Settings to centre the map on you."
    : "Location is blocked for this site. Allow it in your browser's site settings to centre the map on you.";
}

// Boot reached here with no real GPS fix -- denied, timed out, unsupported, or skipped in
// onboarding. Every page, including a /nearby/<slug> landing page, gets a usable map straight
// away by standing in at DEFAULT_LOCATION (High Beach), with the same walking-radius-circle
// reveal a real fix gets (revealMapCenteredOnUser) -- a landing page already defaults its radius
// to 30 minutes (LANDING_PAGE_WALKING_DISTANCE_MINUTES, applyRadiusFromQuery), so this just gives
// it an origin to actually measure that radius from instead of listing the whole category
// unsorted. A dismissible, non-blocking invite (offerLocationInvite) nudges toward a real fix for
// the exact same view centred on the user -- skipped when this boot already asked (onboarding's
// own location step, or showConsentBanner's location stage) or this person said not now before.
//
// hasRealLocation() guards applyDefaultLocation() because this path and a real fix can
// genuinely race: showConsentBanner()'s own tap fires locateUser() independently of boot(), and
// the non-blocking loading bar no longer holds up clicks on that banner, so a fast tap can land a
// real fix before boot() reaches this fallback. Without the guard, that real fix was overwritten
// back to the High Beach stand-in the moment boot() got here.
async function revealNoRealLocation({ locationAlreadyAsked, deferLocationInvite = false, locationBlocked = false }) {
  if (!hasRealLocation()) applyDefaultLocation();

  if (!findLandingSlug() && !communityScreenOpen()) selectOverview();
  // A static index's arrows point north until there is a bearing to rotate them by -- the default
  // origin applyDefaultLocation() just set. Only the arrows change; the list itself stays as drawn.
  if (_staticNearbyIndex) updateOverviewDirectionArrows();
  draw();
  if (!communityScreenOpen()) applySelectionFromHash();
  await revealMapCenteredOnUser();

  if (locationAlreadyAsked || deferLocationInvite) return;
  offerLocationInvite({ blocked: locationBlocked });
}

function offerLocationInvite({ blocked = false } = {}) {
  if (!Native.geolocation) {
    const fallbackWalk = formatWalkingRadius(state.walkingDistanceMinutes);
    showLocationInviteBanner(`This browser does not support location access, so you're viewing finds within a ${fallbackWalk} walk of High Beach instead.`, { canRequest: false });
  } else if (blocked) {
    showLocationInviteBanner(locationBlockedMessage(), { canRequest: false });
  } else {
    showLocationInviteBanner(locationInviteMessage(), { canRequest: true });
  }
}

function hideNoticeCard(banner) {
  banner.classList.add("fading-out");
  banner.addEventListener("transitionend", () => {
    banner.hidden = true;
    banner.classList.remove("fading-out");
    // The next waiting question, if any, takes the slot once this one has gone.
    askAnalyticsWhenFree();
  }, { once: true });
}

// Non-blocking "get a more custom experience" nudge shown after revealNoRealLocation() -- the
// map and Nearby list behind it are already usable, so this never covers the whole screen. Same
// inline, dismissible treatment as showConsentBanner()'s own card, in the same inspector-chrome
// slot, and never at the same time as it. With canRequest false (location blocked or unsupported)
// it explains instead of offering a button that could not work.
function showLocationInviteBanner(message, { canRequest = true } = {}) {
  const banner = els.locationInviteBanner;
  if (!banner) return;
  if (els.consentBanner && !els.consentBanner.hidden) return;

  if (els.locationInviteMessage) els.locationInviteMessage.textContent = message;
  if (els.locationInviteButton) els.locationInviteButton.hidden = !canRequest;
  if (els.locationInviteDismiss) els.locationInviteDismiss.textContent = canRequest ? "Maybe later" : "OK";

  function cleanup() {
    els.locationInviteButton?.removeEventListener("click", onAccept);
    els.locationInviteDismiss?.removeEventListener("click", onDecline);
  }

  function onAccept() {
    cleanup();
    hideNoticeCard(banner);
    rememberLocationChoice("granted");
    locateUser({ initial: false });
  }

  function onDecline() {
    cleanup();
    rememberLocationChoice("declined");
    hideNoticeCard(banner);
  }

  els.locationInviteButton?.addEventListener("click", onAccept);
  els.locationInviteDismiss?.addEventListener("click", onDecline);

  banner.classList.remove("fading-out");
  banner.hidden = false;
}

// The first ask for anyone onboarding did not reach -- a first visit, a landing-page arrival, or a
// returning visitor with a question still unanswered. One non-blocking card in the inspector
// chrome (#consentBanner, app.html, css/loading.css) leaves the map fully usable underneath. On a
// first visit its single explicit action covers the two initial choices; after that it offers the
// optional guided map setup in the same slot. Landing-page arrivals use that same combined action
// whenever both choices are still unanswered. On iOS the compass is asked from the same location
// tap (locateUser), because only a user gesture can ask for it.
function showConsentBanner({ askLocation = false, askAnalytics = false, offerOnboarding = false } = {}) {
  const banner = els.consentBanner;
  if (!banner || (!askLocation && !askAnalytics && !offerOnboarding)) return false;
  let stage = askLocation ? (askAnalytics ? "permissions" : "location")
    : askAnalytics ? "analytics" : "onboarding";

  function renderLocationStage() {
    banner.setAttribute("aria-label", "Location");
    if (els.consentBannerTitle) els.consentBannerTitle.textContent = "See what's near you";
    // Generated landing pages replace the shell's default paragraph with a lead that names the
    // category or place. Keep that useful server-rendered copy when the live page only needs the
    // location question; the combined first-run card still supplies its own copy below.
    const pageSpecificCopy = els.consentBannerText
      && /^Enable location to get walking directions/.test(els.consentBannerText.textContent || "");
    if (els.consentBannerText && !pageSpecificCopy) {
      els.consentBannerText.innerHTML = `Enable location to centre the map on you and see real walking distances. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a>`;
    }
    if (els.consentBannerDecline) els.consentBannerDecline.textContent = "Maybe later";
    if (els.consentBannerAccept) els.consentBannerAccept.textContent = "Enable location";
  }

  function renderPermissionsStage() {
    banner.setAttribute("aria-label", "Location and cookies");
    if (els.consentBannerTitle) els.consentBannerTitle.textContent = "Allow location & cookies";
    if (els.consentBannerText) {
      els.consentBannerText.innerHTML = `Shows nearby finds and their distance from you, and helps us understand how people use this site — enabling covers both. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a>`;
    }
    if (els.consentBannerDecline) els.consentBannerDecline.textContent = "Maybe later";
    if (els.consentBannerAccept) els.consentBannerAccept.textContent = "Enable location & cookies";
  }

  function renderAnalyticsStage() {
    banner.setAttribute("aria-label", "Usage analytics");
    if (els.consentBannerTitle) els.consentBannerTitle.textContent = "Help improve the map?";
    if (els.consentBannerText) {
      els.consentBannerText.innerHTML = `Share anonymous usage data — which screens you use and where you are while the app is open — and allow Google Analytics cookies. It is never sold or used for advertising. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a>`;
    }
    if (els.consentBannerDecline) els.consentBannerDecline.textContent = "No thanks";
    if (els.consentBannerAccept) els.consentBannerAccept.textContent = "Share usage data";
  }

  function renderOnboardingStage() {
    banner.setAttribute("aria-label", "Map setup");
    if (els.consentBannerTitle) els.consentBannerTitle.textContent = "Make the map yours";
    if (els.consentBannerText) {
      els.consentBannerText.innerHTML = "Choose the finds you want to see. You can change these anytime in Filters.";
    }
    if (els.consentBannerDecline) els.consentBannerDecline.textContent = "Explore first";
    if (els.consentBannerAccept) els.consentBannerAccept.textContent = "Set up my map";
  }

  function cleanup() {
    els.consentBannerAccept?.removeEventListener("click", onAccept);
    els.consentBannerDecline?.removeEventListener("click", onDecline);
  }

  function advance() {
    if (offerOnboarding && (stage === "permissions" || stage === "location" || stage === "analytics")) {
      stage = "onboarding";
      renderOnboardingStage();
      return;
    }
    if (stage === "location" && askAnalytics && analyticsChoice() === "undecided") {
      stage = "analytics";
      renderAnalyticsStage();
      return;
    }
    cleanup();
    hideNoticeCard(banner);
  }

  function onAccept() {
    if (stage === "permissions") {
      rememberLocationChoice("granted");
      if (analyticsChoice() === "undecided") setAnalyticsConsent(true);
      locateUser({ initial: false });
    } else if (stage === "location") {
      rememberLocationChoice("granted");
      locateUser({ initial: false });
    } else if (stage === "analytics") {
      setAnalyticsConsent(true);
    } else {
      cleanup();
      banner.classList.remove("fading-out");
      banner.hidden = true;
      showOnboarding({ skipPermissions: true }).then((onboardResult) => {
        state.overviewFilters = sanitizeOverviewFilters(onboardResult.filters);
        saveFilterState();
        updateFilterUi();
        if (isOverviewScreenActive()) selectOverview();
        requestDraw();
      });
      return;
    }
    advance();
  }

  function onDecline() {
    if (stage === "permissions") {
      rememberLocationChoice("declined");
      if (analyticsChoice() === "undecided") setAnalyticsConsent(false);
    } else if (stage === "location") rememberLocationChoice("declined");
    else if (stage === "analytics") setAnalyticsConsent(false);
    else {
      cleanup();
      banner.classList.remove("fading-out");
      banner.hidden = true;
      return;
    }
    advance();
  }

  els.consentBannerAccept?.addEventListener("click", onAccept);
  els.consentBannerDecline?.addEventListener("click", onDecline);

  if (stage === "permissions") renderPermissionsStage();
  else if (stage === "location") renderLocationStage();
  else if (stage === "analytics") renderAnalyticsStage();
  else renderOnboardingStage();
  banner.classList.remove("fading-out");
  banner.hidden = false;
  return true;
}

// Usage analytics for a returning visitor who has never answered it, held back until no other
// card or the onboarding dialog is on screen, so two questions never stack.
function askAnalyticsWhenFree() {
  if (typeof analyticsChoice !== "function" || analyticsChoice() !== "undecided") return;
  if (!state.dataLoaded) return;
  const busy = [els.consentBanner, els.locationInviteBanner, document.getElementById("onboardingOverlay")]
    .some((el) => el && !el.hidden);
  if (busy) return;
  showConsentBanner({ askAnalytics: true });
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

  // A /nearby/<slug>/ landing already shows its server-rendered list (see
  // _serverRenderedNearbyList, js/inspector.js); keep it there until a real fix or the reveal.
  _staticNearbyIndex = Boolean(document.querySelector("[data-server-rendered-nearby]"));
  _serverRenderedNearbyList = isNearbyCategoryLandingPath() || (_staticNearbyIndex && staticNearbyIndexFiltersAreDefault());
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
  const onboardsFirst = !hasCompletedOnboarding() && !isLandingPageArrival();
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
  if (asksFromBanner && (locationUnasked || analyticsUnasked || onboardsFirst)) {
    // First visits and landing-page arrivals use the non-blocking inspector card so the map is
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
  if (locationUnasked && asksFromBanner) {
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
        { enableHighAccuracy: true, timeout: BOOT_GEOLOCATION_TIMEOUT_MS, maximumAge: 30000 }
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
        checkDistanceToForest(latitude, longitude);
        ensureLocationWatch();

        // Request compass only if not already handled (e.g. by onboarding).
        if (state.compassPermission === "unknown" && !compassPermissionCanBeRequested()) {
          requestCompassPermissionIfNeeded({ fromGesture: false });
        }

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
        if (state.selected) {
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
    askAnalyticsWhenFree();

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
// genuine teleport should land at once rather than crawl there over seconds.
const LOCATION_SMOOTHING_SNAP_METRES = 30;
// Smoothing is for walking-pace wander. Travelling faster than this -- a bike, a bus, a train --
// the easing trails the real position by speed x time constant (2.5s at 20 m/s is 50m), and
// the Nearby list, built from that trailing position, lags with it. So above it each fix is
// used as delivered: at that speed a few metres of wander is nothing against the motion.
const LOCATION_FAST_TRAVEL_MPS = 5;
// Consecutive fixes cannot tell travel from wander (two fixes 12m apart a second apart is
// ordinary wander under trees), so without the device's own speed reading the speed is judged
// over at least this long, where the wander averages out and real travel does not.
const LOCATION_SPEED_BASELINE_MIN_MS = 8000;
const LOCATION_SPEED_HISTORY_MS = 15000;
// How close counts as arrived, in projected units -- comfortably sub-metre, so the ease
// lands on the fix rather than crawling at it forever.
const LOCATION_GLIDE_EPSILON = 1e-7;

// Whether the person is travelling faster than walking pace: the device's own speed reading
// (coords.speed, from the GPS itself) when it gives one, or the distance covered over the last
// LOCATION_SPEED_BASELINE_MIN_MS or more of fixes.
function recordFixAndDetectFastTravel(latitude, longitude, now, speed) {
  const history = (state.locationFixHistory || []).filter((fix) => fix.at <= now && now - fix.at <= LOCATION_SPEED_HISTORY_MS);
  history.push({ at: now, latitude, longitude });
  state.locationFixHistory = history;
  if (Number.isFinite(speed) && speed >= LOCATION_FAST_TRAVEL_MPS) return true;
  const baseline = history.find((fix) => now - fix.at >= LOCATION_SPEED_BASELINE_MIN_MS);
  if (!baseline) return false;
  const metresPerSecond = distanceMetres(baseline.latitude, baseline.longitude, latitude, longitude) / ((now - baseline.at) / 1000);
  return metresPerSecond >= LOCATION_FAST_TRAVEL_MPS;
}

// Turns one raw fix into the position the app should use. The smoothing itself is done by
// advanceLocationGlide() every frame; this only records where to head for.
function ingestLocationFix(latitude, longitude, accuracy, now = performance.now(), speed = null) {
  const rawPoint = projectLonLat(longitude, latitude);
  const raw = { latitude, longitude, accuracy, point: rawPoint };
  state.rawUserLocation = raw;
  const travellingFast = recordFixAndDetectFastTravel(latitude, longitude, now, speed);

  const previous = state.userLocation;
  const landRaw = () => {
    state.locationGlide = null;
    state.locationSmoothedAt = now;
    return raw;
  };
  if (!previous || !previous.point) return landRaw();
  const movedMetres = distanceMetres(previous.latitude, previous.longitude, latitude, longitude);
  // Not wander: a first fix after a gap, coming out of a tunnel, a genuine teleport. Easing
  // across that reads as the map sliding away on its own.
  if (!Number.isFinite(movedMetres) || movedMetres >= LOCATION_SMOOTHING_SNAP_METRES) return landRaw();
  if (travellingFast) return landRaw();

  state.locationGlide = {
    to: rawPoint,
    // The filter's time constant, from this fix's own reported accuracy: a 5m fix is
    // followed almost as given, a 25m one is leaned on hard.
    tau: clamp(
      (Number.isFinite(accuracy) ? accuracy : 10) / LOCATION_SMOOTHING_ACCURACY_DIVISOR,
      LOCATION_SMOOTHING_MIN_TAU_S,
      LOCATION_SMOOTHING_MAX_TAU_S
    ),
    accuracy,
  };
  // Start the ease clock at this fix, so the first frame after it integrates ~one frame
  // rather than the whole gap since the previous fix (which the staleness guard would then
  // treat as a dead clock and land outright).
  state.locationSmoothedAt = now;
  ensureLocationGlideLoop();
  return previous;
}

// The location object for a projected point, with lat/lon kept consistent with it so
// nothing downstream can read a position and a coordinate that disagree.
function locationAtPoint(point, accuracy) {
  const lonLat = unprojectPoint(point);
  return { latitude: lonLat.latitude, longitude: lonLat.longitude, accuracy, point: { x: point.x, y: point.y } };
}

// Eases state.userLocation toward the latest fix, a frame at a time. Called from
// prepareCanvasForDraw, and it requests the next frame itself while it still has ground to
// cover, so the motion continues whether or not anything else is redrawing.
//
// One continuous filter rather than a per-fix low-pass feeding a fixed-length glide, which
// is what this was first written as. That version only recomputed its target when a fix
// arrived, so a single fix followed by silence left the position permanently short of the
// last thing the device actually told us -- fine while watchPosition keeps firing, wrong
// the moment it stops, and caught by the settings spec waiting for state.userLocation to
// reach a position it had set once. Easing toward the newest raw fix on every frame instead
// smooths exactly the same way while fixes keep arriving (each new one moves the target
// before the last has been reached, so the wander averages out) and always converges on the
// truth when they stop.
// Drives advanceLocationGlide on its own animation frames for as long as a glide is
// pending, rather than relying on the draw loop.
//
// prepareCanvasForDraw advances it too, so the position is always current at paint time,
// but that cannot be the only driver: the map stops painting whenever a secondary screen
// is open, and the position would then freeze part-way to the last fix until something
// else happened to request a draw. Caught in CI by the settings spec, which opens Settings
// and then waits for state.userLocation to reach a position it set -- it waited out the
// whole 60s test timeout. A walker checking their settings must still be where they are
// when they close the screen.
function ensureLocationGlideLoop() {
  if (state.locationGlideFrame != null) return;
  if (typeof requestAnimationFrame !== "function") return;
  const tick = () => {
    state.locationGlideFrame = null;
    if (!state.locationGlide) return;
    if (advanceLocationGlide()) requestDraw();
    if (state.locationGlide) {
      state.locationGlideFrame = requestAnimationFrame(tick);
    }
  };
  state.locationGlideFrame = requestAnimationFrame(tick);
}

function advanceLocationGlide(now = performance.now()) {
  const glide = state.locationGlide;
  if (!glide || !state.userLocation || !state.userLocation.point) return false;
  const from = state.userLocation.point;
  const dx = glide.to.x - from.x;
  const dy = glide.to.y - from.y;

  const lastAt = state.locationSmoothedAt;
  const gapMs = Number.isFinite(lastAt) ? (now - lastAt) : null;
  state.locationSmoothedAt = now;
  // A duplicate call within the same tick has no time to integrate, so it does nothing --
  // it must not land, or two callers in one frame would skip the ease entirely.
  if (gapMs != null && gapMs <= 0) return false;
  // Arrived, or the clock is unusable (no previous timestamp, or a stale one from a
  // backgrounded tab). Land it: the last fix is the best information there is, and stopping
  // short of it is the failure this exists to avoid.
  const arrived = Math.abs(dx) < LOCATION_GLIDE_EPSILON && Math.abs(dy) < LOCATION_GLIDE_EPSILON;
  if (arrived || gapMs == null || gapMs > HEADING_UP_SCALE_EASE_STALE_MS) {
    state.locationGlide = null;
    if (arrived && from.x === glide.to.x && from.y === glide.to.y) return false;
    state.userLocation = locationAtPoint(glide.to, glide.accuracy);
    state.userInMapArea = pointInsideBounds(state.userLocation.point, state.bounds);
    return true;
  }

  const dt = Math.min(gapMs, HEADING_UP_SCALE_EASE_MAX_DT * 1000) / 1000;
  const alpha = 1 - Math.exp(-dt / glide.tau);
  state.userLocation = locationAtPoint({ x: from.x + dx * alpha, y: from.y + dy * alpha }, glide.accuracy);
  state.userInMapArea = pointInsideBounds(state.userLocation.point, state.bounds);
  return true;
}

function applyLocationFix(position) {
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
  // A cold load of /community has already opened its screen (boot); a fix must not wipe it. Nor
  // must Settings' own "Use my location": that answer shows in place, on the row that asked.
  if (!communityScreenOpen() && state.selected?.type !== "settings") state.selected = null;
  if (typeof communityNudgeCheck === "function") setTimeout(communityNudgeCheck, 0);
  // GPS and motion permissions are separate on iOS. A returning visitor can already have a
  // location dot without ever having granted DeviceOrientation access, so surface the compass
  // action as soon as a real fix exists instead of waiting for a destination selection.
  maybeShowCompassPermissionPrompt();
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

function locateUser({ initial }) {
  if (!Native.geolocation) {
    setStatus("This browser does not support location access.");
    return;
  }

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
      const { latitude, longitude, previousPoint } = applyLocationFix(position);
      ensureLocationWatch();
      setLoadStep("location", "done");
      syncSettingsLocationRow();
      if (!compassPermissionCanBeRequested()) {
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
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

function checkDistanceToForest(latitude, longitude) {
  // Don't show warning if already dismissed, or open now
  if (state.distanceWarningShown || (els.distanceWarning && !els.distanceWarning.hidden)) return;
  
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
      els.distanceWarning._deactivateFocus = typeof activateModalFocus === "function"
        ? activateModalFocus(els.distanceWarning, {
            onEscape: () => els.distanceWarningButton?.click(),
          })
        : null;
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
    animateViewportTo(
      { scale: targetScale, tx: targetTx, ty: targetTy },
      options.durationMs || DEFAULT_VIEWPORT_ANIMATION_MS,
      undefined,
      options.cinematic
        ? { cinematic: true, focusPoint: { x: focusRect.x + viewportWidth / 2, y: focusRect.y + viewportHeight / 2 } }
        : undefined,
    );
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

function animateViewportTo(targetViewport, durationMs, onComplete, options = {}) {
  const safeDuration = Math.max(MIN_VIEWPORT_ANIMATION_MS, Number(durationMs) || DEFAULT_VIEWPORT_ANIMATION_MS);
  const cinematic = Boolean(options.cinematic);
  if (!cinematic && viewportAnimationAlreadyHeadedTo(targetViewport)) return;
  stopViewportAnimation();

  const from = {
    scale: state.viewport.scale,
    tx: state.viewport.tx,
    ty: state.viewport.ty,
  };

  // A normal viewport tween interpolates the transform components directly. That is right for
  // small refits, but it makes a High Beach -> GPS handoff feel like a hard yank when both the
  // camera position and scale change at once. The cinematic path interpolates the camera's world
  // centre and adds a shallow zoom-out arc, like a restrained map fly-to: the route becomes clear
  // in the middle of the move, then the camera settles into the final walking-radius fit.
  const focusPoint = options.focusPoint || { x: 0, y: 0 };
  const fromCenter = cinematic && from.scale > 0
    ? { x: (focusPoint.x - from.tx) / from.scale, y: (focusPoint.y - from.ty) / from.scale }
    : null;
  const targetCenter = cinematic && targetViewport.scale > 0
    ? { x: (focusPoint.x - targetViewport.tx) / targetViewport.scale, y: (focusPoint.y - targetViewport.ty) / targetViewport.scale }
    : null;
  const centreDistancePx = fromCenter && targetCenter
    ? Math.hypot(
      (targetCenter.x - fromCenter.x) * Math.min(from.scale, targetViewport.scale),
      (targetCenter.y - fromCenter.y) * Math.min(from.scale, targetViewport.scale),
    )
    : 0;
  const zoomOutRatio = cinematic
    ? clamp(0.10 + (centreDistancePx / 900) * 0.045, 0.10, 0.24)
    : 0;
  const cinematicScaleFloor = cinematic && state.baseFitScale > 0
    ? state.baseFitScale * 0.92
    : 0;

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
    return;
  }

  state.viewportAnimationFrom = from;
  state.viewportAnimationTo = targetViewport;
  state.locationRevealAnimationActive = cinematic;
  state.locationRevealFocusPoint = cinematic ? { x: focusPoint.x, y: focusPoint.y } : null;
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

    if (cinematic && fromCenter && targetCenter) {
      const baseScale = from.scale + (targetViewport.scale - from.scale) * eased;
      const zoomArc = Math.sin(Math.PI * eased) * zoomOutRatio;
      state.viewport.scale = Math.max(cinematicScaleFloor, baseScale * (1 - zoomArc));
      const centreX = fromCenter.x + (targetCenter.x - fromCenter.x) * eased;
      const centreY = fromCenter.y + (targetCenter.y - fromCenter.y) * eased;
      state.viewport.tx = focusPoint.x - centreX * state.viewport.scale;
      state.viewport.ty = focusPoint.y - centreY * state.viewport.scale;
    } else {
      state.viewport.scale = state.viewportAnimationFrom.scale + (state.viewportAnimationTo.scale - state.viewportAnimationFrom.scale) * eased;
      state.viewport.tx = state.viewportAnimationFrom.tx + (state.viewportAnimationTo.tx - state.viewportAnimationFrom.tx) * eased;
      state.viewport.ty = state.viewportAnimationFrom.ty + (state.viewportAnimationTo.ty - state.viewportAnimationFrom.ty) * eased;
    }
    requestDraw();

    if (progress >= 1) {
      state.viewport.scale = state.viewportAnimationTo.scale;
      state.viewport.tx = state.viewportAnimationTo.tx;
      state.viewport.ty = state.viewportAnimationTo.ty;
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

  // Use mapStage as the reference rect when available: its left/top align with
  // the canvas visible origin, so adding canvasInsetX/Y converts to bitmap coords.
  // When falling back to els.canvas, the element's left/top already incorporate
  // the CSS −insetX/Y offset, so (overlap − canvas.left) * dpr already lands in
  // bitmap coords and canvasInsetX/Y must not be added again.
  const useMapStage = Boolean(els.mapStage);
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
      <span id="filterResultsCount" class="filter-results-count"></span>
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

// The Filter screen's own body: the chip groups above, exactly as renderFilterBodyHtml() has
// always built them, plus the same nearest-list markup the plain Nearby screen shows -- so
// toggling a chip has a visible effect right there instead of only being provable by backing
// out to Nearby again. refreshFilterScreenList() re-renders just the list half on every filter
// change; the chip half is only ever patched in place by updateFilterUi(), never rebuilt, so a
// keyboard user's focus stays on the chip they just pressed.
function filterScreenBodyHtml() {
  return `${renderFilterBodyHtml()}<div id="filterNearestListSection" class="filter-nearest-list-section">${overviewNearestHtml()}</div>`;
}

function refreshFilterScreenList() {
  const section = document.getElementById("filterNearestListSection");
  if (!section) return;
  const previousNearestPositions = captureNearestItemPositions();
  section.innerHTML = overviewNearestHtml();
  updateOverviewDirectionArrows();
  hydrateOverviewBusStopDirections();
  animateNearestItemReorder(previousNearestPositions);
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

// persist:false is for a URL-driven pre-filter (a /nearby/<slug> page, or a shared ?show= link)
// -- landing on one of those names what that page shows, not a preference the reader chose, so
// it must not overwrite their own saved filters (saveFilterState) for every later visit to
// /nearby. An actual chip tap, on that page or anywhere else, always persists as before.
function setOverviewFilters(nextFilters, { persist = true, render = true, railTap = false } = {}) {
  const previousFilters = state.overviewFilters;
  state.overviewFilters = sanitizeOverviewFilters(nextFilters);
  // Marks the current filters as a page's own lens rather than the reader's choice, so
  // goToInitialView (the Nearby nav button) knows to put their real filters back rather than
  // carrying a /nearby/<slug> page's single category over to the plain Nearby screen. Any real
  // change -- a chip tap, anywhere, persist:false page included -- clears it again.
  state.overviewFiltersEphemeral = !persist;
  // Before the camera work below: secondary screens may reach a newly selected filter's nearest
  // match when it lies outside the walking radius (outOfRadiusFitPoints). Nearby stays framed on
  // the radius itself, even when its list is using an out-of-radius fallback entry.
  refreshOutOfRadiusReveal(previousFilters);
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
  if (isOverviewScreenActive() && !state.filterScreenOpen) {
    selectOverview();
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
  } else if (state.filterScreenOpen) {
    // The whole point of the Filter screen showing the nearest list is that a chip tap proves
    // its own effect right there (see filterScreenBodyHtml()) -- refresh just that list, never
    // the chip panel above it, which updateFilterUi() patches in place a few lines up.
    refreshFilterScreenList();
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

  // Live "Showing N nearby" line next to Clear all -- only present while the Filter screen's
  // own body is on screen (filterScreenBodyHtml()), a no-op everywhere else since the lookup
  // simply finds nothing.
  const resultsCountEl = els.inspectorBody.querySelector("#filterResultsCount");
  if (resultsCountEl) {
    resultsCountEl.textContent = state.userLocation
      ? `Showing ${overviewItemsForActiveFilter().length} nearby`
      : "";
  }

  // Update filter toggle button
  if (els.filterToggle) {
    const activeGroupCount = getActiveGroupKeys(currentSet).length;
    const hasActiveFilter = activeGroupCount > 0;
    const locationSelected = Boolean(state.selected);
    // Filters only ever changes what Nearby shows, so its inline toggle (next to the Nearby
    // heading -- see app.html) is the way *in* from Nearby, and only shows there. On the Filter
    // screen itself it would just sit in its active state doing nothing when tapped, so it hides
    // in favour of the ordinary #inspectorBack arrow -- the way out, same as any other screen.
    // A /find/ landing's place is not selected yet, but it is not the Nearby list either, so the
    // toggle stays hidden until it is (findLandingAwaitingPlace, js/app.js).
    els.filterToggle.hidden = locationSelected || findLandingAwaitingPlace() || state.searchScreenOpen || state.filterScreenOpen;
    els.filterToggle.classList.toggle("active", hasActiveFilter);
    els.filterToggle.classList.toggle("screen-active", state.filterScreenOpen);
    els.filterToggle.setAttribute("aria-pressed", hasActiveFilter ? "true" : "false");
    els.filterToggle.setAttribute("aria-label", hasActiveFilter
      ? `Filters: ${activeGroupCount} top-level filter${activeGroupCount === 1 ? "" : "s"} selected`
      : "Filters");
    if (els.filterCount) {
      els.filterCount.hidden = !hasActiveFilter;
      els.filterCount.textContent = String(activeGroupCount);
    }
  }
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

function openFiltersScreen() {
  if (typeof trackGaScreenView === "function") trackGaScreenView("Filters");
  // Filters/Settings/Report/Search all promise the same fixed, zoomed-out survey view of the
  // walking radius (secondaryScreenActive) -- left set, an expanded cluster narrowed that to
  // the tapped group's own members instead, and its borrowed radius looked like the user's own
  // real setting on the Settings slider. Opening any of them is leaving that exact-membership
  // view just as much as tapping open ground is.
  exitClusterExpansion();
  state.selected = null;
  // showBack:true clears state.filterScreenOpen inside setInspectorSelectionChrome (the shared
  // chokepoint every other showBack:true screen relies on to stand Filters down) -- set it again
  // immediately after, now that Filters is the screen being entered rather than left.
  setInspectorSelectionChrome({ emoji: appIconHtml("filter", "app-icon title-icon"), showBack: true, preserveNavHighlight: true });
  state.filterScreenOpen = true;
  if (els.nearbyToggle) els.nearbyToggle.hidden = false;
  setNavScreenActive(els.filterToggle);
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Filters";
  els.inspectorType.textContent = "Choose what appears on the map";
  transitionInspectorBody(filterScreenBodyHtml(), "forward", () => {
    updateOverviewDirectionArrows();
    hydrateOverviewBusStopDirections();
  });
  updateFilterUi();
  setInspectorMinimized(false);
  syncHashFromSelection();
  requestDraw();
  if (state.userLocation) {
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
  }
}

function openSettings() {
  if (typeof trackGaScreenView === "function") trackGaScreenView("Settings");
  // See the matching comment in openFiltersScreen -- without this the walk-radius slider here
  // showed the tapped group's borrowed radius as if it were the user's own setting.
  exitClusterExpansion();
  state.selected = { type: "settings", item: null };
  setInspectorSelectionChrome({ emoji: appIconHtml("settings", "app-icon title-icon"), showBack: true, preserveNavHighlight: true });
  setNavScreenActive(els.settingsToggle);
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Settings";
  els.inspectorType.textContent = "App preferences";
  transitionInspectorBody(settingsFormHtml(), "forward");
  bindSettingsHandlers();
  fillTesterId();
  fillSettingsAccount();
  setInspectorMinimized(false);
  updateCompassOverlay();
  syncHashFromSelection();
  requestDraw();
  if (state.userLocation) {
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
  }
}

// window.ForestFindsCookieConsent (cookie-consent.js) is the one store of truth for the GA
// cookie banner's choice -- read through it rather than localStorage directly so Settings always
// agrees with whatever the banner itself last recorded.
function analyticsStatusLabel() {
  const choice = analyticsChoice();
  return choice === "granted" ? "on" : choice === "denied" ? "off" : "not yet decided";
}

function locationStatusLabel() {
  return hasRealLocation() ? "on" : "off";
}

// The one place a person who said not now can turn location on later, so no ask ever has to be
// repeated unprompted. A permission refused below the app is explained rather than re-requested.
function setupSettingsLocationRow() {
  const button = document.getElementById("settingsLocateButton");
  const note = document.getElementById("locationBlockedNote");
  if (!button) return;
  if (!Native.geolocation) {
    button.hidden = true;
    return;
  }
  Native.locationPermissionState().then((permission) => {
    if (permission !== "denied" || hasRealLocation() || !button.isConnected) return;
    button.hidden = true;
    if (note) {
      note.textContent = locationBlockedMessage();
      note.hidden = false;
    }
  });
  button.addEventListener("click", () => {
    rememberLocationChoice("granted");
    button.disabled = true;
    button.textContent = "Getting your location…";
    locateUser({ initial: false });
  });
}

// The native app's own update line: its data comes from the binary plus whatever the website has
// published since (Native.data), and is checked once a day without anyone asking.
function nativeDataHtml() {
  const checked = Native.data.lastChecked();
  const when = checked ? new Date(checked).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "not yet";
  return `<div class="settings-refresh">
        <h4 class="settings-section-title">Map data</h4>
        <p class="settings-description">Showing map data ${escapeHtml(String(Native.data.activeVersion || ""))}. Last checked for updates: ${escapeHtml(when)}. New data is used the next time the app starts.</p>
        <button id="nativeDataCheckButton" class="settings-btn" type="button">Check for map updates</button>
        <p id="nativeDataStatus" class="report-note" role="status" aria-live="polite" hidden></p>
      </div>`;
}

const NATIVE_DATA_STATUS_TEXT = {
  updated: "New map data downloaded. Close and reopen the app to see it.",
  current: "Map data is up to date.",
  failed: "Could not check for map updates. Try again when you have a connection.",
  unavailable: "Map updates are not available on this device.",
  skipped: "Map data is up to date.",
};

function setupNativeDataRow() {
  const button = document.getElementById("nativeDataCheckButton");
  const status = document.getElementById("nativeDataStatus");
  if (!button || !Native.data) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Checking…";
    const result = await Native.data.checkForUpdates({ force: true });
    button.disabled = false;
    button.textContent = "Check for map updates";
    if (status) {
      status.textContent = NATIVE_DATA_STATUS_TEXT[result.status] || NATIVE_DATA_STATUS_TEXT.failed;
      status.hidden = false;
    }
  });
}

// Keeps an open Settings screen's location row in step with a request that has just answered.
function syncSettingsLocationRow() {
  const status = document.getElementById("locationStatus");
  if (status) status.textContent = locationStatusLabel();
  const button = document.getElementById("settingsLocateButton");
  if (!button) return;
  button.disabled = false;
  button.textContent = "Use my location";
  button.hidden = hasRealLocation();
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
  // Reused for the datalist's <option> grid (the slider's real, browser-enforced snap points)
  // and for the decorative tick marks below the track, which only mirror that grid visually --
  // native range+datalist tick rendering is lost entirely once appearance:none re-skins the
  // track and thumb (see .walk-radius-range), so the preset stops need their own markup to be
  // seen at all.
  const reachablePresets = WALKING_RADIUS_PRESET_MINUTES.filter(
    (m) => m >= floorMinutes && m <= WALKING_RADIUS_MAX_MINUTES
  );
  const ticks = reachablePresets.map((m) => `<option value="${m}"></option>`).join("");
  const trackSpan = WALKING_RADIUS_MAX_MINUTES - floorMinutes;
  const tickMarks = reachablePresets
    .map((m) => {
      const pct = trackSpan > 0 ? ((m - floorMinutes) / trackSpan) * 100 : 0;
      return `<span class="walk-radius-tick" style="left:${pct.toFixed(2)}%"></span>`;
    })
    .join("");
  return `<div class="settings-form">
    <p class="settings-intro">A little more you. Make Forest Finds fit the way you explore.</p>
    <section class="settings-section settings-walking">
      <h3 class="settings-section-title">Walking radius</h3>
      <p class="settings-description">Set your pace. Nearby finds and the circle on your map follow this walking time.</p>
      <label for="settingsWalkMins" class="settings-label">Walking time
        <span class="walk-radius-row">
          <span class="walk-radius-track-wrap">
            <input type="range" id="settingsWalkMins" class="walk-radius-range"
              min="${floorMinutes}" max="${WALKING_RADIUS_MAX_MINUTES}" step="${stepMinutes}"
              value="${sliderValue}" list="walkRadiusTicks" aria-valuetext="${formatWalkingRadius(sliderValue)}">
            <span class="walk-radius-ticks" aria-hidden="true">${tickMarks}</span>
          </span>
          <span class="walk-radius-value" id="settingsWalkMinsValue" aria-hidden="true">${formatWalkingRadius(sliderValue)}</span>
        </span>
        <datalist id="walkRadiusTicks">${ticks}</datalist>
      </label>
      <div class="settings-presets" role="group" aria-label="Walking time presets">${reachablePresets.map((m) => `<button type="button" class="settings-btn" data-walk-minutes="${m}" aria-pressed="${sliderValue === m}">${formatWalkingRadius(m)}</button>`).join("")}</div>
      <p class="source-note walk-radius-floor-note" id="settingsWalkMinsFloorNote" aria-live="polite"${sliderValue > floorMinutes ? " hidden" : ""}>This is as close as it gets — nothing closer to show nearby.</p>
    </section>
    <section class="settings-section" id="map3dSetting"${state.motionSensorSeen ? "" : " hidden"}>
      <h3 class="settings-section-title">Map</h3>
      <label class="settings-switch"><span><strong>3D map</strong><span class="settings-description">Tilt your phone up to see the map laid out ahead of you.</span></span><input type="checkbox" id="map3dToggle"${state.map3dEnabled ? " checked" : ""}></label>
      <img class="settings-preview" src="css/img/map-3d-preview.webp" width="480" height="346" alt="The map tilted in 3D, with paths and finds stretching away towards the horizon" loading="lazy" decoding="async">
    </section>
    <section class="settings-section">
      <h3 class="settings-section-title">Reminders</h3>
      <label class="community-nudge-setting settings-switch"><span><strong>Tree check reminders</strong><span class="settings-description">A gentle nudge to check trees you’re standing next to.</span></span><input type="checkbox" id="communityNudgeToggle"${communityNudgesOn() ? " checked" : ""}></label>
    </section>
    <section class="settings-section">
      <h3 class="settings-section-title">About</h3>
      <p class="settings-description">App version: <span id="appVersionDisplay" class="app-version-display">${state.swVersion || APP_VERSION}</span></p>
      ${Native.isNative ? "" : appUpdateStatusHtml()}
      <p class="settings-description">Tester ID: <code id="testerIdDisplay" class="tester-id">…</code> <button type="button" id="testerIdCopy" class="settings-btn" hidden>Copy</button><br><span class="report-note">Give this to Simon to try early features.</span></p>
      <p class="settings-description">Vibe coded by <a href="https://simonmcmanus.com" target="_blank" rel="noopener noreferrer">Simon McManus</a></p>
      <p id="dataUpdateNote" class="report-note"${state.dataUpdateAvailable ? "" : " hidden"}>New map data has been downloaded. <button id="dataUpdateReloadButton" class="inline-text-button" type="button">Reload now</button> to see it.</p>
      ${Native.data ? nativeDataHtml() : ""}
      <div class="settings-refresh"${Native.isNative ? " hidden" : ""}>
        <h4 class="settings-section-title">Keep things fresh</h4>
        <div class="settings-refresh-row">
          <button id="refreshDataButton" class="settings-btn" type="button"${online ? "" : " disabled"}>Refresh data</button>
          <button id="refreshAppButton" class="settings-btn" type="button"${online ? "" : " disabled"}>Refresh app</button>
          <button id="refreshAllButton" class="settings-btn" type="button"${online ? "" : " disabled"}>Refresh both</button>
        </div>
        <p class="settings-description"><strong>Data</strong> updates trees, paths and places. <strong>App</strong> reloads the app itself. <strong>Both</strong> refreshes everything. Your preferences stay with you.</p>
        <p id="refreshStatus" class="report-note" role="status" aria-live="polite" hidden></p>
        <p id="refreshOfflineNote" class="report-note report-offline-note"${online ? " hidden" : ""}>Refreshing needs an internet connection — you\'re offline right now.</p>
      </div>
    </section>
    <section class="settings-section" id="settingsAccount">
      <h3 class="settings-section-title">Account</h3>
      <div id="settingsAccountBody">${settingsAccountHtml(typeof communityReadAccount === "function" ? communityReadAccount() : null)}</div>
    </section>
    <section class="settings-section">
      <h3 class="settings-section-title">Privacy</h3>
      <p class="settings-description">Location: <strong id="locationStatus">${locationStatusLabel()}</strong>. Used on this device to centre the map on you and measure distances.</p>
      <p id="locationBlockedNote" class="report-note" hidden></p>
      <button id="settingsLocateButton" class="settings-btn" type="button"${hasRealLocation() ? " hidden" : ""}>Use my location</button>
      <p class="settings-description">Usage analytics: <strong id="analyticsStatus">${analyticsStatusLabel()}</strong>. Anonymous usage data, including your position while the app is open, and Google Analytics cookies. <a href="/terms.html" target="_blank" rel="noopener">Privacy Policy</a></p>
      ${trackerExistingUserId() ? `<p class="settings-description">Your anonymous ID, for a data access or deletion request: <code id="analyticsIdDisplay">${escapeHtml(trackerExistingUserId())}</code></p>` : ""}
      <button id="analyticsToggle" class="settings-btn" type="button">${analyticsChoice() === "granted" ? "Turn off usage analytics" : "Turn on usage analytics"}</button>
    </section>
  </div>`;
}

// The Settings sign-in control. Drawn at once from the last known account (so the screen never flashes an
// empty section), then corrected once /api/auth/me has answered. A sign-in is a full page load through the
// provider and comes back to Settings.
function settingsAccountHtml(account, note = "") {
  const noteHtml = note ? `<p class="report-note" role="status">${escapeHtml(note)}</p>` : "";
  // Sign-in is a cookie session set by a redirect through the provider back to this site, which a
  // page served from the app bundle can never come back from (spec-native.md "Not in the first release").
  if (Native.isNative) {
    return `<p class="settings-description">Signing in is not available in the app yet. Your Community points are kept on this device.</p>${noteHtml}`;
  }
  if (account && account.signedIn) {
    return `<p class="settings-description">Signed in as <strong>${escapeHtml(account.name)}</strong>. Your points follow you to any device you sign in on.</p>
      <a id="settingsSignOut" class="settings-btn settings-btn-link" href="/api/auth/logout?return=/settings">Sign out</a>
      <p class="settings-description">Used a different login on another device? Sign in with it here to bring its points and devices into this account.</p>
      <a id="settingsMerge" class="settings-btn settings-btn-link" href="/api/auth/login?return=/settings&amp;merge=1">Merge another sign-in</a>${noteHtml}`;
  }
  return `<p class="settings-description">Sign in to keep your Community points on any device. You can still use the app without signing in.</p>
    <a id="settingsSignIn" class="settings-btn settings-btn-link" href="/api/auth/login?return=/settings">Sign in</a>${noteHtml}`;
}

const SETTINGS_MERGE_MESSAGES = {
  merged: "Done: the other sign-in's points and devices are now in this account.",
  same: "That sign-in is already part of this account, so there was nothing to merge.",
  failed: "Couldn't merge those sign-ins. Make sure you are still signed in here, then try again.",
};

// The outcome of a merge arrives in a short-lived cookie set by the sign-in callback. It is read and cleared
// once, then kept in memory for this page load: Settings can be drawn more than once while the app starts,
// and every draw must show it. A reload no longer has it.
let settingsMergeOutcome = "";
function takeMergeOutcome() {
  try {
    const match = /(?:^|;\s*)ff_merge_result=([a-z]+)/.exec(document.cookie || "");
    if (match) {
      document.cookie = "ff_merge_result=; Path=/; Max-Age=0";
      if (SETTINGS_MERGE_MESSAGES[match[1]]) settingsMergeOutcome = match[1];
    }
  } catch {}
  return settingsMergeOutcome;
}

async function fillSettingsAccount() {
  if (!document.getElementById("settingsAccountBody") || typeof communityRefreshAccount !== "function") return;
  const merge = takeMergeOutcome();
  let result = "failed";
  try { result = await communityRefreshAccount(); } catch {}
  const body = document.getElementById("settingsAccountBody");
  if (!body) return; // the screen was left while we waited
  const account = communityReadAccount();
  let note = result === "failed" && account && account.signedIn ? "Couldn't check who is signed in just now." : "";
  if (merge) note = SETTINGS_MERGE_MESSAGES[merge];
  body.innerHTML = settingsAccountHtml(account, note);
  // Merged devices change the points: bring this device's score and log up to date.
  if (merge === "merged") { try { await Promise.all([communityRefreshScore(true), communityRefreshLog()]); } catch {} }
}

async function fillTesterId() {
  const display = document.getElementById("testerIdDisplay");
  if (!display) return;
  let id = "";
  try { id = await communityTesterId(communityPrimaryDeviceId()); } catch {}
  if (!id) { display.textContent = "unavailable"; return; }
  display.textContent = id;
  const copy = document.getElementById("testerIdCopy");
  if (!copy) return;
  copy.hidden = false;
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(id); copy.textContent = "Copied"; } catch { copy.textContent = "Select and copy it"; }
  });
}

function bindSettingsHandlers() {
  refreshSettingsVersionDisplay();
  const map3dToggle = document.getElementById("map3dToggle");
  if (map3dToggle) map3dToggle.addEventListener("change", () => setMap3dEnabled(map3dToggle.checked));
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
      const label = formatWalkingRadius(value);
      if (valueLabel) valueLabel.textContent = label;
      range.setAttribute("aria-valuetext", label);
      document.querySelectorAll("[data-walk-minutes]").forEach((button) => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.walkMinutes) === value));
      });
      if (floorNote) floorNote.hidden = value > floorMinutes;
      applyWalkingRadiusChange(value, { animate: false });
    });
    range.addEventListener("change", () => {
      refreshNearbyRadiusView();
    });
    document.querySelectorAll("[data-walk-minutes]").forEach((button) => {
      button.addEventListener("click", () => {
        range.value = button.dataset.walkMinutes;
        range.dispatchEvent(new Event("input", { bubbles: true }));
        range.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }

  for (const scope of Object.keys(REFRESH_SCOPES)) {
    const button = document.getElementById(REFRESH_SCOPES[scope].buttonId);
    if (button) button.addEventListener("click", () => refreshCachedState(scope));
  }

  const dataReloadButton = document.getElementById("dataUpdateReloadButton");
  if (dataReloadButton) dataReloadButton.addEventListener("click", () => location.reload());

  const analyticsToggle = document.getElementById("analyticsToggle");
  if (analyticsToggle) {
    analyticsToggle.addEventListener("click", () => {
      const granting = analyticsChoice() !== "granted";
      setAnalyticsConsent(granting);
      analyticsToggle.textContent = granting ? "Turn off usage analytics" : "Turn on usage analytics";
      const status = document.getElementById("analyticsStatus");
      if (status) status.textContent = analyticsStatusLabel();
    });
  }
  setupSettingsLocationRow();
  setupNativeDataRow();
  // Settings HTML is rebuilt fresh every time the screen opens (see openSettings above),
  // so remove before re-adding — otherwise every open leaks another window-level listener.
  window.removeEventListener("online", updateRefreshButtonsOnlineState);
  window.removeEventListener("offline", updateRefreshButtonsOnlineState);
  window.addEventListener("online", updateRefreshButtonsOnlineState);
  window.addEventListener("offline", updateRefreshButtonsOnlineState);
  updateRefreshButtonsOnlineState();
}

// The Community tab's own screen: what community checks are, your contributions, add a missing
// tree, and a link on to the feedback form (openReportModal, a page of its own).
function communityScreenOpen() {
  return Boolean(state.selected && state.selected.type === "community");
}

// Community is gated (see communityEnabled): people without it get the Feedback page in its place, and the
// nav tab becomes the Feedback tab.
function openCommunityOrFeedback() {
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
  if (state.userLocation) {
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
  }
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

function openReportModal() {
  if (typeof trackGaScreenView === "function") trackGaScreenView("Report");
  // See the matching comment in openFiltersScreen.
  exitClusterExpansion();
  state.selected = { type: "report", item: null };
  setInspectorSelectionChrome({ emoji: appIconHtml("feedback", "app-icon title-icon"), showBack: true, preserveNavHighlight: true });
  setNavScreenActive(els.reportToggle);
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Feedback";
  els.inspectorType.textContent = "Tell us what is wrong or missing";
  transitionInspectorBody(reportFormHtml(), "forward", () => {
    const detailsInput = document.getElementById("reportDetails");
    if (detailsInput) {
      // Keep the new Feedback screen at its top. Keyboard avoidance will scroll the
      // field into view later if the viewport actually shrinks on a phone.
      detailsInput.focus({ preventScroll: true });
    }
  });
  bindReportFormHandlers();
  setReportStatus("");
  updateReportLocationLabel();
  setInspectorMinimized(false);
  updateCompassOverlay();
  syncHashFromSelection();
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
  return `<div class="report-screen">
    <div class="report-type-field">
      <label for="reportType">What would you like to tell us?
        <select id="reportType" class="report-textarea community-input">
          <option value="feedback">Feedback, a bug or something strange</option>
          <option value="tree">A tree that's missing from the map</option>
          <option value="place">A place that's missing from the map</option>
        </select>
      </label>
    </div>
    <form id="reportForm" class="report-form">
      <p class="report-intro">We welcome feedback, bug reports, and anything strange you have noticed. It helps us improve the data for everyone.</p>
      <label for="reportDetails">What did you notice?
        <textarea id="reportDetails" class="report-textarea" placeholder="Describe what's missing or what you'd like to see…" required>${escapeHtml(detailsValue)}</textarea>
      </label>
      ${reportPhotoFieldHtml("reportPhoto")}
      ${communityPublicNoticeHtml()}
      <p id="reportStatus" class="report-status" aria-live="polite"></p>
      <p id="reportOutboxNote" class="report-note" aria-live="polite" hidden></p>
      <p id="reportOfflineNote" class="report-note report-offline-note"${online ? " hidden" : ""}>You're offline. Your report will be saved and sent automatically when you're back online.</p>
      <div class="report-form-actions">
        <button id="reportCancel" class="button button-ghost" type="button">Cancel</button>
        <button id="reportSubmit" class="button" type="submit">Submit</button>
      </div>
    </form>
    ${communityAddFormHostHtml()}
    </div>`;
}

// `capture="environment"` asks a phone for its rear camera, where supported. Browsers which
// do not expose a camera still present their normal image picker, so reporting stays simple on
// desktop and for users who already have a useful picture.
function reportPhotoFieldHtml(inputId) {
  return `<div class="report-photo-field">
      <label for="${inputId}">Photo (optional)
        <input id="${inputId}" class="report-photo-input" type="file" accept="image/*" capture="environment">
      </label>
      <p class="report-note report-photo-note">Take a photo of the tree tag, or choose an existing picture.</p>
      <p class="report-photo-status" aria-live="polite"></p>
    </div>`;
}

function bindReportFormHandlers() {
  populateReportLocation();

  const cancelButton = document.getElementById("reportCancel");
  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      goToInitialView();
    });
  }

  const typeSelect = document.getElementById("reportType");
  if (typeSelect) typeSelect.addEventListener("change", () => communitySetReportType(typeSelect.value));

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
  bindReportPhotoInput(document.getElementById("reportPhoto"));
  // A browser's own scroll-into-view-on-focus is free to pick an odd ancestor/offset in the
  // cramped landscape keyboard-avoiding layout; re-assert our own nearest-both-axes scroll
  // whenever the field is (re)focused, however that focus happened, so it's deterministic.
  if (detailsInput) detailsInput.addEventListener("focus", () => {
    detailsInput.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  // Show or hide the offline note when connectivity changes (submitting stays possible: it queues)
  function updateOnlineState() {
    const offlineNote = document.getElementById("reportOfflineNote");
    if (!offlineNote) return; // form has been removed from DOM
    const online = navigator.onLine;
    if (offlineNote) offlineNote.hidden = online;
  }
  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);

  // "N waiting to send" for anything parked in the outbox (js/outbox.js).
  function showOutboxPending(pending) {
    const note = document.getElementById("reportOutboxNote");
    if (!note) return;
    note.hidden = !pending;
    note.textContent = pending ? `${pending} report${pending === 1 ? "" : "s"} waiting to send` : "";
  }
  window.addEventListener("outbox:change", (event) => showOutboxPending(event.detail.pending));
  outboxList().then((items) => showOutboxPending(items.length));
}

function bindReportPhotoInput(input) {
  if (!input) return;
  const status = input.closest(".report-photo-field")?.querySelector(".report-photo-status");
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!status) return;
    status.textContent = file ? `Photo ready: ${file.name}` : "";
  });
}

const REPORT_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read photo"));
    reader.readAsDataURL(file);
  });
}

// Modern phone photos are much larger than an issue report needs. Scale them down before
// posting so a tree-tag picture works on ordinary mobile connections and within function limits.
async function prepareReportPhoto(file) {
  if (!file) return null;
  if (!String(file.type || "").startsWith("image/")) throw new Error("Please choose an image file.");
  try {
    const image = await createImageBitmap(file);
    const longestSide = Math.max(image.width, image.height);
    const scale = Math.min(1, 1600 / longestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    image.close();
    if (blob && blob.size <= REPORT_PHOTO_MAX_BYTES) {
      return { contentType: "image/jpeg", dataUrl: await readFileAsDataUrl(blob) };
    }
  } catch {
    // Some phones expose HEIC files that this browser cannot draw. A modest original still
    // works, and a larger one gets a clear message instead of silently dropping the evidence.
  }
  if (file.size > REPORT_PHOTO_MAX_BYTES) throw new Error("That photo is too large. Please choose a smaller image.");
  return { contentType: file.type, dataUrl: await readFileAsDataUrl(file) };
}

function setReportStatus(message, tone = "", issueUrl = null) {
  const statusEl = document.getElementById("reportStatus");
  if (!statusEl) return;
  applyReportStatusContent(statusEl, message, tone, issueUrl);
}

// Shared by the full Report screen (setReportStatus) and the inline per-location form
// (submitLocationIssueReport): builds the status line via DOM APIs rather than a template
// string, so the filed GitHub issue's URL renders as a real clickable link instead of dead
// text the user has to select and copy, while everything else in the message stays plain
// text -- .textContent/.createElement escape it automatically, no innerHTML involved.
function applyReportStatusContent(statusEl, message, tone, issueUrl) {
  statusEl.textContent = message || "";
  statusEl.classList.remove("error", "success");
  if (tone) statusEl.classList.add(tone);
  if (issueUrl && /^https:\/\//.test(issueUrl)) {
    statusEl.append(" ");
    const link = document.createElement("a");
    link.href = issueUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "View issue";
    statusEl.append(link);
  }
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
  // hasRealLocation(), not state.userLocation's bare truthiness: a report drafted while only
  // DEFAULT_LOCATION's High Beach stand-in is active should still try for the real fix the
  // report is actually about, rather than silently settling for an anchor the reader was never
  // actually standing at.
  if (hasRealLocation()) return;
  if (!Native.geolocation) return;
  // Only when it answers silently: opening the feedback form must never be what puts a location
  // prompt on screen. A report without a position is still a report.
  if (await Native.locationPermissionState() !== "granted") return;
  await new Promise((resolve) => {
    Native.geolocation.getCurrentPosition((position) => {
      state.reportDraftLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      resolve();
    }, resolve, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

function generateRequestId() {
  return (window.crypto && window.crypto.randomUUID)
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateReportRequestId() {
  try {
    const existing = localStorage.getItem(REPORT_REQUEST_ID_KEY);
    if (existing) return existing;
  } catch {}
  const id = generateRequestId();
  try { localStorage.setItem(REPORT_REQUEST_ID_KEY, id); } catch {}
  return id;
}

// Sends a feedback/report payload; if the device is offline or the request cannot reach the
// server, it is parked in the outbox (js/outbox.js) and re-sent automatically, so the user is
// never asked to come back later. Resolves {queued:true} or {response, data}.
async function sendOrQueueReport(payload) {
  const url = "/.netlify/functions/report-missing-data";
  if (typeof communityDeviceId === "function") {
    payload.deviceId = communityDeviceId();
    if (typeof communityNoteFeedback === "function") communityNoteFeedback(payload);
  }
  const queue = async () => {
    await outboxAdd({ id: payload.requestId, url, payload });
    return { queued: true };
  };
  if (!navigator.onLine) return queue();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { response, data: await response.json().catch(() => ({})) };
  } catch {
    return queue();
  }
}

const REPORT_QUEUED_MESSAGE = "Saved. It will be sent automatically when you're back online.";
// This browser could not keep the report on disk (private window, storage blocked), so it only survives
// while the app stays open.
const REPORT_QUEUED_VOLATILE_MESSAGE = "Not sent yet. This browser can't save it, so keep the app open and it will send when you're back online.";
function reportQueuedMessage() {
  return typeof outboxIsDurable === "function" && !outboxIsDurable() ? REPORT_QUEUED_VOLATILE_MESSAGE : REPORT_QUEUED_MESSAGE;
}

async function submitReportForm() {
  // Guard against duplicate GitHub issues from double-taps or a submit
  // firing again while the previous request is still in flight.
  if (state.reportSubmitting) return;

  const reportDetailsInput = document.getElementById("reportDetails");
  if (!reportDetailsInput) return;

  const details = String(reportDetailsInput.value || "").trim();
  if (!details) {
    setReportStatus("Please add details before submitting.", "error");
    return;
  }

  // Claim the submission before awaiting photo processing: even an empty-photo async
  // preparation yields once, which otherwise lets two rapid submit events both proceed.
  state.reportSubmitting = true;
  let photo;
  try {
    photo = await prepareReportPhoto(document.getElementById("reportPhoto")?.files?.[0]);
  } catch (error) {
    state.reportSubmitting = false;
    setReportStatus(error.message || "Could not prepare that photo.", "error");
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
    photo,
  };

  const submitButton = document.getElementById("reportSubmit");
  if (submitButton) submitButton.disabled = true;
  setReportStatus("Submitting report…");

  try {
    const { queued, response, data } = await sendOrQueueReport(payload);
    if (!queued && !response.ok) {
      const errorText = data && data.error ? data.error : `Request failed (${response.status})`;
      setReportStatus(errorText, "error");
      return;
    }

    if (queued) setReportStatus(reportQueuedMessage(), "success");
    else setReportStatus("Report submitted successfully.", "success", data && data.issueUrl);
    reportDetailsInput.value = "";
    const photoInput = document.getElementById("reportPhoto");
    if (photoInput) {
      photoInput.value = "";
      const photoStatus = photoInput.closest(".report-photo-field")?.querySelector(".report-photo-status");
      if (photoStatus) photoStatus.textContent = "";
    }
    try {
      localStorage.removeItem(REPORT_DRAFT_KEY);
      localStorage.removeItem(REPORT_REQUEST_ID_KEY);
    } catch {}
  } catch (error) {
    setReportStatus("Could not submit report. Please try again.", "error");
  } finally {
    state.reportSubmitting = false;
    if (submitButton) submitButton.disabled = false;
  }
}

// The inline "Noticed a problem with this location?" form on a tree/landmark detail screen
// (reportIssueHtml, js/inspector.js). Expands in place rather than navigating to the full
// Report screen, and posts the flagged item's own coordinates (carried on the wrapper's
// dataset) instead of the reporter's GPS fix, plus a locationContext identifying which item
// it was. There is no persisted draft here -- unlike the full Report screen's form, this one
// is opened, filled and submitted (or abandoned) in one sitting, so a fresh request ID per
// open is enough for double-tap/retry safety without localStorage.
function locationIssueFormHtml() {
  const online = navigator.onLine;
  // Wrapped in .report-form (display:grid; gap:10px, same as the full Report screen's own
  // form) rather than left as bare stacked elements -- without that gap the textarea's
  // focus-visible outline (base.css, 3px solid + 2px offset) had nothing to clear and bled
  // up over the question text sitting flush above it.
  return `<div class="report-form">
      <p class="report-issue-question">What's wrong with this location?</p>
      <textarea class="report-textarea" placeholder="Describe the problem…"></textarea>
      ${reportPhotoFieldHtml("locationIssuePhoto")}
      <p class="report-status" aria-live="polite"></p>
      <p class="report-note report-offline-note"${online ? " hidden" : ""}>You're offline. Your report will be saved and sent automatically when you're back online.</p>
      <div class="report-form-actions">
        <button class="button button-ghost" type="button" data-action="cancel-location-issue">Cancel</button>
        <button class="button" type="button" data-action="submit-location-issue">Submit</button>
      </div>
    </div>`;
}

function toggleLocationIssueForm(toggleButton) {
  const wrapper = toggleButton.closest(".report-issue");
  if (!wrapper) return;
  wrapper.innerHTML = locationIssueFormHtml();
  const textarea = wrapper.querySelector(".report-textarea");
  bindReportPhotoInput(wrapper.querySelector(".report-photo-input"));
  if (textarea) {
    textarea.focus();
    textarea.scrollIntoView({ block: "nearest" });
  }
}

function cancelLocationIssueForm(wrapper) {
  if (!wrapper) return;
  wrapper.innerHTML = `<button class="report-issue-toggle" type="button" data-action="report-issue">Noticed a problem with this location?</button>`;
}

async function submitLocationIssueReport(wrapper) {
  if (!wrapper || wrapper.dataset.submitting === "true") return;

  const textarea = wrapper.querySelector(".report-textarea");
  const statusEl = wrapper.querySelector(".report-status");
  const submitButton = wrapper.querySelector("[data-action='submit-location-issue']");
  if (!textarea || !statusEl) return;

  const details = String(textarea.value || "").trim();
  if (!details) {
    statusEl.textContent = "Please describe the problem before submitting.";
    statusEl.className = "report-status error";
    return;
  }

  wrapper.dataset.submitting = "true";
  let photo;
  try {
    photo = await prepareReportPhoto(wrapper.querySelector(".report-photo-input")?.files?.[0]);
  } catch (error) {
    wrapper.dataset.submitting = "false";
    statusEl.textContent = error.message || "Could not prepare that photo.";
    statusEl.className = "report-status error";
    return;
  }

  if (!wrapper.dataset.requestId) wrapper.dataset.requestId = generateRequestId();

  const payload = {
    reportType: "location-issue",
    details,
    location: {
      latitude: Number(Number(wrapper.dataset.reportLat).toFixed(6)),
      longitude: Number(Number(wrapper.dataset.reportLon).toFixed(6)),
    },
    locationContext: {
      type: wrapper.dataset.reportType || "",
      name: wrapper.dataset.reportName || "",
    },
    appVersion: state.swVersion || APP_VERSION,
    userAgent: navigator.userAgent,
    pageUrl: window.location.href,
    requestId: wrapper.dataset.requestId,
    photo,
  };

  if (submitButton) submitButton.disabled = true;
  statusEl.textContent = "Submitting report…";
  statusEl.className = "report-status";

  try {
    const { queued, response, data } = await sendOrQueueReport(payload);
    if (!queued && !response.ok) {
      const errorText = data && data.error ? data.error : `Request failed (${response.status})`;
      statusEl.textContent = errorText;
      statusEl.className = "report-status error";
      return;
    }

    if (queued) applyReportStatusContent(statusEl, reportQueuedMessage(), "success");
    else applyReportStatusContent(statusEl, "Report submitted successfully.", "success", data && data.issueUrl);
    textarea.value = "";
    const photoInput = wrapper.querySelector(".report-photo-input");
    if (photoInput) photoInput.value = "";
    // The form stays open, so the next report in it is a new one: it needs its own id (the same id
    // would be answered as a duplicate of this one, or replace it in the outbox).
    delete wrapper.dataset.requestId;
  } catch (error) {
    statusEl.textContent = "Could not submit report. Please try again.";
    statusEl.className = "report-status error";
  } finally {
    wrapper.dataset.submitting = "false";
    if (submitButton) submitButton.disabled = false;
  }
}

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
  if (group.itemType === "_mega" && group.itemsByType) {
    for (const [itemType, items] of Object.entries(group.itemsByType)) {
      for (const item of items) pushEntry(itemType, item);
    }
  } else {
    for (const item of (group.items || [])) pushEntry(group.itemType, item);
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

function overviewHeadingText() {
  if (!state.userLocation) return "";
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
  const aroundOrigin = state.userLocation.isDefault ? "around High Beach" : "around you";
  // Folds in the same "measuring from High Beach, not you" fact the list itself used to carry as
  // its own separate <p class="source-note"> paragraph (overviewNearestHtml below) -- said once,
  // here, in the one line every Nearby screen already shows, rather than twice.
  const radiusOrigin = state.userLocation.isDefault ? " of High Beach" : "";
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
            : (item.name || item.ref || item.commonName || "Map location");
      title = `${name} near Epping Forest`;
    }
  } else if (state.filterScreenOpen) {
    title = "Filters for Epping Forest";
  } else if (state.searchScreenOpen) {
    title = "Search Epping Forest Finds";
  } else {
    const landingLabel = landingPageCategoryLabel();
    title = landingLabel ? `Nearby ${landingLabel} in Epping Forest` : "Nearby in Epping Forest";
  }

  const nextTitle = `${title} | ${DOCUMENT_TITLE_SITE_NAME}`;
  if (typeof document !== "undefined" && document.title !== nextTitle) document.title = nextTitle;
  return nextTitle;
}

// True when the active filter set should be shown in full even without a location fix: either
// exactly one filter -- a subfilter's own /nearby/<slug> page, or a reader's own deliberate single
// choice, both reading better as "show me everything in this one category" than a generic
// "enable location" prompt -- or more than one filter, but only when a /nearby/<slug> group
// page's own pre-filter set them (state.overviewFiltersEphemeral). Never the reader's own
// multi-filter choice, and never the 1-3 filter default state nobody chose at all
// (DEFAULT_FILTERS) -- either of those taking this path would try to fit or list the entire
// matching dataset (25,000+ trees, in the default case).
function activeFiltersShowFullListWithoutLocation() {
  const count = state.overviewFilters.length;
  return count === 1 || (count > 1 && state.overviewFiltersEphemeral);
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
          <span class="nearest-arrow" data-item-lat="${entry.item.latitude ?? ""}" data-item-lon="${entry.item.longitude ?? ""}" aria-hidden="true">↑</span>
        </div>
      </div>
    </button></li>`;
  }).join("");
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

function filterRailHtml() {
  const allOn = railSelection().length === 0;
  const allStatus = `<span class="rail-check" aria-hidden="true">${allOn ? "✓" : ""}</span>`;
  const allPill = `<button class="rail-pill rail-pill--all${allOn ? " is-on" : ""}" type="button" data-rail-key="all-nearby" aria-pressed="${allOn}">${appIconHtml("nearby")}<span>Everything</span>${allStatus}</button>`;
  const pills = railItems().map((item) => {
    const on = railItemIsActive(item);
    const status = `<span class="rail-check" aria-hidden="true">${on ? "✓" : ""}</span>`;
    return `<button class="rail-pill${on ? " is-on" : ""}" type="button" data-rail-key="${item.key}" aria-pressed="${on}">${appIconHtml(item.icon)}<span>${escapeHtml(item.label)}</span>${status}</button>`;
  }).join("");
  return `<nav class="filter-rail" aria-label="Filter nearby places">` +
    `<div class="rail-pills">${allPill}${pills}</div>` +
    `</nav>`;
}

// Where the address bar points for the current rail selection: one category is its own landing
// path, several are /nearby?show=a,b, none is the show-everything override. Replaces the current
// history entry (a tap is a refinement, not a new place to go back to).
function syncRailUrl() {
  if (routeApplyDepth > 0 || routerBooting) return;
  const chosen = railSelection();
  const matchingGroup = FILTER_GROUPS.find((group) =>
    chosen.length === group.subfilters.length && group.subfilters.every((subfilter) => chosen.includes(subfilter.key))
  );
  const displayedGroup = nearbyRailGroup();
  const pathname = !displayedGroup && matchingGroup
    ? NEARBY_PATH
    : matchingGroup
    ? `/nearby/${matchingGroup.key.replace(/_/g, "-")}`
    : chosen.length === 1 ? `/nearby/${chosen[0].replace(/_/g, "-")}` : NEARBY_PATH;
  const search = searchStringForPath(pathname);
  const url = `${pathname}${search}${window.location.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return;
  history.replaceState(history.state, "", url);
}

function toggleRailFilter(key) {
  if (key === "all-nearby") {
    if (typeof navigator.vibrate === "function") navigator.vibrate(8);
    const displayedGroup = nearbyRailGroup();
    state.nearbyRailGroupKey = displayedGroup ? displayedGroup.key : null;
    setOverviewFilters(Array.from(ALL_OVERVIEW_FILTER_KEYS), { persist: false, railTap: true });
    return;
  }
  const displayedGroup = nearbyRailGroup();
  const item = railItems().find((candidate) => candidate.key === key);
  if (!item) return;
  state.nearbyRailGroupKey = displayedGroup ? displayedGroup.key : null;
  const current = new Set(state.overviewFilters.filter((filterKey) => FILTER_SUBFILTERS_BY_KEY.has(filterKey)));
  const showingAll = state.overviewFilters.length === 0 || railSelection().length === 0;
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
  if (typeof navigator.vibrate === "function") navigator.vibrate(8);
  // Do not expand an empty selection back to every key here. That made the last pill look
  // selected again immediately after it was tapped off, so Nature (and any other final pill)
  // could never visibly unselect. The Everything pill represents this empty, explicit state.
  setOverviewFilters(next, { persist: false, railTap: true });
}

function overviewCategoryContentHtml(content) {
  const categoryLabel = landingPageCategoryLabel();
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


  const itemsHtml = renderNearestItemsHtml(entries);

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

async function startCompassNavigation({ fromGesture = Boolean(navigator.userActivation?.isActive) } = {}) {
  // A default location is only a map-centering stand-in. Do not ask for compass access, or
  // show its blocking permission gate, until the visitor has shared a real position. The
  // no-location view already explains this in its source note and remains fully browseable.
  if (!hasRealLocation()) {
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

const COMPASS_PROMPT_DISMISSED_KEY = "forest-finds-compass-prompt-dismissed-v1";
// iOS forgets a motion grant on its own schedule, so a stored "granted" is read as unknown each
// launch (STORED_COMPASS_PERMISSION). Often it has not actually been forgotten: orientation events
// simply start arriving. This is how long they get to do that before the "Enable compass" card is
// shown, so someone whose grant still holds is not asked for it again.
const COMPASS_GRANT_PROBE_MS = 1200;

function compassPromptDismissed() {
  try { return localStorage.getItem(COMPASS_PROMPT_DISMISSED_KEY) === "1"; } catch { return false; }
}

// Dismissing the card is an answer: it is not shown unprompted again. The compass is still asked
// for in context, from the tap that starts navigation to a find (startCompassNavigation).
function dismissCompassPermissionPrompt() {
  try { localStorage.setItem(COMPASS_PROMPT_DISMISSED_KEY, "1"); } catch {}
  hideCompassPermissionPrompt();
}

function maybeShowCompassPermissionPrompt() {
  if (!hasRealLocation()) return;
  if (!compassPermissionCanBeRequested()) return;
  if (state.compassPermission !== "unknown") return;
  if (compassPromptDismissed() || state.compassPromptProbePending) return;
  state.compassPromptProbePending = true;
  setTimeout(() => {
    state.compassPromptProbePending = false;
    // Re-checked here, not only on entry: the High Beach stand-in runs through the same fix
    // pipeline (applyDefaultLocation) and is only flagged as a stand-in once that returns. Without
    // this, a visitor with no location yet got the compass card stacked on the location ask.
    if (!hasRealLocation()) return;
    if (state.compassPermission !== "unknown") return;
    // A heading, not just an event: Chromium fires one empty orientation event on attach.
    if (Number.isFinite(compassEventAgeMs())) {
      state.compassPermission = "granted";
      try { localStorage.setItem(COMPASS_PERMISSION_KEY, "granted"); } catch {}
      return;
    }
    showCompassPermissionPrompt();
  }, COMPASS_GRANT_PROBE_MS);
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
      hideCompassPermissionPrompt();
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
  const trueHeading = Number(reading.trueHeading);
  const heading = trueHeading >= 0 ? trueHeading : Number(reading.magneticHeading);
  if (!Number.isFinite(heading) || heading < 0) return;
  if (state.compassHeadingSource < HEADING_SOURCE_NATIVE) {
    state.compassHeadingSource = HEADING_SOURCE_NATIVE;
    discardCompassHeadingFromWorseSource();
  }
  const accuracy = Number(reading.accuracy);
  applyCompassReading(heading % 360, { trusted: accuracy >= 0 && accuracy <= NATIVE_HEADING_TRUSTED_ACCURACY_DEG });
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
// same real-movement-vs-GPS-noise threshold ingestLocationFix uses to decide a fix is a
// genuine relocation rather than wander (LOCATION_SMOOTHING_SNAP_METRES). No baseline or
// no current fix -- e.g. location was never granted -- is treated as "can't tell", which
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
    if (!state.motionSensorSeen) markMotionSensorSeen();
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
  hideCompassPermissionPrompt();
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
  if (state.compassPermissionPromptVisible) return;
  if (state.compassCalibrationPromptDismissed) return;
  if (state.compassCalibrationPromptVisible) return;
  if (!els.compassCalibrationBanner) return;
  state.compassCalibrationPromptVisible = true;
  if (els.compassCalibrationBannerText) {
    els.compassCalibrationBannerText.hidden = false;
    els.compassCalibrationBannerText.textContent = "Move your phone in a figure-8 to help it find your direction";
  }
  if (els.compassCalibrationBannerEnable) els.compassCalibrationBannerEnable.hidden = true;
  els.compassCalibrationBanner.classList.remove("fading-out");
  els.compassCalibrationBanner.hidden = false;
}

function showCompassPermissionPrompt() {
  if (state.compassPermissionPromptVisible) return;
  if (!els.compassCalibrationBanner) return;
  state.compassPermissionPromptVisible = true;
  state.compassCalibrationPromptVisible = false;
  if (els.compassCalibrationBannerText) {
    // Not blocked: the "Enable compass" button speaks for itself, so no explanatory line.
    const blocked = state.compassPermission === "denied";
    els.compassCalibrationBannerText.hidden = !blocked;
    els.compassCalibrationBannerText.textContent = blocked
      ? "Compass access is blocked. Enable Motion & Orientation access in your browser settings to use map movement."
      : "";
  }
  if (els.compassCalibrationBannerEnable) {
    els.compassCalibrationBannerEnable.textContent = "Enable compass";
    els.compassCalibrationBannerEnable.hidden = false;
  }
  els.compassCalibrationBanner.classList.remove("fading-out");
  els.compassCalibrationBanner.hidden = false;
}

async function enableCompassFromGesture() {
  await requestCompassPermissionIfNeeded({ fromGesture: true });
  if (state.compassPermission === "granted") {
    hideCompassPermissionPrompt();
    reattachCompassListeners();
    setStatus("");
    requestDraw();
  } else if (state.compassPermissionPromptVisible && els.compassCalibrationBannerText) {
    els.compassCalibrationBannerText.hidden = false;
    els.compassCalibrationBannerText.textContent = "Compass access is still blocked. Enable Motion & Orientation access in your browser settings, then try again.";
  }
}

function hideCompassCalibrationPrompt() {
  if (state.compassPermissionPromptVisible) return;
  state.compassCalibrationPromptVisible = false;
  if (!els.compassCalibrationBanner) return;
  if (els.compassCalibrationBannerEnable) els.compassCalibrationBannerEnable.hidden = true;
  hideWithFade(els.compassCalibrationBanner);
}

function hideCompassPermissionPrompt() {
  state.compassPermissionPromptVisible = false;
  if (!els.compassCalibrationBanner) return;
  if (els.compassCalibrationBannerEnable) els.compassCalibrationBannerEnable.hidden = true;
  hideWithFade(els.compassCalibrationBanner);
}

// --- Nearby-event alert ---
// In-app only (no OS push): a banner, not a modal, so it never interrupts whatever screen is
// open. Checked on every GPS fix (ensureLocationWatch) rather than against a timer, so it fires
// the moment a walk actually brings someone into range of something happening right now.

function eventAlertEnabled() {
  // Matches the "no filters selected shows everything" rule the rest of the Nearby screen
  // follows -- an event alert should not fire for a category the user explicitly turned off.
  return state.overviewFilters.length === 0 || isSubfilterActive("events");
}

function checkEventProximityAlert(latitude, longitude, nowMs = Date.now()) {
  if (!els.eventNearbyBanner || !eventAlertEnabled()) return;
  if (!Array.isArray(state.landmarks) || !state.landmarks.length) return;
  const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
  let nearest = null;
  let nearestMetres = Infinity;
  for (const place of state.landmarks) {
    if (!isEventCategory(place) || !isEventLive(place, nowMs)) continue;
    if (state.eventNearbyAlertedIds.has(place.id)) continue;
    const metres = distanceMetres(latitude, longitude, place.latitude, place.longitude);
    if (metres <= radiusMetres && metres < nearestMetres) {
      nearest = place;
      nearestMetres = metres;
    }
  }
  if (nearest) showEventNearbyBanner(nearest, nearestMetres);
}

function showEventNearbyBanner(event, metres) {
  if (!els.eventNearbyBanner) return;
  // Marked alerted immediately, not on dismiss -- lingering in range (or the next fix landing
  // before the user has reacted) must never re-show the same event a second time this session.
  state.eventNearbyAlertedIds.add(event.id);
  state.eventNearbyBannerEventId = event.id;
  if (els.eventNearbyBannerText) {
    const minutes = Math.max(1, Math.round(metres / walkingDistanceToMetres(1)));
    els.eventNearbyBannerText.textContent = `${event.name} is on now — ${minutes} min walk`;
  }
  els.eventNearbyBanner.classList.remove("fading-out");
  els.eventNearbyBanner.hidden = false;
}

function hideEventNearbyBanner() {
  if (!els.eventNearbyBanner) return;
  hideWithFade(els.eventNearbyBanner);
}

// Bound to the banner's own body (not just the dismiss "x") -- tapping the alert should open
// the event exactly as tapping it in the Nearby list would.
function openEventNearbyBanner() {
  const id = state.eventNearbyBannerEventId;
  hideEventNearbyBanner();
  if (!id) return;
  const event = Array.isArray(state.landmarks)
    ? state.landmarks.find((place) => isEventCategory(place) && place.id === id)
    : null;
  if (event) focusOverviewItem("landmark", placeHashKey(event));
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
    const hasHeading = Number.isFinite(state.compassHeadingTarget) && Number.isFinite(state.compassHeading);
    const hasBetaWork = Math.abs(state.tiltBetaTarget - state.tiltBetaSmoothed) >= 0.05;
    if (!hasHeading && !hasBetaWork) {
      state.compassAnimationFrame = null;
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
    if (hasHeading) {
      updateOverviewDirectionArrows();
      refreshNearbyListForHeading();
      updateCompassOverlay();
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
      const { latitude, longitude, accuracy, speed } = position.coords;
      const previousPoint = state.userLocation && state.userLocation.point;
      state.userLocation = ingestLocationFix(latitude, longitude, accuracy, performance.now(), speed);
      if (Native.heading) Native.heading.setLocation(latitude, longitude);
      const point = state.userLocation.point;
      state.userInMapArea = pointInsideBounds(point, state.bounds);
      const nearestTrees = nearestTreesTo(latitude, longitude, state.nearestItemsCount);
      state.nearestTree = nearestTrees.length > 0 ? nearestTrees[0] : null;
      state.nearestCow = nearestCowTo(latitude, longitude);
      state.nearestPub = nearestPlaceByFilter(latitude, longitude, (place) => isPubCategory(place));
      state.nearestRestaurant = nearestPlaceByFilter(latitude, longitude, (place) => isRestaurantCategory(place));
      state.nearestLandmark = nearestPlaceByFilter(latitude, longitude, (place) => !isPubCategory(place) && !isRestaurantCategory(place) && !isCafeCategory(place) && !isShopCategory(place) && !isTransportCategory(place));
      state.nearestPlace = nearestPlacesTo(latitude, longitude, 1)[0] || null;
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
    ? state.userLocation.point
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
  // Same cubic ease-in-out animateViewportTo and nearbyRenderOriginPoint use, so this reads as
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
  // Selection clears a browsed Nearby anchor immediately, but the map still needs the exact
  // pins and pivot that were visible before that state change while the camera slides away from
  // it. Rebuilding the Nearby lookup after the clear scopes pins to the user's GPS position and
  // can leave the in-between camera looking at empty terrain.
  state.selectionMapTransitionIconLookup = typeof buildNearbyIconLookup === "function"
    ? buildNearbyIconLookup()
    : null;
  state.selectionMapTransitionOriginPoint = typeof nearbyRenderOriginPoint === "function"
    ? nearbyRenderOriginPoint()
    : (typeof nearbyOrigin === "function" ? nearbyOrigin()?.point || null : null);
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
// ambient route lines to them. Zero while a browse-origin slide is running *with the camera
// otherwise pinned in place*, then a quick fade in once it lands.
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
// (focusNearbyOnClusterGroup -> ensureOverviewTargetsVisible's own animateViewportTo tween),
// so nothing is pinned: ring, pins and terrain are all being redrawn every frame under one
// live, moving transform, exactly like any other selection fit. Gating opacity here on top of
// that hid the group's own members for the whole ~450ms flight and then popped them in once
// both tweens happened to finish -- reported as "it animates to the position and then
// suddenly snaps afterwards". Skipping the gate whenever a viewport animation is also running
// leaves the plain-anchor-move case (no concurrent viewport tween) exactly as it was.
function nearbyRevealOpacity() {
  const transition = state.nearbyOriginTransition;
  if (!transition) return 1;
  if (state.selectionMapTransitionActive) return 1;
  if (state.viewportAnimationTo != null) return 1;
  const sinceStart = performance.now() - transition.startedAt;
  if (sinceStart < transition.durationMs) return 0;
  return clamp((sinceStart - transition.durationMs) / NEARBY_REVEAL_MS, 0, 1);
}

// True while the reveal fade still has frames left to draw, so prepareCanvasForDraw keeps
// asking for them after the slide itself has finished. See nearbyRevealOpacity: no fade to
// wait out while a viewport animation is also running, since nothing was hidden to begin with.
function nearbyRevealInProgress() {
  const transition = state.nearbyOriginTransition;
  if (!transition) return false;
  if (state.selectionMapTransitionActive) return false;
  if (state.viewportAnimationTo != null) return false;
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
  // Pitch is an independent motion axis. A browser may provide beta while its compass is
  // still waiting for iOS permission or magnetometer calibration, and the map can safely stay
  // north-up while still responding to the phone being lifted. Once a heading is available the
  // same path becomes the full heading-up radar view.
  return Boolean(state.map3dEnabled) && Boolean(hasRealLocation()) && state.tiltBetaSmoothed > TILT_BETA_THRESHOLD;
}

// Chrome on a laptop fires one deviceorientation event with every angle null, so only a finite
// beta counts. Reveals the switch in place if Settings is already open.
function markMotionSensorSeen() {
  state.motionSensorSeen = true;
  try { localStorage.setItem(MOTION_SENSOR_KEY, "1"); } catch {}
  const section = typeof document !== "undefined" && document.getElementById("map3dSetting");
  if (section) section.hidden = false;
}

// Turning 3D off mid-tilt must flatten the map straight away, not on the next pitch change:
// drop the frozen projection and re-fit, which re-solves the camera without the perspective.
function setMap3dEnabled(on) {
  state.map3dEnabled = Boolean(on);
  try { localStorage.setItem(MAP_3D_KEY, state.map3dEnabled ? "1" : "0"); } catch {}
  _tiltProjectionCache = undefined;
  if (typeof ensureOverviewTargetsVisible === "function") ensureOverviewTargetsVisible();
  requestDraw();
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
// useFinalBrowseState: true when the caller is computing the *destination* of a camera move
// it is about to hand to animateViewportTo (alignHeadingUpNavigationViewport's animate:true
// path) rather than this frame's instantaneous value. The progress blend below exists for
// per-frame tracking -- sampled once at the instant a browse-origin transition starts (when
// nearbyOriginTransitionEasedProgress() is still ~0), it reports almost exactly the *from*
// end, not the slide's actual destination. animateViewportTo then eased smoothly toward that
// wrong, stale target, and the next un-animated per-frame call (prepareCanvasForDraw, or a
// live compass tick once the tween's own selectionCameraTransitionActive() guard lifts)
// snapped straight to the real one the instant the tween finished -- the camera "zooms past
// the real framing and then snaps back to it" field report. Skipping the blend here means the
// tween itself eases to the correct destination, so there is nothing left to correct.
function tiltRampedAnchor(isSelected, useFinalBrowseState = false) {
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
  if (useFinalBrowseState) return to;
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
// useFinalBrowseState: see cameraOriginPoint's comment. headingUpFitTiltCamera (the one
// animate:true-fit caller, via maxScaleForHeadingUpPoints) passes it through so the camera
// distance the fit solves against already matches the browse-origin slide's destination; the
// renderer's own tiltProjection() call leaves it at the default, live-tracking value, since
// what it draws each frame has to match that frame's own (still-blending) anchor, not where
// the anchor will eventually land.
function tiltAvailableAheadCssPx(useFinalBrowseState = false) {
  const focusRect = bestVisibleCanvasRect();
  const isSelected = selectedNavigationHeadingUpActive();
  const anchor = headingUpAnchorFraction(isSelected, useFinalBrowseState);
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
  const reach = Math.max(anchor, 1 - anchor, tiltRampedAnchor(isSelected, useFinalBrowseState));
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
function tiltPerspectivePx(useFinalBrowseState = false) {
  if (tiltRotateXDeg() <= 0) return TILT_PERSPECTIVE_MIN_PX;
  const desired = tiltAvailableAheadCssPx(useFinalBrowseState) * TILT_HORIZON_GROUND_RATIO * TILT_HORIZON_REFERENCE_TAN;
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
  if (!state.map3dEnabled || !headingUpActive()) return 0;
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
  const selectedNavigationBasisTransition = Boolean(
    state.cameraOriginTransition
    && state.selected?.item
    && typeof selectedCompassTarget === "function"
    && selectedCompassTarget(),
  );
  return state.selectionViewportTransitionPending
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

  const radians = toRadians(currentNavigationMapRotationDegrees());
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let ahead = 0;
  let behind = 0;
  let side = 0;
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const dx = point.x - state.userLocation.point.x;
    const dy = point.y - state.userLocation.point.y;
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
// absolute canvas y: the rect itself can shift (a window resize, the inspector opening, the
// canvas's own heading-up overscan sizing in for the first time) between one call and the
// next for reasons that have nothing to do with the compass, and holding a stale *absolute*
// pixel position across that shift places it nonsensically inside the new rect -- measured
// as a ~5.5x scale collapse when the canvas gained its overscan inset between two calls in
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
  const items = group.itemType === "_mega" && group.itemsByType
    ? Object.values(group.itemsByType).flat()
    : (group.items || []);
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
// animate:true path) that is about to hand the result to animateViewportTo and ease to it
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
  // This is the walking-radius ring's own framing (nearbyNavigationFocusPoint/
  // maxNearbyHeadingUpScale below), reached both directly -- every watchPosition fix calls it
  // whenever nothing is selected, which nearbyNavigationAnchorActive() makes true throughout
  // Search too -- and via ensureOverviewTargetsVisible, which every one of this function's other
  // callers (compass ticks, filter changes, GPS fixes) ultimately routes through under the same
  // "no selection" condition. Search frames its own highlighted matches instead
  // (updateSearchHighlight/fitSearchCameraToHighlight), so applying the ring's framing here,
  // unconditionally and without animation, was silently snapping a still-open search back to the
  // ring on the next GPS fix or compass tick, sometimes long after the search fit had settled.
  // Leaving the camera alone here means it simply stays on the search fit until the query next
  // changes, rather than fighting it.
  if (state.searchScreenOpen && state.searchHighlightResults.length) return false;
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
  // A caller passing animate:true is about to hand the result to animateViewportTo and ease
  // to it itself -- so the nearby pivot/scale/origin must solve for the browse-origin slide's
  // actual destination, not a progress snapshot of it taken at the instant the slide starts
  // (see tiltRampedAnchor's comment: that snapshot is what used to make the tween zoom past
  // the real framing and then have the next per-frame call snap it back). Scoped to the
  // nearby branch only -- selected navigation's own basis-switch ease (cameraOriginTransition)
  // is a different, still-wanted slide (see cameraOriginPoint's comment on "very jumpy").
  const useFinalBrowseState = Boolean(options.animate) && !selectedNavigationHeadingUpActive();
  const focus = selectedNavigationHeadingUpActive()
    ? navigationFocusPoint(focusRect)
    : nearbyNavigationFocusPoint(focusRect, useFinalBrowseState);
  const maxScale = selectedNavigationHeadingUpActive()
    ? maxHeadingUpNavigationScale(focus, focusRect)
    : maxNearbyHeadingUpScale(focus, focusRect, useFinalBrowseState);
  // The one shared definition of where the camera is looking -- see cameraOriginPoint().
  const userPoint = cameraOriginPoint(useFinalBrowseState);
  // Use maxScale directly: heading-up mode always fits all targets in the
  // rotated focus rect. Math.min would leave scale too low when the map
  // was previously at a wider zoom (e.g. walking-radius level on first load).
  const targetScale = resolveHeadingUpTargetScale(maxScale, previousScale, Boolean(options.force));
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
    animateViewportTo(panViewport, panMs, () => animateViewportTo(targetViewport, zoomMs));
  } else if (options.animate) {
    animateViewportTo(
      targetViewport,
      options.durationMs || HEADING_UP_NAV_ANIMATION_MS,
      undefined,
      options.cinematic ? { cinematic: true, focusPoint: { x: focus.x, y: focusY } } : undefined,
    );
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
  const focusRect = bestVisibleCanvasRect();
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
  animateViewportTo({
    scale: targetScale,
    tx: focus.x - userPoint.x * targetScale,
    ty: focusY - userPoint.y * targetScale,
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
  if (!hasRealLocation()) {
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
    animateViewportTo(
      targetViewport,
      options.durationMs || OVERVIEW_TARGETS_DEFAULT_ANIMATION_MS,
      undefined,
      options.cinematic
        ? { cinematic: true, focusPoint: { x: focusRect.x + focusRect.width / 2, y: focusRect.y + focusRect.height / 2 } }
        : undefined,
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
  if (!state.dataLoaded) return;
  if (!state.userLocation) return;
  if (state.selected && !secondaryScreenActive()) return;
  if (state.clusterZoomed) return;
  if (els.inspector.classList.contains("minimized")) return;
  if (nearbyNavigationAnchorActive()) return;
  if (communityFramesOwnMarksOnly()) return;

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

  if (communityFramesOwnMarksOnly()) {
    fitCommunityOwnMarks(options);
    return;
  }

  if (nearbyNavigationAnchorActive()) {
    alignHeadingUpNavigationViewport({
      animate: Boolean(options.animate),
      cinematic: Boolean(options.cinematic),
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
    if (placeHashKey(place).toLowerCase() === probe) return place;
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
  const navigating = Boolean(target) && hasRealLocation()
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
  if (!target || !hasRealLocation()) {
    if (arrow) arrow.hidden = true;
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
  if (arrow) {
    // The first bearing after the search: spin two full turns and slow into the direction, rather
    // than snapping straight to it.
    const settlingIn = arrow.hidden || arrow.classList.contains("title-compass-arrow--searching");
    arrow.classList.remove("title-compass-arrow--searching");
    arrow.hidden = false;
    if (settlingIn) {
      arrow.style.transition = "none";
      arrow.style.transform = `rotate(${state.compassArrowAngle + 720}deg)`;
      void arrow.offsetWidth;
      arrow.style.transition = "transform 1.6s cubic-bezier(0.2, 0.7, 0.2, 1)";
      arrow.addEventListener("transitionend", () => { arrow.style.transition = ""; }, { once: true });
    }
    arrow.style.transform = `rotate(${state.compassArrowAngle}deg)`;
    arrow.setAttribute("aria-label", `Direction to ${title}, ${detailTypeLabel(distanceFromUser(target))}`);
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

// A selected tree or place leaves the cows card out of its Nearest section until cow positions have
// loaded (nearbySectionsHtml, js/inspector.js), and nothing else redraws an open detail view when
// they arrive -- so a deep-linked selection that rendered first never got the card.
function refreshSelectedDetailForCows() {
  const selected = state.selected;
  if (!selected || !selected.item || (selected.type !== "tree" && selected.type !== "landmark")) return;
  // Only while the inspector is still showing that detail (its Nearest section is on screen): a
  // reader who has since moved to Settings, a form or a list is left where they are.
  const showingDetail = els.inspectorBody
    && Array.from(els.inspectorBody.querySelectorAll(".detail-section-heading")).some((heading) => heading.textContent.trim() === "Nearest");
  if (!showingDetail) return;
  const route = SELECTION_ROUTES.find((entry) => entry.type === selected.type);
  if (route) route.show(selected.item);
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
  else if (cowsWereMissing && cows.length > 0) refreshSelectedDetailForCows();
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

// --- Map search -----------------------------------------------------------------------
//
// One search box over everything the map draws: trees (by species or tag), places (shops,
// pubs, cafés, stations, car parks, plaques...), roads, waymarked trails, water features,
// railway lines and the live cows. Results are rendered with the Nearby view's own
// .nearest-item markup and open the same detail screens a map tap does, so finding a place
// by name and finding it by walking past it end up in exactly the same place.

const SEARCH_RESULT_LIMIT = 30;
// How many of the top matches the map highlights and zooms out to fit, live as the user types.
// Matches the Nearby list's own "closest 10" framing rather than SEARCH_RESULT_LIMIT's fuller
// scrollable list, so the map isn't asked to frame a query that returns dozens of hits.
const SEARCH_HIGHLIGHT_LIMIT = 10;
const SEARCH_MIN_QUERY_LENGTH = 2;

// Match quality, best first. Distance breaks ties, so "Forest Road" two streets away beats
// "Forest Road" on the far side of the forest, but never beats an exact-name match.
const SEARCH_RANK_EXACT = 0;
const SEARCH_RANK_PREFIX = 1;
const SEARCH_RANK_WORD = 2;
const SEARCH_RANK_SUBSTRING = 3;
const SEARCH_RANK_TOKENS = 4;

// Punctuation, accents and case are all noise in a name a user is half-remembering: "St
// Mary's" has to be findable as "st marys", "Cafe" has to find "Café", and a tree tag has
// to answer to "EF 1234" or "ef-1234". Apostrophes are dropped rather than turned into a
// space, so "marys" stays one word; everything else becomes a word break.
function normalizeSearchText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchQueryTokens(needle) {
  return needle ? needle.split(" ").filter(Boolean) : [];
}

// How well one normalized field answers the whole query, or null for "it doesn't".
function searchFieldRank(field, needle) {
  if (!field || !needle) return null;
  if (field === needle) return SEARCH_RANK_EXACT;
  if (field.startsWith(needle)) return SEARCH_RANK_PREFIX;
  if (field.includes(` ${needle}`)) return SEARCH_RANK_WORD;
  if (field.includes(needle)) return SEARCH_RANK_SUBSTRING;
  return null;
}

// Fields are ranked individually rather than as one blob so a tree's tag can match exactly
// ("1234" is the whole of that field) without its species name diluting it. A multi-word
// query that no single field answers falls back to "every word appears somewhere", which is
// what makes "oak 1234" find tree 1234 and "epping station" find the station.
function searchEntryRank(entry, needle, tokens) {
  let best = null;
  for (const field of entry.fields) {
    const rank = searchFieldRank(field, needle);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  if (best !== null) return best;
  if (tokens.length < 2) return null;
  for (const token of tokens) {
    if (!entry.blob.includes(token)) return null;
  }
  return SEARCH_RANK_TOKENS;
}

// The searchable index is built once and kept, because normalising ~40k names on every
// keystroke is not something a phone should be asked to do. Anything with no name to match
// is left out entirely, which drops most of the 27k road ways and keeps the index to the
// named features a person could actually be looking for. Cows are deliberately absent: their
// positions refresh on a timer, so they are scanned live in searchMapFeatures instead.
let _searchIndex = null;
let _searchIndexSources = null;

// The index is rebuilt when any source array is replaced or has grown -- which is what a
// chunked load, a data refresh and a test fixture all look like. Both the array identity and
// its length are compared, so neither swapping an array for a different one of the same size
// nor pushing into the one already indexed can leave a stale index behind.
function searchIndexSources() {
  return [
    state.trees,
    state.landmarks,
    state.paths,
    state.roads,
    state.waterFeatures,
    state.environmentFeatures,
  ];
}

function searchIndexSourcesChanged(sources) {
  if (!_searchIndexSources || _searchIndexSources.length !== sources.length) return true;
  return sources.some((source, index) => {
    const previous = _searchIndexSources[index];
    return previous.array !== source || previous.length !== source.length;
  });
}

function searchIndexEntry(type, item, rawFields) {
  const fields = [];
  for (const raw of rawFields) {
    const field = normalizeSearchText(raw);
    if (field && !fields.includes(field)) fields.push(field);
  }
  if (!fields.length) return null;
  return { type, item, fields, blob: fields.join(" ") };
}

// Search is also a way to browse the map, so index the human-readable taxonomy as well as
// names. The source values cover OSM's precise classifications (such as `amenity=cafe`),
// while the filter metadata supplies the broader category and its subcategory labels.
// Deliberately exclude contact details and URLs: neither helps someone find a place on the map.
function searchLandmarkFields(place) {
  const fields = [
    place.name,
    place.transportStopName,
    place.category,
    place.categoryLabel,
    ...(place.categoryTags || []),
    place.amenity,
    place.shop,
    place.tourism,
    place.historic,
    place.railway,
    place.highway,
    place.barrier,
    place.entrance,
    place.heritage,
    place.address,
    place.folkloreCategory,
    ...(place.folkloreTopics || []),
    place.type,
    place.area,
    place.description,
  ];

  for (const filterKey of PLACE_FILTER_KEYS) {
    if (!matchesPlaceFilter(place, filterKey)) continue;
    const meta = filterMeta(filterKey);
    if (meta) fields.push(meta.label, meta.title, meta.groupLabel);
  }
  return fields;
}

function buildSearchIndex() {
  const entries = [];
  const push = (type, item, rawFields) => {
    const entry = searchIndexEntry(type, item, rawFields);
    if (entry) entries.push(entry);
  };

  for (const tree of state.trees) {
    push("tree", tree, ["tree", "trees", tree.commonName, tree.latinName, tree.tagNumber, tree.nationalDatabaseTagNumber, tree.recordNumber]);
  }
  for (const place of state.landmarks) {
    push("landmark", place, searchLandmarkFields(place));
  }
  for (const path of state.paths) {
    push("path", path, [path.name, path.ref, path.pathType, path.highway, path.foot, path.horse, path.access]);
  }
  for (const road of state.roads) {
    push("road", road, [road.name, road.ref, road.roadType, road.highway, road.service]);
  }
  for (const water of state.waterFeatures) {
    push("water", water, [water.name, water.featureType, water.waterway]);
  }
  for (const feature of state.environmentFeatures) {
    const props = feature && feature.properties;
    if (!props || props.featureType !== "railway") continue;
    push("railway", feature, [props.name, props.ref, props.railway, props.service]);
  }
  return entries;
}

function ensureSearchIndex() {
  const sources = searchIndexSources();
  if (_searchIndex && !searchIndexSourcesChanged(sources)) return _searchIndex;
  _searchIndex = buildSearchIndex();
  _searchIndexSources = sources.map((array) => ({ array, length: array.length }));
  return _searchIndex;
}

// Roads carry segments but no single coordinate (js/normalize.js): they are drawn as lines
// and were only ever selected by tapping one. Search has to sort them by distance and frame
// them on the map, so the same halfway-along-the-longest-segment anchor paths already use is
// derived here, once per road, the first time that road turns up in a result.
function ensureRoadAnchor(road) {
  if (!road || road.point) return road && road.point ? road.point : null;
  const anchor = pathLabelAnchor(road);
  if (!anchor) return null;
  const lonLat = unprojectPoint(anchor);
  road.point = anchor;
  road.latitude = lonLat.latitude;
  road.longitude = lonLat.longitude;
  return anchor;
}

function searchResultPoint(type, item) {
  if (!item) return null;
  if (type === "road") ensureRoadAnchor(item);
  if (item.point) return item.point;
  if (Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) {
    return projectLonLat(item.longitude, item.latitude);
  }
  const props = item.properties;
  if (props && Number.isFinite(props.latitude) && Number.isFinite(props.longitude)) {
    return projectLonLat(props.longitude, props.latitude);
  }
  return null;
}

function searchResultLatLon(type, item) {
  if (type === "road") ensureRoadAnchor(item);
  if (item && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) {
    return { latitude: item.latitude, longitude: item.longitude };
  }
  const props = item && item.properties;
  if (props && Number.isFinite(props.latitude) && Number.isFinite(props.longitude)) {
    return { latitude: props.latitude, longitude: props.longitude };
  }
  return null;
}

function searchResultDistance(type, item) {
  const origin = nearbyOrigin();
  if (!origin) return null;
  const position = searchResultLatLon(type, item);
  if (!position) return null;
  return distanceMetres(origin.latitude, origin.longitude, position.latitude, position.longitude);
}

function searchResultKey(type, item) {
  switch (type) {
    case "tree": return treeHashKey(item);
    case "landmark": return placeHashKey(item);
    case "cow": return cowKey(item);
    case "path": return pathHashKey(item);
    case "road": return roadHashKey(item);
    case "water": return waterHashKey(item);
    case "railway": return railwayHashKey(item);
    default: return "";
  }
}

function searchResultName(type, item) {
  switch (type) {
    case "tree": return treeDisplayName(item);
    case "landmark": return placeTitle(item);
    case "cow": return `Cow ${displayValue(item.serialNo)}`;
    case "path": return displayValue(item.name || item.ref || "Waymarked trail");
    case "road": return displayValue(item.name || item.ref || "Unnamed road");
    case "water": return displayValue(item.name);
    case "railway": return displayValue((item.properties && (item.properties.name || item.properties.ref)) || "Railway");
    default: return "";
  }
}

function searchResultTypeLabel(type, item) {
  switch (type) {
    case "tree": return "Tree";
    case "landmark":
      if (isEventCategory(item)) return formatEventWhen(item) || "Event";
      return filterMeta(placeLabelFilterKey(item))?.label || item.categoryLabel || "Place";
    case "cow": return "Cow";
    case "path": return filterMeta("waymarked_trails")?.label || "Trail";
    case "road": return roadTypeLabel(item);
    case "water": return item.featureType === "hydrology_area" ? "Pond / lake" : "Stream / waterway";
    case "railway": return "Railway";
    default: return "";
  }
}

function searchResultIconHtml(type, item) {
  switch (type) {
    case "tree": return treeSpeciesIconHtml(item.commonName, item.latinName) || appIconHtml("tree");
    case "landmark": return landmarkEmoji(item);
    case "cow": return appIconHtml("cow");
    case "path": return appIconHtml("waymarked");
    case "road": return roadIconHtml();
    case "water": return appIconHtml("ponds");
    case "railway": return appIconHtml("railway");
    default: return appIconHtml("pin");
  }
}

// Lines share a name across many OSM ways -- "Epping New Road" is dozens of them -- so one
// road is one result, the nearest piece of it. Points are not collapsed that hard: two cafés
// with the same name really are two cafés, and eight bus stops called "Forest Road" really
// are eight stops -- but listing all eight buries the street itself below the fold, so a
// repeated name is allowed a few rows and no more.
const SEARCH_LINE_TYPES = new Set(["road", "path", "water", "railway"]);
const SEARCH_SAME_NAME_LIMIT = 3;

// Breaks a tie that rank and distance leave open -- which is every tie at all when there is
// no location fix. Without it the order fell out of the order the datasets happen to load in.
const SEARCH_TYPE_ORDER = ["landmark", "tree", "road", "path", "water", "railway", "cow"];

function searchTypeOrder(type) {
  const index = SEARCH_TYPE_ORDER.indexOf(type);
  return index === -1 ? SEARCH_TYPE_ORDER.length : index;
}

function searchMapFeatures(query) {
  const needle = normalizeSearchText(query);
  if (needle.length < SEARCH_MIN_QUERY_LENGTH) return [];
  const tokens = searchQueryTokens(needle);

  const matches = [];
  const consider = (type, item, rank) => {
    if (rank === null) return;
    const key = searchResultKey(type, item);
    if (!key) return;
    matches.push({ type, item, key, rank, metres: searchResultDistance(type, item) });
  };

  for (const entry of ensureSearchIndex()) {
    consider(entry.type, entry.item, searchEntryRank(entry, needle, tokens));
  }
  for (const cow of state.cows || []) {
    const entry = searchIndexEntry("cow", cow, ["cow", cow.serialNo]);
    if (entry) consider("cow", cow, searchEntryRank(entry, needle, tokens));
  }

  // Unknown distance (no location fix, or a feature with no coordinate) sorts last within
  // its rank rather than jumping to the front as NaN comparisons would.
  const distance = (entry) => (Number.isFinite(entry.metres) ? entry.metres : Number.POSITIVE_INFINITY);
  matches.sort((a, b) => (
    (a.rank - b.rank)
    || (distance(a) - distance(b))
    || (searchTypeOrder(a.type) - searchTypeOrder(b.type))
  ));

  const results = [];
  const seenCounts = new Map();
  for (const match of matches) {
    const name = normalizeSearchText(searchResultName(match.type, match.item));
    if (name) {
      const nameKey = `${match.type}|${name}`;
      const shown = seenCounts.get(nameKey) || 0;
      if (shown >= (SEARCH_LINE_TYPES.has(match.type) ? 1 : SEARCH_SAME_NAME_LIMIT)) continue;
      seenCounts.set(nameKey, shown + 1);
    }
    results.push(match);
    if (results.length >= SEARCH_RESULT_LIMIT) break;
  }
  return results;
}

// Rings the top SEARCH_HIGHLIGHT_LIMIT matches on the map (drawSearchHighlights, js/renderer.js)
// and zooms out just enough to fit all of them, so typing a broad query immediately shows where
// every top match sits rather than only the closest one. Called on every results recompute --
// searchResultsHtml, on open and on each debounced keystroke (renderSearchResults) -- so the
// highlight and framing track the query live rather than only on selecting a result.
// Frames the user's own position alongside the highlighted matches -- nearbyOrigin() is the same
// point searchResultDistance measures every match's walk chip from, so "nearest first" stays
// legible against where you actually are, rather than zooming out to a view that only shows the
// matches themselves.
function fitSearchCameraToHighlight() {
  const points = state.searchHighlightResults
    .map((result) => searchResultPoint(result.type, result.item))
    .filter(Boolean);
  if (!points.length) return;
  const origin = nearbyOrigin();
  if (origin && origin.point) points.push(origin.point);
  fitToPoints(points, false, { focusVisibleArea: true, animate: true, assumeInspectorOpen: true });
}

// How long a typing pause has to hold before the camera re-fits. Refitting on every keystroke
// -- what this used to do -- meant every transient result set a fast typist passed through on
// the way to their actual query got its own camera move: a single very-close match a few
// characters into a longer name is common, and zooming tight onto it only to zoom back out two
// keystrokes later read as jumpy rather than "live". The highlighted pins and results list still
// update every keystroke (see below); only the camera waits.
const SEARCH_CAMERA_FIT_DEBOUNCE_MS = 350;
let _searchCameraFitTimer = null;

function updateSearchHighlight(results) {
  const top = results.slice(0, SEARCH_HIGHLIGHT_LIMIT);
  const hadResults = state.searchHighlightResults.length > 0;
  state.searchHighlightResults = top;
  requestDraw();
  if (_searchCameraFitTimer != null) {
    clearTimeout(_searchCameraFitTimer);
    _searchCameraFitTimer = null;
  }
  if (!top.length) {
    // No matches -- an empty/too-short query, or a query nothing on the map answers. The camera
    // has no search fit to hold any more, so it's the Nearby ring's turn: without this it stayed
    // wherever the last search fit left it, which read as "stuck" rather than "back to normal".
    // Only worth doing if there *were* results a moment ago -- an empty query on first opening
    // Search has nothing to fall back from (openSearchScreen's own fallback already covers it).
    if (hadResults && state.userLocation) {
      ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
    }
    return;
  }
  if (!hadResults) {
    // The first match to appear (query just became long enough, or the very first keystroke
    // already matched something): fit immediately rather than leaving the camera on the ring for
    // the length of the debounce below -- that gap read as the map "still showing Nearby" even
    // though a match already existed. Only a result set that already has something on screen
    // waits for a typing pause before re-fitting again (see SEARCH_CAMERA_FIT_DEBOUNCE_MS above).
    fitSearchCameraToHighlight();
    return;
  }
  _searchCameraFitTimer = setTimeout(() => {
    _searchCameraFitTimer = null;
    // The screen may have moved on (a result picked, search closed) during the pause -- this
    // fit is only still wanted if Search is still open and looking at this same set.
    if (state.searchScreenOpen) fitSearchCameraToHighlight();
  }, SEARCH_CAMERA_FIT_DEBOUNCE_MS);
}

function searchResultsHtml(query) {
  const needle = normalizeSearchText(query);
  if (!needle) {
    updateSearchHighlight([]);
    return `<p class="empty">Search for a tree tag or species, a shop, pub or café, a road, a trail, or anywhere else on the map.</p>`;
  }
  if (needle.length < SEARCH_MIN_QUERY_LENGTH) {
    updateSearchHighlight([]);
    return `<p class="empty">Keep typing — search needs at least ${SEARCH_MIN_QUERY_LENGTH} characters.</p>`;
  }

  const results = searchMapFeatures(query);
  updateSearchHighlight(results);
  if (!results.length) {
    return `<p class="empty">Nothing on the map matches “${escapeHtml(query.trim())}”.</p>`;
  }

  const itemsHtml = results.map((result) => {
    const position = searchResultLatLon(result.type, result.item);
    const walkChip = walkInfoHtml(result.metres);
    const typeLabel = searchResultTypeLabel(result.type, result.item);
    const treeTag = result.type === "tree" ? treeTagLabel(result.item) : null;
    const treeTagChip = treeTag ? ` · #${escapeHtml(treeTag)}` : "";
    return `<li><button class="nearest-item" type="button" data-search-type="${escapeHtml(result.type)}" data-search-key="${escapeHtml(result.key)}">
      <span class="nearest-icon" aria-hidden="true">${searchResultIconHtml(result.type, result.item)}</span>
      <div class="nearest-content">
        <div class="nearest-header">
          <span class="nearest-name">${escapeHtml(searchResultName(result.type, result.item))}</span>
        </div>
        <div class="nearest-footer">
          <span class="nearest-meta">${walkChip ? `${walkChip} · ` : ""}${escapeHtml(typeLabel)}${treeTagChip}</span>
          <span class="nearest-arrow" data-item-lat="${position ? position.latitude : ""}" data-item-lon="${position ? position.longitude : ""}" aria-hidden="true">↑</span>
        </div>
      </div>
    </button></li>`;
  }).join("");

  const countLabel = results.length >= SEARCH_RESULT_LIMIT
    ? `Closest ${SEARCH_RESULT_LIMIT} matches`
    : `${results.length} match${results.length === 1 ? "" : "es"}`;
  return `<div class="nearby-heading"><strong>${escapeHtml(countLabel)}</strong></div><ul class="nearest-list">${itemsHtml}</ul>`;
}

// The nav button's magnifier again, at title size. There is no search PNG in the icon
// registry (js/categories.js) and the inspector's back arrow sets the precedent for a UI
// glyph drawn inline; app.html carries its own copy because that file holds no logic.
function searchIconHtml(className = "app-icon title-icon") {
  return `<svg class="${className}" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><circle cx="9.5" cy="9.5" r="6"/><line x1="14" y1="14" x2="19" y2="19"/></svg>`;
}

function searchScreenHtml() {
  return `<div class="search-screen">
    <div class="search-field">
      <input id="mapSearchInput" class="search-number" type="search" inputmode="search" autocomplete="off"
        autocapitalize="off" spellcheck="false" enterkeyhint="search"
        placeholder="Search trees, places, roads…" aria-label="Search the map"
        value="${escapeHtml(state.searchQuery)}">
      <button id="mapSearchClear" class="search-clear" type="button" aria-label="Clear search"${state.searchQuery ? "" : " hidden"}>✕</button>
    </div>
    <div id="mapSearchResults" class="search-results" role="region" aria-live="polite" aria-label="Search results">${searchResultsHtml(state.searchQuery)}</div>
  </div>`;
}

// Re-renders only #mapSearchResults, never the field above it: replacing the whole body on
// every keystroke would take the focus and the caret with it.
function renderSearchResults() {
  const container = document.getElementById("mapSearchResults");
  if (!container) return;
  container.innerHTML = searchResultsHtml(state.searchQuery);
  const clearButton = document.getElementById("mapSearchClear");
  if (clearButton) clearButton.hidden = !state.searchQuery;
  updateOverviewDirectionArrows();
}

function openSearchScreen() {
  if (typeof trackGaScreenView === "function") trackGaScreenView("Search");
  // See the matching comment in openFiltersScreen.
  exitClusterExpansion();
  state.filterScreenOpen = false;
  state.selected = null;
  // Building the index here rather than on the first keystroke keeps the hitch off the
  // moment the user is typing into the field.
  ensureSearchIndex();
  setInspectorSelectionChrome({ emoji: searchIconHtml(), showBack: false, preserveNavHighlight: true });
  state.searchScreenOpen = true;
  if (els.nearbyToggle) els.nearbyToggle.hidden = false;
  setNavScreenActive(els.searchToggle);
  // Hides the inline filter toggle next to the Nearby/Filters heading -- Filters is reached
  // from Nearby, not from Search, which deliberately ignores the active filters regardless.
  updateFilterUi();
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Search";
  els.inspectorType.textContent = "Find anything on the map";
  // Not auto-focused: opening the screen from the nav bar should show the field and the map
  // behind it, not summon the keyboard immediately. The field is focused when the user taps it.
  transitionInspectorBody(searchScreenHtml(), "forward", updateOverviewDirectionArrows);
  setInspectorMinimized(false);
  syncHashFromSelection();
  requestDraw();
  // searchScreenHtml (just rendered above) already fit the camera to the restored query's own
  // highlighted matches via updateSearchHighlight -- only fall back to the Nearby-ring framing
  // when there is no query to frame yet.
  if (state.userLocation && !state.searchHighlightResults.length) {
    ensureOverviewTargetsVisible({ animate: true, durationMs: OVERVIEW_REFIT_ANIMATION_MS });
  }
}

// One render per frame: scanning the index is fast but not free, and a fast typist would
// otherwise pay for several scans whose results are replaced before they are ever read.
let _searchRenderFrame = null;

function setSearchQuery(value) {
  const next = String(value ?? "");
  if (state.searchQuery === next) return;
  state.searchQuery = next;
  syncLiveQueryStringForScreen();
  if (_searchRenderFrame != null) cancelAnimationFrame(_searchRenderFrame);
  _searchRenderFrame = requestAnimationFrame(() => {
    _searchRenderFrame = null;
    renderSearchResults();
  });
}

// A search result opens exactly the screen a deep link or a map tap would, through the same
// SELECTION_ROUTES table -- which is also what lets roads and railway lines, neither of which
// the Nearby list can offer, be navigated to from here.
function openSearchResult(type, key) {
  const route = SELECTION_ROUTES.find((entry) => entry.type === type);
  if (!route) return;
  const item = route.find(key);
  if (!item) {
    setStatus("That result is no longer on the map.");
    return;
  }
  state.clusterZoomed = false;
  exitClusterExpansion();
  state.searchScreenOpen = false;
  // A real selection replaces the Nearby view entirely, so any custom browse point -- and its
  // map dot (drawNearbyAnchorMarker, js/renderer.js) -- goes back to the user's own location
  // rather than lingering for whenever Nearby is next shown.
  // Before state.selected changes below -- see startCameraOriginTransition.
  startCameraOriginTransition();
  state.nearbyAnchor = null;
  state.selected = { type, item };
  // Update the URL before rendering, so the selected place and browser history stay in sync.
  syncHashFromSelection();
  route.show(item);
  setInspectorMinimized(true);
  startCompassNavigation();
  if (state.userLocation) {
    zoomToSelection();
  } else {
    const point = searchResultPoint(type, item);
    if (point) fitToPoints([point], false, { animate: true, focusVisibleArea: true });
  }
  trackSelectionClick(type, item, "search");
  requestDraw();
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
  // The Filter screen's own body now includes the same nearest list (filterScreenBodyHtml()),
  // so it needs bus-stop hydration exactly like the plain Nearby screen -- no longer excluded.
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
  if (distancePill && !hasRealLocation()) distancePill.innerHTML = "";
  if (distancePill && hasRealLocation() && Number.isFinite(metres)) {
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

