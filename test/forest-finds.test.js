Warning: truncated output (original token count: 153514)
Total output lines: 11845

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createElementStub(id = "") {
  const classes = new Set();
  return {
    id,
    hidden: false,
    dataset: {},
    style: {
      setProperty() {},
      removeProperty() {},
    },
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
    },
    width: 1000,
    height: 800,
    clientWidth: 1000,
    clientHeight: 800,
    scrollHeight: 0,
    textContent: "",
    innerHTML: "",
    childNodes: { length: 0 },
    offsetHeight: 0,
    value: "",
    disabled: false,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    scrollIntoView() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
    },
    getContext() {
      return {
        save() {},
        restore() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        bezierCurveTo() {},
        arc() {},
        fill() {},
        stroke() {},
        fillRect() {},
        clearRect() {},
        setLineDash() {},
        createLinearGradient() { return { addColorStop() {} }; },
        createRadialGradient() { return { addColorStop() {} }; },
        fillText() {},
        measureText(text) { return { width: String(text).length * 8 }; },
      };
    },
  };
}

function loadAppForTests({ localStorage: initialLocalStorage = {} } = {}) {
  // The app script lives in js/app.js; app.html only <script src>es it.
  const appPath = path.join(__dirname, "..", "js", "app.js");
  const appSource = fs.readFileSync(appPath, "utf8");
  assert.ok(appSource.trim(), "js/app.js should contain the app script");

  const elements = new Map();
  const storage = new Map(Object.entries({ "ff-features-v1": JSON.stringify({ community: true }), ...initialLocalStorage }));
  const localStorage = {
    getItem(key) {
      return storage.get(String(key)) ?? null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    },
    clear() {
      storage.clear();
    },
  };
  const document = {
    visibilityState: "visible",
    body: createElementStub("body"),
    documentElement: createElementStub("html"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElementStub(id));
      return elements.get(id);
    },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, createElementStub(selector));
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
  };

  // Window listeners are recorded rather than dropped so the history stub below can deliver a
  // popstate the way a browser does, and the router's own back/forward handling can be tested
  // end to end. windowStub.dispatchEvent(type) fires them by hand.
  const windowListeners = new Map();

  const window = {
    location: { hostname: "localhost", hash: "", pathname: "/", search: "" },
    devicePixelRatio: 1,
    innerWidth: 1000,
    innerHeight: 800,
    localStorage,
    addEventListener(type, handler) {
      if (typeof handler !== "function") return;
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      const handlers = windowListeners.get(type);
      if (handlers) handlers.delete(handler);
    },
    dispatchEvent(type) {
      for (const handler of windowListeners.get(type) || []) handler({ type });
    },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  };
  window.window = window;
  window.localStorage = localStorage;

  const applyUrlToLocation = (url) => {
    if (typeof url !== "string") return;
    const hashIndex = url.indexOf("#");
    const hash = hashIndex >= 0 ? url.substring(hashIndex) : "";
    const beforeHash = hashIndex >= 0 ? url.substring(0, hashIndex) : url;
    const searchIndex = beforeHash.indexOf("?");
    window.location.search = searchIndex >= 0 ? beforeHash.substring(searchIndex) : "";
    const pathname = searchIndex >= 0 ? beforeHash.substring(0, searchIndex) : beforeHash;
    if (pathname) window.location.pathname = pathname;
    window.location.hash = hash;
  };

  const history = {
    entries: [{ state: null, url: "/" }],
    index: 0,
    get length() { return this.entries.length; },
    get state() { return this.entries[this.index].state; },
    pushState(state, title, url) {
      // Anything ahead of the current entry is discarded, exactly as a browser does.
      this.entries.length = this.index + 1;
      this.entries.push({ state, url });
      this.index = this.entries.length - 1;
      applyUrlToLocation(url);
    },
    replaceState(state, title, url) {
      this.entries[this.index] = { state, url: url ?? this.entries[this.index].url };
      applyUrlToLocation(url);
    },
    go(delta) {
      const next = this.index + delta;
      if (next < 0 || next >= this.entries.length || delta === 0) return;
      this.index = next;
      applyUrlToLocation(this.entries[next].url);
      window.dispatchEvent("popstate");
    },
    back() { this.go(-1); },
    forward() { this.go(1); },
  };

  const context = {
    console,
    document,
    window,
    navigator: { geolocation: null, userAgent: "node-test" },
    // A real session-history stack: the router pushes an entry per screen change and relies on
    // history.state carrying the depth, and on back() delivering a popstate, so a stub that
    // only rewrote the hash could not exercise any of it.
    history,
    fetch: async () => { throw new Error("fetch should not run in tests"); },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame(callback) { return setTimeout(() => callback(Date.now()), 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    performance: { now: () => Date.now() },
    Element: function Element() {},
    // Map icon artwork (getMapImage, js/renderer.js) is real Image objects in a browser, which
    // never finish loading in this sandbox -- no network fetch runs here. A plain stub keeps
    // `img.complete`/`naturalWidth` falsy exactly the way a not-yet-loaded image reads, so any
    // draw path touching it (e.g. a mega badge's icon chips) skips the artwork rather than
    // throwing on a missing global.
    Image: function Image() { this.complete = false; this.naturalWidth = 0; },
    URLSearchParams,
    URL,
    localStorage,
  };
  context.globalThis = context;

  const script = appSource
    .replace(/\n\s*boot\(\);\s*\n/, "\n")
    + `
globalThis.__forestFindsTest = {
  state,
  els,
  localStorage,
  navigator,
  // Replaces a top-level app function (a global in this sandbox) and returns the original, so a
  // test can count how often a hot path reaches an expensive helper. Restore it with the return.
  swapGlobalFunction(name, fn) { const previous = globalThis[name]; globalThis[name] = fn; return previous; },
  drawEnvironment,
  drawLayer,
  clusterFocusTarget,
  focusNearbyOnClusterGroup,
  expandedClusterOverviewEntries,
  // The sandbox's own clock object, so a test can freeze what the app reads from
  // performance.now() -- see withFrozenAppClock. Exported as the object, not as now(),
  // because the app looks the method up on it at every call.
  performance,
  formatDistance,
  projectLonLat,
  unprojectPoint,
  distanceMetres,
  buildRoutingGraph,
  buildRoutingGraphAsync,
  createRoutingGraphBuilder,
  findRoutePoints,
  nearestRoutingNode,
  dijkstraPath,
  ensureRoutingGraph,
  selectedRoutePoints,
  selectedRouteMetres,
  drawSelectedRoute,
  selectedRouteIsFallback,
  updateSelectedDetailFields,
  selectedCompassTarget,
  distanceFromUser,
  walkInfoExpandableHtml,
  formatWalkTime,
  overviewItemsForActiveFilter,
  overviewNearestHtml,
  categoryLandingLinksHtml,
  navigateInApp,
  overviewHeadingText,
  landingPageCategoryLabel,
  updateDocumentTitle,
  normalizeSearchText,
  searchQueryTokens,
  searchFieldRank,
  searchEntryRank,
  searchIndexEntry,
  searchMapFeatures,
  searchResultsHtml,
  searchResultName,
  searchResultTypeLabel,
  searchResultKey,
  openSearchScreen,
  openSearchResult,
  setSearchQuery,
  SEARCH_RESULT_LIMIT,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_RANK_EXACT,
  SEARCH_RANK_PREFIX,
  SEARCH_RANK_WORD,
  SEARCH_RANK_SUBSTRING,
  SEARCH_RANK_TOKENS,
  SEARCH_HIGHLIGHT_LIMIT,
  SEARCH_CAMERA_FIT_DEBOUNCE_MS,
  updateSearchHighlight,
  fitSearchCameraToHighlight,
  buildSearchIconLookup,
  activeIconLookup,
  markerOpacityFor,
  treeHashKey,
  findTreeByHashKey,
  treeDisplayName,
  releaseStrandedAnimationFrames,
  setOverviewFilters,
  loadStoredOverviewFilters,
  applyShowFilterFromQuery,
  filterKeysFromFindPath,
  filterKeysFromQuery,
  isLandingPageArrival,
  allEntriesForFilterKey,
  allEntriesForActiveFilters,
  activeFiltersShowFullListWithoutLocation,
  renderNearestItemsHtml,
  fitMapToSingleFilterIfNoLocation,
  urlPartsForRouteValue,
  searchStringForPath,
  routeValueFromLocation,
  syncLiveQueryStringForScreen,
  applySearchQueryFromQuery,
  applyRadiusFromQuery,
  DEFAULT_WALKING_DISTANCE_MINUTES,
  LANDING_PAGE_WALKING_DISTANCE_MINUTES,
  DEFAULT_LOCATION,
  DEFAULT_LOCATION_WALKING_DISTANCE_MINUTES,
  applyDefaultLocation,
  hasRealLocation,
  ROUTE_PATHS,
  NEARBY_PATH,
  applyWalkingRadiusChange,
  selectionCameraTransitionActive,
  headsUpSortedEntries,
  headsUpScore,
  nearbyListHeading,
  syncNearbyListHeading,
  refreshNearbyListForHeading,
  HEADS_UP_BEHIND_PENALTY,
  HEADS_UP_REORDER_DEGREES,
  walkingDistanceToMetres,
  walkingRadiusFloorMinutes,
  metresToWalkingMinutes,
  roundWalkingMinutes,
  ceilWalkingMinutes,
  formatWalkingRadius,
  ensureWalkingRadiusCoversNearest,
  nearbyRadiusIsEmpty,
  syncSettingsWalkSlider,
  applyWalkingRadiusGesture,
  normalizeWheelPixels,
  updateNearbyRadiusWheel,
  endNearbyRadiusWheel,
  zoomInputResizesNearbyRadius,
  startNearbyRadiusGesture,
  updateNearbyRadiusGesture,
  endNearbyRadiusGesture,
  WHEEL_RADIUS_RATE_PER_PIXEL,
  TRACKPAD_PINCH_RATE_MULTIPLIER,
  WALKING_RADIUS_PRESET_MINUTES,
  WALKING_RADIUS_MIN_MINUTES,
  WALKING_RADIUS_TIGHT_MIN_MINUTES,
  WALKING_RADIUS_MAX_MINUTES,
  keepOverviewCenteredOnUser,
  centerOverviewOnUserLocation,
  setInspectorMinimized,
  maxScaleForRadiusVisible,
  bestVisibleCanvasRect,
  walkingRadiusCirclePoints,
  drawWalkingRadius,
  nearbyUserCone,
  selectOverview,
  ensureOverviewTargetsVisible,
  alignHeadingUpNavigationViewport,
  maxScaleForHeadingUpPoints,
  maxHeadingUpNavigationScale,
  headingUpFitMarginPx,
  headingUpFitTiltCamera,
  resolveHeadingUpTargetScale,
  resolveHeadingUpAnchorFraction,
  TILT_FIT_MIN_PERSPECTIVE_SCALE,
  HEADING_UP_SCALE_BUFFER_RATIO,
  HEADING_UP_SCALE_SETTLE_RATIO,
  HEADING_UP_SCALE_EASE_RATE,
  HEADING_UP_SCALE_EASE_MAX_DT,
  HEADING_UP_SCALE_HOLD_RATIO,
  HEADING_UP_SCALE_SNAP_RATIO,
  HEADING_UP_SCALE_EASE_OUT_RATE,
  HEADING_UP_ANCHOR_HOLD_RATIO,
  HEADING_UP_POSITION_PX_THRESHOLD,
  maxNearbyHeadingUpScale,
  nearbyFirstPersonFitZoom,
  NEARBY_TILT_FIT_ZOOM,
  nearbyCameraFitPoints,
  nearestSelectedFilterPoints,
  walkingRadiusWorldUnits,
  selectedNavigationTargetPoints,
  selectedNavigationTargetBearingOffsetRadians,
  animateToHeadingUpNavigationViewport,
  resizeCanvas,
  prepareCanvasForDraw,
  stopViewportAnimation,
  updateHeadingUpCanvasRotationTransform,
  startCompassSmoothing,
  nearbyHeadingUpActive,
  headingUpActive,
  selectedNavigationHeadingUpActive,
  nearbyNavigationAnchorActive,
  navigationAnchorActive,
  nearbyNavigationFocusPoint,
  navigationFocusPoint,
  nearbyHeadingUpFocusY,
  tiltActive,
  tiltAllowedForCurrentScreen,
  isOverviewScreenActive,
  secondaryScreenActive,
  tiltRotateXDeg,
  tiltRenderStale,
  TILT_RENDER_STALE_DEG,
  tiltAnchorFraction,
  headingUpAnchorFraction,
  tiltRampedAnchor,
  tiltAvailableAheadCssPx,
  tiltPerspectivePx,
  isBehindTiltHeading,
  tiltPinScale,
  worldToScreenForOverlayTilted,
  metresPerWorldUnit,
  metresToWorldUnits,
  projectCanvasPoint,
  rawWorldToScreen,
  tiltHorizonCanvasY,
  tiltFarClipCssPx,
  buildNearbyIconLookup,
  isNearCanvas,
  findHit,
  focusNearbyOnMapPoint,
  isOutsideNearestArea,
  updateNearbyAnchorBar,
  nearbyRenderOriginPoint,
  nearbyOriginTransitionActive,
  nearbyRevealOpacity,
  nearbyRevealInProgress,
  NEARBY_REVEAL_MS,
  cameraOriginPoint,
  tiltHidesWhatIsBehind,
  tiltProjection,
  drawUserRadarOverlayTilted,
  drawUser,
  worldToScreenForOverlayTilted,
  worldToScreenFlat,
  projectCanvasPoint,
  handleMapClick,
  startCameraOriginTransition,
  distanceFromUserToRoad,
  nearbyOrigin,
  setNearbyAnchor,
  clearNearbyAnchor,
  focusNearbyWithinWalkMinutes,
  roadNavTarget,
  selectedCompassTarget,
  showRoadDetails,
  landmarkEmoji,
  landmarkIconSlug,
  iconPath,
  appIconHtml,
  matchesPlaceFilter,
  placePrimaryFilterKey,
  placeIconSlug,
  placeLabelFilterKey,
  resolvePlaceKind,
  FILTER_SUBFILTERS_BY_KEY,
  nearestTreeTo,
  nearestCowTo,
  nearbySectionsHtml,
  detailsHtml,
  nearbyWithinWalkHtml,
  showsEverythingFromQuery,
  nearbyAnchorRouteValue,
  nearbyCardFilterKeys,
  nearbyCountCopy,
  openInMapsHtml,
  shareLocationHtml,

  filterKindIconSlug,
  PLACE_FILTER_KEYS,
  PLACE_FILTER_PRIORITY,
  PLACE_FILTER_FALLBACK_PRIORITY,
  PLACE_FILTER_TOPIC_PRIORITY,
  DEFAULT_FILTERS,
  normalizeEventLocations,
  eventTimeWindow,
  isEventLive,
  isEventPast,
  isEventTooFarAhead,
  EVENT_SHOW_AHEAD_MS,
  isEventCategory,
  formatEventWhen,
  eventStatusLabel,
  eventAlertEnabled,
  checkEventProximityAlert,
  showEventNearbyBanner,
  hideEventNearbyBanner,
  openEventNearbyBanner,
  placeHashKey,
  findPlaceByHashKey,
  focusOverviewItem,
  treeSpeciesIconHtml,
  placeTitle,
  ICON_PATHS,
  FILTER_GROUPS,
  worldToScreen,
  screenToWorld,
  pixelRatio,
  mapEmojiScale,
  MAP_PNG_ICON_SIZE,
  MAP_ICON_SCALE_UNSELECTED,
  CLUSTER_RADIUS_ICON_SIZE_REF,
  MEGA_CLUSTER_MERGE_RADIUS_CSS_PX,
  buildTypeClusters,
  clusterTreeIconSrc,
  buildSuperClusters,
  drawMegaClusters,
  clusterJoinAnimationState,
  settleClusterJoinAnimations,
  drawLandmarkIcon,
  CLUSTER_JOIN_ANIMATION_MS,
  CLUSTER_JOIN_COOLDOWN_MS,
  CLUSTER_JOIN_MIN_SCALE,
  cacheVersionLabel,
  selectedNavigationTargetPoints,
  balancedNavigationAnchorY,
  ingestLocationFix,
  advanceLocationGlide,
  LOCATION_GLIDE_EPSILON,
  LOCATION_SMOOTHING_SNAP_METRES,
  bestVisibleCanvasRect,
  ensureUserAndSelectionVisible,
  refitSelectionAfterRoutingGraphReady,
  settingsFormHtml,
  hasTrackingConsent,
  setTrackingConsent,
  ensureTrackingConsent,
  trackGaItemSelected,
  reportFormHtml,
  reportIssueHtml,
  ledgerMentionHtml,
  openFiltersScreen,
  openSettings,
  openReportModal,
  goToInitialView,
  applySelectionFromHash,
  applyRouteFromUrl,
  syncHashFromSelection,
  setHashFromSelection,
  currentScreenRoute,
  urlMatchesCurrentScreen,
  routerBootFinished,
  initRouter,
  navDepth,
  canGoBackInApp,
  navigateBack,
  setupSearchAndNavHandlers,
  setupInspectorHandlers,
  roadHashKey,
  railwayHashKey,
  findRoadByHashKey,
  findRailwayByHashKey,
  ONBOARDING_STEPS,
  compassStepMarkup,
  compassPermissionRequiresRequest,
  onDeviceOrientation,
  extractCompassHeading,
  registerCompassCalibrationSample,
  isCompassCalibrationStable,
  compassCalibrationSpreadDegrees,
  completeCompassCalibration,
  resetCompassCalibration,
  showCompassCalibrationPrompt,
  hideCompassCalibrationPrompt,
  dismissCompassCalibrationPrompt,
  startCalibrationViewportSync,
  stopCalibrationViewportSync,
  reattachCompassListeners,
  compassSensorStalled,
  recoverStalledCompass,
  hasMovedSinceBackgrounding,
  pauseBackgroundedTracking,
  orientationHeadingSource,
  animationLoopsWedged,
  recoverWedgedAnimationFrames,
  communityRank,
  communityMedalHtml,
  communityWeekDays,
  communityBadgeProgress,
  communityBadgeDetailHtml,
  COMMUNITY_BADGES,
  communityRelativeDay,
  communityPointsChipFor,
  communityNudgeDecision,
  communityPendingScore,
  communityBadges,
  communityMergeRemoteReports,
  communityStreaks,
  communityDisplayScore,
  COMMUNITY_POINTS,
  communityParseRecoveryCode,
  HEADING_SOURCE_NONE,
  HEADING_SOURCE_RELATIVE,
  HEADING_SOURCE_ABSOLUTE,
  ANIMATION_FRAME_WEDGED_MS,
  handleForegroundResume,
  COMPASS_STALE_MS,
  COMPASS_HEADINGLESS_PROMPT_MS,
  SENSOR_WATCHDOG_INTERVAL_MS,
  location: window.location,
  history,
  windowStub: window,
  documentStub: document,
};
`;

  vm.createContext(context);

  const rootDir = path.join(__dirname, "..");
  const externalScripts = ["js/app-cache-version.js", "js/data-cache-version.js", "js/categories.js", "js/normalize.js", "js/tracker.js", "js/outbox.js", "js/community.js", "js/onboarding.js", "js/nav.js", "js/routing.js", "js/loader.js", "js/icon-motion.js", "js/renderer.js", "js/inspector.js"];
  for (const externalSrc of externalScripts) {
    const externalPath = path.join(rootDir, externalSrc);
    if (fs.existsSync(externalPath)) {
      vm.runInContext(fs.readFileSync(externalPath, "utf8"), context, { filename: externalSrc });
    }
  }

  vm.runInContext(script, context, { filename: "js/app.js" });
  const api = context.__forestFindsTest;

  // boot() is stripped from the source these tests run, so do the two things it does to the
  // router: give the landing entry a depth, and declare boot over -- until then the router
  // deliberately suppresses every URL write, so nothing would ever reach the history stub.
  api.initRouter();
  api.routerBootFinished();

  // The default element stub reports the full 1000x800 stage for every element, which made
  // els.inspector overlap the ENTIRE canvas. bestVisibleCanvasRect() then had no uncovered
  // region to return and handed back a zero-height rect, so every viewport fit computed
  // against a 0px-tall focus area and produced garbage (or bailed out entirely). Tests only
  // appeared to work when an earlier test happened to leave the geometry in a usable state.
  //
  // Model the real bottom-sheet instead: open, it covers the lower ~48% of the stage (the
  // figure the inspector-open test below already assumed in a comment); minimized, it is
  // effectively off the canvas and leaves the whole stage visible.
  const STAGE_WIDTH = 1000;
  const STAGE_HEIGHT = 800;
  if (api.els.inspector) {
    api.els.inspector.getBoundingClientRect = function inspectorRect() {
      const height = this.classList.contains("minimized") ? 0 : STAGE_HEIGHT * 0.48;
      return {
        left: 0,
        top: STAGE_HEIGHT - height,
        right: STAGE_WIDTH,
        bottom: STAGE_HEIGHT,
        width: STAGE_WIDTH,
        height,
      };
    };
  }

  // The nav bar is its own fixed bottom bar now (see app.html), not part of #inspector, and
  // stays visible regardless of the sheet's own open/minimized state -- so it always obstructs
  // a thin strip at the very bottom of the stage. Modelled the same way as the sheet rect above:
  // without this override the default full-stage stub would make inspectorCanvasOverlapRect's
  // union cover the whole canvas again (see the comment on els.inspector above).
  const NAV_BAR_HEIGHT = 74;
  if (api.els.inspectorActions) {
    api.els.inspectorActions.getBoundingClientRect = function navRect() {
      return {
        left: 0,
        top: STAGE_HEIGHT - NAV_BAR_HEIGHT,
        right: STAGE_WIDTH,
        bottom: STAGE_HEIGHT,
        width: STAGE_WIDTH,
        height: NAV_BAR_HEIGHT,
      };
    };
  }

  return api;
}

function makePoint(app, latitude, longitude) {
  return {
    latitude,
    longitude,
    point: app.projectLonLat(longitude, latitude),
  };
}

// Puts the app back on the plain Nearby screen. Used by tests that walk the same assertion
// across every screen that draws the walking-radius ring behind it (Filters, Settings, Report,
// Search), which differ only in which one of these four flags is set.
function resetSecondaryScreens(app) {
  app.state.selected = null;
  app.state.filterScreenOpen = false;
  app.state.searchScreenOpen = false;
}

function resetData(app) {
  app.state.trees = [];
  app.state.cows = [];
  app.state.landmarks = [];
  app.state.paths = [];
  app.state.selected = null;
  app.state.roads = [];
  app.state.nearbyAnchor = null;
  app.state.nearbyOriginTransition = null;
  app.state.cameraOriginTransition = null;
  app.state.clusterExpanded = null;
  app.state.clusterZoomed = false;
  app.state.overviewFilters = [];
  app.state.overviewFiltersEphemeral = false;
  app.state.walkingDistanceMinutes = 5;
  app.state.showAllOutsideRadius = false;
  app.state.overviewOutsideRadiusFallback = false;
  app.state.transportLookupCache = new Map();
  app.state.transportLookupRequests = new Map();
  app.state.filterScreenOpen = false;
  app.state.searchScreenOpen = false;
  app.state.searchQuery = "";
  app.state.viewport = { scale: 1000, tx: 500, ty: 400 };
  // Realistic "whole forest fit" scale -- not read by the heading-up zoom ceiling itself
  // any more (that's the walking radius now, see maxNearbyHeadingUpScale), but still used
  // elsewhere (fitToPoints' minScale floor, renderer.js zoom-level calculations). Both fields
  // start out equal, matching real boot (fitToBounds() sets them together).
  app.state.fitScale = 10000;
  app.state.baseFitScale = 10000;
  app.state.viewportAnimationFrame = null;
  app.state.viewportAnimationFrom = null;
  app.state.viewportAnimationTo = null;
  app.state.viewportAnimationStartTime = null;
  app.state.viewportAnimationDuration = 0;
  app.state.dataLoaded = true;
  app.state.selectionViewportTransitionPending = false;
  app.state.headingUpEntryAnim = null;
  app.state.renderedNavigationHeading = null;
  // resetData simulates an app already well past first load, so heading-up activations here
  // animate in as normal; the "very first activation this session snaps instead" behaviour
  // (see animateToHeadingUpNavigationViewport) gets its own dedicated tests that set this back
  // to false.
  app.state.headingUpEverEntered = true;
  app.state.backgroundedUserLocation = null;
  app.state.compassHeading = null;
  app.state.compassHeadingTarget = null;
  app.state.nearbyListHeading = null;
  app.state.compassCalibrationSamples = [];
  app.state.compassCalibrationStartedAt = null;
  app.state.compassCalibrationPromptVisible = false;
  app.state.compassCalibrationPromptDismissed = false;
  app.state.compassLastEventAt = null;
  app.state.orientationLastEventAt = null;
  if (app.els.compassCalibrationBanner) app.els.compassCalibrationBanner.hidden = true;
  // Cancel any real-timer-backed calibration sync loop a previous test left running --
  // otherwise it keeps firing (and, worse, keeps rescheduling itself) against this test's
  // freshly-reset state instead of stopping, since resetData nulls compassCalibrationStartedAt
  // (defusing its own safety-valve check) without this.
  app.stopCalibrationViewportSync();
  app.state.tiltBetaSmoothed = 0;
  app.state.tiltBetaTarget = 0;
  // The scale ease integrates against this timestamp (resolveHeadingUpTargetScale); a value
  // left behind by an earlier test would be read as a real frame delta by the next one.
  app.state.headingUpScaleEaseAt = null;
  app.state.tiltWasActive = false;
  app.state.canvasInsetX = 0;
  app.state.canvasInsetY = 0;
  app.state.canvasVisibleWidth = 1000;
  app.state.canvasVisibleHeight = 800;
  app.els.inspector.classList.remove("minimized");
  // Several tests below hide the inspector (and the nav bar alongside it) to take their geometry
  // out of the picture and never put it back; without this that leaks into every later test,
  // silently removing the inspector/nav overlap from their fits.
  app.els.inspector.hidden = false;
  app.els.inspectorActions.hidden = false;
  app.els.canvas.width = 1000;
  app.els.canvas.height = 800;
  app.location.hash = "";
  // Restore the stage/canvas stub geometry too: a test further down deliberately resizes
  // els.mapStage to 1800x2600, and resizeCanvas() below reads exactly that to derive
  // state.canvasVisibleWidth/Height -- so without this, every later test inherits it.
  app.els.canvas.clientWidth = 1000;
  app.els.canvas.clientHeight = 800;
  if (app.els.mapStage) {
    app.els.mapStage.clientWidth = 1000;
    app.els.mapStage.clientHeight = 800;
  }
  // resizeCanvas() is what clears the memoized inspector-overlap rect (_overlapRectCache), so
  // call it once this test's inspector/canvas state is set. Without it, bestVisibleCanvasRect()
  // can keep handing back geometry cached during a previous test, which is how several viewport
  // tests ended up order-dependent.
  app.resizeCanvas();
}

// The heading-up anchor is defined as a fraction of the INSPECTOR-FREE area
// (navigationFocusPoint = focusRect.y + focusRect.height * headingUpAnchorFraction), not of the
// whole canvas. With the inspector open -- which is resetData's default, matching the real
// nearby view -- those are very different denominators, so measure against the same rect the
// implementation fits to.
// Seeds the viewport at `scale` but already centred on the heading-up anchor, so the only
// thing a re-fit could still change is zoom. The anchor is a fraction of the inspector-free
// area, so hardcoding tx/ty here would bake in one particular inspector geometry and turn a
// zoom-deferral test into a re-centring test.
function seedViewportAtHeadingUpAnchor(app, scale) {
  const focus = app.nearbyNavigationFocusPoint();
  const point = app.state.userLocation.point;
  app.state.viewport = { scale, tx: focus.x - point.x * scale, ty: focus.y - point.y * scale };
  return { ...app.state.viewport };
}

function userAnchorFractionOfVisibleArea(app) {
  const rect = app.bestVisibleCanvasRect();
  const userScreen = app.worldToScreen(app.state.userLocation.point);
  return (userScreen.y - rect.y) / rect.height;
}

function addFixtureData(app) {
  app.state.trees.push({
    id: "tree-1",
    commonName: "Far tree",
    ...makePoint(app, 0.1, 0),
  });
  app.state.cows.push({
    serialNo: "cow-1",
    ...makePoint(app, 0.11, 0),
  });
  app.state.landmarks.push(
    { id: "pub-1", name: "Far pub", category: "pub", ...makePoint(app, 0.12, 0) },
    { id: "cafe-1", name: "Far cafe", category: "cafe", ...makePoint(app, 0.13, 0) },
    { id: "bus-1", name: "Far bus stop", category: "bus_stop", ...makePoint(app, 0.14, 0) }
  );
}

// Tests are registered here in file order and actually run by
// runRegisteredTests() at the bottom of this file, one at a time, each
// fully awaited before the next starts -- see that function for why.
const registeredTests = [];

// TEST_FILTER runs only the tests whose name contains the given text
// (case-insensitive), so a change to one area can be checked without waiting on
// -- or reading the output of -- all 251. It is a development aid only, never a
// substitute for the full run: every test here shares the one `app` instance
// below, so a filtered subset starts from whatever state the skipped tests would
// have left behind. The full suite stays the gate for finishing a task.
const TEST_FILTER = (process.env.TEST_FILTER || "").toLowerCase();

// Passing tests print a dot rather than a line each, because the full names of
// 251 passing tests are ~250 lines of output nobody reads (and, under
// `node --test`, ~270 lines of captured diagnostics). Failures still print in
// full, and TEST_VERBOSE=1 restores the per-test lines.
const TEST_VERBOSE = process.env.TEST_VERBOSE === "1";

function test(name, fn) {
  registeredTests.push({ name, fn });
}

async function runRegisteredTests() {
  const selected = TEST_FILTER
    ? registeredTests.filter(({ name }) => name.toLowerCase().includes(TEST_FILTER))
    : registeredTests;

  if (TEST_FILTER && selected.length === 0) {
    console.error(`no test matches TEST_FILTER="${process.env.TEST_FILTER}"`);
    process.exitCode = 1;
    return;
  }

  let passed = 0;
  for (const { name, fn } of selected) {
    try {
      // Always await, even for a synchronous fn() (awaiting a non-promise
      // is a harmless no-op). Previously test() called fn() without
      // awaiting it: a synchronous test's assertions still ran to
      // completion immediately since JS executes them inline, but an
      // async test's code after its first `await` did NOT -- it kept
      // running in the background while every later test() call in this
      // file executed synchronously in the meantime. Since this file runs
      // every test against one shared `app` instance with no per-test
      // isolation, that let a later test's state changes land in the
      // middle of an earlier async test's still-pending assertions,
      // occasionally failing them (e.g. the routing-graph test below,
      // whose real 50ms setTimeout gave dozens of later synchronous tests
      // a chance to overwrite app.state.roads/paths/selected/userLocation
      // before its post-await assertions ran).
      await fn();
      passed += 1;
      if (TEST_VERBOSE) console.log(`ok - ${name}`);
      else process.stdout.write(".");
    } catch (error) {
      if (!TEST_VERBOSE) process.stdout.write("\n");
      console.error(`not ok - ${name}`);
      throw error;
    }
  }

  if (!TEST_VERBOSE) process.stdout.write("\n");
  const skipped = registeredTests.length - selected.length;
  console.log(`# ${passed} passed${skipped ? `, ${skipped} filtered out` : ""}`);
}

const app = loadAppForTests();

test("a mega badge's displayed count is exactly what was merged into it, not a separate radius scan", () => {
  const fakeCluster = (id, x, n) => ({
    items: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}` })),
    screenPt: { x, y: 0 },
    worldPt: { x: 0, y: 0 },
  });
  // Two clusters close enough to merge into one mega badge -- 3 trees and 2 landmarks, so the
  // badge should read "5", never some other number from an unrelated nearby-list scan.
  const megaGroups = app.buildSuperClusters([
    { itemType: "tree", clusters: [fakeCluster("tree", 0, 3)] },
    { itemType: "landmark", clusters: [fakeCluster("landmark", 1, 2)] },
  ]);
  assert.equal(megaGroups.length, 1, "the two clusters merge into a single mega group");
  assert.equal(megaGroups[0].reduce((n, m) => n + m.cluster.items.length, 0), 5);

  const texts = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {},
    arc() {}, fill() {}, stroke() {}, lineTo() {}, moveTo() {}, drawImage() {},
    createRadialGradient() { return { addColorStop() {} }; },
    fillText(text) { texts.push(text); },
  };
  app.drawMegaClusters(ctx, megaGroups);
  assert.deepEqual(texts, ["5"], "the badge shows the raw number of items merged into it");
});

test("a tree cluster's icon is the shared species only when every member agrees", () => {
  const oak = { commonName: "English oak", latinName: "Quercus robur" };
  const anotherOak = { commonName: "Pedunculate oak", latinName: "Quercus robur" };
  const beech = { commonName: "Common beech", latinName: "Fagus sylvatica" };
  assert.equal(app.clusterTreeIconSrc([oak, anotherOak]), app.ICON_PATHS["tree-english-oak"],
    "a cluster of same-species trees still shows that species' own icon");
  assert.equal(app.clusterTreeIconSrc([oak, oak, beech]), app.ICON_PATHS["tree"],
    "a cluster mixing oaks and a beech must not draw as a plain oak -- the generic tree icon doesn't claim a species the cluster isn't");
});

test("buildSuperClusters does not chain far-apart clusters into one mega cluster", () => {
  const dpr = app.pixelRatio();
  const radius = app.MEGA_CLUSTER_MERGE_RADIUS_CSS_PX * dpr * (app.MAP_PNG_ICON_SIZE / app.CLUSTER_RADIUS_ICON_SIZE_REF);
  const fakeCluster = (id, x) => ({ items: [{ id }], screenPt: { x, y: 0 }, worldPt: { x: 0, y: 0 } });
  // Four single-item clusters in a line, each just inside merge radius of its
  // immediate neighbour (0.6 * radius apart) but the first and last four times
  // that -- far outside the merge radius of one another.
  const a = fakeCluster("a", 0);
  const b = fakeCluster("b", radius * 0.6);
  const c = fakeCluster("c", radius * 1.2);
  const d = fakeCluster("d", radius * 1.8);

  const superClusters = app.buildSuperClusters([{ itemType: "tree", clusters: [a, b, c, d] }]);

  const groupOf = (cluster) => superClusters.find(group => group.some(member => member.cluster === cluster));
  assert.notEqual(groupOf(a), groupOf(d), "the first and last cluster in the chain must not end up merged together");
  assert.ok(superClusters.length > 1, "a long, roughly-uniform run of clusters must not collapse into a single mega cluster");
  // Directly-close pairs still merge: this isn't a regression to "never merge anything".
  assert.equal(groupOf(a), groupOf(b), "clusters within the merge radius of each other still merge");
});

test("clusterJoinAnimationState leaves a lone pin undisturbed", () => {
  const lone = { point: { x: 0, y: 0 } };
  const cluster = { items: [lone], screenPt: { x: 0, y: 0 } };
  assert.equal(app.clusterJoinAnimationState(cluster, 1000), null,
    "a single-item cluster never animates -- there is nothing merging into it");
});

test("clusterJoinAnimationState shrinks two newly-merged pins away while the badge grows in, then settles", () => {
  const first = { point: { x: -10, y: 0 } };
  const second = { point: { x: 10, y: 0 } };
  // Both items must first be seen as lone pins (cluster size 1) before a merge into them counts
  // as a join -- otherwise their very first frame would look like an animation with nothing to
  // shrink away from.
  app.clusterJoinAnimationState({ items: [first], screenPt: first.point }, 0);
  app.clusterJoinAnimationState({ items: [second], screenPt: second.point }, 0);

  const merged = { items: [first, second], screenPt: { x: 0, y: 0 } };
  const atStart = app.clusterJoinAnimationState(merged, 0);
  assert.ok(atStart, "two pins that just merged animate rather than snapping straight to a settled badge");
  assert.equal(atStart.shrinking.length, 2, "both newly-joined items are still shrinking away");
  assert.equal(atStart.badgeScale, app.CLUSTER_JOIN_MIN_SCALE,
    "a cluster forming from scratch starts its badge at the floor scale, not popped in at full size");
  const firstShrink = atStart.shrinking.find(r => r.item === first);
  assert.equal(firstShrink.scale, 1, "at t=0 the shrinking pin is still drawn at its own, full, pre-merge size");

  const halfway = app.clusterJoinAnimationState(merged, app.CLUSTER_JOIN_ANIMATION_MS / 2);
  const halfwayShrink = halfway.shrinking.find(r => r.item === first);
  assert.ok(halfwayShrink.scale > 0 && halfwayShrink.scale < 1, "midway through, the pin has shrunk partway toward nothing");
  assert.ok(halfway.badgeScale > 0 && halfway.badgeScale < 1, "the badge is partway through growing in");

  const settled = app.clusterJoinAnimationState(merged, app.CLUSTER_JOIN_ANIMATION_MS + 1);
  assert.equal(settled, null, "once the animation finishes, the cluster draws as an ordinary settled badge");
});

test("clusterJoinAnimationState only animates the item that's actually joining an existing cluster", () => {
  const veteran1 = { point: { x: -10, y: 0 } };
  const veteran2 = { point: { x: 10, y: 0 } };
  const newcomer = { point: { x: 0, y: 10 } };
  const pairCluster = { items: [veteran1, veteran2], screenPt: { x: 0, y: 0 } };
  // Settle the pair into an established, non-animating cluster first.
  app.clusterJoinAnimationState(pairCluster, 0);
  app.clusterJoinAnimationState(pairCluster, app.CLUSTER_JOIN_ANIMATION_MS + 1);
  app.clusterJoinAnimationState({ items: [newcomer], screenPt: newcomer.point }, app.CLUSTER_JOIN_ANIMATION_MS + 1);

  const grown = { items: [veteran1, veteran2, newcomer], screenPt: { x: 0, y: 3 } };
  const state = app.clusterJoinAnimationState(grown, app.CLUSTER_JOIN_ANIMATION_MS + 2);
  assert.ok(state, "the newcomer joining triggers an animation");
  assert.equal(state.shrinking.length, 1, "only the newly-joined item animates, not the two already-settled members");
  assert.equal(state.shrinking[0].item, newcomer);
  assert.equal(state.badgeScale, 1,
    "an existing cluster's badge stays at full size while a new member shrinks away into it -- it doesn't regrow");
});

test("stopViewportAnimation settles any in-flight cluster-join animation instead of leaving it to run against a now-unmoving camera", () => {
  const first = { point: { x: -10, y: 0 } };
  const second = { point: { x: 10, y: 0 } };
  app.clusterJoinAnimationState({ items: [first], screenPt: first.point }, 0);
  app.clusterJoinAnimationState({ items: [second], screenPt: second.point }, 0);

  const merged = { items: [first, second], screenPt: { x: 0, y: 0 } };
  const midFlight = app.clusterJoinAnimationState(merged, 0);
  assert.ok(midFlight, "sanity check: the merge is genuinely still animating before the camera stops");

  // This is the exact pattern several e2e specs use to force a deterministic frame before a
  // screenshot: stop whatever camera animation is running, then draw once. Without settling the
  // pin-level animation too, the very next call here -- at the same instant, same camera -- would
  // still report items mid-shrink, which is what made those screenshots flaky: the "settled"
  // frame could still differ depending on exactly when the interruption landed relative to
  // CLUSTER_JOIN_ANIMATION_MS.
  app.stopViewportAnimation();
  const afterStop = app.clusterJoinAnimationState(merged, 0);
  assert.equal(afterStop, null,
    "once the camera animation is stopped, the same cluster at the same instant draws fully settled, not mid-shrink");
});

test("drawLandmarkIcon runs every image-icon category branch without a stale reference to a removed constant", () => {
  // A regression guard: BEER_ICON_SCALE was removed from the top of renderer.js (main's "beer
  // bump" simplification), but one usage inside this function survived a merge untouched since
  // it sat just outside the textual conflict -- a ReferenceError at runtime that neither
  // node --check nor any other unit test caught, because nothing here had ever called this
  // function with a pub place. Exercising every PNG-icon and emoji-fallback branch at least
  // once is cheap insurance against the same class of silent, merge-orphaned reference anywhere
  // in this chain. The underground/national_rail branches draw an SVG glyph via a global Path2D
  // this test harness has no stub for -- a separate, pre-existing gap, not this bug's -- so
  // they're left for the e2e suite to cover.
  const ctx = createElementStub().getContext();
  const places = [
    { category: "pub" },
    { category: "cafe" },
    { category: "convenience" },
    { category: "bus_stop" },
    { category: "parking" },
    { category: "unknown_place_with_no_special_handling" },
  ];
  for (const place of places) {
    assert.doesNotThrow(() => app.drawLandmarkIcon(ctx, place, 0, 0, 30),
      `drawLandmarkIcon must not throw for category "${place.category}"`);
  }
});

test("ICON_PATHS is the single registry for all icon slugs", () => {
  const { ICON_PATHS: icons } = app;
  const iconDir = path.join(__dirname…133514 tokens truncated…it withStubbedGithub(
    (url) => (url.includes("/search/issues") ? jsonResponse(200, { items: [] }) : jsonResponse(201, { number: 1, html_url: "https://github.com/x/y/issues/1" })),
    async (handler, calls) => {
      const send = (n) => handler({ ...placeCheckEvent({ deviceId: "device-flood-0001", requestId: `req-flood-${n}`, placeCheck: { status: "CLOSED", key: `place:id:${n}`, name: "x" } }), headers: {} });
      for (let n = 0; n < reportRateLimit.DEFAULT_LIMITS.perDevice; n += 1) assert.equal((await send(n)).statusCode, 200);
      const refused = await send(99);
      assert.equal(refused.statusCode, 429);
      assert.ok(Number(refused.headers["Retry-After"]) > 0);
      const issuesBefore = calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues")).length;
      await send(100);
      assert.equal(calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues")).length, issuesBefore, "a refused report creates no issue");
    }
  );
});

test("a network is capped by its address however many device ids it invents, and the whole site by the global cap", async () => {
  await withStubbedGithub(
    (url) => (url.includes("/search/issues") ? jsonResponse(200, { items: [] }) : jsonResponse(201, { number: 1, html_url: "u" })),
    async (handler) => {
      const fromIp = (ip, n) => handler({ ...placeCheckEvent({ deviceId: `device-${ip.replace(/\./g, "")}-${String(n).padStart(4, "0")}`, requestId: `req-ip-${ip}-${n}`, placeCheck: { status: "CLOSED", key: `place:id:${n}`, name: "x" } }), headers: { "x-nf-client-connection-ip": ip } });
      for (let n = 0; n < reportRateLimit.DEFAULT_LIMITS.perIp; n += 1) assert.equal((await fromIp("203.0.113.9", n)).statusCode, 200);
      assert.equal((await fromIp("203.0.113.9", 500)).statusCode, 429, "fresh device ids do not get past the address cap");
      assert.equal((await fromIp("203.0.113.10", 0)).statusCode, 200, "another address is unaffected");
    }
  );
  const original = process.env.REPORT_LIMIT_GLOBAL;
  process.env.REPORT_LIMIT_GLOBAL = "2";
  try {
    await withStubbedGithub(
      (url) => (url.includes("/search/issues") ? jsonResponse(200, { items: [] }) : jsonResponse(201, { number: 1, html_url: "u" })),
      async (handler) => {
        const one = (ip, n) => handler({ ...placeCheckEvent({ deviceId: `device-glob-${n}-aaaa`, requestId: `req-glob-${n}`, placeCheck: { status: "CLOSED", key: `place:id:${n}`, name: "x" } }), headers: { "x-nf-client-connection-ip": ip } });
        assert.equal((await one("198.51.100.1", 1)).statusCode, 200);
        assert.equal((await one("198.51.100.2", 2)).statusCode, 200);
        assert.equal((await one("198.51.100.3", 3)).statusCode, 429, "the site-wide cap stops new addresses too");
      }
    );
  } finally {
    if (original === undefined) delete process.env.REPORT_LIMIT_GLOBAL; else process.env.REPORT_LIMIT_GLOBAL = original;
  }
});

test("the rate limit resets each hour, ignores a missing ip or device, and lets reports through if the store fails", async () => {
  const store = escalationStoreForReports();
  const limits = { perIp: 1, perDevice: 1, global: 5 };
  const hour = 3600000;
  assert.equal((await reportRateLimit.checkRateLimit(store, { ip: "1.1.1.1", deviceId: "d1", now: 10 * hour, limits })).ok, true);
  assert.equal((await reportRateLimit.checkRateLimit(store, { ip: "1.1.1.1", deviceId: "d2", now: 10 * hour + 5, limits })).ok, false);
  assert.equal((await reportRateLimit.checkRateLimit(store, { ip: "1.1.1.1", deviceId: "d1", now: 11 * hour, limits })).ok, true, "a new hour starts clean");
  assert.equal((await reportRateLimit.checkRateLimit(store, { now: 12 * hour, limits })).ok, true, "no ip and no device: only the global cap applies");
  const broken = { async get() { throw new Error("down"); }, async put() { throw new Error("down"); } };
  assert.equal((await reportRateLimit.checkRateLimit(broken, { ip: "1.1.1.1", deviceId: "d1", limits })).ok, true);
  assert.equal(reportRateLimit.clientIp({ headers: { "X-Nf-Client-Connection-Ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" } }), "9.9.9.9");
  assert.equal(reportRateLimit.clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }), "1.2.3.4");
  assert.equal(reportRateLimit.clientIp({}), "");
});

test("the per-place label is created before the issue, and a label that fails does not stop the report", async () => {
  await withStubbedGithub(
    (url, method) => {
      if (url.includes("/search/issues")) return jsonResponse(200, { items: [] });
      if (url.endsWith("/labels")) return jsonResponse(500, {});
      return jsonResponse(201, { number: 5, html_url: "https://github.com/x/y/issues/5" });
    },
    async (handler, calls) => {
      const result = await handler(placeCheckEvent({ placeCheck: { status: "CLOSED", key: "place:id:manual/onest", name: "Onest" } }));
      assert.equal(result.statusCode, 200);
      const labelAt = calls.findIndex((c) => c.method === "POST" && c.url.endsWith("/labels"));
      const issueAt = calls.findIndex((c) => c.method === "POST" && c.url.endsWith("/issues"));
      assert.ok(labelAt >= 0 && labelAt < issueAt, "the label is created first");
      assert.equal(calls[labelAt].body.name, "place:manual/onest");
    }
  );
});

test("ids that mean something to JavaScript are refused, and cannot reach Object.prototype", async () => {
  for (const bad of ["__proto__", "constructor", "prototype"]) {
    assert.ok(communityConsensus.validateReport(communityReport({ deviceId: bad })), `deviceId ${bad} is refused`);
    assert.ok(communityConsensus.validateReport(communityReport({ id: bad })), `id ${bad} is refused`);
  }
  assert.ok(communityConsensus.validateReport(communityReport({ kind: "__proto__" })));
  assert.ok(communityConsensus.validateReport(communityReport({ status: "constructor" })));
  assert.ok(communityConsensus.validateReport(communityReport({ target: "__proto__" })));
  assert.ok(communityConsensus.validateReport(communityReport({ target: "tree:1 and more" })), "a target has no spaces");
  assert.equal(communityConsensus.validateReport(communityReport({ target: "place:id:node/1" })), null);
  assert.equal(communityConsensus.statusClass("tree", "toString"), null);
  const state = communityConsensus.computeCommunityState([communityReport({ deviceId: "__proto__" }), communityReport({ deviceId: "device-aaaa" })]);
  assert.equal({}.reports, undefined, "Object.prototype is untouched");
  assert.equal(Object.keys(state.scores).includes("__proto__"), false);
  const handler = require("../netlify/functions/community-report").handler;
  const result = await handler({ httpMethod: "POST", body: JSON.stringify({ id: "report-proto-1", deviceId: "__proto__", kind: "tree", target: "tree:1", status: "VERIFIED", targetLat: 51.64, targetLon: 0.01, lat: 51.64, lon: 0.01 }) });
  assert.equal(result.statusCode, 400);
});

test("a new tree's outcome is found under its tag, so a register reward shows as validated", () => {
  const tree = communityReport({ status: "NEW_TREE", target: undefined, tagNumber: "4821", accuracy: 8, lat: 51.65, lon: 0.04, targetLat: 51.65, targetLon: 0.04 });
  assert.equal(communityConsensus.canonicalTarget(tree), "new:tree:tag:4821");
  assert.equal(communityConsensus.canonicalTarget(communityReport({ target: "tree:7" })), "tree:7");
  const validated = new Set(["device-aaaa|new:tree:tag:4821|NEW_TREE"]);
  assert.equal(communityConsensus.reportOutcome(tree, { s: "new" }, [], validated), "validated");
  assert.equal(communityConsensus.reportOutcome(tree, { s: "new" }, [], new Set()), "pending");
  assert.equal(communityConsensus.reportOutcome(tree, { s: "new-confirmed" }, [], new Set()), "confirmed", "a second finder confirms it");
  assert.equal(communityConsensus.reportOutcome(tree, undefined, [], new Set()), "pending");
});

test("a register reward only counts reports made before the last run that still saw the old register", async () => {
  const store = memoryStore();
  const register = (records, generatedAt) => async (path) => {
    if (path.endsWith("index.json")) return { generatedAt, sourceGeneratedAt: generatedAt, recordCount: records.length, chunks: [{ url: "chunk.json" }] };
    return { trees: records.map((r) => ({ recordNumber: r, latitude: 51.64, longitude: 0.01 })) };
  };
  await communityValidation.runValidation({ store, fetchJson: register(["77", "78"], 1), now: 1000 }); // baseline
  const early = communityReport({ id: "report-early-1", target: "tree:77", status: "NOT_HERE", ts: 900 });
  const late = communityReport({ id: "report-late-01", target: "tree:78", status: "NOT_HERE", ts: 2000 });
  await store.put("reports/early", early);
  await store.put("reports/late", late);
  // The register drops both records some time between the runs at 1000 and 3000.
  const summary = await communityValidation.runValidation({ store, fetchJson: register([], 2), now: 3000 });
  assert.equal(summary.newRegisterRewards, 1, "only the report made before the previous run counts");
  const items = (await store.get("validations")).items;
  assert.equal(JSON.stringify(items.map((i) => i.target)), JSON.stringify(["tree:77"]));
});

test("one network cannot mint endless device ids to confirm its own reports: community reports are capped per address and site-wide", async () => {
  const reportEndpoint = require("../netlify/functions/community-report");
  const original = { ip: process.env.COMMUNITY_LIMIT_PER_IP, global: process.env.COMMUNITY_LIMIT_GLOBAL };
  process.env.COMMUNITY_LIMIT_PER_IP = "3";
  process.env.COMMUNITY_LIMIT_GLOBAL = "5";
  reportEndpoint.setStore(memoryStore());
  try {
    const send = (ip, n) => reportEndpoint.handler({
      httpMethod: "POST",
      headers: { "x-nf-client-connection-ip": ip },
      body: JSON.stringify({ id: `report-sybil-${ip}-${n}`.replace(/\./g, ""), deviceId: `device-sybil-${n}-x`, kind: "tree", target: "tree:5", status: "VERIFIED", targetLat: 51.64, targetLon: 0.01, lat: 51.64, lon: 0.01 }),
    });
    for (let n = 0; n < 3; n += 1) assert.equal((await send("203.0.113.7", n)).statusCode, 200);
    const refused = await send("203.0.113.7", 99);
    assert.equal(refused.statusCode, 429, "fresh device ids from the same address do not get past the cap");
    assert.ok(Number(refused.headers["Retry-After"]) > 0);
    assert.equal((await send("203.0.113.8", 1)).statusCode, 200, "another address is unaffected");
    assert.equal((await send("203.0.113.9", 1)).statusCode, 200);
    assert.equal((await send("203.0.113.10", 1)).statusCode, 429, "the site-wide cap stops new addresses too");
    const retry = await send("203.0.113.8", 1);
    assert.equal(retry.statusCode, 200, "a repeat of an accepted report is answered as a duplicate without counting again");
  } finally {
    reportEndpoint.setStore(null);
    for (const [name, value] of [["COMMUNITY_LIMIT_PER_IP", original.ip], ["COMMUNITY_LIMIT_GLOBAL", original.global]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

const communityDelete = require("../netlify/functions/lib/community-delete");

async function deletionFixture() {
  const store = memoryStore();
  const day = "2026-10-20";
  const reportFor = (id, deviceId, target, extra = {}) => communityReport({ id, deviceId, target, ...extra });
  const reports = [
    reportFor("report-a1-0001", "phone-device-a1", "tree:1"),
    reportFor("report-a2-0001", "laptop-device-a2", "tree:2"),
    reportFor("report-b1-0001", "other-device-b1", "tree:1"),
    reportFor("report-b1-0002", "other-device-b1", "tree:2"),
  ];
  for (const r of reports) await store.put(`reports/${r.id}`, r);
  await store.put("mine/phone-device-a1", [{ id: "report-a1-0001", kind: "tree", target: "tree:1", status: "VERIFIED", ts: 1 }, { id: "feedback-a1-001", kind: "feedback", status: "FEEDBACK", issue: 41, ts: 2 }]);
  await store.put("mine/laptop-device-a2", [{ id: "report-a2-0001", kind: "tree", target: "tree:2", status: "VERIFIED", ts: 1 }, { id: "place-a2-00001", kind: "place", status: "CLOSED", issue: 42, ts: 2 }]);
  await store.put("mine/other-device-b1", [{ id: "report-b1-0001", kind: "tree", target: "tree:1", status: "VERIFIED", ts: 1 }, { id: "place-b1-00001", kind: "place", status: "CLOSED", issue: 43, ts: 2 }]);
  await store.put("devicelink/phone-device-a1", { account: "acct-a" });
  await store.put("devicelink/laptop-device-a2", { account: "acct-a" });
  await store.put("accountdevices/acct-a/phone-device-a1", {});
  await store.put("accountdevices/acct-a/laptop-device-a2", {});
  await store.put(`devices/phone-device-a1-${day}`, { n: 1 });
  await store.put(`devices/other-device-b1-${day}`, { n: 2 });
  await store.put("refs/ref-of-a1", { deviceId: "phone-device-a1" });
  await store.put("refs/ref-of-a2", { deviceId: "laptop-device-a2" });
  await store.put("refs/ref-of-b1", { deviceId: "other-device-b1" });
  await store.put("validations", { items: [{ kind: "fix", deviceId: "phone-device-a1", issue: 41 }, { kind: "fix", deviceId: "other-device-b1", issue: 43 }], register: null, processedIssues: {} });
  await communityComputed.rebuildComputed(store);
  return store;
}

const keysWith = (store, prefix) => [...store.data.keys()].filter((k) => k.startsWith(prefix)).sort();

test("a storage failure while listing stops a deletion instead of reporting it done", async () => {
  const store = await deletionFixture();
  const failing = { ...store, get: store.get, put: store.put, delete: store.delete, list: async () => { throw new Error("blobs down"); } };
  await assert.rejects(communityDelete.deleteCommunityData(failing, { deviceId: "phone-device-a1", includeAccount: true }), /blobs down/);
  assert.ok(store.data.has("devicelink/phone-device-a1"), "nothing was removed");
});

test("a failed read of any record a deletion depends on stops it, and nothing is reported deleted", async () => {
  for (const failing of ["reports/", "refs/", "validations", "devicelink/phone-device-a1", "mine/phone-device-a1", "scores/"]) {
    const store = await deletionFixture();
    const broken = { ...store, getStrict: async (key) => { if (key.startsWith(failing)) throw new Error("read failed"); return store.get(key); } };
    await assert.rejects(communityDelete.deleteCommunityData(broken, { deviceId: "phone-device-a1" }), /read failed/, failing);
  }
});

test("deletion finds every issue a device filed, even past the 300-entry mine index cap", async () => {
  const store = await deletionFixture();
  for (let n = 1000; n < 1005; n += 1) await store.put(`issues/phone-device-a1/${n}`, { ts: n });
  await store.put("issues/other-device-b1/2000", { ts: 1 });
  const summary = await communityDelete.deleteCommunityData(store, { deviceId: "phone-device-a1" });
  assert.deepEqual([...summary.issues.pending].sort((a, b) => a - b), [41, 1000, 1001, 1002, 1003, 1004]);
  assert.deepEqual(keysWith(store, "issues/phone-device-a1/"), []);
  assert.deepEqual(keysWith(store, "issues/other-device-b1/"), ["issues/other-device-b1/2000"]);
});

test("deleting one device removes its reports, index, link, counters, references, rewards and score, and nobody else's", async () => {
  const store = await deletionFixture();
  assert.ok((await communityComputed.loadScore(store, "phone-device-a1")).points > 0, "the score exists before");
  const summary = await communityDelete.deleteCommunityData(store, { deviceId: "phone-device-a1" });
  assert.equal(summary.devices, 1);
  assert.equal(summary.reports, 1);
  assert.equal(summary.links, 1);
  assert.equal(summary.refs, 1);
  assert.equal(summary.rewards, 1);
  assert.equal(summary.counters, 1);
  assert.equal(JSON.stringify(keysWith(store, "reports/")), JSON.stringify(["reports/report-a2-0001", "reports/report-b1-0001", "reports/report-b1-0002"]));
  assert.equal(store.data.has("mine/phone-device-a1"), false);
  assert.equal(store.data.has("devicelink/phone-device-a1"), false);
  assert.equal(store.data.has("accountdevices/acct-a/phone-device-a1"), false);
  assert.equal(store.data.has("refs/ref-of-a1"), false);
  assert.equal(JSON.stringify(keysWith(store, "devices/")), JSON.stringify(["devices/other-device-b1-2026-10-20"]));
  assert.equal(JSON.stringify((store.data.get("validations")).items.map((i) => i.deviceId)), JSON.stringify(["other-device-b1"]));
  const score = await communityComputed.loadScore(store, "phone-device-a1");
  assert.equal(score.points, 0, "its score is gone");
  assert.ok((await communityComputed.loadScore(store, "laptop-device-a2")).points > 0, "the account's other device keeps its score");
  assert.ok((await communityComputed.loadScore(store, "other-device-b1")).points > 0, "another person keeps theirs");
  assert.equal(store.data.has("devicelink/laptop-device-a2"), true);
  assert.equal(store.data.has("refs/ref-of-b1"), true);
  assert.deepEqual(summary.issues.pending, [41], "the public issue it filed is handed back to be dealt with");
  const overlay = store.data.get("computed").overlay;
  assert.equal(overlay["tree:1"].n, 1, "tree 1 is now backed by one person, not two");
});

test("deleting with the account removes every device on it and the account's records, and nothing of other accounts", async () => {
  const store = await deletionFixture();
  const summary = await communityDelete.deleteCommunityData(store, { deviceId: "phone-device-a1", includeAccount: true });
  assert.equal(summary.devices, 2);
  assert.equal(summary.reports, 2);
  assert.equal(JSON.stringify(keysWith(store, "accountdevices/")), JSON.stringify([]));
  assert.equal(JSON.stringify(keysWith(store, "devicelink/")), JSON.stringify([]));
  assert.equal(JSON.stringify(keysWith(store, "mine/")), JSON.stringify(["mine/other-device-b1"]));
  assert.equal(JSON.stringify(keysWith(store, "refs/")), JSON.stringify(["refs/ref-of-b1"]));
  assert.equal((await communityComputed.loadScore(store, "laptop-device-a2")).points, 0);
  assert.equal(JSON.stringify(summary.issues.pending.sort()), JSON.stringify([41, 42]), "both devices' public issues, and not the other person's #43");
  const again = await communityDelete.deleteCommunityData(store, { deviceId: "phone-device-a1", includeAccount: true });
  assert.equal(again.reports, 0, "deleting twice is harmless");
});

test("public issues are redacted and closed only when an editor is supplied and asked for, and a failure is reported not hidden", async () => {
  const edits = [];
  const editor = async (number, changes) => { if (number === 42) throw new Error("boom"); edits.push({ number, changes }); };
  const store = await deletionFixture();
  const asked = await communityDelete.deleteCommunityData(store, { deviceId: "phone-device-a1", includeAccount: true, github: editor, redactIssues: true });
  assert.equal(JSON.stringify(asked.issues.redacted), JSON.stringify([41]));
  assert.equal(JSON.stringify(asked.issues.failed), JSON.stringify([42]));
  assert.equal(edits[0].changes.state, "closed");
  assert.equal(edits[0].changes.body, communityDelete.REDACTED_BODY);
  const quiet = await deletionFixture();
  const notAsked = await communityDelete.deleteCommunityData(quiet, { deviceId: "phone-device-a1", github: editor, redactIssues: false });
  assert.equal(JSON.stringify(notAsked.issues.pending), JSON.stringify([41]));
  assert.equal(edits.length, 1, "an editor that was not asked for is never called");
});

test("deletion refuses a bad device id, and the admin endpoint needs the password, POST and an explicit confirmation", async () => {
  await assert.rejects(communityDelete.deleteCommunityData(memoryStore(), { deviceId: "short" }), /device id/);
  await assert.rejects(communityDelete.deleteCommunityData(memoryStore(), {}), /device id/);
  const original = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "admin-secret-1";
  try {
    delete require.cache[require.resolve("../netlify/functions/community-delete")];
    const endpoint = require("../netlify/functions/community-delete");
    const asAdmin = { authorization: "Bearer admin-secret-1" };
    assert.equal((await endpoint.handler({ httpMethod: "POST", headers: {}, body: "{}" })).statusCode, 401);
    assert.equal((await endpoint.handler({ httpMethod: "POST", headers: { authorization: "Bearer nope" }, body: "{}" })).statusCode, 401);
    assert.equal((await endpoint.handler({ httpMethod: "GET", headers: asAdmin })).statusCode, 405);
    assert.equal((await endpoint.handler({ httpMethod: "POST", headers: asAdmin, body: "{nope" })).statusCode, 400);
    const unconfirmed = await endpoint.handler({ httpMethod: "POST", headers: asAdmin, body: JSON.stringify({ deviceId: "phone-device-a1" }) });
    assert.equal(unconfirmed.statusCode, 400);
    assert.match(JSON.parse(unconfirmed.body).error, /confirm/);
    const badId = await endpoint.handler({ httpMethod: "POST", headers: asAdmin, body: JSON.stringify({ deviceId: "x", confirm: "delete" }) });
    assert.equal(badId.statusCode, 400);
  } finally {
    if (original === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = original;
    delete require.cache[require.resolve("../netlify/functions/community-delete")];
  }
});

// --- The City of London discrepancy report (netlify/functions/lib/community-report-data.js) ---
const communityReportData = require("../netlify/functions/lib/community-report-data");
const reportSnapshot = () => communityConsensus.computeCommunityState([
  communityReport({ status: "NOT_HERE", deviceId: "device-aaaa", target: "tree:77", ts: Date.UTC(2026, 9, 1) }),
  communityReport({ status: "NOT_HERE", deviceId: "device-bbbb", target: "tree:77", ts: Date.UTC(2026, 9, 2) }),
  communityReport({ status: "VERIFIED", deviceId: "device-cccc", target: "tree:88", ts: Date.UTC(2026, 9, 2) }),
  communityReport({ status: "NEW_TREE", deviceId: "device-aaaa", target: undefined, kind: "tree", lat: 51.7, lon: 0.03, targetLat: undefined, targetLon: undefined, tagNumber: "T-5", accuracy: 9, ts: Date.UTC(2026, 9, 3) }),
  communityReport({ status: "VERIFIED", deviceId: "device-aaaa", target: "tree:99", ts: 5 }),
  communityReport({ status: "NOT_HERE", deviceId: "device-bbbb", target: "tree:99", ts: 6 }),
]);

test("the discrepancy report lists questioned trees, possible new trees and conflicts, without device ids", () => {
  const state = reportSnapshot();
  const report = communityReportData.buildReportData({ ...state, generatedAt: Date.UTC(2026, 9, 5), reportCount: 6 }, { 77: { tagNumber: "11383", commonName: "English Oak", latinName: "Quercus robur" } }, "https://example.test");
  assert.equal(report.questioned.length, 1);
  assert.equal(report.questioned[0].tagNumber, "11383");
  assert.equal(report.questioned[0].reporters, 2);
  assert.equal(report.questioned[0].lastReported, "2026-10-02");
  assert.equal(report.questioned[0].mapUrl, "https://example.test/nearby#tree=r77");
  assert.equal(report.newTrees.length, 1);
  assert.equal(report.newTrees[0].tagNumber, "T-5");
  assert.equal(report.newTrees[0].confirmed, false);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.verifiedTrees, 1);
  assert.doesNotMatch(JSON.stringify(report), /device-/);
});

test("the report downloads as CSV and GeoJSON, quoting what needs quoting", () => {
  const state = reportSnapshot();
  const report = communityReportData.buildReportData({ ...state, generatedAt: 1, reportCount: 6 }, { 77: { tagNumber: "11,383", commonName: 'Oak "Old"', latinName: "Quercus" } }, "");
  const csv = communityReportData.reportToCsv(report);
  const lines = csv.trim().split("\r\n");
  assert.match(lines[0], /^section,record_number,tag_number/);
  assert.ok(lines.some((line) => line.startsWith('questioned,77,"11,383","Oak ""Old"""')));
  assert.ok(lines.some((line) => line.startsWith("new_tree,,T-5")));
  const geo = communityReportData.reportToGeoJson(report);
  assert.equal(geo.type, "FeatureCollection");
  assert.ok(geo.features.some((f) => f.properties.section === "new_tree" && f.geometry.coordinates[0] === 0.03));
});

test("the report page escapes what it prints and explains an empty report", () => {
  const empty = communityReportData.buildReportData({ overlay: {}, conflictDetails: [], generatedAt: 1, reportCount: 0 }, {}, "");
  const html = communityReportData.renderReportHtml(empty);
  assert.match(html, /No trees have been questioned by two or more people yet/);
  const hostile = communityReportData.buildReportData({ overlay: { "tree:1": { s: "questioned", st: "NOT_HERE", n: 2, t: 1, tlat: 51.6, tlon: 0.1 } }, conflictDetails: [], generatedAt: 1, reportCount: 2 }, { 1: { tagNumber: "<script>x</script>", commonName: "Oak" } }, "");
  const page = communityReportData.renderReportHtml(hostile);
  assert.doesNotMatch(page, /<script>x<\/script>/);
  assert.match(page, /&lt;script&gt;/);
});

test("register records are found by position in the public tree chunks, and a failed fetch just leaves them out", async () => {
  const files = {
    "data/trees/index.json": { chunks: [{ url: "data/trees/a.json", bounds: { minLat: 51.5, maxLat: 51.7, minLon: 0, maxLon: 0.2 } }] },
    "data/trees/a.json": { trees: [{ recordNumber: 77, tagNumber: "11383", commonName: "English Oak", latinName: "Quercus robur", girthMetres: 3.1 }, { recordNumber: 78, tagNumber: "1" }] },
  };
  const found = await communityReportData.lookupRegisterRecords([{ recordNumber: "77", tlat: 51.6, tlon: 0.1 }], async (path) => files[path]);
  assert.equal(found["77"].tagNumber, "11383");
  assert.equal(found["78"], undefined);
  const none = await communityReportData.lookupRegisterRecords([{ recordNumber: "77", tlat: 51.6, tlon: 0.1 }], async () => { throw new Error("offline"); });
  assert.deepEqual(none, {});
});

test("optimistic points mirror the server's configured values for a verify and a new tree", () => {
  assert.equal(app.COMMUNITY_POINTS.verify, communityPointsConfig.POINTS.verify);
  assert.equal(app.COMMUNITY_POINTS.newTree, communityPointsConfig.POINTS.newTree);
});

test("a fresh verify adds a point and a verified count before the server knows", () => {
  const local = { "tree:1": { id: "a", status: "VERIFIED", ts: 1000 } };
  assert.equal(JSON.stringify(app.communityPendingScore(local, 0)), JSON.stringify({ points: 1, verified: 1 }));
  const shown = app.communityDisplayScore({ points: 4, verified: 3, confirmed: 1, generatedAt: 500 }, local, new Set());
  assert.equal(shown.points, 5);
  assert.equal(shown.verified, 4);
  assert.equal(shown.confirmed, 1);
  assert.equal(shown.pendingPoints, 1);
});

test("a new tree adds its point at once, without a verified count", () => {
  assert.equal(JSON.stringify(app.communityPendingScore({ "new:T1": { id: "n", status: "NEW_TREE", ts: 2000 } }, 0)), JSON.stringify({ points: 1, verified: 0 }));
});

test("the optimistic points clear once a score computed after the report arrives", () => {
  const local = { "tree:1": { id: "a", status: "VERIFIED", ts: 1000 } };
  assert.equal(JSON.stringify(app.communityPendingScore(local, 999)), JSON.stringify({ points: 1, verified: 1 }));
  assert.equal(JSON.stringify(app.communityPendingScore(local, 1000)), JSON.stringify({ points: 0, verified: 0 }));
  assert.equal(JSON.stringify(app.communityPendingScore(local, 5000)), JSON.stringify({ points: 0, verified: 0 }));
});

test("a report still in the outbox keeps counting even under a newer score", () => {
  const local = { "tree:1": { id: "a", status: "VERIFIED", ts: 1000 } };
  assert.equal(app.communityPendingScore(local, 5000, new Set(["a"])).points, 1);
});

test("far, failed, place and feedback reports and unconfirmed corrections add no optimistic points", () => {
  const local = {
    "tree:1": { id: "a", status: "VERIFIED", ts: 1000, far: true },
    "tree:2": { id: "b", status: "VERIFIED", ts: 1000, failed: "refused" },
    "place:x": { id: "c", status: "OPEN_CONFIRMED", ts: 1000, kind: "place" },
    "feedback:1": { id: "d", status: "FEEDBACK", ts: 1000, kind: "feedback" },
    "tree:3": { id: "e", status: "NOT_HERE", ts: 1000 },
    "tree:4": { id: "f", status: "MOVED", ts: 1000 },
  };
  assert.equal(JSON.stringify(app.communityPendingScore(local, 0)), JSON.stringify({ points: 0, verified: 0 }));
});

test("a report adopted from the server on restore is already in its score and adds nothing", () => {
  const local = { "tree:1": { id: "a", status: "VERIFIED", ts: 9e12, counted: true } };
  assert.equal(JSON.stringify(app.communityPendingScore(local, 0)), JSON.stringify({ points: 0, verified: 0 }));
});

test("several fresh reports add up, and an empty or missing record adds nothing", () => {
  const local = { "tree:1": { id: "a", status: "VERIFIED", ts: 10 }, "tree:2": { id: "b", status: "VERIFIED", ts: 20 }, "new:T": { id: "c", status: "NEW_TREE", ts: 30 } };
  assert.equal(JSON.stringify(app.communityPendingScore(local, 0)), JSON.stringify({ points: 3, verified: 2 }));
  assert.equal(JSON.stringify(app.communityPendingScore({}, 0)), JSON.stringify({ points: 0, verified: 0 }));
  assert.equal(JSON.stringify(app.communityPendingScore(null, 0)), JSON.stringify({ points: 0, verified: 0 }));
  assert.equal(app.communityDisplayScore(null, {}, new Set()).points, 0);
});

test("badges are earned from the score and the local log, and the rest stay locked", () => {
  const day = (n) => new Date(2026, 9, n, 12).getTime();
  const local = { "tree:1": { id: "a", status: "VERIFIED", ts: day(1) }, "new:T": { id: "b", status: "NEW_TREE", ts: day(2) }, "place:x": { id: "c", status: "CLOSED", kind: "place", ts: day(3) } };
  const names = (score) => app.communityBadges(score, local, day(3)).earned.map((b) => b.id);
  assert.equal(JSON.stringify(names({ verified: 0, confirmed: 0 })), JSON.stringify(["tree-finder", "place-spotter"]));
  assert.equal(JSON.stringify(names({ verified: 10, confirmed: 1 })), JSON.stringify(["first-check", "ten-checks", "second-opinion", "tree-finder", "place-spotter"]));
  assert.ok(app.communityBadges({ verified: 1, confirmed: 0 }, {}, day(3)).locked.length > 0);
});

test("a streak counts days in a row, stays alive until a full day is missed, and ignores restored and feedback entries", () => {
  const day = (n, h = 12) => new Date(2026, 9, n, h).getTime();
  const at = (...days) => Object.fromEntries(days.map((d, i) => [`t${i}`, { id: `r${i}`, status: "VERIFIED", ts: day(d) }]));
  const s = (local, now) => JSON.stringify(app.communityStreaks(local, now));
  assert.equal(s(at(1, 2, 3), day(3, 20)), JSON.stringify({ current: 3, best: 3 }));
  assert.equal(s(at(1, 2, 3), day(4, 8)), JSON.stringify({ current: 3, best: 3 }), "still alive the day after");
  assert.equal(s(at(1, 2, 3), day(5, 8)), JSON.stringify({ current: 0, best: 3 }), "broken after a missed day");
  assert.equal(s(at(1, 2, 5, 6, 7), day(7)), JSON.stringify({ current: 3, best: 3 }));
  assert.equal(s(at(3, 3, 3), day(3)), JSON.stringify({ current: 1, best: 1 }), "many reports on one day are one day");
  assert.equal(s({ a: { id: "x", status: "VERIFIED", ts: day(3), counted: true }, b: { id: "y", status: "FEEDBACK", kind: "feedback", ts: day(3) } }, day(3)), JSON.stringify({ current: 0, best: 0 }));
  assert.equal(s({}, day(3)), JSON.stringify({ current: 0, best: 0 }));
});

const communityEscalation = require("../netlify/functions/lib/community-escalation");
const escalationStore = () => {
  const data = new Map();
  return { async get(k) { return data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null; }, async put(k, v) { data.set(k, JSON.parse(JSON.stringify(v))); } };
};
const conflictComputed = (...targets) => ({ conflictDetails: targets.map((t) => ({ target: `tree:${t}`, counts: { VERIFIED: 1, NOT_HERE: 2 }, tlat: 51.66, tlon: 0.04 })) });

test("a conflicting tree is filed once as a labelled issue, with the counts and a link to the tree", async () => {
  const store = escalationStore();
  const posted = [];
  const post = async (issue) => { posted.push(issue); return { number: 40 + posted.length, html_url: `https://github.com/x/y/issues/${40 + posted.length}` }; };
  const first = await communityEscalation.escalateConflicts(store, conflictComputed(7), { post, siteUrl: "https://example.test" });
  assert.equal(first.filed, 1);
  assert.equal(posted[0].title, "Community conflict: tree 7");
  assert.deepEqual(posted[0].labels, ["community-conflict", "user-report", "tree:7"]);
  assert.match(posted[0].body, /1 × verified it is right/);
  assert.match(posted[0].body, /2 × found no tree/);
  assert.match(posted[0].body, /https:\/\/example\.test\/nearby#tree=r7/);
  assert.match(posted[0].body, /community-conflict-key:tree:7/);
  const again = await communityEscalation.escalateConflicts(store, conflictComputed(7), { post });
  assert.equal(again.filed, 0);
  assert.equal(posted.length, 1, "a rebuild never files the same tree twice");
});

test("conflict escalation files only new trees, caps each run, retries failures, and does nothing without GitHub", async () => {
  const store = escalationStore();
  let calls = 0;
  const post = async () => { calls += 1; if (calls === 2) throw new Error("boom"); return { number: calls, html_url: "u" }; };
  const run = await communityEscalation.escalateConflicts(store, conflictComputed(1, 2, 3), { post, max: 2 });
  assert.equal(run.filed, 2);
  assert.equal(run.failed, 1);
  assert.equal(run.pending, 1);
  const capped = await communityEscalation.escalateConflicts(escalationStore(), conflictComputed(4, 5, 6), { post: async () => ({ number: 1, html_url: "u" }), max: 2 });
  assert.equal(capped.filed, 2, "a run files at most max issues");
  assert.equal(capped.pending, 1);
  const next = await communityEscalation.escalateConflicts(store, conflictComputed(1, 2, 3), { post, max: 5 });
  assert.equal(next.filed, 1, "the one that failed is filed next run");
  assert.equal(next.pending, 0);
  const none = await communityEscalation.escalateConflicts(escalationStore(), conflictComputed(9), {});
  assert.equal(none.filed, 0);
  assert.equal(none.skipped, "no-github");
  assert.equal((await communityEscalation.escalateConflicts(escalationStore(), { conflictDetails: [] }, { post })).filed, 0);
});

test("reports the server holds for an account are merged into the log without overwriting unsent or newer local entries", () => {
  const local = {
    "tree:1": { id: "local-unsent-1", status: "VERIFIED", ts: 100 },
    "tree:2": { id: "local-sent-0002", status: "VERIFIED", ts: 500 },
    "tree:3": { id: "local-failed-03", status: "NOT_HERE", ts: 50, failed: "refused" },
  };
  const remote = [
    { id: "remote-aaaa-0001", kind: "tree", target: "tree:1", status: "NOT_HERE", ts: 900 },
    { id: "remote-bbbb-0002", kind: "tree", target: "tree:2", status: "NOT_HERE", ts: 400 },
    { id: "remote-cccc-0003", kind: "tree", target: "tree:3", status: "VERIFIED", ts: 900 },
    { id: "remote-dddd-0004", kind: "tree", target: "tree:4", status: "VERIFIED", ts: 800, lat: 51.6, lon: 0.04 },
    { id: "remote-eeee-0005", kind: "tree", target: null, status: "NEW_TREE", ts: 700, tagNumber: "T-9", lat: 51.7, lon: 0.05 },
    { id: "remote-ffff-0006", kind: "place", target: "place:id:node/9", status: "CLOSED", ts: 600 },
    { id: "remote-gggg-0007", kind: "feedback", target: null, status: "FEEDBACK", ts: 650 },
  ];
  const { local: merged, changed } = app.communityMergeRemoteReports(local, remote, new Set(["local-unsent-1"]));
  assert.equal(changed, true);
  assert.equal(merged["tree:1"].id, "local-unsent-1", "a report still waiting to send is kept");
  assert.equal(merged["tree:2"].id, "local-sent-0002", "a newer local report wins");
  assert.equal(merged["tree:3"].id, "local-failed-03", "a failed local report is kept");
  assert.equal(merged["tree:4"].id, "remote-dddd-0004");
  assert.equal(merged["tree:4"].remote, true);
  assert.equal(merged["tree:4"].counted, true, "already in the server's score, so never counted again");
  assert.equal(merged["new:T-9"].name, "Tree T-9");
  assert.equal(merged["place:id:node/9"].kind, "place");
  assert.equal(merged["feedback:remote-gggg-0007"].kind, "feedback");
  assert.equal(JSON.stringify(local["tree:4"]), undefined, "the input is not changed");
});

test("merging remote reports ignores malformed entries and a newer server report replaces an older local one", () => {
  const bad = [
    null, "x", { id: "short", kind: "tree", target: "tree:5", status: "VERIFIED", ts: 1 },
    { id: "remote-hhhh-0008", kind: "tree", target: "tree:5", status: "__proto__", ts: 1 },
    { id: "remote-iiii-0009", kind: "tree", target: "tree:6", status: "VERIFIED", ts: "soon" },
    { id: "remote-jjjj-0010", kind: "tree", target: "not a target", status: "VERIFIED", ts: 1 },
  ];
  const untouched = app.communityMergeRemoteReports({}, bad, new Set());
  assert.equal(untouched.changed, false);
  assert.equal(Object.keys(untouched.local).length, 0);
  const newer = app.communityMergeRemoteReports({ "tree:7": { id: "local-old-0007", status: "VERIFIED", ts: 10 } }, [{ id: "remote-kkkk-0011", kind: "tree", target: "tree:7", status: "NOT_HERE", ts: 20 }], new Set());
  assert.equal(newer.local["tree:7"].id, "remote-kkkk-0011", "the account's newer report on another device wins");
  assert.equal(app.communityMergeRemoteReports({}, undefined, new Set()).changed, false);
});

test("reports merged from the server never add optimistic points or extend the streak", () => {
  const { local } = app.communityMergeRemoteReports({}, [{ id: "remote-llll-0012", kind: "tree", target: "tree:8", status: "VERIFIED", ts: Date.now() }], new Set());
  assert.equal(JSON.stringify(app.communityPendingScore(local, 0)), JSON.stringify({ points: 0, verified: 0 }));
  assert.equal(app.communityStreaks(local, Date.now()).current, 0);
});

// --- Feature gate: who sees Community ---
const featureGate = require("../netlify/functions/lib/feature-gate");

test("Community is on for everyone while the early-access list is empty", () => {
  assert.equal(featureGate.enabledFor(featureGate.normalizeList({}), ["0123456789"]).community, true);
  assert.equal(featureGate.enabledFor(featureGate.normalizeList({ community: [{ id: "not-an-id" }] }), []).community, true);
});

test("once anyone is listed, only the listed testers (by device or account hash) have Community", () => {
  const list = featureGate.normalizeList({ community: [{ id: "A1B2C3D4E5", note: "Simon" }, { id: "a1b2c3d4e5" }] });
  assert.equal(list.community.length, 1, "ids are lower-cased and de-duplicated");
  assert.equal(featureGate.enabledFor(list, ["a1b2c3d4e5"]).community, true);
  assert.equal(featureGate.enabledFor(list, ["ffffffffff", "a1b2c3d4e5"]).community, true, "either hash may match");
  assert.equal(featureGate.enabledFor(list, ["ffffffffff"]).community, false);
  assert.equal(featureGate.enabledFor(list, []).community, false);
});

test("the tester id is a short hash, never the device id itself", () => {
  const id = featureGate.testerHash("some-device-id-1234567890");
  assert.match(id, /^[a-f0-9]{10}$/);
  assert.equal(id, featureGate.testerHash("some-device-id-1234567890"));
  assert.notEqual(id, featureGate.testerHash("another-device-id"));
});

test("the features endpoint answers the public check and keeps the list admin-only", async () => {
  const features = require("../netlify/functions/features");
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "secret-pw";
  try {
    const open = await features.handler({ httpMethod: "GET", headers: {}, queryStringParameters: { id: "0123456789" } });
    assert.equal(open.statusCode, 200);
    assert.equal(typeof JSON.parse(open.body).community, "boolean");
    assert.equal((await features.handler({ httpMethod: "GET", headers: {}, queryStringParameters: { admin: "1" } })).statusCode, 401);
    assert.equal((await features.handler({ httpMethod: "POST", headers: {}, body: "{}" })).statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previous;
  }
});

runRegisteredTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
