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
    children: [],
    get textContent() { return this._text ?? ""; },
    // Assigning text replaces any child nodes, as in a browser.
    set textContent(value) { this._text = String(value); this.children.length = 0; },
    append(...nodes) { nodes.forEach((node) => { if (typeof node !== "string") this.children.push(node); }); },
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
    createElement(tag) { const el = createElementStub(); el.tagName = String(tag).toUpperCase(); return el; },
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
    crypto: globalThis.crypto,
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
  fetchMapData,
  requestPersistentStorage,
  cowEndpointUrl,
  cowCenterForRequest,
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
  filterRailHtml,
  railSelection,
  railPillKeys,
  toggleRailFilter,
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
  setMap3dEnabled,
  tiltAllowedForCurrentScreen,
  isOverviewScreenActive,
  secondaryScreenActive,
  tiltRotateXDeg,
  tiltInfluence,
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
  FILTER_SUBFILTERS,
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
  submitReportForm,
  submitLocationIssueReport,
  applyReportStatusContent,
  refreshCachedState,
  applySwUpdate,
  requestBackgroundDataSync,
  hasTrackingConsent,
  setTrackingConsent,
  analyticsChoice,
  setAnalyticsConsent,
  storedLocationChoice,
  rememberLocationChoice,
  bootMayRequestLocation,
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
  compassTargetDeadbandDeg,
  compassSmoothingRate,
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
  const externalScripts = ["js/native.js", "js/app-cache-version.js", "js/data-cache-version.js", "js/categories.js", "js/normalize.js", "js/router-rules.js", "js/dom-elements.js", "js/filter-state.js", "js/tracker.js", "js/outbox.js", "js/community.js", "js/onboarding.js", "js/nav.js", "js/routing.js", "js/loader.js", "js/icon-motion.js", "js/renderer.js", "js/inspector.js"];
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
  app.state.inspectorMinimizeTransitionPending = false;
  app.state.selectionMapTransitionActive = false;
  app.state.selectionMapTransitionToken = null;
  app.state.selectionMapTransitionIconLookup = null;
  app.state.selectionMapTransitionOriginPoint = null;
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
  // 3D is off by default in the app; the tilt tests below exercise it switched on, and the
  // ones about the setting itself switch it off.
  app.state.map3dEnabled = true;
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
  const iconDir = path.join(__dirname, "..", "data", "icons");

  // All registered paths must point to existing files
  for (const [slug, filePath] of Object.entries(icons)) {
    const abs = path.join(__dirname, "..", filePath);
    assert.ok(fs.existsSync(abs), `ICON_PATHS["${slug}"] → ${filePath} does not exist`);
  }

  // Key icon slugs are present
  for (const slug of ["bus", "feedback", "filter", "home", "nearby", "settings", "tick", "walking"]) {
    assert.ok(slug in icons, `missing app icon slug: ${slug}`);
  }
  for (const slug of ["tree-ash", "tree-common-beech", "tree-holly", "tree-hornbeam", "tree-english-oak", "tree-wild-service"]) {
    assert.ok(slug in icons, `missing tree species icon slug: ${slug}`);
  }
});

test("a hall, library or arts centre draws as a pin rather than falling back to an emoji", () => {
  // These became something the map can carry when the weekly run learned to
  // add them. Without a rule here each one would draw as a bare emoji glyph,
  // which is the silent fallback `node scripts/icon-audit.js` exists to count.
  const { landmarkIconSlug, iconPath } = app;
  const expected = {
    public_hall: "landmark-museum",
    community_centre: "landmark-museum",
    townhall: "landmark-museum",
    social_centre: "landmark-museum",
    events_venue: "landmark-museum",
    library: "literature",
    arts_centre: "art",
    theatre: "theatre",
    cinema: "film",
  };

  for (const [category, slug] of Object.entries(expected)) {
    const place = { category, categoryTags: [category] };
    assert.equal(landmarkIconSlug(place), slug, `${category} should use the ${slug} icon`);
    assert.ok(iconPath(slug), `${slug} must be a real icon in the registry`);
  }
});

test("treeSpeciesIconHtml returns leaf icon for known species", () => {
  const { treeSpeciesIconHtml: fn } = app;
  assert.match(fn("English Oak", "Quercus robur"), /trees\/oak\.png/);
  assert.match(fn("Common Beech", "Fagus sylvatica"), /trees\/beach\.png/);
  assert.match(fn("Hornbeam", "Carpinus betulus"), /trees\/hornbeam\.png/);
  assert.equal(fn("Unknown species", ""), "");
});

test("guided onboarding keeps category groups separate and uses useful defaults", () => {
  const { ONBOARDING_STEPS: steps } = app;
  const permissionsStep = steps.findIndex((step) => step.type === "permissions");
  const compassStep = steps.findIndex((step) => step.type === "compass");
  const groupSteps = steps.filter((step) => step.type === "group");

  assert.strictEqual(permissionsStep, 0, "the permissions step remains available for direct onboarding launches");
  assert.strictEqual(groupSteps.length, app.FILTER_GROUPS.length, "each filter group should keep its own onboarding screen");
  assert.deepEqual(Array.from(app.DEFAULT_FILTERS), ["trees", "cows", "events", "pubs", "churches", "campsites"]);
  // Compass step is only included on iOS (canRequestCompassPermission). In the test
  // environment DeviceOrientationEvent.requestPermission is not defined, so no step.
  if (compassStep >= 0) {
    assert.ok(compassStep > locationStep, "compass onboarding should come after location setup");
  }
});

test("compass onboarding renders permission and fallback states", () => {
  const { compassStepMarkup: fn } = app;

  const prompt = fn({});
  assert.match(prompt.subtitle, /heading-up navigation/);
  assert.match(prompt.actionsHtml, /ob-compass-enable/);
  assert.match(prompt.actionsHtml, /Continue without compass/);

  const blocked = fn({ blocked: true });
  assert.match(blocked.subtitle, /Compass access was blocked/);
  assert.match(blocked.actionsHtml, /ob-compass-finish/);
});

test("stored compass permission is restored before nearby setup runs", () => {
  const grantedApp = loadAppForTests({
    localStorage: {
      "forest-finds-compass-permission-v1": "granted",
    },
  });
  const deniedApp = loadAppForTests({
    localStorage: {
      "forest-finds-compass-permission-v1": "denied",
    },
  });
  const unknownApp = loadAppForTests();

  assert.equal(grantedApp.state.compassPermission, "granted");
  assert.equal(deniedApp.state.compassPermission, "denied");
  assert.equal(unknownApp.state.compassPermission, "unknown");
  assert.equal(grantedApp.compassPermissionRequiresRequest(), false);
  assert.equal(deniedApp.compassPermissionRequiresRequest(), true);
  assert.equal(unknownApp.compassPermissionRequiresRequest(), true);
});

test("nearbyHeadingUpActive returns false without user location", () => {
  resetData(app);
  app.state.compassHeading = 45;
  app.state.userLocation = null;
  app.state.selected = null;
  assert.equal(app.nearbyHeadingUpActive(), false);
});

test("nearbyHeadingUpActive returns false without compass heading", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = null;
  app.state.compassHeading = null;
  assert.equal(app.nearbyHeadingUpActive(), false);
});

test("nearbyHeadingUpActive returns false when a location is selected", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 45;
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  assert.equal(app.nearbyHeadingUpActive(), false);
});

test("nearbyHeadingUpActive returns true in overview mode with location and compass", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 45;
  app.state.selected = null;
  assert.equal(app.nearbyHeadingUpActive(), true);
  assert.equal(app.headingUpActive(), true);
});

test("headingUpActive returns true for selected navigation heading-up", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  app.state.compassHeading = 45;
  assert.equal(app.headingUpActive(), true);
});

test("nearbyNavigationAnchorActive returns false without user location", () => {
  resetData(app);
  app.state.compassHeading = 45;
  app.state.userLocation = null;
  app.state.selected = null;
  assert.equal(app.nearbyNavigationAnchorActive(), false);
  assert.equal(app.navigationAnchorActive(), false);
});

test("nearbyNavigationAnchorActive returns true from a location fix alone, before any compass heading", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = null;
  app.state.compassHeading = null;
  assert.equal(app.nearbyHeadingUpActive(), false, "sanity: heading-up itself is correctly still inactive");
  assert.equal(app.nearbyNavigationAnchorActive(), true, "the anchored fit should not wait on a compass heading");
  assert.equal(app.navigationAnchorActive(), true);
});

test("nearbyNavigationAnchorActive returns false when a location is selected", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = null;
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  assert.equal(app.nearbyNavigationAnchorActive(), false);
});

test("navigationAnchorActive still requires a real heading for a selected navigation target", () => {
  // Deliberately narrower than the nearby case above: a selected target already has one
  // consistent heading-gated fit shared by boot (ensureUserAndSelectionVisible) and later
  // GPS updates, so making it heading-agnostic too would introduce the same "boot uses one
  // fit, a later update uses another" inconsistency this fix removes for nearby overview.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = null;
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  assert.equal(app.selectedNavigationHeadingUpActive(), false, "sanity: heading-up itself is correctly still inactive");
  assert.equal(app.navigationAnchorActive(), false, "a selected target without a heading should not engage the anchored fit");
});

test("nearby heading-up fit is established from GPS alone, so acquiring a compass heading afterwards does not re-zoom", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "t1", commonName: "Tree 1", ...makePoint(app, 0.001, 0) });
  app.state.trees.push({ id: "t2", commonName: "Tree 2", ...makePoint(app, 0, 0.0012) });
  app.state.viewport = { scale: 8, tx: 120, ty: 120 }; // simulate the wide full-forest fit shown at boot
  app.state.compassHeading = null; // GPS has resolved, compass has not -- the common case right after load

  assert.equal(app.nearbyHeadingUpActive(), false, "sanity: heading-up itself is correctly still inactive");

  const changed = app.alignHeadingUpNavigationViewport();
  assert.equal(changed, true, "should zoom in from the wide full-forest fit as soon as location is known");
  const beforeHeading = { ...app.state.viewport };
  assert.ok(beforeHeading.scale > 8, "should be zoomed in past the full-map scale, not stuck on it");

  // The compass heading now arrives -- in production this is onDeviceOrientation() /
  // startCompassSmoothing() calling this same function. Facing north (0) keeps the
  // rotation itself a no-op, isolating whether scale/pan alone snap to something new.
  app.state.compassHeading = 0;
  app.alignHeadingUpNavigationViewport();

  assert.equal(app.state.viewport.scale, beforeHeading.scale, "scale must not jump once a heading arrives");
  assert.ok(Math.abs(app.state.viewport.tx - beforeHeading.tx) < 0.001, "pan must not jump once a heading arrives");
  assert.ok(Math.abs(app.state.viewport.ty - beforeHeading.ty) < 0.001, "pan must not jump once a heading arrives");
});

test("tiltActive can respond to pitch before heading-up is active when a real location exists", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = null;
  app.state.tiltBetaSmoothed = 45;
  assert.equal(app.tiltActive(), true, "pitch should not wait for a compass heading");
});

test("the 3D map is off by default, so pitching the phone leaves the map flat", () => {
  const freshApp = loadAppForTests();
  freshApp.state.userLocation = makePoint(freshApp, 0, 0);
  freshApp.state.compassHeading = 90;
  freshApp.state.tiltBetaSmoothed = 60;
  assert.equal(freshApp.tiltActive(), false, "no 3D until the walker turns it on");
  assert.equal(freshApp.tiltRotateXDeg(), 0);
  assert.equal(freshApp.tiltInfluence(), 0, "pins do not collapse with pitch while 3D is off");
});

test("turning the 3D map on in Settings tilts the map and is remembered for next time", () => {
  const freshApp = loadAppForTests();
  freshApp.state.userLocation = makePoint(freshApp, 0, 0);
  freshApp.state.tiltBetaSmoothed = 60;
  freshApp.setMap3dEnabled(true);
  assert.equal(freshApp.tiltActive(), true);
  assert.ok(freshApp.tiltRotateXDeg() > 0, "the camera tilts once 3D is on");
  const reloaded = loadAppForTests({ localStorage: { "ff-map-3d-v1": freshApp.localStorage.getItem("ff-map-3d-v1") } });
  assert.equal(reloaded.state.map3dEnabled, true, "the choice survives a reload");
});

test("Settings only offers the 3D map once the device has reported a real tilt reading", () => {
  const freshApp = loadAppForTests();
  assert.match(freshApp.settingsFormHtml(), /id="map3dSetting" hidden/, "hidden on a device with no motion sensor");
  // Chrome on a laptop fires one orientation event with every angle null.
  freshApp.onDeviceOrientation({ alpha: null, beta: null, gamma: null });
  assert.match(freshApp.settingsFormHtml(), /id="map3dSetting" hidden/, "an all-null event is not a sensor");
  freshApp.onDeviceOrientation({ alpha: null, beta: 20, gamma: 0 });
  assert.doesNotMatch(freshApp.settingsFormHtml(), /id="map3dSetting" hidden/, "shown once a pitch arrives");
  const reloaded = loadAppForTests({ localStorage: { "ff-motion-sensor-v1": freshApp.localStorage.getItem("ff-motion-sensor-v1") } });
  assert.doesNotMatch(reloaded.settingsFormHtml(), /id="map3dSetting" hidden/, "shown straight away on the next visit");
});

test("turning the 3D map off flattens a tilted map straight away", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.tiltBetaSmoothed = 60;
  assert.equal(app.tiltActive(), true, "sanity: tilted with 3D on");
  app.setMap3dEnabled(false);
  assert.equal(app.tiltActive(), false);
  assert.equal(app.tiltRotateXDeg(), 0);
  app.setMap3dEnabled(true);
});

test("tiltActive returns false when phone is nearly flat (beta below threshold)", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 8; // below TILT_BETA_THRESHOLD (12)
  assert.equal(app.tiltActive(), false, "no tilt when beta below threshold");
});

test("tiltActive returns true when heading-up is active and phone is tilted past threshold", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 30; // well above TILT_BETA_THRESHOLD
  assert.equal(app.tiltActive(), true, "tilt mode should activate above threshold");
});

test("tiltAllowedForCurrentScreen allows 3D on every screen, with no exceptions", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;

  app.state.selected = null;
  app.state.filterScreenOpen = false;
  assert.equal(app.tiltAllowedForCurrentScreen(), true, "nearby overview should allow 3D");

  app.state.filterScreenOpen = true;
  assert.equal(app.tiltAllowedForCurrentScreen(), true, "filter screen should allow 3D");

  app.state.filterScreenOpen = false;
  app.state.selected = { type: "settings", item: null };
  assert.equal(app.tiltAllowedForCurrentScreen(), true, "settings screen should allow 3D");

  app.state.selected = { type: "report", item: null };
  assert.equal(app.tiltAllowedForCurrentScreen(), true, "feedback screen should allow 3D");

  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  assert.equal(app.tiltAllowedForCurrentScreen(), true, "selected-item navigation should allow 3D");
});

test("tiltRotateXDeg returns 0 without a real location", () => {
  resetData(app);
  app.state.userLocation = null;
  app.state.compassHeading = null;
  app.state.tiltBetaSmoothed = 60;
  assert.equal(app.tiltRotateXDeg(), 0, "no rotation when heading-up inactive");
});

test("tiltRotateXDeg scales smoothly between threshold and max", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.selected = null;

  app.state.tiltBetaSmoothed = 12; // exactly at threshold
  assert.equal(app.tiltRotateXDeg(), 0, "no rotation at threshold boundary");

  app.state.tiltBetaSmoothed = 85; // at max
  const maxAngle = app.tiltRotateXDeg();
  assert.ok(maxAngle > 70 && maxAngle <= 75, `max tilt angle should be near 75°, got ${maxAngle}`);

  app.state.tiltBetaSmoothed = 48.5; // midpoint ~(12+85)/2
  const midAngle = app.tiltRotateXDeg();
  assert.ok(midAngle > 0 && midAngle < maxAngle, "mid-tilt angle should be between 0 and max");
});

test("prepareCanvasForDraw records the tilt angle the main canvas is about to be drawn at", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 40;

  app.prepareCanvasForDraw();

  assert.equal(app.state.renderedTiltRotateXDeg, app.tiltRotateXDeg(), "the drawn angle should be the live one");
  assert.equal(app.tiltRenderStale(), false, "the map is not stale immediately after being drawn");
});

test("tiltRenderStale reports the map as stale once the phone has pitched away from the drawn angle", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 40;
  app.prepareCanvasForDraw();

  // Pitching the phone with no turn: the heading is untouched, so nothing else asks for a
  // redraw -- this is the only thing that can tell the map it no longer matches the overlay.
  app.state.tiltBetaSmoothed = 50;

  assert.ok(app.tiltRotateXDeg() - app.state.renderedTiltRotateXDeg > app.TILT_RENDER_STALE_DEG,
    "sanity: the pitch moved the camera well past the noise floor");
  assert.equal(app.tiltRenderStale(), true, "the drawn map no longer matches the live tilt");
});

test("tiltRenderStale ignores sensor noise too small to see", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 40;
  app.prepareCanvasForDraw();

  // A phone held still still jitters a little; repainting the whole map for that is waste.
  app.state.tiltBetaSmoothed = 40.01;

  assert.equal(app.tiltRenderStale(), false, "sub-threshold jitter must not force a full redraw");
});

test("leaving 3D leaves the map stale until it is redrawn flat", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 60;
  app.prepareCanvasForDraw();

  app.state.tiltBetaSmoothed = 0; // phone laid flat -- tiltActive() flips off
  assert.equal(app.tiltActive(), false, "sanity: tilt is no longer active");
  assert.equal(app.tiltRenderStale(), true, "the perspective pixels still on the canvas must be redrawn flat");
});

test("isBehindTiltHeading returns false when tilt is not active, regardless of geometry", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0; // facing north
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 0; // flat, tilt inactive

  const southPoint = makePoint(app, -0.01, 0).point; // directly behind (south) if tilt were active
  assert.equal(app.isBehindTiltHeading(southPoint), false, "no culling until tilt is actually active");
});

test("isBehindTiltHeading distinguishes ahead from behind once full 3D tilt is active", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0; // facing north
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 60; // well past TILT_BETA_THRESHOLD

  const ahead = makePoint(app, 0.01, 0).point; // north of user: ahead
  const behind = makePoint(app, -0.01, 0).point; // south of user: behind

  assert.equal(app.isBehindTiltHeading(ahead), false, "point ahead of heading should not be hidden");
  assert.equal(app.isBehindTiltHeading(behind), true, "point behind heading should be hidden in full 3D");
});

test("tiltPinScale returns full size when tilt is not active, regardless of geometry", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 0;

  const southPoint = makePoint(app, -1, 0).point;
  assert.equal(app.tiltPinScale(southPoint), 1, "no shrinking until tilt is actually active");
});

test("tiltPinScale settles at a small floor (not zero) for pins well behind, and full size well ahead", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 85; // TILT_BETA_MAX — collapse only reaches its floor at max tilt
  app.state.viewport = { scale: 1000, tx: 0, ty: 0 };

  const wellAhead = makePoint(app, 1, 0).point;
  const wellBehind = makePoint(app, -1, 0).point;

  assert.equal(app.tiltPinScale(wellAhead), 1, "pins clearly ahead should render at full size");
  assert.equal(app.tiltPinScale(wellBehind), 0.3, "pins clearly behind should collapse to a small floor rather than vanish");
});

test("tiltPinScale ramps collapse across the whole active-tilt range, not just as tilt engages", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 0, ty: 0 };

  const wellBehind = makePoint(app, -1, 0).point;

  // Just past TILT_BETA_THRESHOLD (12), where full 3D first engages, pins behind the heading
  // should still be close to full size rather than already collapsed to the floor.
  app.state.tiltBetaSmoothed = 14;
  const justEngaged = app.tiltPinScale(wellBehind);
  assert.ok(justEngaged > 0.9, `pins should stay close to full size as tilt begins, got ${justEngaged}`);

  // Midway through the active-tilt range, collapse should be partial, not yet at the floor.
  app.state.tiltBetaSmoothed = 48.5; // midpoint of 12-85
  const midTilt = app.tiltPinScale(wellBehind);
  assert.ok(midTilt > 0.3 && midTilt < justEngaged, "collapse should progress gradually through the mid tilt range");

  // Only near TILT_BETA_MAX (85) should the pin approach the collapsed floor.
  app.state.tiltBetaSmoothed = 85;
  const maxTilt = app.tiltPinScale(wellBehind);
  assert.ok(maxTilt < midTilt, "collapse should be greatest near max tilt");
});

test("tiltPinScale shrinks smoothly through the ahead/behind boundary instead of snapping", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 60;
  app.state.viewport = { scale: 1000, tx: 0, ty: 0 };

  // TILT_PIN_COLLAPSE_BAND_PX (130) / viewport.scale (1000) = 0.13 world-unit band width,
  // so points within +/-0.065 of the user straddle the transition rather than sitting at an extreme.
  const justAhead = app.tiltPinScale(makePoint(app, 0.03, 0).point);
  const atBoundary = app.tiltPinScale(makePoint(app, 0, 0).point);
  const justBehind = app.tiltPinScale(makePoint(app, -0.03, 0).point);

  assert.ok(justAhead > atBoundary && atBoundary > justBehind, "scale should shrink monotonically as a pin crosses from ahead to behind");
  assert.ok(atBoundary > 0.3 && atBoundary < 1, "at the exact boundary the pin should be mid-transition, not at either extreme");
});

test("tiltPinScale does not jump when tiltActive() itself switches on/off — collapse eases out over the same flat range rotateX does", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 0, ty: 0 };

  const wellBehind = makePoint(app, -1, 0).point;

  // Either side of TILT_BETA_THRESHOLD (12), where tiltActive() itself flips — collapse
  // used to be gated directly on tiltActive(), so a pin sitting behind the heading would
  // snap from its collapsed scale to full size (or vice versa) right at this boundary.
  app.state.tiltBetaSmoothed = 11.99;
  app.state.tiltWasActive = false;
  assert.equal(app.tiltActive(), false, "just below the threshold, tiltActive() is still off");
  const justBelow = app.tiltPinScale(wellBehind);

  app.state.tiltBetaSmoothed = 12.01;
  assert.equal(app.tiltActive(), true, "just above the threshold, tiltActive() is now on");
  const justAbove = app.tiltPinScale(wellBehind);

  assert.ok(Math.abs(justAbove - justBelow) < 0.01, "scale should barely change across the tiltActive() boundary, not snap");

  // Leveling all the way back to flat (map mode) should fully restore scale, still smoothly.
  app.state.tiltBetaSmoothed = 0;
  assert.equal(app.tiltPinScale(wellBehind), 1, "back at full size once flat, even for a point behind the heading");
});

test("full 3D (max tilt) pushes the nearby user anchor to near the bottom edge with a small gap", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 85; // max tilt — full 3D
  app.state.viewport = { scale: 1000, tx: 999, ty: 888 };

  app.alignHeadingUpNavigationViewport();
  const fraction = userAnchorFractionOfVisibleArea(app);

  assert.ok(fraction > 0.85, `user dot should sit near the bottom edge at max tilt, got fraction ${fraction}`);
  assert.ok(fraction < 1, "a small gap should remain so the dot isn't flush against the edge");
});

test("full 3D (max tilt) pushes the selected-navigation user anchor to near the bottom edge with a small gap", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  // Target due east (increasing longitude), matching compassHeading 90 (facing east) --
  // i.e. genuinely dead ahead, so the bearing-based anchor mirroring (see
  // headingUpAnchorFraction/selectedNavigationTargetBearingOffsetRadians) leaves the
  // anchor untouched and this test isolates the tilt-ramp behaviour it's named for.
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0, 0.001) } };
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.tiltBetaSmoothed = 85; // max tilt — full 3D
  app.state.viewport = { scale: 1000, tx: 999, ty: 888 };

  app.alignHeadingUpNavigationViewport();
  const fraction = userAnchorFractionOfVisibleArea(app);

  assert.ok(fraction > 0.85, `user dot should sit near the bottom edge at max tilt, got fraction ${fraction}`);
  assert.ok(fraction < 1, "a small gap should remain so the dot isn't flush against the edge");
});

test("nearby heading-up map rotation applies compass heading to worldToScreen", () => {
  resetData(app);
  // Place user at origin
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90; // facing east
  app.state.selected = null;
  app.state.renderedNavigationHeading = 90;
  app.state.viewport = { scale: 1000, tx: 500, ty: 400 };

  const userScreen = app.worldToScreen(app.state.userLocation.point);
  // A point slightly north: latitude increases → y decreases in Mercator projection
  const northWorldPoint = { x: app.state.userLocation.point.x, y: app.state.userLocation.point.y - 0.001 };
  const northScreen = app.worldToScreen(northWorldPoint);

  // With 90° heading (facing east), north becomes left on screen
  assert.ok(northScreen.x < userScreen.x, "north should appear to the left when facing east");
  assert.ok(Math.abs(northScreen.y - userScreen.y) < 0.01, "north point should be on same horizontal level as user");
});

test("nearby heading-up viewport centres the user, because the walking-radius circle it frames is centred on them", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 999, ty: 888 };

  const changed = app.alignHeadingUpNavigationViewport();

  assert.ok(changed, "viewport should have changed to frame the walking-radius circle");
  const focusCenter = app.els.canvas.clientWidth / 2;
  assert.equal(Math.round(app.state.viewport.tx), Math.round(focusCenter), "user should stay horizontally centered");
  assert.ok(
    Math.abs(userAnchorFractionOfVisibleArea(app) - 0.5) < 0.001,
    "flat (2D) nearby puts the user dead centre so the radius circle is centred in the map space"
  );
});

test("heading-up viewport alignment does nothing before map data has loaded, so it can't compute the scale cap against the placeholder fitScale", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.selected = null;
  app.state.dataLoaded = false;
  app.state.fitScale = 1; // placeholder default from boot, before fitToBounds() runs
  app.state.viewport = { scale: 1000, tx: 999, ty: 888 };

  const changed = app.alignHeadingUpNavigationViewport();

  assert.equal(changed, false, "should bail out before data has loaded");
  assert.deepEqual(app.state.viewport, { scale: 1000, tx: 999, ty: 888 }, "viewport should be untouched");
});

test("nearby heading-up viewport frames the walking-radius circle and ignores where highlighted items happen to sit", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };
  app.state.trees.push({ id: "ahead-tree", recordNumber: 901, commonName: "Ahead tree", ...makePoint(app, 0.0012, 0) });
  app.state.landmarks.push({ id: "behind-pub", name: "Behind Pub", category: "pub", ...makePoint(app, -0.15, 0) });

  app.state.overviewFilters = ["trees", "pubs"];
  const changed = app.alignHeadingUpNavigationViewport();
  const scaleWithItems = app.state.viewport.scale;

  assert.ok(changed, "viewport should refit onto the walking-radius circle");

  // Removing every highlighted item must not move the camera at all: the Nearby view's only
  // positioning input is the radius circle, so neither the ahead tree nor the far-behind pub
  // can pull the zoom in or out.
  app.state.trees = [];
  app.state.landmarks = [];
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };
  app.alignHeadingUpNavigationViewport();
  assert.ok(
    Math.abs(app.state.viewport.scale - scaleWithItems) < scaleWithItems * 0.001,
    "zoom should be identical with and without highlighted items",
  );
});

test("a filter with nothing inside the radius pulls the nearby camera out far enough to show its nearest match", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.trees.push({ id: "near-tree", recordNumber: 902, commonName: "Near tree", ...makePoint(app, 0.0012, 0) });

  app.state.landmarks.push({ id: "far-station", name: "Far Underground Station", category: "station", ...makePoint(app, 0.03, 0) });

  // Trees alone: everything the filter matches is inside the ring, so the ring is the fit.
  app.setOverviewFilters(["trees"]);
  app.stopViewportAnimation();
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };
  app.alignHeadingUpNavigationViewport();
  const ringOnlyScale = app.state.viewport.scale;

  // Switch on a filter whose only match is a long walk outside the ring. The Nearby list
  // already falls back to showing it (overviewItemsForActiveFilter marks it outOfRadius), so
  // the map has to reach it too -- otherwise the list names a station the map never shows.
  app.setOverviewFilters(["trees", "underground"]);
  app.stopViewportAnimation();
  assert.deepEqual(Array.from(app.state.outOfRadiusRevealFilters), ["underground"], "the added filter is what the camera reaches for");
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };
  app.alignHeadingUpNavigationViewport();
  const revealedScale = app.state.viewport.scale;
  assert.ok(
    revealedScale < ringOnlyScale * 0.9,
    `the camera zooms out past the ring to reach the out-of-radius match (${revealedScale} vs ${ringOnlyScale})`,
  );

  // It is a response to that action, not a standing property of the camera. A saved filter set
  // restored at boot -- same filters, no action -- must leave the ring framed as it always was,
  // or every launch would open zoomed out around one far-off kind.
  app.state.outOfRadiusRevealFilters = [];
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };
  app.alignHeadingUpNavigationViewport();
  assert.ok(
    Math.abs(app.state.viewport.scale - ringOnlyScale) < ringOnlyScale * 0.001,
    "with nothing just added, the fit is the ring again",
  );

  // Resizing the ring is the user taking the camera back.
  app.state.outOfRadiusRevealFilters = ["underground"];
  app.applyWalkingRadiusChange(6, { animate: false });
  assert.equal(app.state.outOfRadiusRevealFilters.length, 0, "changing the radius hands the camera back to the ring");
  app.state.walkingDistanceMinutes = 5;
});

test("a ?show=<filterKey> query param filters Nearby to that category on arrival, from a /nearby/<slug> category page", () => {
  resetData(app);
  app.setOverviewFilters(["trees"]);
  app.location.search = "?show=pubs";
  app.applyShowFilterFromQuery();
  assert.deepEqual(Array.from(app.state.overviewFilters), ["pubs"], "the query param replaces whatever filters were active");
  app.location.search = "";
});

test("an unknown or missing ?show= value leaves the current filters alone", () => {
  resetData(app);
  app.setOverviewFilters(["cafes"]);
  app.location.search = "?show=not-a-real-filter";
  app.applyShowFilterFromQuery();
  assert.deepEqual(Array.from(app.state.overviewFilters), ["cafes"], "an unrecognised key is ignored rather than clearing the filters");

  app.location.search = "";
  app.applyShowFilterFromQuery();
  assert.deepEqual(Array.from(app.state.overviewFilters), ["cafes"], "no ?show= param at all leaves filters untouched");
});

test("visiting a /nearby/<slug> page never overwrites the reader's own saved filters", () => {
  resetData(app);
  app.localStorage.setItem("forest-finds-filter-state-v1", JSON.stringify({ filters: ["cafes"], expandedGroups: [] }));
  app.location.pathname = "/nearby/pubs/";
  app.applyShowFilterFromQuery();
  assert.deepEqual(Array.from(app.state.overviewFilters), ["pubs"], "the page itself still shows its one category");
  assert.equal(
    JSON.parse(app.localStorage.getItem("forest-finds-filter-state-v1")).filters[0],
    "cafes",
    "but it never becomes the reader's new default -- their real saved filters are untouched"
  );
  app.location.pathname = "/";
});

test("the Nearby nav button restores the reader's real filters after a /nearby/<slug> page's own single category", () => {
  resetData(app);
  resetRouter(app);
  app.localStorage.setItem("forest-finds-filter-state-v1", JSON.stringify({ filters: ["cafes"], expandedGroups: [] }));
  app.location.pathname = "/nearby/pubs/";
  app.applyShowFilterFromQuery();
  assert.deepEqual(Array.from(app.state.overviewFilters), ["pubs"], "arrives pre-filtered to the page's own category");

  app.goToInitialView();
  assert.deepEqual(Array.from(app.state.overviewFilters), ["cafes"], "\"Nearby\" takes the reader back to their own filters, not the page's");
  assert.equal(app.location.pathname, "/nearby", "the Nearby nav also canonicalizes the category URL");
  app.location.pathname = "/";
});

test("the Nearby nav button leaves a filter the reader deliberately chose alone", () => {
  resetData(app);
  resetRouter(app);
  app.setOverviewFilters(["pubs"]);
  app.goToInitialView();
  assert.deepEqual(Array.from(app.state.overviewFilters), ["pubs"], "a real chip tap is never mistaken for a page's own ephemeral lens");
});

test("navigating in-app from a selection straight to a /nearby/<slug> page lands on that page's own category, not the reader's stored filters", () => {
  resetData(app);
  resetRouter(app);
  app.localStorage.setItem("forest-finds-filter-state-v1", JSON.stringify({ filters: ["trees", "cows", "events"], expandedGroups: [] }));
  // A selection (any type) makes currentScreenRoute() non-empty, so navigateInApp's own
  // urlMatchesCurrentScreen check doesn't short-circuit before applyRoute()/goToInitialView()
  // run -- the same shape as clicking a business page's own "Food" related link.
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  app.location.pathname = "/find/the-forresters/";
  app.location.hash = "";

  app.navigateInApp("/nearby/food/");

  assert.equal(app.location.pathname, "/nearby/food/");
  assert.deepEqual(
    Array.from(app.state.overviewFilters).sort(),
    ["cafes", "pubs", "restaurants", "shops"],
    "lands pre-filtered to Food's own subfilters -- goToInitialView's own restore (fired in the same pass, since the route value is \"\" both before and after a selection) must not revert this"
  );
  app.location.pathname = "/";
  app.location.hash = "";
});

test("navigating in-app from a selection straight to bare /nearby restores the reader's stored filters", () => {
  resetData(app);
  resetRouter(app);
  app.localStorage.setItem("forest-finds-filter-state-v1", JSON.stringify({ filters: ["cafes"], expandedGroups: [] }));
  // The precondition this exercises: currently showing /nearby/food/'s own ephemeral category
  // (exactly what a real arrival there -- applyShowFilterFromQuery -- would have left behind).
  app.setOverviewFilters(["pubs", "restaurants", "cafes", "shops"], { persist: false });
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  app.location.pathname = "/nearby/food/";
  app.location.hash = "";

  app.navigateInApp("/nearby");

  assert.equal(app.location.pathname, "/nearby");
  assert.deepEqual(
    Array.from(app.state.overviewFilters),
    ["cafes"],
    "the \"All nearby\" link's own target (bare /nearby) is not itself a landing page, so applyShowFilterFromQuery must put the reader's own filters back -- its own route value (\"\") never changes between the /nearby/food/ page and bare /nearby, so goToInitialView's restore never runs on its own"
  );
  app.location.pathname = "/";
  app.location.hash = "";
});

test("a ?q=<text> query param restores the search box's text on arrival at /search", () => {
  resetData(app);
  app.state.searchQuery = "";
  app.location.search = "?q=oak";
  app.applySearchQueryFromQuery();
  assert.equal(app.state.searchQuery, "oak", "the query param fills in the search text");
  app.location.search = "";
});

test("a missing ?q= leaves the search text alone", () => {
  resetData(app);
  app.state.searchQuery = "oak";
  app.location.search = "";
  app.applySearchQueryFromQuery();
  assert.equal(app.state.searchQuery, "oak", "nothing to restore, so the existing text is untouched");
});

test("typing into search updates /nearby/search's own URL live, the same way toggling a filter updates /nearby/filter's", () => {
  resetData(app);
  resetRouter(app);
  app.openSearchScreen();
  app.setSearchQuery("oak");
  assert.equal(app.location.pathname, "/nearby/search", "still on its own path");
  assert.equal(app.location.search, "?q=oak", "the typed text is shareable straight out of the address bar");

  app.setSearchQuery("oak tree");
  assert.equal(app.location.search, "?q=oak%20tree", "and keeps correcting in place as the text changes");

  app.setSearchQuery("");
  assert.equal(app.location.search, "", "clearing the box clears the query string too");
});

test("a ?radius=<minutes> query param restores the walking radius on arrival at a Nearby path", () => {
  resetData(app);
  app.location.search = "?radius=10";
  app.applyRadiusFromQuery();
  assert.equal(app.state.walkingDistanceMinutes, 10, "the query param sets the radius");
  app.location.search = "";
});

test("?radius= is clamped to the slider's own bounds, and a missing or invalid value leaves the radius alone", () => {
  resetData(app);
  app.state.walkingDistanceMinutes = 7;
  app.location.search = "?radius=not-a-number";
  app.applyRadiusFromQuery();
  assert.equal(app.state.walkingDistanceMinutes, 7, "an invalid value is ignored");

  app.location.search = "";
  app.applyRadiusFromQuery();
  assert.equal(app.state.walkingDistanceMinutes, 7, "no ?radius= param at all leaves the radius untouched");

  app.location.search = "?radius=999";
  app.applyRadiusFromQuery();
  assert.equal(app.state.walkingDistanceMinutes, 30, "clamped to the slider's own maximum");
  app.location.search = "";
});

test("a /nearby/<slug> landing page defaults the radius to 30 minutes, not the ordinary 5", () => {
  resetData(app);
  app.state.walkingDistanceMinutes = 5;
  app.location.pathname = "/nearby/pubs/";
  app.applyRadiusFromQuery();
  assert.equal(app.state.walkingDistanceMinutes, 30, "a single category gets a fair showing without the reader touching the radius");

  app.state.walkingDistanceMinutes = 5;
  app.location.pathname = "/nearby/food/";
  app.applyRadiusFromQuery();
  assert.equal(app.state.walkingDistanceMinutes, 30, "a group page gets the same wider default");

  app.location.pathname = "/";
});

test("an explicit ?radius= on a /nearby/<slug> landing page overrides the 30-minute default", () => {
  resetData(app);
  app.location.pathname = "/nearby/pubs/";
  app.location.search = "?radius=8";
  app.applyRadiusFromQuery();
  assert.equal(app.state.walkingDistanceMinutes, 8, "a link that already named a radius is never overridden");
  app.location.pathname = "/";
  app.location.search = "";
});

test("the 30-minute landing default never leaks onto /nearby itself or its own filter/search paths", () => {
  resetData(app);
  for (const path of ["/nearby", "/nearby/filter", "/nearby/search", "/settings", "/feedback"]) {
    app.state.walkingDistanceMinutes = 5;
    app.location.pathname = path;
    app.applyRadiusFromQuery();
    assert.equal(app.state.walkingDistanceMinutes, 5, `${path} is not a /nearby/<slug> landing page`);
  }
  app.location.pathname = "/";
});

test("resizing the walking radius updates /nearby's own URL live, the same way a filter or a search does", () => {
  resetData(app);
  resetRouter(app);
  app.location.pathname = "/nearby";
  app.applyWalkingRadiusChange(10, { animate: false });
  assert.equal(app.location.search, "?radius=10", "shareable straight out of the address bar");

  app.applyWalkingRadiusChange(app.DEFAULT_WALKING_DISTANCE_MINUTES, { animate: false });
  assert.equal(app.location.search, "", "back at the default, the param drops rather than reading ?radius=5");
  app.location.pathname = "/";
});

test("an expanded cluster's borrowed radius never leaks into the URL", () => {
  // Regression: focusNearbyOnClusterGroup borrows a tight radius to cover the tapped group
  // (stashing the reader's real one in preClusterWalkingDistanceMinutes), and selectOverview's
  // own syncHashFromSelection call wrote that borrowed value straight into a /nearby?radius=
  // history entry -- so going back later re-applied the group's borrowed radius as if the
  // reader had chosen it, through the same ?radius= query this feature reads on arrival.
  resetData(app);
  app.state.walkingDistanceMinutes = 5;
  app.state.clusterExpanded = { itemType: "tree", items: [] };
  app.state.preClusterWalkingDistanceMinutes = 5;
  // The borrowed value a real cluster tap would have set -- see clusterFocusTarget.
  app.state.walkingDistanceMinutes = 0.25;
  assert.equal(app.searchStringForPath("/nearby"), "", "the borrowed radius is never written out");

  app.state.clusterExpanded = null;
  app.state.walkingDistanceMinutes = 0.25;
  assert.equal(app.searchStringForPath("/nearby"), "?radius=0.25", "once it's the reader's own radius, it is");
});

test("filterKeysFromFindPath reads a subfilter's category straight from a /nearby/<slug> path, hyphens back to underscores", () => {
  assert.deepEqual(Array.from(app.filterKeysFromFindPath("/nearby/pubs")), ["pubs"]);
  assert.deepEqual(Array.from(app.filterKeysFromFindPath("/nearby/pubs/")), ["pubs"], "the trailing slash Netlify serves it at is accepted too");
  assert.deepEqual(Array.from(app.filterKeysFromFindPath("/nearby/national-rail")), ["national_rail"]);
  assert.deepEqual(Array.from(app.filterKeysFromFindPath("/nearby/not-a-real-filter")), [], "an unrecognised slug is not a filter key");
  assert.deepEqual(Array.from(app.filterKeysFromFindPath("/app")), [], "a non-/nearby/ path never matches");
  assert.deepEqual(Array.from(app.filterKeysFromFindPath("")), []);
});

test("nearbyCountCopy reads as a plain count from the place, in the reader's own walking radius", () => {
  const saved = app.state.walkingDistanceMinutes;
  app.state.walkingDistanceMinutes = 30;
  assert.equal(app.nearbyCountCopy("trees", { within: 43, beyond: 20 }, "The Foresters"), "43 trees within 30 min walk of The Foresters. 20 further away.");
  assert.equal(app.nearbyCountCopy("cows", { within: 0, beyond: 11 }, "The Foresters"), "No cows within 30 min walk of The Foresters. 11 further away.");
  assert.equal(app.nearbyCountCopy("cows", { within: 0, beyond: 0 }, "The Foresters"), "No cows nearby.");
  assert.equal(app.nearbyCountCopy("cows", { within: 1, beyond: 0 }, "The Foresters"), "1 cow within 30 min walk of The Foresters.", "a single match drops the plural");
  assert.equal(app.nearbyCountCopy("trees", { within: 3032, beyond: 21864 }, "Bald Faced Stag"), "3,032 trees within 30 min walk of Bald Faced Stag. 21,864 further away.", "large counts get thousands separators");
  app.state.walkingDistanceMinutes = saved;
});

test("nearbyCardFilterKeys follows the reader's filters, falling back to trees and cows when none are set", () => {
  const saved = app.state.overviewFilters;
  app.state.overviewFilters = [];
  assert.deepEqual(Array.from(app.nearbyCardFilterKeys()), ["trees", "cows"], "no filters chosen: the defaults");
  app.state.overviewFilters = ["pubs", "bus"];
  assert.deepEqual(Array.from(app.nearbyCardFilterKeys()), ["pubs", "bus"], "the reader's own filters, not trees and cows");
  app.state.overviewFilters = ["pubs", "not_a_real_filter", "cafes"];
  assert.deepEqual(Array.from(app.nearbyCardFilterKeys()), ["pubs", "cafes"], "an unknown key is dropped");
  app.state.overviewFilters = Array.from({ length: 9 }, (_, i) => ["pubs", "cafes", "shops", "bus", "national_rail", "trees", "cows", "parking", "ponds_streams"][i]);
  assert.equal(app.nearbyCardFilterKeys().length, 6, "a long selection is capped so the section stays readable");
  app.state.overviewFilters = saved;
});

test("nearbyAnchorRouteValue carries the place name as a label, and omits it for a bare map tap", () => {
  assert.equal(app.nearbyAnchorRouteValue({ latitude: 51.65, longitude: 0.05 }), "near=51.650000%2C0.050000");
  const named = new URLSearchParams(app.nearbyAnchorRouteValue({ latitude: 51.65, longitude: 0.05, label: "The Foresters" }));
  assert.equal(named.get("near"), "51.650000,0.050000");
  assert.equal(named.get("label"), "The Foresters", "the label is what the bar names the spot by");
});

test("showsEverythingFromQuery is true only for ?filters=false, so Everything links ignore the saved filters", () => {
  assert.equal(app.showsEverythingFromQuery("?filters=false"), true);
  assert.equal(app.showsEverythingFromQuery("?radius=15&filters=false"), true);
  assert.equal(app.showsEverythingFromQuery(""), false, "no parameter leaves the saved filters alone");
  assert.equal(app.showsEverythingFromQuery("?filters=true"), false);
  assert.equal(app.showsEverythingFromQuery("?show=pubs"), false, "a plain ?show= list is not the everything override");
});

test("filterKeysFromFindPath reads a top-level group's page as every one of its member keys", () => {
  assert.deepEqual(
    Array.from(app.filterKeysFromFindPath("/nearby/food")),
    ["pubs", "restaurants", "cafes", "shops"],
    "the whole group, not just one subfilter"
  );
  assert.deepEqual(Array.from(app.filterKeysFromFindPath("/nearby/transport/")), ["bus", "underground", "national_rail", "parking"]);
});

test("filterKeysFromFindPath never mistakes the /nearby/filter or /nearby/search screens for a category", () => {
  assert.deepEqual(Array.from(app.filterKeysFromFindPath("/nearby/filter")), [], "/nearby/filter is a screen, not a category");
  assert.deepEqual(Array.from(app.filterKeysFromFindPath("/nearby/search")), [], "/nearby/search is a screen, not a category");
});

test("isLandingPageArrival recognises a /nearby/<slug> path or a first-touch ?show= link, but not the plain Nearby screen", () => {
  app.location.pathname = "/nearby/pubs";
  app.location.search = "";
  assert.equal(app.isLandingPageArrival(), true, "a subfilter's own page is a landing page");

  app.location.pathname = "/nearby/food";
  app.location.search = "";
  assert.equal(app.isLandingPageArrival(), true, "a group's own page is a landing page too");

  app.location.pathname = "/nearby/filter";
  app.location.search = "?show=pubs";
  assert.equal(app.isLandingPageArrival(), true, "a shared ?show= link is a landing-page arrival even on /nearby/filter");

  app.location.pathname = "/nearby";
  app.location.search = "";
  assert.equal(app.isLandingPageArrival(), false, "the plain Nearby screen with nothing pre-filtered is not a landing page");

  app.location.pathname = "/nearby/filter";
  app.location.search = "";
  assert.equal(app.isLandingPageArrival(), false, "/nearby/filter with no ?show= is just the Filter screen");

  app.location.pathname = "/";
  app.location.search = "";
});

test("isLandingPageArrival also recognises a /find/<slug>/ business page as a landing-page arrival, but not /find/events/", () => {
  app.location.pathname = "/find/the-forresters/";
  app.location.search = "";
  assert.equal(app.isLandingPageArrival(), true, "a business's own /find/ page is a landing page, same as /nearby/<slug>");

  app.location.pathname = "/find/the-forresters";
  app.location.search = "";
  assert.equal(app.isLandingPageArrival(), true, "without the trailing slash too");

  app.location.pathname = "/find/events/";
  app.location.search = "";
  assert.equal(app.isLandingPageArrival(), false, "events has no single business of its own to land on, same carve-out routeValueFromLocation makes");

  app.location.pathname = "/";
  app.location.search = "";
});

test("overviewNearestHtml carries the labelled category navigation and results heading through every return path", () => {
  resetData(app);
  // Set directly rather than through setOverviewFilters(), whose own selectOverview()/
  // syncHashFromSelection() side effects would otherwise correct this test's manually-set
  // pathname back to the plain /nearby the current (empty) selection/anchor actually describes --
  // the real boot sequence never hits that, since routerBooting suppresses it until boot finishes.
  app.state.overviewFilters = ["pubs"];
  app.location.pathname = "/nearby/pubs/";
  app.state.userLocation = null;
  assert.match(app.overviewNearestHtml(), /<nav class="filter-rail"/, "no-location branch still shows the filter rail");
  assert.match(app.overviewNearestHtml(), /<h3 id="nearbyResultsHeading">Pubs &amp; bars nearby<\/h3>/, "no-location branch names the results");

  app.state.userLocation = makePoint(app, 51.9, 0.9); // far from any fixture data -- empty list
  assert.match(app.overviewNearestHtml(), /<h3 id="nearbyResultsHeading">Pubs &amp; bars nearby<\/h3>/, "empty-result branch names the results");

  app.location.pathname = "/";
});

test("the plain Nearby filter rail shows top-level categories with ticks for enabled groups", () => {
  resetData(app);
  app.location.pathname = "/nearby";
  app.state.overviewFilters = ["pubs", "trees"];
  const html = app.filterRailHtml();
  assert.match(html, /<nav class="filter-rail" aria-label="Filter nearby places">/);
  assert.match(html, /class="rail-pill rail-pill--all" type="button" data-rail-key="all-nearby" aria-pressed="false"/);
  assert.match(html, /class="rail-pill is-on" type="button" data-rail-key="nature" aria-pressed="true"/);
  assert.match(html, /data-rail-key="nature"[^>]*>[^<]*[\s\S]*?<span class="rail-check"/, "enabled groups show a tick");
  assert.match(html, /class="rail-pill is-on" type="button" data-rail-key="food" aria-pressed="true"/);
  assert.match(html, /data-rail-key="transport" aria-pressed="false"/, "the rail uses top-level groups");
  assert.match(html, /data-rail-key="transport"[^>]*>[\s\S]*?<span class="rail-check"[^>]*><\/span>/, "disabled groups reserve the indicator space without showing a close icon");
  const keys = [...html.matchAll(/data-rail-key="([a-z_]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, "no category appears twice");
  assert.ok(keys.includes("nature") && keys.includes("food"), "the top-level categories are in the row");
  app.location.pathname = "/";
  app.state.overviewFilters = [];
});

test("a category Nearby page shows its subcategories and ticks the enabled ones", () => {
  resetData(app);
  app.location.pathname = "/nearby/food/";
  app.state.overviewFilters = ["pubs", "cafes"];
  const html = app.filterRailHtml();
  assert.match(html, /data-rail-key="all-nearby"[^>]*aria-pressed="false"/);
  assert.deepEqual(Array.from(app.railPillKeys()), ["pubs", "restaurants", "cafes", "shops"]);
  assert.match(html, /data-rail-key="pubs"[^>]*aria-pressed="true"[\s\S]*?rail-check/);
  assert.match(html, /data-rail-key="cafes"[^>]*aria-pressed="true"[\s\S]*?rail-check/);
  assert.match(html, /data-rail-key="restaurants"[^>]*aria-pressed="false"/);
  assert.doesNotMatch(html, /data-rail-key="nature"/);
  app.location.pathname = "/";
  app.state.overviewFilters = [];
});

test("a filter set covering every category keeps every displayed pill pressed", () => {
  resetData(app);
  app.state.overviewFilters = app.FILTER_SUBFILTERS.map((sub) => sub.key);
  assert.equal(app.railSelection().length, 0);
  const html = app.filterRailHtml();
  assert.match(html, /class="rail-pill rail-pill--all is-on" type="button" data-rail-key="all-nearby" aria-pressed="true"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /class="rail-check"/);
  app.state.overviewFilters = [];
});

test("tapping a rail pill narrows to it, a second pill adds to it, and un-pressing the last returns to all filters, none of it saved", () => {
  resetData(app);
  app.location.pathname = "/nearby";
  app.location.search = "";
  app.state.overviewFilters = app.FILTER_SUBFILTERS.map((sub) => sub.key);
  app.toggleRailFilter("nature");
  assert.deepEqual(Array.from(app.state.overviewFilters), ["trees", "cows", "ponds_streams"]);
  assert.equal(app.state.overviewFiltersEphemeral, true, "a rail tap is a lens, not the reader's saved filters");
  assert.equal(app.location.pathname, "/nearby", "the plain Nearby rail stays at top-level groups");
  assert.equal(app.location.search, "?show=trees,cows,ponds_streams");
  app.state.nearbyRailGroupKey = "nature";
  app.toggleRailFilter("ponds_streams");
  assert.deepEqual(Array.from(app.state.overviewFilters), ["trees", "cows"]);
  assert.equal(app.location.pathname, "/nearby");
  assert.equal(app.location.search, "?show=trees,cows");
  app.location.pathname = "/nearby";
  app.state.nearbyRailGroupKey = null;
  app.toggleRailFilter("nature");
  assert.equal(app.railSelection().length, 0, "nothing chosen represents all filters");
  assert.equal(app.location.search, "?filters=false");
  app.state.overviewFilters = [];
  app.state.overviewFiltersEphemeral = false;
  app.location.pathname = "/";
  app.location.search = "";
});

test("the All nearby rail pill restores every category and the top-level rail", () => {
  resetData(app);
  app.location.pathname = "/nearby/food";
  app.location.search = "?show=pubs,cafes";
  app.state.nearbyRailGroupKey = "food";
  app.state.overviewFilters = ["pubs", "cafes"];
  app.toggleRailFilter("all-nearby");
  assert.equal(Array.from(app.state.overviewFilters).join(","), app.FILTER_SUBFILTERS.map((sub) => sub.key).join(","));
  assert.equal(app.state.nearbyRailGroupKey, null);
  assert.equal(app.location.pathname, "/nearby");
  assert.equal(app.location.search, "?filters=false");
  assert.match(app.filterRailHtml(), /data-rail-key="all-nearby"[^>]*aria-pressed="true"/);
  assert.equal(Array.from(app.railPillKeys()).join(","), app.FILTER_GROUPS.map((group) => group.key).join(","));
  app.state.overviewFilters = [];
  app.state.overviewFiltersEphemeral = false;
  app.state.nearbyRailGroupKey = undefined;
  app.location.pathname = "/";
  app.location.search = "";
});

test("landingPageCategoryLabel names the current /nearby/<slug> landing's own category, and selectOverview() uses it to head the screen \"Nearby <Category>\" instead of the generic \"Nearby\"", () => {
  resetData(app);

  app.location.pathname = "/nearby/pubs/";
  assert.equal(app.landingPageCategoryLabel(), "Pubs & bars");
  app.state.overviewFilters = ["pubs"];
  app.selectOverview();
  assert.equal(app.els.inspectorTitle.textContent, "Nearby Pubs & bars");
  assert.equal(app.documentStub.title, "Nearby Pubs & bars in Epping Forest | Epping Forest Finds");

  app.location.pathname = "/nearby/nature/";
  assert.equal(app.landingPageCategoryLabel(), "Nature");
  app.state.overviewFilters = ["trees", "ponds_streams"];
  app.selectOverview();
  assert.equal(app.els.inspectorTitle.textContent, "Nearby Nature");
  assert.equal(app.documentStub.title, "Nearby Nature in Epping Forest | Epping Forest Finds");

  // The plain, unfiltered Nearby screen -- and a reader's own filter choice from the Filters
  // screen, which lands on the same bare /nearby path -- names no single category to head with.
  app.location.pathname = "/nearby";
  assert.equal(app.landingPageCategoryLabel(), null);
  app.selectOverview();
  assert.equal(app.els.inspectorTitle.textContent, "Nearby");
  assert.equal(app.documentStub.title, "Nearby in Epping Forest | Epping Forest Finds");

  app.location.pathname = "/";
});

test("updateDocumentTitle names a selected place near Epping Forest", () => {
  resetData(app);
  app.state.selected = { type: "landmark", item: { name: "Hillside Tandoori" } };
  assert.equal(app.updateDocumentTitle(), "Hillside Tandoori near Epping Forest | Epping Forest Finds");
  assert.equal(app.documentStub.title, "Hillside Tandoori near Epping Forest | Epping Forest Finds");
  app.state.selected = null;
  app.updateDocumentTitle();
});

test("navigateInApp pushes a real history entry and applies the new route, instead of leaving it to the browser's own navigation", () => {
  resetData(app);
  app.location.pathname = "/find/the-forresters/";
  app.location.hash = "";

  app.navigateInApp("/nearby/cows/#near=51.650000%2C0.050000");

  assert.equal(app.location.pathname, "/nearby/cows/");
  assert.equal(app.location.hash, "#near=51.650000%2C0.050000");
  assert.equal(app.state.nearbyAnchor.latitude, 51.65, "the hash's position was actually applied, not just left in the URL");
  assert.equal(app.state.nearbyAnchor.longitude, 0.05);

  app.location.pathname = "/";
  app.location.hash = "";
});

test("navigateInApp does nothing when the target is already the current URL", () => {
  app.location.pathname = "/nearby/pubs/";
  app.location.hash = "";
  const depthBefore = app.history.length;
  app.navigateInApp("/nearby/pubs/");
  assert.equal(app.history.length, depthBefore, "no new history entry for a no-op navigation");
  app.location.pathname = "/";
});

test("arriving at a /nearby/<slug> page pre-filters Nearby to that category, taking priority over any ?show= param", () => {
  resetData(app);
  app.setOverviewFilters(["trees"]);
  app.location.pathname = "/nearby/pubs/";
  app.location.search = "?show=cafes";
  app.applyShowFilterFromQuery();
  assert.deepEqual(Array.from(app.state.overviewFilters), ["pubs"], "the path, not the query param, is the category page's own category");
  app.location.pathname = "/";
  app.location.search = "";
});

test("allEntriesForFilterKey lists every match for a filter with no origin and no distance, trees/water included", () => {
  resetData(app);
  app.state.landmarks.push(
    { id: "pub-a", name: "Pub A", category: "pub", ...makePoint(app, 0, 0) },
    { id: "cafe-a", name: "Cafe A", category: "cafe", ...makePoint(app, 0.01, 0.01) },
  );
  app.state.trees.push({ id: "tree-a", recordNumber: 1, commonName: "Oak", ...makePoint(app, 0.02, 0) });

  const pubs = app.allEntriesForFilterKey("pubs");
  assert.equal(pubs.length, 1);
  assert.equal(pubs[0].item.id, "pub-a");
  assert.equal(pubs[0].metres, undefined, "no origin means no distance");

  const trees = app.allEntriesForFilterKey("trees");
  assert.equal(trees.length, 1);
  assert.equal(trees[0].type, "tree");
});

test("without location, the Nearby list shows the category's full list when exactly one filter is active, not the generic prompt", () => {
  resetData(app);
  app.state.userLocation = null;
  app.state.landmarks.push(
    { id: "pub-a", name: "Pub A", category: "pub", ...makePoint(app, 0, 0) },
    { id: "pub-b", name: "Pub B", category: "pub", ...makePoint(app, 0.01, 0) },
  );
  app.setOverviewFilters(["pubs"]);

  const html = app.overviewNearestHtml();
  assert.ok(html.includes("Pub A") && html.includes("Pub B"), "both pubs are listed even with no location");
  assert.ok(!html.includes("Use your location to list the nearest"), "the generic prompt is not shown");
});

test("without location, the map also draws pins for every match of the one active filter, not just the list", () => {
  resetData(app);
  app.state.userLocation = null;
  const pubA = { id: "pub-a", name: "Pub A", category: "pub", ...makePoint(app, 0, 0) };
  const cafeA = { id: "cafe-a", name: "Cafe A", category: "cafe", ...makePoint(app, 0.01, 0) };
  app.state.landmarks.push(pubA, cafeA);
  app.setOverviewFilters(["pubs"]);

  const lookup = app.buildNearbyIconLookup();
  assert.equal(lookup.landmark.has(pubA), true, "the matching pub is in the drawable set");
  assert.equal(lookup.landmark.has(cafeA), false, "a place the active filter doesn't match stays out");
});

test("the no-location icon-lookup cache tells two different single filters apart instead of colliding", () => {
  resetData(app);
  app.state.userLocation = null;
  const pubA = { id: "pub-a", name: "Pub A", category: "pub", ...makePoint(app, 0, 0) };
  const cafeA = { id: "cafe-a", name: "Cafe A", category: "cafe", ...makePoint(app, 0.01, 0) };
  app.state.landmarks.push(pubA, cafeA);

  app.setOverviewFilters(["pubs"]);
  const pubsLookup = app.buildNearbyIconLookup();
  assert.equal(pubsLookup.landmark.has(pubA), true);

  app.setOverviewFilters(["cafes"]);
  const cafesLookup = app.buildNearbyIconLookup();
  assert.equal(cafesLookup.landmark.has(cafeA), true, "switching filters with no location still shows the new filter's own matches");
  assert.equal(cafesLookup.landmark.has(pubA), false, "not a stale copy of the previous filter's lookup");
  app.setOverviewFilters([]);
});

test("without location, the generic prompt still shows when no filter, or more than one, is active", () => {
  resetData(app);
  app.state.userLocation = null;
  app.state.landmarks.push({ id: "pub-a", name: "Pub A", category: "pub", ...makePoint(app, 0, 0) });

  app.setOverviewFilters([]);
  assert.match(app.overviewNearestHtml(), /Use your location to list the nearest/);

  app.setOverviewFilters(["pubs", "cafes"]);
  assert.match(app.overviewNearestHtml(), /Use your location to list the nearest/);
  app.setOverviewFilters([]);
});

test("fitMapToSingleFilterIfNoLocation fits the camera to every match, but only without location, with exactly one filter, and nothing already selected", () => {
  resetData(app);
  app.state.userLocation = null;
  app.state.selected = null;
  app.state.landmarks.push(
    { id: "pub-a", name: "Pub A", category: "pub", ...makePoint(app, 0, 0) },
    { id: "pub-b", name: "Pub B", category: "pub", ...makePoint(app, 0.05, 0.05) },
  );
  app.setOverviewFilters(["pubs"]);

  assert.equal(app.fitMapToSingleFilterIfNoLocation(), true, "fits when the conditions hold");

  app.state.userLocation = makePoint(app, 0, 0);
  assert.equal(app.fitMapToSingleFilterIfNoLocation(), false, "does nothing once a location exists");
  app.state.userLocation = null;

  app.setOverviewFilters(["pubs", "cafes"]);
  assert.equal(app.fitMapToSingleFilterIfNoLocation(), false, "does nothing with more than one active filter");
  app.setOverviewFilters(["pubs"]);

  app.state.selected = { type: "landmark", item: app.state.landmarks[0] };
  assert.equal(app.fitMapToSingleFilterIfNoLocation(), false, "never overrides a deep-linked selection's own framing");
  app.state.selected = null;
});

test("a /nearby/<slug> group page's several filters also get the full-list/fit treatment without location, unlike a reader's own multi-filter choice", () => {
  resetData(app);
  app.state.userLocation = null;
  app.state.selected = null;
  const pubA = { id: "pub-a", name: "Pub A", category: "pub", ...makePoint(app, 0, 0) };
  const cafeA = { id: "cafe-a", name: "Cafe A", category: "cafe", ...makePoint(app, 0.05, 0.05) };
  app.state.landmarks.push(pubA, cafeA);

  // A reader's own multi-filter choice (persist defaults to true) never takes this path --
  // already covered above, restated here for the contrast with the ephemeral case below.
  app.setOverviewFilters(["pubs", "cafes"]);
  assert.equal(app.activeFiltersShowFullListWithoutLocation(), false, "a deliberate choice is not a /nearby/<slug> arrival");
  assert.equal(app.fitMapToSingleFilterIfNoLocation(), false);
  assert.doesNotMatch(app.overviewNearestHtml(), /Pub A/);

  // The same two filters, but arrived at the way a /nearby/food group page actually sets them.
  app.setOverviewFilters(["pubs", "cafes"], { persist: false });
  assert.equal(app.activeFiltersShowFullListWithoutLocation(), true);
  assert.equal(app.fitMapToSingleFilterIfNoLocation(), true, "fits to every match across both filters");
  const html = app.overviewNearestHtml();
  assert.ok(html.includes("Pub A") && html.includes("Cafe A"), "both categories are listed, not just one");
  app.setOverviewFilters([]);
});

test("the 1-3 filter default state nobody chose never gets the full-list/fit treatment without location", () => {
  resetData(app);
  app.state.userLocation = null;
  app.state.selected = null;
  app.state.overviewFilters = app.DEFAULT_FILTERS.slice();
  app.state.overviewFiltersEphemeral = false;
  assert.equal(
    app.activeFiltersShowFullListWithoutLocation(),
    false,
    "the default filter set is never mistaken for a /nearby/<slug> arrival or a deliberate single choice"
  );
  assert.equal(app.fitMapToSingleFilterIfNoLocation(), false);
  app.state.overviewFilters = [];
});

test("applyDefaultLocation stands in for a real fix at DEFAULT_LOCATION, flagged so hasRealLocation can tell it apart", () => {
  resetData(app);
  app.state.userLocation = null;
  assert.equal(app.hasRealLocation(), false, "no fix at all is not a real one");

  app.applyDefaultLocation();
  assert.ok(app.state.userLocation, "a stand-in location is set");
  assert.equal(app.state.userLocation.latitude, app.DEFAULT_LOCATION.latitude);
  assert.equal(app.state.userLocation.longitude, app.DEFAULT_LOCATION.longitude);
  assert.equal(app.state.userLocation.isDefault, true, "flagged as the stand-in, not a real fix");
  assert.equal(app.hasRealLocation(), false, "the stand-in is still not a real fix");

  // Runs through the same pipeline as a real fix (applyLocationFix), so distance-based state
  // used elsewhere (Nearby list, nearest-tree/cow/pub text) is already populated from it.
  assert.equal(app.state.userInMapArea, false, "no forest bounds loaded in this test, same as a real fix would see");

  app.state.userLocation = { ...makePoint(app, 51.6, 0.03), isDefault: false };
  assert.equal(app.hasRealLocation(), true, "a real fix has no isDefault flag at all");
});

test("applyDefaultLocation keeps the normal radius, but never overrides a deliberate one", () => {
  resetData(app);
  app.state.userLocation = null;
  app.state.walkingDistanceMinutes = app.DEFAULT_WALKING_DISTANCE_MINUTES;
  app.applyDefaultLocation();
  assert.equal(app.state.walkingDistanceMinutes, app.DEFAULT_WALKING_DISTANCE_MINUTES, "High Beach starts at the normal walking radius");

  resetData(app);
  app.state.userLocation = null;
  app.state.walkingDistanceMinutes = 8; // e.g. an explicit ?radius=8 already applied
  app.applyDefaultLocation();
  assert.equal(app.state.walkingDistanceMinutes, 8, "a radius already set by something else is left alone");

  resetData(app);
  app.state.userLocation = null;
  app.state.walkingDistanceMinutes = app.LANDING_PAGE_WALKING_DISTANCE_MINUTES;
  app.applyDefaultLocation();
  assert.equal(app.state.walkingDistanceMinutes, app.LANDING_PAGE_WALKING_DISTANCE_MINUTES, "already-30 from the landing-page default is left alone too");
});

test("the Nearby heading's own type line says it is measuring from High Beach while the stand-in is active, and says nothing once a real fix replaces it", () => {
  resetData(app);
  app.state.overviewFilters = ["trees"];
  app.state.trees.push({ id: "t1", commonName: "Nearby tree", ...makePoint(app, 0.0005, 0) });

  // Built directly with the isDefault flag (same as the "hasRealLocation" test above) rather
  // than via applyDefaultLocation(), which would centre on DEFAULT_LOCATION's real-world
  // coordinates -- far outside this fixture tree's synthetic (0,0)-based test coordinates.
  app.state.userLocation = { ...makePoint(app, 0, 0), isDefault: true };
  assert.match(
    app.overviewHeadingText(),
    /of High Beach$/,
    "explains why the list is centred on High Beach, not just the one-time dismissible gate -- folded into the type line, not a separate sentence in the list body"
  );
  assert.doesNotMatch(app.overviewNearestHtml(), /Showing things near High Beach/, "no longer a separate sentence in the list body");

  app.state.userLocation = makePoint(app, 0, 0);
  assert.doesNotMatch(
    app.overviewHeadingText(),
    /High Beach/,
    "a real fix needs no explanation for where the list is centred"
  );
});

test("drawUser never draws the \"You\" dot for the default location, only for a real fix", () => {
  resetData(app);
  let arcCalls = 0;
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() { arcCalls += 1; }, fill() {}, stroke() {}, fillText() {},
    createRadialGradient() { return { addColorStop() {} }; },
  };
  const identityToScreen = (point) => point;

  app.state.userLocation = makePoint(app, 51.6, 0.03);
  app.state.userLocation.isDefault = true;
  app.state.userInMapArea = true;
  app.drawUser(ctx, identityToScreen, false);
  assert.equal(arcCalls, 0, "the High Beach stand-in must never be drawn as \"You\"");

  app.state.userLocation = makePoint(app, 51.6, 0.03);
  app.state.userInMapArea = true;
  app.drawUser(ctx, identityToScreen, false);
  assert.equal(arcCalls, 1, "a real fix is drawn as before");
});

test("nearby heading-up viewport shows the whole walking-radius circle, leaving the corners outside it", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };

  app.alignHeadingUpNavigationViewport();

  const rect = app.bestVisibleCanvasRect();
  const userScreen = app.worldToScreen(app.state.userLocation.point);
  for (const point of app.walkingRadiusCirclePoints()) {
    const screen = app.worldToScreen(point);
    assert.ok(
      screen.x >= rect.x && screen.x <= rect.x + rect.width
      && screen.y >= rect.y && screen.y <= rect.y + rect.height,
      "every point on the radius circle should be inside the visible map area",
    );
  }

  // ...and the corners of the map area sit outside the circle, so they show the
  // out-of-radius treatment rather than more in-radius ground.
  const radiusPx = app.walkingRadiusWorldUnits() * app.state.viewport.scale;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
  for (const corner of corners) {
    assert.ok(
      Math.hypot(corner.x - userScreen.x, corner.y - userScreen.y) > radiusPx,
      "each corner of the map area should fall outside the walking-radius circle",
    );
  }
});

test("nearby heading-up zoom is not dragged in by a location right next to the user", () => {
  // Fourth-and-final round of this bug: rather than clamping individual matches out to the
  // walking radius before fitting them, the Nearby camera no longer fits matches at all --
  // it frames the radius circle, which cannot be pulled in by a point at the user's feet.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };
  // A tree essentially at the user's feet (~1m away) used to force an enormous scale to fit
  // that tiny distance against the focus-rect margin -- the "loads zoomed in so far you can't
  // see any locations" bug.
  app.state.trees.push({ id: "at-feet-tree", commonName: "At-feet tree", ...makePoint(app, 0.00001, 0.00001) });

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const atFeetScale = app.maxScaleForHeadingUpPoints([app.state.trees[0].point], focus, focusRect);
  const ringScale = app.maxScaleForHeadingUpPoints(app.walkingRadiusCirclePoints(), focus, focusRect, { projectTilt: true });

  app.alignHeadingUpNavigationViewport();

  // The applied scale is the ring fit with the standard zoom-buffer ratio applied (see
  // HEADING_UP_SCALE_BUFFER_RATIO / resolveHeadingUpTargetScale) -- an exact match here (not
  // just an upper bound) proves the fit followed the circle rather than merely staying under
  // some looser ceiling by coincidence.
  const bufferedExpected = ringScale * 0.96;
  assert.ok(
    Math.abs(app.state.viewport.scale - bufferedExpected) < bufferedExpected * 0.001,
    `expected buffered scale ~${bufferedExpected}, got ${app.state.viewport.scale}`,
  );
  assert.ok(
    ringScale < atFeetScale / 100,
    "framing the circle should avoid the near-infinite scale fitting the at-feet tree would demand",
  );
});

test("nearby filter updates trigger a heading-up refit that keeps the radius circle centred", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 100, ty: 100 };
  app.state.trees.push({ id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.0012, 0) });
  app.state.landmarks.push({ id: "ahead-pub", name: "Ahead Pub", category: "pub", ...makePoint(app, 0.0016, 0.0008) });

  app.state.overviewFilters = ["trees", "pubs"];
  app.ensureOverviewTargetsVisible({ animate: true, durationMs: 300 });

  assert.ok(app.state.viewportAnimationTo, "changing filters should start a nearby refit");

  app.state.viewport = { ...app.state.viewportAnimationTo };
  app.state.viewportAnimationTo = null;

  const rect = app.bestVisibleCanvasRect();
  const userScreen = app.worldToScreen(app.state.userLocation.point);
  assert.ok(
    Math.abs(userScreen.x - (rect.x + rect.width / 2)) < 1
    && Math.abs(userScreen.y - (rect.y + rect.height / 2)) < 1,
    "the flat nearby refit centres the user, and with them the radius circle",
  );
});

test("generated tree chunks cover the full veteran tree register", () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "trees", "index.json"), "utf8"));
  const chunkCount = index.chunks.reduce((sum, chunk) => sum + chunk.count, 0);

  assert.equal(index.recordCount, chunkCount);
  assert.ok(index.recordCount > 0, "tree register should contain records");
  assert.ok(index.chunks.length > 1, "tree data should be split across multiple chunks");
  for (const chunk of index.chunks) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", chunk.url)), `${chunk.url} should exist`);
  }
});

test("nearest list falls back to one closest item for each active type outside the walking radius", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees", "cows", "pubs", "cafes", "bus"];
  addFixtureData(app);

  const entries = app.overviewItemsForActiveFilter();

  assert.equal(app.state.overviewOutsideRadiusFallback, true);
  assert.equal(JSON.stringify(entries.map((entry) => entry.kind).sort()), JSON.stringify(["bus", "cafes", "cow", "pubs", "tree"]));
  assert.ok(entries.every((entry) => entry.metres > app.walkingDistanceToMetres(app.state.walkingDistanceMinutes)));
});

test("nearest list uses in-radius matches before fallback", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees", "pubs"];
  addFixtureData(app);
  app.state.landmarks.push({ id: "near-pub", name: "Near pub", category: "pub", ...makePoint(app, 0.001, 0) });

  const entries = app.overviewItemsForActiveFilter();

  assert.equal(app.state.overviewOutsideRadiusFallback, false);
  // Now returns 2: one in-radius pub, and one fallback tree (since no trees in radius)
  assert.equal(entries.length, 2);
  assert.equal(entries.filter(e => e.kind === "pubs")[0].item.id, "near-pub");
  assert.equal(entries.filter(e => e.kind === "tree")[0].outOfRadius, true);
});

test("the nearby list ranks what you are facing above what is behind you at the same distance", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0; // facing north
  app.state.overviewFilters = ["trees"];
  // Same distance from the user, opposite sides: one due north (dead ahead), one due south.
  app.state.trees.push(
    { id: "behind-tree", commonName: "Behind tree", ...makePoint(app, -0.001, 0) },
    { id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.001, 0) }
  );

  const order = app.headsUpSortedEntries(app.overviewItemsForActiveFilter()).map((entry) => entry.item.id);

  // .join, not deepEqual: arrays mapped from the vm sandbox carry the sandbox's Array prototype.
  assert.equal(order.join(","), "ahead-tree,behind-tree");
});

test("the nearby list still puts a much closer find first, even when it is behind you", () => {
  // Heads-up ordering biases the list, it does not override it: distance stays the dominant
  // term, so something at your back that you could reach in seconds is not pushed below a
  // far-off one you happen to be pointed at.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0; // facing north
  app.state.overviewFilters = ["trees"];
  app.state.trees.push(
    { id: "far-ahead-tree", commonName: "Far ahead", ...makePoint(app, 0.003, 0) },
    { id: "close-behind-tree", commonName: "Close behind", ...makePoint(app, -0.0005, 0) }
  );

  const order = app.headsUpSortedEntries(app.overviewItemsForActiveFilter()).map((entry) => entry.item.id);

  assert.equal(order.join(","), "close-behind-tree,far-ahead-tree");
});

test("without a compass heading the nearby list is ordered by plain distance", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = null; // desktop, or location without orientation
  app.state.overviewFilters = ["trees"];
  app.state.trees.push(
    { id: "behind-tree", commonName: "Behind tree", ...makePoint(app, -0.0009, 0) },
    { id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.001, 0) }
  );

  const entries = app.overviewItemsForActiveFilter();
  const order = app.headsUpSortedEntries(entries).map((entry) => entry.item.id);

  assert.equal(order.join(","), "behind-tree,ahead-tree", "nearest first, exactly as before");
  assert.equal(app.headsUpSortedEntries(entries), entries, "and the memoized array is handed straight back");
});

test("heads-up ordering never mutates the memoized nearby item list the map also reads", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.overviewFilters = ["trees"];
  app.state.trees.push(
    { id: "behind-tree", commonName: "Behind tree", ...makePoint(app, -0.0009, 0) },
    { id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.001, 0) }
  );

  const entries = app.overviewItemsForActiveFilter();
  const distanceOrder = entries.map((entry) => entry.item.id);
  const headsUpOrder = app.headsUpSortedEntries(entries).map((entry) => entry.item.id);

  assert.notEqual(headsUpOrder.join(","), distanceOrder.join(","), "sanity: this fixture should actually reorder");
  assert.equal(entries.map((entry) => entry.item.id).join(","), distanceOrder.join(","), "the shared array keeps its distance order");
});

test("a find you are walking at climbs into the listed handful past closer ones behind you", () => {
  // The order is applied to the whole in-radius set before the display cap, not to the top few
  // by distance -- otherwise the item you are pointed at can never reach the list at all.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0; // facing north
  app.state.overviewFilters = ["trees"];
  app.state.nearestItemsCount = 2;
  app.state.trees.push(
    { id: "behind-1", commonName: "Behind one", ...makePoint(app, -0.0004, 0) },
    { id: "behind-2", commonName: "Behind two", ...makePoint(app, -0.00045, 0) },
    { id: "behind-3", commonName: "Behind three", ...makePoint(app, -0.0005, 0) },
    { id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.0006, 0) }
  );

  const html = app.overviewNearestHtml();
  app.state.nearestItemsCount = 10;

  assert.match(html, /Ahead tree/, "the tree dead ahead makes the visible list");
  assert.doesNotMatch(html, /Behind three/, "the third one at your back does not");
});

test("the nearby list only re-sorts once you have actually turned", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 40;

  assert.equal(app.nearbyListHeading(), 40, "the first heading is adopted straight away");
  assert.equal(app.syncNearbyListHeading(), false, "and re-syncing it changes nothing");

  app.state.compassHeading = 40 + app.HEADS_UP_REORDER_DEGREES - 1; // sensor noise / a small sway
  assert.equal(app.syncNearbyListHeading(), false);
  assert.equal(app.nearbyListHeading(), 40, "the list stays ordered by the settled heading");

  app.state.compassHeading = 40 + app.HEADS_UP_REORDER_DEGREES + 1; // a deliberate turn
  assert.equal(app.syncNearbyListHeading(), true);
  assert.equal(app.nearbyListHeading(), 40 + app.HEADS_UP_REORDER_DEGREES + 1);
});

test("fallback notice names the selected walking distance", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees"];
  app.state.walkingDistanceMinutes = 10;
  addFixtureData(app);

  const html = app.overviewNearestHtml();

  assert.match(html, /Nothing found within 10 min walking distance/);
  assert.match(html, /Showing the closest match for each selected type instead/);
});

test("walking radius marker still draws when nearest results use fallback", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees"];
  addFixtureData(app);
  app.overviewItemsForActiveFilter();
  assert.equal(app.state.overviewOutsideRadiusFallback, true);

  let arcCount = 0;
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    rect() {},
    arc() { arcCount += 1; },
    fill() {},
    fillRect() {},
    stroke() {},
    setLineDash() {},
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };

  app.drawWalkingRadius(ctx);

  // One arc for the dimming cutout, one for the rim highlight stroke traced inside it.
  assert.equal(arcCount, 2);
});

test("walking radius stays at the camera focus during the cinematic location handoff", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.viewport = { scale: 1000, tx: 0, ty: 0 };
  app.state.locationRevealAnimationActive = true;
  app.state.viewportAnimationTo = { scale: 1200, tx: 500, ty: 400 };
  app.state.locationRevealFocusPoint = { x: 500, y: 400 };

  const arcs = [];
  app.drawWalkingRadius({
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    rect() {},
    arc(x, y, radius) { arcs.push({ x, y, radius }); },
    fill() {},
    stroke() {},
    createLinearGradient() { return { addColorStop() {} }; },
  });

  assert.equal(arcs.length, 2);
  assert.equal(arcs[0].x, 500, "the dimming cutout stays centred on the camera focus");
  assert.equal(arcs[0].y, 400, "the dimming cutout stays centred on the camera focus");
  assert.ok(arcs[0].radius < 100, "the handoff should not inflate the radius while moving its centre");
});

test("walking radius dimming keeps a crisp edge without a canvas blur filter", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  const drawn = { arcs: 0, fills: 0 };

  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    rect() {},
    arc() { drawn.arcs += 1; },
    fill() { drawn.fills += 1; },
    stroke() {},
    createLinearGradient() { return { addColorStop() {} }; },
    set filter(value) { throw new Error(`walking-radius blur is not allowed: ${value}`); },
  };

  app.drawWalkingRadius(ctx);
  assert.ok(drawn.arcs > 0 && drawn.fills > 0, "the ring and its dimming are actually drawn (so the no-blur check above covered real drawing)");
});

test("walking radius marker hides in selected-detail mode", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { ...makePoint(app, 0.001, 0) } };

  let arcCount = 0;
  app.drawWalkingRadius({
    save() {},
    restore() {},
    beginPath() {},
    arc() { arcCount += 1; },
    fill() {},
    stroke() {},
    setLineDash() {},
  });

  assert.equal(arcCount, 0);
});

test("landmark emoji falls back to useful type icons before location pointer", () => {
  assert.match(app.landmarkEmoji({ category: "parking", categoryTags: ["parking"] }), /landmark-parking\.png/);
  assert.match(app.landmarkEmoji({ category: "bench", categoryTags: ["bench"] }), /landmark-bench\.png/);
  assert.match(app.landmarkEmoji({ category: "toilets", categoryTags: ["toilets"] }), /landmark-toilets\.png/);
  assert.match(app.landmarkEmoji({ category: "gate", categoryTags: ["gate"] }), /gate\.png/);
  assert.match(app.landmarkEmoji({ category: "chemist", categoryTags: ["chemist"] }), /medicine\.png/);
  assert.equal(app.landmarkEmoji({ category: "yes", categoryTags: ["yes", "cafe"] }), "☕");
  assert.equal(app.landmarkEmoji({ category: "something_unclear", categoryTags: ["something_unclear"] }), "📍");
});

test("the categories that used to draw as a bare emoji now have artwork of their own", () => {
  // These were 609 of 6,048 places -- memorials as a candle glyph, plaques as
  // a red pushpin -- painted straight onto the map with no pointer behind
  // them, which is what made them read as a different kind of marker.
  // `npm run audit:icons` is the standing count.
  const { landmarkIconSlug, iconPath } = app;
  const expected = {
    memorial: "landmark-memorial",
    bicycle_parking: "landmark-bicycle-parking",
    picnic_site: "landmark-picnic",
    viewpoint: "landmark-viewpoint",
    telephone: "landmark-telephone",
    alcohol: "shop",
    chemist: "medicine",
  };

  for (const [category, slug] of Object.entries(expected)) {
    const place = { category, categoryTags: [category] };
    assert.equal(landmarkIconSlug(place), slug, `${category} should use the ${slug} icon`);
    assert.ok(iconPath(slug), `${slug} must be a real icon in the registry`);
    // What the map actually draws, tag rules and filter buckets together.
    assert.equal(app.placeIconSlug(place), slug, `${category} should still draw ${slug} once the filters have had their say`);
  }
});

test("the subfilter keys FILTER_GROUPS offers all classify something", () => {
  // matchesPlaceFilter switched on a different vocabulary from the one the
  // filter chips use, so "Historic sites", "Monuments", "Churches" and
  // "Campsites" matched nothing: they hid every place they were meant to show
  // and their icons could never be reached.
  const { matchesPlaceFilter, PLACE_FILTER_KEYS } = app;
  const samples = [
    { category: "memorial", categoryTags: ["memorial"] },
    { category: "monument", categoryTags: ["monument"] },
    { category: "place_of_worship", categoryTags: ["place_of_worship"] },
    { category: "camp_site", categoryTags: ["camp_site"] },
    { category: "plaque", folkloreCategory: "plaque", folkloreTopics: ["blue_plaque"], categoryTags: ["plaque", "blue_plaque"] },
  ];

  for (const key of ["historic", "monuments", "churches", "campsites", "plaques"]) {
    assert.ok(PLACE_FILTER_KEYS.has(key), `${key} should be one of the filter chips`);
    assert.ok(
      samples.some((place) => matchesPlaceFilter(place, key)),
      `no place can ever match the ${key} filter`
    );
  }
});

test("a broad history bucket never takes a pin from a place with artwork of its own", () => {
  // `historic` matches anything with a historic flavour at all. Swept with
  // the rest of the filters it handed an archaeological site the generic
  // scroll, so it is held back until landmarkIconSlug has had its say.
  const { placeIconSlug, matchesPlaceFilter } = app;
  const dig = { category: "archaeological_site", categoryTags: ["archaeological_site"] };
  const museum = { category: "museum", categoryTags: ["museum"] };
  const folkloreOnly = { category: "history", folkloreCategory: "history", categoryTags: [] };

  assert.ok(matchesPlaceFilter(dig, "historic"), "a dig is still a historic site for the filter chip");
  assert.equal(placeIconSlug(dig), "landmark-archaeological");
  assert.equal(placeIconSlug(museum), "landmark-museum");
  assert.equal(placeIconSlug(folkloreOnly), "historic", "with nothing more specific, the bucket does apply");

  // `monuments` is the same shape of problem: it is labelled "monuments and
  // memorials" and covers both, so held back it lets each keep its own pin.
  const memorial = { category: "memorial", categoryTags: ["memorial"] };
  const stone = { category: "boundary_stone", categoryTags: ["boundary_stone"] };
  const unnamedMonument = { category: "monument", folkloreCategory: "monument", categoryTags: [] };

  assert.ok(matchesPlaceFilter(memorial, "monuments"), "a memorial is still under the Monuments chip");
  assert.equal(placeIconSlug(memorial), "landmark-memorial");
  assert.equal(placeIconSlug(stone), "landmark-monument");
  assert.equal(placeIconSlug(unnamedMonument), "landmark-monument");
});

test("a place's topic gives it a pin when nothing more specific describes it", () => {
  // No filter chip offers royal, science, politics or social history, so
  // nothing reached their icons: crown, science, politics, social-history and
  // celebrities sat in the registry while their places drew the generic
  // castle the broad `historic` bucket hands out.
  const { placeIconSlug } = app;
  const royal = { category: "history", folkloreCategory: "history", categoryTags: ["royal_history"], folkloreTopics: ["royal"] };
  const scientific = { category: "history", folkloreCategory: "history", categoryTags: ["science"] };

  assert.equal(placeIconSlug(royal), "crown");
  assert.equal(placeIconSlug(scientific), "science");

  // But a topic never overrides what the place actually is.
  const viewpoint = { category: "viewpoint", categoryTags: ["viewpoint", "science"] };
  const church = { category: "place_of_worship", categoryTags: ["place_of_worship", "royal_history"], folkloreTopics: ["royal"] };
  assert.equal(placeIconSlug(viewpoint), "landmark-viewpoint");
  assert.equal(placeIconSlug(church), "church");
});

test("the Nearby list entry kind names a filter chip, so it never decides an icon", () => {
  // resolvePlaceKind restated the classification order itself and answered
  // "landmark" for anything the filter predicates did not claim. The list
  // drew its icon from that kind, and filterKindEmoji("landmark") is a bare
  // pushpin, so a gate was listed as a plain pin beside its own artwork on
  // the map. The kind now names the type label only.
  const { resolvePlaceKind, placeLabelFilterKey } = app;
  const gate = { category: "gate", categoryTags: ["gate"] };
  const memorial = { category: "memorial", categoryTags: ["memorial"] };
  const bluePlaque = {
    category: "plaque", folkloreCategory: "plaque",
    folkloreTopics: ["blue_plaque"], categoryTags: ["blue_plaque", "plaque", "art"],
  };

  assert.equal(resolvePlaceKind(gate), "landmark", "nothing claims a gate, so it has no chip");
  assert.equal(resolvePlaceKind(memorial), "monuments");

  // blue_plaques leads the icon priority so a blue plaque draws the roundel,
  // but the only chip is "Plaques" -- the label has to fall back to it or all
  // 62 plaques read "Place".
  assert.equal(app.placeIconSlug(bluePlaque), "blue-plaques");
  assert.equal(placeLabelFilterKey(bluePlaque), "plaques");
  assert.equal(resolvePlaceKind(bluePlaque), "plaques");
});

test("the Nearby list shows a place the same pin the map draws for it", () => {
  // landmarkEmoji consulted the filter buckets before the tag rules, so it
  // could disagree with the pin beside it: an archaeological site listed
  // under the generic castle while the map drew the amphora.
  const { landmarkEmoji, placeIconSlug, iconPath } = app;
  const samples = [
    { category: "archaeological_site", categoryTags: ["archaeological_site"] },
    { category: "memorial", categoryTags: ["memorial"] },
    { category: "museum", categoryTags: ["museum"] },
    { category: "bicycle_parking", categoryTags: ["bicycle_parking"] },
    { category: "gate", categoryTags: ["gate"] },
    { category: "bench", categoryTags: ["bench"] },
    { category: "viewpoint", categoryTags: ["viewpoint"] },
    { category: "picnic_site", categoryTags: ["picnic_site"] },
    { category: "information", categoryTags: ["information"] },
  ];

  for (const place of samples) {
    const slug = placeIconSlug(place);
    assert.ok(slug, `${place.category} should resolve to an icon`);
    assert.match(
      landmarkEmoji(place),
      new RegExp(iconPath(slug).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${place.category} should be listed with the same ${slug} pin the map draws`
    );
  }
});

test("a blue plaque draws as a plaque rather than whatever topic it is also tagged with", () => {
  // Jacob Epstein's blue plaque is tagged `art`, and with the plaque keys
  // missing from the priority list it drew an artist's palette on the map.
  const { placePrimaryFilterKey, filterKindIconSlug } = app;
  const epstein = {
    name: "Blue Plaque: Sir Jacob Epstein",
    category: "plaque",
    folkloreCategory: "plaque",
    folkloreTopics: ["blue_plaque"],
    categoryTags: ["blue_plaque", "plaque", "heritage_plaque", "art"],
  };

  assert.equal(placePrimaryFilterKey(epstein), "blue_plaques");
  assert.equal(filterKindIconSlug(placePrimaryFilterKey(epstein)), "blue-plaques");
  assert.equal(app.placeIconSlug(epstein), "blue-plaques");
});

test("overview GPS updates keep the user centered even before a compass heading arrives", () => {
  resetData(app);
  const previous = makePoint(app, 0, 0).point;
  app.state.userLocation = makePoint(app, 0.2, 0.2);
  app.state.viewport = { scale: 1000, tx: 500, ty: 400 };
  app.state.compassHeading = null; // no compass fix yet -- must not block re-centering

  // Mirrors ensureLocationWatch()'s watchPosition callback: the anchored fit runs first,
  // and keepOverviewCenteredOnUser is a no-op companion call once it has -- it now defers
  // to alignHeadingUpNavigationViewport (via nearbyNavigationAnchorActive) as soon as a
  // location fix exists, not only once a compass heading is also known.
  const changed = app.alignHeadingUpNavigationViewport();
  const afterAlign = { ...app.state.viewport };
  app.keepOverviewCenteredOnUser(previous);

  assert.equal(changed, true, "moving 0.2 degrees should update the viewport");
  assert.deepEqual(app.state.viewport, afterAlign, "keepOverviewCenteredOnUser should not fight the anchored fit");
  const userScreen = app.worldToScreen(app.state.userLocation.point);
  const focus = app.nearbyNavigationFocusPoint();
  assert.equal(Math.round(userScreen.x), Math.round(focus.x), "user should land on the nearby anchor point");
  assert.equal(Math.round(userScreen.y), Math.round(focus.y), "user should land on the nearby anchor point");
});

test("first location fix immediately scales and centers nearby map icons", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.viewport = { scale: 8, tx: 120, ty: 120 };
  app.state.trees.push({ id: "near-tree", commonName: "Near tree", ...makePoint(app, 0.001, 0) });
  app.state.landmarks.push({ id: "near-pub", name: "Near pub", category: "pub", ...makePoint(app, 0.0012, 0.0008) });

  app.selectOverview();
  app.ensureOverviewTargetsVisible({ animate: false });
  const fittedScale = app.state.viewport.scale;
  app.keepOverviewCenteredOnUser(null);
  const lookup = app.buildNearbyIconLookup();
  const treePoint = app.worldToScreen(app.state.trees[0].point);

  assert.equal(app.state.viewportAnimationTo, null);
  assert.ok(fittedScale > 8, "nearby targets should zoom in from the initial full-map scale");
  assert.ok(app.state.viewport.scale > 8, "first location centering should not stay at full-map scale");
  assert.ok(app.state.viewport.scale <= fittedScale, "user-centered scale may be capped to keep nearby icons visible");
  assert.equal(lookup.tree.has(app.state.trees[0]), true);
  assert.equal(lookup.landmark.has(app.state.landmarks[0]), true);
  // Foraging mode anchors to nearest trees — tree is always visible
  assert.equal(app.isNearCanvas(treePoint, 10), true, JSON.stringify({ treePoint, viewport: app.state.viewport }));
});

test("filter screen with active filters zooms to fit only filtered items, not all locations", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.viewport = { scale: 8, tx: 120, ty: 120 };
  app.state.trees.push({ id: "near-tree", commonName: "Near tree", ...makePoint(app, 0.001, 0) });
  app.state.landmarks.push({ id: "near-pub", name: "Near pub", category: "pub", ...makePoint(app, 0.0012, 0.0008) });

  app.state.filterScreenOpen = true;
  app.state.overviewFilters = ["pubs"];
  app.ensureOverviewTargetsVisible({ animate: false });
  const pubPoint = app.worldToScreen(app.state.landmarks[0].point);

  assert.ok(app.state.viewport.scale > 8, "filter screen should zoom in from the initial full-map scale");
  assert.equal(app.isNearCanvas(pubPoint, 16), true, JSON.stringify({ pubPoint, viewport: app.state.viewport }));
});

test("filter screen with no active filters falls through to foraging zoom (nearest trees)", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.viewport = { scale: 8, tx: 120, ty: 120 };
  app.state.trees.push({ id: "near-tree", commonName: "Near tree", ...makePoint(app, 0.001, 0) });
  app.state.trees.push({ id: "near-tree-2", commonName: "Near tree 2", ...makePoint(app, 0.0015, 0) });
  app.state.landmarks.push({ id: "far-pub", name: "Far pub", category: "pub", ...makePoint(app, 5, 5) });

  app.state.filterScreenOpen = true;
  // no overviewFilters set — falls through to foraging mode
  app.ensureOverviewTargetsVisible({ animate: false });
  const treePoint = app.worldToScreen(app.state.trees[0].point);

  assert.ok(app.state.viewport.scale > 8, "should zoom in to tree level, not stay at full-map scale");
  assert.equal(app.isNearCanvas(treePoint, 10), true, JSON.stringify({ treePoint, viewport: app.state.viewport }));
});

test("returning to nearby view with nothing inside the walking radius zooms in to fit the radius, not a stale zoomed-out scale", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  app.state.walkingDistanceMinutes = 5;
  app.els.canvas.width = 1000;
  app.els.canvas.height = 800;
  // Only a landmark far outside the walking radius matches the active filter, so nothing
  // is highlighted within the radius to fit.
  app.state.landmarks.push({ id: "far-pub", name: "Far pub", category: "pub", ...makePoint(app, 55, 5) });
  app.state.overviewFilters = ["pubs"];
  // filterScreenOpen is false and selected is null (both set by resetData) — this is the
  // plain Nearby view with the filter still applied, i.e. what's active right after tapping
  // "Nearby" from the Filters screen (goToInitialView does not clear overviewFilters).
  // The viewport starts far zoomed out, as it would be left after Filters previewed the
  // far-away pub via its "show all matches regardless of radius" preview.
  app.state.viewport = { scale: 0.001, tx: 0, ty: 0 };

  app.ensureOverviewTargetsVisible({ animate: false });

  const radiusMetres = app.walkingDistanceToMetres(app.state.walkingDistanceMinutes);
  const edgeWorld = app.projectLonLat(
    app.state.userLocation.longitude + (radiusMetres / (111320 * Math.cos(app.state.userLocation.latitude * Math.PI / 180))),
    app.state.userLocation.latitude
  );
  const center = app.worldToScreen(app.state.userLocation.point);
  const edge = app.worldToScreen(edgeWorld);
  const radiusPx = Math.hypot(edge.x - center.x, edge.y - center.y);
  const canvasWidth = app.els.canvas.width;
  const canvasHeight = app.els.canvas.height;

  assert.ok(app.state.viewport.scale > 1, "should zoom in from the stale, far-zoomed-out scale");
  // The radius should now fill a meaningful portion of the screen instead of staying a
  // speck at the old scale, and (mirroring the existing "radius always fully visible"
  // tests) stay within the canvas rather than spilling off the edges.
  // The radius should fill a good portion of the *available* canvas area, accounting for
  // the inspector panel. With inspector open (assumeInspectorOpen: true), the available
  // area is reduced. Use a more lenient check: radius should be at least 80px, which is
  // a reasonable minimum for visibility in both full and inspector-constrained layouts.
  assert.ok(
    radiusPx > 80,
    `radius circle should be substantially visible, got ${radiusPx}px`
  );
  assert.ok(center.x - radiusPx >= -1, `left edge of radius circle off screen: ${center.x - radiusPx}`);
  assert.ok(center.x + radiusPx <= canvasWidth + 1, `right edge of radius circle off screen: ${center.x + radiusPx} > ${canvasWidth}`);
  assert.ok(center.y - radiusPx >= -1, `top edge of radius circle off screen: ${center.y - radiusPx}`);
  assert.ok(center.y + radiusPx <= canvasHeight + 1, `bottom edge of radius circle off screen: ${center.y + radiusPx} > ${canvasHeight}`);
});

test("settings screen zooms to fit only filtered items, same as filter screen", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.viewport = { scale: 8, tx: 120, ty: 120 };
  app.state.trees.push({ id: "near-tree", commonName: "Near tree", ...makePoint(app, 0.001, 0) });
  app.state.landmarks.push({ id: "near-pub", name: "Near pub", category: "pub", ...makePoint(app, 0.0012, 0.0008) });

  app.state.selected = { type: "settings", item: null };
  app.state.overviewFilters = ["pubs"];
  app.ensureOverviewTargetsVisible({ animate: false });
  const pubPoint = app.worldToScreen(app.state.landmarks[0].point);

  assert.ok(app.state.viewport.scale > 8, "settings screen should zoom in from the initial full-map scale");
  assert.equal(app.isNearCanvas(pubPoint, 16), true, JSON.stringify({ pubPoint, viewport: app.state.viewport }));
});

test("report screen zooms to fit only filtered items, same as filter screen", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.viewport = { scale: 8, tx: 120, ty: 120 };
  app.state.trees.push({ id: "near-tree", commonName: "Near tree", ...makePoint(app, 0.001, 0) });
  app.state.landmarks.push({ id: "near-pub", name: "Near pub", category: "pub", ...makePoint(app, 0.0012, 0.0008) });

  app.state.selected = { type: "report", item: null };
  app.state.overviewFilters = ["pubs"];
  app.ensureOverviewTargetsVisible({ animate: false });
  const pubPoint = app.worldToScreen(app.state.landmarks[0].point);

  assert.ok(app.state.viewport.scale > 8, "report screen should zoom in from the initial full-map scale");
  assert.equal(app.isNearCanvas(pubPoint, 16), true, JSON.stringify({ pubPoint, viewport: app.state.viewport }));
});

test("GPS updates keep re-centering the map on settings and report screens, not just overview", () => {
  resetData(app);
  const previous = makePoint(app, 0, 0).point;
  app.state.userLocation = makePoint(app, 0.2, 0.2);
  app.state.viewport = { scale: 1000, tx: 500, ty: 400 };
  app.state.selected = { type: "settings", item: null };

  // Same call pattern as ensureLocationWatch()'s watchPosition callback (see the overview
  // version of this test above for why keepOverviewCenteredOnUser alone no longer re-fits).
  const changed = app.alignHeadingUpNavigationViewport();
  app.keepOverviewCenteredOnUser(previous);

  assert.equal(changed, true, "large movement should re-fit the settings screen too");
});

test("walking radius marker draws on the report (feedback) screen", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "report", item: null };

  let arcCount = 0;
  app.drawWalkingRadius({
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    rect() {},
    arc() { arcCount += 1; },
    fill() {},
    fillRect() {},
    stroke() {},
    setLineDash() {},
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
  });

  // One arc for the dimming cutout, one for the rim highlight stroke traced inside it.
  assert.equal(arcCount, 2);
});

test("nothing draws a route line until a destination is actually selected", () => {
  // A dashed line from the user to every nearby match used to be drawn on the Nearby, Filters,
  // Settings and Report screens alike; a fan of them to a dozen pins crowded the map and implied
  // a walk nobody had chosen. drawSelectedRoute is now the only thing that draws one, so a route
  // line always means "this is the destination you picked". The `map-with-location` e2e snapshot
  // is the visual guard; this pins the removal itself so the drawing code can't quietly return.
  assert.equal(typeof app.drawOverviewRoutes, "undefined", "ambient overview route lines are gone");
  assert.equal(typeof app.overviewRouteTargets, "undefined", "and so is the target list that fed them");
});

test("minimized inspector preserves user-controlled map position on GPS updates", () => {
  resetData(app);
  const previous = makePoint(app, 0, 0).point;
  app.state.userLocation = makePoint(app, 0.2, 0.2);
  app.state.viewport = { scale: 1000, tx: 123, ty: 456 };
  app.els.inspector.classList.add("minimized");

  app.keepOverviewCenteredOnUser(previous);

  assert.equal(app.state.viewportAnimationTo, null);
  assert.deepEqual(app.state.viewport, { scale: 1000, tx: 123, ty: 456 });
});

test("a GPS fix or compass tick while Search is open leaves the camera on the search fit, not the Nearby ring", () => {
  // alignHeadingUpNavigationViewport is the walking-radius ring's own framing, applied directly
  // (no animation) and reached both from every watchPosition fix -- nearbyNavigationAnchorActive()
  // is true throughout Search, same as plain Nearby, since neither has a real selection -- and
  // from ensureOverviewTargetsVisible, which every other caller (compass ticks, filter changes)
  // routes through under the same condition. Before this test's fix, any of those silently
  // snapped a still-open search back to the ring, sometimes long after the search's own fit
  // (updateSearchHighlight/fitSearchCameraToHighlight) had settled.
  resetSearchData(app);
  app.els.inspector.classList.remove("minimized");
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  app.state.landmarks.push({ id: "far-pub", name: "Distant Forest Tavern", category: "pub", categoryTags: ["pub"], ...makePoint(app, 0.3, 0.3) });
  app.state.searchScreenOpen = true;
  app.searchResultsHtml("distant forest tavern");
  assert.ok(app.state.searchHighlightResults.length > 0);

  // Settle the search's own (debounced) fit first, exactly as a real session would before any
  // GPS fix arrives.
  app.fitSearchCameraToHighlight();
  assert.ok(app.state.viewportAnimationTo, "the search fit should have started a camera animation");
  app.state.viewport = { ...app.state.viewportAnimationTo };
  app.state.viewportAnimationTo = null;
  const searchViewport = { ...app.state.viewport };

  // Sanity check: with Search closed, this same call *does* re-fit to the ring (it is not
  // simply inert) -- proving the guard below is what's holding it back, not some other reason.
  app.state.searchScreenOpen = false;
  const changedOutsideSearch = app.alignHeadingUpNavigationViewport();
  assert.equal(changedOutsideSearch, true, "sanity: this call really does move the camera outside Search");
  app.state.searchScreenOpen = true;
  app.state.viewport = { ...searchViewport };

  const changed = app.alignHeadingUpNavigationViewport();

  assert.equal(changed, false, "should decline to touch the camera while Search has results");
  assert.deepEqual(app.state.viewport, searchViewport, "and leave it exactly on the search fit");
});

test("heading-up viewport alignment defers when camera transition is pending", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "near-tree", ...makePoint(app, 0.001, 0) } };
  app.state.compassHeading = 90;
  app.state.viewport = { scale: 1000, tx: 123, ty: 456 };
  app.state.selectionViewportTransitionPending = true;

  const changed = app.alignHeadingUpNavigationViewport();

  assert.equal(changed, false);
  assert.equal(app.state.viewport.scale, 1000);
  assert.equal(app.state.viewport.tx, 123);
  assert.equal(app.state.viewport.ty, 456);
});

test("heading-up viewport alignment preserves animation target when rotation starts", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "near-tree", ...makePoint(app, 0.001, 0) } };
  app.state.compassHeading = 90;
  app.state.viewport = { scale: 1000, tx: 123, ty: 456 };

  app.animateToHeadingUpNavigationViewport(500);
  const target = { ...app.state.viewportAnimationTo };

  const changed = app.alignHeadingUpNavigationViewport();

  assert.ok(app.state.headingUpEntryAnim, "heading-up rotation should animate in");
  assert.equal(app.state.viewportAnimationDuration, 500);
  assert.equal(app.state.viewportAnimationTo.scale, target.scale);
  assert.equal(app.state.viewportAnimationTo.tx, target.tx);
  assert.equal(app.state.viewportAnimationTo.ty, target.ty);
  assert.equal(changed, false);
  assert.equal(app.state.viewport.scale, 1000);
  assert.equal(app.state.viewport.tx, 123);
  assert.equal(app.state.viewport.ty, 456);
});

test("the very first heading-up activation this session shows the heading directly instead of spinning in from north", () => {
  resetData(app);
  app.state.headingUpEverEntered = false;
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "near-tree", ...makePoint(app, 0.001, 0) } };
  app.state.compassHeading = 90;

  app.animateToHeadingUpNavigationViewport(500);

  assert.equal(app.state.headingUpEntryAnim, null, "boot already waited for a trusted heading, so there is nothing to animate from");
  assert.equal(app.state.renderedNavigationHeading, 90, "the map should simply show the heading it already has");
  assert.equal(app.state.headingUpEverEntered, true);
});

test("a later heading-up activation still spins in from north as before", () => {
  resetData(app);
  app.state.headingUpEverEntered = true; // set by the first activation earlier this session
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "near-tree", ...makePoint(app, 0.001, 0) } };
  app.state.compassHeading = 90;

  app.animateToHeadingUpNavigationViewport(500);

  assert.ok(app.state.headingUpEntryAnim, "a re-activation (e.g. a new destination) still animates in");
  assert.equal(app.state.renderedNavigationHeading, 0);
});

test("the very first nearby heading-up activation this session shows the heading directly", () => {
  resetData(app);
  app.state.headingUpEverEntered = false;
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90; // no selection -> nearbyHeadingUpActive()

  app.prepareCanvasForDraw();

  assert.equal(app.state.headingUpEntryAnim, null);
  assert.equal(app.state.renderedNavigationHeading, 90);
  assert.equal(app.state.headingUpEverEntered, true);
});

test("heading-up nearby zoom changes wait for compass settle before applying", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.001, 0) });
  app.state.compassHeading = 0;
  const seeded = seedViewportAtHeadingUpAnchor(app, 10);

  app.state.compassLastEventAt = Date.now();
  const changedDuringCompassUpdates = app.alignHeadingUpNavigationViewport();

  assert.equal(changedDuringCompassUpdates, false, "active compass updates should defer heading-up zoom changes");
  assert.equal(app.state.viewport.scale, 10, "scale should hold steady while the compass is still updating");
  assert.equal(app.state.viewport.tx, seeded.tx);
  assert.equal(app.state.viewport.ty, seeded.ty);

  app.state.compassLastEventAt = Date.now() - 1000;
  const changedAfterCompassSettles = app.alignHeadingUpNavigationViewport();

  assert.equal(changedAfterCompassSettles, true, "heading-up zoom should apply once compass updates settle");
  assert.ok(app.state.viewport.scale > 10, "settled compass should allow the delayed zoom fit");
});

test("heading-up nearby zoom updates immediately when force flag is set (returning from filter screen)", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.001, 0) });
  app.state.compassHeading = 0;
  app.state.viewport = { scale: 10, tx: 500, ty: 440 };

  // Compass is actively firing — would normally defer zoom-in
  app.state.compassLastEventAt = Date.now();
  const changedWithForce = app.alignHeadingUpNavigationViewport({ force: true });

  assert.equal(changedWithForce, true, "force flag should bypass compass-settle deferral");
  assert.ok(app.state.viewport.scale > 10, "scale should update immediately when force=true even with active compass");
});

test("heading-up selected zoom changes wait for compass settle before applying", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "ahead-tree", ...makePoint(app, 0.0025, 0) } };
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.viewport = { scale: 3000, tx: 500, ty: 420 };

  app.state.compassLastEventAt = Date.now() - 1000;
  app.alignHeadingUpNavigationViewport();
  const settledScale = app.state.viewport.scale;
  const settledTx = app.state.viewport.tx;
  const settledTy = app.state.viewport.ty;
  const userPoint = app.state.userLocation.point;

  const activeScale = settledScale * 1.03;
  app.state.viewport.scale = activeScale;
  app.state.viewport.tx = settledTx + (settledScale - activeScale) * userPoint.x;
  app.state.viewport.ty = settledTy + (settledScale - activeScale) * userPoint.y;

  app.state.compassLastEventAt = Date.now();
  const changedDuringCompassUpdates = app.alignHeadingUpNavigationViewport();

  assert.equal(changedDuringCompassUpdates, false, "active compass updates should defer small selected-view zoom corrections");
  assert.equal(app.state.viewport.scale, activeScale, "selected-view scale should hold while the compass is still updating");

  app.state.compassLastEventAt = Date.now() - 1000;
  const changedAfterCompassSettles = app.alignHeadingUpNavigationViewport();

  assert.equal(changedAfterCompassSettles, true, "selected-view zoom correction should apply once compass updates settle");
  assert.ok(app.state.viewport.scale < activeScale, "settled compass should apply the delayed selected-view fit");
});

// Regression coverage for the maxHeadingUpNavigationScale / maxNearbyHeadingUpScale
// consolidation: both used to independently duplicate the same ~45 lines of bounding-box
// scale-fit math (margin calc, rotation, per-point min-scale accumulation, tilt behind-heading
// handling). They now both delegate to the shared maxScaleForHeadingUpPoints() helper,
// differing only in their point source and emptiness guard. These tests pin down the shared
// math directly, then prove each wrapper is a pure pass-through to it for its own point source.
test("maxScaleForHeadingUpPoints returns the tightest scale that keeps every point inside the focus rect", () => {
  resetData(app);
  app.state.userLocation = { latitude: 0, longitude: 0, point: { x: 0, y: 0 } };
  // compassHeading stays null (headingUpActive() false), so rotation is 0 and
  // rotatedX/rotatedY equal the raw dx/dy -- keeps the geometry easy to hand-verify.
  const focus = { x: 500, y: 400 };
  const focusRect = { x: 0, y: 0, width: 1000, height: 800 };
  // margin = min(1000, 800) * 0.06 + 12 * dpr(1) = 60; left=60 right=940 top=60 bottom=740
  const points = [
    { x: 400, y: 0 },    // rotatedX>0: (940-500)/400 = 1.1   <- tightest
    { x: -300, y: 0 },   // rotatedX<0: (60-500)/-300 = 1.4667
    { x: 0, y: -200 },   // rotatedY<0: (60-400)/-200 = 1.7
    { x: 0, y: 250 },    // rotatedY>0, tilt inactive: (740-400)/250 = 1.36
  ];

  const maxScale = app.maxScaleForHeadingUpPoints(points, focus, focusRect);

  assert.ok(Math.abs(maxScale - 1.1) < 1e-9, `expected 1.1, got ${maxScale}`);
});

test("maxScaleForHeadingUpPoints constrains a behind-the-user point horizontally as well as vertically", () => {
  // The behind branch used to `continue` straight past the horizontal constraint, so anything
  // behind and off to one side was fitted only by how far below the pivot it sat and could be
  // drawn well past the left/right edge. Surfaced by the Filter screen's fit, which reaches for
  // the nearest match of each selected filter however far away it is.
  resetData(app);
  app.state.userLocation = { latitude: 0, longitude: 0, point: { x: 0, y: 0 } };
  const focus = { x: 500, y: 400 };
  const focusRect = { x: 0, y: 0, width: 1000, height: 800 };
  // margin = min(1000, 800) * 0.06 + 12 * dpr(1) = 60; right = 940, bottom = 740.
  // Behind (rotatedY > 0) and far to the right: the vertical constraint alone would allow
  // (740 - 400) / 10 = 34, at which the point would be drawn 400 * 34 = 13600px to the
  // right. The horizontal constraint is (940 - 500) / 400 = 1.1.
  const behindAndRight = [{ x: 400, y: 10 }];

  const maxScale = app.maxScaleForHeadingUpPoints(behindAndRight, focus, focusRect);

  assert.ok(Math.abs(maxScale - 1.1) < 1e-9, `expected the horizontal constraint (1.1), got ${maxScale}`);
});

test("maxScaleForHeadingUpPoints excludes behind-the-user points only while tilt is active", () => {
  resetData(app);
  app.state.userLocation = { latitude: 0, longitude: 0, point: { x: 0, y: 0 } };
  app.state.compassHeading = 0; // finite + no selected target -> nearbyHeadingUpActive()
  const focus = { x: 500, y: 400 };
  const focusRect = { x: 0, y: 0, width: 1000, height: 800 };
  // A single close "behind" point (rotatedY>0): if excluded, nothing constrains the fit.
  const behindPoint = [{ x: 0, y: 10 }];

  app.state.tiltBetaSmoothed = 20; // > TILT_BETA_THRESHOLD (12) -> tiltActive() true
  const withTiltActive = app.maxScaleForHeadingUpPoints(behindPoint, focus, focusRect);
  assert.equal(withTiltActive, null, "behind point should be fully excluded while tilt is active");

  app.state.tiltBetaSmoothed = 0; // tiltActive() false
  const withTiltInactive = app.maxScaleForHeadingUpPoints(behindPoint, focus, focusRect);
  // (bottom - focus.y) / rotatedY = (740 - 400) / 10 = 34, well under the fitScale*180 cap
  assert.ok(Math.abs(withTiltInactive - 34) < 1e-9, `expected 34, got ${withTiltInactive}`);
});

test("maxScaleForHeadingUpPoints({ excludeBehindDuringTilt: false }) keeps constraining the fit against behind-the-user points even while tilt is active", () => {
  // The selected navigation destination (and its route) stay visible even when behind the
  // user's heading during full tilt -- see isBehindTiltHeading's spec exemption -- so the fit
  // must keep framing them there too, unlike the nearby-mode item cluster tested above (which
  // genuinely is hidden, and must keep being excluded -- the test above is untouched by this
  // option and still passes with its default/omitted excludeBehindDuringTilt).
  resetData(app);
  app.state.userLocation = { latitude: 0, longitude: 0, point: { x: 0, y: 0 } };
  app.state.compassHeading = 0;
  const focus = { x: 500, y: 400 };
  const focusRect = { x: 0, y: 0, width: 1000, height: 800 };
  const behindPoint = [{ x: 0, y: 10 }];

  app.state.tiltBetaSmoothed = 20; // tiltActive() true
  const result = app.maxScaleForHeadingUpPoints(behindPoint, focus, focusRect, { excludeBehindDuringTilt: false });
  // Same (bottom - focus.y) / rotatedY = (740 - 400) / 10 = 34 as the tilt-inactive case
  // above -- excludeBehindDuringTilt: false means tiltActive() no longer matters for this point.
  assert.ok(Math.abs(result - 34) < 1e-9, `expected 34, got ${result}`);
});

test("selectedNavigationTargetBearingOffsetRadians resolves the destination's bearing relative to straight ahead", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90; // facing east -> "ahead" is east

  // Dead ahead: target due east of the user.
  app.state.selected = { type: "tree", item: { id: "ahead", ...makePoint(app, 0, 0.001) } };
  assert.ok(Math.abs(app.selectedNavigationTargetBearingOffsetRadians() - 0) < 1e-9, "target due east while facing east should be dead ahead (0)");

  // Dead behind: target due west of the user.
  app.state.selected = { type: "tree", item: { id: "behind", ...makePoint(app, 0, -0.001) } };
  assert.ok(Math.abs(Math.abs(app.selectedNavigationTargetBearingOffsetRadians()) - Math.PI) < 1e-9, "target due west while facing east should be dead behind (±π)");

  // Directly to a side: target due north of the user (a left turn while facing east).
  app.state.selected = { type: "tree", item: { id: "side", ...makePoint(app, 0.001, 0) } };
  assert.ok(Math.abs(Math.abs(app.selectedNavigationTargetBearingOffsetRadians()) - Math.PI / 2) < 1e-9, "target due north while facing east should be directly to a side (±π/2)");

  // No user location, no selection, or the target sitting exactly on the user's own
  // position all have no meaningful bearing to report.
  app.state.userLocation = null;
  assert.equal(app.selectedNavigationTargetBearingOffsetRadians(), null, "no user location -> null");
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = null;
  assert.equal(app.selectedNavigationTargetBearingOffsetRadians(), null, "no selection -> null");
  app.state.selected = { type: "tree", item: { id: "same-spot", ...makePoint(app, 0, 0) } };
  assert.equal(app.selectedNavigationTargetBearingOffsetRadians(), null, "target exactly at the user's own position -> null");
});

test("headingUpAnchorFraction mirrors the selected-navigation anchor around the screen centre based on the destination's bearing, but leaves nearby's anchor untouched", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90; // facing east
  app.state.tiltBetaSmoothed = 85; // TILT_BETA_MAX -> the full max-tilt anchor (0.94/0.88) applies

  const aheadAnchor = 0.94; // HEADING_UP_ANCHOR_NEARBY_TILT, reused here as the "ahead" selected anchor's sibling value would differ (0.88) -- computed below instead of hardcoded twice

  // Dead ahead (target due east): matches the plain tilt-ramped anchor exactly, same as
  // before this feature existed.
  app.state.selected = { type: "tree", item: { id: "ahead", ...makePoint(app, 0, 0.001) } };
  const plainSelectedAnchor = 0.88; // HEADING_UP_ANCHOR_SELECTED_TILT, at t=1 (beta=85)
  assert.ok(Math.abs(app.headingUpAnchorFraction(true) - plainSelectedAnchor) < 1e-9,
    `dead-ahead anchor should equal the plain tilt-ramped anchor (${plainSelectedAnchor}), got ${app.headingUpAnchorFraction(true)}`);

  // Dead behind (target due west): mirrors to 1 - anchor, i.e. most of the room now sits
  // below the user instead of above.
  app.state.selected = { type: "tree", item: { id: "behind", ...makePoint(app, 0, -0.001) } };
  assert.ok(Math.abs(app.headingUpAnchorFraction(true) - (1 - plainSelectedAnchor)) < 1e-9,
    `dead-behind anchor should mirror to 1 - ${plainSelectedAnchor}, got ${app.headingUpAnchorFraction(true)}`);

  // Directly to a side (target due north): lands at the screen's vertical centre.
  app.state.selected = { type: "tree", item: { id: "side", ...makePoint(app, 0.001, 0) } };
  assert.ok(Math.abs(app.headingUpAnchorFraction(true) - 0.5) < 1e-9,
    `side anchor should land at the centre (0.5), got ${app.headingUpAnchorFraction(true)}`);

  // Nearby mode has no single destination to adapt toward -- its anchor must stay exactly
  // the plain tilt-ramped value regardless of whatever "selected" happens to be sitting in
  // state (defensive: confirms the bearing adaptation is scoped to isSelected only).
  assert.ok(Math.abs(app.headingUpAnchorFraction(false) - aheadAnchor) < 1e-9,
    `nearby anchor should be unaffected by any selected-target bearing, got ${app.headingUpAnchorFraction(false)}`);
});

test("maxHeadingUpNavigationScale actually fits a destination that is behind the user during full 3D tilt, instead of leaving the stale current scale in place", () => {
  // Regression test for the "not much screen space available" complaint: previously,
  // maxScaleForHeadingUpPoints excluded behind-the-user points from the fit whenever tilt
  // was active -- including the selected destination itself, which (unlike nearby's item
  // cluster) stays visible when behind. That left the zoom entirely unconstrained by the
  // destination in exactly the case that needed it most. maxHeadingUpNavigationScale must
  // now pass excludeBehindDuringTilt: false so a behind destination still drives the fit.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90; // facing east
  app.state.tiltBetaSmoothed = 60; // tiltActive() true, not max
  // Destination due west (behind, given heading 90/east) and close enough that fitting it
  // demands a real scale change from the arbitrary "stale" scale set below.
  app.state.selected = { type: "tree", item: { id: "behind", ...makePoint(app, 0, -0.0005) } };
  app.state.viewport = { scale: 123456, tx: 0, ty: 0 }; // a deliberately wrong "stale" scale

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.navigationFocusPoint();
  const result = app.maxHeadingUpNavigationScale(focus, focusRect);

  assert.notEqual(result, 123456, "should compute a real fit from the behind destination, not fall back to the stale current scale");
  assert.ok(Number.isFinite(result) && result > 0, "should be a sane, finite, positive scale");
});

test("maxHeadingUpNavigationScale falls back to the current viewport scale with no selected target", () => {
  resetData(app);
  app.state.userLocation = { latitude: 0, longitude: 0, point: { x: 0, y: 0 } };
  app.state.selected = null;
  app.state.viewport.scale = 12345;

  const result = app.maxHeadingUpNavigationScale({ x: 500, y: 400 }, { x: 0, y: 0, width: 1000, height: 800 });

  assert.equal(result, 12345);
});

test("maxNearbyHeadingUpScale falls back to the current viewport scale when there is nothing to fit", () => {
  resetData(app);
  app.state.userLocation = null; // nearbyCameraFitPoints() returns [] with no user location
  app.state.viewport.scale = 54321;

  const result = app.maxNearbyHeadingUpScale({ x: 500, y: 400 }, { x: 0, y: 0, width: 1000, height: 800 });

  assert.equal(result, 54321);
});

test("maxHeadingUpNavigationScale delegates to the shared heading-up scale helper", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "target-tree", ...makePoint(app, 0.001, 0.0005) } };
  const focus = { x: 500, y: 400 };
  const focusRect = { x: 0, y: 0, width: 1000, height: 800 };

  const points = app.selectedNavigationTargetPoints();
  // selectedNavigationTargetPoints now fits the whole routed line rather than the bare
  // destination, so this fixture yields the straight-line fallback (user -> tree) while the
  // routing graph is unbuilt. What matters for THIS test is only that whatever it returns is
  // what maxHeadingUpNavigationScale fits.
  assert.ok(points.length >= 1, "fixture selection should produce something to fit");
  assert.deepEqual(
    [points[points.length - 1].x, points[points.length - 1].y],
    [app.state.selected.item.point.x, app.state.selected.item.point.y],
    "the fitted points must end at the destination"
  );
  const expected = app.maxScaleForHeadingUpPoints(points, focus, focusRect);
  const actual = app.maxHeadingUpNavigationScale(focus, focusRect);

  assert.equal(actual, expected);
});

test("maxNearbyHeadingUpScale fits the walking-radius ring, not the highlighted items", () => {
  // Rounds 1-3 of the zoom saga all tried to fit the item cluster and cap it somehow: against a
  // fixed scale ratio, then against the full radius circle, then by extending each match out to
  // the radius distance along its own bearing. Every version had the camera chasing whichever
  // matches happened to be nearest. The Nearby view now frames the radius circle and nothing
  // else, which is both what the screen is about and a fit that cannot be dragged around.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.overviewFilters = ["trees"];
  app.state.walkingDistanceMinutes = 5; // ~417m radius
  app.state.trees.push(
    { id: "close-tree", commonName: "Close tree", ...makePoint(app, 0.00001, 0.00001) }, // ~1.5m away
    { id: "far-tree", commonName: "Far tree", ...makePoint(app, 0.006, -0.006) }, // ~940m away, outside the radius
  );
  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();

  const ringScale = app.maxScaleForHeadingUpPoints(app.walkingRadiusCirclePoints(), focus, focusRect, { projectTilt: true });

  assert.deepEqual(
    app.nearbyCameraFitPoints(),
    app.walkingRadiusCirclePoints(),
    "the Nearby screen fits the ring alone",
  );
  assert.equal(app.maxNearbyHeadingUpScale(focus, focusRect), ringScale);
});

test("maxNearbyHeadingUpScale keeps a usable scale in full 3D, where the behind half of the ring is culled from the view", () => {
  // The 3D "far too zoomed out" report: with the pivot anchored near the bottom of the screen
  // at tilt, forcing the behind half of the ring into the few pixels below it collapsed the
  // scale. 3D does not draw anything behind the user (isBehindTiltHeading), so only the ahead
  // half constrains the fit.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.tiltBetaSmoothed = 85; // full tilt
  assert.ok(app.tiltActive(), "fixture should actually be in full 3D");

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const ringPoints = app.walkingRadiusCirclePoints();

  const wholeRingScale = app.maxScaleForHeadingUpPoints(ringPoints, focus, focusRect, {
    excludeBehindDuringTilt: false,
    projectTilt: true,
  });
  const actual = app.maxNearbyHeadingUpScale(focus, focusRect);

  assert.ok(Number.isFinite(actual) && actual > 0, "should be a sane, finite, positive scale");
  assert.ok(
    wholeRingScale == null || actual > wholeRingScale * 1.5,
    `3D should zoom in well past the collapsed whole-ring fit (actual=${actual}, wholeRing=${wholeRingScale})`,
  );
});

test("in 3D the nearby camera frames past the edges of the walking radius instead of fitting the whole ring on screen", () => {
  // The "too zoomed out in 3D" report: fitting the ahead half of the ring exactly put its left
  // and right extremes on the screen edges, so the search area read as a small disc of forest
  // with its own boundary drawn round it. First-person 3D zooms in past that by
  // NEARBY_TILT_FIT_ZOOM, ramped in with the tilt.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const ringPoints = app.walkingRadiusCirclePoints();

  app.state.tiltBetaSmoothed = 0; // flat 2D
  assert.equal(app.nearbyFirstPersonFitZoom(false), 1, "2D is about seeing the whole ring, so it is untouched");
  assert.equal(
    app.maxNearbyHeadingUpScale(focus, focusRect),
    app.maxScaleForHeadingUpPoints(ringPoints, focus, focusRect, { projectTilt: true }),
  );

  app.state.tiltBetaSmoothed = 85; // full 3D
  const tiltFocus = app.nearbyNavigationFocusPoint();
  const plainFit = app.maxScaleForHeadingUpPoints(ringPoints, tiltFocus, focusRect, { projectTilt: true });
  assert.ok(Math.abs(app.nearbyFirstPersonFitZoom(false) - app.NEARBY_TILT_FIT_ZOOM) < 1e-9, "at max tilt the full zoom applies");
  assert.ok(
    Math.abs(app.maxNearbyHeadingUpScale(tiltFocus, focusRect) - plainFit * app.NEARBY_TILT_FIT_ZOOM) < 1e-6,
    "full 3D frames past the ring edges",
  );
});

test("browsing a tapped spot in 3D keeps framing the whole nearest area rather than zooming into it", () => {
  // The first-person zoom is about what is ahead of *you*. A browsed spot has no "ahead" -- the
  // pivot is a place being looked at and its whole area has to stay on screen.
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.compassHeading = 0;
  app.state.tiltBetaSmoothed = 85;

  assert.equal(app.nearbyFirstPersonFitZoom(true), 1);
});

test("maxNearbyHeadingUpScale does not depend on the compass heading, so the camera holds still while you turn", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = null;
  app.state.overviewFilters = ["trees"];
  app.state.trees.push({ id: "t1", commonName: "Tree 1", ...makePoint(app, 0.001, 0.001) });

  const focusRect = { x: 0, y: 0, width: 1000, height: 800 };
  const focus = { x: 500, y: 400 };
  const scales = [0, 45, 90, 217].map((heading) => {
    app.state.compassHeading = heading;
    app.state.renderedNavigationHeading = heading;
    return app.maxNearbyHeadingUpScale(focus, focusRect);
  });

  for (const scale of scales) {
    // Not exactly equal: the ring is sampled as a 64-gon, so rotating it moves the constraining
    // sample by ~0.12% -- far inside resolveHeadingUpTargetScale's 2% settle tolerance, so the
    // viewport genuinely does not move. See walkingRadiusCirclePoints.
    assert.ok(Math.abs(scale - scales[0]) < scales[0] * 0.002, `heading should not change the fit (${scales.join(", ")})`);
  }
});

test("nearby and the filter screen both zoom out past the walking radius to reach the nearest match of every selected filter", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.walkingDistanceMinutes = 5; // ~417m radius
  // Both selected kinds sit well outside the walking radius, so the ring alone would leave
  // them off the map entirely.
  app.state.trees.push({ id: "far-tree", recordNumber: 903, commonName: "Far tree", ...makePoint(app, 0.012, 0.004) });
  app.state.landmarks.push({ id: "far-pub", name: "Far Pub", category: "pub", ...makePoint(app, -0.004, -0.011) });

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();

  // Baseline: no filters at all, so nothing is out-of-radius and the ring is the whole fit.
  app.setOverviewFilters([]);
  app.stopViewportAnimation();
  const ringOnlyScale = app.maxNearbyHeadingUpScale(focus, focusRect);

  // setOverviewFilters, not a direct assignment: reaching past the ring is a response to the
  // user switching a filter on (refreshOutOfRadiusReveal), not a standing camera property.
  app.setOverviewFilters(["trees", "pubs"]);
  app.stopViewportAnimation();
  const nearbyPoints = app.nearbyCameraFitPoints();
  const nearbyScale = app.maxNearbyHeadingUpScale(focus, focusRect);

  app.state.filterScreenOpen = true;
  const filterPoints = app.nearbyCameraFitPoints();
  const filterScale = app.maxNearbyHeadingUpScale(focus, focusRect);
  app.state.filterScreenOpen = false;

  for (const point of [app.state.trees[0].point, app.state.landmarks[0].point]) {
    assert.ok(
      filterPoints.some((p) => p.x === point.x && p.y === point.y),
      "the nearest match of each selected filter should be part of the filter-screen fit",
    );
    // The Nearby screen reaches them too: a filter with nothing inside the ring is exactly
    // the case where the list shows an out-of-radius fallback, and the map has to agree.
    assert.ok(
      nearbyPoints.some((p) => p.x === point.x && p.y === point.y),
      "and part of the plain Nearby fit, since neither filter has anything inside the ring",
    );
  }
  assert.ok(
    nearbyScale < ringOnlyScale,
    `Nearby should zoom out past the ring-only fit (nearby=${nearbyScale}, ringOnly=${ringOnlyScale})`,
  );
  assert.ok(
    filterScale <= nearbyScale * 1.001,
    `the filter screen should reach at least as far (filter=${filterScale}, nearby=${nearbyScale})`,
  );
});

test("the filter screen with nothing selected frames the walking radius, the same as the Nearby screen", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.selected = null;
  app.state.filterScreenOpen = true;
  app.state.overviewFilters = [];
  app.state.trees.push({ id: "far-tree", commonName: "Far tree", ...makePoint(app, 0.02, 0.02) });

  // .length, not deepEqual against a host []: arrays built inside the vm sandbox have the
  // sandbox's own Array prototype, which deepStrictEqual treats as a mismatch.
  assert.equal(app.nearestSelectedFilterPoints().length, 0, "no selected filters means nothing extra to reach for");
  assert.deepEqual(app.nearbyCameraFitPoints(), app.walkingRadiusCirclePoints());
});

test("an expanded cluster's camera fit is the group's own members, not the floor-sized ring", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  // ~2m apart -- tighter than the walking-radius floor (~21m, WALKING_RADIUS_TIGHT_MIN_MINUTES)
  // ever lets the ring itself frame, which is exactly what left a tight cluster unable to
  // visually separate no matter how many times its badge was tapped.
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65000018, 0.0500) };
  app.state.trees.push(oak1, oak2);

  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);

  const points = app.nearbyCameraFitPoints();
  assert.equal(points.length, 2, "exactly the group's own two members, not the ring's circumference samples");
  assert.ok(points.includes(oak1.point) && points.includes(oak2.point),
    "the fit points are exactly the tapped trees' own world points");
});

test("resizing the walking radius from a screen other than Nearby re-derives which locations the map highlights", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 10; // ~833m radius
  // Two pubs: one a short walk away, one just past a 5-minute (~417m) ring but inside a
  // 10-minute one.
  const nearPub = { id: "near-pub", name: "Near Pub", category: "pub", ...makePoint(app, 0.001, 0) };
  const midPub = { id: "mid-pub", name: "Mid Pub", category: "pub", ...makePoint(app, 0.006, 0) };
  app.state.landmarks.push(nearPub, midPub);
  app.setOverviewFilters(["pubs"]);

  for (const openScreen of [
    () => { app.state.filterScreenOpen = true; },
    () => { app.state.selected = { type: "settings", item: null }; },
    () => { app.state.selected = { type: "report", item: null }; },
    () => { app.state.searchScreenOpen = true; },
  ]) {
    resetSecondaryScreens(app);
    openScreen();

    const wide = app.buildNearbyIconLookup();
    assert.equal(wide.landmark.has(midPub), true, "the 10-minute ring holds both pubs");

    app.applyWalkingRadiusChange(5, { animate: false });
    const tight = app.buildNearbyIconLookup();
    assert.equal(tight.landmark.has(nearPub), true, "the near pub is still inside the tightened ring");
    assert.equal(
      tight.landmark.has(midPub),
      false,
      "shrinking the radius from a secondary screen drops what it no longer covers",
    );

    app.applyWalkingRadiusChange(10, { animate: false });
    assert.equal(
      app.buildNearbyIconLookup().landmark.has(midPub),
      true,
      "and growing it back brings the newly in-range pub straight back",
    );
  }
  resetSecondaryScreens(app);
});

test("a screen other than Nearby also highlights the nearest match it zooms out past the ring to reach", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 5; // ~417m radius
  const farPub = { id: "far-pub", name: "Far Pub", category: "pub", ...makePoint(app, 0.02, 0) };
  app.state.landmarks.push(farPub);
  app.setOverviewFilters(["pubs"]);

  const nearby = app.buildNearbyIconLookup();
  assert.equal(nearby.landmark.has(farPub), false, "the Nearby screen draws the ring's contents only");

  app.state.filterScreenOpen = true;
  const filters = app.buildNearbyIconLookup();
  app.state.filterScreenOpen = false;

  const fitPoints = app.nearestSelectedFilterPoints();
  assert.ok(
    fitPoints.some((p) => p.x === farPub.point.x && p.y === farPub.point.y),
    "sanity: the camera reaches past the ring for it",
  );
  assert.equal(filters.landmark.has(farPub), true, "so the map highlights it rather than framing empty ground");
  assert.equal(filters.outOfRadius.has(farPub), true, "and records that it is outside the ring, though it is drawn at full strength");
});

test("the nearest match a secondary screen reaches for is measured from the browsed spot, like the ring is", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 5;
  const northPub = { id: "north-pub", name: "North Pub", category: "pub", ...makePoint(app, 0.02, 0) };
  const southPub = { id: "south-pub", name: "South Pub", category: "pub", ...makePoint(app, -0.05, 0) };
  app.state.landmarks.push(northPub, southPub);
  app.setOverviewFilters(["pubs"]);
  app.state.filterScreenOpen = true;

  assert.equal(
    app.buildNearbyIconLookup().landmark.has(northPub),
    true,
    "from the GPS fix the northern pub is the nearest match",
  );

  // Browsing a spot beyond the southern pub: the ring moves there, so "nearest" must too.
  app.state.nearbyAnchor = makePoint(app, -0.08, 0);
  const browsed = app.buildNearbyIconLookup();
  assert.equal(browsed.landmark.has(southPub), true, "the reach follows the browse anchor");
  assert.equal(browsed.landmark.has(northPub), false, "and stops reaching for the one that is no longer nearest");

  app.state.nearbyAnchor = null;
  app.state.filterScreenOpen = false;
});

test("maxNearbyHeadingUpScale delegates to the shared heading-up scale helper", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees"];
  app.state.trees.push(
    { id: "t1", commonName: "Tree 1", ...makePoint(app, 0.001, 0.001) },
    { id: "t2", commonName: "Tree 2", ...makePoint(app, -0.0008, 0.0004) }
  );
  const focus = { x: 500, y: 400 };
  const focusRect = { x: 0, y: 0, width: 1000, height: 800 };

  const points = app.nearbyCameraFitPoints();
  assert.ok(points.length >= 2, "the walking-radius ring should produce points to fit");
  const expected = app.maxScaleForHeadingUpPoints(points, focus, focusRect, { projectTilt: true });
  const actual = app.maxNearbyHeadingUpScale(focus, focusRect);

  assert.equal(actual, expected);
});

test("heading-up resize uses oversized canvas draw area so rotation does not expose viewport edges", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  app.state.compassHeading = 90;
  app.resizeCanvas();

  assert.equal(app.state.canvasVisibleWidth, 1000, "visible canvas width should match map stage width");
  assert.equal(app.state.canvasVisibleHeight, 800, "visible canvas height should match map stage height");
  assert.ok(app.els.canvas.width > app.state.canvasVisibleWidth, "map canvas bitmap should be oversized for rotation");
  assert.ok(app.els.canvas.height > app.state.canvasVisibleHeight, "map canvas bitmap should be oversized for rotation");
  assert.ok(app.state.canvasInsetX > 0 && app.state.canvasInsetY > 0, "oversized map canvas should keep centered insets");
});

test("heading-up resize limits effective pixel ratio so oversized canvas stays within safe limits", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  app.state.compassHeading = 90;
  const originalDpr = app.windowStub.devicePixelRatio;
  try {
    app.windowStub.devicePixelRatio = 3;
    app.els.mapStage.clientWidth = 1800;
    app.els.mapStage.clientHeight = 2600;
    app.resizeCanvas();

    assert.ok(app.els.canvas.width <= 3072, "oversized map canvas width should stay within safe dimension limits");
    assert.ok(app.els.canvas.height <= 3072, "oversized map canvas height should stay within safe dimension limits");
    assert.ok(app.els.canvas.width * app.els.canvas.height <= 9437184, "oversized map canvas pixel area should stay within safe limits");
    assert.ok(app.els.canvas.width > app.state.canvasVisibleWidth, "oversized map canvas should still render beyond the visible viewport");
  } finally {
    app.windowStub.devicePixelRatio = originalDpr;
  }
});

test("tilt never resizes the canvas, so no resize can land mid-gesture", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = null;
  app.state.compassHeading = 90;

  // Tilt is projected per point (worldToScreen), not applied as a CSS transform to the
  // finished bitmap, so the canvas needs no extra room for it at any angle. Oversizing for
  // tilt was in fact what broke 3D: the extra canvas below the pivot swung through the
  // camera plane, and CSS clipped the whole layer away.
  app.state.tiltBetaSmoothed = 0;
  app.prepareCanvasForDraw();
  const flatWidth = app.els.canvas.width;
  const flatHeight = app.els.canvas.height;
  assert.ok(flatWidth > 0, "sanity: canvas is sized");

  for (const beta of [9, 30, 60, 85, 6, 2]) {
    app.state.tiltBetaSmoothed = beta;
    app.prepareCanvasForDraw();
    assert.equal(app.els.canvas.width, flatWidth, `canvas width must not change at beta ${beta}`);
    assert.equal(app.els.canvas.height, flatHeight, `canvas height must not change at beta ${beta}`);
  }
});

test("the tilt projection never goes singular, at any angle or distance", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = null;
  app.state.compassHeading = 0;

  // The old CSS-transform projection divided by (P - dz) unguarded. Behind the pivot dz
  // reaches P, where scale flipped negative and coordinates mirrored to nonsense — which
  // is what made the radar cone, the destination pointer and pins vanish mid-tilt.
  for (const beta of [15, 30, 45, 60, 75, 85]) {
    app.state.tiltBetaSmoothed = beta;
    app.prepareCanvasForDraw();
    const origin = app.rawWorldToScreen(app.state.userLocation.point);
    for (let offset = -20000; offset <= 20000; offset += 250) {
      const p = app.projectCanvasPoint(origin.x, origin.y + offset);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y),
        `projection must stay finite at beta ${beta}, offset ${offset}`);
      assert.ok(p.scale > 0,
        `perspective scale must stay positive at beta ${beta}, offset ${offset} (was ${p.scale})`);
    }
  }
});

test("the ground plane reaches the horizon rather than stopping at a canvas edge", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = null;
  app.state.compassHeading = 0;

  // Ever-further points ahead must keep converging on the horizon row from below, never
  // overshoot past it, and never run out. A finite CSS-rotated bitmap could not do this:
  // it ran out of pixels short of the horizon, leaving the band at the top of the screen
  // that grew with tilt angle.
  app.state.tiltBetaSmoothed = 85;
  app.prepareCanvasForDraw();
  const horizon = app.tiltHorizonCanvasY();
  assert.ok(Number.isFinite(horizon), "a tilted view has a horizon row");

  const origin = app.rawWorldToScreen(app.state.userLocation.point);
  let previousY = Infinity;
  for (const ahead of [100, 1000, 10000, 100000, 1e7]) {
    const y = app.projectCanvasPoint(origin.x, origin.y - ahead).y;
    assert.ok(y > horizon, `ground ${ahead}px ahead must stay below the horizon`);
    assert.ok(y < previousY, `ground must keep receding towards the horizon at ${ahead}px`);
    previousY = y;
  }
  assert.ok(previousY - horizon < 1,
    "far enough ahead, the ground should converge onto the horizon to within a pixel");
});

test("heading-up mode applies CSS delta rotation between redraws", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { id: "tree-1", ...makePoint(app, 0.0015, 0) } };
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 80;
  app.els.canvas.style.transform = "";
  app.els.canvas.style.transformOrigin = "";

  const usedCssRotation = app.updateHeadingUpCanvasRotationTransform();

  assert.equal(usedCssRotation, true, "heading-up smoothing should apply CSS rotation when compass-only delta changes");
  assert.match(app.els.canvas.style.transform, /rotate\(/, "canvas transform should include a CSS rotation delta");
  assert.match(app.els.canvas.style.transformOrigin, /px/, "canvas transform origin should follow user location");
});

test("returning to nearby waits for inspector expansion before starting the nearby camera move", async () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "near-tree", commonName: "Near tree", ...makePoint(app, 0.001, 0) });
  app.state.selected = { type: "tree", item: app.state.trees[0] };
  app.state.viewport = { scale: 1000, tx: 123, ty: 456 };
  app.els.inspector.classList.add("minimized");

  app.goToInitialView();

  assert.equal(app.state.selected, null);
  assert.equal(app.state.viewportAnimationTo, null, "nearby refit should wait until inspector expansion settles");

  await new Promise((resolve) => setTimeout(resolve, 240));

  assert.ok(app.state.viewportAnimationTo, "nearby refit should begin after the inspector transition window");
  assert.ok(app.state.viewportAnimationDuration > 0, "nearby refit should animate once the inspector settles");
});

test("returning to nearby from a tilted selected-item navigation re-fits the camera immediately without flattening tilt first", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "near-tree", commonName: "Near tree", ...makePoint(app, 0.001, 0) });
  app.state.selected = { type: "tree", item: app.state.trees[0] };
  app.state.compassHeading = 90;
  app.state.compassHeadingTarget = 90;
  app.state.compassAnimationTime = null;
  app.state.compassLastEventAt = Date.now(); // recent, so goToInitialView's staleness check doesn't clear compassHeading
  app.state.tiltBetaTarget = 60;
  app.state.tiltBetaSmoothed = 60;
  app.state.viewport = { scale: 1000, tx: 123, ty: 456 };
  assert.equal(app.tiltActive(), true, "should start in full 3D while navigating to a selected item");

  app.goToInitialView();

  assert.equal(app.state.selected, null);
  // No flatten-before-refit: the camera re-fit is kicked off in the same call, and the tilt
  // beta target/smoothed values are untouched, so 3D stays active throughout the re-fit.
  assert.ok(app.state.viewportAnimationTo, "nearby refit should start immediately");
  assert.equal(app.state.tiltBetaTarget, 60, "tilt target should be untouched by returning to nearby");
  assert.equal(app.tiltActive(), true, "tilt should remain active through the re-fit rather than flattening first");
});

test("setInspectorMinimized triggers a real heading-up rescale (not just a recenter) when expanding the inspector during selected navigation", () => {
  // Regression test for a real bug reported 2026-09-03 (round 4): a destination behind the
  // user during heading-up navigation can now occupy most of the screen below the anchor
  // (see headingUpAnchorFraction's bearing mirroring), which makes it much more likely to
  // land where the inspector panel will cover it once expanded. Un-minimizing the inspector
  // used to always call centerViewportOnPointsKeepScale -- which, true to its name, keeps
  // whatever scale was already in effect and only recentres -- so a fit computed while the
  // inspector was minimized (a bigger available area) was never corrected once the inspector
  // grew back to its full size. For heading-up navigation this must instead re-run the real
  // scale fit (alignHeadingUpNavigationViewport) against the now-current (expanded) inspector
  // footprint, so the destination cannot end up stuck at a stale, too-tight scale under it.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90; // facing east -- selectedNavigationHeadingUpActive() true
  app.state.selected = { type: "tree", item: { id: "ahead", ...makePoint(app, 0, 0.001) } };
  app.els.inspector.hidden = false;
  app.els.inspector.classList.add("minimized"); // starts minimized
  app.state.viewport = { scale: 999999, tx: 0, ty: 0 }; // deliberately stale/wrong scale

  app.setInspectorMinimized(false);

  assert.equal(app.els.inspector.classList.contains("minimized"), false, "inspector should now be expanded");
  assert.ok(app.state.viewportAnimationTo, "expanding the inspector should start a camera animation");
  assert.notEqual(app.state.viewportAnimationTo.scale, 999999,
    "the stale scale must be replaced by a real fit, not just carried into a recentre");

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.navigationFocusPoint();
  const expectedBuffered = app.maxHeadingUpNavigationScale(focus, focusRect) * 0.96; // HEADING_UP_SCALE_BUFFER_RATIO
  assert.ok(
    Math.abs(app.state.viewportAnimationTo.scale - expectedBuffered) < expectedBuffered * 0.001,
    `expected the buffered heading-up fit scale ~${expectedBuffered}, got ${app.state.viewportAnimationTo.scale}`
  );
});

test("setInspectorMinimized keeps the plain recentre-at-current-scale behaviour when there is no heading-up navigation active", () => {
  // Selected but north-up (no compass heading yet): selectedNavigationHeadingUpActive() is
  // false, so this must still follow the original centerViewportOnPointsKeepScale path
  // rather than heading-up's alignHeadingUpNavigationViewport (which requires a heading).
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = null; // no heading -> not heading-up
  app.state.selected = { type: "tree", item: { id: "flat-target", ...makePoint(app, 0, 0.001) } };
  app.els.inspector.hidden = false;
  app.els.inspector.classList.add("minimized");
  app.state.viewport = { scale: 4242, tx: 0, ty: 0 };

  app.setInspectorMinimized(false);

  assert.ok(app.state.viewportAnimationTo, "expanding the inspector should still animate a recentre");
  assert.equal(app.state.viewportAnimationTo.scale, 4242, "north-up recentre must keep the current scale unchanged");
});

test("nearby summary uses the generated walking icon asset", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees"];
  app.state.trees.push({ id: "near-tree", commonName: "Near tree", ...makePoint(app, 0.001, 0) });

  const html = app.overviewNearestHtml();

  assert.match(html, /data\/icons\/walking\.png/);
  assert.match(html, /\d+\s*m\s*·\s*(?:<\s*1|\d+)\s*min/);
  assert.match(app.appIconHtml("nearby", "app-icon title-icon"), /data\/icons\/nearby\.png/);
});

test("formatDistance uses metres under 1km and trims unnecessary km decimals", () => {
  assert.equal(app.formatDistance(850), "850 m");
  assert.equal(app.formatDistance(1500), "1.5 km");
  assert.equal(app.formatDistance(5000), "5 km");
  assert.equal(app.formatDistance(9940), "9.9 km");
  assert.equal(app.formatDistance(12300), "12 km");
});

test("nearby list shows tag number for trees", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees"];
  app.state.trees.push({ id: "near-tree", commonName: "Near Oak", tagNumber: "15961", ...makePoint(app, 0.001, 0) });

  const html = app.overviewNearestHtml();

  assert.match(html, /#15961/, "nearby list must show the tree tag number");
});

test("the nearby heading names the walking radius, not just the filter", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 5;
  app.state.overviewFilters = ["trees"];
  app.state.trees.push({ id: "near-tree", recordNumber: 910, commonName: "Near Oak", ...makePoint(app, 0.001, 0) });

  const html = app.overviewHeadingText();
  assert.ok(!app.overviewNearestHtml().includes("nearby-heading"), "the subtitle is not duplicated in the list");
  assert.match(html, /Trees within 5 min walk/, "the heading answers how far the list is reaching");
  assert.ok(!html.includes("around you"), "the vaguer wording is gone");

  // With the radius toggled off there is no radius to name, so the heading says so instead of
  // claiming a reach the list is not applying.
  app.state.showAllOutsideRadius = true;
  assert.match(app.overviewHeadingText(), /Nearest Trees around you/);
  app.state.showAllOutsideRadius = false;
});

test("the nearby heading explains when Everything is selected", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 5;
  app.state.overviewFilters = app.FILTER_SUBFILTERS.map((subfilter) => subfilter.key);

  assert.equal(app.overviewHeadingText(), "Showing everything within 5 min walk");
});

test("the nearby heading names the count too, so a /nearby/<slug> page answers 'how many' at a glance", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 5;
  app.state.overviewFilters = ["trees"];
  app.state.trees.push(
    { id: "near-tree", recordNumber: 910, commonName: "Near Oak", ...makePoint(app, 0.001, 0) },
    { id: "near-tree-2", recordNumber: 911, commonName: "Near Ash", ...makePoint(app, 0.0015, 0) }
  );

  assert.equal(app.overviewHeadingText(), "2 Trees within 5 min walk");
});

test("untagged trees each keep their own identity instead of collapsing onto one another", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees"];
  // The Veteran Tree Register gives every untagged record id "0" and tagNumber "0" -- 6,504 of
  // them. Keying on those collapsed all of them to a single nearby row and made tapping it open
  // whichever one happened to sit first in the dataset, however far away that was.
  const near = { id: "0", tagNumber: "0", recordNumber: 5001, ...makePoint(app, 0.0005, 0) };
  const alsoNear = { id: "0", tagNumber: "0", recordNumber: 5002, ...makePoint(app, 0.0008, 0) };
  const farAway = { id: "0", tagNumber: "0", recordNumber: 5003, ...makePoint(app, 0.2, 0.2) };
  app.state.trees.push(farAway, near, alsoNear); // far one first, as the dataset order has it

  assert.notEqual(app.treeHashKey(near), app.treeHashKey(alsoNear), "two untagged trees are not the same tree");
  assert.equal(app.findTreeByHashKey(app.treeHashKey(near)), near, "a key resolves back to its own tree");

  // .join, not deepEqual against a host array: arrays built inside the vm sandbox carry the
  // sandbox's own Array prototype, which assert treats as a mismatch.
  const listed = app.overviewItemsForActiveFilter().map((entry) => entry.item.recordNumber).join(",");
  assert.equal(listed, "5001,5002", "both nearby untagged trees are listed, nearest first");

  // And an untagged tree is not called "0": that is the register's placeholder, not a name.
  assert.equal(app.treeDisplayName(near), "Veteran tree");
  assert.equal(app.treeDisplayName({ tagNumber: "15961" }), "15961");
  assert.equal(app.treeDisplayName({ commonName: "Hornbeam", tagNumber: "0" }), "Hornbeam");
  assert.ok(!app.overviewNearestHtml().includes(" · #0"), "and carries no #0 tag chip");
});

test("coming back to the foreground releases animation frames the browser dropped while hidden", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);

  // rAF callbacks do not run while the page is hidden, and a frame requested just before the
  // app went away is often dropped rather than delivered on return. Each loop's handle is then
  // stuck set, and the guard that stops duplicate loops silently stops the loop restarting.
  app.state.animationFrame = 12345;
  app.state.overlayAnimationFrame = 12346;
  app.state.compassAnimationFrame = 12347;
  app.state.compassAnimationTime = 999;
  app.state.viewportAnimationFrame = 12348;
  app.state.viewportAnimationTo = { scale: 1, tx: 0, ty: 0 };

  app.releaseStrandedAnimationFrames();

  assert.equal(app.state.animationFrame, null, "the map draw loop can be started again");
  assert.equal(app.state.overlayAnimationFrame, null, "so can the overlay loop");
  assert.equal(app.state.compassAnimationFrame, null, "and the compass/tilt smoothing loop");
  assert.equal(app.state.compassAnimationTime, null, "without carrying a timestamp from before the break");
  // A stranded viewportAnimationTo keeps selectionCameraTransitionActive() true, which makes
  // alignHeadingUpNavigationViewport bail on every call -- the map stops rotating and stops
  // tilting until a reload.
  assert.equal(app.state.viewportAnimationTo, null, "and the heading-up fit is no longer switched off");
  assert.equal(app.selectionCameraTransitionActive(), false);
});

test("nearby list omits tag chip when tree has no tag number", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees"];
  app.state.trees.push({ id: "near-tree", commonName: "Near Oak", ...makePoint(app, 0.001, 0) });

  const html = app.overviewNearestHtml();

  assert.ok(!html.includes(" · #"), "tag chip must not appear when tagNumber is absent");
});

test("nearby transport entries use the generated bus icon asset", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["bus"];
  app.state.landmarks.push({ id: "near-bus", name: "Near bus stop", category: "bus_stop", categoryTags: ["bus_stop"], ...makePoint(app, 0.001, 0) });

  const html = app.overviewNearestHtml();

  assert.match(html, /data\/icons\/bus\.png/);
});

test("nearby bus stop names include stop direction context when known", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["bus"];
  app.state.landmarks.push({
    id: "near-bus",
    name: "Near bus stop",
    category: "bus_stop",
    categoryTags: ["bus_stop"],
    stopDirection: "Walthamstow Central",
    ...makePoint(app, 0.001, 0),
  });

  const html = app.overviewNearestHtml();

  assert.match(html, /Near bus stop — towards Walthamstow Central/);
});

// --- Map search ---

function resetSearchData(app) {
  resetData(app);
  app.state.waterFeatures = [];
  app.state.environmentFeatures = [];
  app.state.searchScreenOpen = false;
  app.state.searchQuery = "";
  // Not reset by resetData -- production code only clears this on Search stand-down
  // (setInspectorSelectionChrome). Without it, a prior test's leftover results make
  // updateSearchHighlight think this test's first query isn't the first match to appear,
  // sending it down the debounced re-fit path instead of the immediate one.
  app.state.searchHighlightResults = [];
}

function addSearchFixtures(app) {
  app.state.trees.push(
    { id: "oak-near", commonName: "English Oak", latinName: "Quercus robur", tagNumber: "1234", ...makePoint(app, 0.001, 0) },
    { id: "oak-far", commonName: "English Oak", latinName: "Quercus robur", tagNumber: "9876", ...makePoint(app, 0.02, 0) }
  );
  app.state.landmarks.push(
    { id: "shop-1", name: "Forest Village Stores", category: "shop", categoryTags: ["shop"], ...makePoint(app, 0.002, 0) },
    { id: "pub-1", name: "The Royal Forest", category: "pub", categoryTags: ["pub"], ...makePoint(app, 0.003, 0) }
  );
  // One road, three OSM ways -- exactly how a long street arrives from OpenStreetMap.
  app.state.roads.push(
    { name: "Epping New Road", roadType: "primary", segments: [[app.projectLonLat(0, 0.004), app.projectLonLat(0.01, 0.004)]] },
    { name: "Epping New Road", roadType: "primary", segments: [[app.projectLonLat(0, 0.05), app.projectLonLat(0.01, 0.05)]] },
    { name: "Epping New Road", roadType: "primary", segments: [[app.projectLonLat(0, 0.06), app.projectLonLat(0.01, 0.06)]] }
  );
}

test("search normalises punctuation and case out of a half-remembered name", () => {
  assert.equal(app.normalizeSearchText("St Mary's Church"), "st marys church");
  assert.equal(app.normalizeSearchText("  EF-1234  "), "ef 1234");
  assert.equal(app.normalizeSearchText(null), "");
  assert.equal(app.searchQueryTokens("epping new road").join("|"), "epping|new|road");
});

test("search ranks an exact name above a prefix, a word, and a bare substring", () => {
  assert.equal(app.searchFieldRank("forest road", "forest road"), app.SEARCH_RANK_EXACT);
  assert.equal(app.searchFieldRank("forest road north", "forest"), app.SEARCH_RANK_PREFIX);
  assert.equal(app.searchFieldRank("high forest road", "forest"), app.SEARCH_RANK_WORD);
  assert.equal(app.searchFieldRank("deforestation lane", "forest"), app.SEARCH_RANK_SUBSTRING);
  assert.equal(app.searchFieldRank("forest road", "cow"), null);
});

test("a tree tag matches exactly even though the species name shares the entry", () => {
  const entry = app.searchIndexEntry("tree", {}, ["English Oak", "1234"]);

  assert.equal(app.searchEntryRank(entry, "1234", ["1234"]), app.SEARCH_RANK_EXACT);
  assert.equal(app.searchEntryRank(entry, "english", ["english"]), app.SEARCH_RANK_PREFIX);
  assert.equal(app.searchEntryRank(entry, "5555", ["5555"]), null);
});

test("a multi-word query no single field answers still matches when every word is present", () => {
  const entry = app.searchIndexEntry("tree", {}, ["English Oak", "1234"]);

  assert.equal(app.searchEntryRank(entry, "oak 1234", ["oak", "1234"]), app.SEARCH_RANK_TOKENS);
  assert.equal(app.searchEntryRank(entry, "oak 9999", ["oak", "9999"]), null);
});

test("search finds a shop, a road and a tree tag, the three things the map is searched for", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  const shop = app.searchMapFeatures("village stores");
  assert.equal(shop[0].type, "landmark");
  assert.equal(app.searchResultName("landmark", shop[0].item), "Forest Village Stores");

  const road = app.searchMapFeatures("epping new road");
  assert.equal(road[0].type, "road");
  assert.equal(app.searchResultName("road", road[0].item), "Epping New Road");

  const tree = app.searchMapFeatures("1234");
  assert.equal(tree[0].type, "tree");
  assert.equal(tree[0].item.id, "oak-near");
});

test("search combines a tree's species and generic type", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  const results = app.searchMapFeatures("oak tree").filter((result) => result.type === "tree");

  assert.equal(results.length, 2);
  assert.equal(results[0].item.id, "oak-near");
});

test("search finds places through their category group, subcategory and source metadata", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.landmarks.push({
    id: "cafe-1",
    name: "The Hidden Kettle",
    category: "cafe",
    categoryTags: ["cafe"],
    amenity: "cafe",
    address: "42 Forest Lane",
    ...makePoint(app, 0.002, 0),
  });

  assert.equal(app.searchMapFeatures("food")[0].item.id, "cafe-1", "the parent category is searchable");
  assert.equal(app.searchMapFeatures("cafes")[0].item.id, "cafe-1", "the filter subcategory is searchable");
  assert.equal(app.searchMapFeatures("forest lane")[0].item.id, "cafe-1", "useful source metadata is searchable");
});

test("a street split across many OSM ways is one result, the nearest piece of it", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  const results = app.searchMapFeatures("epping new road");

  assert.equal(results.length, 1, "three ways named the same street list once");
  assert.ok(results[0].metres < 1000, "and it is the piece closest to the user");
});

test("one name repeated across the map is allowed a few rows, not the whole list", () => {
  resetSearchData(app);
  app.state.userLocation = null;
  // Eight bus stops share the name of the street they stand on, which is the real shape of
  // "Forest Road" in the dataset.
  for (let index = 0; index < 8; index += 1) {
    app.state.landmarks.push({
      id: `stop-${index}`,
      name: "Repeated Road",
      category: "bus_stop",
      categoryTags: ["bus_stop"],
      ...makePoint(app, 0.001 * (index + 1), 0),
    });
  }
  app.state.roads.push({ name: "Repeated Road", roadType: "residential", segments: [[app.projectLonLat(0, 0.002), app.projectLonLat(0.01, 0.002)]] });

  const results = app.searchMapFeatures("repeated road");

  assert.equal(results.filter((result) => result.type === "landmark").length, 3, "the repeated stop is capped");
  assert.equal(results.filter((result) => result.type === "road").length, 1, "and the street itself is still listed");
});

test("equally good matches are ordered by how far away they are", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  const results = app.searchMapFeatures("english oak");

  assert.equal(results.length, 2);
  assert.equal(results[0].item.id, "oak-near");
  assert.equal(results[1].item.id, "oak-far");
});

test("search results carry the same walk chip and type label the nearby list uses", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  app.state.searchQuery = "royal forest";

  const html = app.searchResultsHtml("royal forest");

  assert.match(html, /class="nearest-item"/, "results reuse the nearby list row");
  assert.match(html, /data-search-type="landmark"/);
  assert.match(html, /The Royal Forest/);
  assert.match(html, /nearest-icon[\s\S]*nearest-content/, "results use the Nearby row's icon and content columns");
  assert.match(html, /walk-chip/, "with the distance and walk time");
  assert.match(html, /Pubs &amp; bars/, "and the filter label the place is listed under");
});

test("search says what to type before it has enough to go on", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  assert.match(app.searchResultsHtml(""), /Search for a tree tag/);
  assert.match(app.searchResultsHtml("a"), /at least 2 characters/);
  assert.match(app.searchResultsHtml("zzzznothing"), /Nothing on the map matches/);
});

test("search works with no location fix, listing matches without distances", () => {
  resetSearchData(app);
  app.state.userLocation = null;
  addSearchFixtures(app);

  const results = app.searchMapFeatures("royal forest");

  assert.equal(results.length, 1);
  assert.equal(results[0].metres, null, "no origin means no distance to report");
  assert.doesNotMatch(app.searchResultsHtml("royal forest"), /walk-chip/);
});

test("the map shows only the search matches, drawn with their normal pins -- nothing else in those categories", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  app.state.searchScreenOpen = true;
  app.searchResultsHtml("royal forest");

  const lookup = app.buildSearchIconLookup();
  assert.equal(lookup.landmark.size, 1, "only the matching pub is in the search set");
  assert.ok(Array.from(lookup.landmark)[0].name === "The Royal Forest");
  assert.equal(lookup.tree.size, 0, "the unrelated trees are left out entirely, not dimmed");

  assert.equal(app.activeIconLookup(), lookup, "the shared draw/hit-test lookup is the search one while search has matches");
});

test("activeIconLookup falls back to the ordinary Nearby set once Search has no query", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  app.state.searchScreenOpen = true;
  app.searchResultsHtml("");

  assert.equal(app.state.searchHighlightResults.length, 0);
  assert.equal(app.activeIconLookup(), app.buildNearbyIconLookup());
});

test("search results are never dimmed by the active category filters", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  const pub = app.state.landmarks.find((place) => place.id === "pub-1");

  app.setOverviewFilters(["cows"]);
  assert.equal(app.markerOpacityFor("landmark", pub), 0.3, "off Search, a filtered-out category is dimmed as usual");

  app.state.searchScreenOpen = true;
  assert.equal(app.markerOpacityFor("landmark", pub), 1, "inside Search the same item is full strength");
  assert.equal(app.markerOpacityFor("cow", { id: "any-cow" }), 1);
});

test("Search never offers a \"Clear all filters\" row, on any state of the results pane -- that control lives on the Filters screen", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  app.setOverviewFilters(["cows"]);
  assert.doesNotMatch(app.searchResultsHtml(""), /data-filter-clear-all/, "empty prompt");
  assert.doesNotMatch(app.searchResultsHtml("a"), /data-filter-clear-all/, "too-short prompt");
  assert.doesNotMatch(app.searchResultsHtml("zzzznothing"), /data-filter-clear-all/, "no-matches state");
  assert.doesNotMatch(app.searchResultsHtml("royal forest"), /data-filter-clear-all/, "results list");
});

test("searching a tree species by itself finds every matching tree, nearest first", () => {
  // "oak" alone, not "english oak" -- a bare species word has to match on its own so searching
  // a type of tree ("oak", "holly", "hornbeam") surfaces the nearby trees of that kind, not just
  // ones searched by their exact full common name.
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  const results = app.searchMapFeatures("oak").filter((r) => r.type === "tree");

  assert.equal(results.length, 2, "both oaks in the fixtures match on the species word alone");
  assert.equal(results[0].item.id, "oak-near");
  assert.equal(results[1].item.id, "oak-far");
});

test("nearest-first: searching a whole category (cows) leads with the closest one", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  app.state.cows = [
    { serialNo: "far-cow", ...makePoint(app, 0.05, 0) },
    { serialNo: "near-cow", ...makePoint(app, 0.001, 0) },
  ];

  const results = app.searchMapFeatures("cow").filter((r) => r.type === "cow");

  assert.equal(results.length, 2);
  assert.equal(results[0].item.serialNo, "near-cow");
  assert.equal(results[1].item.serialNo, "far-cow");
});

test("the camera fit for a search keeps the user's own position in view, not just the matches", () => {
  resetSearchData(app);
  app.els.canvas.width = 1000;
  app.els.canvas.height = 800;
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  // A match far enough away that framing it alone would push the user's own position, at the
  // opposite side of the view, off the edge of the canvas.
  app.state.landmarks.push({ id: "far-pub", name: "Distant Forest Tavern", category: "pub", categoryTags: ["pub"], ...makePoint(app, 0.3, 0.3) });

  app.state.searchScreenOpen = true;
  app.searchResultsHtml("distant forest tavern");

  assert.ok(app.state.searchHighlightResults.length > 0, "the far match is in the highlighted set");
  // The very first match to appear fits immediately, with no debounce -- see
  // updateSearchHighlight's comment -- so state.viewportAnimationTo is set synchronously here.
  // fitToPoints animates: it only sets the animation's target rather than state.viewport itself,
  // so jump straight to that target rather than driving the animation loop forward.
  assert.ok(app.state.viewportAnimationTo, "the search fit should start a camera animation");
  app.state.viewport = { ...app.state.viewportAnimationTo };
  const userScreenPoint = app.worldToScreen(app.state.userLocation.point);
  assert.ok(
    userScreenPoint.x >= 0 && userScreenPoint.x <= app.els.canvas.width
      && userScreenPoint.y >= 0 && userScreenPoint.y <= app.els.canvas.height,
    "the user's own position stays inside the fitted viewport alongside the match"
  );
});

test("a second, narrower query waits for a typing pause before re-fitting, but the first match never does", async () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  app.state.searchScreenOpen = true;
  app.searchResultsHtml("english oak");
  const firstFitTarget = app.state.viewportAnimationTo;
  assert.ok(firstFitTarget, "the first match fits immediately, not after a debounce");
  app.state.viewport = { ...firstFitTarget };
  app.state.viewportAnimationTo = null;

  // Narrows to just the nearer tree -- a real result-set change, not a no-op.
  app.searchResultsHtml("1234");
  assert.equal(app.state.viewportAnimationTo, null, "a later change waits for the debounce rather than re-fitting immediately");

  await new Promise((resolve) => setTimeout(resolve, app.SEARCH_CAMERA_FIT_DEBOUNCE_MS + 50));
  assert.ok(app.state.viewportAnimationTo, "and the debounced fit lands once the pause elapses");
});

test("losing every match falls back to the Nearby ring instead of leaving the camera on the last search fit", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  app.state.walkingDistanceMinutes = 60; // a ring wide enough to actually contain the fixtures

  app.state.searchScreenOpen = true;
  app.searchResultsHtml("english oak");
  assert.ok(app.state.viewportAnimationTo, "the search fit lands immediately for the first match");
  app.state.viewport = { ...app.state.viewportAnimationTo };
  app.state.viewportAnimationTo = null;

  // The query changes to something nothing on the map answers.
  app.searchResultsHtml("zzzznothinghere");

  assert.equal(app.state.searchHighlightResults.length, 0);
  assert.ok(app.state.viewportAnimationTo, "losing every match should re-fit immediately, to the Nearby ring");
});

test("the search index picks up data that arrived after the last search", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  assert.equal(app.searchMapFeatures("hollow pond").length, 0);

  app.state.waterFeatures.push({ id: "water-1", name: "Hollow Pond", featureType: "hydrology_area", ...makePoint(app, 0.004, 0) });

  const results = app.searchMapFeatures("hollow pond");
  assert.equal(results.length, 1);
  assert.equal(app.searchResultTypeLabel("water", results[0].item), "Pond / lake");
});

test("opening Search is a screen of its own, and leaving it hands the map back to Nearby", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  app.openSearchScreen();

  assert.equal(app.state.searchScreenOpen, true);
  assert.equal(app.state.selected, null, "Search is not a selection");
  assert.equal(app.isOverviewScreenActive(), false, "so map taps do not move the nearby anchor");
  assert.equal(app.secondaryScreenActive(), true, "and the map keeps the nearby framing behind it");
  assert.equal(app.els.inspectorTitle.textContent, "Search");
  assert.equal(app.location.pathname, "/nearby/search", "the screen has its own URL, so back leaves it");

  app.goToInitialView();
  assert.equal(app.state.searchScreenOpen, false);
  assert.equal(app.isOverviewScreenActive(), true);
});

test("choosing a search result opens the location the same way a map tap does", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  app.openSearchScreen();

  const [result] = app.searchMapFeatures("village stores");
  app.openSearchResult(result.type, result.key);

  assert.equal(app.state.searchScreenOpen, false, "the search screen stands down");
  assert.equal(app.state.selected.type, "landmark");
  assert.equal(app.state.selected.item.id, "shop-1");
  assert.match(app.location.hash, /place=/, "and the selection is linkable like any other");
});

test("choosing a findSlug business from search updates the URL before rendering", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  app.state.landmarks.push({ id: "pub-2", name: "The Forresters", category: "pub", categoryTags: ["pub"], findSlug: "the-forresters", ...makePoint(app, 0.0025, 0) });
  app.openSearchScreen();

  const [result] = app.searchMapFeatures("the forresters");
  app.openSearchResult(result.type, result.key);

  assert.equal(app.location.pathname, "/find/the-forresters/", "the URL is updated as part of selecting the result");
  assert.ok(!app.els.inspectorBody.innerHTML.includes("Full details"), "location details no longer include a dead-end link");
});

test("a road can be navigated to from search, which the nearby list cannot offer", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);
  app.openSearchScreen();

  const [result] = app.searchMapFeatures("epping new road");
  app.openSearchResult(result.type, result.key);

  assert.equal(app.state.selected.type, "road");
  assert.equal(app.state.selected.item.name, "Epping New Road");
  assert.ok(Number.isFinite(app.state.selected.item.latitude), "the road gained an anchor to steer to");
  assert.match(app.location.hash, /road=/);
});

test("typing re-renders only the results, leaving the field alone", () => {
  resetSearchData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addSearchFixtures(app);

  app.setSearchQuery("royal forest");

  assert.equal(app.state.searchQuery, "royal forest");
  assert.match(app.searchResultsHtml(app.state.searchQuery), /The Royal Forest/);
});

test("bus stop titles keep explicit directional wording", () => {
  assert.equal(
    app.placeTitle({ name: "Forest Road", category: "bus_stop", stopDirection: "Walthamstow Central" }),
    "Forest Road — towards Walthamstow Central"
  );
  assert.equal(
    app.placeTitle({ name: "Forest Road", category: "bus_stop", stopDirection: "northbound" }),
    "Forest Road — northbound"
  );
  assert.equal(
    app.placeTitle({ name: "Forest Road — northbound", category: "bus_stop", stopDirection: "northbound" }),
    "Forest Road — northbound"
  );
  assert.equal(
    app.placeTitle({ name: "Forest Road", category: "bus_stop", stopDirection: "   " }),
    "Forest Road"
  );
});

test("settings form puts About (and its refresh buttons) before Privacy, not last", () => {
  const html = app.settingsFormHtml();
  const aboutIndex = html.indexOf('<h3 class="settings-section-title">About</h3>');
  const privacyIndex = html.indexOf('<h3 class="settings-section-title">Privacy</h3>');
  assert.ok(aboutIndex > -1 && privacyIndex > -1, "both sections should be present");
  assert.ok(
    aboutIndex < privacyIndex,
    "About (with the Refresh buttons people open Settings for) should render before Privacy, so it isn't the last thing scrolled to"
  );
});

test("settings form falls back to the built-in cache version before the live worker version is known", () => {
  const marker = vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "app-cache-version.js"), "utf8") + "\nAPP_CACHE_VERSION", {});
  app.state.swVersion = null;
  assert.ok(app.settingsFormHtml().includes(`>${marker}</span>`), "the About line shows the marker file's version");
  app.state.swVersion = "forest-finds-app-live";
  assert.ok(app.settingsFormHtml().includes(">forest-finds-app-live</span>"), "and the live worker's version once it is known");
  app.state.swVersion = null;
});

test("settings form shows the app version", () => {
  app.state.swVersion = "v157";
  const html = app.settingsFormHtml();
  app.state.swVersion = "";

  assert.match(html, /v157/, "settings form should include the app version number");
  assert.match(html, /App version/, "settings form should label the app version");
  assert.match(html, /appVersionDisplay/, "settings form should include the version span for dynamic updates");
});

test("settings form's walking-time value is hidden from assistive tech in favour of the slider's own aria-valuetext", () => {
  resetData(app);
  app.state.userLocation = null;
  app.state.walkingDistanceMinutes = 5;
  const html = app.settingsFormHtml();
  assert.match(
    html,
    /<span class="walk-radius-value" id="settingsWalkMinsValue" aria-hidden="true">5 min<\/span>/,
    "the visible '5 min' label should not be read out separately from the slider itself"
  );
  assert.match(
    html,
    /aria-valuetext="5 min"/,
    "the range input should carry the same value as its own aria-valuetext"
  );
});

test("settings form's floor note is an aria-live region, so hitting the floor is announced", () => {
  const html = app.settingsFormHtml();
  assert.match(html, /id="settingsWalkMinsFloorNote" aria-live="polite"/);
});

function withStoredKeys(keys, fn) {
  const names = ["ff-track-v1", "ff-cookie-consent", "ff-location-v1"];
  const saved = names.map((name) => [name, app.localStorage.getItem(name)]);
  names.forEach((name) => app.localStorage.removeItem(name));
  Object.entries(keys).forEach(([name, value]) => app.localStorage.setItem(name, value));
  try { fn(); } finally {
    saved.forEach(([name, value]) => (value == null ? app.localStorage.removeItem(name) : app.localStorage.setItem(name, value)));
  }
}

test("settings form's Privacy section shows usage analytics as one choice and offers the opposite", () => {
  withStoredKeys({}, () => {
    app.setAnalyticsConsent(false);
    let html = app.settingsFormHtml();
    assert.match(html, /id="analyticsStatus">off</);
    assert.match(html, /id="analyticsToggle"[^>]*>Turn on usage analytics</);
    assert.doesNotMatch(html, /cookieConsentManageBtn/, "there is no second, separate cookie control to keep in step");

    app.setAnalyticsConsent(true);
    html = app.settingsFormHtml();
    assert.match(html, /id="analyticsStatus">on</);
    assert.match(html, /id="analyticsToggle"[^>]*>Turn off usage analytics</);
  });
});

test("answering usage analytics records the usage-data and analytics-cookie halves together", () => {
  withStoredKeys({}, () => {
    app.setAnalyticsConsent(true);
    assert.equal(app.hasTrackingConsent(), true);
    assert.equal(app.localStorage.getItem("ff-cookie-consent"), "granted");
    app.setAnalyticsConsent(false);
    assert.equal(app.hasTrackingConsent(), false);
    assert.equal(app.localStorage.getItem("ff-cookie-consent"), "denied");
    assert.equal(app.analyticsChoice(), "denied", "a refusal is remembered, not read as never asked");
  });
});

test("usage analytics is still unasked for someone who only accepted cookies on the homepage", () => {
  // The homepage's cookie banner says nothing about positions recorded in the app, so it cannot
  // stand in for that half of the question.
  withStoredKeys({ "ff-cookie-consent": "granted" }, () => assert.equal(app.analyticsChoice(), "undecided"));
  // A refusal anywhere is honoured rather than asked again.
  withStoredKeys({ "ff-cookie-consent": "denied" }, () => assert.equal(app.analyticsChoice(), "denied"));
});

test("boot only requests a position by itself when that cannot put an unexplained system prompt on screen", () => {
  // Already granted: answers silently.
  assert.equal(app.bootMayRequestLocation("granted", null), true);
  // Refused at the browser or OS: a request would fail without asking, so none is made.
  assert.equal(app.bootMayRequestLocation("denied", "granted"), false);
  // Would prompt: only for someone who asked for location in the app before.
  assert.equal(app.bootMayRequestLocation("prompt", "granted"), true);
  assert.equal(app.bootMayRequestLocation("prompt", null), false);
  assert.equal(app.bootMayRequestLocation("prompt", "declined"), false);
  assert.equal(app.bootMayRequestLocation("unknown", null), false, "an unanswerable permission query counts as a prompt");
});

test("a location answer is remembered, and the old bundled 'Enable location' tap still counts as having asked", () => {
  withStoredKeys({}, () => {
    assert.equal(app.storedLocationChoice(), null);
    app.rememberLocationChoice("declined");
    assert.equal(app.storedLocationChoice(), "declined");
  });
  withStoredKeys({ "ff-track-v1": "1" }, () => assert.equal(app.storedLocationChoice(), "granted"));
});

test("select_map_item GA event carries a specific venue category for landmarks, never coordinates", () => {
  const calls = [];
  const originalGtag = app.windowStub.gtag;
  app.windowStub.gtag = (...args) => calls.push(args);

  const memorial = { category: "memorial", categoryTags: ["memorial"], name: "War Memorial" };
  app.trackGaItemSelected("landmark", memorial, "map");
  const tree = { commonName: "Old Oak", latitude: 51.65, longitude: 0.03 };
  app.trackGaItemSelected("tree", tree, "overview");

  app.windowStub.gtag = originalGtag;

  assert.equal(calls.length, 2);
  const [landmarkCall, treeCall] = calls;
  assert.equal(landmarkCall[1], "select_map_item");
  assert.equal(landmarkCall[2].item_type, "landmark");
  assert.equal(landmarkCall[2].item_category, "monuments", "should narrow landmark down to its filter chip kind");
  assert.equal(landmarkCall[2].item_name, "War Memorial");
  assert.equal(treeCall[2].item_type, "tree");
  assert.equal(treeCall[2].item_category, "tree", "non-landmark types repeat item_type");

  for (const call of calls) {
    for (const value of Object.values(call[2])) {
      assert.notEqual(typeof value, "number", "GA item events must never carry raw coordinates");
    }
  }
});

test("settings form offers separate data, app and combined refresh buttons", () => {
  // The scopes are split so a data repair does not needlessly check for an app update, while all
  // three keep the current offline copy until a replacement is ready.
  const html = app.settingsFormHtml();
  assert.match(html, /id="refreshDataButton"/, "settings form should include the data refresh button");
  assert.match(html, /Refresh data/, "data refresh button should be labelled");
  assert.match(html, /id="refreshAppButton"/, "settings form should include the app refresh button");
  assert.match(html, /Refresh app/, "app refresh button should be labelled");
  assert.match(html, /id="refreshAllButton"/, "settings form should include the combined refresh button");
  assert.match(html, /Refresh both/, "combined refresh button should be labelled");
  assert.match(html, /id="refreshOfflineNote"/, "settings form should include a shared offline note for the refresh buttons");
});

// Drives refreshCachedState against a fake browser: service worker, Cache Storage and reload.
async function runRefresh(app, scope, { online = true, dataSyncOk = true } = {}) {
  const log = [];
  const nav = app.navigator;
  const win = app.windowStub;
  const listeners = new Set();
  const cacheNames = ["forest-finds-app-9", "forest-finds-data-9", "unrelated"];
  const previousOnline = nav.onLine;
  const previousLocation = app.swapGlobalFunction("location", { reload: () => log.push("reload") });
  const previousCaches = app.swapGlobalFunction("caches", {
    keys: async () => cacheNames,
    delete: async (name) => { log.push(`delete ${name}`); },
  });
  nav.onLine = online;
  win.caches = {};
  nav.serviceWorker = {
    controller: {
      postMessage: (message) => {
        log.push(`sync ${message.type}`);
        listeners.forEach((fn) => fn({ data: { type: "DATA_SYNC_COMPLETE", requestId: message.requestId, ok: dataSyncOk } }));
      },
    },
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    getRegistrations: async () => [{ unregister: async () => { log.push("unregister worker"); } }],
  };
  try {
    const result = await app.refreshCachedState(scope);
    return { result, log };
  } finally {
    delete nav.serviceWorker;
    delete win.caches;
    nav.onLine = previousOnline;
    app.swapGlobalFunction("location", previousLocation);
    app.swapGlobalFunction("caches", previousCaches);
  }
}

test("Refresh app clears the app cache, keeps the data cache, and then reloads", async () => {
  const { result, log } = await runRefresh(app, "app");
  assert.equal(result, true);
  assert.deepEqual(log, ["unregister worker", "delete forest-finds-app-9", "reload"]);
});

test("Refresh both downloads fresh data first, then clears every forest-finds cache and reloads", async () => {
  const { result, log } = await runRefresh(app, "all");
  assert.equal(result, true);
  assert.deepEqual(log, ["sync SYNC_DATA", "unregister worker", "delete forest-finds-app-9", "delete forest-finds-data-9", "reload"]);
});

test("Refresh data downloads into the existing cache and reloads without clearing anything", async () => {
  const { result, log } = await runRefresh(app, "data");
  assert.equal(result, true);
  assert.deepEqual(log, ["sync SYNC_DATA", "reload"]);
});

test("a refresh whose data download fails leaves the offline copy untouched and does not reload", async () => {
  for (const scope of ["data", "all"]) {
    const { result, log } = await runRefresh(app, scope, { dataSyncOk: false });
    assert.equal(result, false, scope);
    assert.deepEqual(log, ["sync SYNC_DATA"], `${scope}: nothing is cleared or reloaded after a failed download`);
  }
});

test("refreshing while offline does nothing, so the app is never left without a cache to fall back on", async () => {
  for (const scope of ["data", "app", "all"]) {
    const { result, log } = await runRefresh(app, scope, { online: false });
    assert.equal(result, false, scope);
    assert.deepEqual(log, [], scope);
  }
});

test("filter groups include all seven labelled categories", () => {
  const { FILTER_GROUPS: groups } = app;
  assert.equal(groups.length, 7, "should have exactly seven filter groups");
  const labels = groups.map((g) => g.label);
  for (const expected of ["Nature", "Food", "Transport", "History", "Locations", "Stories", "Events"]) {
    assert.ok(labels.includes(expected), `missing filter group: ${expected}`);
  }
});

test("settings form is a continuous slider spanning every preset tick when there's no floor constraint", () => {
  app.state.userLocation = null;
  const html = app.settingsFormHtml();
  assert.match(html, /<input type="range" id="settingsWalkMins"/, "walking time control should be a range slider, not a dropdown");
  assert.match(html, /min="1" max="30" step="0.5"/, "slider should span the full 1-30 min range with no floor constraint");
  for (const mins of [1, 2, 5, 10, 15, 20, 30]) {
    assert.match(html, new RegExp(`<option value="${mins}">`), `missing tick mark: ${mins} min`);
  }
});

test("settings form draws its own tick marks for the preset stops, since appearance:none hides the native ones", () => {
  app.state.userLocation = null;
  const html = app.settingsFormHtml();
  // floor=1, max=30 -> trackSpan=29; each preset's tick sits at (preset - floor) / trackSpan.
  for (const [mins, pct] of [[1, "0.00"], [2, "3.45"], [5, "13.79"], [15, "48.28"], [30, "100.00"]]) {
    assert.match(
      html,
      new RegExp(`<span class="walk-radius-tick" style="left:${pct}%"></span>`),
      `missing positioned tick mark for ${mins} min`
    );
  }
});

test("walkingRadiusFloorMinutes falls back to the minimum with no origin or no nearby item", () => {
  assert.equal(app.walkingRadiusFloorMinutes(null), app.WALKING_RADIUS_MIN_MINUTES);
  resetData(app);
  assert.equal(app.walkingRadiusFloorMinutes(makePoint(app, 0, 0)), app.WALKING_RADIUS_MIN_MINUTES, "empty dataset should not raise the floor");
});

test("walkingRadiusFloorMinutes rises to keep the nearest real item inside the ring, and caps at the maximum", () => {
  resetData(app);
  app.state.trees.push({ id: "close-tree", commonName: "Close tree", ...makePoint(app, 0.0009, 0) }); // ~100m away
  const closeFloor = app.walkingRadiusFloorMinutes(makePoint(app, 0, 0));
  assert.ok(closeFloor > app.WALKING_RADIUS_MIN_MINUTES, "an item beyond the absolute-minimum radius should nudge the floor above it");
  assert.ok(closeFloor < 3, "a nearby item should keep the floor small relative to the 30 min maximum");

  resetData(app);
  addFixtureData(app); // every fixture item sits >10km from (0,0), far past the 30 min ceiling
  const farFloor = app.walkingRadiusFloorMinutes(makePoint(app, 0, 0));
  assert.equal(farFloor, app.WALKING_RADIUS_MAX_MINUTES, "the floor should never exceed the slider's own maximum");
});

test("walkingRadiusFloorMinutes follows a find closer than a minute's walk below the one-minute fallback", () => {
  resetData(app);
  app.state.trees.push({ id: "underfoot-tree", commonName: "Underfoot tree", ...makePoint(app, 0.00027, 0) }); // ~30m away
  const floor = app.walkingRadiusFloorMinutes(makePoint(app, 0, 0));
  assert.ok(floor < app.WALKING_RADIUS_MIN_MINUTES, "a find seconds away should let the radius close in past a minute");
  assert.ok(floor >= app.WALKING_RADIUS_TIGHT_MIN_MINUTES, "the radius should still stop at the tightest supported ring");

  resetData(app);
  app.state.trees.push({ id: "touching-tree", commonName: "Touching tree", ...makePoint(app, 0.00001, 0) }); // ~1m away
  assert.equal(
    app.walkingRadiusFloorMinutes(makePoint(app, 0, 0)),
    app.WALKING_RADIUS_TIGHT_MIN_MINUTES,
    "standing on top of a find pins the floor at the tightest ring rather than collapsing it"
  );
});

test("sub-minute radii snap to quarter-minute steps and read as seconds", () => {
  assert.equal(app.roundWalkingMinutes(0.3), 0.25);
  assert.equal(app.roundWalkingMinutes(0.4), 0.5);
  assert.equal(app.roundWalkingMinutes(0.9), 1);
  assert.equal(app.ceilWalkingMinutes(0.26), 0.5);
  assert.equal(app.ceilWalkingMinutes(0.5), 0.5, "a value already on the grid should not jump a step");
  assert.equal(app.ceilWalkingMinutes(1.1), 1.5);
  assert.equal(app.formatWalkingRadius(0.25), "15 sec");
  assert.equal(app.formatWalkingRadius(0.5), "30 sec");
  assert.equal(app.formatWalkingRadius(1), "1 min");
  assert.equal(app.formatWalkingRadius(5.5), "6 min", "the displayed radius rounds to the nearest whole minute");
  assert.equal(app.formatWalkingRadius(5.4), "5 min");
});

test("settings slider offers the finer step once the floor drops below a minute", () => {
  resetData(app);
  app.state.trees.push({ id: "underfoot-tree", commonName: "Underfoot tree", ...makePoint(app, 0.00027, 0) });
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 0.5;

  const html = app.settingsFormHtml();
  assert.match(html, /min="0\.5" max="30" step="0\.25"/, "a close find should open up the sub-minute end of the slider");
  assert.match(html, /30 sec<\/span>/, "the live value label should read a sub-minute radius in seconds");
});

test("the walking radius grows back to the nearest remaining find once the ring empties", () => {
  resetData(app);
  app.state.trees.push({ id: "left-behind", commonName: "Left behind", ...makePoint(app, 0.009, 0) }); // ~1km away
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 0.5;

  assert.equal(app.nearbyRadiusIsEmpty(), true, "a 30-second ring a kilometre from the nearest tree holds nothing");
  assert.equal(app.ensureWalkingRadiusCoversNearest(), true);
  const grown = app.state.walkingDistanceMinutes;
  assert.ok(grown >= app.walkingRadiusFloorMinutes(app.nearbyOrigin()), "the radius should reach past the nearest remaining find");
  assert.ok(grown > 0.5 && grown < app.WALKING_RADIUS_MAX_MINUTES, "it grows to the floor, not to the whole forest");

  // A ring with something in it is left exactly as the user set it, however wide.
  assert.equal(app.ensureWalkingRadiusCoversNearest(), false);
  assert.equal(app.state.walkingDistanceMinutes, grown);

  app.state.walkingDistanceMinutes = 30;
  assert.equal(app.ensureWalkingRadiusCoversNearest(), false, "the radius is never pulled back in automatically");
  assert.equal(app.state.walkingDistanceMinutes, 30);
});

test("an open settings slider follows a radius changed from outside it", () => {
  resetData(app);
  app.state.trees.push({ id: "left-behind", commonName: "Left behind", ...makePoint(app, 0.009, 0) });
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 0.5;
  app.settingsFormHtml(); // the screen is open, showing the tight radius

  assert.equal(app.ensureWalkingRadiusCoversNearest(), true);

  const slider = app.documentStub.getElementById("settingsWalkMins");
  assert.equal(slider.value, String(app.state.walkingDistanceMinutes), "the thumb should sit at the radius the ring actually has");
  assert.equal(Number(slider.min), app.ceilWalkingMinutes(app.walkingRadiusFloorMinutes(app.state.userLocation)), "and its floor should be the new one");
  assert.equal(
    app.documentStub.getElementById("settingsWalkMinsValue").textContent,
    app.formatWalkingRadius(app.state.walkingDistanceMinutes),
    "and its label should read the same value"
  );
});

test("the automatic grow-back stands off gestures and open selections", () => {
  resetData(app);
  app.state.trees.push({ id: "left-behind", commonName: "Left behind", ...makePoint(app, 0.009, 0) });
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 0.5;

  app.state.pinchActive = true;
  assert.equal(app.ensureWalkingRadiusCoversNearest(), false, "a live pinch owns the radius");
  app.state.pinchActive = false;

  app.state.selected = { type: "tree", item: app.state.trees[0] };
  assert.equal(app.ensureWalkingRadiusCoversNearest(), false, "an open selection must not be replaced by the nearby list");
  app.state.selected = null;

  app.state.showAllOutsideRadius = true;
  assert.equal(app.ensureWalkingRadiusCoversNearest(), false, "showing all distances has no empty ring to fix");
  app.state.showAllOutsideRadius = false;

  assert.equal(app.state.walkingDistanceMinutes, 0.5, "none of the above changed the radius");

  // Mid-slide to a browsed spot the ring is what holds still on screen, so it must not resize
  // underneath the animation -- the next fix picks it up once the slide has landed.
  const spot = makePoint(app, 0.02, 0.02);
  app.setNearbyAnchor(spot.latitude, spot.longitude, spot.point);
  assert.ok(app.nearbyOriginTransitionActive(), "sanity: the browse slide is running");
  const midSlide = app.state.walkingDistanceMinutes;
  assert.equal(app.ensureWalkingRadiusCoversNearest(), false, "a browse slide holds the ring still");
  assert.equal(app.state.walkingDistanceMinutes, midSlide);
});

// A wheel event as the canvas handler reads it: deltaY in whichever unit deltaMode names, plus
// the ctrlKey every browser sets for a trackpad pinch.
function wheelEvent(deltaY, options = {}) {
  return { deltaY, deltaMode: options.deltaMode ?? 0, ctrlKey: Boolean(options.ctrlKey) };
}

function setUpWheelNearby(app) {
  resetData(app);
  app.state.trees.push({ id: "close-tree", commonName: "Close tree", ...makePoint(app, 0.0009, 0) }); // ~100m
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.walkingDistanceMinutes = 5;
  app.state.wheelRadiusMinutes = null;
}

test("scrolling the wheel resizes the walking radius rather than the map", () => {
  setUpWheelNearby(app);
  assert.equal(app.zoomInputResizesNearbyRadius(), true, "the Nearby screen is a screen that draws the ring");

  app.updateNearbyRadiusWheel(wheelEvent(-100)); // one notch "zoom in"
  const zoomedIn = app.state.walkingDistanceMinutes;
  assert.ok(zoomedIn < 5, "scrolling in should shrink the ring");

  app.updateNearbyRadiusWheel(wheelEvent(100)); // one notch back out
  assert.ok(app.state.walkingDistanceMinutes > zoomedIn, "scrolling out should grow it again");
});

test("a wheel gesture keeps its own running value, so small trackpad deltas still add up", () => {
  setUpWheelNearby(app);

  // The radius moves continuously -- no value grid to round away to -- so even one tiny delta
  // nudges it immediately.
  app.updateNearbyRadiusWheel(wheelEvent(-2, { ctrlKey: true }));
  const afterOne = app.state.walkingDistanceMinutes;
  assert.ok(afterOne < 5, "a single trackpad delta already moves the ring");
  assert.equal(app.state.wheelRadiusMinutes, afterOne, "the gesture's running value matches what was applied");

  // ...and a run of them keeps moving it further in the same direction.
  for (let i = 0; i < 20; i += 1) app.updateNearbyRadiusWheel(wheelEvent(-2, { ctrlKey: true }));
  assert.ok(app.state.walkingDistanceMinutes < afterOne, "a continued trackpad pinch should keep shrinking the ring");
});

test("a trackpad pinch moves the radius further than the same wheel delta", () => {
  setUpWheelNearby(app);
  app.updateNearbyRadiusWheel(wheelEvent(-30));
  const byWheel = app.state.wheelRadiusMinutes;

  setUpWheelNearby(app);
  app.updateNearbyRadiusWheel(wheelEvent(-30, { ctrlKey: true }));
  assert.ok(app.state.wheelRadiusMinutes < byWheel, "the trackpad rate should be the faster of the two");
});

test("normalizeWheelPixels converts line and page deltas to pixels", () => {
  assert.equal(app.normalizeWheelPixels(wheelEvent(120)), 120);
  assert.equal(app.normalizeWheelPixels(wheelEvent(3, { deltaMode: 1 })), 48);
  assert.equal(app.normalizeWheelPixels(wheelEvent(1, { deltaMode: 2 })), 100);
  assert.equal(app.normalizeWheelPixels(wheelEvent(NaN)), 0);
});

test("the wheel stops at the walking-radius floor and shows the same limit notice the pinch does", () => {
  setUpWheelNearby(app);
  const floor = app.walkingRadiusFloorMinutes(app.nearbyOrigin());

  for (let i = 0; i < 30; i += 1) app.updateNearbyRadiusWheel(wheelEvent(-100));
  assert.ok(app.state.walkingDistanceMinutes >= floor, "the ring never closes past its own contents");
  assert.equal(app.state.walkingRadiusAtFloor, true, "scrolling past the floor should raise the notice");

  // The gesture ends on a timeout rather than a pointerup, and clears the transient notice.
  app.endNearbyRadiusWheel();
  assert.equal(app.state.walkingRadiusAtFloor, false);
  assert.equal(app.state.wheelRadiusMinutes, null, "the next scroll starts from where the radius ended up");
});

test("a wheel over a real selection is left to zoom the map", () => {
  setUpWheelNearby(app);
  app.state.selected = { type: "tree", item: app.state.trees[0] };
  assert.equal(app.zoomInputResizesNearbyRadius(), false, "a selection replaces the ring view entirely");
  app.state.selected = null;

  app.state.userLocation = null;
  assert.equal(app.zoomInputResizesNearbyRadius(), false, "and with no location there is no ring to resize");
});

test("Safari's own trackpad pinch events resize the radius too", () => {
  setUpWheelNearby(app);
  app.state.gestureRadiusBaseMinutes = null;

  // Safari sends gesturestart/gesturechange/gestureend with a cumulative scale rather than the
  // ctrl+wheel Chrome and Firefox report, so without this path a Mac pinch would do nothing.
  app.startNearbyRadiusGesture();
  app.updateNearbyRadiusGesture({ scale: 2 }); // fingers spread apart -- zoom in
  assert.ok(app.state.walkingDistanceMinutes < 5, "spreading apart should close the ring in");

  app.updateNearbyRadiusGesture({ scale: 0.5 }); // and back past where it started
  assert.ok(app.state.walkingDistanceMinutes > 5, "pinching together should widen it");

  // Measured from where the gesture began, not from the last frame, so it tracks the fingers.
  app.updateNearbyRadiusGesture({ scale: 1 });
  assert.equal(app.state.walkingDistanceMinutes, 5, "returning the fingers returns the radius");

  app.endNearbyRadiusGesture();
  assert.equal(app.state.gestureRadiusBaseMinutes, null);
  assert.equal(app.state.walkingRadiusAtFloor, false);

  // A stray gesturechange outside a gesture (or a garbage scale) must not move anything.
  app.updateNearbyRadiusGesture({ scale: 0 });
  app.updateNearbyRadiusGesture({});
  assert.equal(app.state.walkingDistanceMinutes, 5);
});

test("settings form's slider floor hides tick marks the user can no longer reach", () => {
  resetData(app);
  addFixtureData(app);
  app.state.userLocation = makePoint(app, 0, 0);

  const html = app.settingsFormHtml();
  assert.match(html, /min="30" max="30" step="0.5"/, "slider should collapse to the maximum when nothing closer exists");
  assert.doesNotMatch(html, /<option value="1">/, "unreachable presets below the floor should not appear as tick marks");
  assert.match(html, /<option value="30">/, "the reachable preset at the floor should still appear as a tick mark");
});

test("roundWalkingMinutes snaps the settings slider's own value to the nearest half-minute", () => {
  assert.equal(app.roundWalkingMinutes(5.2), 5);
  assert.equal(app.roundWalkingMinutes(5.3), 5.5);
});

// Helpers for the submit-flow tests: stub the network and capture what is POSTed.
function withReportNetwork(app, respond, run) {
  const sent = [];
  const previousFetch = app.swapGlobalFunction("fetch", async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return respond;
  });
  const wasOnline = app.navigator.onLine;
  app.navigator.onLine = true;
  return Promise.resolve(run(sent)).finally(() => {
    app.swapGlobalFunction("fetch", previousFetch);
    app.navigator.onLine = wasOnline;
  });
}
const okResponse = { ok: true, status: 200, json: async () => ({ issueUrl: "https://github.com/o/r/issues/9" }) };

test("report submission includes the app version", async () => {
  resetData(app);
  assert.ok(!app.reportFormHtml().includes("App version:"), "report form should not display the app version");
  const details = app.documentStub.getElementById("reportDetails");

  await withReportNetwork(app, okResponse, async (sent) => {
    app.state.swVersion = "forest-finds-app-77";
    details.value = "The gate is broken";
    await app.submitReportForm();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.appVersion, "forest-finds-app-77", "the live service worker version is reported");

    app.state.swVersion = null;
    details.value = "Still broken";
    await app.submitReportForm();
    assert.ok(sent[1].body.appVersion, "falls back to the built-in version before the worker has reported one");
  });
});

test("a submitted report's issue URL renders as a real clickable link, not plain text", () => {
  const status = app.documentStub.createElement("p");
  app.applyReportStatusContent(status, "Report submitted successfully.", "success", "https://github.com/o/r/issues/9");
  assert.equal(status.textContent, "Report submitted successfully.");
  assert.ok(status.classList.contains("success"));
  assert.equal(status.children.length, 1);
  assert.equal(status.children[0].tagName, "A");
  assert.equal(status.children[0].href, "https://github.com/o/r/issues/9");

  const unsafe = app.documentStub.createElement("p");
  app.applyReportStatusContent(unsafe, "Report submitted successfully.", "success", "javascript:alert(1)");
  assert.equal(unsafe.children.length, 0, "only https links are ever made clickable");
});

test("report-photo links use the active deploy before the production site", () => {
  const { reportPhotoUrl } = require("../netlify/functions/report-missing-data");
  const saved = { prime: process.env.DEPLOY_PRIME_URL, url: process.env.URL };
  try {
    process.env.DEPLOY_PRIME_URL = "https://deploy-preview-5--site.netlify.app/";
    process.env.URL = "https://production.example";
    assert.equal(reportPhotoUrl("abc.jpg", ""), "https://deploy-preview-5--site.netlify.app/.netlify/functions/report-missing-data?photo=abc.jpg",
      "a preview's Blob photo must link to its own deploy, not production");
    delete process.env.DEPLOY_PRIME_URL;
    assert.equal(reportPhotoUrl("abc.jpg", ""), "https://production.example/.netlify/functions/report-missing-data?photo=abc.jpg");
    delete process.env.URL;
    assert.equal(reportPhotoUrl("abc.jpg", "https://forest.example/nearby"), "https://forest.example/.netlify/functions/report-missing-data?photo=abc.jpg", "falls back to the reporting page's own origin");
    assert.equal(reportPhotoUrl("abc.jpg", "http://insecure.example/"), "", "never links to a non-https origin");
  } finally {
    for (const [key, name] of [["prime", "DEPLOY_PRIME_URL"], ["url", "URL"]]) {
      if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
    }
  }
});

test("a tree or landmark's detail view offers to report a problem with its own coordinates", () => {
  const withPoint = app.reportIssueHtml({ type: "Veteran tree", name: "Hangman's Oak", latitude: 51.65, longitude: 0.03 });
  assert.match(withPoint, /Noticed a problem with this location\?/);
  assert.match(withPoint, /data-report-type="Veteran tree"/);
  assert.match(withPoint, /data-report-name="Hangman&#039;s Oak"/);
  assert.match(withPoint, /data-report-lat="51.65"/);
  assert.match(withPoint, /data-report-lon="0.03"/);
});

test("reportIssueHtml renders nothing for a line/area feature with no single coordinate", () => {
  assert.equal(app.reportIssueHtml({ type: "Road", name: "Forest Road", latitude: null, longitude: null }), "");
  assert.equal(app.reportIssueHtml(null), "");
});

test("a mapped place can link back to the Ledger edition that featured it", () => {
  const html = app.ledgerMentionHtml({ ledgerUrl: "/reports/epping-forest-ledger-2026-10-17.html" });
  assert.match(html, /href="\/reports\/epping-forest-ledger-2026-10-17\.html"/);
  assert.match(html, /Featured in the Epping Forest Ledger/);
  assert.equal(app.ledgerMentionHtml({ ledgerUrl: "https://example.com/reports/epping-forest-ledger-2026-10-17.html" }), "");
});

test("submitting a location-issue report sends the flagged item's own coordinates, not the reporter's GPS fix", async () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.5, 0.5);
  const status = app.documentStub.createElement("p");
  const nodes = {
    ".report-textarea": Object.assign(app.documentStub.createElement("textarea"), { value: "Fallen over" }),
    ".report-status": status,
    "[data-action='submit-location-issue']": app.documentStub.createElement("button"),
  };
  const wrapper = {
    dataset: { reportLat: "51.65123456", reportLon: "0.03", reportType: "Veteran tree", reportName: "Hangman's Oak" },
    querySelector: (selector) => nodes[selector] || null,
  };

  await withReportNetwork(app, okResponse, async (sent) => {
    await app.submitLocationIssueReport(wrapper);
    assert.equal(sent.length, 1);
    const { body } = sent[0];
    assert.equal(body.reportType, "location-issue");
    assert.deepEqual(body.location, { latitude: 51.651235, longitude: 0.03 }, "the flagged item's coordinates, not the GPS fix");
    assert.deepEqual(body.locationContext, { type: "Veteran tree", name: "Hangman's Oak" });
    assert.match(status.textContent, /submitted/i);
    assert.equal(nodes[".report-textarea"].value, "", "the form clears after a successful submit");
  });
});

test("a report with no details is not sent", async () => {
  resetData(app);
  const nodes = {
    ".report-textarea": Object.assign(app.documentStub.createElement("textarea"), { value: "   " }),
    ".report-status": app.documentStub.createElement("p"),
  };
  await withReportNetwork(app, okResponse, async (sent) => {
    await app.submitLocationIssueReport({ dataset: { reportLat: "51.6", reportLon: "0.03" }, querySelector: (s) => nodes[s] || null });
    assert.equal(sent.length, 0);
    assert.match(nodes[".report-status"].textContent, /describe the problem/i);
  });
});

test("walking radius circle is always fully visible on screen after centering", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  app.state.walkingDistanceMinutes = 5;
  app.els.canvas.width = 1000;
  app.els.canvas.height = 800;
  // Use a very large scale that would push the radius off screen
  app.state.viewport = { scale: 999999, tx: 0, ty: 0 };

  app.centerOverviewOnUserLocation({ animate: false, focusVisibleArea: false });

  // Compute where the radius edge ends up in screen space
  const radiusMetres = app.walkingDistanceToMetres(app.state.walkingDistanceMinutes);
  const edgeWorld = app.projectLonLat(
    app.state.userLocation.longitude + (radiusMetres / (111320 * Math.cos(app.state.userLocation.latitude * Math.PI / 180))),
    app.state.userLocation.latitude
  );
  const center = app.worldToScreen(app.state.userLocation.point);
  const edge = app.worldToScreen(edgeWorld);
  const radiusPx = Math.hypot(edge.x - center.x, edge.y - center.y);

  const canvasWidth = app.els.canvas.width;
  const canvasHeight = app.els.canvas.height;

  // The full circle must fit within the canvas
  assert.ok(center.x - radiusPx >= 0, `left edge of radius circle off screen: ${center.x - radiusPx}`);
  assert.ok(center.x + radiusPx <= canvasWidth, `right edge of radius circle off screen: ${center.x + radiusPx} > ${canvasWidth}`);
  assert.ok(center.y - radiusPx >= 0, `top edge of radius circle off screen: ${center.y - radiusPx}`);
  assert.ok(center.y + radiusPx <= canvasHeight, `bottom edge of radius circle off screen: ${center.y + radiusPx} > ${canvasHeight}`);
});

test("walking radius circle fits in visible area even with inspector open", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  app.state.walkingDistanceMinutes = 10;
  app.els.canvas.width = 1000;
  app.els.canvas.height = 800;
  // Simulate inspector taking bottom 48% of canvas
  app.els.inspector.classList.remove("minimized");
  app.state.viewport = { scale: 999999, tx: 0, ty: 0 };

  app.centerOverviewOnUserLocation({ animate: false, focusVisibleArea: true });

  const radiusMetres = app.walkingDistanceToMetres(app.state.walkingDistanceMinutes);
  const edgeWorld = app.projectLonLat(
    app.state.userLocation.longitude + (radiusMetres / (111320 * Math.cos(app.state.userLocation.latitude * Math.PI / 180))),
    app.state.userLocation.latitude
  );
  const center = app.worldToScreen(app.state.userLocation.point);
  const edge = app.worldToScreen(edgeWorld);
  const radiusPx = Math.hypot(edge.x - center.x, edge.y - center.y);

  const canvasWidth = app.els.canvas.width;
  const canvasHeight = app.els.canvas.height;

  assert.ok(center.x - radiusPx >= 0, `left edge of radius circle off screen: ${center.x - radiusPx}`);
  assert.ok(center.x + radiusPx <= canvasWidth, `right edge of radius circle off screen: ${center.x + radiusPx} > ${canvasWidth}`);
  assert.ok(center.y - radiusPx >= 0, `top edge of radius circle off screen: ${center.y - radiusPx}`);
  assert.ok(center.y + radiusPx <= canvasHeight, `bottom edge of radius circle off screen: ${center.y + radiusPx} > ${canvasHeight}`);
});

test("filter screen sets the URL to /nearby/filter", () => {
  resetData(app);
  app.openFiltersScreen();
  assert.equal(app.location.pathname, "/nearby/filter", "filter screen has its own path");
});

test("the /nearby/filter path opens the filter screen on load", () => {
  resetData(app);
  app.location.pathname = "/nearby/filter";
  const opened = app.applySelectionFromHash(false);
  assert.ok(opened, "applySelectionFromHash returns true for /nearby/filter");
  assert.ok(app.state.filterScreenOpen, "filter screen is open");
  assert.equal(app.els.inspectorTitle.textContent, "Filters", "inspector shows Filters title");
  app.location.pathname = "/";
});

test("returning to nearby screen goes back to /nearby with no hash", () => {
  resetData(app);
  app.openFiltersScreen();
  assert.equal(app.location.pathname, "/nearby/filter", "path is set to /nearby/filter");
  app.goToInitialView();
  assert.equal(app.location.pathname, "/nearby", "path returns to /nearby");
  assert.equal(app.location.hash, "", "and carries no hash");
  assert.equal(app.state.filterScreenOpen, false, "filter screen is closed");
});

test("selecting a tree sets hash with tree parameter", () => {
  resetData(app);
  // The link carries the record number, prefixed so it cannot be read as the old id/tag-based
  // key -- the two numbering spaces overlap, so an unprefixed key would be ambiguous about
  // which scheme it was written in.
  app.state.trees = [{
    id: "0", tagNumber: "0", recordNumber: 12345,
    latitude: 51.65, longitude: 0.05, point: app.projectLonLat(0.05, 51.65),
    location: { britishNationalGrid: { easting: 540000, northing: 195000, gridReference: "TL 400 950" } },
  }];
  app.state.selected = { type: "tree", item: app.state.trees[0] };
  app.syncHashFromSelection();
  assert.ok(app.location.hash.includes("tree=r12345"), `hash contains the record-number key, got ${app.location.hash}`);

  app.location.hash = "#tree=r12345";
  app.applySelectionFromHash(false);
  assert.equal(app.state.selected?.item?.recordNumber, 12345, "and that link opens the tree it names");
});

test("links shared before the tree key changed still open the tree they always did", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  // Tag 11383 and record 11383 are two different real trees. An old #tree=11383 link was
  // written against the tag, so it must not now resolve to the record that happens to share
  // the number.
  const taggedTree = { id: "11383", tagNumber: "11383", recordNumber: 700, commonName: "English Oak", ...makePoint(app, 51.6501, 0.05) };
  const sameNumberedRecord = { id: "0", tagNumber: "0", recordNumber: 11383, commonName: "Common Beech", ...makePoint(app, 51.6502, 0.05) };
  const anotherUntagged = { id: "0", tagNumber: "0", recordNumber: 701, commonName: "Hornbeam", ...makePoint(app, 51.6503, 0.05) };
  app.state.trees = [sameNumberedRecord, taggedTree, anotherUntagged];

  assert.equal(app.findTreeByHashKey("11383"), taggedTree, "the unprefixed key is read as the old tag-based one");
  assert.equal(app.findTreeByHashKey("r11383"), sameNumberedRecord, "the prefixed key is read as a record number");

  // A key that was ambiguous under the old scheme ("0" matched 6,504 trees) resolves to
  // nothing rather than to an arbitrary one of them.
  assert.equal(app.findTreeByHashKey("0"), null, "an ambiguous legacy key opens nothing");
});

test("hash with tree parameter loads that tree", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const tree = {
    id: "99999",
    latitude: 51.65,
    longitude: 0.05,
    point: app.projectLonLat(0.05, 51.65),
    tagNumber: "99999",
    commonName: "Test Oak",
    location: {
      britishNationalGrid: { easting: 540000, northing: 195000, gridReference: "TL 400 950" }
    }
  };
  app.state.trees = [tree];
  app.location.hash = "#tree=99999";
  const opened = app.applySelectionFromHash(false);
  assert.ok(opened, "applySelectionFromHash returns true for tree hash");
  assert.equal(app.state.selected?.type, "tree", "tree is selected");
  assert.equal(app.state.selected?.item?.id, "99999", "correct tree is selected");
});

test("hash with tree parameter opens the inspector expanded on a mobile viewport (regression: previously minimized)", () => {
  resetData(app);
  app.windowStub.innerWidth = 390; // narrow/mobile width
  app.els.inspector.classList.remove("minimized");
  const tree = {
    id: "88888",
    latitude: 51.65,
    longitude: 0.05,
    point: app.projectLonLat(0.05, 51.65),
    tagNumber: "88888",
    commonName: "Test Beech",
    location: {
      britishNationalGrid: { easting: 540000, northing: 195000, gridReference: "TL 400 950" }
    }
  };
  app.state.trees = [tree];
  app.location.hash = "#tree=88888";
  const opened = app.applySelectionFromHash(false);
  assert.ok(opened, "applySelectionFromHash returns true for tree hash");
  assert.equal(
    app.els.inspector.classList.contains("minimized"),
    false,
    "inspector must open expanded when a location is loaded via a link, even on mobile widths"
  );
});

test("hash-selecting a new tree re-expands the inspector even if it was left minimized (e.g. re-navigating via hashchange)", () => {
  resetData(app);
  app.windowStub.innerWidth = 390; // narrow/mobile width
  const tree = {
    id: "77777",
    latitude: 51.65,
    longitude: 0.05,
    point: app.projectLonLat(0.05, 51.65),
    tagNumber: "77777",
    commonName: "Test Ash",
    location: {
      britishNationalGrid: { easting: 540000, northing: 195000, gridReference: "TL 400 950" }
    }
  };
  app.state.trees = [tree];
  app.els.inspector.classList.add("minimized"); // simulate the inspector already being collapsed
  app.location.hash = "#tree=77777";
  const opened = app.applySelectionFromHash(false);
  assert.ok(opened, "applySelectionFromHash returns true for tree hash");
  assert.equal(
    app.els.inspector.classList.contains("minimized"),
    false,
    "inspector must be forced back open, not left minimized from before the new link was loaded"
  );
});

// --- Router: the URL is the navigation state ---
//
// Every screen has a URL and every screen change writes a history entry, so back retraces the
// trail (spec.md "URL hash / navigation state"). Before this the app only ever replaceState'd,
// so back left the site from wherever the user had got to.

// Puts the session history back to a single landing entry, the way a fresh page load leaves it.
function resetRouter(app, hash = "") {
  app.location.pathname = "/";
  app.location.search = "";
  app.location.hash = hash;
  app.history.entries = [{ state: null, url: `/${hash}` }];
  app.history.index = 0;
  app.initRouter();
}

test("opening a screen adds a history entry rather than replacing the one behind it", () => {
  resetData(app);
  resetRouter(app);
  const before = app.history.length;
  app.openFiltersScreen();
  app.openSettings();
  assert.equal(app.history.length, before + 2, "Filters and Settings each added an entry");
  assert.equal(app.location.pathname, "/settings", "Settings has its own path");
});

test("Settings and Report each have a URL of their own that opens them again", () => {
  resetData(app);
  resetRouter(app, "#settings");
  assert.equal(app.applySelectionFromHash(false), true, "#settings is a route");
  assert.equal(app.state.selected?.type, "settings", "and it opens the Settings screen");

  resetData(app);
  resetRouter(app, "#report");
  assert.equal(app.applySelectionFromHash(false), true, "#report is a route");
  assert.equal(app.state.selected?.type, "report", "and it opens the Report screen");
});

test("going back returns to the screen the trail came from, a step at a time", () => {
  resetData(app);
  resetRouter(app);
  app.setupSearchAndNavHandlers(); // registers the popstate handler the browser fires
  app.openFiltersScreen();
  app.openSettings();

  app.history.back();
  assert.equal(app.state.filterScreenOpen, true, "back from Settings lands on Filters");

  app.history.back();
  assert.equal(app.state.filterScreenOpen, false, "and back again lands on Nearby");
  assert.equal(app.location.hash, "", "with the Nearby URL restored");
});

test("going back does not itself write a history entry", () => {
  resetData(app);
  resetRouter(app);
  app.setupSearchAndNavHandlers();
  app.openFiltersScreen();
  app.openSettings();
  const length = app.history.length;
  app.history.back();
  assert.equal(app.history.length, length, "applying a route from the URL must not bury the entry behind it");
});

test("going back to /nearby/filter never flags the filters already showing as a page's own ephemeral lens", () => {
  // Regression: /nearby/filter's own live ?show= (searchStringForPath) round-trips through
  // applyShowFilterFromQuery on every popstate, including a plain back-navigation retracing a
  // history entry this same reader's own filterToggle click created. Before the fix, reapplying
  // that round-tripped ?show= set state.overviewFiltersEphemeral regardless of whether anything
  // had actually changed -- which, combined with no location, handed the ordinary 1-3 filter
  // default state the no-location full-list/fit treatment meant only for an actual
  // /nearby/<slug> arrival (i.e. tried to list and fit every tree in the forest on every single
  // back-navigation to the Filter screen).
  resetData(app);
  app.state.userLocation = null;
  // searchStringForPath only ever puts ?show= on /nearby/filter's own URL when some filter is
  // active -- resetData starts with none, which would make this test a no-op (no ?show= to
  // round-trip at all). The real boot default (DEFAULT_FILTERS) is exactly the case that broke.
  app.state.overviewFilters = app.DEFAULT_FILTERS.slice();
  resetRouter(app);
  app.setupSearchAndNavHandlers();
  app.openFiltersScreen();
  app.openSettings();

  app.history.back();
  assert.equal(app.state.filterScreenOpen, true, "back from Settings lands on Filters again");
  assert.match(app.location.search, /show=/, "the Filters URL really did round-trip a ?show= -- otherwise this test proves nothing");
  assert.equal(
    app.state.overviewFiltersEphemeral,
    false,
    "retracing the trail back to Filters is not a /nearby/<slug> arrival -- the default filters are still the reader's own"
  );
  assert.equal(
    app.activeFiltersShowFullListWithoutLocation(),
    false,
    "and so never gets the no-location full-list/fit treatment that reading applies for"
  );
});

test("the inspector back arrow steps back through the trail when a screen sits behind the current one", () => {
  resetData(app);
  resetRouter(app);
  app.setupSearchAndNavHandlers();
  app.openFiltersScreen();
  app.openSettings();
  assert.equal(app.canGoBackInApp(), true, "two screens deep, there is something to go back to");
  app.navigateBack();
  assert.equal(app.state.filterScreenOpen, true, "the arrow goes back one step, not straight to Nearby");
});

test("the inspector back arrow returns to Nearby when the app was opened straight onto a screen", () => {
  resetData(app);
  resetRouter(app, "#filters");
  app.applySelectionFromHash(false);
  assert.equal(app.state.filterScreenOpen, true, "the link opened Filters");
  assert.equal(app.canGoBackInApp(), false, "a link opened in a fresh tab has nothing of this app's behind it");
  app.navigateBack();
  assert.equal(app.state.filterScreenOpen, false, "so the arrow returns to Nearby rather than leaving the site");
});

test("selecting something other than a tree or a place names it in the URL instead of clearing it", () => {
  resetData(app);
  resetRouter(app);
  const cow = { serialNo: 4242, ...makePoint(app, 51.65, 0.05) };
  app.state.cows = [cow];
  app.state.selected = { type: "cow", item: cow };
  app.syncHashFromSelection();
  assert.ok(app.location.hash.includes("cow"), `the cow is in the URL, got ${app.location.hash}`);

  app.state.selected = null;
  assert.equal(app.applySelectionFromHash(false), true, "and the URL opens it again");
  assert.equal(app.state.selected?.item?.serialNo, 4242, "resolving to the same cow");
  // showCowDetails starts a 30s "position updated" ticker; nothing else here would stop it.
  if (app.state.cowDetailTimerId != null) {
    clearInterval(app.state.cowDetailTimerId);
    app.state.cowDetailTimerId = null;
  }
});

test("a tapped street or railway line gets a URL too, so the address bar never describes a screen the user has left", () => {
  resetData(app);
  resetRouter(app);
  const road = {
    name: "Whitehall Road",
    roadType: "residential",
    segments: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]],
    bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  };
  app.state.roads = [road];
  app.state.selected = { type: "road", item: road };
  app.syncHashFromSelection();
  assert.ok(app.location.hash.startsWith("#road="), `the street is in the URL, got ${app.location.hash}`);
  assert.equal(app.findRoadByHashKey(app.roadHashKey(road)), road, "and the key resolves back to the same street");

  const railway = { properties: { id: "way/30804", featureType: "railway", name: "Chingford Branch" } };
  app.state.environmentFeatures = [railway];
  app.state.selected = { type: "railway", item: railway };
  app.syncHashFromSelection();
  assert.ok(app.location.hash.startsWith("#railway="), `the line is in the URL, got ${app.location.hash}`);
  assert.equal(app.findRailwayByHashKey("way/30804"), railway, "and the key resolves back to the same line");
});

test("an expanded map group is a screen back can leave, though it has no URL of its own", () => {
  resetData(app);
  resetRouter(app);
  app.setupSearchAndNavHandlers();
  app.openFiltersScreen();
  const entries = app.history.length;

  // What showClusterDetail does: it takes over the inspector, and pushes an entry carrying the
  // URL of the screen it opened on top of.
  app.state.filterScreenOpen = false;
  app.state.clusterExpanded = { itemType: "tree", items: [] };
  app.setHashFromSelection(app.currentScreenRoute(), { force: true });

  assert.equal(app.history.length, entries + 1, "the group pushes an entry even with no URL of its own");
  assert.equal(app.urlMatchesCurrentScreen(""), false, "an open group never counts as already matching a URL...");
  app.history.back();
  assert.equal(app.state.clusterExpanded, null, "...so going back closes it");
});

test("a link naming something this dataset does not have falls back to Nearby and corrects the URL", () => {
  resetData(app);
  resetRouter(app, "#tree=r999999");
  const applied = app.applySelectionFromHash(false);
  assert.equal(applied, false, "nothing was opened");
  assert.equal(app.location.hash, "", "the dead URL is cleared rather than left describing a screen that never opened");
  assert.equal(app.history.length, 1, "and corrected in place rather than pushing another entry");
});

// --- Offline support ---

test("service worker APP_SHELL includes css/tracking.css so consent modal works offline", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, "APP_SHELL list exists");
  assert.ok(shellMatch[1].includes("./css/tracking.css"), "tracking.css must be in APP_SHELL — without it the consent modal has no positioning styles offline, making the location gate button appear unresponsive");
});

test("service worker APP_SHELL includes all CSS files referenced by app.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, "APP_SHELL list exists");

  const cssRefs = [...html.matchAll(/href="(css\/[^"]+\.css)"/g)].map((m) => `./${m[1]}`);
  assert.ok(cssRefs.length > 0, "app.html should reference CSS files");
  for (const cssFile of cssRefs) {
    assert.ok(shellMatch[1].includes(cssFile), `APP_SHELL missing ${cssFile} — page will be unstyled offline`);
  }
});

test("service worker APP_SHELL includes all JS files referenced by app.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, "APP_SHELL list exists");

  const jsRefs = [...html.matchAll(/src="(js\/[^"?]+\.js)(?:\?[^"]*)?"/g)].map((m) => `./${m[1]}`);
  assert.ok(jsRefs.length > 0, "app.html should reference JS files");
  for (const jsFile of jsRefs) {
    assert.ok(shellMatch[1].includes(jsFile), `APP_SHELL missing ${jsFile} — app will not boot offline`);
  }
});

test("service worker falls back to the cached app shell offline for /nearby/<slug>/ and /find/<slug>/ pages, never a network error", () => {
  // Executes the real sw.js (not a regex match on its source) so a logic error in the pattern --
  // wrong anchor, missing the trailing-slash variant, an inverted condition -- fails this test
  // rather than shipping. These ~1,500+29 generated pages (scripts/generate-business-pages.js,
  // scripts/generate-find-pages.js) are templated off the same app.html as /nearby itself, so
  // offline they fall back to that same cached shell instead of the browser's own offline error
  // page -- see isAppNavigation's own comment in sw.js for why a generic fallback is the right
  // trade-off here rather than precaching every one of them.
  const root = path.join(__dirname, "..");
  const context = {
    self: { addEventListener: () => {}, skipWaiting: () => {}, clients: { claim: () => {} }, registration: {} },
    importScripts: () => {},
    caches: { open: async () => ({}), match: async () => null, keys: async () => [] },
    fetch: async () => ({ ok: false }),
    console,
    URL,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "app-cache-version.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "data-cache-version.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "sw.js"), "utf8"), context, { filename: "sw.js" });

  const isAppNavigation = (pathname) => vm.runInContext(`isAppNavigation(${JSON.stringify(pathname)})`, context);

  for (const pathname of ["/nearby/pubs/", "/nearby/pubs", "/nearby/food/", "/nearby/events/", "/find/the-forresters/", "/find/events/", "/find/costa-e4/"]) {
    assert.equal(isAppNavigation(pathname), true, `${pathname} should fall back to the cached app shell`);
  }
  for (const pathname of ["/", "/reports/", "/terms.html", "/find/pubs/nested", "/nearby/pubs/nested"]) {
    assert.equal(isAppNavigation(pathname), false, `${pathname} must stay off the app cache`);
  }
});

test("service worker never overwrites the installed app shell from a navigation, whether a stable screen or a /nearby/<slug>/ or /find/<slug>/ page", async () => {
  // Each generated page has its own distinct title/JSON-LD/initial body -- caching any single one
  // of them under the one "./app.html" key the five stable screens share would make that slot's
  // content depend on whichever page a visitor last loaded, corrupting every other page's offline
  // fallback. A stable screen's network copy is not written either: it may be the next release's
  // page, which would then boot against this release's cached scripts. Executes the real fetch
  // handler against a fake navigate event and a cache spy,
  // rather than inspecting the source, so a regression here would actually fail this.
  const root = path.join(__dirname, "..");
  let fetchHandler = null;
  const cachePuts = [];
  const context = {
    self: {
      addEventListener: (type, handler) => { if (type === "fetch") fetchHandler = handler; },
      skipWaiting: () => {},
      clients: { claim: () => {} },
      registration: {},
      location: { origin: "http://localhost:8080" },
    },
    importScripts: () => {},
    caches: {
      open: async () => ({ put: async (key) => cachePuts.push(key), match: async () => ({ __cached: true }) }),
      match: async () => ({ __cached: true }),
      keys: async () => [],
    },
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    console,
    URL,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "app-cache-version.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "data-cache-version.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "sw.js"), "utf8"), context, { filename: "sw.js" });

  async function fireNavigate(pathname) {
    cachePuts.length = 0;
    let responded = null;
    fetchHandler({
      request: { url: `http://localhost:8080${pathname}`, method: "GET", mode: "navigate" },
      respondWith: (p) => { responded = p; },
    });
    await responded;
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the detached cache.put chain settle
    return [...cachePuts];
  }

  assert.deepEqual(await fireNavigate("/nearby"), [], "a newer deploy's page must not replace the shell matching this release's scripts");
  assert.deepEqual(await fireNavigate("/find/the-forresters/"), [], "a business page must never overwrite it");
  assert.deepEqual(await fireNavigate("/nearby/pubs/"), [], "a category page must never overwrite it either");
});

test("netlify.toml makes the browser revalidate sw.js and its version markers (shipped-config invariant)", () => {
  const toml = fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8");
  for (const file of ["/sw.js", "/js/app-cache-version.js", "/js/data-cache-version.js"]) {
    assert.match(toml, new RegExp(`for = "${file.replace(/[./]/g, "\\$&")}"\\s+\\[headers\\.values\\]\\s+Cache-Control = "no-cache"`), `${file} must be revalidated`);
  }
});

// Fake service-worker environment for the update and background-sync flows.
function withFakeServiceWorker(app, { online = true, controller = null } = {}, run) {
  const nav = app.navigator;
  const wasOnline = nav.onLine;
  const reloads = [];
  const previous = {
    location: app.swapGlobalFunction("location", { reload: () => reloads.push("reload") }),
    setTimeout: app.swapGlobalFunction("setTimeout", () => 0),
  };
  nav.onLine = online;
  nav.serviceWorker = { controller };
  const cleanup = () => {
    delete nav.serviceWorker;
    nav.onLine = wasOnline;
    app.swapGlobalFunction("location", previous.location);
    app.swapGlobalFunction("setTimeout", previous.setTimeout);
  };
  return Promise.resolve(run(reloads)).finally(cleanup);
}

test("the app asks the controlling worker for a background data sync, but not offline or before a worker controls the page", async () => {
  const messages = [];
  const controller = { postMessage: (m) => messages.push(m) };

  await withFakeServiceWorker(app, { controller }, () => Promise.all([app.requestBackgroundDataSync(), app.requestBackgroundDataSync({ force: true })]));
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: "SYNC_DATA", force: false }, { type: "SYNC_DATA", force: true }]);

  messages.length = 0;
  await withFakeServiceWorker(app, { controller, online: false }, () => app.requestBackgroundDataSync());
  await withFakeServiceWorker(app, { controller: null }, () => app.requestBackgroundDataSync());
  assert.deepEqual(messages, [], "nothing is sent offline, or on a first load with nothing cached to refresh");
});

test("on a first visit the background sync waits until the page's own map downloads have reached the cache", async () => {
  const messages = [];
  const controller = { postMessage: (m) => messages.push(m) };
  let finishHandOver;
  const previousFetch = app.swapGlobalFunction("fetch", async () => ({ ok: true, clone: () => ({}) }));
  const previousCaches = app.swapGlobalFunction("caches", {
    open: async () => ({ put: () => new Promise((resolve) => { finishHandOver = resolve; }) }),
  });
  const nav = app.navigator;
  const previousSw = nav.serviceWorker;
  const wasOnline = nav.onLine;
  nav.onLine = true;
  try {
    // Downloaded before the worker took control: the hand-over to the cache is still being written.
    nav.serviceWorker = { controller: null, getRegistration: async () => ({}) };
    await app.fetchMapData("data/local-environment.geojson");
    await new Promise((resolve) => setImmediate(resolve));
    // The worker takes control and the page asks for a sync.
    nav.serviceWorker = { controller };
    const sync = app.requestBackgroundDataSync();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(messages, [], "no sync while the file is still on its way into the cache");
    finishHandOver();
    await sync;
    assert.equal(messages.length, 1, "the sync goes out once the hand-over has landed");
  } finally {
    nav.onLine = wasOnline;
    app.swapGlobalFunction("fetch", previousFetch);
    app.swapGlobalFunction("caches", previousCaches);
    if (previousSw === undefined) delete nav.serviceWorker; else nav.serviceWorker = previousSw;
  }
});

test("applying an update activates the fully downloaded waiting worker and never reloads straight away", async () => {
  resetData(app);
  const messages = [];
  app.state.swWaiting = { postMessage: (m) => messages.push(m) };
  await withFakeServiceWorker(app, {}, async (reloads) => {
    assert.equal(await app.applySwUpdate(), true);
    assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: "SKIP_WAITING" }]);
    assert.equal(app.state.swPendingReload, true, "the reload waits for the new worker to take control");
    assert.deepEqual(reloads, [], "no immediate reload: that would strand the page if activation failed");
  });
  app.state.swWaiting = null;
  app.state.swPendingReload = false;
});

test("applying an update with no complete downloaded worker leaves the current app running", async () => {
  resetData(app);
  app.state.swWaiting = null;
  const wasStatus = app.documentStub.getElementById("refreshStatus");
  await withFakeServiceWorker(app, { controller: null }, async (reloads) => {
    const original = app.swapGlobalFunction("downloadAppUpdate", async () => null);
    try {
      assert.equal(await app.applySwUpdate(), false);
    } finally {
      app.swapGlobalFunction("downloadAppUpdate", original);
    }
    assert.deepEqual(reloads, [], "an update that is not fully downloaded must not reload the page");
  });
  assert.match(wasStatus.textContent, /No complete app update is ready/);
});

test("local dev server flags sw.js with self.__DEV__ without touching the production file on disk", () => {
  const { _private } = require("../server.js");
  const original = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");

  const served = _private.injectDevFlag(original);

  // Not merely "somewhere near the top": sw.js reads self.__DEV__ exactly once, into a const at
  // the very top, so the flag has to be set before *that* line. This assertion used to check
  // placement before APP_CACHE_NAME -- which sits below the IS_DEV declaration, so the flag was
  // being set too late to be read. IS_DEV came out false even under the dev server, and every
  // local edit was served from the production cache-first strategy until someone cleared the
  // cache by hand. Evaluate it rather than pattern-match a position, so the next reshuffle of
  // sw.js's top lines cannot quietly break it again.
  const head = served.slice(0, served.indexOf("importScripts("));
  const context = { self: {} };
  vm.createContext(context);
  assert.equal(vm.runInContext(`${head}\nIS_DEV`, context), true, "IS_DEV must evaluate true under the dev server");

  // The file on disk (what Netlify serves in production, untouched) must never itself
  // set the flag — only the local dev server's response does.
  assert.doesNotMatch(original, /self\.__DEV__\s*=\s*true/, "sw.js on disk must not hardcode the dev flag");
  assert.equal(
    vm.runInContext(original.slice(0, original.indexOf("importScripts(")) + "\nIS_DEV", vm.createContext({ self: {} })),
    false,
    "and production must stay cache-first"
  );
});

test("local dev version markers prefix cache names with dev- so the About screen and bug reports read as local", () => {
  // Without this, the About screen's app-version display (js/app.js) and any bug report's
  // appVersion (both read the live CACHE_NAME via caches.keys() in setupPwa, js/nav.js) would
  // show whatever version number happened to be in sw.js on disk, unchanged across every local
  // edit — since CACHE_NAME bumps are CI-only, and now main-only (see the network-first dev
  // test above). The "dev-" prefix is what makes a locally served version visibly local.
  const root = path.join(__dirname, "..");
  const markerFiles = ["app-cache-version.js", "data-cache-version.js"];
  const readVersions = (isDev) => {
    const context = { __DEV__: isDev };
    vm.createContext(context);
    for (const file of markerFiles) vm.runInContext(fs.readFileSync(path.join(root, "js", file), "utf8"), context);
    return {
      app: vm.runInContext("APP_CACHE_VERSION", context),
      data: vm.runInContext("DATA_CACHE_VERSION", context)
    };
  };
  const production = readVersions(false);
  const local = readVersions(true);
  assert.equal(local.app, `dev-${production.app}`);
  assert.equal(local.data, `dev-${production.data}`);
});

test("compass calibration trusts a heading once several readings agree within tolerance", () => {
  resetData(app);
  const base = Date.now();

  app.registerCompassCalibrationSample(90, base);
  assert.equal(app.state.compassHeading, null, "must not trust a single raw reading");

  app.registerCompassCalibrationSample(91, base + 100);
  app.registerCompassCalibrationSample(89, base + 200);
  assert.equal(app.state.compassHeading, null, "must wait for enough samples before trusting");

  app.registerCompassCalibrationSample(90, base + 300);

  assert.equal(app.state.compassHeading, 90, "agreeing readings should be trusted as the heading");
  assert.equal(app.state.compassHeadingTarget, 90);
  assert.equal(app.state.compassCalibrationSamples.length, 0, "sample buffer should be cleared once trusted");
  assert.equal(app.state.compassCalibrationPromptVisible, false);
});

test("compassCalibrationSpreadDegrees measures circular spread correctly across the 0/360 wraparound", () => {
  resetData(app);
  const base = Date.now();
  app.registerCompassCalibrationSample(350, base);
  app.registerCompassCalibrationSample(10, base + 50);
  // 350 -> 10 is a 20 degree turn through north, not a 340 degree spread.
  assert.ok(
    Math.abs(app.compassCalibrationSpreadDegrees() - 20) < 1e-6,
    `wraparound spread should read as ~20 degrees, got ${app.compassCalibrationSpreadDegrees()}`
  );
});

test("compass calibration keeps heading unset and shows the move-your-phone prompt when readings disagree past the grace delay", () => {
  resetData(app);
  const base = Date.now();
  const headings = [10, 170, 340, 60, 200, 20, 150, 300, 40, 190, 30, 160, 320, 70, 210, 10, 180];

  headings.forEach((heading, i) => {
    app.registerCompassCalibrationSample(heading, base + i * 100);
  });

  assert.equal(app.state.compassHeading, null, "wildly disagreeing readings must never be trusted as the heading");
  assert.equal(app.state.compassCalibrationPromptVisible, true, "prompt should appear once unstable past the grace delay");
  assert.equal(app.els.compassCalibrationBanner.hidden, false, "banner element should be shown");
});

test("compass calibration force-completes after the safety-valve wait so heading-up is never blocked indefinitely", () => {
  resetData(app);
  const base = Date.now();
  const headings = [10, 170, 340, 60, 200, 20, 150, 300, 40, 190, 30, 160, 320, 70, 210, 10, 180, 5, 355];

  headings.forEach((heading, i) => {
    // Spread events 350ms apart so the last one lands well past the 6000ms safety valve.
    app.registerCompassCalibrationSample(heading, base + i * 350);
  });

  assert.ok(Number.isFinite(app.state.compassHeading), "calibration should force-complete rather than block forever");
  assert.equal(app.state.compassHeading, headings[headings.length - 1]);
  assert.equal(app.state.compassCalibrationPromptVisible, false, "prompt should be hidden once calibration completes");
});

test("dismissing the calibration prompt hides it and suppresses it for the rest of the current cycle", () => {
  resetData(app);
  const base = Date.now();
  const headings = [10, 170, 340, 60, 200, 20, 150, 300, 40, 190, 30, 160, 320, 70, 210, 10];

  headings.forEach((heading, i) => {
    app.registerCompassCalibrationSample(heading, base + i * 100);
  });
  assert.equal(app.state.compassCalibrationPromptVisible, true, "precondition: prompt should be showing");

  app.dismissCompassCalibrationPrompt();

  assert.equal(app.state.compassCalibrationPromptVisible, false);
  assert.equal(app.state.compassCalibrationPromptDismissed, true);
  // hideCompassCalibrationPrompt uses the shared hideWithFade helper, which fades out
  // over a real transition/timeout rather than hiding synchronously (see nav.js) -- the
  // banner enters "fading-out" immediately, state.compassCalibrationPromptVisible is the
  // synchronous signal that it's dismissed.
  assert.equal(app.els.compassCalibrationBanner.classList.contains("fading-out"), true);

  // Further disagreeing samples in the same cycle must not re-show a dismissed prompt.
  app.registerCompassCalibrationSample(45, base + 1400);
  assert.equal(app.state.compassCalibrationPromptVisible, false, "dismissed prompt must not reappear in the same cycle");
});

test("resetCompassCalibration clears a dismissed prompt so a new calibration cycle can show it again", () => {
  resetData(app);
  app.state.compassCalibrationPromptDismissed = true;
  app.state.compassCalibrationSamples = [{ heading: 10, time: 0 }];
  app.state.compassCalibrationStartedAt = 0;

  app.resetCompassCalibration();

  assert.equal(app.state.compassCalibrationPromptDismissed, false);
  assert.equal(app.state.compassCalibrationSamples.length, 0);
  assert.equal(app.state.compassCalibrationStartedAt, null);

  const base = Date.now();
  const headings = [10, 170, 340, 60, 200, 20, 150, 300, 40, 190, 30, 160, 320, 70, 210, 10];
  headings.forEach((heading, i) => {
    app.registerCompassCalibrationSample(heading, base + i * 100);
  });
  assert.equal(app.state.compassCalibrationPromptVisible, true, "prompt should be able to show again after a reset");
});

test("onDeviceOrientation routes through the calibration gate until a heading is trusted, then tracks live readings directly", () => {
  resetData(app);
  const now = Date.now();

  app.onDeviceOrientation({ alpha: 270, beta: 30 }); // extractCompassHeading: 360 - 270 = 90
  assert.equal(app.state.compassHeading, null, "a single raw reading must go through calibration, not straight to compassHeading");
  assert.equal(app.state.compassCalibrationSamples.length, 1);

  app.onDeviceOrientation({ alpha: 269, beta: 30 });
  app.onDeviceOrientation({ alpha: 271, beta: 30 });
  app.onDeviceOrientation({ alpha: 270, beta: 30 });

  assert.ok(Number.isFinite(app.state.compassHeading), "agreeing readings should establish a trusted heading");

  // Once trusted, further readings should update the live target directly (no more buffering).
  app.onDeviceOrientation({ alpha: 260, beta: 30 }); // heading 100
  assert.equal(app.state.compassHeadingTarget, 100);
  assert.equal(app.state.compassCalibrationSamples.length, 0, "calibration buffer should stay empty once a heading is trusted");
});

function trustCompassAt(heading, beta = 30) {
  resetData(app);
  app.state.compassHeading = heading;
  app.state.compassHeadingTarget = heading;
  app.state.compassHeadingSource = 2;
  app.state.tiltBetaTarget = beta;
  app.state.tiltBetaSmoothed = beta;
  app.state.compassTargetMovedAt = app.performance.now();
}

test("a trusted compass target ignores heading wobble inside the deadband and follows a real turn", () => {
  trustCompassAt(100);
  app.onDeviceOrientation({ webkitCompassHeading: 101, beta: 30 });
  assert.equal(app.state.compassHeadingTarget, 100, "1 degree of wobble must not move the target");
  app.onDeviceOrientation({ webkitCompassHeading: 99, beta: 30 });
  assert.equal(app.state.compassHeadingTarget, 100, "wobble in the other direction is ignored too");
  app.onDeviceOrientation({ webkitCompassHeading: 104, beta: 30 });
  assert.equal(app.state.compassHeadingTarget, 104, "a turn past the deadband moves the target");
});

test("a reading held inside the deadband is accepted once the target has been quiet, so a still phone settles", () => {
  trustCompassAt(100);
  app.onDeviceOrientation({ webkitCompassHeading: 101, beta: 30 });
  assert.equal(app.state.compassHeadingTarget, 100, "immediately after a move, wobble is ignored");
  app.state.compassTargetMovedAt = app.performance.now() - 2000;
  app.onDeviceOrientation({ webkitCompassHeading: 101, beta: 30 });
  assert.equal(app.state.compassHeadingTarget, 101, "after a quiet period the target settles on the held reading");
});

test("the heading deadband widens while the phone is pitched or held upright, but stays small", () => {
  trustCompassAt(100, 0);
  const flat = app.compassTargetDeadbandDeg();
  app.state.tiltBetaTarget = 60; // still easing toward a new pitch
  const pitching = app.compassTargetDeadbandDeg();
  assert.ok(pitching > flat, "pitching should widen the deadband");
  app.state.tiltBetaTarget = 90;
  app.state.tiltBetaSmoothed = 90;
  const upright = app.compassTargetDeadbandDeg();
  assert.ok(upright > flat, "an upright phone should widen the deadband");
  app.state.tiltBetaTarget = 0;
  assert.ok(app.compassTargetDeadbandDeg() <= 6, "the deadband never exceeds 6 degrees, so heading-up never drifts far from the sensor");
});

test("a pitch reading inside the beta deadband leaves the tilt target alone", () => {
  trustCompassAt(100, 30);
  app.onDeviceOrientation({ webkitCompassHeading: 100, beta: 30.5 });
  assert.equal(app.state.tiltBetaTarget, 30);
  app.onDeviceOrientation({ webkitCompassHeading: 100, beta: 32 });
  assert.equal(app.state.tiltBetaTarget, 32);
});

test("a slow continuous turn still reaches the target in deadband-sized steps", () => {
  trustCompassAt(100);
  let last = 100;
  for (let heading = 100; heading <= 130; heading += 0.5) {
    app.onDeviceOrientation({ webkitCompassHeading: heading, beta: 30 });
    last = app.state.compassHeadingTarget;
  }
  assert.ok(130 - last <= app.compassTargetDeadbandDeg(), "the target trails a slow turn by no more than the deadband");
  assert.ok(last > 120, "and it keeps advancing rather than sticking");
});

test("heading smoothing eases small remaining angles gently and large ones quickly", () => {
  const small = app.compassSmoothingRate(1);
  const medium = app.compassSmoothingRate(20);
  const large = app.compassSmoothingRate(90);
  assert.ok(small < medium && medium < large, "the rate rises with the remaining angle");
  assert.equal(app.compassSmoothingRate(-90), large, "direction does not matter");
  assert.equal(app.compassSmoothingRate(40), large, "the full rate applies from 40 degrees");
});

test("alignHeadingUpNavigationViewport defers a zoom-in fit while the compass sensor is actively firing, unless forced", () => {
  // Direct, synchronous test of the exact mechanism behind the "zoom only corrects after
  // it rotates" bug: resolveHeadingUpTargetScale defers non-urgent zoom changes whenever
  // state.compassLastEventAt is recent (headingUpCompassSensorActive()), which is meant to
  // stop zoom fighting an in-progress rotation -- but during compass calibration, rotation
  // never runs (headingUpActive() stays false), so there is nothing for it to fight, and
  // the deferral just leaves the zoom stuck at whatever it was on load until either the
  // sensor goes quiet for 350ms or the caller passes force:true.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.001, 0) });
  seedViewportAtHeadingUpAnchor(app, 10);
  app.state.compassLastEventAt = Date.now(); // sensor "actively firing", as it is throughout calibration

  const deferredChanged = app.alignHeadingUpNavigationViewport();
  assert.equal(deferredChanged, false, "without force, an actively-firing sensor should defer the zoom-in fit");
  assert.equal(app.state.viewport.scale, 10, "zoom should stay at its pre-load scale while deferred");

  const forcedChanged = app.alignHeadingUpNavigationViewport({ force: true });
  assert.equal(forcedChanged, true, "force:true should bypass the deferral");
  assert.ok(app.state.viewport.scale > 10, "forced fit should zoom in to the nearby target immediately");
});

test("the nearby zoom is set by the walking radius, not by a ratio against a driftable reference scale", () => {
  // Fourth and final attempt at the cold-start "zoom level just doesn't seem right" bug. Each
  // earlier attempt fitted the nearby *items* and tried to bound the result somehow -- a ratio
  // against state.fitScale, then against state.baseFitScale, then a full walking-radius circle,
  // then per-point extension out to the radius distance. The zoom is now simply the fit of the
  // walking-radius circle: the user's own configured radius, computed fresh each time, with
  // nothing item-shaped left to drift.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "very-close-tree", commonName: "Very close tree", ...makePoint(app, 0.00001, 0.00001) });
  app.state.viewport = { scale: 50000000, tx: 500, ty: 440 }; // frozen at an absurd scale, as seen in the real bug report
  app.state.compassLastEventAt = null; // sensor quiet -- isolates this from the defer/force path tested elsewhere

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const ceiling = app.maxScaleForHeadingUpPoints(app.walkingRadiusCirclePoints(), focus, focusRect, { projectTilt: true });

  const changed = app.alignHeadingUpNavigationViewport();
  assert.equal(changed, true, "a viewport frozen at an absurd scale must still self-correct");
  // Exact match (with the standard zoom-buffer ratio applied), not just an upper bound --
  // proves the fit tracked the radius circle rather than merely landing under some looser
  // ceiling, and that the very close tree did not drag it in.
  const bufferedCeiling = ceiling * 0.96;
  assert.ok(
    Math.abs(app.state.viewport.scale - bufferedCeiling) < bufferedCeiling * 0.001,
    `expected buffered scale ~${bufferedCeiling}, got ${app.state.viewport.scale}`
  );
});

test("the nearby zoom tracks the user's walking distance setting", () => {
  // A larger configured walking radius covers more ground, so it must zoom out; a smaller one
  // zooms in -- proving the zoom is actually derived from state.walkingDistanceMinutes each
  // time rather than some other fixed/cached value.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "very-close-tree", commonName: "Very close tree", ...makePoint(app, 0.00001, 0.00001) });
  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();

  function ceilingFor(minutes) {
    app.state.walkingDistanceMinutes = minutes;
    return app.maxScaleForHeadingUpPoints(app.walkingRadiusCirclePoints(), focus, focusRect, { projectTilt: true });
  }

  const shortRadiusCeiling = ceilingFor(5);
  const longRadiusCeiling = ceilingFor(30);

  assert.ok(
    longRadiusCeiling < shortRadiusCeiling,
    "a longer walking radius covers more ground, so its fit scale should be smaller (more zoomed out) than a shorter radius's"
  );

  app.state.viewport = { scale: 50000000, tx: 500, ty: 440 };
  app.state.compassLastEventAt = null;
  app.alignHeadingUpNavigationViewport();
  const bufferedLongCeiling = longRadiusCeiling * 0.96;
  assert.ok(
    Math.abs(app.state.viewport.scale - bufferedLongCeiling) < bufferedLongCeiling * 0.001,
    `with the 30-minute radius active, expected buffered scale ~${bufferedLongCeiling}, got ${app.state.viewport.scale}`
  );
});

test("calibration's zoom fit is applied immediately, never deferred by the actively-firing sensor", () => {
  // Raw orientation events keep the compass looking "active" for the whole calibration window,
  // so the fit must bypass the defer-while-active rule or it only lands once the sensor settles.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = null;
  const frames = [];
  const calls = [];
  const originals = {
    raf: app.swapGlobalFunction("requestAnimationFrame", (fn) => { frames.push(fn); return frames.length; }),
    anchor: app.swapGlobalFunction("navigationAnchorActive", () => true),
    align: app.swapGlobalFunction("alignHeadingUpNavigationViewport", (options) => { calls.push(options); return false; }),
  };
  try {
    app.startCalibrationViewportSync();
    frames.shift()();
    assert.equal(calls.length, 1, "the viewport is re-fitted on the first frame");
    assert.equal(calls[0] && calls[0].force, true);
  } finally {
    app.stopCalibrationViewportSync();
    app.swapGlobalFunction("requestAnimationFrame", originals.raf);
    app.swapGlobalFunction("navigationAnchorActive", originals.anchor);
    app.swapGlobalFunction("alignHeadingUpNavigationViewport", originals.align);
  }
});

test("startCalibrationViewportSync/stopCalibrationViewportSync manage a single scheduled frame", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);

  assert.equal(app.state.calibrationViewportSyncFrame, null, "precondition: no frame scheduled yet");

  app.startCalibrationViewportSync();
  assert.ok(app.state.calibrationViewportSyncFrame != null, "starting should schedule a frame");

  const scheduledFrame = app.state.calibrationViewportSyncFrame;
  app.startCalibrationViewportSync();
  assert.equal(app.state.calibrationViewportSyncFrame, scheduledFrame, "calling start again while already scheduled must not schedule a second frame");

  app.stopCalibrationViewportSync();
  assert.equal(app.state.calibrationViewportSyncFrame, null, "stopping should clear the scheduled frame");

  app.stopCalibrationViewportSync(); // must not throw when nothing is scheduled
});

test("registering a calibration sample starts the viewport sync loop", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  assert.equal(app.state.calibrationViewportSyncFrame, null, "precondition: no frame scheduled yet");

  app.registerCompassCalibrationSample(90, Date.now());

  assert.ok(
    app.state.calibrationViewportSyncFrame != null,
    "a single raw sample (heading not yet trusted) should already have started the zoom-sync loop"
  );

  app.stopCalibrationViewportSync();
});

// --- js/routing.js: routing graph + pathfinding for the selected route line ---

function routingWorldPoint(latitude, longitude) {
  return app.projectLonLat(longitude, latitude);
}

function routingFeature(highway, latLonPoints) {
  return { highway, segments: [latLonPoints.map(([lat, lon]) => routingWorldPoint(lat, lon))] };
}

function routingOptions() {
  return { toLatLon: app.unprojectPoint, distanceMetresFn: app.distanceMetres };
}

test("buildRoutingGraph merges shared way endpoints into one connected graph", () => {
  // Two residential-road ways sharing an endpoint at (51.650, 0.001) -- OSM ways that meet at a
  // junction repeat that node's exact coordinate, which is how the graph reconstructs topology
  // without real OSM node IDs (see js/routing.js's header comment).
  const roadA = routingFeature("residential", [[51.650, 0.000], [51.650, 0.001]]);
  const roadB = routingFeature("residential", [[51.650, 0.001], [51.651, 0.001]]);
  const graph = app.buildRoutingGraph([roadA, roadB], [], app.unprojectPoint, app.distanceMetres);

  assert.equal(graph.nodes.length, 3, "3 distinct points across both ways, the shared junction counted once");
  const from = routingWorldPoint(51.650, 0.000);
  const to = routingWorldPoint(51.651, 0.001);
  const route = app.findRoutePoints(graph, from, to, routingOptions());
  assert.ok(route, "the two ways should be connected via their shared endpoint");
});

test("buildRoutingGraph excludes non-walkable highway types entirely", () => {
  const motorway = routingFeature("motorway", [[51.650, 0.000], [51.650, 0.005]]);
  const graph = app.buildRoutingGraph([motorway], [], app.unprojectPoint, app.distanceMetres);
  assert.equal(graph.nodes.length, 0, "a motorway-only feature set must not add any routing nodes");
});

test("findRoutePoints returns null for two points on disconnected features", () => {
  const roadA = routingFeature("residential", [[51.650, 0.000], [51.650, 0.001]]);
  const roadB = routingFeature("residential", [[51.660, 0.010], [51.660, 0.011]]); // far away, no shared node
  const graph = app.buildRoutingGraph([roadA, roadB], [], app.unprojectPoint, app.distanceMetres);
  const route = app.findRoutePoints(
    graph,
    routingWorldPoint(51.650, 0.000),
    routingWorldPoint(51.660, 0.011),
    routingOptions()
  );
  assert.equal(route, null, "two points nowhere near the same connected component must not produce a route");
});

test("findRoutePoints falls back to null when a point is too far from the network", () => {
  const road = routingFeature("residential", [[51.650, 0.000], [51.650, 0.001]]);
  const graph = app.buildRoutingGraph([road], [], app.unprojectPoint, app.distanceMetres);
  // ~1.1km north of the road -- well past a sensible snap radius for "walk to the path first".
  const farPoint = routingWorldPoint(51.660, 0.0005);
  const route = app.findRoutePoints(
    graph, routingWorldPoint(51.650, 0.0005), farPoint,
    { ...routingOptions(), maxSnapMetres: 250 }
  );
  assert.equal(route, null, "a point ~1.1km from the nearest road must not snap onto it");
});

test("findRoutePoints starts and ends at the exact requested points, not the snapped network nodes", () => {
  const road = routingFeature("residential", [[51.650, 0.0000], [51.650, 0.0010], [51.650, 0.0020]]);
  const graph = app.buildRoutingGraph([road], [], app.unprojectPoint, app.distanceMetres);
  // Slightly off the road line, so snapping actually moves the point.
  const from = routingWorldPoint(51.6501, 0.00005);
  const to = routingWorldPoint(51.6501, 0.00195);
  const route = app.findRoutePoints(graph, from, to, routingOptions());
  assert.ok(route && route.length >= 2);
  assert.equal(route[0].x, from.x);
  assert.equal(route[0].y, from.y);
  assert.equal(route[route.length - 1].x, to.x);
  assert.equal(route[route.length - 1].y, to.y);
});

test("findRoutePoints prefers a longer dedicated path over a shorter primary road", () => {
  // A direct primary road from A to B, and a slightly longer footpath from A to B via C.
  // The footpath's real distance is greater, but ROUTING_TYPE_WEIGHTS penalises "primary"
  // enough (2x) that the footpath's weighted cost should still win.
  const a = [51.6500, 0.0000];
  const b = [51.6500, 0.0020]; // ~138m east of a
  const c = [51.6503, 0.0010]; // a gentle detour north of the midpoint

  const road = routingFeature("primary", [a, b]);
  const path = routingFeature("footway", [a, c]);
  const path2 = routingFeature("footway", [c, b]);
  const graph = app.buildRoutingGraph([road], [path, path2], app.unprojectPoint, app.distanceMetres);

  const from = routingWorldPoint(a[0], a[1]);
  const to = routingWorldPoint(b[0], b[1]);
  const route = app.findRoutePoints(graph, from, to, routingOptions());
  assert.ok(route, "a route should be found");

  const viaC = routingWorldPoint(c[0], c[1]);
  const passesThroughC = route.some((p) => Math.abs(p.x - viaC.x) < 1e-9 && Math.abs(p.y - viaC.y) < 1e-9);
  assert.ok(passesThroughC, "the footpath detour via C should be preferred over the direct primary road");
});

test("findRoutePoints rejects a route that is a pathological detour relative to the straight line", () => {
  // A single long, winding path connects A and B, but only via a route many times longer than
  // the straight-line distance between them (as if the only link were far out of the way).
  const a = [51.6500, 0.0000];
  const detour = [51.6800, 0.0000]; // ~3.3km north
  const b = [51.6500, 0.0002]; // ~14m east of a -- straight-line distance is tiny
  const leg1 = routingFeature("footway", [a, detour]);
  const leg2 = routingFeature("footway", [detour, b]);
  const graph = app.buildRoutingGraph([], [leg1, leg2], app.unprojectPoint, app.distanceMetres);

  const route = app.findRoutePoints(
    graph, routingWorldPoint(a[0], a[1]), routingWorldPoint(b[0], b[1]),
    { ...routingOptions(), maxDetourRatio: 4 }
  );
  assert.equal(route, null, "a route hundreds of times longer than the straight line must be rejected, not drawn");
});

test("findRoutePoints falls back to the plain-shortest route when the type-weighted preferred route is a pathological detour but a direct route exists", () => {
  // Regression coverage for a real-world failure mode found while investigating a "longer
  // routes just show as the crow flies" report (2026-09-03): ROUTING_TYPE_WEIGHTS' footpath
  // preference is a *soft* nudge (as little as 1x vs a primary road's 2x), but across a long,
  // multi-junction walk a chain of individually-reasonable preferences for the quieter option
  // can compound into a route that is, in aggregate, many times longer than a plain direct one
  // -- confirmed against this app's own regional data (Wanstead Lane -> South Woodford Station,
  // a ~2.8km walk, came right up against the pathological-detour threshold). Previously,
  // findRoutePoints rejected the weighted route outright and the caller fell back to a straight
  // line -- a worse result than just taking the slightly-less-scenic-but-real route. See
  // js/routing.js's findRoutePoints doc comment for how the fallback works.
  //
  // Shape: a short primary road A->C->B (weight 2, real distance ~2.7x the straight line -- a
  // reasonable, walkable route on its own) runs alongside a footway A->D->B (weight 1, real
  // distance ~4.9x the straight line -- a pathological detour on its own). The footway's lower
  // weight multiplier makes it *cheaper* overall (204 vs 221) even though it is the worse real
  // route, so the weighted search picks it first and fails the detour-ratio check; the
  // plain-shortest fallback must recognise the road is the better real route and use it instead
  // of giving up.
  const a = [51.6500, 0.00000];
  const b = [51.6500, 0.00060];
  const c = [51.65046, 0.00030]; // primary road detour point
  const d = [51.65090, 0.00030]; // footway detour point, further out

  const road1 = routingFeature("primary", [a, c]);
  const road2 = routingFeature("primary", [c, b]);
  const path1 = routingFeature("footway", [a, d]);
  const path2 = routingFeature("footway", [d, b]);
  const graph = app.buildRoutingGraph([road1, road2], [path1, path2], app.unprojectPoint, app.distanceMetres);

  const from = routingWorldPoint(a[0], a[1]);
  const to = routingWorldPoint(b[0], b[1]);
  const route = app.findRoutePoints(graph, from, to, routingOptions());
  assert.ok(route, "a real, walkable route exists and must be returned rather than falling back to a straight line");

  const viaC = routingWorldPoint(c[0], c[1]);
  const viaD = routingWorldPoint(d[0], d[1]);
  const passesC = route.some((p) => Math.abs(p.x - viaC.x) < 1e-9 && Math.abs(p.y - viaC.y) < 1e-9);
  const passesD = route.some((p) => Math.abs(p.x - viaD.x) < 1e-9 && Math.abs(p.y - viaD.y) < 1e-9);
  assert.ok(passesC, "the plain-shortest fallback should take the direct road via C");
  assert.ok(!passesD, "the pathologically-indirect footway via D must not be used once it fails the detour check");
});

test("findRoutePoints still returns null when neither the weighted nor the plain-shortest route is reasonable", () => {
  // The fallback in the test above must not paper over a genuinely bad pair of points -- when
  // the only link between A and B is a pathological detour (as in the "rejects a pathological
  // detour" test above), retrying with priorityKey "metres" walks that exact same single path
  // and must fail the same check, not conjure up a better route that doesn't exist.
  const a = [51.6500, 0.0000];
  const detour = [51.6800, 0.0000];
  const b = [51.6500, 0.0002];
  const leg1 = routingFeature("footway", [a, detour]);
  const leg2 = routingFeature("footway", [detour, b]);
  const graph = app.buildRoutingGraph([], [leg1, leg2], app.unprojectPoint, app.distanceMetres);

  const route = app.findRoutePoints(
    graph, routingWorldPoint(a[0], a[1]), routingWorldPoint(b[0], b[1]),
    { ...routingOptions(), maxDetourRatio: 4 }
  );
  assert.equal(route, null, "with no better alternative available, the fallback must not manufacture a route");
});

test("dijkstraPath's priorityKey parameter selects between weighted cost and plain real distance", () => {
  // Direct unit coverage for the parameter findRoutePoints' fallback relies on: the default
  // ("cost") reproduces the existing type-weighted search; "metres" ignores ROUTING_TYPE_WEIGHTS
  // entirely and finds the physically shortest route instead, even when that's the *more*
  // expensive (weighted-cost) option.
  const a = [51.6500, 0.00000];
  const b = [51.6500, 0.00060];
  const c = [51.65046, 0.00030];
  const d = [51.65090, 0.00030];
  const road1 = routingFeature("primary", [a, c]);
  const road2 = routingFeature("primary", [c, b]);
  const path1 = routingFeature("footway", [a, d]);
  const path2 = routingFeature("footway", [d, b]);
  const graph = app.buildRoutingGraph([road1, road2], [path1, path2], app.unprojectPoint, app.distanceMetres);

  const fromNode = app.nearestRoutingNode(graph, routingWorldPoint(a[0], a[1]));
  const toNode = app.nearestRoutingNode(graph, routingWorldPoint(b[0], b[1]));

  const weighted = app.dijkstraPath(graph, fromNode.nodeId, toNode.nodeId);
  const shortest = app.dijkstraPath(graph, fromNode.nodeId, toNode.nodeId, "metres");

  assert.ok(weighted.metres > shortest.metres, "the default cost-weighted search should pick the physically longer (but preference-cheaper) footway route");
  assert.ok(shortest.metres < weighted.metres, "priorityKey \"metres\" should pick the physically shorter road route instead");
});

test("findRoutePoints snaps onto the graph's largest connected component, not a nearer but tiny disconnected stub", () => {
  // Regression coverage for the actual cause of a "longer routes just show as the crow flies"
  // report (2026-09-03), continued: the fallback added above didn't help Sedley Rise -> the
  // Loughton/Debden Underground station landmarks specifically, because those points snapped
  // onto a real graph node that turned out to be part of an isolated 2-3 node fragment -- a
  // short, mapped-but-unlinked station-forecourt footway with no connection to the surrounding
  // street grid (a common, ordinary OSM data gap, not a "bad route" the ratio checks were meant
  // to catch). That fragment sat metres from the true target point while a road junction on the
  // real network sat only slightly further away, comfortably inside maxSnapMetres -- so the fix
  // is to snap onto the graph's largest component specifically (see findRoutePoints' own doc
  // comment) rather than whichever node happens to be nearest overall.
  //
  // Shape: a 3-node road A-mid-B (the "mainland") plus a 2-node disconnected footway stub
  // sitting a few metres from B. The target point sits essentially on top of the stub -- the
  // geometrically nearest node in the whole graph -- but the stub is a dead end going nowhere.
  const a = [51.6500, 0.0000];
  const mid = [51.6500, 0.0010];
  const b = [51.6500, 0.0020];
  const road1 = routingFeature("residential", [a, mid]);
  const road2 = routingFeature("residential", [mid, b]);

  const stub1 = [51.65005, 0.00201]; // ~5.6m from b -- closer to the target than b is
  const stub2 = [51.65008, 0.00202];
  const stub = routingFeature("footway", [stub1, stub2]);

  const graph = app.buildRoutingGraph([road1, road2], [stub], app.unprojectPoint, app.distanceMetres);
  assert.deepEqual([...graph.componentSizes].sort((x, y) => y - x), [3, 2], "the road (3 nodes) and the stub (2 nodes) must be separate components");

  const from = routingWorldPoint(a[0], a[1]);
  const to = routingWorldPoint(stub1[0], stub1[1]); // sits essentially on the disconnected stub
  const route = app.findRoutePoints(graph, from, to, routingOptions());
  assert.ok(route, "a real route via the road network exists just a few metres further away and must be used, not discarded as disconnected");

  const viaB = routingWorldPoint(b[0], b[1]);
  const passesB = route.some((p) => Math.abs(p.x - viaB.x) < 1e-9 && Math.abs(p.y - viaB.y) < 1e-9);
  assert.ok(passesB, "the route should reach the target by walking onto the real network via B, not by (impossibly) routing through the disconnected stub");
});

test("nearestRoutingNode's componentId parameter restricts the search to one connected component", () => {
  const a = [51.6500, 0.0000];
  const mid = [51.6500, 0.0010];
  const b = [51.6500, 0.0020];
  const road1 = routingFeature("residential", [a, mid]);
  const road2 = routingFeature("residential", [mid, b]);
  const stub1 = [51.65005, 0.00201];
  const stub2 = [51.65008, 0.00202];
  const stub = routingFeature("footway", [stub1, stub2]);
  const graph = app.buildRoutingGraph([road1, road2], [stub], app.unprojectPoint, app.distanceMetres);

  const query = routingWorldPoint(stub1[0], stub1[1]);
  const unrestricted = app.nearestRoutingNode(graph, query);
  const restricted = app.nearestRoutingNode(graph, query, graph.largestComponentId);

  const stub1Point = routingWorldPoint(stub1[0], stub1[1]);
  const bPoint = routingWorldPoint(b[0], b[1]);
  assert.ok(Math.abs(unrestricted.point.x - stub1Point.x) < 1e-9 && Math.abs(unrestricted.point.y - stub1Point.y) < 1e-9, "without a component filter, the nearest node overall is on the tiny stub");
  assert.ok(Math.abs(restricted.point.x - bPoint.x) < 1e-9 && Math.abs(restricted.point.y - bPoint.y) < 1e-9, "restricted to the largest component, the nearest node is on the real road instead");
});

test("nearestRoutingNode's preferredDirection parameter avoids snapping behind the source, fixing backtrack-on-exit-house routes", () => {
  // Regression test for destination snap backtracking: when exiting a building near a close
  // tree, the tree's GPS point could snap to a road node that is "ahead" relative to the
  // direction from user to tree, forcing the router to walk past the snap and come back.
  // Fix: prefer snapping to nodes that are roughly in the direction of the unsapped destination
  // from the user's location.
  //
  // Shape: a road loop with a tree destination (slightly off the road) on one side. The tree's
  // nearest node overall is on the far side of the loop (geometrically closest), but snapping
  // there forces a detour around the loop. The preferredDirection should nudge the snap toward
  // the node on the same side as the tree relative to the user.
  const userLat = 51.6500, userLon = 0.0000;
  const nearNodeLat = 51.6502, nearNodeLon = 0.0005;  // Same side as tree, closer in direction
  const farNodeLat = 51.6498, farNodeLon = 0.0005;    // Far side of loop, still close geometrically

  const road = routingFeature("residential", [
    [userLat, userLon],
    [nearNodeLat, nearNodeLon],
    [farNodeLat, farNodeLon],
    [userLat, userLon],
  ]);
  const graph = app.buildRoutingGraph([road], [], app.unprojectPoint, app.distanceMetres);

  // Tree is slightly off the road on the same side as nearNode
  const treePoint = routingWorldPoint(nearNodeLat + 0.0001, nearNodeLon);
  const userPoint = routingWorldPoint(userLat, userLon);

  // Without direction preference, snapping to treePoint could pick either node
  const noPreference = app.nearestRoutingNode(graph, treePoint, graph.largestComponentId);

  // With direction preference from user toward tree, should prefer nearNode
  const withPreference = app.nearestRoutingNode(graph, treePoint, graph.largestComponentId, userPoint);

  const nearPoint = routingWorldPoint(nearNodeLat, nearNodeLon);
  const snappedToNear = (node) => Math.abs(node.point.x - nearPoint.x) < 1e-8 && Math.abs(node.point.y - nearPoint.y) < 1e-8;

  assert.ok(snappedToNear(withPreference), "with direction preference, snap should favor the node on the user->tree direction");
});


test("findRoutePoints treats a highway=service+service=alley way like a footpath, not a generic service road", () => {
  // Same shape as the primary-vs-footway test above, but with a much smaller weight gap: a
  // direct residential road (weight 1.15) from A to B, versus an alley cut-through via C that's
  // only ~11% longer in real distance. That 11% comfortably clears the gap between "alley
  // routed like a footpath" (weight 1, this test's expectation) and "alley routed like a plain
  // service road" (weight 1.15, same as the residential -- which would make the router just
  // take the shorter direct road instead). See js/normalize.js's toRoadFeature (roadType:
  // "alley" vs "service") and js/renderer.js's dedicated thin/faint alley styling -- the router
  // should recognise the same distinction.
  const a = [51.6500, 0.0000];
  const b = [51.6500, 0.0020]; // ~138m east of a
  const c = [51.6503, 0.0010]; // a gentle detour north of the midpoint, ~11% longer via C

  const road = routingFeature("residential", [a, b]);
  const alleyLeg1 = { highway: "service", service: "alley", segments: [[routingWorldPoint(a[0], a[1]), routingWorldPoint(c[0], c[1])]] };
  const alleyLeg2 = { highway: "service", service: "alley", segments: [[routingWorldPoint(c[0], c[1]), routingWorldPoint(b[0], b[1])]] };
  const graph = app.buildRoutingGraph([road, alleyLeg1, alleyLeg2], [], app.unprojectPoint, app.distanceMetres);

  const from = routingWorldPoint(a[0], a[1]);
  const to = routingWorldPoint(b[0], b[1]);
  const route = app.findRoutePoints(graph, from, to, routingOptions());
  assert.ok(route, "a route should be found");

  const viaC = routingWorldPoint(c[0], c[1]);
  const passesThroughC = route.some((p) => Math.abs(p.x - viaC.x) < 1e-9 && Math.abs(p.y - viaC.y) < 1e-9);
  assert.ok(passesThroughC, "the alley cut-through should be preferred over the slightly shorter direct residential road");
});

test("findRoutePoints still penalises a plain highway=service way (no alley tag) at the generic service rate", () => {
  // Identical geometry to the alley test above, but the cut-through is a plain service road
  // (e.g. a car park aisle or loading bay) rather than one tagged service=alley. It should get
  // no special discount, so with an ~11% longer detour it loses to the direct residential road
  // -- guarding against a fix that accidentally discounts every highway=service way, not just
  // alleys.
  const a = [51.6500, 0.0000];
  const b = [51.6500, 0.0020];
  const c = [51.6503, 0.0010];

  const road = routingFeature("residential", [a, b]);
  const serviceLeg1 = { highway: "service", segments: [[routingWorldPoint(a[0], a[1]), routingWorldPoint(c[0], c[1])]] };
  const serviceLeg2 = { highway: "service", segments: [[routingWorldPoint(c[0], c[1]), routingWorldPoint(b[0], b[1])]] };
  const graph = app.buildRoutingGraph([road, serviceLeg1, serviceLeg2], [], app.unprojectPoint, app.distanceMetres);

  const from = routingWorldPoint(a[0], a[1]);
  const to = routingWorldPoint(b[0], b[1]);
  const route = app.findRoutePoints(graph, from, to, routingOptions());
  assert.ok(route, "a route should be found");

  const viaC = routingWorldPoint(c[0], c[1]);
  const passesThroughC = route.some((p) => Math.abs(p.x - viaC.x) < 1e-9 && Math.abs(p.y - viaC.y) < 1e-9);
  assert.ok(!passesThroughC, "a plain service road detour must not beat the shorter direct residential road");
});

test("data/local-paths.geojson keeps unnamed footpaths, not just named ones", () => {
  // Regression coverage for a real incident: a one-off cleanup script (scripts/
  // remove_unnamed_trails.py, since disabled) deleted every path feature without a `name` tag
  // from this exact file on 2026-05-20. That silently gutted js/routing.js's walking-route graph,
  // because most genuine footpaths -- especially official Public Rights of Way, which OSM tags
  // with designation=public_footpath + prow_ref rather than a name -- have no name at all. The
  // router was left sending walkers the long way round via roads instead of through real,
  // mapped alleys/footpaths. See /routing-pedestrian-bias.md in project memory for the full story.
  const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "local-paths.geojson"), "utf8"));
  const total = geojson.features.length;
  const unnamed = geojson.features.filter((f) => !f.properties || !f.properties.name).length;

  assert.ok(total > 1000, `expected well over 1000 path features, found ${total} -- did a filter get reapplied?`);
  // Real-world footpath data is overwhelmingly unnamed; require a healthy majority so a
  // name-only filter (or anything similarly destructive) trips this test immediately.
  assert.ok(unnamed / total > 0.5, `expected most path features to be unnamed (OSM's normal PROW footpaths have no name), found only ${unnamed}/${total}`);
});

test("the local-paths Overpass query covers the same core bounding box as local-roads/local-landmarks/local-environment", () => {
  // Regression coverage for a real bug: local-paths.overpassql once queried a bounding box
  // whose southern edge (51.595) was ~5.5km north of every other layer's (51.545), so the
  // southern strip of the map had roads but no footpaths/bridleways/tracks at all -- forcing
  // the router in js/routing.js to route through that area via roads exclusively, however
  // strongly ROUTING_TYPE_WEIGHTS favours footpaths once they actually exist in the graph.
  // Every clause in each file should use this shared bbox -- local-environment.overpassql's
  // one exception (a deliberately tighter box just for its high-volume "building" clause) is
  // named explicitly below rather than silently ignored, so a *new* stray bbox still fails
  // this test.
  const dataDir = path.join(__dirname, "..", "data");
  const canonicalBbox = "(51.545,-0.035,51.745,0.145)";
  const bboxPattern = /\(-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+\)/g;
  const knownExceptions = new Set(["(51.610,0.000,51.710,0.090)"]); // local-environment's building-only box

  const files = ["local-roads.overpassql", "local-paths.overpassql", "local-landmarks.overpassql", "local-environment.overpassql"];
  for (const filename of files) {
    const text = fs.readFileSync(path.join(dataDir, filename), "utf8");
    const bboxes = Array.from(new Set(text.match(bboxPattern) || []));
    assert.ok(bboxes.includes(canonicalBbox), `${filename} must include the shared bbox ${canonicalBbox}, found ${bboxes.join(", ")}`);
    for (const bbox of bboxes) {
      if (bbox === canonicalBbox) continue;
      assert.ok(knownExceptions.has(bbox), `${filename} has an unexpected bbox ${bbox} -- if this is intentional, add it to knownExceptions with a comment explaining why`);
    }
  }
});

test("nearestRoutingNode finds the closest graph node to a query point", () => {
  const road = routingFeature("residential", [[51.6500, 0.0000], [51.6510, 0.0000], [51.6520, 0.0000]]);
  const graph = app.buildRoutingGraph([road], [], app.unprojectPoint, app.distanceMetres);
  const near = app.nearestRoutingNode(graph, routingWorldPoint(51.6511, 0.0000));
  const expected = routingWorldPoint(51.6510, 0.0000);
  assert.ok(Math.abs(near.point.x - expected.x) < 1e-9 && Math.abs(near.point.y - expected.y) < 1e-9);
});

test("createRoutingGraphBuilder produces an identical graph whether fed all features at once or in batches", () => {
  const features = [
    routingFeature("residential", [[51.650, 0.000], [51.650, 0.001]]),
    routingFeature("residential", [[51.650, 0.001], [51.651, 0.001]]),
    routingFeature("footway", [[51.651, 0.001], [51.652, 0.002]]),
  ];

  const wholeBuilder = app.createRoutingGraphBuilder(app.unprojectPoint, app.distanceMetres);
  wholeBuilder.addFeatures(features);
  const wholeGraph = wholeBuilder.build();

  const batchedBuilder = app.createRoutingGraphBuilder(app.unprojectPoint, app.distanceMetres);
  batchedBuilder.addFeatures(features.slice(0, 1));
  batchedBuilder.addFeatures(features.slice(1));
  const batchedGraph = batchedBuilder.build();

  assert.equal(batchedGraph.nodes.length, wholeGraph.nodes.length);
  const wholeEdgeCount = wholeGraph.adjacency.reduce((sum, edges) => sum + edges.length, 0);
  const batchedEdgeCount = batchedGraph.adjacency.reduce((sum, edges) => sum + edges.length, 0);
  assert.equal(batchedEdgeCount, wholeEdgeCount);
});

test("buildRoutingGraphAsync builds the same graph as the synchronous builder, batch by batch", async () => {
  const roads = [routingFeature("residential", [[51.650, 0.000], [51.650, 0.001], [51.651, 0.001]])];
  const paths = [routingFeature("footway", [[51.651, 0.001], [51.652, 0.002]])];
  const sync = app.buildRoutingGraph(roads, paths, app.unprojectPoint, app.distanceMetres);
  const batched = await app.buildRoutingGraphAsync(roads, paths, app.unprojectPoint, app.distanceMetres, 1);
  assert.equal(batched.nodes.length, sync.nodes.length, "same junctions however the features are batched");
  assert.ok(batched.nodes.length > 2, "the graph is not empty");
});

test("ensureRoutingGraph lazily builds a routing graph from state.roads/state.paths, drawSelectedRoute switches from the straight-line fallback to the routed polyline once it's ready, and the result is memoized until the user moves meaningfully", async () => {
  // Both checks share a single real-timer wait (rather than being two separate async tests)
  // deliberately: this file runs every test against one shared `app` instance with no per-test
  // isolation, and state.userLocation/trees/selected/routingGraph* are never reset by resetData().
  // Two independent async tests here would leave both of their real setTimeout-based windows open
  // at once, racing each other's cleanup against each other's still-in-flight assertions -- and,
  // separately, would leave enough of a real-timer window open to race against unrelated earlier
  // async tests too (e.g. "returning to nearby waits for inspector expansion..." schedules its own
  // fallback setTimeout in goToInitialView/js/nav.js, which reads whatever state.userLocation is
  // when it fires and broke if this test's synthetic location was still in place). One test, one
  // short wait, cleaned up immediately after -- keeps this test's real-timer footprint minimal.
  resetData(app);
  app.state.routingGraphReady = false;
  app.state.routingGraphBuilding = false;
  app.state.routingGraph = null;
  app.state.selectedRouteCache = null;
  // Restored at the end -- state.userLocation is never touched by resetData() (unlike the fields
  // above), so it's the one thing this test must put back exactly as found, not just to a neutral
  // default, for the reason explained above.
  const previousUserLocation = app.state.userLocation;

  // A short footpath that bends through a middle vertex, so a routed line is visibly different
  // (more than 2 points) from the straight 2-point fallback.
  app.state.roads = [];
  app.state.paths = [{
    highway: "footway",
    segments: [[
      app.projectLonLat(0.0000, 51.6500),
      app.projectLonLat(0.0005, 51.6503),
      app.projectLonLat(0.0010, 51.6500),
    ]],
  }];

  app.state.userLocation = makePoint(app, 51.6500, 0.0000);
  const target = { commonName: "Test tree", ...makePoint(app, 51.6500, 0.0010) };
  app.state.trees.push(target);
  app.state.selected = { type: "tree", item: target };

  // Before the graph is ready, selectedRoutePoints still answers with the straight line so the
  // distance chip and the camera fit have something to work from...
  const straightLine = app.selectedRoutePoints(target);
  assert.equal(straightLine.length, 2, "falls back to the plain straight line while the graph is still building");
  assert.ok(app.state.routingGraphBuilding, "calling selectedRoutePoints must have kicked off the lazy background build");
  assert.equal(app.selectedRouteIsFallback(target), true, "and reports that line as a fallback, not a route");
  assert.doesNotThrow(() => app.drawSelectedRoute(app.els.canvas.getContext("2d")), "drawing must not throw while the graph is still building");

  // ...but nothing is drawn yet. A crow-flies line that flicks over to a winding route a
  // second later reads as the app changing its mind, and points the walker the wrong way in
  // the meantime; the straight line is a fallback for "we looked and there is no route", not
  // a placeholder for "we have not looked yet".
  const buildingCtx = recordingCtx();
  app.drawSelectedRoute(buildingCtx);
  assert.equal(buildingCtx.moves.length, 0, "no line is drawn while the routing graph is still building");

  // The displayed distance/walk-time chip must match the straight-line fallback while routing
  // isn't ready yet -- it must never show a broken/blank figure, and must never race ahead of
  // what selectedRoutePoints itself is currently drawing.
  const straightLineMetres = app.distanceFromUser(target);
  assert.ok(Number.isFinite(straightLineMetres));
  const preGraphRouteMetres = app.selectedRouteMetres(target);
  assert.ok(
    Math.abs(preGraphRouteMetres - straightLineMetres) < 0.01,
    "selectedRouteMetres must match the plain straight-line distance while the graph is still building"
  );
  assert.doesNotThrow(() => app.updateSelectedDetailFields(), "updateSelectedDetailFields must not throw while the graph is still building");

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(app.state.routingGraphReady, true, "this tiny synthetic graph should finish building almost immediately");
  const routed = app.selectedRoutePoints(target);
  assert.ok(routed.length > 2, "once the graph is ready, the route should follow the path via its middle vertex instead of going straight");
  assert.doesNotThrow(() => app.drawSelectedRoute(app.els.canvas.getContext("2d")), "drawing the routed polyline must not throw");

  // The chip must now correct itself to the real (longer) routed distance/time, not stay stuck
  // showing the straight-line crow-flies figure -- this is the behaviour the user asked to fix.
  const routedMetres = app.selectedRouteMetres(target);
  assert.ok(
    routedMetres > straightLineMetres,
    "the routed distance along the bending footpath must be longer than the straight-line distance"
  );
  assert.doesNotThrow(() => app.updateSelectedDetailFields(), "updateSelectedDetailFields must not throw once a routed path is available");

  // The graph is ready and a route was found, so the line is a real route, not the fallback.
  assert.equal(app.selectedRouteIsFallback(target), false, "a found route is not reported as a fallback");
  const routedCtx = recordingCtx();
  app.drawSelectedRoute(routedCtx);
  assert.equal(routedCtx.moves.length, 1, "the routed line is drawn once the graph is ready");

  // Memoization: everything from here on is synchronous (the graph is already built), so it
  // can't race any other test's pending timer. Only the *tail* of the route is memoized --
  // the head is re-read from the live user position on every call, so the line always starts
  // where the walker is standing rather than where the journey began.
  const first = app.selectedRoutePoints(target);
  const cachedTail = app.state.selectedRouteCache.tail;
  assert.deepEqual(first.slice(1), routed.slice(1), "an unmoved user must keep reusing the cached route tail");
  assert.equal(first[0], app.state.userLocation.point, "the route starts at the live user position");

  app.state.userLocation = makePoint(app, 51.65001, 0.0000); // ~1m north -- under the 20m threshold
  const second = app.selectedRoutePoints(target);
  assert.equal(app.state.selectedRouteCache.tail, cachedTail, "a couple of metres of GPS movement must reuse the cached route, not recompute it");
  assert.equal(second[0], app.state.userLocation.point, "and the line still starts from where the walker now is");

  app.state.userLocation = makePoint(app, 51.6503, 0.0000); // ~33m north -- past the threshold
  app.selectedRoutePoints(target);
  assert.notEqual(app.state.selectedRouteCache.tail, cachedTail, "moving past the recompute threshold must produce a freshly computed route");

  resetData(app);
  app.state.userLocation = previousUserLocation;
});

test("selectedRouteMetres returns null without a user location or a targetless point, rather than throwing", () => {
  resetData(app);
  const previousUserLocation = app.state.userLocation;

  app.state.userLocation = null;
  const target = { commonName: "Test tree", ...makePoint(app, 51.65, 0.001) };
  assert.equal(app.selectedRouteMetres(target), null, "no user location yet -- nothing to route from");

  app.state.userLocation = makePoint(app, 51.65, 0.0);
  assert.equal(app.selectedRouteMetres(null), null, "no target -- nothing to route to");
  assert.equal(app.selectedRouteMetres({ commonName: "No point" }), null, "target without a projected point can't be routed to");

  app.state.userLocation = previousUserLocation;
});

test("updateSelectedDetailFields is a no-op without a selection or a user location, and doesn't throw", () => {
  resetData(app);
  const previousUserLocation = app.state.userLocation;

  app.state.userLocation = null;
  app.state.selected = null;
  assert.doesNotThrow(() => app.updateSelectedDetailFields());

  app.state.userLocation = makePoint(app, 51.65, 0.0);
  app.state.selected = null;
  assert.doesNotThrow(() => app.updateSelectedDetailFields());

  app.state.userLocation = previousUserLocation;
  resetData(app);
});

test("headingUpAnchorFraction ramps from the flat anchor to the max-tilt anchor, separately for nearby vs. selected navigation", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0); // headingUpActive() requires a user location...
  app.state.compassHeading = 0;                  // ...and a finite compass heading, or tiltActive() (and thus the ramp) never engages

  app.state.tiltBetaSmoothed = 0; // tilt inactive -> tiltAnchorFraction() ramp t = 0
  assert.equal(app.headingUpAnchorFraction(false), 0.5, "flat nearby anchor (HEADING_UP_ANCHOR_NEARBY) -- dead centre, so the radius circle it frames is centred");
  assert.equal(app.headingUpAnchorFraction(true), 0.62, "flat selected anchor (HEADING_UP_ANCHOR_SELECTED)");

  app.state.tiltBetaSmoothed = 85; // TILT_BETA_MAX -> ramp t = 1
  assert.ok(Math.abs(app.headingUpAnchorFraction(false) - 0.94) < 1e-9, "max-tilt nearby anchor (HEADING_UP_ANCHOR_NEARBY_TILT)");
  assert.ok(Math.abs(app.headingUpAnchorFraction(true) - 0.88) < 1e-9, "max-tilt selected anchor (HEADING_UP_ANCHOR_SELECTED_TILT)");

  app.state.tiltBetaSmoothed = 48.5; // midpoint of 12-85 -> ramp t = 0.5, same fixture beta other tilt tests use
  assert.ok(Math.abs(app.headingUpAnchorFraction(false) - 0.72) < 1e-9, "midway nearby anchor: 0.5 + (0.94-0.5)*0.5");
  assert.ok(Math.abs(app.headingUpAnchorFraction(true) - 0.75) < 1e-9, "midway selected anchor: 0.62 + (0.88-0.62)*0.5");
});

test("navigationFocusPoint and nearbyHeadingUpFocusY still place the pivot via headingUpAnchorFraction after the shared-helper refactor", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90; // finite heading, no selection -> nearbyHeadingUpActive()
  app.state.tiltBetaSmoothed = 48.5;
  app.els.inspector.hidden = true; // avoid unrelated inspector-overlap geometry in this check
  app.els.inspectorActions.hidden = true; // nav bar is its own bar now; hide it too for a clean canvas

  const anchor = app.headingUpAnchorFraction(false);
  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.navigationFocusPoint();
  assert.equal(focus.x, focusRect.x + focusRect.width / 2);
  assert.ok(Math.abs(focus.y - (focusRect.y + focusRect.height * anchor)) < 1e-9);
  assert.ok(Math.abs(app.nearbyHeadingUpFocusY() - anchor) < 1e-9);

  // Selected-navigation uses the "selected" anchor instead.
  app.state.selected = { type: "tree", item: { id: "t1", ...makePoint(app, 0.001, 0) } };
  const selectedAnchor = app.headingUpAnchorFraction(true);
  const selectedFocus = app.navigationFocusPoint();
  assert.ok(Math.abs(selectedFocus.y - (focusRect.y + focusRect.height * selectedAnchor)) < 1e-9);
  assert.notEqual(selectedAnchor, anchor, "selected and nearby anchors should differ at this tilt level");
});

test("tiltAvailableAheadCssPx is the visible map height above the pivot, converted to CSS px via the device pixel ratio", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.els.inspector.hidden = true;
  app.els.inspectorActions.hidden = true; // nav bar is its own bar now; hide it too for a clean canvas
  app.state.tiltBetaSmoothed = 85; // max tilt -> nearby anchor is exactly 0.94

  app.state.canvasVisibleHeight = 800;
  assert.ok(Math.abs(app.tiltAvailableAheadCssPx() - 752) < 1e-9, "800 * 0.94 / dpr(1) = 752");

  // pixelRatio() prefers els.canvas.dataset.dpr (set by resizeCanvas in real use) over
  // window.devicePixelRatio, so set that directly for a deterministic check here.
  const originalDatasetDpr = app.els.canvas.dataset.dpr;
  try {
    app.els.canvas.dataset.dpr = "2";
    assert.ok(Math.abs(app.tiltAvailableAheadCssPx() - 376) < 1e-9, "800 * 0.94 / dpr(2) = 376 -- bitmap px converted down to CSS px");
  } finally {
    app.els.canvas.dataset.dpr = originalDatasetDpr;
  }
});

test("tiltPerspectivePx keeps the ground/sky split at a constant fraction of the visible map regardless of screen height, at any given tilt angle", () => {
  // Regression test for the fixed-900px camera distance bug: perspective's ground-plane
  // horizon sits at (perspective / tan(rotateX)) CSS px above the pivot -- a fixed distance
  // when the camera distance is a flat constant, so a taller screen left proportionally
  // *more* empty "sky" above the horizon than a shorter one, instead of a device-independent
  // split. tiltPerspectivePx() must instead keep the ground fraction -- (perspective *
  // cot(rotateX)) / availableAhead -- the same on any screen height, for a fixed tilt angle.
  // (The fraction still varies *across* tilt angles by design -- more tilt = more sky, same
  // as before this fix -- it must just no longer vary by device height at a given angle.)
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.els.inspector.hidden = true;
  app.els.inspectorActions.hidden = true; // nav bar is its own bar now; hide it too for a clean canvas
  app.state.tiltBetaSmoothed = 60; // an ordinary mid-range tilt, not max

  function groundFraction() {
    const tiltRad = app.tiltRotateXDeg() * Math.PI / 180;
    const horizonOffsetCssPx = app.tiltPerspectivePx() / Math.tan(tiltRad);
    return horizonOffsetCssPx / app.tiltAvailableAheadCssPx();
  }

  app.state.canvasVisibleHeight = 800;
  const shortScreenFraction = groundFraction();
  const shortScreenPerspective = app.tiltPerspectivePx();

  // 1200, not 800*2 -- doubling to 1600 at this tilt angle/anchor pushes the *ideal*
  // (unclamped) camera distance for the 1600 case past TILT_PERSPECTIVE_MAX_PX (2600),
  // which would legitimately break the proportionality this test checks (that's the
  // clamp doing its job for pathologically tall viewports, not a bug -- see the
  // MIN/MAX clamp test below). 1200 stays comfortably under the ceiling here.
  app.state.canvasVisibleHeight = 1200;
  const tallScreenFraction = groundFraction();
  const tallScreenPerspective = app.tiltPerspectivePx();

  assert.ok(Math.abs(shortScreenFraction - tallScreenFraction) < 1e-9,
    `ground fraction should be device-height independent, got ${shortScreenFraction} vs ${tallScreenFraction}`);
  assert.ok(Math.abs(tallScreenPerspective - shortScreenPerspective * 1.5) < 1e-6,
    "camera distance should scale linearly with the available screen height, not leave it fixed");
});

test("tiltPerspectivePx reaches exactly TILT_HORIZON_GROUND_RATIO ground/sky split at max tilt (TILT_ROTATEX_MAX)", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.els.inspector.hidden = true;
  app.els.inspectorActions.hidden = true; // nav bar is its own bar now; hide it too for a clean canvas
  app.state.tiltBetaSmoothed = 85; // TILT_BETA_MAX -> tiltRotateXDeg() === TILT_ROTATEX_MAX exactly
  app.state.canvasVisibleHeight = 800;

  const tiltRad = app.tiltRotateXDeg() * Math.PI / 180;
  const horizonOffsetCssPx = app.tiltPerspectivePx() / Math.tan(tiltRad);
  const groundFraction = horizonOffsetCssPx / app.tiltAvailableAheadCssPx();
  assert.ok(Math.abs(groundFraction - 0.62) < 1e-9, `expected TILT_HORIZON_GROUND_RATIO (0.62) at max tilt, got ${groundFraction}`);
});

test("tiltPerspectivePx does not collapse the safe distance-behind-the-user margin at ordinary (non-max) tilt angles", () => {
  // Regression test for a real bug shipped in the first version of this dynamic-perspective
  // fix (2026-09-03): calibrating the camera distance against tan(the *live* tiltRotateXDeg())
  // meant tan() shrinks sharply at low/mid tilt angles, collapsing the camera distance right
  // along with it -- at an ordinary mid-range tilt this pulled the perspective-divide
  // singularity (scale = P/(P-dz), where dz grows with on-screen distance behind the pivot)
  // in to as little as ~450 CSS px behind the user, versus ~900-1500px under the old fixed
  // 900px constant. Pins, the radar, and road/path lines that far behind the user (an easily
  // reached distance on a moderately zoomed map) got a blown-up or negative `scale`, which
  // read as them intermittently vanishing or flying off to nonsense coordinates. Calibrating
  // against the fixed TILT_ROTATEX_MAX reference angle instead must keep this margin at least
  // as generous as the old fixed-900px system had, at every active tilt angle -- not just at
  // max tilt where the ground-fraction target is actually calibrated.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.els.inspector.hidden = true;
  app.els.inspectorActions.hidden = true; // nav bar is its own bar now; hide it too for a clean canvas
  app.state.canvasVisibleHeight = 800;

  for (const beta of [13, 20, 30, 48.5, 60, 75, 85]) {
    app.state.tiltBetaSmoothed = beta;
    const tiltDeg = app.tiltRotateXDeg();
    const tiltRad = tiltDeg * Math.PI / 180;
    const P = app.tiltPerspectivePx();
    const oldFixedSingularityDyCss = 900 / Math.sin(tiltRad); // the pre-existing, always-safe baseline
    const newSingularityDyCss = P / Math.sin(tiltRad);
    assert.ok(
      newSingularityDyCss >= oldFixedSingularityDyCss - 1e-6,
      `beta=${beta} (tiltDeg=${tiltDeg.toFixed(1)}): safe margin regressed to ${newSingularityDyCss.toFixed(1)}px, below the old fixed-900px baseline of ${oldFixedSingularityDyCss.toFixed(1)}px`
    );
    // And concretely: a pin 600 CSS px behind the user (an ordinary, easily reached distance
    // on a moderately zoomed map) must always project with a small positive scale, never a
    // blown-up or negative one.
    if (tiltDeg > 0) {
      const dz = 600 * Math.sin(tiltRad);
      const scale = P / (P - dz);
      assert.ok(scale > 0 && scale < 5, `beta=${beta}: a pin 600px behind should project with a sane positive scale, got ${scale}`);
    }
  }
});

test("tiltAvailableAheadCssPx / tiltPerspectivePx do not collapse when the destination is behind the user and the anchor mirrors toward the top of the screen", () => {
  // Regression test for a real bug reported 2026-09-03 (round 4): headingUpAnchorFraction
  // now mirrors the selected-navigation anchor toward the top of the screen when the
  // destination is behind the user (see the "mirrors the selected-navigation anchor" test),
  // but tiltAvailableAheadCssPx() fed that same (now small) mirrored anchor straight into
  // tiltPerspectivePx() -- reintroducing, via bearing this time rather than tilt angle, the
  // exact P-collapse regression documented in "does not collapse the safe distance-behind-
  // the-user margin" above: the camera distance shrank right along with the mirrored anchor,
  // pulling the perspective-divide singularity in close enough that the destination, other
  // pins, and the radar cone -- all now rendered on the far (larger) side of the mirrored
  // pivot -- intermittently disappeared or blew up. tiltAvailableAheadCssPx() must use
  // whichever side of the pivot is actually larger, so the camera distance stays sized for
  // the bigger reach regardless of which side that is.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90; // facing east
  app.state.tiltBetaSmoothed = 85; // TILT_BETA_MAX -- mirrored anchor reaches its full 0.12
  app.els.inspector.hidden = true;
  app.els.inspectorActions.hidden = true; // nav bar is its own bar now; hide it too for a clean canvas
  app.state.canvasVisibleHeight = 800;

  app.state.selected = { type: "tree", item: { id: "ahead", ...makePoint(app, 0, 0.001) } }; // dead ahead
  const aheadAnchor = app.headingUpAnchorFraction(true);
  const aheadAvailable = app.tiltAvailableAheadCssPx();
  const aheadP = app.tiltPerspectivePx();
  assert.ok(Math.abs(aheadAnchor - 0.88) < 1e-9, `dead-ahead anchor should be the plain 0.88, got ${aheadAnchor}`);
  assert.ok(Math.abs(aheadAvailable - 800 * 0.88) < 1e-6, `expected 800*0.88=704, got ${aheadAvailable}`);

  app.state.selected = { type: "tree", item: { id: "behind", ...makePoint(app, 0, -0.001) } }; // dead behind
  const behindAnchor = app.headingUpAnchorFraction(true);
  const behindAvailable = app.tiltAvailableAheadCssPx();
  const behindP = app.tiltPerspectivePx();
  assert.ok(Math.abs(behindAnchor - 0.12) < 1e-9, `dead-behind anchor should mirror to 0.12, got ${behindAnchor}`);

  // The whole point of the fix: despite the mirrored anchor being small (0.12 vs 0.88),
  // the *available reach* -- and therefore the camera distance -- must come out identical
  // to the dead-ahead case, not shrunk to a small fraction of it.
  assert.ok(Math.abs(behindAvailable - aheadAvailable) < 1e-6,
    `available reach should match the ahead case regardless of anchor mirroring, got ahead=${aheadAvailable} behind=${behindAvailable}`);
  assert.ok(Math.abs(behindP - aheadP) < 1e-6,
    `camera distance should match the ahead case regardless of anchor mirroring, got ahead=${aheadP} behind=${behindP}`);

  // And concretely, the same singularity-margin check used above must hold behind a
  // mirrored-anchor destination too: a pin 600 CSS px behind the (now near-top) pivot must
  // still project with a sane, small positive scale.
  const tiltRad = app.tiltRotateXDeg() * Math.PI / 180;
  const dz = 600 * Math.sin(tiltRad);
  const scale = behindP / (behindP - dz);
  assert.ok(scale > 0 && scale < 5, `a pin 600px behind the mirrored pivot should project with a sane positive scale, got ${scale}`);
});

test("tiltAvailableAheadCssPx / tiltPerspectivePx do not dip below the historical ahead-anchor floor when the destination is directly to a side", () => {
  // Regression test for a real bug reported 2026-09-03 (round 5): max(anchor, 1 - anchor)
  // alone (the round-4 fix above) restores the camera distance at the dead-ahead and
  // dead-behind extremes, but still dips as low as 0.5 exactly when the destination is
  // directly to a side (offset ~= +-pi/2), since headingUpAnchorFraction's cos(offset)
  // mirroring passes through the screen's exact 50% centre there -- lower than the
  // historically-safe tiltRampedAnchor() floor (always >= 0.5 by construction, e.g.
  // 0.62-0.88 for selected navigation) this calculation always used before bearing-based
  // mirroring existed. An ordinary, frequent case during real walking navigation (you are
  // very often not pointed exactly at or away from your destination), so this dip is a
  // plausible source of the "still disappears for a second sometimes" follow-up report.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90; // facing east
  app.state.tiltBetaSmoothed = 85; // TILT_BETA_MAX -> tiltRampedAnchor(true) === 0.88 exactly
  app.els.inspector.hidden = true;
  app.els.inspectorActions.hidden = true; // nav bar is its own bar now; hide it too for a clean canvas
  app.state.canvasVisibleHeight = 800;

  // Due north while facing east: directly to a side (offset exactly +-pi/2).
  app.state.selected = { type: "tree", item: { id: "side", ...makePoint(app, 0.001, 0) } };
  const sideAnchor = app.headingUpAnchorFraction(true);
  assert.ok(Math.abs(sideAnchor - 0.5) < 1e-9, `side anchor should be exactly 0.5, got ${sideAnchor}`);

  const rampedAnchor = app.tiltRampedAnchor(true);
  assert.ok(Math.abs(rampedAnchor - 0.88) < 1e-9, `ramped (pre-mirror) anchor should be 0.88 at max tilt, got ${rampedAnchor}`);

  const sideAvailable = app.tiltAvailableAheadCssPx();
  assert.ok(Math.abs(sideAvailable - 800 * 0.88) < 1e-6,
    `available reach for a side-bearing destination must not dip below the ramped-anchor floor (800*0.88=704), got ${sideAvailable}`);

  // And the same singularity-margin check used in the round-2/round-4 tests must still
  // hold for a side-bearing destination at this camera distance.
  const sideP = app.tiltPerspectivePx();
  const tiltRad = app.tiltRotateXDeg() * Math.PI / 180;
  const dz = 600 * Math.sin(tiltRad);
  const scale = sideP / (sideP - dz);
  assert.ok(scale > 0 && scale < 5, `a pin 600px behind a side-mirrored pivot should project with a sane positive scale, got ${scale}`);
});

test("tiltPerspectivePx clamps to a sane range for extreme viewport heights, and falls back to the floor when tilt is inactive", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.els.inspector.hidden = true;
  app.els.inspectorActions.hidden = true; // nav bar is its own bar now; hide it too for a clean canvas

  app.state.tiltBetaSmoothed = 60;
  app.state.canvasVisibleHeight = 4; // absurdly short viewport
  assert.equal(app.tiltPerspectivePx(), 260, "should clamp to TILT_PERSPECTIVE_MIN_PX rather than an unstable near-0 camera distance");

  app.state.canvasVisibleHeight = 400000; // absurdly tall viewport
  assert.equal(app.tiltPerspectivePx(), 2600, "should clamp to TILT_PERSPECTIVE_MAX_PX rather than an implausibly flat camera distance");

  app.state.canvasVisibleHeight = 800;
  app.state.tiltBetaSmoothed = 0; // tilt inactive -> tiltRotateXDeg() is 0
  assert.equal(app.tiltPerspectivePx(), 260, "returns the floor rather than dividing by a zero tilt angle when tilt is inactive");
});

test("worldToScreen, projectCanvasPoint and worldToScreenForOverlayTilted share one projection, so pins never drift off the terrain", () => {
  resetData(app);
  app.state.compassHeading = 0;
  app.state.userLocation = makePoint(app, 0, 0); // world (0,0) -> rawWorldToScreen -> screen (500, 400) given the default viewport
  app.els.inspector.hidden = true;
  app.els.inspectorActions.hidden = true; // nav bar is its own bar now; hide it too for a clean canvas
  app.state.tiltBetaSmoothed = 60;

  const origin = { x: 500, y: 400 };
  const px = 550, py = 300; // 50px right, 100px "ahead" (above) of the user on screen
  const dpr = 1;
  const tiltDeg = app.tiltRotateXDeg();
  const T = tiltDeg * Math.PI / 180;
  const dyCss = (py - origin.y) / dpr;
  const dz = dyCss * Math.sin(T);
  const perspectivePx = app.tiltPerspectivePx();
  const expectedScale = perspectivePx / (perspectivePx - dz);
  const expected = {
    x: origin.x + ((px - origin.x) / dpr) * expectedScale * dpr,
    y: origin.y + (dyCss * Math.cos(T)) * expectedScale * dpr,
  };

  const viaCanvasPoint = app.projectCanvasPoint(px, py);
  assert.ok(Math.abs(viaCanvasPoint.x - expected.x) < 1e-6, `x mismatch: ${viaCanvasPoint.x} vs ${expected.x}`);
  assert.ok(Math.abs(viaCanvasPoint.y - expected.y) < 1e-6, `y mismatch: ${viaCanvasPoint.y} vs ${expected.y}`);
  assert.ok(Math.abs(viaCanvasPoint.scale - expectedScale) < 1e-9);

  // world (0.05, -0.1) -> rawWorldToScreen -> screen (550, 300), the same on-screen point as
  // above -- worldToScreenForOverlayTilted should therefore land on the same projected pixel.
  const viaWorldPoint = app.worldToScreenForOverlayTilted({ x: 0.05, y: -0.1 });
  assert.ok(Math.abs(viaWorldPoint.x - expected.x) < 1e-6, `x mismatch: ${viaWorldPoint.x} vs ${expected.x}`);
  assert.ok(Math.abs(viaWorldPoint.y - expected.y) < 1e-6, `y mismatch: ${viaWorldPoint.y} vs ${expected.y}`);

  // The terrain on the main canvas must land on that same pixel too. It used to be tilted
  // separately, by a CSS perspective()/rotateX() on the finished bitmap, which left three
  // copies of this projection that could drift apart; now all three share one.
  const viaMainCanvas = app.worldToScreen({ x: 0.05, y: -0.1 });
  assert.ok(Math.abs(viaMainCanvas.x - expected.x) < 1e-6, `x mismatch: ${viaMainCanvas.x} vs ${expected.x}`);
  assert.ok(Math.abs(viaMainCanvas.y - expected.y) < 1e-6, `y mismatch: ${viaMainCanvas.y} vs ${expected.y}`);

  // And the canvas must carry no 3D transform of its own any more — a leftover rotateX
  // would tilt the already-projected pixels a second time.
  app.state.renderedNavigationHeading = 0;
  app.els.canvas.style.transform = "";
  app.updateHeadingUpCanvasRotationTransform();
  assert.ok(!/perspective\(|rotateX\(/.test(app.els.canvas.style.transform),
    `canvas transform must not re-apply tilt in CSS (was "${app.els.canvas.style.transform}")`);
});

// --- Metres/world-unit geo conversion ---

test("metresPerWorldUnit/metresToWorldUnits round-trip and shrink with latitude, matching walkingRadiusWorldUnits' own 111320*cos(lat) convention", () => {
  resetData(app);
  assert.ok(Math.abs(app.metresPerWorldUnit(0) - 111320) < 1e-6, "1 world unit at the equator should be ~111320m, matching the existing 111320 constant used elsewhere");
  assert.ok(app.metresPerWorldUnit(60) < app.metresPerWorldUnit(0), "a world unit should cover fewer metres at higher latitude (longitude lines converge)");

  const metres = 200;
  const worldUnits = app.metresToWorldUnits(metres, 51.65);
  const roundTripped = worldUnits * app.metresPerWorldUnit(51.65);
  assert.ok(Math.abs(roundTripped - metres) < 1e-6, "metresToWorldUnits should invert metresPerWorldUnit exactly");
});

test("selection viewport re-fits to the whole routed line once the routing graph becomes ready", () => {
  // Regression guard for selections made while the routing graph is still building. The fit that
  // runs at selection time can only see selectedRoutePoints' straight-line fallback, so a route
  // that actually winds via mapped roads/paths -- the reported "230m as the crow flies, 548m
  // walked" shape -- used to end up part off-screen with nothing ever correcting it.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  const tree = { id: "t1", commonName: "Tree 1", ...makePoint(app, 0.0012, 0) };
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };
  app.state.compassHeading = null;

  // "Graph still building": ensureRoutingGraph returns early on routingGraphBuilding, so this
  // also keeps the test from kicking off a real async build that could settle into later tests.
  app.state.routingGraph = null;
  app.state.routingGraphReady = false;
  app.state.routingGraphBuilding = true;
  app.state.selectedRouteCache = null;

  app.ensureUserAndSelectionVisible({ animate: false, force: true });

  // The route the finished graph actually yields: a dog-leg running well east of the direct
  // line before doubling back to the tree.
  const routePoints = [
    app.state.userLocation.point,
    app.projectLonLat(0.0035, 0.0004),
    app.projectLonLat(0.0035, 0.0011),
    tree.point,
  ];

  const offScreenCount = () => {
    const rect = app.bestVisibleCanvasRect();
    return routePoints.filter((point) => {
      const screen = app.worldToScreen(point);
      return screen.x < rect.x
        || screen.x > rect.x + rect.width
        || screen.y < rect.y
        || screen.y > rect.y + rect.height;
    }).length;
  };

  assert.ok(
    offScreenCount() > 0,
    "sanity: fitting only the straight line should leave part of the real route off-screen"
  );

  // The graph finishes -- ensureRoutingGraph (js/loader.js) flips these and calls the re-fit.
  app.state.routingGraph = {};
  app.state.routingGraphReady = true;
  app.state.routingGraphBuilding = false;
  app.state.selectedRouteCache = {
    target: tree,
    fromLatitude: app.state.userLocation.latitude,
    fromLongitude: app.state.userLocation.longitude,
    // Only the tail is cached -- the head is always the live user position, so the drawn line
    // starts where the walker is standing now (selectedRoutePoints, js/renderer.js).
    tail: routePoints.slice(1),
    routed: true,
  };

  app.refitSelectionAfterRoutingGraphReady();

  const animationTarget = app.state.viewportAnimationTo;
  assert.ok(animationTarget, "the re-fit should animate the viewport towards the routed bounds");

  app.state.viewport = { ...animationTarget };
  assert.equal(
    offScreenCount(),
    0,
    "every point of the routed line should sit inside the fitted, inspector-free area"
  );
});

test("selection fit honours assumeInspectorOpen so a route is not framed behind the expanding inspector", () => {
  // The deep-link branches call setInspectorMinimized(false) and fit on the very next line,
  // while the sheet's 180ms max-height transition is still running -- so without opting in the
  // fit frames the route into a taller area than will actually be visible, and its far end
  // ends up behind the finished sheet.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  const tree = { id: "t1", commonName: "Tree 1", ...makePoint(app, 0.0012, 0.0009) };
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };
  app.state.routingGraphReady = true;
  app.state.routingGraphBuilding = false;
  app.state.routingGraph = {};
  app.state.selectedRouteCache = {
    target: tree,
    fromLatitude: app.state.userLocation.latitude,
    fromLongitude: app.state.userLocation.longitude,
    tail: [tree.point],
    routed: true,
  };
  app.els.inspector.classList.add("minimized"); // mid-transition: class toggled, height not yet
  app.resizeCanvas();

  app.ensureUserAndSelectionVisible({ animate: false, force: true, assumeInspectorOpen: true });
  const scaleForOpen = app.state.viewport.scale;

  app.ensureUserAndSelectionVisible({ animate: false, force: true });
  const scaleForMinimized = app.state.viewport.scale;

  assert.ok(
    scaleForOpen < scaleForMinimized,
    "fitting for the open inspector should zoom out further than fitting for the minimized one"
  );

  // And the whole route must sit inside the area the inspector will actually leave.
  app.ensureUserAndSelectionVisible({ animate: false, force: true, assumeInspectorOpen: true });
  const openRect = app.bestVisibleCanvasRect({ assumeInspectorOpen: true });
  for (const point of app.selectedRoutePoints(tree)) {
    const screen = app.worldToScreen(point);
    assert.ok(
      screen.y >= openRect.y && screen.y <= openRect.y + openRect.height,
      `route point should be inside the open-inspector area, got y=${screen.y} for ${JSON.stringify(openRect)}`
    );
  }
});

test("a route with points ahead and behind stays framed at full tilt instead of collapsing the zoom", () => {
  // headingUpAnchorFraction picks the anchor from the target's average bearing, so a
  // destination BEHIND the user mirrors it toward the top -- at full tilt as far as 0.146,
  // while maxScaleForHeadingUpPoints' own margin is already ~0.13 of the rect. Any route point
  // AHEAD then had less than a margin's worth of room, the fit divided by a near-zero gap, and
  // the map zoomed out ~25x further than the destination ever needed. Reported in the field as
  // "when I put the phone up near vertical it zooms really far away".
  const measure = (beta) => {
    resetData(app);
    app.state.userLocation = makePoint(app, 51.6500, 0.0500);
    const tree = { id: "t1", commonName: "T1", ...makePoint(app, 51.6478, 0.0500) }; // behind
    app.state.trees.push(tree);
    app.state.selected = { type: "tree", item: tree };
    app.state.compassHeading = 0; // facing north
    app.state.renderedNavigationHeading = 0;
    app.state.tiltBetaSmoothed = beta;
    app.state.routingGraph = {};
    app.state.routingGraphReady = true;
    app.state.routingGraphBuilding = false;
    app.state.selectedRouteCache = {
      target: tree,
      fromLatitude: app.state.userLocation.latitude,
      fromLongitude: app.state.userLocation.longitude,
      tail: [
        app.projectLonLat(0.0500, 51.6513), // loops AHEAD first
        app.projectLonLat(0.0512, 51.6490),
        tree.point,
      ],
      routed: true,
    };
    const rect = app.bestVisibleCanvasRect();
    const focus = app.navigationFocusPoint(rect);
    const opts = { excludeBehindDuringTilt: false };
    return {
      route: app.maxScaleForHeadingUpPoints(app.selectedNavigationTargetPoints(), focus, rect, opts),
      destinationOnly: app.maxScaleForHeadingUpPoints([tree.point], focus, rect, opts),
    };
  };

  for (const beta of [0, 40, 70, 85]) {
    const { route, destinationOnly } = measure(beta);
    assert.ok(route != null && route > 0, `beta ${beta}: the fit should resolve, got ${route}`);
    assert.ok(
      destinationOnly / route < 2,
      `beta ${beta}: fitting the route should not zoom out far beyond the destination's own fit `
        + `(${(destinationOnly / route).toFixed(1)}x)`
    );
  }
});

test("the balanced anchor only overrides the bearing anchor when points lie on both sides", () => {
  // One-sided fits must keep the existing tilt-ramped / mirrored anchor untouched -- that is
  // what puts the user near the bottom edge in full 3D when everything is ahead of them.
  resetData(app);
  app.state.userLocation = makePoint(app, 51.6500, 0.0500);
  const tree = { id: "t1", commonName: "T1", ...makePoint(app, 51.6530, 0.0500) }; // ahead
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.tiltBetaSmoothed = 85;
  app.state.routingGraph = {};
  app.state.routingGraphReady = true;
  app.state.routingGraphBuilding = false;
  app.state.selectedRouteCache = {
    target: tree,
    fromLatitude: app.state.userLocation.latitude,
    fromLongitude: app.state.userLocation.longitude,
    tail: [tree.point], // nothing behind
    routed: true,
  };

  const rect = app.bestVisibleCanvasRect();
  const anchorFraction = app.headingUpAnchorFraction(true);
  assert.equal(
    app.balancedNavigationAnchorY(rect, anchorFraction),
    rect.y + rect.height * anchorFraction,
    "a one-sided fit should keep the bearing/tilt anchor exactly"
  );
});

test("heading-up navigation frames the whole walking route, not just the destination", () => {
  // maxHeadingUpNavigationScale (and the bearing behind headingUpAnchorFraction) fit
  // selectedNavigationTargetPoints. Returning only the destination meant a route that loops
  // out via roads/paths was drawn well outside the framed area, which is what heading-up
  // navigation shows outdoors whenever the compass is live.
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const tree = { id: "t1", commonName: "T1", ...makePoint(app, 51.6520, 0.0505) };
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;

  // A routed line that swings well east of the direct user->tree line before doubling back.
  const routePoints = [
    app.state.userLocation.point,
    app.projectLonLat(0.0650, 51.6505),
    app.projectLonLat(0.0650, 51.6516),
    tree.point,
  ];
  app.state.routingGraph = {};
  app.state.routingGraphReady = true;
  app.state.routingGraphBuilding = false;
  app.state.selectedRouteCache = {
    target: tree,
    fromLatitude: app.state.userLocation.latitude,
    fromLongitude: app.state.userLocation.longitude,
    // Only the tail is cached -- the head is always the live user position, so the drawn line
    // starts where the walker is standing now (selectedRoutePoints, js/renderer.js).
    tail: routePoints.slice(1),
    routed: true,
  };

  const fitted = app.selectedNavigationTargetPoints();
  assert.equal(fitted.length, routePoints.length, "the routed line should be what gets fitted");

  // The dog-leg is the widest part of the walk, so the fit must be looser than one that only
  // saw the destination.
  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.navigationFocusPoint(focusRect);
  const routeScale = app.maxScaleForHeadingUpPoints(fitted, focus, focusRect, { excludeBehindDuringTilt: false });
  const destinationOnlyScale = app.maxScaleForHeadingUpPoints([tree.point], focus, focusRect, { excludeBehindDuringTilt: false });
  assert.ok(
    routeScale < destinationOnlyScale,
    `fitting the route should zoom out further than fitting the destination alone (${routeScale} vs ${destinationOnlyScale})`
  );

  // Without a location or a route it must still fall back to the bare destination.
  app.state.selectedRouteCache = null;
  app.state.routingGraphReady = false;
  app.state.routingGraph = null;
  const fallback = app.selectedNavigationTargetPoints();
  assert.ok(fallback.length >= 1, "there should still be something to fit while the graph builds");
  assert.deepEqual(
    [fallback[fallback.length - 1].x, fallback[fallback.length - 1].y],
    [tree.point.x, tree.point.y],
    "the fitted points must always end at the destination"
  );
});

test("heading-up selection leaves room for the route detour while the graph is building", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const tree = { id: "t1", commonName: "T1", ...makePoint(app, 51.6512, 0.0509) };
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.routingGraphReady = false;
  app.state.routingGraphBuilding = true;
  app.state.selectedRouteCache = null;

  const rect = app.bestVisibleCanvasRect();
  const focus = app.navigationFocusPoint(rect);
  const fallbackScale = app.maxHeadingUpNavigationScale(focus, rect);

  app.state.routingGraphReady = true;
  app.state.routingGraphBuilding = false;
  app.state.routingGraph = {};
  app.state.selectedRouteCache = {
    target: tree,
    fromLatitude: app.state.userLocation.latitude,
    fromLongitude: app.state.userLocation.longitude,
    tail: [app.projectLonLat(0.0515, 51.6513), tree.point],
    routed: true,
  };
  const routedScale = app.maxHeadingUpNavigationScale(focus, rect);

  assert.ok(
    fallbackScale <= routedScale * 1.01,
    `the first heading-up fit should leave room for the route detour (fallback=${fallbackScale}, routed=${routedScale})`
  );
});

test("heading-up align honours assumeInspectorOpen so a just-expanded inspector is not measured mid-transition", () => {
  // setInspectorMinimized toggles the class and refits immediately, but the inspector's
  // max-height transition (180ms) has not run yet -- and the plain path also reads the
  // memoized overlap rect. Without opting in, the fit is computed against the minimized
  // footprint and the destination can end up behind the expanded sheet.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.001, 0) });
  // Deliberately no compassHeading: the anchored fit engages on a location fix alone
  // (nearbyNavigationAnchorActive), and leaving heading-up off keeps resizeCanvas from
  // applying its heading-up overscan, which would change the canvas dimensions underneath
  // the two measurements being compared here.
  app.els.inspector.classList.add("minimized"); // as it still measures during the transition
  app.resizeCanvas(); // drop the memoized overlap rect so both calls measure fresh

  const minimizedRect = app.bestVisibleCanvasRect();
  const openRect = app.bestVisibleCanvasRect({ assumeInspectorOpen: true });
  assert.ok(openRect.height < minimizedRect.height, "sanity: the open inspector must leave less room");

  app.alignHeadingUpNavigationViewport({ force: true, assumeInspectorOpen: true });
  const anchoredForOpen = app.worldToScreen(app.state.userLocation.point).y;

  app.alignHeadingUpNavigationViewport({ force: true });
  const anchoredForMinimized = app.worldToScreen(app.state.userLocation.point).y;

  assert.ok(
    anchoredForOpen < anchoredForMinimized,
    "assumeInspectorOpen should anchor the user higher up, inside the smaller open-inspector area"
  );
});

test("detour slack is dropped once the routing graph resolves, including when the build failed", () => {
  // ensureRoutingGraph's catch sets routingGraphReady with routingGraph left null and never
  // retries, so the straight line is then the final route -- keeping the slack on would leave
  // every selection for the rest of the session framed ~25% looser than it should be.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  const tree = { id: "t1", commonName: "Tree 1", ...makePoint(app, 0.0012, 0.0009) };
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };

  const fitScaleNow = () => {
    app.ensureUserAndSelectionVisible({ animate: false, force: true });
    return app.state.viewport.scale;
  };

  app.state.routingGraphReady = true;
  app.state.routingGraphBuilding = false;
  app.state.routingGraph = {};
  app.state.selectedRouteCache = {
    target: tree,
    fromLatitude: app.state.userLocation.latitude,
    fromLongitude: app.state.userLocation.longitude,
    tail: [tree.point],
    routed: true,
  };
  const succeededScale = fitScaleNow();

  // Graph build failed: ready, but no graph. Same final route, so the same exact fit.
  app.state.routingGraph = null;
  app.state.selectedRouteCache = null;
  const failedScale = fitScaleNow();

  assert.ok(
    Math.abs(failedScale / succeededScale - 1) < 0.001,
    `a failed graph build should fit exactly like a resolved one, got ${failedScale / succeededScale}x`
  );

  // Still building, though, is genuinely unknown -- slack stays.
  app.state.routingGraphReady = false;
  app.state.routingGraphBuilding = true;
  const buildingScale = fitScaleNow();
  assert.ok(buildingScale < failedScale, "while the graph is still building the fit should keep its slack");
});

test("cache version label reads dev-server cache names as well as production ones", () => {
  // The dev server rewrites only APP_CACHE_NAME to the "dev-" spelling (injectDevFlag in
  // server.js), so a real tunnelled build has a mismatched pair -- which is exactly the case
  // that used to drop the app version entirely and leave a bare "v3" (the data version) on
  // screen, looking like a stale app build.
  // Compared field by field rather than with deepEqual: the label object is created inside the
  // vm context the app runs in, so it has that realm's Object.prototype and deepStrictEqual
  // rejects it as not reference-equal even when the contents match.
  const label = (keys) => {
    const result = app.cacheVersionLabel(keys);
    return [result.appVer, result.dataVer, result.versionString];
  };

  assert.deepEqual(
    label(["forest-finds-app-v18", "forest-finds-data-v3"]),
    ["v18", "v3", "app: v18, data: v3"]
  );

  // The real tunnelled case: dev server renames only the app cache.
  assert.deepEqual(
    label(["forest-finds-dev-app-v18", "forest-finds-data-v3"]),
    ["dev-v18", "v3", "app: dev-v18, data: v3"]
  );

  assert.deepEqual(
    label(["forest-finds-dev-app-v18", "forest-finds-dev-data-v3"]),
    ["dev-v18", "dev-v3", "app: dev-v18, data: dev-v3"]
  );

  assert.equal(app.cacheVersionLabel([]).versionString, "", "no caches yet should render nothing, not a partial label");
});

test("a selection made before the routing graph is ready is fitted with room for the detour the route will take", () => {
  // Without this, the pre-graph fit frames the straight line exactly, which is tighter than the
  // eventual routed line needs -- so the user saw a zoom-in immediately followed by a corrective
  // zoom-out when the graph landed. Both axes are offset here because applyBoundsToViewport
  // clamps a zero-width/height range to a floor, which would hide the slack on that axis.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  const tree = { id: "t1", commonName: "Tree 1", ...makePoint(app, 0.0012, 0.0009) };
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };

  const fitWith = (graphReady) => {
    app.state.routingGraph = graphReady ? {} : null;
    app.state.routingGraphReady = graphReady;
    app.state.routingGraphBuilding = !graphReady;
    app.state.selectedRouteCache = graphReady
      ? {
        target: tree,
        fromLatitude: app.state.userLocation.latitude,
        fromLongitude: app.state.userLocation.longitude,
        tail: [tree.point],
        routed: true,
      }
      : null;
    app.ensureUserAndSelectionVisible({ animate: false, force: true });
    return app.state.viewport.scale;
  };

  const exactScale = fitWith(true);
  const slackScale = fitWith(false);

  assert.ok(slackScale < exactScale, "the pre-graph fit should sit further out than the exact routed fit");
  const ratio = exactScale / slackScale;
  assert.ok(
    Math.abs(ratio - 1.25) < 0.02,
    `pre-graph fit should leave ~1.25x the straight-line bounds, got ${ratio}`
  );
});

test("routing-graph re-fit leaves a settled viewport alone when the whole route is already visible", () => {
  // The re-fit is deliberately non-forced so it is a no-op when there is nothing to correct --
  // otherwise every selection would get a second, pointless camera move seconds after the first.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  const tree = { id: "t1", commonName: "Tree 1", ...makePoint(app, 0.0012, 0) };
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };
  app.state.compassHeading = null;

  app.state.routingGraph = {};
  app.state.routingGraphReady = true;
  app.state.routingGraphBuilding = false;
  app.state.selectedRouteCache = {
    target: tree,
    fromLatitude: app.state.userLocation.latitude,
    fromLongitude: app.state.userLocation.longitude,
    tail: [tree.point],
    routed: true,
  };

  // Fit to that same route first, so everything is already comfortably on screen.
  app.ensureUserAndSelectionVisible({ animate: false, force: true });
  const settled = { ...app.state.viewport };

  app.refitSelectionAfterRoutingGraphReady();

  assert.equal(app.state.viewportAnimationTo, null, "should not start a viewport animation");
  assert.deepEqual(app.state.viewport, settled, "the settled viewport should be left untouched");
});


// ---------------------------------------------------------------------------------------
// Heading-up navigation: the fit has to agree with the tilt camera that draws it.
//
// The scale fit was solved entirely on flat (untilted) coordinates while worldToScreen()
// projects every point through the tilt camera, which compresses distance ahead of the
// pivot towards the horizon. So the scale the fit believed filled the screen rendered the
// route into a fraction of it, and the error grew with tilt: measured on a 1000x800 stage
// with the inspector open and a destination 580 m dead ahead, the framed band came out 1.06x
// too wide at beta 20, 1.45x at 45, 1.96x at 60 and 5.27x at 85. Reported from the field as
// the selected-route view being "so zoomed out". See claude/heading-up-tilt-aware-fit.md.
// ---------------------------------------------------------------------------------------

// Applies the same fit alignHeadingUpNavigationViewport() would, without the ease/defer
// layer on top, and leaves the per-frame tilt + overlap caches invalidated so a following
// worldToScreen() reads the viewport just written rather than a stale camera.
function fitSelectedHeadingUpViewport(app) {
  const rect = app.bestVisibleCanvasRect();
  const focus = app.navigationFocusPoint(rect);
  const scale = app.maxHeadingUpNavigationScale(focus, rect);
  const point = app.state.userLocation.point;
  app.state.viewport = { scale, tx: focus.x - point.x * scale, ty: focus.y - point.y * scale };
  app.resizeCanvas();
  return { rect, focus, scale, band: focus.y - (rect.y + app.headingUpFitMarginPx(rect)) };
}

// Fraction of the band the fit set out to fill that `worldPoint` actually occupies once the
// tilt projection has had its say. 1 means the fit filled exactly what it aimed at; the
// pre-fix flat fit returned 0.19-0.94 depending on tilt.
function projectedFillFraction(app, worldPoint) {
  const fit = fitSelectedHeadingUpViewport(app);
  return (fit.focus.y - app.worldToScreen(worldPoint).y) / fit.band;
}

function selectTreeAheadForTilt(app, degreesNorth = 0.00521) { // ~580 m, the reported case
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0; // facing north, so the destination is dead ahead
  app.state.renderedNavigationHeading = 0;
  const destination = makePoint(app, degreesNorth, 0);
  app.state.trees = [{ id: "tilt-dest", commonName: "Tilt destination", ...destination }];
  app.state.selected = { type: "tree", item: app.state.trees[0] };
  return destination;
}

test("heading-up navigation frames the route where the tilt camera draws it, not where flat geometry puts it", () => {
  const destination = selectTreeAheadForTilt(app);

  for (const beta of [20, 30, 45, 60]) {
    app.state.tiltBetaSmoothed = beta;
    app.state.tiltBetaTarget = beta;
    const fill = projectedFillFraction(app, destination.point);
    // Within a percent of the band it aimed at, at every tilt angle -- not 94% at beta 20
    // falling away to 51% at beta 60. The upper bound matters just as much: overshooting
    // would put the destination outside the margin the fit reserved.
    assert.ok(
      fill > 0.99 && fill <= 1.001,
      `beta=${beta}: destination should occupy the band the fit aimed at, filled ${(fill * 100).toFixed(1)}%`
    );
  }
});

test("the tilt-aware fit stops short of the horizon haze rather than framing the destination as a speck", () => {
  const destination = selectTreeAheadForTilt(app);

  for (const beta of [70, 75, 85]) {
    app.state.tiltBetaSmoothed = beta;
    app.state.tiltBetaTarget = beta;
    const fit = fitSelectedHeadingUpViewport(app);
    const projected = app.worldToScreen(destination.point);

    assert.ok(Number.isFinite(fit.scale) && fit.scale > 0, `beta=${beta}: fit should stay bounded, got ${fit.scale}`);
    // The whole point of TILT_FIT_MIN_PERSPECTIVE_SCALE: however much screen is left, the
    // destination is never pushed deeper than the size it can still be read at.
    assert.ok(
      projected.scale >= app.TILT_FIT_MIN_PERSPECTIVE_SCALE - 1e-9,
      `beta=${beta}: destination projected at ${projected.scale.toFixed(3)} of full size, below the ${app.TILT_FIT_MIN_PERSPECTIVE_SCALE} floor`
    );
    // ...and it is still framed comfortably above the user, not parked on top of them.
    assert.ok(
      (fit.focus.y - projected.y) / fit.band > 0.3,
      `beta=${beta}: destination should still be framed well above the user, got ${(((fit.focus.y - projected.y) / fit.band) * 100).toFixed(0)}% of the band`
    );
  }

  // At max tilt the cap is not a nicety, it is the only thing bounding the fit at all: the
  // horizon sits below the rect's own top margin (TILT_HORIZON_GROUND_RATIO leaves sky above
  // it), so "keep the point inside the rect" is satisfied at *every* scale and an uncapped
  // ahead constraint would never bind.
  app.state.tiltBetaSmoothed = 85;
  app.state.tiltBetaTarget = 85;
  const fit = fitSelectedHeadingUpViewport(app);
  const camera = app.headingUpFitTiltCamera();
  assert.ok(camera, "tilt camera should be available at max tilt");
  assert.ok(
    camera.horizonPx < fit.band,
    `the horizon (${camera.horizonPx.toFixed(0)}px above the pivot) should sit inside the fitted band (${fit.band.toFixed(0)}px) at max tilt, which is what makes the cap load-bearing`
  );
});

test("with tilt inactive the tilt-aware fit is arithmetically identical to the flat one", () => {
  // The tilt-aware constraints are the flat inequalities with the projection substituted in,
  // so at tiltCos 1 / k 0 every one of them must collapse back to exactly the expression it
  // replaced -- including for points behind and to either side, which take different
  // branches. Guards the rewrite as much as the feature.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  const points = [
    makePoint(app, 0.004, 0).point,      // ahead
    makePoint(app, 0.002, 0.003).point,  // ahead and to the right
    makePoint(app, -0.001, -0.002).point, // behind and to the left
    makePoint(app, 0, 0.0035).point,     // exactly beside
  ];
  const rect = app.bestVisibleCanvasRect();
  const focus = app.navigationFocusPoint(rect);

  for (const beta of [0, 11.9]) { // 0 and just under TILT_BETA_THRESHOLD
    app.state.tiltBetaSmoothed = beta;
    app.state.tiltBetaTarget = beta;
    const projected = app.maxScaleForHeadingUpPoints(points, focus, rect, { excludeBehindDuringTilt: false, projectTilt: true });
    const flat = app.maxScaleForHeadingUpPoints(points, focus, rect, { excludeBehindDuringTilt: false });
    assert.equal(projected, flat, `beta=${beta}: projectTilt must be a no-op while tilt is inactive`);
    assert.equal(app.headingUpFitTiltCamera(), null, `beta=${beta}: there is no tilt camera below the threshold`);
  }

  // And the flat value itself is the closed form, not just self-consistent: a single point
  // dead ahead is fitted at exactly (band / its distance).
  const ahead = makePoint(app, 0.004, 0).point;
  const band = focus.y - (rect.y + app.headingUpFitMarginPx(rect));
  const expected = band / (app.state.userLocation.point.y - ahead.y);
  const actual = app.maxScaleForHeadingUpPoints([ahead], focus, rect, { excludeBehindDuringTilt: false, projectTilt: true });
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
});

// ---------------------------------------------------------------------------------------
// resolveHeadingUpTargetScale: a deferred zoom-in has to actually land.
//
// The deferral returned previousScale unchanged for as long as headingUpCompassSensorActive()
// held, i.e. until 350ms passed with no compass event -- which never happens on iOS, where
// deviceorientation fires continuously while the phone is held. Zoom-*out* corrections
// applied immediately, so the scale could only ratchet wider.
// ---------------------------------------------------------------------------------------

// Stands in for real frames: the ease integrates (now - state.headingUpScaleEaseAt), so
// seeding that timestamp one frame back is what a 16ms rAF tick looks like to it. The
// compass event timestamp is refreshed every frame too, which is the condition under test.
function runHeadingUpEaseFrames(app, frames, frameMs = 16) {
  for (let i = 0; i < frames; i++) {
    const now = Date.now();
    app.state.compassLastEventAt = now;
    app.state.headingUpScaleEaseAt = now - frameMs;
    app.alignHeadingUpNavigationViewport();
    app.resizeCanvas();
  }
}

test("a non-urgent heading-up zoom-in eases toward the fit while the compass keeps firing, instead of waiting for it to go quiet", () => {
  const destination = selectTreeAheadForTilt(app);
  app.state.tiltBetaSmoothed = 55;
  app.state.tiltBetaTarget = 55;
  const fit = fitSelectedHeadingUpViewport(app);

  // Start from the scale a flatter phone was fitted at, as raising the phone does.
  const startScale = fit.scale / 2.5;
  const point = app.state.userLocation.point;
  app.state.viewport = { scale: startScale, tx: fit.focus.x - point.x * startScale, ty: fit.focus.y - point.y * startScale };
  app.resizeCanvas();

  // With no previous frame to integrate against, the first call only starts the clock.
  app.state.compassLastEventAt = Date.now();
  app.state.headingUpScaleEaseAt = null;
  app.alignHeadingUpNavigationViewport();
  assert.equal(app.state.viewport.scale, startScale, "the first frame only starts the ease clock");

  runHeadingUpEaseFrames(app, 3);
  const afterFewFrames = app.state.viewport.scale;
  assert.ok(afterFewFrames > startScale, "the ease should be moving while the sensor is still firing (pre-fix: frozen)");
  assert.ok(
    afterFewFrames < startScale + (fit.scale - startScale) * 0.5,
    `no snap: three frames should not cover half the gap, went ${startScale.toFixed(0)} -> ${afterFewFrames.toFixed(0)} of ${fit.scale.toFixed(0)}`
  );

  runHeadingUpEaseFrames(app, 60); // ~1s
  const settled = app.state.viewport.scale;
  // The ease stops inside HEADING_UP_SCALE_BUFFER_RATIO + the settle tolerance of maxScale,
  // which is where a forced fit lands too -- it is converging on the fit, not drifting past.
  const floor = fit.scale * (1 - app.HEADING_UP_SCALE_BUFFER_RATIO - app.HEADING_UP_SCALE_SETTLE_RATIO - 0.01);
  assert.ok(
    settled > floor && settled <= fit.scale + 1e-6,
    `after ~1s the scale should have converged on the fit (${fit.scale.toFixed(0)}), got ${settled.toFixed(0)}`
  );

  // And the destination is now framed where the tilt-aware fit intended.
  const fill = (app.navigationFocusPoint().y - app.worldToScreen(destination.point).y) / fit.band;
  assert.ok(fill > 0.9, `destination should be framed after the ease, filled ${(fill * 100).toFixed(0)}%`);

  runHeadingUpEaseFrames(app, 10);
  assert.ok(
    Math.abs(app.state.viewport.scale - settled) < settled * 0.01,
    "once converged the ease should sit still rather than hunting"
  );
});

test("an urgent heading-up correction still applies in a single frame while the compass is firing", () => {
  selectTreeAheadForTilt(app);
  app.state.tiltBetaSmoothed = 55;
  app.state.tiltBetaTarget = 55;
  const tilted = fitSelectedHeadingUpViewport(app);

  // Lower the phone: the fit the tilted view was using is now far too zoomed in, so the
  // destination has left the screen. That is the one case the ease must not soften.
  app.state.tiltBetaSmoothed = 20;
  app.state.tiltBetaTarget = 20;
  app.resizeCanvas();
  const wanted = app.maxHeadingUpNavigationScale(app.navigationFocusPoint(), app.bestVisibleCanvasRect());
  assert.ok(wanted < tilted.scale, "lowering the phone should require a zoom-out for this fixture");

  runHeadingUpEaseFrames(app, 1);
  assert.ok(
    Math.abs(app.state.viewport.scale - wanted * (1 - app.HEADING_UP_SCALE_BUFFER_RATIO)) < wanted * 0.01,
    `an off-screen target should be corrected in one frame, got ${app.state.viewport.scale.toFixed(0)} want ~${(wanted * (1 - app.HEADING_UP_SCALE_BUFFER_RATIO)).toFixed(0)}`
  );
});

test("a stale scale-ease timestamp is discarded rather than integrated as one huge frame delta", () => {
  selectTreeAheadForTilt(app);
  app.state.tiltBetaSmoothed = 55;
  app.state.tiltBetaTarget = 55;
  const fit = fitSelectedHeadingUpViewport(app);
  const startScale = fit.scale / 2.5;
  const point = app.state.userLocation.point;
  app.state.viewport = { scale: startScale, tx: fit.focus.x - point.x * startScale, ty: fit.focus.y - point.y * startScale };
  app.resizeCanvas();

  // A backgrounded tab, or a screen the ease did not run on: the last timestamp is seconds
  // old. Integrating that (even clamped to HEADING_UP_SCALE_EASE_MAX_DT) is a visible jump.
  const now = Date.now();
  app.state.compassLastEventAt = now;
  app.state.headingUpScaleEaseAt = now - 5000;
  app.alignHeadingUpNavigationViewport();
  assert.equal(app.state.viewport.scale, startScale, "a stale ease timestamp should restart the clock, not move the scale");

  // The restarted clock then eases normally from the next real frame on.
  runHeadingUpEaseFrames(app, 3);
  assert.ok(app.state.viewport.scale > startScale, "the ease should resume on the following frames");
});

test("a sustained run of moderately slow (but not stale) frames still converges instead of freezing", () => {
  // Real-device regression: continuously re-tilting the phone re-runs the tilt-aware
  // maxNearbyHeadingUpScale/maxScaleForHeadingUpPoints projectTilt math every frame, which is
  // real per-frame work on top of redrawing a dense forest of pins/routes under perspective --
  // enough to occasionally push a frame gap into the 50-500ms range (worse than 60fps, nowhere
  // near a backgrounded-tab gap). Before HEADING_UP_SCALE_EASE_STALE_MS existed, ANY gap over
  // HEADING_UP_SCALE_EASE_MAX_DT (50ms) was discarded outright rather than clamped, and the
  // ease clock was reset to `now` on every call regardless -- so a sustained run of such frames
  // integrated zero progress on every single one of them, freezing the view at whatever scale
  // the last *urgent* (off-screen) correction had snapped to. That read as "it dips zoomed out
  // partway through a tilt gesture and then never comes back."
  const destination = selectTreeAheadForTilt(app);
  app.state.tiltBetaSmoothed = 55;
  app.state.tiltBetaTarget = 55;
  const fit = fitSelectedHeadingUpViewport(app);

  const startScale = fit.scale / 2.5;
  const point = app.state.userLocation.point;
  app.state.viewport = { scale: startScale, tx: fit.focus.x - point.x * startScale, ty: fit.focus.y - point.y * startScale };
  app.resizeCanvas();

  app.state.compassLastEventAt = Date.now();
  app.state.headingUpScaleEaseAt = null;
  app.alignHeadingUpNavigationViewport();
  assert.equal(app.state.viewport.scale, startScale, "the first frame only starts the ease clock");

  // 80ms/frame: comfortably above HEADING_UP_SCALE_EASE_MAX_DT (50ms), comfortably below
  // HEADING_UP_SCALE_EASE_STALE_MS (500ms).
  runHeadingUpEaseFrames(app, 30, 80);

  assert.ok(
    app.state.viewport.scale > startScale * 1.5,
    `slow-but-not-stale frames should still make real progress toward the fit (${fit.scale.toFixed(0)}), stuck at ${app.state.viewport.scale.toFixed(0)}`
  );

  const fill = (app.navigationFocusPoint().y - app.worldToScreen(destination.point).y) / fit.band;
  assert.ok(fill > 0.5, `destination should have moved meaningfully toward framed after converging, filled ${(fill * 100).toFixed(0)}%`);
});

// ---------------------------------------------------------------------------------------
// resolveHeadingUpTargetScale: walking to a destination must not make the map breathe.
//
// Field report ("JARRING ZOOM"): walking a route, the zoom jumped in and out and the view
// kept reframing. Two causes, both here.
//
//   A. Zoom-*in* was eased but ANY zoom-out, however slight, fell straight through to a
//      one-frame snap. A live compass and a live GPS fix produce a steady trickle of small
//      zoom-out requests, so the camera sawtoothed: snap out hard, ease back in over ~1s,
//      snap out hard again.
//   B. The only thing standing between the camera and the fit was the 2% settle tolerance,
//      which exists to absorb sub-pixel noise between two identical fits and is far too
//      tight to cover the wander a walking pace produces.
//
// The fix eases both directions (reserving the snap for a real overshoot,
// HEADING_UP_SCALE_SNAP_RATIO) behind a hysteresis deadband (HEADING_UP_SCALE_HOLD_RATIO).
// ---------------------------------------------------------------------------------------

// Drives resolveHeadingUpTargetScale the way a real frame loop does -- each frame's result
// fed back in as the next frame's previousScale, with the compass firing throughout, which
// is the condition under which all of this smoothing applies.
//
// Fully transparent to the rest of the suite, which matters more here than usual: all of
// these tests share one `app`, run in registration order, and have no per-test isolation
// (see "Unit tests" in spec/agents.md), so every field this touches is inherited by
// whatever runs next. Two ways that bit while this was being written --
//
//   - the synthetic clock below is not the app's `performance.now()`, so a leftover
//     state.headingUpScaleEaseAt hands the next test an ease clock in its *future*: gapMs
//     comes out negative, the `!(gapMs > 0)` guard fires every frame, and that test's ease
//     silently freezes;
//   - leaving state.compassLastEventAt at one of these timestamps (or at null) flips
//     headingUpCompassSensorActive() for every later test, which is what decides whether
//     the scale is smoothed at all.
//
// Both showed up as an unrelated nearby-slide test failing about one run in four. So save
// and restore, and return the latch rather than leaving it set for tests to read.
function easeScaleFrames(app, { maxScale, from, frames, frameMs = 16 }) {
  const saved = {
    compassLastEventAt: app.state.compassLastEventAt,
    headingUpScaleEaseAt: app.state.headingUpScaleEaseAt,
    headingUpScaleEasing: app.state.headingUpScaleEasing,
  };
  app.state.headingUpScaleEaseAt = null;
  app.state.headingUpScaleEasing = false;
  let scale = from;
  let now = 100000;
  for (let i = 0; i < frames; i++) {
    app.state.compassLastEventAt = now;
    scale = app.resolveHeadingUpTargetScale(maxScale, scale, false, now);
    now += frameMs;
  }
  const easing = app.state.headingUpScaleEasing;
  Object.assign(app.state, saved);
  return { scale, easing };
}

test("a modest heading-up zoom-out eases instead of snapping, so walking does not sawtooth the zoom", () => {
  const maxScale = 1000;
  const fit = maxScale * (1 - app.HEADING_UP_SCALE_BUFFER_RATIO);
  // Past the hold band, but well short of HEADING_UP_SCALE_SNAP_RATIO: the target is
  // encroaching on the fit margin, not off the screen.
  const from = maxScale * 1.18;
  assert.ok(from < maxScale * app.HEADING_UP_SCALE_SNAP_RATIO, "fixture must not be an urgent correction");

  const { scale: afterOne } = easeScaleFrames(app, { maxScale, from, frames: 1 });
  assert.equal(afterOne, from, "the first frame only starts the ease clock");

  const { scale: afterFive } = easeScaleFrames(app, { maxScale, from, frames: 5 });
  assert.ok(afterFive < from, "the zoom-out should be moving");
  assert.ok(
    afterFive > from - (from - fit) * 0.6,
    `no snap: five frames should not cover most of the gap, went ${from.toFixed(0)} -> ${afterFive.toFixed(0)} of ${fit.toFixed(0)} (pre-fix: ${fit.toFixed(0)} on frame one)`
  );

  const { scale: settled } = easeScaleFrames(app, { maxScale, from, frames: 60 });
  // "Converged" is the ease's own stopping condition: within settleTolerance, which is
  // measured against the scale it has reached rather than the fit, so it lands just inside
  // HEADING_UP_SCALE_SETTLE_RATIO of the target rather than exactly on it.
  assert.ok(
    Math.abs(settled - fit) <= settled * app.HEADING_UP_SCALE_SETTLE_RATIO + 1e-6,
    `the zoom-out should still converge on the fit (${fit.toFixed(0)}), got ${settled.toFixed(0)}`
  );
});

test("a heading-up target that has genuinely left the view is still corrected in one frame", () => {
  const maxScale = 1000;
  const fit = maxScale * (1 - app.HEADING_UP_SCALE_BUFFER_RATIO);
  const from = maxScale * (app.HEADING_UP_SCALE_SNAP_RATIO + 0.25);

  const { scale: afterOne, easing } = easeScaleFrames(app, { maxScale, from, frames: 1 });
  assert.ok(
    Math.abs(afterOne - fit) < 1e-6,
    `an overshoot past HEADING_UP_SCALE_SNAP_RATIO should snap, got ${afterOne.toFixed(0)} want ${fit.toFixed(0)}`
  );
  assert.equal(easing, false, "a snap should not leave the ease latched");
});

test("heading-up scale drift inside the hold band moves the camera not at all", () => {
  const maxScale = 1000;
  const fit = maxScale * (1 - app.HEADING_UP_SCALE_BUFFER_RATIO);
  // 8% away from the fit: outside HEADING_UP_SCALE_SETTLE_RATIO (2%), so it is specifically
  // the deadband holding here and not the old settle tolerance, and inside
  // HEADING_UP_SCALE_HOLD_RATIO (13%).
  const from = fit * 1.08;
  assert.ok(Math.abs(fit - from) > from * app.HEADING_UP_SCALE_SETTLE_RATIO, "fixture must clear the settle tolerance");
  assert.ok(Math.abs(fit - from) < from * app.HEADING_UP_SCALE_HOLD_RATIO, "fixture must sit inside the hold band");

  const { scale: after } = easeScaleFrames(app, { maxScale, from, frames: 120 }); // ~2s of frames
  assert.equal(after, from, "a fit drifting inside the hold band should not move the camera at all");
});

test("once the heading-up hold band is broken the ease runs all the way to the fit, not just back to the band edge", () => {
  const maxScale = 1000;
  const fit = maxScale * (1 - app.HEADING_UP_SCALE_BUFFER_RATIO);
  const from = fit / 2;

  const { scale: settled, easing } = easeScaleFrames(app, { maxScale, from, frames: 120 });
  const bandEdge = fit * (1 - app.HEADING_UP_SCALE_HOLD_RATIO);
  assert.ok(
    settled > bandEdge,
    `the latch should carry the ease past the band edge (${bandEdge.toFixed(0)}), stopped at ${settled.toFixed(0)}`
  );
  assert.ok(
    Math.abs(settled - fit) <= settled * app.HEADING_UP_SCALE_SETTLE_RATIO + 1e-6,
    `and land on the fit (${fit.toFixed(0)}), got ${settled.toFixed(0)}`
  );
  assert.equal(easing, false, "converging should drop the latch so the band guards the next move");
});

// ---------------------------------------------------------------------------------------
// balancedNavigationAnchorY: one vertex a few metres ahead is not "the route goes both ways".
//
// Second half of the "JARRING ZOOM" report -- "lots of reframing". The anchor chooses
// between two formulas that are nowhere near each other at the boundary, and the old
// `ahead <= 0` guard put that choice on a hair: any vertex at all on the ahead side, however
// close, switched the whole framing onto the balanced branch. Walking a route that runs
// behind you, the last junction you have not yet reached is exactly such a vertex -- and
// walking past it, or a 20m route re-solve dropping it, stepped the anchor 138px and the
// map 97px in a single frame. Measured in the browser with the heading held still so
// nothing else could move the camera.
// ---------------------------------------------------------------------------------------

// A destination due south with the walker facing north, on a real routed line: everything
// to be framed is behind except one junction a few metres ahead.
//
// That near junction is not contrived. selectedRoutePoints runs the line from the walker's
// live position through the graph nodes to the destination, so while you are walking up to
// the next node it sits a handful of metres ahead of you. It is a rounding error against a
// route kilometres long, but the old `ahead <= 0` guard only asked whether anything at all
// was on the ahead side -- so walking past that one vertex, or a 20m route re-solve
// dropping it, flipped the anchor between two formulas that are nowhere near each other.
//
// `metresAhead` of 0 removes it, which is what walking past it looks like to the fit. The
// behind vertices stay either way, so the set is a real routed line in both cases rather
// than collapsing to the two-point crow-flies fallback.
function selectRouteBehindWalker(app, metresAhead = 4) {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  const destination = makePoint(app, -0.005, 0);
  app.state.trees = [{ id: "behind-dest", commonName: "Behind destination", ...destination }];
  app.state.selected = { type: "tree", item: app.state.trees[0] };
  const tail = [];
  // ~4m north of the walker: one degree of latitude is ~111km.
  if (metresAhead > 0) tail.push(makePoint(app, metresAhead / 111000, 0).point);
  tail.push(makePoint(app, -0.002, 0).point);
  tail.push(makePoint(app, -0.004, 0).point);
  tail.push(destination.point);
  app.state.selectedRouteCache = {
    target: app.state.trees[0],
    fromLatitude: 0,
    fromLongitude: 0,
    tail,
    routed: true,
  };
  return destination;
}

test("a routed line that runs behind you anchors you at the top of the map, with the route below", () => {
  selectRouteBehindWalker(app);
  const rect = app.bestVisibleCanvasRect();
  const fraction = app.headingUpAnchorFraction(true);
  const top = rect.y + app.headingUpFitMarginPx(rect);

  const anchored = app.balancedNavigationAnchorY(rect, fraction);
  // Near the top of the rect -- the tight framing, with the whole route in the space below.
  // Measured on the real route fixture in the browser, this is what fills 0.75+ of the
  // binding axis where the bearing-mirrored plain anchor manages 0.61
  // (12-selected-route.spec.js, "framed where the tilt camera draws it").
  assert.ok(
    anchored < rect.y + rect.height * 0.2,
    `an all-behind route should put the walker near the top, got ${anchored.toFixed(0)} of ${rect.height.toFixed(0)}`
  );
  assert.ok(anchored >= top - 1e-9, "and never above the fit's own top margin, which would collapse the scale");
});

test("walking past the last route junction ahead of you does not reframe the map", () => {
  selectRouteBehindWalker(app, 4);
  const rect = app.bestVisibleCanvasRect();
  const fraction = app.headingUpAnchorFraction(true);
  const before = app.balancedNavigationAnchorY(rect, fraction);

  // Now it is behind you -- which is what both walking past it and a 20m route re-solve
  // dropping it look like to the fit.
  selectRouteBehindWalker(app, 0);
  const after = app.balancedNavigationAnchorY(rect, fraction);

  // Not zero: that vertex is genuinely part of the route, so the split it contributes to
  // moves by its own small share. What it must not do is step -- before this, losing it
  // switched formulas outright, for 102px here and 138px measured in the browser.
  assert.ok(
    Math.abs(after - before) < rect.height * 0.01,
    `losing the last vertex ahead should move the anchor by its own share, not a step (pre-fix: 102px here, 138px in the browser), moved ${Math.abs(after - before).toFixed(0)}px of ${rect.height.toFixed(0)}`
  );
});

test("a route that genuinely loops both ways still gets the balanced anchor", () => {
  // The case balancedNavigationAnchorY exists for must keep working: with a real share of
  // the route on each side, the split sits well inside the rect rather than at either end.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  const destination = makePoint(app, 0.004, 0);
  app.state.trees = [{ id: "loop-dest", commonName: "Loop destination", ...destination }];
  app.state.selected = { type: "tree", item: app.state.trees[0] };
  app.state.selectedRouteCache = {
    target: app.state.trees[0],
    fromLatitude: 0,
    fromLongitude: 0,
    tail: [makePoint(app, -0.004, 0).point, makePoint(app, 0.002, 0).point, destination.point],
    routed: true,
  };
  const rect = app.bestVisibleCanvasRect();
  const balanced = app.balancedNavigationAnchorY(rect, app.headingUpAnchorFraction(true));
  // Route reaches equally far each way, so the walker belongs in the middle.
  assert.ok(
    Math.abs(balanced - (rect.y + rect.height / 2)) < rect.height * 0.1,
    `an evenly two-sided route should anchor near the middle, got ${balanced.toFixed(0)} of ${rect.height.toFixed(0)}`
  );
});

test("a crow-flies fallback line has nothing to balance, so the plain bearing anchor stands", () => {
  // Two points -- the walker and the destination, no routing graph yet. One of them IS the
  // pivot, so there is no shape to split; headingUpAnchorFraction is the whole answer, and
  // navigationFocusPoint's documented contract depends on it.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  const destination = makePoint(app, -0.005, 0);
  app.state.trees = [{ id: "straight-dest", commonName: "Straight destination", ...destination }];
  app.state.selected = { type: "tree", item: app.state.trees[0] };
  app.state.selectedRouteCache = {
    target: app.state.trees[0],
    fromLatitude: 0,
    fromLongitude: 0,
    tail: [destination.point],
    routed: false,
  };
  const rect = app.bestVisibleCanvasRect();
  const fraction = app.headingUpAnchorFraction(true);
  assert.equal(app.selectedNavigationTargetPoints().length, 2, "fixture must be the two-point fallback");
  assert.ok(
    Math.abs(app.balancedNavigationAnchorY(rect, fraction) - (rect.y + rect.height * fraction)) < 1e-9,
    "the two-point fallback should use headingUpAnchorFraction unchanged"
  );
});

// ---------------------------------------------------------------------------------------
// resolveHeadingUpAnchorFraction: rotating on the spot must not bob the user's own screen
// position.
//
// Field report: "When a location is selected it seems to move the user's position up and
// down a lot when rotating round, even when it's not helping at all with navigation."
// headingUpAnchorFraction/balancedNavigationAnchorY place the user marker at a vertical
// anchor that depends on the destination/route's bearing (or ahead/behind split) relative to
// the *live, rotating* heading -- so simply turning on the spot, with neither the walker nor
// the destination moving an inch, continuously slides that anchor up and down the screen.
// Unlike the scale fit (resolveHeadingUpTargetScale), this had no hysteresis at all: it was
// recomputed and applied fresh on every compass frame. The fix mirrors the scale one exactly,
// held/eased as a fraction of the focus rect's own height rather than an absolute canvas y --
// the rect can itself shift between calls (a resize, the inspector opening, the canvas's own
// heading-up overscan sizing in for the first time) for reasons that have nothing to do with
// the compass, and holding a stale *absolute* position across that shift places it
// nonsensically inside the new rect (measured as a ~5.5x scale collapse between two calls in
// the same frame, when an absolute-pixel version of this was tried first).
// ---------------------------------------------------------------------------------------

// Mirrors easeScaleFrames: drives resolveHeadingUpAnchorFraction the way a real frame loop
// does, saving/restoring every field it touches so it stays transparent to the rest of this
// shared, order-dependent suite (see easeScaleFrames's own comment for why that matters).
function easeAnchorFrames(app, { targetFraction, focusRect, targetKey, from, frames, frameMs = 16 }) {
  const saved = {
    compassLastEventAt: app.state.compassLastEventAt,
    headingUpAnchorFractionSmoothed: app.state.headingUpAnchorFractionSmoothed,
    headingUpAnchorEaseAt: app.state.headingUpAnchorEaseAt,
    headingUpAnchorEasing: app.state.headingUpAnchorEasing,
    headingUpAnchorTargetFor: app.state.headingUpAnchorTargetFor,
  };
  app.state.headingUpAnchorFractionSmoothed = from;
  app.state.headingUpAnchorTargetFor = targetKey;
  app.state.headingUpAnchorEaseAt = null;
  app.state.headingUpAnchorEasing = false;
  let fraction = from;
  let now = 100000;
  for (let i = 0; i < frames; i++) {
    app.state.compassLastEventAt = now;
    fraction = app.resolveHeadingUpAnchorFraction(targetFraction, focusRect, targetKey, false, now);
    now += frameMs;
  }
  const easing = app.state.headingUpAnchorEasing;
  Object.assign(app.state, saved);
  return { fraction, easing };
}

test("heading-up anchor drift inside the hold band moves the user's screen position not at all", () => {
  const rect = { x: 0, y: 0, width: 1000, height: 800 };
  const from = 0.4;
  // Outside HEADING_UP_POSITION_PX_THRESHOLD/height, inside HEADING_UP_ANCHOR_HOLD_RATIO.
  const targetFraction = from + app.HEADING_UP_ANCHOR_HOLD_RATIO * 0.6;

  const { fraction: after } = easeAnchorFrames(app, { targetFraction, focusRect: rect, targetKey: "t", from, frames: 120 });
  assert.equal(after, from, "an anchor target drifting inside the hold band should not move the camera at all");
});

test("once the heading-up anchor hold band is broken it eases toward the target instead of snapping", () => {
  const rect = { x: 0, y: 0, width: 1000, height: 800 };
  const from = 0.4;
  const targetFraction = from + 0.4; // well past the hold band

  const { fraction: afterOne } = easeAnchorFrames(app, { targetFraction, focusRect: rect, targetKey: "t", from, frames: 1 });
  assert.equal(afterOne, from, "the first frame only starts the ease clock");

  const { fraction: afterFew } = easeAnchorFrames(app, { targetFraction, focusRect: rect, targetKey: "t", from, frames: 3 });
  assert.ok(afterFew > from, "the ease should be moving toward the target");
  assert.ok(
    afterFew < from + (targetFraction - from) * 0.5,
    `no snap: three frames should not cover half the gap, went ${from} -> ${afterFew.toFixed(3)} of ${targetFraction}`
  );

  const { fraction: settled, easing } = easeAnchorFrames(app, { targetFraction, focusRect: rect, targetKey: "t", from, frames: 120 });
  assert.ok(
    Math.abs(settled - targetFraction) * rect.height <= app.HEADING_UP_POSITION_PX_THRESHOLD,
    `after ~2s the anchor should have converged on the target (${targetFraction}), got ${settled.toFixed(3)}`
  );
  assert.equal(easing, false, "converging should drop the latch so the band guards the next move");
});

test("a different navigation target snaps the heading-up anchor immediately, with no ease from the old one's position", () => {
  const rect = { x: 0, y: 0, width: 1000, height: 800 };
  const saved = {
    compassLastEventAt: app.state.compassLastEventAt,
    headingUpAnchorFractionSmoothed: app.state.headingUpAnchorFractionSmoothed,
    headingUpAnchorEaseAt: app.state.headingUpAnchorEaseAt,
    headingUpAnchorEasing: app.state.headingUpAnchorEasing,
    headingUpAnchorTargetFor: app.state.headingUpAnchorTargetFor,
  };
  // Seed the anchor as if it had settled on target "a" far from where "b" wants it.
  app.state.headingUpAnchorFractionSmoothed = 0.2;
  app.state.headingUpAnchorTargetFor = "a";
  app.state.compassLastEventAt = Date.now(); // sensor "live" -- would normally hold/ease
  const result = app.resolveHeadingUpAnchorFraction(0.75, rect, "b", false, Date.now());
  Object.assign(app.state, saved);

  assert.equal(result, 0.75, "a fresh selection's anchor should take effect immediately, not ease from the previous one's");
});

test("the heading-up anchor is not eased when the compass is quiet or the caller forces it", () => {
  const rect = { x: 0, y: 0, width: 1000, height: 800 };
  const from = 0.4;
  const targetFraction = from + 0.3;

  const savedA = {
    headingUpAnchorFractionSmoothed: app.state.headingUpAnchorFractionSmoothed,
    headingUpAnchorTargetFor: app.state.headingUpAnchorTargetFor,
    compassLastEventAt: app.state.compassLastEventAt,
  };
  app.state.headingUpAnchorFractionSmoothed = from;
  app.state.headingUpAnchorTargetFor = "t";
  app.state.compassLastEventAt = null; // sensor quiet
  const quiet = app.resolveHeadingUpAnchorFraction(targetFraction, rect, "t", false, Date.now());
  Object.assign(app.state, savedA);
  assert.equal(quiet, targetFraction, "with the compass quiet, the anchor should resolve immediately");

  const savedB = {
    headingUpAnchorFractionSmoothed: app.state.headingUpAnchorFractionSmoothed,
    headingUpAnchorTargetFor: app.state.headingUpAnchorTargetFor,
    compassLastEventAt: app.state.compassLastEventAt,
  };
  app.state.headingUpAnchorFractionSmoothed = from;
  app.state.headingUpAnchorTargetFor = "t";
  app.state.compassLastEventAt = Date.now(); // sensor live
  const forced = app.resolveHeadingUpAnchorFraction(targetFraction, rect, "t", true, Date.now());
  Object.assign(app.state, savedB);
  assert.equal(forced, targetFraction, "an app-driven (forced) framing should resolve immediately even with the compass live");
});

test("rotating on the spot with a location selected does not bob the user's own screen position", () => {
  // The route runs north-south of the walker (selectRouteBehindWalker), so as the simulated
  // heading sweeps a full circle, every point on it trades places between "ahead" and
  // "behind" -- exactly the live, rotating-heading condition the anchor now has to damp
  // rather than track frame-for-frame.
  selectRouteBehindWalker(app, 4);
  app.state.tiltBetaSmoothed = 0;
  app.state.tiltBetaTarget = 0;
  app.resizeCanvas();

  const frameHeading = (heading, frameMs = 16) => {
    const now = Date.now();
    app.state.compassHeading = heading;
    app.state.compassHeadingTarget = heading;
    app.state.renderedNavigationHeading = heading;
    app.state.compassLastEventAt = now;
    app.state.headingUpAnchorEaseAt = now - frameMs;
    app.state.headingUpScaleEaseAt = now - frameMs;
    app.alignHeadingUpNavigationViewport();
  };

  frameHeading(0); // seed the anchor uncontested before measuring steps
  const rect = app.bestVisibleCanvasRect();
  let worstStepPx = 0;
  let previousY = app.worldToScreen(app.state.userLocation.point).y;
  for (let heading = 3; heading <= 360; heading += 3) {
    frameHeading(heading);
    const y = app.worldToScreen(app.state.userLocation.point).y;
    worstStepPx = Math.max(worstStepPx, Math.abs(y - previousY));
    previousY = y;
  }

  assert.ok(
    worstStepPx < rect.height * 0.05,
    `a single ~3deg heading step should not visibly relocate the user while stationary, worst step moved ${worstStepPx.toFixed(1)}px of ${rect.height.toFixed(0)}`
  );
});

// ---------------------------------------------------------------------------------------
// ingestLocationFix / advanceLocationGlide: the once-a-second GPS twitch.
// ---------------------------------------------------------------------------------------

function resetLocationSmoothing(app) {
  app.state.rawUserLocation = null;
  app.state.locationGlide = null;
  app.state.locationSmoothedAt = null;
  app.state.locationFixHistory = [];
}

test("the first GPS fix is used as delivered, with no smoothing to ease in from", () => {
  resetData(app);
  resetLocationSmoothing(app);
  app.state.userLocation = null;
  const fix = app.ingestLocationFix(51.665, 0.045, 10, 1000);
  assert.equal(fix.latitude, 51.665);
  assert.equal(fix.longitude, 0.045);
  assert.equal(app.state.locationGlide, null, "nothing to glide from on the first fix");
  assert.ok(app.state.rawUserLocation, "the raw fix is kept for analytics");
});

test("a later GPS fix is eased toward rather than jumping the position", () => {
  resetData(app);
  resetLocationSmoothing(app);
  app.state.userLocation = null;
  app.state.userLocation = app.ingestLocationFix(51.665, 0.045, 10, 1000);
  const before = { ...app.state.userLocation.point };

  // A second fix ~12m away, one second later: wander, not a teleport.
  const next = app.ingestLocationFix(51.66511, 0.04501, 10, 2000);
  assert.deepEqual(
    { x: next.point.x, y: next.point.y }, before,
    "the position should not move on the fix itself -- the per-frame ease carries it"
  );
  const glide = app.state.locationGlide;
  assert.ok(glide, "an ease toward the new fix should be pending");
  assert.deepEqual(glide.to, app.state.rawUserLocation.point, "and it heads for the raw fix");

  app.state.userLocation = next;
  const total = Math.hypot(glide.to.x - before.x, glide.to.y - before.y);

  app.advanceLocationGlide(2016);
  const afterOneFrame = Math.hypot(app.state.userLocation.point.x - before.x, app.state.userLocation.point.y - before.y);
  assert.ok(
    afterOneFrame > 0 && afterOneFrame < total * 0.5,
    `one frame should cover part of the distance, not all of it: ${afterOneFrame} of ${total}`
  );

  // Most of the way within about a second (tau is 1s at this accuracy), and all the way
  // given a few more -- it must not rest short of the fix.
  for (let t = 2032; t <= 3000; t += 16) app.advanceLocationGlide(t);
  const afterASecond = Math.hypot(app.state.userLocation.point.x - before.x, app.state.userLocation.point.y - before.y);
  assert.ok(afterASecond > total * 0.5, `a second of easing should cover most of the distance, got ${afterASecond} of ${total}`);

  for (let t = 3016; t <= 12000; t += 16) app.advanceLocationGlide(t);
  const remaining = Math.hypot(app.state.userLocation.point.x - glide.to.x, app.state.userLocation.point.y - glide.to.y);
  assert.ok(remaining <= app.LOCATION_GLIDE_EPSILON, `the ease should converge on the fix, ${remaining} short`);
});

test("a position that stops updating still converges on the last fix, rather than resting short of it", () => {
  // The failure this guards, caught in CI: a per-fix low-pass only recomputed its target
  // when a fix arrived, so one fix followed by silence left the position permanently
  // part-way there. The settings spec sets a position once and waits for
  // state.userLocation to reach it -- it waited out the whole 60s test timeout.
  resetData(app);
  resetLocationSmoothing(app);
  app.state.userLocation = null;
  app.state.userLocation = app.ingestLocationFix(51.665, 0.045, 25, 1000); // poor accuracy: the most smoothing
  app.state.userLocation = app.ingestLocationFix(51.6653, 0.0453, 25, 2000);
  const destination = { ...app.state.rawUserLocation };

  for (let t = 2016; t <= 12000; t += 16) app.advanceLocationGlide(t);

  assert.ok(
    Math.abs(app.state.userLocation.latitude - destination.latitude) < 0.000005,
    `latitude should reach the fix, off by ${Math.abs(app.state.userLocation.latitude - destination.latitude)}`
  );
  assert.ok(
    Math.abs(app.state.userLocation.longitude - destination.longitude) < 0.000005,
    `longitude should reach the fix, off by ${Math.abs(app.state.userLocation.longitude - destination.longitude)}`
  );
});

// About 15m north per step at Epping Forest's latitude: train speed over a one-second fix
// interval, yet under LOCATION_SMOOTHING_SNAP_METRES, so only the speed check can stop the easing.
const TRAIN_STEP_DEG = 0.000135;

test("on a train, a fix the device reports at travelling speed is used as delivered, so Nearby keeps up", () => {
  resetData(app);
  resetLocationSmoothing(app);
  app.state.userLocation = null;
  app.state.userLocation = app.ingestLocationFix(51.665, 0.045, 25, 1000, 20);
  const next = app.ingestLocationFix(51.665 + TRAIN_STEP_DEG, 0.045, 25, 2000, 20);
  assert.equal(app.state.locationGlide, null, "no easing behind a moving train");
  assert.equal(next.latitude, 51.665 + TRAIN_STEP_DEG, "the position is the fix itself");
});

test("sustained travel with no device speed reading stops being smoothed within a few seconds", () => {
  resetData(app);
  resetLocationSmoothing(app);
  app.state.userLocation = null;
  // A fix a second at 15 m/s, with the map's frames running between them as they do on a phone.
  // Eased, the position alternated between trailing up to ~30m behind and snapping forward.
  for (let i = 0; i <= 12; i += 1) {
    const at = 1000 + i * 1000;
    const latitude = 51.665 + i * TRAIN_STEP_DEG;
    app.state.userLocation = app.ingestLocationFix(latitude, 0.045, 25, at, null);
    if (i >= 8) {
      assert.equal(app.state.locationGlide, null, `fix ${i}: eight seconds at 15 m/s is travel, not wander`);
      assert.equal(app.state.userLocation.latitude, latitude, `fix ${i}: the position is the fix, not a trailing ease`);
    }
    for (let t = at + 16; t < at + 1000; t += 16) app.advanceLocationGlide(t);
  }
});

test("a walker's wander under trees is still smoothed however long it goes on", () => {
  resetData(app);
  resetLocationSmoothing(app);
  app.state.userLocation = null;
  // Fifteen seconds of fixes scattered up to ~8m either side of one spot, no device speed.
  const offsets = [0, 0.00007, -0.00006, 0.00005, -0.00007, 0.00003, -0.00004, 0.00007, -0.00005, 0.00006, -0.00007, 0.00004, -0.00006, 0.00007, -0.00003, 0.00005];
  offsets.forEach((offset, i) => {
    app.state.userLocation = app.ingestLocationFix(51.665 + offset, 0.045 - offset, 25, 1000 + i * 1000, null);
    if (i > 0) assert.ok(app.state.locationGlide, `fix ${i} is wander and should still be eased`);
  });
});

test("a large jump in position lands at once rather than crawling there", () => {
  resetData(app);
  resetLocationSmoothing(app);
  app.state.userLocation = null;
  app.state.userLocation = app.ingestLocationFix(51.665, 0.045, 10, 1000);
  // Well past LOCATION_SMOOTHING_SNAP_METRES: a first fix after a gap, or coming out of a
  // tunnel. Easing across that would read as the map sliding away on its own.
  const jumped = app.ingestLocationFix(51.68, 0.06, 10, 2000);
  assert.equal(app.state.locationGlide, null, "no glide for a real jump");
  assert.equal(jumped.latitude, 51.68, "the position lands on the fix itself");
});

test("a poor-accuracy fix is leaned on harder than a good one", () => {
  const coveredIn = (accuracy, frames) => {
    resetData(app);
    resetLocationSmoothing(app);
    app.state.userLocation = null;
    app.state.userLocation = app.ingestLocationFix(51.665, 0.045, accuracy, 1000);
    const from = { ...app.state.userLocation.point };
    app.state.userLocation = app.ingestLocationFix(51.66511, 0.04501, accuracy, 2000);
    const to = app.state.locationGlide.to;
    for (let i = 1; i <= frames; i += 1) app.advanceLocationGlide(2000 + i * 16);
    const moved = Math.hypot(app.state.userLocation.point.x - from.x, app.state.userLocation.point.y - from.y);
    return moved / Math.hypot(to.x - from.x, to.y - from.y);
  };
  // Same frames, same distance: the tight fix is followed further in that time. Both still
  // arrive -- accuracy sets how hard the wander is damped on the way, not where it ends up.
  const tight = coveredIn(4, 10);
  const loose = coveredIn(25, 10);
  assert.ok(tight > loose, `a 4m fix should be followed faster than a 25m one, covered ${tight.toFixed(2)} vs ${loose.toFixed(2)}`);
});

test("a heading-up zoom-out eases faster than a zoom-in of the same proportion", () => {
  const maxScale = 1000;
  const fit = maxScale * (1 - app.HEADING_UP_SCALE_BUFFER_RATIO);
  const frames = 6;

  const outFrom = fit * 1.3;
  const { scale: outAfter } = easeScaleFrames(app, { maxScale, from: outFrom, frames });
  const outCovered = (outFrom - outAfter) / (outFrom - fit);

  const inFrom = fit / 1.3;
  const { scale: inAfter } = easeScaleFrames(app, { maxScale, from: inFrom, frames });
  const inCovered = (inAfter - inFrom) / (fit - inFrom);

  assert.ok(outCovered > 0 && inCovered > 0, "both directions should be easing");
  assert.ok(
    outCovered > inCovered * 1.5,
    `recovering room the target is running out of should be quicker than tightening an already-correct frame: out covered ${(outCovered * 100).toFixed(0)}%, in ${(inCovered * 100).toFixed(0)}%`
  );
});

// --- Compass staleness recovery -------------------------------------------------
// Field report: "on some occasions it's still losing the compass or z-axis updates, it seems
// to be after I put my phone down and come back to it -- a refresh fixes it". The recovery
// logic used to live inline in the visibilitychange handler, giving it exactly one chance per
// return to the foreground. iOS routinely resumes deviceorientation later than that check (and
// sometimes not at all without a nudge), so the map stayed frozen on a stale heading -- or
// stuck north-up with no tilt, since tiltActive() is gated on headingUpActive() -- until the
// page was reloaded. These cover the shared, repeatable recovery path that replaced it.

function withListenerSpy(app, fn) {
  const originalAdd = app.windowStub.addEventListener;
  const originalRemove = app.windowStub.removeEventListener;
  const added = [];
  const removed = [];
  app.windowStub.addEventListener = (type) => { added.push(type); };
  app.windowStub.removeEventListener = (type) => { removed.push(type); };
  try {
    fn({ added, removed });
  } finally {
    app.windowStub.addEventListener = originalAdd;
    app.windowStub.removeEventListener = originalRemove;
  }
}

test("compassSensorStalled stays false on a device whose compass has never fired", () => {
  resetData(app);
  app.state.compassLastEventAt = null;
  assert.equal(
    app.compassSensorStalled(),
    false,
    "with no compass at all (desktop, permission never granted) the watchdog must not thrash listeners forever"
  );
});

test("compassSensorStalled flips only once a delivered heading has gone quiet past the threshold", () => {
  resetData(app);
  const now = Date.now();

  app.state.orientationLastEventAt = now - 1000;

  app.state.compassLastEventAt = now - 1000;
  assert.equal(app.compassSensorStalled(now), false, "a recent heading is not stalled");

  app.state.compassLastEventAt = now - (app.COMPASS_STALE_MS - 1);
  assert.equal(app.compassSensorStalled(now), false, "just inside the threshold is not stalled");

  app.state.compassLastEventAt = now - (app.COMPASS_STALE_MS + 1);
  assert.equal(app.compassSensorStalled(now), true, "past the threshold is stalled");
});

test("compassSensorStalled stays false when heading state was set without any orientation event firing", () => {
  // onDeviceOrientation is the only writer of orientationLastEventAt, so requiring it keeps
  // the watchdog inert for code that drives heading state directly -- the e2e tilt specs set
  // compassHeading/compassLastEventAt by hand and measure two canvas draws, and a watchdog
  // waking between them to clear the heading and repaint corrupts the comparison.
  resetData(app);
  const now = Date.now();
  app.state.compassHeading = 0;
  app.state.compassLastEventAt = now - (app.COMPASS_STALE_MS + 5000);
  app.state.orientationLastEventAt = null;

  assert.equal(app.compassSensorStalled(now), false, "no real event has ever fired, so there is no stalled sensor to recover");

  withListenerSpy(app, ({ added }) => {
    app.recoverStalledCompass(now);
    assert.deepEqual(added, [], "the watchdog must not touch listeners");
  });
  assert.equal(app.state.compassHeading, 0, "directly-driven heading state must be left alone");
});

test("recoverStalledCompass drops a stale heading and sends the next readings back through calibration", () => {
  resetData(app);
  const now = Date.now();
  app.state.compassHeading = 90;
  app.state.compassHeadingTarget = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.compassLastEventAt = now - (app.COMPASS_STALE_MS + 1000);
  app.state.orientationLastEventAt = now - (app.COMPASS_STALE_MS + 1000);

  withListenerSpy(app, () => app.recoverStalledCompass(now));

  assert.equal(app.state.compassHeading, null, "a heading we can no longer trust must not keep rotating the map");
  assert.equal(app.state.compassHeadingTarget, null);
  assert.equal(app.state.renderedNavigationHeading, null);
  assert.equal(app.state.compassCalibrationStartedAt, null, "calibration should be reset so new readings are re-gated");
  assert.equal(app.state.compassCalibrationSamples.length, 0);
});

test("recoverStalledCompass re-registers the orientation listeners while the sensor is silent -- every time, not just once", () => {
  resetData(app);
  const now = Date.now();
  app.state.compassHeading = 90;
  app.state.compassHeadingTarget = 90;
  app.state.compassLastEventAt = now - (app.COMPASS_STALE_MS + 1000);
  app.state.orientationLastEventAt = now - (app.COMPASS_STALE_MS + 1000);

  withListenerSpy(app, ({ added, removed }) => {
    app.recoverStalledCompass(now);
    assert.deepEqual(
      added,
      ["deviceorientationabsolute", "deviceorientation"],
      "the sensor nudge is remove-then-add; a bare addEventListener would be a no-op for an already-registered handler"
    );
    assert.deepEqual(removed, ["deviceorientationabsolute", "deviceorientation"]);

    // The heading is already cleared now. The regression this guards is the recovery being
    // one-shot: a sensor that does not come back on the first attempt must keep being nudged.
    added.length = 0;
    app.recoverStalledCompass(now);
    assert.deepEqual(
      added,
      ["deviceorientationabsolute", "deviceorientation"],
      "a still-silent sensor must be nudged again rather than left until the user reloads"
    );
  });
});

test("recoverStalledCompass asks for movement instead of re-registering when orientation events still arrive without a heading", () => {
  resetData(app);
  const now = Date.now();
  app.state.compassHeading = 90;
  app.state.compassHeadingTarget = 90;
  app.state.compassLastEventAt = now - (app.COMPASS_STALE_MS + 1000);
  // Sensor is alive -- it is the magnetometer that has lost its heading, which re-registering
  // listeners cannot fix.
  app.state.orientationLastEventAt = now - 100;

  withListenerSpy(app, ({ added }) => {
    app.recoverStalledCompass(now);
    assert.deepEqual(added, [], "a live sensor must not have its listeners thrashed");
  });
  assert.equal(app.state.compassHeading, null, "the untrustworthy heading is still dropped");
  assert.equal(
    app.state.compassCalibrationPromptVisible,
    true,
    "the user should be prompted to move the phone, which is what actually re-calibrates the magnetometer"
  );
});

test("recoverStalledCompass does nothing while the page is hidden", () => {
  resetData(app);
  const now = Date.now();
  app.state.compassHeading = 90;
  app.state.compassHeadingTarget = 90;
  app.state.compassLastEventAt = now - (app.COMPASS_STALE_MS + 1000);
  app.documentStub.visibilityState = "hidden";
  try {
    withListenerSpy(app, ({ added }) => {
      app.recoverStalledCompass(now);
      assert.deepEqual(added, [], "no sensor nudging while backgrounded");
    });
    assert.equal(app.state.compassHeading, 90, "a backgrounded tab keeps its heading; recovery happens on resume");
  } finally {
    app.documentStub.visibilityState = "visible";
  }
});

test("hasMovedSinceBackgrounding treats no baseline as movement", () => {
  resetData(app);
  app.state.backgroundedUserLocation = null;
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  assert.equal(app.hasMovedSinceBackgrounding(), true, "nothing to compare against -- assume the heading may no longer be trusted");
});

test("hasMovedSinceBackgrounding treats no current fix as movement", () => {
  resetData(app);
  app.state.backgroundedUserLocation = { latitude: 51.665, longitude: 0.045 };
  app.state.userLocation = null;
  assert.equal(app.hasMovedSinceBackgrounding(), true);
});

test("hasMovedSinceBackgrounding is false for the same spot the tab was backgrounded at", () => {
  resetData(app);
  app.state.backgroundedUserLocation = { latitude: 51.665, longitude: 0.045 };
  // A few metres of GPS wander, well under LOCATION_SMOOTHING_SNAP_METRES.
  app.state.userLocation = makePoint(app, 51.66501, 0.04501);
  assert.equal(app.hasMovedSinceBackgrounding(), false);
});

test("hasMovedSinceBackgrounding is true once the walker has genuinely relocated", () => {
  resetData(app);
  app.state.backgroundedUserLocation = { latitude: 51.665, longitude: 0.045 };
  app.state.userLocation = makePoint(app, 51.667, 0.045); // roughly 220m north
  assert.equal(app.hasMovedSinceBackgrounding(), true);
});

test("pauseBackgroundedTracking snapshots the current fix for hasMovedSinceBackgrounding", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.pauseBackgroundedTracking();
  // Compared field by field, not with deepEqual: the snapshot object is created inside the vm
  // context the app runs in, so it has that realm's Object.prototype and deepStrictEqual
  // rejects it as not reference-equal even when the contents match (see the cache-version-label
  // test above for the same issue).
  assert.equal(app.state.backgroundedUserLocation.latitude, 51.665);
  assert.equal(app.state.backgroundedUserLocation.longitude, 0.045);
});

test("recoverStalledCompass keeps a heading that is still good when the walker has not moved", () => {
  resetData(app);
  const now = Date.now();
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.backgroundedUserLocation = { latitude: 51.665, longitude: 0.045 };
  app.state.compassHeading = 90;
  app.state.compassHeadingTarget = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.compassLastEventAt = now - (app.COMPASS_STALE_MS + 1000);
  app.state.orientationLastEventAt = now - (app.COMPASS_STALE_MS + 1000);

  app.recoverStalledCompass(now);

  assert.equal(app.state.compassHeading, 90, "a heading the walker has not moved away from is still a good guess");
  assert.equal(app.state.renderedNavigationHeading, 90, "so the map must not spin back to north with nothing having changed");
});

test("recoverStalledCompass still drops the heading once the walker has actually moved", () => {
  resetData(app);
  const now = Date.now();
  app.state.userLocation = makePoint(app, 51.667, 0.045);
  app.state.backgroundedUserLocation = { latitude: 51.665, longitude: 0.045 }; // ~220m away
  app.state.compassHeading = 90;
  app.state.compassHeadingTarget = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.compassLastEventAt = now - (app.COMPASS_STALE_MS + 1000);
  app.state.orientationLastEventAt = now - (app.COMPASS_STALE_MS + 1000);

  app.recoverStalledCompass(now);

  assert.equal(app.state.compassHeading, null, "a real relocation makes the old heading untrustworthy");
  assert.equal(app.state.renderedNavigationHeading, null);
});

test("a beta-only orientation event restarts the smoothing loop so 3D keeps responding", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.compassHeading = 20;
  app.state.compassHeadingTarget = 20;
  app.state.tiltBetaSmoothed = 0;
  app.state.tiltBetaTarget = 0;
  app.state.compassAnimationFrame = null;

  // A phone whose magnetometer has lost its heading still reports beta. Before this, the target
  // moved and nothing eased tiltBetaSmoothed toward it, so tilting the phone did nothing until
  // some unrelated redraw happened to restart the loop.
  app.onDeviceOrientation({ alpha: null, beta: 55 });

  assert.equal(app.state.tiltBetaTarget, 55, "the tilt target follows beta");
  assert.notEqual(app.state.compassAnimationFrame, null, "and the loop that smooths it is running");
});

test("a beta-only orientation event starts the tilt loop even without a trusted heading", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.compassHeading = null;
  app.state.compassHeadingTarget = null;
  app.state.compassAnimationFrame = null;

  app.onDeviceOrientation({ alpha: null, beta: 55 });

  assert.equal(app.state.tiltBetaTarget, 55);
  assert.notEqual(app.state.compassAnimationFrame, null, "pitch still needs a smoothing loop without a heading");
});

test("changing the browse anchor outside setNearbyAnchor still moves the camera with it", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6653, 0.045) });
  app.selectOverview();
  app.prepareCanvasForDraw();
  const before = app.nearbyRenderOriginPoint();
  assert.equal(before, app.state.userLocation.point);

  // focusNearbyOnMapPoint's exit-a-selection path assigns the anchor directly and re-fits in the
  // same tick, with no frame boundary in between -- the per-frame origin freeze has to notice.
  const anchor = makePoint(app, 51.66, 0.033);
  app.state.nearbyAnchor = { latitude: anchor.latitude, longitude: anchor.longitude, point: anchor.point };

  assert.equal(app.nearbyRenderOriginPoint(), anchor.point, "the frozen origin follows the new anchor");
});

test("onDeviceOrientation records that the sensor fired even when the event carries no usable heading", () => {
  resetData(app);
  app.state.compassLastEventAt = null;
  app.state.orientationLastEventAt = null;

  app.onDeviceOrientation({ alpha: null, beta: 40 });

  assert.ok(
    Number.isFinite(app.state.orientationLastEventAt),
    "recoverStalledCompass distinguishes a suspended sensor from a live one by this timestamp"
  );
  assert.equal(app.state.compassLastEventAt, null, "an event with no heading must not count as a compass reading");
  assert.equal(app.state.tiltBetaTarget, 40, "beta is still usable on its own");
});

// --- Heading source ranking: keeping Android's two orientation streams apart ---

function resetHeadingSource(app) {
  app.state.compassHeadingSource = app.HEADING_SOURCE_NONE;
  app.state.compassHeading = null;
  app.state.compassHeadingTarget = null;
  app.state.compassLastEventAt = null;
  app.resetCompassCalibration();
}

test("orientationHeadingSource ranks a north-referenced reading above a bare relative alpha", () => {
  assert.equal(app.orientationHeadingSource({ webkitCompassHeading: 12 }), app.HEADING_SOURCE_ABSOLUTE);
  assert.equal(app.orientationHeadingSource({ alpha: 90, absolute: true }), app.HEADING_SOURCE_ABSOLUTE);
  assert.equal(
    app.orientationHeadingSource({ alpha: 90, type: "deviceorientationabsolute" }),
    app.HEADING_SOURCE_ABSOLUTE,
    "the absolute event carries a north-referenced alpha by definition"
  );
  assert.equal(app.orientationHeadingSource({ alpha: 90, absolute: false }), app.HEADING_SOURCE_RELATIVE);
  assert.equal(app.orientationHeadingSource({ alpha: 90 }), app.HEADING_SOURCE_RELATIVE);
  assert.equal(app.orientationHeadingSource({ beta: 40 }), app.HEADING_SOURCE_NONE);
  assert.equal(app.orientationHeadingSource(null), app.HEADING_SOURCE_NONE);
});

test("an iPhone heading flagged invalid by webkitCompassAccuracy is not trusted", () => {
  // Apple documents a negative webkitCompassAccuracy as "this heading is not valid". The
  // number next to it is arbitrary, not merely imprecise, so it must not reach the map.
  assert.equal(
    app.orientationHeadingSource({ webkitCompassHeading: 210, webkitCompassAccuracy: -1 }),
    app.HEADING_SOURCE_NONE
  );
  assert.equal(
    app.orientationHeadingSource({ webkitCompassHeading: 210, webkitCompassAccuracy: 15 }),
    app.HEADING_SOURCE_ABSOLUTE,
    "a valid accuracy reading is the good case and must still be trusted"
  );
  assert.equal(
    app.orientationHeadingSource({ webkitCompassHeading: 210, webkitCompassAccuracy: 0 }),
    app.HEADING_SOURCE_ABSOLUTE,
    "zero is a perfect reading, not a negative one"
  );
  assert.equal(
    app.orientationHeadingSource({ webkitCompassHeading: 210 }),
    app.HEADING_SOURCE_ABSOLUTE,
    "no accuracy field at all (non-iOS, older iOS) is not evidence of a bad heading"
  );
});

test("an invalid iPhone heading does not fall through to iOS's relative alpha", () => {
  resetData(app);
  resetHeadingSource(app);

  // iOS alpha is measured from wherever the phone was when the sensor started, not from
  // north, so it is no better than the invalid heading it would be standing in for.
  app.onDeviceOrientation({ webkitCompassHeading: 210, webkitCompassAccuracy: -1, alpha: 90, beta: 20 });

  assert.equal(app.state.compassHeadingSource, app.HEADING_SOURCE_NONE, "nothing usable arrived");
  assert.equal(app.state.compassHeading, null);
  assert.equal(app.state.compassLastEventAt, null, "an invalid heading is not a compass reading");
  assert.ok(
    Number.isFinite(app.state.orientationLastEventAt),
    "the sensor is alive though -- this is what makes recoverStalledCompass ask for the figure-8 rather than thrash listeners"
  );
  assert.equal(app.state.tiltBetaTarget, 20, "beta is unaffected by a bad magnetometer and still drives tilt");
  resetHeadingSource(app);
});

test("a device with only the relative orientation stream still gets a heading", () => {
  resetData(app);
  resetHeadingSource(app);

  app.onDeviceOrientation({ alpha: 270, beta: 10, absolute: false });
  app.onDeviceOrientation({ alpha: 270, beta: 10, absolute: false });
  app.onDeviceOrientation({ alpha: 270, beta: 10, absolute: false });
  app.onDeviceOrientation({ alpha: 270, beta: 10, absolute: false });

  assert.equal(app.state.compassHeadingSource, app.HEADING_SOURCE_RELATIVE);
  assert.equal(app.state.compassHeading, 90, "a drifting heading beats no heading at all");
  resetHeadingSource(app);
});

test("the relative stream is ignored for heading once a north-referenced one has been seen", () => {
  resetData(app);
  resetHeadingSource(app);

  // Chrome on Android fires both events, interleaved, many times a second. Only one of them
  // measures from north; feeding both into the same heading is what made the compass flip
  // between a true bearing and an arbitrary one.
  app.onDeviceOrientation({ alpha: 270, beta: 10, absolute: true }); // heading 90
  app.completeCompassCalibration(90);
  const absoluteEventAt = app.state.compassLastEventAt;

  app.onDeviceOrientation({ alpha: 10, beta: 10, absolute: false }); // would be heading 350

  assert.equal(app.state.compassHeadingTarget, 90, "the drifting stream must not move the target");
  assert.equal(
    app.state.compassLastEventAt,
    absoluteEventAt,
    "staleness is judged on the stream actually in use, so a live relative stream cannot mask a dead absolute one"
  );
  assert.equal(app.state.tiltBetaTarget, 10, "beta is valid on both streams and is still read");
  resetHeadingSource(app);
});

test("upgrading to a north-referenced source discards the heading measured from an arbitrary zero", () => {
  resetData(app);
  resetHeadingSource(app);

  app.onDeviceOrientation({ alpha: 270, beta: 10, absolute: false });
  app.completeCompassCalibration(90);
  assert.equal(app.state.compassHeading, 90);

  app.onDeviceOrientation({ alpha: 180, beta: 10, absolute: true });

  assert.equal(app.state.compassHeadingSource, app.HEADING_SOURCE_ABSOLUTE);
  assert.equal(
    app.state.compassHeading,
    null,
    "the two streams measure from different zeroes, so the old heading is re-gated rather than averaged"
  );
  assert.equal(app.state.renderedNavigationHeading, null, "the map falls back to north-up rather than a wrong rotation");
  assert.equal(
    app.state.compassCalibrationSamples.length,
    1,
    "only the absolute reading that triggered the upgrade survives in the buffer"
  );
  resetHeadingSource(app);
});

// --- Wedged animation loops ---

test("animationLoopsWedged only fires once a requested frame is provably overdue", () => {
  const now = 100000;
  app.state.animationFrame = 7;
  app.state.animationFrameRequestedAt = now - 16;
  assert.equal(app.animationLoopsWedged(now), false, "a frame requested one frame ago is simply pending");

  app.state.animationFrameRequestedAt = now - (app.ANIMATION_FRAME_WEDGED_MS + 1);
  assert.equal(app.animationLoopsWedged(now), true);

  app.state.animationFrame = null;
  app.state.animationFrameRequestedAt = null;
  assert.equal(app.animationLoopsWedged(now), false, "no parked handle, nothing to recover");
});

test("recoverWedgedAnimationFrames releases a loop whose frame never ran, so requestDraw works again", () => {
  resetData(app);
  const now = 200000;
  // The state a dropped frame or a throwing callback leaves behind: the handle is parked, so
  // requestDraw()'s duplicate guard refuses to queue anything, and nothing ever clears it.
  app.state.animationFrame = 42;
  app.state.animationFrameRequestedAt = now - (app.ANIMATION_FRAME_WEDGED_MS + 1);
  app.state.viewportAnimationTo = { scale: 1, tx: 0, ty: 0 };

  assert.equal(app.recoverWedgedAnimationFrames(now), true);

  assert.notEqual(app.state.animationFrame, 42, "the stale handle must not survive -- it is the lock");
  assert.equal(
    app.selectionCameraTransitionActive(),
    false,
    "a stranded viewportAnimationTo keeps alignHeadingUpNavigationViewport bailing on every call"
  );
});

test("recoverWedgedAnimationFrames leaves a healthy loop alone on the watchdog heartbeat", () => {
  resetData(app);
  const now = 300000;
  app.state.animationFrame = 9;
  app.state.animationFrameRequestedAt = now - 8;
  app.state.viewportAnimationFrame = 11;
  app.state.viewportAnimationFrameRequestedAt = now - 8;
  app.state.viewportAnimationTo = { scale: 1, tx: 0, ty: 0 };

  assert.equal(app.recoverWedgedAnimationFrames(now), false);
  assert.equal(app.state.viewportAnimationTo != null, true, "an in-flight camera animation must not be cancelled");

  app.state.animationFrame = null;
  app.state.animationFrameRequestedAt = null;
  app.state.viewportAnimationFrame = null;
  app.state.viewportAnimationFrameRequestedAt = null;
  app.state.viewportAnimationTo = null;
});

// --- Map interaction: tap-to-relocate, group isolation, street navigation ---

// The screen point a tap must land on to hit the pin drawn at `worldPoint`, mirroring
// findHit's own drawPngMapIcon geometry (circle centre sits pinYOffset above the tip).
function pinTapPoint(app, worldPoint) {
  const screen = app.worldToScreen(worldPoint);
  const iconSize = app.MAP_PNG_ICON_SIZE * app.pixelRatio() * app.mapEmojiScale() * app.MAP_ICON_SCALE_UNSELECTED;
  return { x: screen.x, y: screen.y - iconSize * 0.64 };
}

test("tapping open ground inside the walking radius moves the nearby browse origin to that spot", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6505, 0.05) });

  // Well inside the 5 min (~415m) radius -- the old rule ignored these taps entirely and reset
  // the camera instead; every open-ground tap now relocates.
  const lonLat = { latitude: 51.6502, longitude: 0.0502 };
  const handled = app.focusNearbyOnMapPoint(lonLat, app.projectLonLat(lonLat.longitude, lonLat.latitude));

  assert.equal(handled, true);
  assert.equal(app.state.nearbyAnchor.latitude, lonLat.latitude);
  assert.equal(app.state.nearbyAnchor.longitude, lonLat.longitude);
  assert.equal(app.nearbyOrigin().latitude, lonLat.latitude, "the nearby list and radius follow the tapped spot");
  assert.equal(app.state.userLocation.latitude, 51.65, "the real GPS fix is never moved");
});

test("tapping open ground while a location is selected returns to nearby mode anchored on the tapped spot", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const tree = { id: "t1", commonName: "Oak", ...makePoint(app, 51.6505, 0.05) };
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };

  const lonLat = { latitude: 51.6520, longitude: 0.0530 };
  app.focusNearbyOnMapPoint(lonLat, app.projectLonLat(lonLat.longitude, lonLat.latitude));

  assert.equal(app.state.selected, null, "the selection is dropped for nearby mode");
  assert.equal(app.state.nearbyAnchor.latitude, lonLat.latitude, "nearby focuses on the area that was tapped");
  assert.equal(app.els.inspectorTitle.textContent, "Nearby");
});

test("tapping open ground while a group is expanded returns to nearby mode anchored on the tapped spot", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const tree = { id: "t1", commonName: "Oak", ...makePoint(app, 51.6505, 0.05) };
  app.state.trees.push(tree);
  app.state.clusterExpanded = { itemType: "tree", items: [tree], worldPt: tree.point, screenPt: { x: 0, y: 0 } };
  app.state.clusterZoomed = true;

  const lonLat = { latitude: 51.6512, longitude: 0.0521 };
  app.focusNearbyOnMapPoint(lonLat, app.projectLonLat(lonLat.longitude, lonLat.latitude));

  assert.equal(app.state.clusterExpanded, null, "the group detail is dropped for nearby mode");
  assert.equal(app.state.nearbyAnchor.latitude, lonLat.latitude);
  assert.equal(app.els.inspectorTitle.textContent, "Nearby");
});

test("focusNearbyWithinWalkMinutes drops any open selection and browses that exact spot at the fixed radius", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const tree = { id: "t1", commonName: "Oak", ...makePoint(app, 51.6505, 0.05) };
  app.state.trees.push(tree);
  app.state.selected = { type: "tree", item: tree };
  app.state.walkingDistanceMinutes = app.DEFAULT_WALKING_DISTANCE_MINUTES;

  const spot = { latitude: 51.66, longitude: 0.06 };
  app.focusNearbyWithinWalkMinutes(spot.latitude, spot.longitude, app.state.walkingDistanceMinutes);

  assert.equal(app.state.selected, null, "the selection is dropped for the Nearby list");
  assert.equal(app.state.nearbyAnchor.latitude, spot.latitude, "browsing is anchored on the button's own spot, not the selection or GPS fix");
  assert.equal(app.state.nearbyAnchor.longitude, spot.longitude);
  assert.equal(app.state.walkingDistanceMinutes, app.DEFAULT_WALKING_DISTANCE_MINUTES, "the radius is the reader's own walking radius, not a fixed 15");
  assert.ok(app.state.overviewFilters.includes("pubs") && app.state.overviewFilters.includes("national_rail"), "Everything shows every category, not the saved filters");
  assert.equal(app.state.userLocation.latitude, 51.65, "the real GPS fix is never moved");
});

test("openInMapsHtml is an icon-only control with an accessible name", () => {
  const maps = app.openInMapsHtml(51.65, 0.05, "Test");
  assert.match(maps, /class="detail-map-link detail-map-link--icon"[^>]*aria-label="Open in Maps"/);
  assert.match(maps, /<svg /, "the glyph is inline SVG");
  assert.ok(!/>Open in Maps</.test(maps), "no visible text label");
  assert.equal(app.openInMapsHtml(null, null, "Test"), "", "no link without coordinates");
});

test("nearbyWithinWalkHtml renders a Nearby-list-styled card carrying the exact coordinates it should browse, and is empty without coordinates", () => {
  const html = app.nearbyWithinWalkHtml(51.65, 0.05);
  assert.match(html, /<li><button class="nearest-item" type="button" data-action="walk-radius" data-lat="51\.65" data-lon="0\.05">/);
  assert.ok(html.includes(`within ${app.state.walkingDistanceMinutes} min walk`), "copy names the reader's own walking radius, not a fixed 15");
  assert.ok(!html.includes("detail-map-link"), "shares the Nearby list's own card styling, not the unrelated pill");
  assert.equal(app.nearbyWithinWalkHtml(null, null), "", "no card when there are no coordinates to browse from");
});

test("nearbySectionsHtml gives any point its headed Nearest section with the walk-radius card, and is empty without coordinates", () => {
  const html = app.nearbySectionsHtml({ latitude: 51.65, longitude: 0.05, name: "Bald Faced Stag" });
  assert.ok(html.includes('<h3 class="detail-section-heading">Nearest</h3>'));
  assert.ok(html.includes(`within ${app.state.walkingDistanceMinutes} min walk of Bald Faced Stag`));
  assert.ok(!html.includes('detail-section-heading">Related<'), "no Related section without a category to relate to");
  assert.equal(app.nearbySectionsHtml({ latitude: null, longitude: null }), "", "no section when there are no coordinates to browse from");
});

test("tapping a cluster shows exactly that cluster's own members, not every tree the walking-radius floor also reaches", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.64, 0.04);

  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
  const oak3 = { id: "oak3", commonName: "Oak", ...makePoint(app, 51.6500, 0.05002894) };
  // ~15m from the cluster's centre each -- inside the walking-radius floor a tiny 3-tree
  // cluster's own few-metre extent still rounds up to (see focusNearbyOnClusterGroup's own
  // comment), so a plain within-radius scan from the new anchor would have swept all four of
  // these different-species trees in too.
  const beechNorth = { id: "beechN", commonName: "Beech", ...makePoint(app, 51.6501347, 0.0500) };
  const beechEast = { id: "beechE", commonName: "Beech", ...makePoint(app, 51.6500, 0.0502169) };
  const beechSouth = { id: "beechS", commonName: "Beech", ...makePoint(app, 51.6498653, 0.0500) };
  const beechWest = { id: "beechW", commonName: "Beech", ...makePoint(app, 51.6500, 0.0497831) };
  app.state.trees.push(oak1, oak2, oak3, beechNorth, beechEast, beechSouth, beechWest);

  const cluster = { itemType: "tree", items: [oak1, oak2, oak3] };
  const handled = app.focusNearbyOnClusterGroup(cluster);
  assert.equal(handled, true);
  assert.equal(app.state.clusterExpanded, cluster, "the tapped cluster stays the expanded group");

  // Sanity: the ring this tap actually settled on reaches past the 3-tree cluster to where the
  // beeches stand -- otherwise this test would not be exercising the bug it's named for.
  const ringMetres = app.walkingDistanceToMetres(app.state.walkingDistanceMinutes);
  const beechDistance = app.distanceMetres(app.state.nearbyAnchor.latitude, app.state.nearbyAnchor.longitude, beechNorth.latitude, beechNorth.longitude);
  assert.ok(beechDistance < ringMetres, "sanity: the walking ring reaches past the tapped cluster to where the beeches stand");

  // .join, not deepEqual: arrays mapped from the vm sandbox carry the sandbox's Array prototype.
  const ids = app.overviewItemsForActiveFilter().map((entry) => entry.item.id).sort().join(",");
  assert.equal(ids, "oak1,oak2,oak3", "the Nearby list shows exactly the tapped cluster's own members, no more");
});

test("the Nearby list and the map's highlighted pins agree on an expanded cluster's membership", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
  const outsider = { id: "outsider", commonName: "Beech", ...makePoint(app, 51.6501347, 0.0500) };
  app.state.trees.push(oak1, oak2, outsider);

  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);

  const listIds = app.overviewItemsForActiveFilter().map((entry) => entry.item.id).sort().join(",");
  const mapTrees = app.buildNearbyIconLookup().tree;
  assert.equal(listIds, "oak1,oak2", "the list shows exactly the expanded group");
  assert.equal(mapTrees.size, 2, "the map highlights exactly the expanded group");
  assert.ok(mapTrees.has(oak1) && mapTrees.has(oak2) && !mapTrees.has(outsider),
    "the list and the map agree on membership -- same two trees, outsider excluded from both");
});

test("tapping a cluster while already on Nearby actually refreshes the rendered list, not just the underlying data", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
  const outsider = { id: "outsider", commonName: "Beech", ...makePoint(app, 51.6501347, 0.0500) };
  app.state.trees.push(oak1, oak2, outsider);
  app.selectOverview();
  // Sanity: before the tap, the rendered list is the plain, unexpanded view -- the outsider is
  // in it. els.inspectorBody is a hand-rolled test stub with no real HTML parsing
  // (querySelectorAll() always returns []), so the rendered markup is checked as a string.
  const outsiderKey = app.treeHashKey(outsider);
  assert.ok(app.els.inspectorBody.innerHTML.includes(outsiderKey), "sanity: the outsider starts out listed");

  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);

  const rendered = app.els.inspectorBody.innerHTML;
  assert.equal(rendered, app.overviewNearestHtml(),
    "the rendered markup was actually replaced, not left showing whatever was there before the tap");
  assert.ok(rendered.includes(app.treeHashKey(oak1)) && rendered.includes(app.treeHashKey(oak2)),
    "the rendered list includes both tapped trees");
  assert.ok(!rendered.includes(outsiderKey), "the rendered list no longer includes the outsider");
});

test("tapping a cluster behind the Filter screen switches to Nearby to show the expanded group", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
  app.state.trees.push(oak1, oak2);
  app.openFiltersScreen();
  assert.equal(app.state.filterScreenOpen, true, "sanity: the Filter screen is open");

  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);

  assert.equal(app.state.filterScreenOpen, false, "the Filter screen closes for the tap");
  assert.equal(app.els.inspectorTitle.textContent, "Nearby", "Nearby opens to show the expanded group");
});

test("tapping a cluster behind the Settings screen switches to Nearby to show the expanded group", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
  app.state.trees.push(oak1, oak2);
  app.openSettings();
  assert.equal(app.state.selected?.type, "settings", "sanity: Settings is open");

  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);

  assert.equal(app.state.selected, null, "the Settings pseudo-selection clears for the tap");
  assert.equal(app.els.inspectorTitle.textContent, "Nearby", "Nearby opens to show the expanded group");
});

for (const [screenName, open] of [
  ["Filters", (app) => app.openFiltersScreen()],
  ["Settings", (app) => app.openSettings()],
  ["Report", (app) => app.openReportModal()],
  ["Search", (app) => app.openSearchScreen()],
]) {
  test(`opening ${screenName} while a cluster is expanded drops the expanded group and its borrowed radius`, () => {
    resetData(app);
    app.state.userLocation = makePoint(app, 51.65, 0.05);
    const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
    const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
    app.state.trees.push(oak1, oak2);
    const radiusBefore = app.state.walkingDistanceMinutes;

    const cluster = { itemType: "tree", items: [oak1, oak2] };
    app.focusNearbyOnClusterGroup(cluster);
    assert.equal(app.state.clusterExpanded, cluster, "sanity: the tap expanded the group");
    assert.notEqual(app.state.walkingDistanceMinutes, radiusBefore, "sanity: the radius grew to cover the group");

    // Filters/Settings/Report/Search all promise the same fixed, zoomed-out survey view of the
    // walking radius (secondaryScreenActive, spec-data-rendering.md) -- before this, an
    // expanded cluster stayed narrowed to the tapped group's own members behind any of them,
    // and the Settings slider showed the group's borrowed radius as if it were the user's own.
    open(app);
    assert.equal(app.state.clusterExpanded, null, `opening ${screenName} exits the group's exact-membership view`);
    assert.equal(app.state.walkingDistanceMinutes, radiusBefore, `opening ${screenName} also restores the radius the group tap grew`);
  });
}

test("the browser back button drops an expanded cluster, not just the anchor it moved", () => {
  resetData(app);
  resetRouter(app);
  app.setupSearchAndNavHandlers();
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
  app.state.trees.push(oak1, oak2);

  const radiusBefore = app.state.walkingDistanceMinutes;
  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);
  assert.equal(app.state.clusterExpanded, cluster, "sanity: the tap expanded the group");
  assert.notEqual(app.state.walkingDistanceMinutes, radiusBefore, "sanity: the radius grew to cover the group");

  // history.state has no room for a live cluster-item reference (pushNearbyAnchorHistory only
  // snapshots the anchor's lat/lon), so a stale state.clusterExpanded left set after the anchor
  // moves back would narrow the map/list to a group unrelated to where the ring now sits.
  app.history.back();
  assert.equal(app.state.clusterExpanded, null, "going back drops the expanded group, not just the anchor it moved");
  assert.equal(app.state.walkingDistanceMinutes, radiusBefore, "going back also restores the radius the group tap grew, not just the anchor");
});

test("resizing the walking radius drops an expanded cluster", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
  app.state.trees.push(oak1, oak2);

  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);
  assert.equal(app.state.clusterExpanded, cluster, "sanity: the tap expanded the group");

  app.applyWalkingRadiusChange(10, { animate: false });
  assert.equal(app.state.clusterExpanded, null, "dragging the radius to a size of its own choosing exits the group's exact-membership view");
  assert.equal(app.state.walkingDistanceMinutes, 10, "the radius the user just chose wins over the group's own, stashed one");
});

test("pinching/wheeling the walking radius also drops an expanded cluster", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
  app.state.trees.push(oak1, oak2);

  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);
  assert.equal(app.state.clusterExpanded, cluster, "sanity: the tap expanded the group");

  // applyWalkingRadiusGesture is the continuous pinch/wheel path -- a separate function from
  // applyWalkingRadiusChange (the Settings slider), and one that used to leave clusterExpanded
  // set: the gesture changed state.walkingDistanceMinutes on every move, but
  // nearbyCameraFitPoints/overviewItemsForActiveFilter kept fitting and listing the tapped
  // group's own members regardless, since nothing in this path ever cleared it -- the camera
  // and list silently stopped tracking the gesture.
  app.applyWalkingRadiusGesture(10);
  assert.equal(app.state.clusterExpanded, null, "a radius gesture of the user's own choosing exits the group's exact-membership view too");
  assert.equal(app.state.walkingDistanceMinutes, 10, "the gesture's own radius wins over the group's stashed one");
});

test("tapping a nearby cluster pans to it at today's zoom, then zooms in -- two tweens, not one", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  // A couple of hundred metres from the user's own location -- on screen at the walking-radius
  // framing the camera already has, but not so coincident with its current pivot that the pan
  // leg below is a zero-distance no-op (animateViewportTo's own near-identical-target snap,
  // which would resolve synchronously and skip straight to the chained zoom leg).
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6520, 0.0510) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65201797, 0.0510) };
  app.state.trees.push(oak1, oak2);
  app.selectOverview();
  app.ensureOverviewTargetsVisible({ animate: false, force: true });
  const scaleBeforeTap = app.state.viewport.scale;

  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);

  // The group is a couple of metres from the user's own location -- already on screen -- so
  // this should be the staged pan-then-zoom (alignHeadingUpNavigationViewport's
  // stagePanThenZoom branch, js/app.js): a short pan at *today's* scale first, not the single
  // combined ease. The first (and, synchronously, only observable) leg is the pan: same scale
  // as before the tap, over 40% of NEARBY_ORIGIN_TRANSITION_MS (520ms) -- its chained zoom leg
  // only starts once that pan's own animation frame loop completes.
  assert.ok(app.state.viewportAnimationTo, "the tap should start a camera animation");
  assert.equal(app.state.viewportAnimationDuration, 208, "the first leg is the 40%-of-520ms pan, not the full duration");
  assert.equal(app.state.viewportAnimationTo.scale, scaleBeforeTap, "the pan leg holds the scale the camera already had");
});

test("tapping a cluster far outside the current view skips staging -- one direct ease instead", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  // A tight, arbitrary "current" framing -- standing in for having just zoomed in on some
  // other, unrelated spot -- paired with a cluster many kilometres away. Panning that whole
  // distance at this scale, in the short pan leg above, would cover many screens' worth of
  // pixels in a couple hundred milliseconds: a fast, disorienting slide, not the gentle
  // repositioning stagePanThenZoom exists for (see its own comment, js/app.js, on why this is
  // exactly the "mega badge across the ring" case the old three-phase tour was abandoned over).
  app.state.viewport = { scale: 500000, tx: 0, ty: 0 };
  app.state.nearbyAnchor = { latitude: 51.65, longitude: 0.05, point: app.projectLonLat(0.05, 51.65) };
  const far1 = { id: "far1", commonName: "Oak", ...makePoint(app, 51.75, 0.15) };
  const far2 = { id: "far2", commonName: "Oak", ...makePoint(app, 51.75001797, 0.15) };
  app.state.trees.push(far1, far2);

  const cluster = { itemType: "tree", items: [far1, far2] };
  app.focusNearbyOnClusterGroup(cluster);

  assert.ok(app.state.viewportAnimationTo, "the tap should still start a camera animation");
  assert.equal(app.state.viewportAnimationDuration, 520, "a far jump falls back to the single, full-duration ease (NEARBY_ORIGIN_TRANSITION_MS)");
  assert.notEqual(app.state.viewportAnimationTo.scale, 500000, "a single ease targets the group's own fit scale directly, not today's scale");
});

test("dismissing the anchor bar drops an expanded cluster", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const oak1 = { id: "oak1", commonName: "Oak", ...makePoint(app, 51.6500, 0.0500) };
  const oak2 = { id: "oak2", commonName: "Oak", ...makePoint(app, 51.65001797, 0.0500) };
  app.state.trees.push(oak1, oak2);

  const radiusBefore = app.state.walkingDistanceMinutes;
  const cluster = { itemType: "tree", items: [oak1, oak2] };
  app.focusNearbyOnClusterGroup(cluster);
  assert.equal(app.state.clusterExpanded, cluster, "sanity: the tap expanded the group");

  app.clearNearbyAnchor();
  assert.equal(app.state.clusterExpanded, null, "returning to GPS-based browsing exits the group's exact-membership view too");
  assert.equal(app.state.walkingDistanceMinutes, radiusBefore, "and restores the radius the group tap grew");
});

test("moving the nearby browse anchor reframes the same view instead of zooming out", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6503, 0.05) });
  app.selectOverview();
  app.ensureOverviewTargetsVisible({ animate: false, force: true });

  const baseScale = app.state.viewport.scale;
  const baseOriginScreen = app.worldToScreen(app.nearbyOrigin().point);

  // The scale fit used to measure its points from the real GPS fix while the camera anchored
  // nearbyOrigin(), so an off-centre ring collapsed the zoom -- and every further relocation
  // collapsed it again, walking the Nearby view out to whole-forest scale a tap at a time.
  const relocate = (latitude, longitude) => {
    app.state.nearbyAnchor = { latitude, longitude, point: app.projectLonLat(longitude, latitude) };
    // Assigning the anchor directly skips setNearbyAnchor, so nothing has invalidated the
    // per-frame render-origin freeze; prepareCanvasForDraw is the frame boundary that does.
    app.prepareCanvasForDraw();
    app.ensureOverviewTargetsVisible({ animate: false, force: true });
    return { scale: app.state.viewport.scale, originScreen: app.worldToScreen(app.nearbyOrigin().point) };
  };

  for (const [latitude, longitude] of [[51.66, 0.07], [51.64, 0.02], [51.67, 0.09]]) {
    const after = relocate(latitude, longitude);
    const label = `anchor at ${latitude},${longitude}`;
    assert.ok(
      Math.abs(after.scale - baseScale) / baseScale < 0.01,
      `${label}: the nearest area should stay framed the same size, got ${after.scale} vs ${baseScale}`
    );
    assert.ok(Math.abs(after.originScreen.x - baseOriginScreen.x) < 1, `${label}: origin should sit at the same screen point`);
    assert.ok(Math.abs(after.originScreen.y - baseOriginScreen.y) < 1, `${label}: origin should sit at the same screen point`);
  }
});

// Puts the app in full 3D nearby mode with a handful of trees to fit against, the way the
// Nearby screen sits when the phone is held up.
function enterNearby3D(app) {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.trees.push(
    { id: "t1", commonName: "Oak", ...makePoint(app, 51.6653, 0.045) },
    { id: "t2", commonName: "Beech", ...makePoint(app, 51.6648, 0.0455) }
  );
  app.state.compassHeading = 20;
  app.state.compassHeadingTarget = 20;
  app.state.renderedNavigationHeading = 20;
  app.state.tiltBetaSmoothed = 60;
  app.state.tiltBetaTarget = 60;
  app.selectOverview();
  assert.equal(app.tiltActive(), true, "sanity: these settings should put the app in full 3D");
}

// Runs a browse-origin slide out to its settled end, the way prepareCanvasForDraw does frame by
// frame in the app: the camera work stops when the slide lands, and the transition object itself
// is cleared once the reveal fade behind it has finished too.
function settleNearbySlide(app) {
  const transition = app.state.nearbyOriginTransition;
  if (!transition) return;
  transition.startedAt -= transition.durationMs + app.NEARBY_REVEAL_MS + 1;
  app.prepareCanvasForDraw();
  app.stopViewportAnimation();
}

function ringPointsInsideMapArea(app) {
  app.stopViewportAnimation();
  // prepareCanvasForDraw is what clears the per-frame tilt-camera cache, so it has to run both
  // before the fit (which reads the projection) and after it (the new scale moves the pivot) --
  // otherwise the points are measured through the previous frame's perspective.
  app.prepareCanvasForDraw();
  app.ensureOverviewTargetsVisible({ animate: false, force: true });
  app.stopViewportAnimation();
  app.prepareCanvasForDraw();
  const rect = app.bestVisibleCanvasRect({ assumeInspectorOpen: true });
  const points = app.walkingRadiusCirclePoints(64).map((point) => app.worldToScreen(point));
  const inside = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= rect.x && p.x <= rect.x + rect.width
    && p.y >= rect.y && p.y <= rect.y + rect.height);
  return { inside: inside.length, total: points.length, scale: app.state.viewport.scale };
}

test("in 3D, browsing another spot keeps the whole walking radius inside the available map area", () => {
  enterNearby3D(app);

  // First person: the ring's behind half is deliberately allowed off the bottom edge, the way
  // the ground behind you is in any first-person view -- forcing it on screen is what used to
  // collapse the 3D zoom.
  const firstPerson = ringPointsInsideMapArea(app);
  assert.ok(firstPerson.inside < firstPerson.total, "sanity: first-person 3D does not frame the whole ring");

  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  // Once the slide has landed. Mid-slide the framing is deliberately still partway between the
  // two pivots (see maxNearbyHeadingUpScale), so the whole-ring rule is the settled view's.
  settleNearbySlide(app);
  const browsing = ringPointsInsideMapArea(app);

  assert.equal(browsing.inside, browsing.total, "every point of the ring must be in the map area while browsing");
});

// Runs fn with the app's performance.now() frozen at the value it has right now, so a helper
// that walks an animation frame by frame measures the frames it asked for rather than those
// plus however long the walk itself took. Frozen at the *current* value, never advanced past
// it: the app stamps timestamps into state from this clock, and one left in the real clock's
// future hands a later test a negative frame gap (see easeScaleFrames' comment above for what
// that does to the suite).
function withFrozenAppClock(app, fn) {
  const clock = app.performance;
  const realNow = clock.now;
  const frozen = realNow.call(clock);
  clock.now = () => frozen;
  try {
    return fn();
  } finally {
    clock.now = realNow;
  }
}

// Walks a browse-origin slide frame by frame the way the app does and returns the largest
// single-frame zoom step, as a ratio >= 1. An eased zoom moves by a few percent per frame; a
// camera that re-solves into a different framing mid-slide shows up here as a step of several
// times, which is what a jump looks like on screen.
//
// The frozen clock is what makes the walk measure the slide rather than the machine. Each
// iteration used to shift startedAt back by one frame's worth while the real clock kept
// running underneath, so a frame's *effective* step was 16.67ms plus however long that
// iteration took -- a few milliseconds on an idle box, tens of milliseconds on a loaded one.
// The steepest part of the ease steps ~1.12x at true 60fps spacing, so stretching the spacing
// half as much again pushed it past the 1.2x bound and failed the assertion: this test went
// red roughly one run in five whenever the machine was busy, always on load rather than on
// anything the app did.
//
// The compass is silenced for the same reason. With a live sensor timestamp
// resolveHeadingUpTargetScale eases the scale on its own clock on top of the slide's, and
// whether one is live here depends on what the previous test happened to leave behind --
// while the easing this test is about is the slide's blend (maxNearbyHeadingUpScale), which
// applies straight to the viewport when the sensor is quiet.
function worstSlideZoomStep(app) {
  const transition = app.state.nearbyOriginTransition;
  const { durationMs } = transition;
  const frames = Math.round(durationMs / 16.67); // one 60fps frame
  const savedCompassLastEventAt = app.state.compassLastEventAt;
  app.state.compassLastEventAt = null;
  let previous = app.state.viewport.scale;
  let worst = 1;
  try {
    withFrozenAppClock(app, () => {
      const now = app.performance.now();
      for (let frame = 0; frame <= frames; frame++) {
        transition.startedAt = now - (durationMs * frame) / frames;
        app.prepareCanvasForDraw();
        app.stopViewportAnimation();
        const scale = app.state.viewport.scale;
        worst = Math.max(worst, scale / previous, previous / scale);
        previous = scale;
      }
    });
  } finally {
    app.state.compassLastEventAt = savedCompassLastEventAt;
  }
  return worst;
}

test("in 3D, moving the nearby point eases the zoom across the whole slide instead of jumping on the first frame", () => {
  enterNearby3D(app);
  app.prepareCanvasForDraw();
  app.ensureOverviewTargetsVisible({ animate: false, force: true });
  app.stopViewportAnimation();
  app.prepareCanvasForDraw();
  const firstPersonScale = app.state.viewport.scale;

  const anchor = makePoint(app, 51.6605, 0.0335);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  // The first frame of the slide still shows what was on screen when the tap landed: the pivot
  // has not moved yet, so the framing must not have either. Setting the anchor used to switch
  // the fit to the browse rule (the whole ring, behind half included) a whole slide before the
  // pivot moved to the centre where that rule makes sense, zooming the map out several-fold on
  // one frame and creeping back in afterwards.
  app.prepareCanvasForDraw();
  app.stopViewportAnimation();
  assert.ok(
    Math.abs(app.state.viewport.scale / firstPersonScale - 1) < 0.02,
    `the first frame should still be framed as it was, got ${app.state.viewport.scale} from ${firstPersonScale}`
  );

  const worst = worstSlideZoomStep(app);
  assert.ok(worst < 1.2, `no frame should jump the zoom, worst step was ${worst.toFixed(2)}x`);

  settleNearbySlide(app);
  const browsingScale = app.state.viewport.scale;
  assert.ok(
    browsingScale < firstPersonScale * 0.9,
    "sanity: the browse view really is framed wider than the first-person one, so the slide had a zoom to ease"
  );
});

test("in 3D, returning to your own position eases the zoom back the same way", () => {
  enterNearby3D(app);
  const anchor = makePoint(app, 51.6605, 0.0335);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  settleNearbySlide(app);
  app.prepareCanvasForDraw();
  const browsingScale = app.state.viewport.scale;

  app.clearNearbyAnchor();
  const worst = worstSlideZoomStep(app);
  assert.ok(worst < 1.2, `no frame should jump the zoom, worst step was ${worst.toFixed(2)}x`);
  assert.ok(
    app.state.viewport.scale > browsingScale * 1.1,
    "sanity: it ends back on the tighter first-person framing"
  );
});

test("3D hides what is behind you only while you are the pivot, not while browsing a spot", () => {
  enterNearby3D(app);
  const user = app.state.userLocation.point;
  const radius = app.walkingRadiusWorldUnits();
  // Due south of the origin: behind the heading (20 degrees, roughly north-east).
  const behindUser = { x: user.x, y: user.y + radius * 0.8 };

  assert.equal(app.tiltHidesWhatIsBehind(), true);
  assert.equal(app.isBehindTiltHeading(behindUser), true, "content behind you is culled in first-person 3D");
  assert.ok(app.tiltPinScale(behindUser) < 1, "and its pins are collapsed");

  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  const behindAnchor = { x: anchor.point.x, y: anchor.point.y + radius * 0.8 };

  assert.equal(app.tiltHidesWhatIsBehind(), false);
  assert.equal(app.isBehindTiltHeading(behindAnchor), false, "a browsed spot has no behind-you half to hide");
  assert.equal(app.tiltPinScale(behindAnchor), 1, "so its pins stay full size");
});

test("the camera origin, the scale fit and the 3D projection all pivot on the same point", () => {
  enterNearby3D(app);
  assert.equal(app.cameraOriginPoint(), app.state.userLocation.point, "no anchor: the camera is on the GPS fix");

  const startedFrom = app.state.userLocation.point;
  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);

  // Mid-slide the camera is on the interpolated origin, not the destination -- that is what
  // holds the circle still on screen while the map moves (see nearbyRenderOriginPoint).
  const midSlide = app.cameraOriginPoint();
  assert.notEqual(midSlide, anchor.point, "mid-slide the camera has not jumped to the new anchor");
  assert.ok(
    midSlide.x >= Math.min(startedFrom.x, anchor.point.x) && midSlide.x <= Math.max(startedFrom.x, anchor.point.x),
    "and it is somewhere between the old origin and the new one"
  );

  app.state.nearbyOriginTransition = null;
  app.prepareCanvasForDraw();
  app.ensureOverviewTargetsVisible({ animate: false, force: true });
  app.prepareCanvasForDraw();

  assert.equal(app.cameraOriginPoint(), app.state.nearbyAnchor.point, "settled: the camera is on the anchor");
  const projection = app.tiltProjection();
  const anchorRaw = app.rawWorldToScreen(app.state.nearbyAnchor.point);
  assert.ok(Math.abs(projection.originX - anchorRaw.x) < 0.001, "the 3D projection pivots on the anchor too");
  assert.ok(Math.abs(projection.originY - anchorRaw.y) < 0.001, "the 3D projection pivots on the anchor too");
});

test("selecting an item while browsing a distant anchor slides the camera origin to the GPS fix instead of jumping to it", () => {
  // The bug this covers: cameraOriginPoint() switches outright from the browsed anchor to the
  // real GPS fix the instant a selection is made (selectedNavigationHeadingUpActive() flips),
  // with no slide of its own -- unlike a plain anchor-to-anchor move, which nearbyRenderOriginPoint
  // already smooths. Reported as "very jumpy" selecting an item while browsing a nearby area that
  // is not nearby, since that is exactly when the two points sit furthest apart.
  enterNearby3D(app);
  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  settleNearbySlide(app);
  assert.equal(app.cameraOriginPoint(), app.state.nearbyAnchor.point, "sanity: settled on the browsed anchor");

  const userPoint = app.state.userLocation.point;
  // Mirrors the real sequence (handleMapClick/focusOverviewItem/openSearchResult): capture the
  // pivot, then flip the basis by selecting something with a real compass target.
  app.startCameraOriginTransition();
  app.state.selected = { type: "tree", item: app.state.trees[0] };

  const midSlide = app.cameraOriginPoint();
  assert.notEqual(midSlide, userPoint, "selecting does not jump the pivot to the GPS fix on the same frame");
  assert.notEqual(midSlide, anchor.point, "nor does it stay frozen on the old anchor");
  assert.ok(
    midSlide.x >= Math.min(anchor.point.x, userPoint.x) - 1e-6 && midSlide.x <= Math.max(anchor.point.x, userPoint.x) + 1e-6,
    "and it is somewhere between the browsed anchor and the real GPS fix"
  );

  app.state.cameraOriginTransition.startedAt -= app.state.cameraOriginTransition.durationMs + 1;
  assert.equal(app.cameraOriginPoint(), userPoint, "settled: the camera is back on the real GPS fix, as selected navigation requires");
});

test("selection entry points capture the browse pivot before clearing the anchor", async () => {
  enterNearby3D(app);
  const tree = {
    ...app.state.trees[0],
    recordNumber: 1,
    location: { britishNationalGrid: {} },
  };
  app.state.trees[0] = tree;
  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  settleNearbySlide(app);

  const nearbyScale = app.state.viewport.scale;
  const outgoingIconLookup = app.activeIconLookup();
  app.focusOverviewItem("tree", "r1");
  assert.equal(app.state.nearbyAnchor, null, "selection should still clear the browse anchor");
  assert.equal(app.state.selectionMapTransitionActive, true,
    "the outgoing Nearby map should remain visible during selection");
  assert.ok(app.activeIconLookup().tree.size > 0,
    "Nearby pins should remain available during the handoff");
  assert.equal(app.activeIconLookup(), outgoingIconLookup,
    "the handoff should retain the outgoing Nearby pins, not rebuild a new set around the user");
  assert.ok(app.state.cameraOriginTransition, "selection should animate the camera pivot basis change");
  assert.ok(
    Math.abs(app.state.cameraOriginTransition.fromX - anchor.point.x) < 1e-9
      && Math.abs(app.state.cameraOriginTransition.fromY - anchor.point.y) < 1e-9,
    "the pivot transition must start at the browsed anchor, not the GPS fix"
  );

  // Let the inspector-deferred selection fit finish before the next test resets shared state.
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.ok(
    app.state.viewport.scale > nearbyScale,
    `selecting a Nearby location should zoom in after the inspector transition (current=${app.state.viewport.scale}, target=${app.state.viewportAnimationTo?.scale})`
  );
  app.stopViewportAnimation();
});

// Records the path each draw walks, so a marker's actual drawn geometry can be asserted rather
// than just the numbers that feed it.
function recordingCtx() {
  const noop = () => {};
  const moves = [];
  return {
    moves,
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo(x, y) { moves.push({ x, y }); },
    lineTo: noop, arc: noop, fill: noop, stroke: noop, setLineDash: noop,
    fillText: noop, strokeText: noop,
    createRadialGradient() { return { addColorStop: noop }; },
    createLinearGradient() { return { addColorStop: noop }; },
    measureText(text) { return { width: String(text).length * 8 }; },
  };
}

test("moving the nearby point holds the circle still on screen and slides the map behind it", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6653, 0.045) });
  app.selectOverview();
  app.ensureOverviewTargetsVisible({ animate: false, force: true });
  app.stopViewportAnimation();

  const circleCentreOnScreen = () => {
    app.prepareCanvasForDraw();
    return app.worldToScreenFlat(app.nearbyRenderOriginPoint());
  };
  const before = circleCentreOnScreen();
  const mapPointOnScreen = () => app.worldToScreenFlat(app.state.trees[0].point);
  const mapBefore = mapPointOnScreen();

  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);

  // One frame in: the circle has not moved on screen, but the map underneath it has. Animating
  // the camera instead would do the opposite -- snap the circle to the tapped point and drag it
  // back across the screen.
  assert.equal(app.nearbyOriginTransitionActive(), true, "the slide should be running");
  const during = circleCentreOnScreen();
  assert.ok(Math.abs(during.x - before.x) < 1, `circle should hold its screen x, moved ${during.x - before.x}`);
  assert.ok(Math.abs(during.y - before.y) < 1, `circle should hold its screen y, moved ${during.y - before.y}`);

  // Let the slide run out the way it does in the app -- prepareCanvasForDraw is what notices it
  // has finished, applies the final camera and clears it -- rather than dropping the transition
  // from under it, which would leave the camera one frame behind the origin. The transition
  // object lives on through the reveal fade, so age it past that too.
  app.state.nearbyOriginTransition.startedAt -= app.state.nearbyOriginTransition.durationMs + app.NEARBY_REVEAL_MS + 1;
  const after = circleCentreOnScreen();
  assert.equal(app.state.nearbyOriginTransition, null, "the slide clears itself when it lands");
  const mapAfter = mapPointOnScreen();
  assert.ok(Math.abs(after.x - before.x) < 1, "the circle ends where it started on screen");
  assert.ok(Math.abs(after.y - before.y) < 1, "the circle ends where it started on screen");
  assert.ok(
    Math.hypot(mapAfter.x - mapBefore.x, mapAfter.y - mapBefore.y) > 10,
    "the map behind it has moved"
  );
});

test("the new nearby set is held back until the map has finished moving, then fades in", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6653, 0.045) });
  app.selectOverview();
  assert.equal(app.nearbyRevealOpacity(), 1, "settled, the nearby set is fully drawn");

  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  const transition = app.state.nearbyOriginTransition;

  assert.equal(app.nearbyRevealOpacity(), 0, "nothing of the new set is drawn while the map moves");
  transition.startedAt -= transition.durationMs / 2;
  assert.equal(app.nearbyRevealOpacity(), 0, "still nothing mid-slide");

  // Landed: the fade starts from here rather than the set snapping on.
  transition.startedAt -= transition.durationMs / 2 + 1;
  const justLanded = app.nearbyRevealOpacity();
  assert.ok(justLanded >= 0 && justLanded < 0.2, `the fade starts from nothing, got ${justLanded}`);

  transition.startedAt -= app.NEARBY_REVEAL_MS / 2;
  const midFade = app.nearbyRevealOpacity();
  assert.ok(midFade > justLanded && midFade < 1, `mid-fade should be partway, got ${midFade}`);

  transition.startedAt -= app.NEARBY_REVEAL_MS;
  assert.equal(app.nearbyRevealOpacity(), 1, "and it ends fully drawn");
  // The transition object has to outlive the slide itself, or the fade would have no frames.
  assert.equal(app.nearbyRevealInProgress(), false);
});

test("relocating again mid-slide continues from what is on screen", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6653, 0.045) });
  app.selectOverview();

  const first = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(first.latitude, first.longitude, first.point);
  const midSlide = app.nearbyRenderOriginPoint();

  const second = makePoint(app, 51.658, 0.028);
  app.setNearbyAnchor(second.latitude, second.longitude, second.point);
  const restarted = app.nearbyRenderOriginPoint();

  assert.ok(
    Math.hypot(restarted.x - midSlide.x, restarted.y - midSlide.y) < 0.000001,
    "the second slide picks up from where the first had got to, not from where it began"
  );
});

test("in 3D the pivot eases across a slide instead of popping, and holds still browse-to-browse", () => {
  enterNearby3D(app);
  app.prepareCanvasForDraw();
  const firstPerson = app.nearbyHeadingUpFocusY();
  assert.ok(firstPerson > 0.7, `sanity: the first-person pivot sits low on screen, got ${firstPerson}`);

  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  app.prepareCanvasForDraw();
  // Not exact: a fraction of a millisecond of real time has already elapsed, so the ease has
  // begun. What matters is that it starts *from* the first-person pivot rather than at the
  // destination.
  assert.ok(
    Math.abs(app.nearbyHeadingUpFocusY() - firstPerson) < 0.001,
    "the slide starts from the first-person pivot"
  );

  // Halfway through, the pivot is partway between the two rather than already at its
  // destination -- that is the difference between easing and popping.
  app.state.nearbyOriginTransition.startedAt -= app.state.nearbyOriginTransition.durationMs / 2;
  app.prepareCanvasForDraw();
  const midway = app.nearbyHeadingUpFocusY();
  assert.ok(
    midway < firstPerson && midway > 0.5,
    `mid-slide the pivot should sit between the two, got ${midway} between ${firstPerson} and 0.5`
  );

  app.state.nearbyOriginTransition.startedAt -= app.state.nearbyOriginTransition.durationMs + 1;
  app.prepareCanvasForDraw();
  assert.equal(app.nearbyHeadingUpFocusY(), 0.5, "settled on a browsed spot the pivot is centred");

  // Hopping to another browsed spot must not re-ramp: both ends of that slide are the centred
  // pivot, so the view should not dip toward the first-person anchor and come back.
  const next = makePoint(app, 51.658, 0.028);
  app.setNearbyAnchor(next.latitude, next.longitude, next.point);
  app.prepareCanvasForDraw();
  assert.equal(app.nearbyHeadingUpFocusY(), 0.5, "browse-to-browse keeps the centred pivot throughout");
});

test("in 3D the nearby zoom eases across a browse slide instead of switching framings", () => {
  // The first-person camera frames past the walking radius (NEARBY_TILT_FIT_ZOOM) while a
  // browsed spot frames the whole area around it, so the two ends of a slide now sit further
  // apart in zoom than they used to. The scale has to travel between them on the slide's own
  // easing: solving either end outright on the frame the tap lands is the "it jumps instead of
  // sliding" report, and it is the only thing the e2e frame sampling cannot see for itself.
  enterNearby3D(app);
  app.prepareCanvasForDraw();
  const focusRect = app.bestVisibleCanvasRect();
  const firstPersonScale = app.maxNearbyHeadingUpScale(app.nearbyNavigationFocusPoint(focusRect), focusRect);

  const anchorPoint = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchorPoint.latitude, anchorPoint.longitude, anchorPoint.point);
  app.prepareCanvasForDraw();
  const started = app.maxNearbyHeadingUpScale(app.nearbyNavigationFocusPoint(focusRect), focusRect);
  assert.ok(
    Math.abs(started - firstPersonScale) < firstPersonScale * 0.01,
    `the slide starts from the first-person framing (${started} vs ${firstPersonScale})`
  );

  app.state.nearbyOriginTransition.startedAt -= app.state.nearbyOriginTransition.durationMs / 2;
  app.prepareCanvasForDraw();
  const midway = app.maxNearbyHeadingUpScale(app.nearbyNavigationFocusPoint(focusRect), focusRect);

  app.state.nearbyOriginTransition.startedAt -= app.state.nearbyOriginTransition.durationMs + 1;
  app.prepareCanvasForDraw();
  const landed = app.maxNearbyHeadingUpScale(app.nearbyNavigationFocusPoint(focusRect), focusRect);

  assert.ok(landed < firstPersonScale, `sanity: the browse framing is the wider of the two (${landed} vs ${firstPersonScale})`);
  assert.ok(
    midway < started && midway > landed,
    `mid-slide the zoom sits between the two framings, got ${midway} between ${started} and ${landed}`
  );
});

test("the radar cone stays on the user dot while browsing another spot in 3D", () => {
  enterNearby3D(app);
  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  // Settle the browse-origin slide: this is about where the cone is drawn once the view has
  // arrived, not about the transition into it.
  app.state.nearbyOriginTransition = null;
  app.stopViewportAnimation();
  app.prepareCanvasForDraw();
  app.ensureOverviewTargetsVisible({ animate: false, force: true });
  app.stopViewportAnimation();
  app.prepareCanvasForDraw();
  app.state.userInMapArea = true;

  const drawnDot = app.worldToScreenForOverlayTilted(app.state.userLocation.point);
  // The heading rotation pivots on the camera origin, so the user's *raw* position is no longer
  // where they are drawn -- reading it (as the radar used to) detached the cone from the dot.
  const raw = app.rawWorldToScreen(app.state.userLocation.point);
  const rawApex = app.projectCanvasPoint(raw.x, raw.y);
  assert.ok(
    Math.hypot(rawApex.x - drawnDot.x, rawApex.y - drawnDot.y) > 1,
    "sanity: the raw position and the drawn position differ while browsing"
  );

  const ctx = recordingCtx();
  app.drawUserRadarOverlayTilted(ctx);
  const apex = ctx.moves[0];

  assert.ok(apex, "the radar cone should have been drawn");
  assert.ok(Math.abs(apex.x - drawnDot.x) < 0.001, "the cone's apex sits on the user dot");
  assert.ok(Math.abs(apex.y - drawnDot.y) < 0.001, "the cone's apex sits on the user dot");
});

// Geometry drawWalkingRadius works out before handing off to the cone, recreated here so the
// cone can be exercised without a full canvas-filter-capable context stub.
function nearbyRingScreenGeometry(app) {
  app.prepareCanvasForDraw();
  const origin = app.nearbyRenderOriginPoint();
  const center = app.worldToScreenFlat(origin);
  const edge = app.worldToScreenFlat({ x: origin.x + app.walkingRadiusWorldUnits(), y: origin.y });
  return { center, radiusPx: Math.max(8, Math.hypot(edge.x - center.x, edge.y - center.y)) };
}

function coneShape(app) {
  const { center, radiusPx } = nearbyRingScreenGeometry(app);
  return app.nearbyUserCone(center, radiusPx, false);
}

test("the cone to the nearby circle is drawn only while browsing a spot the user stands outside of", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.userInMapArea = true;
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6653, 0.045) });

  assert.equal(coneShape(app), null, "no anchor: the You dot is the circle's own centre");

  // Inside the ring the dot is already in the circle, so there is nothing for a cone to bridge.
  const near = makePoint(app, 51.6652, 0.0452);
  app.setNearbyAnchor(near.latitude, near.longitude, near.point);
  app.state.nearbyOriginTransition = null;
  assert.equal(coneShape(app), null, "no cone while the user is inside the ring");

  const far = makePoint(app, 51.64, 0.02);
  app.setNearbyAnchor(far.latitude, far.longitude, far.point);
  app.state.nearbyOriginTransition = null;
  const { center, radiusPx } = nearbyRingScreenGeometry(app);
  const cone = coneShape(app);
  assert.ok(cone && cone.length > 2, "browsing a distant spot builds the cone back to the user");

  // Apex on the user, far edge on the circle: the wedge bridges exactly the gap between them.
  const apex = cone[0];
  const user = app.worldToScreenFlat(app.state.userLocation.point);
  assert.ok(Math.hypot(apex.x - user.x, apex.y - user.y) < 0.001, "the wedge starts at the You dot");
  for (const point of cone.slice(1)) {
    const offRing = Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radiusPx);
    assert.ok(offRing < 0.001, "and every other corner sits on the ring itself");
  }
});

test("the way back from a browsed spot stays on screen across Nearby, Filters, Settings and Report", () => {
  // The "Use my location" control used to be part of the Nearby list's HTML, so opening any of
  // the three secondary screens -- all of which keep drawing the walking-radius circle around
  // the browsed spot behind them -- left the user with no way to undo the browse.
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  const bar = app.els.nearbyAnchorBar;
  assert.ok(bar, "the bar lives in the inspector chrome, not in a screen's body");

  app.updateNearbyAnchorBar();
  assert.equal(bar.hidden, true, "nothing to undo while the view is centred on the real fix");

  const far = makePoint(app, 51.64, 0.02);
  app.setNearbyAnchor(far.latitude, far.longitude, far.point);
  assert.equal(bar.hidden, false, "browsing a spot offers the way back on the Nearby screen");

  for (const selected of [null, { type: "settings", item: null }, { type: "report", item: null }]) {
    app.state.filterScreenOpen = selected === null;
    app.state.selected = selected;
    app.updateNearbyAnchorBar();
    assert.equal(bar.hidden, false, "and on every screen that still draws the circle behind it");
  }

  app.state.filterScreenOpen = false;
  app.state.selected = { type: "tree", item: { ...makePoint(app, 51.6653, 0.045) } };
  app.updateNearbyAnchorBar();
  assert.equal(bar.hidden, true, "a real selection replaces the whole view, bar included");
});

test("the nearby list reads from the browsed spot on the Filters screen too, not the GPS fix", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.overviewFilters = ["trees"];
  const byUser = { id: "by-user", commonName: "Oak", ...makePoint(app, 51.6651, 0.045) };
  const byAnchor = { id: "by-anchor", commonName: "Beech", ...makePoint(app, 51.6401, 0.02) };
  app.state.trees.push(byUser, byAnchor);

  const far = makePoint(app, 51.64, 0.02);
  app.setNearbyAnchor(far.latitude, far.longitude, far.point);
  app.state.filterScreenOpen = true;

  const ids = app.overviewItemsForActiveFilter().map((entry) => entry.item.id);
  assert.ok(ids.includes("by-anchor"), "the ring and the matches inside it share one origin");
  assert.ok(!ids.includes("by-user"), "the distant GPS fix is no longer what the list scans from");
  app.state.filterScreenOpen = false;
});

test("no off-ring arrow is drawn once the browse anchor moves away from the user", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.trees.push({ id: "t1", recordNumber: 1, commonName: "Oak", ...makePoint(app, 51.6653, 0.045) });
  const anchor = makePoint(app, 51.66, 0.033);
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  app.state.nearbyOriginTransition = null; // settle the browse-origin slide
  app.prepareCanvasForDraw();

  // The amber anchor marker, the dimmed ring and the anchor bar already say the Nearby view
  // has pivoted away from the real GPS fix; the black arrow at the ring's edge was one signal
  // too many, so it is gone along with its tap target.
  assert.equal(typeof app.drawUserDirectionFromAnchor, "undefined", "the off-ring pointer is not drawn");
  assert.equal(typeof app.hitUserDirectionPointer, "undefined", "and has no tap target left behind");

  const user = app.state.userLocation.point;
  const dx = user.x - anchor.point.x;
  const dy = user.y - anchor.point.y;
  const length = Math.hypot(dx, dy);
  const radius = app.walkingRadiusWorldUnits();
  const onRing = app.worldToScreen({
    x: anchor.point.x + (dx / length) * radius * 1.17,
    y: anchor.point.y + (dy / length) * radius * 1.17,
  });

  // A tap out there is now plain open ground: it re-anchors the browse point, as any other
  // tap outside the nearest area does, rather than being swallowed by an invisible control.
  tapMap(app, onRing);
  assert.notEqual(app.state.nearbyAnchor, null, "the tap moves the browse anchor");
  assert.equal(app.state.selected, null, "and nothing gets selected by the tap");
});

test("an expanded group hides every other highlighted location from the map", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const grouped = { id: "t1", commonName: "Oak", ...makePoint(app, 51.6503, 0.05) };
  const otherTree = { id: "t2", commonName: "Beech", ...makePoint(app, 51.6504, 0.0501) };
  const pub = { id: "p1", name: "The Forester", category: "pub", ...makePoint(app, 51.6502, 0.0503) };
  app.state.trees.push(grouped, otherTree);
  app.state.landmarks.push(pub);

  const before = app.buildNearbyIconLookup();
  assert.equal(before.landmark.has(pub), true, "the pub is a highlighted location in plain nearby mode");

  app.state.clusterExpanded = { itemType: "tree", items: [grouped], worldPt: grouped.point, screenPt: { x: 0, y: 0 } };
  const lookup = app.buildNearbyIconLookup();

  assert.equal(lookup.tree.has(grouped), true, "the group's own trees stay on the map");
  assert.equal(lookup.tree.has(otherTree), false, "trees outside the group are hidden");
  assert.equal(lookup.landmark.has(pub), false, "highlighted locations of other types are hidden too");
});

test("a pin hidden by an expanded group is no longer tappable where it used to be", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const grouped = { id: "t1", commonName: "Oak", ...makePoint(app, 51.6503, 0.05) };
  const otherTree = { id: "t2", commonName: "Beech", ...makePoint(app, 51.6504, 0.0501) };
  app.state.trees.push(grouped, otherTree);
  app.state.viewport = { scale: 200000, tx: 0, ty: 0 };
  app.state.viewport.tx = 500 - otherTree.point.x * 200000;
  app.state.viewport.ty = 400 - otherTree.point.y * 200000;

  const tap = pinTapPoint(app, otherTree.point);
  const world = app.screenToWorld(tap.x, tap.y);
  assert.equal(app.findHit(tap, world).type, "tree", "sanity: this tap hits the pin in plain nearby mode");

  app.state.clusterExpanded = { itemType: "tree", items: [grouped], worldPt: grouped.point, screenPt: { x: 0, y: 0 } };

  assert.equal(app.findHit(tap, world).type, "none", "a hidden pin must not stay selectable");
});

test("a pin hidden behind a selection is no longer tappable, so the tap is open ground", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const selected = { id: "t1", commonName: "Oak", ...makePoint(app, 51.6503, 0.05) };
  const otherTree = { id: "t2", commonName: "Beech", ...makePoint(app, 51.6504, 0.0501) };
  app.state.trees.push(selected, otherTree);
  app.state.viewport = { scale: 200000, tx: 0, ty: 0 };
  app.state.viewport.tx = 500 - otherTree.point.x * 200000;
  app.state.viewport.ty = 400 - otherTree.point.y * 200000;

  const tap = pinTapPoint(app, otherTree.point);
  const world = app.screenToWorld(tap.x, tap.y);
  assert.equal(app.findHit(tap, world).type, "tree", "sanity: this tap hits the pin in plain nearby mode");

  // A real selection hides every other pin (shouldDrawMapIcon), and with tens of thousands of
  // trees in the register a tap "away from the selection" would otherwise keep landing on one.
  app.state.selected = { type: "tree", item: selected };

  assert.equal(app.findHit(tap, world).type, "none");
});

test("selected road navigation removes every background pin from the map lookup", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const selectedRoad = {
    name: "Forest Road",
    segments: [[
      makePoint(app, 51.6501, 0.0501).point,
      makePoint(app, 51.6504, 0.0504).point,
    ]],
  };
  app.state.roads.push(selectedRoad);
  app.state.trees.push({ id: "other-tree", ...makePoint(app, 51.6502, 0.0502) });
  app.state.landmarks.push({ id: "other-place", name: "Other place", ...makePoint(app, 51.6503, 0.0503) });
  app.state.selected = { type: "road", item: selectedRoad };

  const lookup = app.activeIconLookup();
  assert.equal(lookup.tree.size, 0, "trees are hidden during road navigation");
  assert.equal(lookup.landmark.size, 0, "landmarks are hidden during road navigation");
  assert.equal(lookup.cow.size, 0, "cows are hidden during road navigation");
  assert.equal(lookup.path.size, 0, "paths are hidden during road navigation");
  assert.equal(lookup.water.size, 0, "water locations are hidden during road navigation");
});

// A 2D-context stand-in that records the path it is given, so a test can see what was drawn.
function recordingContext() {
  const calls = { moveTo: [], lineTo: 0, fillText: [] };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === "moveTo") return (x, y) => calls.moveTo.push({ x, y });
      if (key === "lineTo") return () => { calls.lineTo += 1; };
      if (key === "fillText") return (text, x, y) => calls.fillText.push({ text, x, y });
      if (key === "measureText") return (text) => ({ width: String(text).length * 8 });
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { ctx, calls };
}

test("a nature reserve's name is drawn only when it fits the polygon's on-screen size", () => {
  resetData(app);
  const square = (lon, lat, d) => ({ type: "Polygon", coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
  const roomy = { properties: { featureType: "nature_designation", name: "Deer Sanctuary" }, geometry: square(0.049, 51.649, 0.002) };
  const cramped = { properties: { featureType: "nature_designation", name: "Deer Sanctuary" }, geometry: square(0.0495, 51.6495, 0.0001) };
  const unnamed = { properties: { featureType: "nature_designation", name: null }, geometry: square(0.0485, 51.6485, 0.002) };
  app.state.environmentFeatures = [roomy, cramped, unnamed];
  const centre = app.projectLonLat(0.05, 51.65);
  const scale = 200000;
  app.state.viewport = { scale, tx: 500 - centre.x * scale, ty: 400 - centre.y * scale };

  const originalLoadBuildings = app.swapGlobalFunction("loadBuildingsIfNeeded", () => {});
  try {
    const { ctx, calls } = recordingContext();
    app.drawEnvironment(ctx);
    assert.equal(calls.fillText.length, 1, "only the polygon roomy enough for the name gets a label; the tiny one and the unnamed one don't");
    assert.equal(calls.fillText[0].text, "Deer Sanctuary");
  } finally {
    app.swapGlobalFunction("loadBuildingsIfNeeded", originalLoadBuildings);
    app.state.environmentFeatures = [];
  }
});

test("an open-land polygon's name (a park, common, grassland, heath or scrub) is drawn only when it fits its on-screen size", () => {
  resetData(app);
  const square = (lon, lat, d) => ({ type: "Polygon", coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
  const roomy = { properties: { featureType: "open_land", name: "Chingford Plain" }, geometry: square(0.049, 51.649, 0.002) };
  const cramped = { properties: { featureType: "open_land", name: "Chingford Plain" }, geometry: square(0.0495, 51.6495, 0.0001) };
  app.state.environmentFeatures = [roomy, cramped];
  const centre = app.projectLonLat(0.05, 51.65);
  const scale = 200000;
  app.state.viewport = { scale, tx: 500 - centre.x * scale, ty: 400 - centre.y * scale };

  const originalLoadBuildings = app.swapGlobalFunction("loadBuildingsIfNeeded", () => {});
  try {
    const { ctx, calls } = recordingContext();
    app.drawEnvironment(ctx);
    assert.equal(calls.fillText.length, 1, "only the roomy open-land polygon gets a label");
    assert.equal(calls.fillText[0].text, "Chingford Plain");
  } finally {
    app.swapGlobalFunction("loadBuildingsIfNeeded", originalLoadBuildings);
    app.state.environmentFeatures = [];
  }
});

test("a named locality point (a boundary-less forest plain like Deershelter Plain) labels only once zoomed in", () => {
  resetData(app);
  const locality = {
    properties: { featureType: "named_locality", name: "Deershelter Plain" },
    geometry: { type: "Point", coordinates: [0.05, 51.65] },
  };
  app.state.environmentFeatures = [locality];
  const centre = app.projectLonLat(0.05, 51.65);
  app.state.fitScale = 10000;

  const originalLoadBuildings = app.swapGlobalFunction("loadBuildingsIfNeeded", () => {});
  try {
    // Zoomed out: scale/fitScale is under the 2^1.15 label threshold.
    app.state.viewport = { scale: 15000, tx: 500 - centre.x * 15000, ty: 400 - centre.y * 15000 };
    const zoomedOut = recordingContext();
    app.drawEnvironment(zoomedOut.ctx);
    assert.equal(zoomedOut.calls.fillText.length, 0, "no label yet at a whole-forest zoom level");

    // Zoomed in well past the threshold.
    app.state.viewport = { scale: 200000, tx: 500 - centre.x * 200000, ty: 400 - centre.y * 200000 };
    const zoomedIn = recordingContext();
    app.drawEnvironment(zoomedIn.ctx);
    assert.equal(zoomedIn.calls.fillText.length, 1, "label appears once zoomed in enough");
    assert.equal(zoomedIn.calls.fillText[0].text, "Deershelter Plain");
  } finally {
    app.swapGlobalFunction("loadBuildingsIfNeeded", originalLoadBuildings);
    app.state.environmentFeatures = [];
  }
});

test("the environment and forest layers project each vertex once, not on every frame, and skip what is off screen", () => {
  resetData(app);
  const square = (lon, lat, d) => ({ type: "Polygon", coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
  const onScreen = { properties: { featureType: "garden" }, geometry: square(0.049, 51.649, 0.002) };
  const farAway = { properties: { featureType: "garden" }, geometry: square(1.5, 52.5, 0.002) };
  app.state.environmentFeatures = [onScreen, farAway];
  const layer = { key: "forest", data: { features: [{ geometry: square(0.048, 51.648, 0.004) }, { geometry: square(-1.5, 50.5, 0.004) }] } };
  const centre = app.projectLonLat(0.05, 51.65);
  const scale = 200000;
  app.state.viewport = { scale, tx: 500 - centre.x * scale, ty: 400 - centre.y * scale };

  let projections = 0;
  const originalProject = app.swapGlobalFunction("projectLonLat", function (...args) {
    projections += 1;
    return originalProject.apply(this, args);
  });
  const originalLoadBuildings = app.swapGlobalFunction("loadBuildingsIfNeeded", () => {});
  try {
    const first = recordingContext();
    app.drawEnvironment(first.ctx);
    app.drawLayer(first.ctx, layer);
    assert.equal(first.calls.moveTo.length, 2, "only the on-screen garden and forest polygon are drawn");
    const firstFrameProjections = projections;
    assert.ok(firstFrameProjections >= 20, "the first frame projects the geometry");

    const second = recordingContext();
    app.drawEnvironment(second.ctx);
    app.drawLayer(second.ctx, layer);
    assert.equal(projections - firstFrameProjections, 0, "a later frame re-projects no vertices");
    assert.deepEqual(second.calls.moveTo, first.calls.moveTo, "and draws exactly the same path");
    assert.equal(second.calls.lineTo, first.calls.lineTo);

    // The cache holds world points, so moving the camera still moves the drawing.
    app.state.viewport = { ...app.state.viewport, tx: app.state.viewport.tx + 30 };
    const panned = recordingContext();
    app.drawEnvironment(panned.ctx);
    assert.equal(panned.calls.moveTo[0].x, first.calls.moveTo[0].x + 30, "a pan shifts the cached geometry on screen");
  } finally {
    app.swapGlobalFunction("projectLonLat", originalProject);
    app.swapGlobalFunction("loadBuildingsIfNeeded", originalLoadBuildings);
    app.state.environmentFeatures = [];
  }
});

test("tapping inside a forest polygon is open ground, not a selectable area", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  app.state.environmentFeatures = [{
    properties: { featureType: "nature_designation", name: "Epping Forest SSSI" },
    geometry: { type: "Polygon", coordinates: [[[0.04, 51.64], [0.06, 51.64], [0.06, 51.66], [0.04, 51.66], [0.04, 51.64]]] },
  }];
  app.state.viewport = { scale: 200000, tx: 500, ty: 400 };

  const world = app.projectLonLat(0.05, 51.65);
  assert.equal(app.findHit(app.worldToScreen(world), world).type, "none");
  app.state.environmentFeatures = [];
});

// Drives the real tap pipeline: handleMapClick reads client coords through canvasPoint(), and
// the stubbed canvas/stage rect sits at the origin, so a canvas-pixel point converts back by
// dividing out the device pixel ratio.
function tapMap(app, canvasPointXY) {
  const dpr = app.pixelRatio();
  app.handleMapClick({
    clientX: (canvasPointXY.x - app.state.canvasInsetX) / dpr,
    clientY: (canvasPointXY.y - app.state.canvasInsetY) / dpr,
  });
}

// A north-south street running past the user, near enough to tap either side of the ring.
function addTestStreet(app, longitude) {
  const road = {
    name: "Forest Road",
    roadType: "residential",
    segments: [[app.projectLonLat(longitude, 51.6), app.projectLonLat(longitude, 51.7)]],
  };
  app.state.roads.push(road);
  return road;
}

test("in the nearby view, tapping a street inside the nearest area opens navigation to it", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6503, 0.05) });
  // ~70m east of the user, well inside the 5 min (~415m) radius.
  const road = addTestStreet(app, 0.051);
  app.state.viewport = { scale: 2000000, tx: 0, ty: 0 };
  app.state.viewport.tx = 500 - app.state.userLocation.point.x * 2000000;
  app.state.viewport.ty = 400 - app.state.userLocation.point.y * 2000000;

  tapMap(app, app.worldToScreen(app.projectLonLat(0.051, 51.65)));

  assert.equal(app.state.selected?.type, "road", "a street you could walk to now is a destination");
  assert.equal(app.state.nearbyAnchor, null, "the nearest area stays where it was");
});

test("in the nearby view, tapping a street beyond the nearest area moves the nearest area there", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6503, 0.05) });
  // ~1.4km east of the user -- far outside the 5 min (~415m) radius, but streets are drawn
  // right across the map, so it is still under the tap.
  addTestStreet(app, 0.07);
  app.state.viewport = { scale: 100000, tx: 0, ty: 0 };
  app.state.viewport.tx = 500 - app.state.userLocation.point.x * 100000;
  app.state.viewport.ty = 400 - app.state.userLocation.point.y * 100000;

  const tapLonLat = { latitude: 51.65, longitude: 0.07 };
  assert.equal(app.isOutsideNearestArea(tapLonLat), true, "sanity: this tap is outside the ring");

  tapMap(app, app.worldToScreen(app.projectLonLat(tapLonLat.longitude, tapLonLat.latitude)));

  assert.equal(app.state.selected, null, "a street out there is somewhere to browse, not navigate to");
  assert.ok(app.state.nearbyAnchor, "the nearest area moves to the tapped spot");
  assert.ok(Math.abs(app.state.nearbyAnchor.longitude - 0.07) < 1e-4);
});

test("in the nearby view, tapping a visible location beyond the nearest area selects it", async () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const tree = {
    id: "far-tree",
    commonName: "Far Oak",
    recordNumber: 1,
    location: { britishNationalGrid: {} },
    ...makePoint(app, 51.65, 0.07),
  };
  app.state.trees.push(tree);
  app.state.showAllOutsideRadius = true;
  app.state.map3dEnabled = false;
  app.selectOverview();
  app.state.viewport = { scale: 100000, tx: 0, ty: 0 };
  app.state.viewport.tx = 500 - tree.point.x * 100000;
  app.state.viewport.ty = 400 - tree.point.y * 100000;

  const tapLonLat = { latitude: 51.65, longitude: 0.07 };
  assert.equal(app.isOutsideNearestArea(tapLonLat), true, "sanity: this tap is outside the ring");
  assert.equal(app.activeIconLookup().tree.has(tree), true, "the all-distances view draws the outside-radius tree");
  const treeTap = pinTapPoint(app, tree.point);
  assert.equal(app.findHit(treeTap, app.screenToWorld(treeTap.x, treeTap.y)).type, "tree", "the outside-radius location is actually drawn and tappable");
  tapMap(app, treeTap);

  assert.equal(app.state.selected?.type, "tree", "a visible location remains selectable outside the ring");
  assert.equal(app.state.nearbyAnchor, null, "selecting a location should not move the Nearby anchor");
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.ok(app.state.viewportAnimationTo || app.state.viewport.scale !== 100000, "selection should start a camera fit");
  app.stopViewportAnimation();
});

test("tapping a location from a browsed Nearby anchor keeps the outgoing map during handoff", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  const anchor = makePoint(app, 51.65, 0.07);
  const tree = {
    id: "anchored-tree",
    commonName: "Anchored Oak",
    recordNumber: 1,
    location: { britishNationalGrid: {} },
    ...makePoint(app, 51.6503, 0.07),
  };
  app.state.trees.push(tree);
  app.state.map3dEnabled = false;
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  settleNearbySlide(app);
  app.selectOverview();
  app.ensureOverviewTargetsVisible({ animate: false, force: true });
  app.stopViewportAnimation();
  // Re-start the otherwise harmless anchor transition to exercise the intermittent case where
  // a pin is tapped while Nearby is still sliding/revealing its current view.
  app.setNearbyAnchor(anchor.latitude, anchor.longitude, anchor.point);
  assert.ok(app.state.nearbyOriginTransition, "sanity: the Nearby-origin transition is in flight");

  const outgoingIconLookup = app.activeIconLookup();
  const treeTap = pinTapPoint(app, tree.point);
  assert.equal(app.findHit(treeTap, app.screenToWorld(treeTap.x, treeTap.y)).type, "tree");
  tapMap(app, treeTap);

  assert.equal(app.state.selected?.type, "tree", "the Nearby pin should open the location");
  assert.equal(app.state.selectionMapTransitionActive, true,
    "the outgoing map should remain active during a direct map selection");
  assert.equal(app.activeIconLookup(), outgoingIconLookup,
    "direct map selection should retain the pins from the browsed Nearby view");
  assert.ok(
    Math.abs(app.state.selectionMapTransitionOriginPoint.x - anchor.point.x) < 1e-9
      && Math.abs(app.state.selectionMapTransitionOriginPoint.y - anchor.point.y) < 1e-9,
    "direct map selection should retain the browsed pivot during handoff"
  );
  assert.equal(app.state.nearbyOriginTransition, null,
    "selection should cancel the obsolete Nearby-origin transition");
  app.stopViewportAnimation();
});

test("the nearest area is measured from the browse anchor once one is set, not the GPS fix", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  app.state.trees.push({ id: "t1", commonName: "Oak", ...makePoint(app, 51.6503, 0.05) });
  const far = { latitude: 51.65, longitude: 0.07 };
  assert.equal(app.isOutsideNearestArea(far), true);

  app.setNearbyAnchor(far.latitude, far.longitude, app.projectLonLat(far.longitude, far.latitude));

  assert.equal(app.isOutsideNearestArea(far), false, "the ring moved, so that spot is now inside it");
  assert.equal(app.isOutsideNearestArea({ latitude: 51.65, longitude: 0.05 }), true, "and the GPS fix is now outside");
});

test("selecting a street navigates to the point on it nearest the user", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.65, 0.05);
  // A north-south street running past the user, so the nearest point is due east of them.
  const road = {
    name: "Forest Road",
    roadType: "residential",
    segments: [[app.projectLonLat(0.055, 51.64), app.projectLonLat(0.055, 51.66)]],
  };
  app.state.roads.push(road);
  app.state.selected = { type: "road", item: road };

  const target = app.selectedCompassTarget();

  assert.ok(target, "a street is a navigation target, not just a records list");
  assert.equal(target.name, "Forest Road");
  assert.ok(Math.abs(target.longitude - 0.055) < 1e-6, "aims at the street itself");
  assert.ok(Math.abs(target.latitude - 51.65) < 1e-4, "aims at the closest point along it");
  assert.equal(app.selectedCompassTarget(), target, "the target is stable across frames so route memoization holds");
});

test("a street selected before the first GPS fix picks up a navigation target once location arrives", () => {
  resetData(app);
  app.state.userLocation = null;
  const road = {
    name: "Forest Road",
    roadType: "residential",
    segments: [[app.projectLonLat(0.055, 51.64), app.projectLonLat(0.055, 51.66)]],
  };
  app.state.roads.push(road);
  app.state.selected = { type: "road", item: road };

  assert.equal(app.selectedCompassTarget(), null, "no fix, nothing to measure from yet");

  app.state.userLocation = makePoint(app, 51.65, 0.05);

  assert.ok(app.selectedCompassTarget(), "the target resolves on the next frame after a fix arrives");
});

test("the weekly report's map inventory counts every filter group the app offers", () => {
  const { buildInventory } = require("../scripts/report/map-inventory.js");
  const inventory = buildInventory();

  const groupKeys = inventory.groups.map((group) => group.key);
  assert.deepEqual(
    groupKeys,
    ["nature", "food", "transport", "history", "locations", "stories"],
    // Events is deliberately excluded from this report -- see the comment in
    // map-inventory.js's buildInventory(). This test's own name is about the app's physical
    // map categories, not literally "every" FILTER_GROUPS entry.
    "the report groups every one of the app's static map categories the same way the app's Filter screen does"
  );
  for (const group of inventory.groups) {
    assert.ok(group.subfilters.length > 0, `${group.key} should list its subfilters`);
  }
});

test("the map inventory's breakdown adds up to the total it reports", () => {
  // The whole point of the "What's on the map" section is that a reader can
  // add the categories up and get the headline number -- so nothing may be
  // counted twice, and nothing drawn on the map may be left out.
  const { buildInventory } = require("../scripts/report/map-inventory.js");
  const inventory = buildInventory();

  const grouped = inventory.groups.reduce((sum, group) => {
    const fromSubfilters = group.subfilters.reduce((s, sub) => s + sub.count, 0);
    assert.equal(group.count, fromSubfilters, `${group.key} total should be its subfilters' sum`);
    return sum + group.count;
  }, 0);

  assert.equal(
    grouped + inventory.alwaysShown.count,
    inventory.total,
    "every group plus the always-shown features should equal the headline total"
  );
});

test("the map inventory counts historic sites, plaques and monuments the map draws", () => {
  // These three sit outside PLACE_FILTER_PRIORITY -- historic and monuments
  // in the fallback tier, plaques behind the chipless blue_plaques key -- and
  // an inventory that only walked that list reported all three as zero while
  // the map showed dozens of each.
  const { buildInventory } = require("../scripts/report/map-inventory.js");
  const history = buildInventory().groups.find((group) => group.key === "history");

  for (const key of ["historic", "plaques", "monuments"]) {
    const subfilter = history.subfilters.find((item) => item.key === key);
    assert.ok(subfilter.count > 0, `${key} should be counted, not reported as zero`);
  }
});

test("the map inventory counts far more than the food places alone", () => {
  // The bug this section fixes: the report's only count used to be the
  // food/drink/shop dataset, presented as if it were everything on the map.
  const { buildInventory } = require("../scripts/report/map-inventory.js");
  const inventory = buildInventory();

  const food = inventory.groups.find((group) => group.key === "food");
  assert.ok(food.count > 0, "there should be food places");
  assert.ok(
    inventory.total > food.count * 10,
    "the whole-map total should dwarf the food-only count it used to be confused with"
  );
});

test("activateModalFocus traps Tab within the container and restores focus on deactivate", () => {
  // Minimal hand-rolled DOM: just enough real focus()/querySelectorAll()/addEventListener()
  // semantics for js/nav.js's actual activateModalFocus to run against, without pulling in a
  // DOM-emulation dependency the project otherwise has no use for. Exercises the real helper,
  // not a re-implementation of it.
  function makeEl(tag, { focusable = false } = {}) {
    const listeners = {};
    const el = {
      tagName: tag,
      disabled: false,
      offsetParent: {}, // "visible" by default
      children: [],
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) {
        if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn);
      },
      dispatchEvent(event) { (listeners[event.type] || []).forEach((fn) => fn(event)); },
      focus() { fakeDoc.activeElement = el; },
      querySelectorAll(selector) {
        if (selector.includes("a[href]") || selector.includes("button")) {
          return el.children.filter((c) => c.tagName === "BUTTON");
        }
        return [];
      },
    };
    if (focusable) el.tagName = "BUTTON";
    return el;
  }

  const opener = makeEl("BUTTON", { focusable: true });
  const modal = makeEl("DIV");
  const first = makeEl("BUTTON", { focusable: true });
  const last = makeEl("BUTTON", { focusable: true });
  modal.children = [first, last];

  const fakeDoc = { activeElement: null, contains: () => true };
  global.document = fakeDoc;

  const navSrc = fs.readFileSync(path.join(__dirname, "..", "js", "nav.js"), "utf8");
  const fnMatch = navSrc.match(/function activateModalFocus\([\s\S]*?\n}\n/);
  assert.ok(fnMatch, "activateModalFocus should exist in js/nav.js");
  const activateModalFocusFn = vm.runInThisContext(`(function() { ${fnMatch[0]} return activateModalFocus; })()`);

  opener.focus();
  assert.equal(fakeDoc.activeElement, opener);

  const deactivate = activateModalFocusFn(modal);
  assert.equal(fakeDoc.activeElement, first, "focus should move into the modal");

  last.focus();
  modal.dispatchEvent({ type: "keydown", key: "Tab", shiftKey: false, preventDefault() {} });
  assert.equal(fakeDoc.activeElement, first, "Tab from the last item should wrap to the first, not escape the modal");

  deactivate();
  assert.equal(fakeDoc.activeElement, opener, "closing the modal should restore focus to the opener");

  delete global.document;
});

test("Events and Pubs are default-on categories, like Trees and Cows", () => {
  assert.ok(app.DEFAULT_FILTERS.includes("events"));
  assert.ok(app.DEFAULT_FILTERS.includes("pubs"));
});

test("normalizeEventLocations keeps upcoming (within a week) and live events, and drops past or too-far-ahead ones", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const data = {
    events: [
      { id: "soon", name: "Soon fair", lat: 51.65, lon: 0.04, startsAt: "2026-10-15T10:00:00Z", endsAt: "2026-10-15T16:00:00Z" },
      { id: "live", name: "Live walk", lat: 51.65, lon: 0.04, startsAt: "2026-10-10T10:00:00Z", endsAt: "2026-10-10T14:00:00Z" },
      { id: "past", name: "Past market", lat: 51.65, lon: 0.04, startsAt: "2026-09-01T10:00:00Z", endsAt: "2026-09-01T16:00:00Z" },
      { id: "too-far-ahead", name: "Next month's fair", lat: 51.65, lon: 0.04, startsAt: "2026-11-21T10:00:00Z" },
      { id: "no-coords", name: "Nowhere", startsAt: "2026-10-15T10:00:00Z" },
    ],
  };

  const events = app.normalizeEventLocations(data, now);

  assert.deepEqual(events.map((e) => e.id).sort(), ["live", "soon"]);
  for (const event of events) {
    assert.equal(event.dataSource, "event");
    assert.equal(event.category, "event");
    assert.ok(event.categoryTags.includes("event"));
    assert.ok(event.point);
  }
});

test("isEventTooFarAhead holds back an event until it's within a week of starting, but never one already live", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert.equal(app.isEventTooFarAhead({ startsAt: "2026-10-17T11:00:00Z" }, now), false, "exactly a week out is still shown");
  assert.equal(app.isEventTooFarAhead({ startsAt: "2026-10-18T13:00:00Z" }, now), true, "more than a week out is not");
  // Started three weeks ago, a multi-week festival still running today -- live, so never "ahead".
  assert.equal(app.isEventTooFarAhead({ startsAt: "2026-09-19T10:00:00Z", endsAt: "2026-10-20T10:00:00Z" }, now), false);
});

test("an event with no endsAt is assumed to run for one day from startsAt", () => {
  const starts = "2026-10-10T10:00:00Z";
  const justInside = Date.parse(starts) + 23 * 60 * 60 * 1000;
  const justOutside = Date.parse(starts) + 25 * 60 * 60 * 1000;

  assert.equal(app.isEventPast({ startsAt: starts }, justInside), false);
  assert.equal(app.isEventPast({ startsAt: starts }, justOutside), true);
});

test("isEventLive is true only between startsAt and endsAt", () => {
  const event = { startsAt: "2026-10-10T10:00:00Z", endsAt: "2026-10-10T14:00:00Z" };
  assert.equal(app.isEventLive(event, Date.parse("2026-10-10T09:00:00Z")), false);
  assert.equal(app.isEventLive(event, Date.parse("2026-10-10T12:00:00Z")), true);
  assert.equal(app.isEventLive(event, Date.parse("2026-10-10T15:00:00Z")), false);
});

test("an event with no parseable startsAt is never shown", () => {
  assert.equal(app.isEventPast({}), true);
  assert.equal(app.isEventPast({ startsAt: "not a date" }), true);
  assert.equal(app.normalizeEventLocations({ events: [{ id: "bad", lat: 51.65, lon: 0.04 }] }).length, 0);
});

test("events classify and draw through the ordinary place-filter pipeline", () => {
  const event = { id: "e1", name: "Autumn Fair", dataSource: "event", categoryTags: ["event"] };
  assert.equal(app.matchesPlaceFilter(event, "events"), true);
  assert.equal(app.isEventCategory(event), true);
  assert.equal(app.placeIconSlug(event), "event");
  assert.ok(app.PLACE_FILTER_KEYS.has("events"));
});

test("formatEventWhen renders a same-day range, a spanning range, and a start-only time", () => {
  assert.equal(
    app.formatEventWhen({ startsAt: "2026-10-18T10:00:00Z", endsAt: "2026-10-18T16:00:00Z" }),
    "Sun 18 Oct, 11:00–17:00"
  );
  assert.equal(
    app.formatEventWhen({ startsAt: "2026-10-18T10:00:00Z", endsAt: "2026-10-19T10:00:00Z" }),
    "Sun 18 Oct – Mon 19 Oct"
  );
  assert.equal(app.formatEventWhen({ startsAt: "2026-10-18T10:00:00Z" }), "Sun 18 Oct, 11:00");
  assert.equal(app.formatEventWhen({}), null);
});

test("eventStatusLabel reports Happening now vs Upcoming", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert.equal(app.eventStatusLabel({ startsAt: "2026-10-10T10:00:00Z", endsAt: "2026-10-10T14:00:00Z" }, now), "Happening now");
  assert.equal(app.eventStatusLabel({ startsAt: "2026-10-18T10:00:00Z" }, now), "Upcoming");
  assert.equal(app.eventStatusLabel({ startsAt: "2026-09-01T10:00:00Z" }, now), null);
});

test("a past event never reaches the proximity banner, even standing right on top of it", () => {
  resetData(app);
  app.state.overviewFilters = [];
  app.state.walkingDistanceMinutes = 10;
  app.state.eventNearbyAlertedIds = new Set();
  app.state.eventNearbyBannerEventId = null;
  app.els.eventNearbyBanner.hidden = true;
  const now = Date.parse("2026-10-10T12:00:00Z");
  app.state.landmarks.push({
    id: "past-1", name: "Past market", dataSource: "event", categoryTags: ["event"],
    startsAt: "2026-09-01T10:00:00Z", endsAt: "2026-09-01T16:00:00Z",
    ...makePoint(app, 0, 0),
  });
  app.checkEventProximityAlert(0, 0, now);
  assert.equal(app.els.eventNearbyBanner.hidden, true);
});

test("a live event within the walking radius opens the proximity banner exactly once per session", () => {
  resetData(app);
  app.state.overviewFilters = [];
  app.state.walkingDistanceMinutes = 10;
  app.state.eventNearbyAlertedIds = new Set();
  app.state.eventNearbyBannerEventId = null;
  app.els.eventNearbyBanner.hidden = true;
  const now = Date.parse("2026-10-10T12:00:00Z");
  app.state.landmarks.push({
    id: "live-1", name: "Autumn Fair", dataSource: "event", categoryTags: ["event"],
    startsAt: "2026-10-10T10:00:00Z", endsAt: "2026-10-10T14:00:00Z",
    ...makePoint(app, 0, 0),
  });

  app.checkEventProximityAlert(0, 0, now);
  assert.equal(app.els.eventNearbyBanner.hidden, false);
  assert.match(app.els.eventNearbyBannerText.textContent, /Autumn Fair is on now/);

  app.els.eventNearbyBanner.hidden = true;
  app.checkEventProximityAlert(0, 0, now);
  assert.equal(app.els.eventNearbyBanner.hidden, true, "already-alerted events are never re-shown this session");
});

test("a live event outside the walking radius or behind a disabled Events filter does not alert", () => {
  resetData(app);
  app.state.walkingDistanceMinutes = 5;
  app.state.eventNearbyAlertedIds = new Set();
  app.els.eventNearbyBanner.hidden = true;
  const now = Date.parse("2026-10-10T12:00:00Z");
  app.state.landmarks.push({
    id: "far-1", name: "Far fair", dataSource: "event", categoryTags: ["event"],
    startsAt: "2026-10-10T10:00:00Z", endsAt: "2026-10-10T14:00:00Z",
    ...makePoint(app, 1, 0), // far outside any walking radius
  });
  app.state.overviewFilters = [];
  app.checkEventProximityAlert(0, 0, now);
  assert.equal(app.els.eventNearbyBanner.hidden, true, "outside the radius -- no alert");

  app.state.landmarks[0] = {
    id: "near-but-off-1", name: "Nearby but filtered out", dataSource: "event", categoryTags: ["event"],
    startsAt: "2026-10-10T10:00:00Z", endsAt: "2026-10-10T14:00:00Z",
    ...makePoint(app, 0, 0),
  };
  app.state.overviewFilters = ["trees"]; // Events explicitly not among the active filters
  app.checkEventProximityAlert(0, 0, now);
  assert.equal(app.els.eventNearbyBanner.hidden, true, "Events filter turned off -- no alert");
});

test("urlPartsForRouteValue routes a selected place to its own /find/<slug>/ page when it has one", () => {
  resetData(app);
  const pub = { id: "node/1", name: "The Forresters", latitude: 51.65, longitude: 0.05, findSlug: "the-forresters" };
  app.state.landmarks.push(pub);

  const parts = app.urlPartsForRouteValue(`place=${app.placeHashKey(pub)}`);
  assert.equal(parts.pathname, "/find/the-forresters/");
  assert.equal(parts.hash, "");
});

test("urlPartsForRouteValue leaves a place with no /find/ page on the existing #place=<key> form", () => {
  resetData(app);
  const busStop = { id: "node/2", name: "Some Bus Stop", latitude: 51.65, longitude: 0.05, findSlug: null };
  app.state.landmarks.push(busStop);

  const key = app.placeHashKey(busStop);
  const parts = app.urlPartsForRouteValue(`place=${key}`);
  assert.equal(parts.pathname, app.NEARBY_PATH);
  assert.equal(parts.hash, `#place=${key}`);
});

test("routeValueFromLocation resolves a /find/<slug>/ URL back to the same place's #place=<key> value", () => {
  resetData(app);
  const pub = { id: "node/1", name: "The Forresters", latitude: 51.65, longitude: 0.05, findSlug: "the-forresters" };
  app.state.landmarks.push(pub);
  const originalPathname = app.location.pathname;
  const originalHash = app.location.hash;
  try {
    app.location.pathname = "/find/the-forresters/";
    app.location.hash = "";
    // routeParam (js/app.js) builds this the same way currentScreenRoute() already does for an
    // ordinary landmark selection -- via URLSearchParams, so ":" and "/" in the id-based hash key
    // come back percent-encoded. Built the same way here rather than hand-typed, so this test
    // doesn't itself assume a particular encoding.
    const expectedParams = new URLSearchParams();
    expectedParams.set("place", app.placeHashKey(pub));
    assert.equal(app.routeValueFromLocation(), expectedParams.toString());
  } finally {
    app.location.pathname = originalPathname;
    app.location.hash = originalHash;
  }
});

test("routeValueFromLocation on an unresolvable /find/<slug>/ URL (closed business, stale link) falls back to no selection rather than throwing", () => {
  resetData(app);
  const originalPathname = app.location.pathname;
  const originalHash = app.location.hash;
  try {
    app.location.pathname = "/find/nothing-here/";
    app.location.hash = "";
    assert.equal(app.routeValueFromLocation(), "");
  } finally {
    app.location.pathname = originalPathname;
    app.location.hash = originalHash;
  }
});

test("routeValueFromLocation never treats /find/events/ as a place lookup", () => {
  resetData(app);
  const originalPathname = app.location.pathname;
  const originalHash = app.location.hash;
  try {
    app.location.pathname = "/find/events/";
    app.location.hash = "";
    assert.equal(app.routeValueFromLocation(), "");
  } finally {
    app.location.pathname = originalPathname;
    app.location.hash = originalHash;
  }
});

test("nearbySectionsHtml renders a headed Nearest section (tree/cow, the walk-radius card, real live distances) and a headed Related section (category/group), both as the same card style", () => {
  resetData(app);
  const pub = { findSlug: "the-forresters", latitude: 51.65, longitude: 0.05, category: "pub" };
  app.state.trees.push({ latitude: 51.6505, longitude: 0.0505, id: "t1" }); // ~65m away
  app.state.cows.push({ latitude: 51.66, longitude: 0.06, id: "c1" }); // ~1.3km away

  const html = app.nearbySectionsHtml({ latitude: pub.latitude, longitude: pub.longitude, name: "The Forresters", subfilterKey: "pubs" });
  // Section order and headings: Nearby first, then Related -- both plain <h3 class="detail-section-heading">.
  const nearbyHeadingIndex = html.indexOf('<h3 class="detail-section-heading">Nearest</h3>');
  const relatedHeadingIndex = html.indexOf('<h3 class="detail-section-heading">Related</h3>');
  assert.ok(nearbyHeadingIndex >= 0 && relatedHeadingIndex > nearbyHeadingIndex, "Nearest heading comes before Related");

  // Both the tree and cows links carry this pub's own position via the target page's existing
  // "near=<lat>,<lon>" anchor route, so landing there re-centres on the pub rather than the
  // reader's own GPS fix.
  assert.match(html, /<a class="nearest-item nearby-link" href="\/nearby\/trees\/#near=51\.650000%2C0\.050000[^"]*">[\s\S]*?nearest-meta[\s\S]*?<\/a>/);
  assert.match(html, /<a class="nearest-item nearby-link" href="\/nearby\/cows\/#near=51\.650000%2C0\.050000[^"]*">[\s\S]*?nearest-meta[\s\S]*?<\/a>/);
  assert.match(html, /nearest-meta">(No |[\d,]+ )[^<]*within \d+ min walk of/, "each category card says how many sit within the walking radius");

  // The walk-radius card lives in this same Nearby section, as a <button> sharing the .nearest-item
  // card shape, between where it comes out of the Nearby heading and before Related begins.
  const walkCardIndex = html.indexOf('data-action="walk-radius"');
  assert.ok(walkCardIndex > nearbyHeadingIndex && walkCardIndex < relatedHeadingIndex, "walk-radius card sits inside the Nearby section");
  assert.match(html, /<button class="nearest-item" type="button" data-action="walk-radius" data-lat="51\.65" data-lon="0\.05" data-name="The Forresters">[\s\S]*?locations within \d+ min walk[\s\S]*?<\/button>/);

  // Category/group links are the same .nearest-item card as Nearby, not a different pill style.
  assert.match(html, /<a class="nearest-item nearby-link" href="\/nearby\/pubs\/">[\s\S]*?Pubs &amp; bars[\s\S]*?<\/a>/);
  assert.match(html, /<a class="nearest-item nearby-link" href="\/nearby\/food\/">[\s\S]*?Food[\s\S]*?<\/a>/);
  assert.ok(!html.includes("detail-map-link"), "related links no longer use the pill style -- same card as Nearby");

  // No mention of the data's source attached to these distances -- they're computed live, not
  // fetched from anywhere that would need crediting.
  assert.ok(!html.includes("OpenStreetMap"));
});

test("nearbySectionsHtml omits the cows link when no cow positions are currently loaded", () => {
  resetData(app);
  const pub = { findSlug: "the-forresters", latitude: 51.65, longitude: 0.05, category: "pub" };
  app.state.trees.push({ latitude: 51.6505, longitude: 0.0505, id: "t1" });

  const html = app.nearbySectionsHtml({ latitude: pub.latitude, longitude: pub.longitude, name: "The Forresters" });
  assert.match(html, /nearby\/trees\//);
  assert.ok(!html.includes("nearby/cows/"), "no cow data loaded -- no cows link to show");
});

test("nearbySectionsHtml puts Places close by above Nearest on a /find/ business", () => {
  resetData(app);
  const pub = { findSlug: "the-forresters", latitude: 51.65, longitude: 0.05, category: "pub" };
  app.state.landmarks.push({ id: "node/2", name: "The Neighbour", findSlug: "the-neighbour", latitude: 51.652, longitude: 0.05, category: "cafe" });

  const html = app.nearbySectionsHtml({ latitude: pub.latitude, longitude: pub.longitude, name: "The Forresters", findSlug: pub.findSlug });
  const placesIndex = html.indexOf('<h3 class="detail-section-heading">Places close by</h3>');
  const nearestIndex = html.indexOf('<h3 class="detail-section-heading">Nearest</h3>');
  assert.ok(placesIndex >= 0, "the nearby business is listed");
  assert.ok(placesIndex < nearestIndex, "Places close by comes before Nearest");
});

test("nearbySectionsHtml gives a place with no /find/ page of its own the same Nearest section, so no location is a dead end", () => {
  resetData(app);
  const busStop = { findSlug: null, latitude: 51.65, longitude: 0.05, category: "bus_stop" };
  const html = app.nearbySectionsHtml({ latitude: busStop.latitude, longitude: busStop.longitude, name: "Bus stop" });
  assert.ok(html.includes('<h3 class="detail-section-heading">Nearest</h3>'));
  assert.ok(html.includes("Everything"), "the Everything card is there too");
});

test("detailsHtml links a Phone row as a tel: link rather than inert text", () => {
  const html = app.detailsHtml([["Phone", "01234 567890"]]);
  assert.match(html, /<dd><a href="tel:01234 567890">01234 567890<\/a><\/dd>/);
});

test("detailsHtml renders Opening hours as plain text like any other detail row", () => {
  const html = app.detailsHtml([["Opening hours", "Mo-Su 09:00-17:00"]]);
  assert.match(html, /<dt>Opening hours<\/dt><dd>Mo-Su 09:00-17:00<\/dd>/);
});

// --- First visit: the page hands its map downloads to the service worker's data cache (js/loader.js) ---

function withHandOverEnvironment({ controller = null, registration = {}, response = { ok: true } } = {}, run) {
  const put = [];
  const fakeCaches = { open: async (name) => ({ put: async (url, body) => put.push({ name, url, body }) }) };
  const fakeResponse = () => ({ ...response, clone: () => ({ cloned: true }) });
  const previousFetch = app.swapGlobalFunction("fetch", async () => fakeResponse());
  const previousCaches = app.swapGlobalFunction("caches", fakeCaches);
  const previousSw = app.navigator.serviceWorker;
  app.navigator.serviceWorker = registration === undefined
    ? undefined
    : { controller, getRegistration: async () => registration };
  return Promise.resolve(run(put)).finally(() => {
    app.swapGlobalFunction("fetch", previousFetch);
    app.swapGlobalFunction("caches", previousCaches);
    if (previousSw === undefined) delete app.navigator.serviceWorker; else app.navigator.serviceWorker = previousSw;
  });
}

const handOverSettled = () => new Promise((resolve) => setImmediate(resolve));

test("on a first visit a downloaded map file is handed to the data cache, so the service worker need not fetch it again", () =>
  withHandOverEnvironment({}, async (put) => {
    await app.fetchMapData("data/local-roads.geojson");
    await handOverSettled();
    assert.equal(put.length, 1);
    assert.equal(put[0].url, "data/local-roads.geojson");
    assert.match(put[0].name, /^forest-finds-data-/);
  }));

test("once a service worker controls the page, nothing is handed over (the worker caches what passes through it)", () =>
  withHandOverEnvironment({ controller: {} }, async (put) => {
    await app.fetchMapData("data/local-roads.geojson");
    await handOverSettled();
    assert.equal(put.length, 0);
  }));

test("with no service worker registered (blocked, or unsupported), nothing is written to the cache", () =>
  withHandOverEnvironment({ registration: null }, async (put) => {
    await app.fetchMapData("data/local-roads.geojson");
    await handOverSettled();
    assert.equal(put.length, 0);
  }));

test("a failed download, or a file outside data/, is never handed over", async () => {
  await withHandOverEnvironment({ response: { ok: false } }, async (put) => {
    await app.fetchMapData("data/local-roads.geojson");
    await handOverSettled();
    assert.equal(put.length, 0);
  });
  await withHandOverEnvironment({}, async (put) => {
    await app.fetchMapData("Veteran_Tree_Register.json");
    await handOverSettled();
    assert.equal(put.length, 0);
  });
});

// --- Persistent storage (js/nav.js requestPersistentStorage) ---

async function persistRequests({ persisted = false, userAgent = "Mozilla/5.0 (iPhone) Safari/605.1.15" } = {}) {
  const calls = [];
  const previous = { storage: app.navigator.storage, userAgent: app.navigator.userAgent };
  app.navigator.storage = { persisted: async () => persisted, persist: async () => { calls.push("persist"); return true; } };
  app.navigator.userAgent = userAgent;
  try {
    app.requestPersistentStorage();
    await handOverSettled();
    return calls.length;
  } finally {
    if (previous.storage === undefined) delete app.navigator.storage; else app.navigator.storage = previous.storage;
    app.navigator.userAgent = previous.userAgent;
  }
}

test("the app asks the browser to keep its offline storage, so Safari does not clear it after a week away", async () => {
  assert.equal(await persistRequests(), 1);
});

test("storage that is already persisted is not asked for again", async () => {
  assert.equal(await persistRequests({ persisted: true }), 0);
});

test("Firefox, which would show a permission prompt for it, is not asked", async () => {
  assert.equal(await persistRequests({ userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0" }), 0);
});

test("a browser without the storage API is left alone", () => {
  const previous = app.navigator.storage;
  delete app.navigator.storage;
  try {
    assert.doesNotThrow(() => app.requestPersistentStorage());
  } finally {
    if (previous !== undefined) app.navigator.storage = previous;
  }
});

// --- Community verification consensus (netlify/functions/lib/community-consensus.js) ---
const communityConsensus = require("../netlify/functions/lib/community-consensus");
let communityReportSeq = 0;
function communityReport(overrides) {
  communityReportSeq += 1;
  return {
    id: `report-${String(communityReportSeq).padStart(4, "0")}`,
    deviceId: "device-aaaa",
    kind: "tree",
    target: "tree:1",
    status: "VERIFIED",
    targetLat: 51.64,
    targetLon: 0.01,
    lat: 51.64,
    lon: 0.01,
    ts: communityReportSeq,
    ...overrides,
  };
}

test("a single missing-tree report does not change what other users see", () => {
  const { overlay } = communityConsensus.computeCommunityState([
    communityReport({ status: "NOT_HERE", deviceId: "device-aaaa" }),
  ]);
  assert.equal(Object.keys(overlay).length, 0);
});

test("two independent devices reporting a tree missing mark it questioned, not removed", () => {
  const { overlay } = communityConsensus.computeCommunityState([
    communityReport({ status: "NOT_HERE", deviceId: "device-aaaa" }),
    communityReport({ status: "NOT_HERE", deviceId: "device-bbbb" }),
  ]);
  assert.equal(overlay["tree:1"].s, "questioned");
  assert.equal(overlay["tree:1"].st, "NOT_HERE");
  assert.equal(overlay["tree:1"].n, 2);
});

test("one device repeating a report still counts as one voice", () => {
  const { overlay } = communityConsensus.computeCommunityState([
    communityReport({ status: "NOT_HERE" }),
    communityReport({ status: "NOT_HERE" }),
    communityReport({ status: "NOT_HERE" }),
  ]);
  assert.equal(Object.keys(overlay).length, 0);
});

test("a verified tree scores 1 point, and 1 more when another device independently confirms it", () => {
  const first = communityConsensus.computeCommunityState([communityReport({ deviceId: "device-aaaa" })]);
  assert.equal(first.scores["device-aaaa"].points, 1);
  const both = communityConsensus.computeCommunityState([
    communityReport({ deviceId: "device-aaaa" }),
    communityReport({ deviceId: "device-bbbb" }),
  ]);
  assert.equal(both.scores["device-aaaa"].points, 2);
  assert.equal(both.scores["device-bbbb"].points, 2);
  assert.equal(both.overlay["tree:1"].s, "confirmed");
});

test("conflicting reports are held for review rather than shown", () => {
  const { overlay, conflicts } = communityConsensus.computeCommunityState([
    communityReport({ status: "VERIFIED", deviceId: "device-aaaa" }),
    communityReport({ status: "NOT_HERE", deviceId: "device-bbbb" }),
  ]);
  assert.deepEqual(conflicts, ["tree:1"]);
  assert.equal(overlay["tree:1"], undefined);
});

test("a report made from far away earns no points and does not count towards consensus", () => {
  const { overlay, scores } = communityConsensus.computeCommunityState([
    communityReport({ status: "NOT_HERE", deviceId: "device-aaaa", lat: 51.7, lon: 0.1 }),
    communityReport({ status: "NOT_HERE", deviceId: "device-bbbb" }),
  ]);
  assert.equal(Object.keys(overlay).length, 0);
  assert.equal(scores["device-aaaa"].points, 0);
});

test("a new tree found by a second device is confirmed and earns the finder 4 points", () => {
  const found = (deviceId, lat) => communityReport({ kind: "tree", status: "NEW_TREE", target: undefined, deviceId, lat, lon: 0.02, targetLat: undefined, targetLon: undefined, tagNumber: "T-9001", accuracy: 8 });
  const one = communityConsensus.computeCommunityState([found("device-aaaa", 51.65)]);
  assert.equal(Object.values(one.overlay)[0].s, "new");
  assert.equal(one.scores["device-aaaa"].points, 1);
  const two = communityConsensus.computeCommunityState([found("device-aaaa", 51.65), found("device-bbbb", 51.65001)]);
  assert.equal(Object.values(two.overlay)[0].s, "new-confirmed");
  assert.equal(two.scores["device-aaaa"].points, 4);
});

test("a new tree needs its tag number and a close, accurate location", () => {
  const base = { kind: "tree", status: "NEW_TREE", target: undefined, lat: 51.65, lon: 0.02, targetLat: undefined, targetLon: undefined };
  assert.equal(communityConsensus.validateReport(communityReport({ ...base, accuracy: 8 })), "a new tree needs its tag number");
  assert.equal(communityConsensus.validateReport(communityReport({ ...base, tagNumber: "0", accuracy: 8 })), "a new tree needs its tag number");
  assert.equal(communityConsensus.validateReport(communityReport({ ...base, tagNumber: "7001" })), "location is not accurate enough");
  assert.equal(communityConsensus.validateReport(communityReport({ ...base, tagNumber: "7001", accuracy: 80 })), "location is not accurate enough");
  assert.equal(communityConsensus.validateReport(communityReport({ ...base, tagNumber: "7001", accuracy: 12 })), null);
});

test("two people reporting the same new tag number are the same new tree, wherever the dot fell", () => {
  const found = (deviceId, lat) => communityReport({ kind: "tree", status: "NEW_TREE", target: undefined, deviceId, lat, lon: 0.02, targetLat: undefined, targetLon: undefined, tagNumber: "t 7001", accuracy: 10 });
  const { overlay } = communityConsensus.computeCommunityState([found("device-aaaa", 51.65), found("device-bbbb", 51.6503)]);
  const entries = Object.values(overlay);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].s, "new-confirmed");
  assert.equal(entries[0].tag, "t 7001");
});

test("business reports use their own status set", () => {
  assert.equal(communityConsensus.statusClass("place", "CLOSED"), "question");
  assert.equal(communityConsensus.statusClass("place", "NOT_HERE"), null);
  assert.equal(communityConsensus.validateReport(communityReport({ kind: "place", status: "NOT_HERE" })), "unknown kind/status");
});

test("a MOVED report must carry the new position", () => {
  assert.equal(communityConsensus.validateReport(communityReport({ status: "MOVED" })), "MOVED needs newLat/newLon");
});

test("admin community stats count people, reports and flagged trees", () => {
  const reports = [
    communityReport({ status: "NOT_HERE", deviceId: "device-aaaa", ts: Date.now() }),
    communityReport({ status: "NOT_HERE", deviceId: "device-bbbb", ts: Date.now() }),
    communityReport({ status: "VERIFIED", deviceId: "device-cccc", target: "tree:2", ts: Date.now() }),
  ];
  const stats = communityConsensus.communityAdminStats(reports, communityConsensus.computeCommunityState(reports));
  assert.equal(stats.devices, 3);
  assert.equal(stats.reports, 3);
  assert.equal(stats.questioned, 1);
  assert.equal(stats.verified, 1);
  assert.equal(stats.byStatus.NOT_HERE, 2);
  assert.equal(stats.activeDevices1d, 3);
});

test("a contributor's own report is Confirmed once others agree and stays Pending until then", () => {
  const mine = communityReport({ status: "VERIFIED" });
  assert.equal(communityConsensus.reportOutcome(mine, undefined, []), "pending");
  assert.equal(communityConsensus.reportOutcome(mine, { s: "verified", n: 1 }, []), "pending");
  assert.equal(communityConsensus.reportOutcome(mine, { s: "confirmed", n: 2 }, []), "confirmed");
  const doubt = communityReport({ status: "NOT_HERE" });
  assert.equal(communityConsensus.reportOutcome(doubt, { s: "questioned", st: "NOT_HERE", n: 2 }, []), "confirmed");
  assert.equal(communityConsensus.reportOutcome(doubt, { s: "questioned", st: "DIFFERENT_TREE", n: 2 }, []), "pending");
  assert.equal(communityConsensus.reportOutcome(doubt, undefined, [doubt.target]), "review");
});

test("contributors move up from Seedling to Warden by points", () => {
  assert.equal(app.communityRank(0).name, "Seedling");
  assert.equal(app.communityRank(5).name, "Sapling");
  assert.equal(app.communityRank(19).name, "Sapling");
  assert.equal(app.communityRank(20).name, "Woodward");
  assert.equal(app.communityRank(50).name, "Warden");
  assert.equal(app.communityRank(50).next, null);
  assert.equal(app.communityRank(3).next.name, "Sapling");
});

test("each rank gets its own medal and the points chip shows what a check earns", () => {
  for (const name of ["Seedling", "Sapling", "Woodward", "Warden"]) {
    assert.match(app.communityMedalHtml(app.communityRank(name === "Seedling" ? 0 : name === "Sapling" ? 5 : name === "Woodward" ? 20 : 50)), new RegExp(`community-medal-${name.toLowerCase()}`));
  }
  assert.match(app.communityPointsChipFor("VERIFIED", "near"), />\+1</);
  assert.match(app.communityPointsChipFor("NOT_HERE", "near"), /up to \+2/);
  assert.match(app.communityPointsChipFor("VERIFIED", "far"), /is-zero[^>]*>\+0</);
  assert.match(app.communityPointsChipFor("VERIFIED", "none"), /is-zero/);
});

test("the streak week strip marks each of the last seven days that has a report, today last", () => {
  const now = new Date(2026, 9, 20, 12).getTime();
  const day = 86400000;
  const week = app.communityWeekDays({ a: { ts: now }, b: { ts: now - 2 * day }, c: { ts: now - 9 * day }, d: { ts: now - day, kind: "feedback" } }, now);
  assert.equal(week.length, 7);
  assert.equal(week.map((d) => d.done).join(), "false,false,false,false,true,false,true");
  assert.equal(week[6].today, true);
  assert.equal(week.filter((d) => d.today).length, 1);
});

test("every badge says how to earn it and shows progress towards it, capped at its goal", () => {
  const metrics = { verified: 4, confirmed: 0, treesAdded: 0, placesReported: 0, bestStreak: 12 };
  const byId = (id) => app.COMMUNITY_BADGES.find((b) => b.id === id);
  assert.ok(app.COMMUNITY_BADGES.every((b) => b.how && b.goal > 0 && b.metric));
  assert.equal(JSON.stringify(app.communityBadgeProgress(byId("ten-checks"), metrics)), '{"have":4,"goal":10}');
  assert.equal(JSON.stringify(app.communityBadgeProgress(byId("week-streak"), metrics)), '{"have":7,"goal":7}');
  assert.match(app.communityBadgeDetailHtml(byId("ten-checks"), metrics), /You're at 4 of 10/);
  assert.match(app.communityBadgeDetailHtml(byId("week-streak"), metrics), /earned/);
});

test("report dates read as Today, Yesterday, N days ago, then a short date", () => {
  const now = new Date(2026, 9, 20, 12).getTime();
  const day = 86400000;
  assert.equal(app.communityRelativeDay(now - 3600000, now), "Today");
  assert.equal(app.communityRelativeDay(now - day, now), "Yesterday");
  assert.equal(app.communityRelativeDay(now - 3 * day, now), "3 days ago");
  assert.match(app.communityRelativeDay(now - 30 * day, now), /Sep/);
});

const communityPointsConfig = require("../netlify/functions/lib/community-points");
const communityValidation = require("../netlify/functions/lib/community-validation");

test("the Community screen's ranks match the server's configured ranks", () => {
  for (const rank of communityPointsConfig.RANKS) {
    assert.equal(app.communityRank(rank.min).name, rank.name);
    assert.equal(app.communityRank(rank.min).icon, rank.icon);
  }
});

test("every point value comes from the one configuration file", () => {
  const verify = communityReport({ deviceId: "device-aaaa" });
  const second = communityReport({ deviceId: "device-bbbb" });
  const state = communityConsensus.computeCommunityState([verify, second]);
  assert.equal(state.scores["device-aaaa"].points, communityPointsConfig.POINTS.verify + communityPointsConfig.POINTS.verifyConfirmed);
  assert.equal(communityConsensus.REWARD_POINTS.register, communityPointsConfig.POINTS.register);
});

test("a City of London register update that agrees with a report earns the reporter the register reward", () => {
  const newTree = communityReport({ status: "NEW_TREE", target: undefined, tagNumber: "4821", accuracy: 8 });
  const notHere = communityReport({ target: "tree:77", status: "NOT_HERE" });
  const register = { hasTag: (t) => t === "4821", hasRecord: (rn) => rn !== "77", record: () => null };
  const found = communityValidation.validateAgainstRegister([newTree, notHere], register, 1000);
  assert.deepEqual(found.map((f) => f.status).sort(), ["NEW_TREE", "NOT_HERE"]);
  const state = communityConsensus.computeCommunityState([newTree, notHere], found);
  assert.equal(state.scores["device-aaaa"].points >= 2 * communityPointsConfig.POINTS.register, true);
  assert.equal(state.scores["device-aaaa"].validated, 2);
});

test("a report made after the register was first seen cannot claim a register reward", () => {
  const late = communityReport({ target: "tree:77", status: "NOT_HERE", ts: 5000 });
  const register = { hasTag: () => false, hasRecord: () => false, record: () => null };
  assert.deepEqual(communityValidation.validateAgainstRegister([late], register, 1000), []);
});

test("confirming a place scores nothing and a fixed feedback report earns the fix reward", () => {
  const place = communityReport({ kind: "place", target: "place:9", status: "OPEN_CONFIRMED" });
  const state = communityConsensus.computeCommunityState([place], [{ kind: "fix", deviceId: "device-cccc" }]);
  assert.equal((state.scores["device-aaaa"] || { points: 0 }).points, 0);
  assert.equal(state.scores["device-cccc"].points, communityPointsConfig.POINTS.fix);
});

const communityComputed = require("../netlify/functions/lib/community-computed");
const communityLedger = require("../netlify/functions/lib/community-ledger");

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) { return data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null; },
    async put(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async list(prefix) { return [...data.keys()].filter((k) => k.startsWith(prefix)); },
    async delete(key) { data.delete(key); },
  };
}

test("a rebuild stores each person's score in a small shard that one lookup can read", async () => {
  const store = memoryStore();
  const a = communityReport({ id: "report-aaaa1111", deviceId: "device-aaaa" });
  const b = communityReport({ id: "report-bbbb2222", deviceId: "device-bbbb" });
  await store.put("reports/1", a);
  await store.put("reports/2", b);
  const computed = await communityComputed.rebuildComputed(store);
  assert.equal(computed.scores, undefined, "the snapshot itself no longer carries every score");
  const score = await communityComputed.loadScore(store, "device-aaaa");
  assert.equal(score.points, communityPointsConfig.POINTS.verify + communityPointsConfig.POINTS.verifyConfirmed);
  assert.equal((await communityComputed.loadScore(store, "device-nobody")).points, 0);
  assert.match(communityComputed.scoreShard("device-aaaa"), /^[0-9a-f]{2}$/);
});

test("in production a request serves an old snapshot, however old, instead of rebuilding inline", async () => {
  // If the scheduled rebuild stops because the ledger outgrew it, an inline rebuild would fail the same way
  // on every visitor's request; an old snapshot is better than none.
  const store = memoryStore({ computed: { generatedAt: Date.now() - 6 * 60 * 60 * 1000, overlay: { "tree:1": { s: "verified" } }, conflicts: [] } });
  const original = process.env.CONTEXT;
  const warn = console.warn;
  try {
    process.env.CONTEXT = "production";
    console.warn = () => {};
    const stale = await communityComputed.loadComputed(store);
    console.warn = warn;
    assert.deepEqual(Object.keys(stale.overlay), ["tree:1"]);
    process.env.CONTEXT = "deploy-preview";
    const fresh = await communityComputed.loadComputed(store);
    assert.deepEqual(Object.keys(fresh.overlay), [], "previews and local dev rebuild once the snapshot is past its TTL");
  } finally {
    console.warn = warn;
    if (original === undefined) delete process.env.CONTEXT; else process.env.CONTEXT = original;
  }
});

function countingStore(initial = {}) {
  const store = memoryStore(initial);
  store.reportReads = 0;
  const get = store.get;
  store.get = async (key) => { if (key.startsWith("reports/")) store.reportReads += 1; return get(key); };
  return store;
}

test("a rebuild fetches only the reports it has not read before", async () => {
  const store = countingStore();
  for (let i = 0; i < 5; i += 1) await store.put(`reports/r${i}`, communityReport({ id: `report-${i}aaaa111`, deviceId: `device-${i}aaaa` }));
  const first = await communityComputed.rebuildComputed(store);
  assert.equal(first.reportCount, 5);
  assert.equal(store.reportReads, 5);

  await store.put("reports/r5", communityReport({ id: "report-5aaaa111", deviceId: "device-5aaaa" }));
  store.reportReads = 0;
  const second = await communityComputed.rebuildComputed(store);
  assert.equal(second.reportCount, 6, "the new report is counted");
  assert.equal(store.reportReads, 1, "and it is the only one fetched");
});

test("a report deleted from the ledger drops out of the next rebuild even though it was cached", async () => {
  const store = memoryStore();
  await store.put("reports/r1", communityReport({ id: "report-1aaaa111", deviceId: "device-1aaaa" }));
  await store.put("reports/r2", communityReport({ id: "report-2aaaa111", deviceId: "device-2aaaa" }));
  await communityComputed.rebuildComputed(store);
  await store.delete("reports/r2");
  const after = await communityComputed.rebuildComputed(store);
  assert.equal(after.reportCount, 1);
  assert.equal((await communityComputed.loadAdminStats(store)).devices, 1, "the deleted report's device no longer counts");
});

test("a lost ledger cache is refilled from the ledger rather than losing reports", async () => {
  const store = memoryStore();
  for (let i = 0; i < 3; i += 1) await store.put(`reports/r${i}`, communityReport({ id: `report-${i}aaaa111`, deviceId: `device-${i}aaaa` }));
  await communityComputed.rebuildComputed(store);
  for (const key of [...store.data.keys()].filter((k) => k.startsWith("ledger-cache/") && k !== "ledger-cache/index")) store.data.delete(key);
  assert.equal((await communityComputed.rebuildComputed(store)).reportCount, 3);
});

test("the admin dashboard's community figures come from the last rebuild, not a read of the whole ledger", async () => {
  const store = countingStore();
  await store.put("reports/r1", communityReport({ id: "report-1aaaa111", deviceId: "device-1aaaa" }));
  await communityComputed.rebuildComputed(store);
  store.reportReads = 0;
  const stats = await communityComputed.loadAdminStats(store);
  assert.equal(stats.reports, 1);
  assert.ok(stats.generatedAt > 0, "it says when the figures were taken");
  assert.equal(store.reportReads, 0);
});

test("the admin dashboard's community figures are built on demand when no rebuild has run yet", async () => {
  const store = memoryStore();
  await store.put("reports/r1", communityReport({ id: "report-1aaaa111", deviceId: "device-1aaaa" }));
  await store.put("reports/r2", communityReport({ id: "report-2aaaa111", deviceId: "device-2aaaa" }));
  const stats = await communityComputed.loadAdminStats(store);
  assert.equal(stats.reports, 2);
  assert.equal(stats.devices, 2);
});

test("a ledger bigger than one cache chunk is cached across several chunks and read back whole", async () => {
  const store = countingStore();
  const total = communityLedger.CHUNK_SIZE + 50;
  for (let i = 0; i < total; i += 1) {
    await store.put(`reports/r${i}`, communityReport({ id: `report-${String(i).padStart(6, "0")}x`, deviceId: `device-${i % 40}aaaa` }));
  }
  assert.equal((await communityComputed.rebuildComputed(store)).reportCount, total);
  assert.equal((await store.get("ledger-cache/index")).chunks, 2);
  store.reportReads = 0;
  assert.equal((await communityComputed.rebuildComputed(store)).reportCount, total, "every report comes back from the cache");
  assert.equal(store.reportReads, 0);
});

test("a deletion that shrinks the ledger cache by a chunk leaves no orphaned chunk holding deleted reports", async () => {
  const store = memoryStore();
  const total = communityLedger.CHUNK_SIZE + 1;
  for (let i = 0; i < total; i += 1) {
    await store.put(`reports/r${i}`, communityReport({ id: `report-${String(i).padStart(6, "0")}x`, deviceId: `device-${i % 40}aaaa` }));
  }
  await communityComputed.rebuildComputed(store);
  assert.ok(store.data.has("ledger-cache/1"), "two chunks before");
  await store.delete(`reports/r${total - 1}`);
  await communityComputed.rebuildComputed(store, { strict: true });
  assert.equal((await store.get("ledger-cache/index")).chunks, 1);
  assert.equal(store.data.has("ledger-cache/1"), false, "the emptied trailing chunk is removed from storage");
});

test("bulk reads run a bounded number at a time, so a large ledger never opens a request per record at once", async () => {
  const store = memoryStore();
  for (let i = 0; i < 200; i += 1) await store.put(`reports/r${i}`, communityReport({ id: `report-${String(i).padStart(6, "0")}x`, deviceId: `device-${i}aaaa` }));
  for (let i = 0; i < 60; i += 1) await store.put(`devicelink/device-${i}aaaa`, { account: `acct-${i % 3}` });
  let inFlight = 0;
  let most = 0;
  const get = store.get;
  store.get = async (key) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    return get(key);
  };
  const computed = await communityComputed.rebuildComputed(store);
  assert.equal(computed.reportCount, 200);
  assert.ok(most <= 25, `at most 25 reads at once, saw ${most}`);
  assert.ok(most > 1, "but they do run in parallel");
});

test("nudges: a card on the overview, a pulse on the tree's own page, and quiet otherwise", () => {
  const now = 10 * 60 * 60 * 1000;
  const base = { on: true, fixOk: true, isDefault: false, nearest: { metres: 6 }, target: "tree:1", alreadyReported: false, seenAt: 0, now, onThisTree: false, lastCardAt: 0, overviewActive: true };
  const decide = (over) => app.communityNudgeDecision({ ...base, ...over });
  assert.equal(decide({}), "card");
  assert.equal(decide({ onThisTree: true }), "pulse");
  assert.equal(decide({ on: false }), "none", "turned off");
  assert.equal(decide({ fixOk: false }), "none", "no accurate fix");
  assert.equal(decide({ isDefault: true }), "none", "the stand-in location is not a real position");
  assert.equal(decide({ nearest: { metres: 11 } }), "none", "further than 10 m");
  assert.equal(decide({ nearest: null }), "none");
  assert.equal(decide({ alreadyReported: true }), "none", "already checked on this device");
  assert.equal(decide({ seenAt: now - 60 * 1000 }), "none", "asked about this tree within the day");
  assert.equal(decide({ seenAt: now - 25 * 60 * 60 * 1000 }), "card", "a day later it may ask again");
  assert.equal(decide({ lastCardAt: now - 60 * 1000 }), "none", "at most one card every ten minutes");
  assert.equal(decide({ overviewActive: false }), "none", "never over another screen");
  assert.equal(decide({ onThisTree: true, lastCardAt: now - 60 * 1000, overviewActive: false }), "pulse", "the pulse ignores the card limits");
});

test("a recovery code is accepted as shown, in any case or spacing, and anything else is refused", () => {
  const id = "abcd1234efgh5678ijkl9012";
  assert.equal(app.communityParseRecoveryCode(id), id);
  assert.equal(app.communityParseRecoveryCode("abcd-1234-efgh-5678-ijkl-9012"), id);
  assert.equal(app.communityParseRecoveryCode("  ABCD-1234-EFGH-5678-IJKL-9012 "), id);
  assert.equal(app.communityParseRecoveryCode("abcd 1234 efgh 5678 ijkl 9012"), id);
  assert.equal(app.communityParseRecoveryCode(id.toUpperCase()), id, "an unhyphenated uppercase code is lowercased");
  assert.equal(app.communityParseRecoveryCode(`${id}x`), null, "25 characters is not a code");
  assert.equal(app.communityParseRecoveryCode(id.slice(0, 23)), null, "23 characters is not a code");
  assert.equal(app.communityParseRecoveryCode("short"), null);
  assert.equal(app.communityParseRecoveryCode("has spaces/and$symbols!!"), null);
  assert.equal(app.communityParseRecoveryCode(""), null);
});

test("a tree report only counts when it was made close to the tree, and says so when it was not", () => {
  const near = communityReport({ id: "report-near00001" });
  const far = communityReport({ id: "report-far000001", deviceId: "device-bbbb", lat: 51.7, lon: 0.1 });
  const noFix = communityReport({ id: "report-nofix0001", deviceId: "device-cccc", lat: undefined, lon: undefined });
  assert.equal(communityConsensus.isNear(near), true);
  assert.equal(communityConsensus.isNear(far), false);
  assert.equal(communityConsensus.isNear(noFix), false, "no reporter position cannot show the reporter was there");
  assert.equal(communityConsensus.reportOutcome(far, undefined, []), "far");
  assert.equal(communityConsensus.reportOutcome(noFix, undefined, []), "far");
  assert.equal(communityConsensus.reportOutcome(near, undefined, []), "pending");
  const state = communityConsensus.computeCommunityState([near, far, noFix]);
  assert.equal(state.scores["device-bbbb"].points, 0, "a far report earns nothing");
  assert.equal(state.scores["device-cccc"].points, 0, "a report with no position earns nothing");
  assert.equal(state.scores["device-bbbb"].reports, 1, "but it is still counted as a report");
  assert.equal(state.scores["device-aaaa"].points, communityPointsConfig.POINTS.verify, "the close report earns its point, and the far one does not confirm it");
});

// --- Place checks go to GitHub issues for manual review (netlify/functions/report-missing-data.js) ---
function escalationStoreForReports() {
  const data = new Map();
  return { async get(k) { return data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null; }, async put(k, v) { data.set(k, JSON.parse(JSON.stringify(v))); } };
}
async function withStubbedGithub(responder, run) {
  const reportFunction = require("../netlify/functions/report-missing-data");
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  const calls = [];
  process.env.GITHUB_TOKEN = "test-token";
  reportFunction.setRateLimitStore(escalationStoreForReports());
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    return responder(String(url), options.method || "GET");
  };
  try {
    return await run(reportFunction.handler, calls);
  } finally {
    reportFunction.setRateLimitStore(null);
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = originalToken;
  }
}
const jsonResponse = (status, body) => ({ ok: status < 300, status, json: async () => body });
const placeCheckEvent = (overrides = {}) => ({
  httpMethod: "POST",
  body: JSON.stringify({
    reportType: "place-check",
    placeCheck: { status: "CLOSED", key: "place:id:123", name: "The Test Arms", category: "Pubs" },
    details: "",
    location: { latitude: 51.66, longitude: 0.04 },
    requestId: "req-1234",
    ...overrides,
  }),
});

test("a place check is filed as a labelled GitHub issue for manual review, with no free text required", async () => {
  await withStubbedGithub(
    (url, method) => (url.includes("/search/issues") ? jsonResponse(200, { items: [] }) : jsonResponse(201, { number: 7, html_url: "https://github.com/x/y/issues/7" })),
    async (handler, calls) => {
      const result = await handler(placeCheckEvent());
      assert.equal(result.statusCode, 200);
      const created = calls.find((c) => c.method === "POST" && c.url.endsWith("/issues"));
      assert.ok(created, "an issue is created");
      assert.deepEqual(created.body.labels, ["place-check", "user-report", "place:123"]);
      assert.match(created.body.title, /^Place check: The Test Arms: It's closed/);
      assert.match(created.body.body, /place-key:place:id:123/);
      assert.match(created.body.body, /Reported status: CLOSED/);
    }
  );
});

test("a second report about the same place is added to its open issue instead of a new one", async () => {
  await withStubbedGithub(
    (url, method) => {
      if (url.includes("/search/issues") && decodeURIComponent(url).includes("place-key:")) return jsonResponse(200, { items: [{ number: 7, html_url: "https://github.com/x/y/issues/7" }] });
      if (url.includes("/search/issues")) return jsonResponse(200, { items: [] });
      return jsonResponse(201, { id: 1 });
    },
    async (handler, calls) => {
      const result = await handler(placeCheckEvent({ requestId: "req-5678", details: "Sign says closed down" }));
      const body = JSON.parse(result.body);
      assert.equal(body.merged, true);
      assert.equal(body.issueNumber, 7);
      assert.equal(calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues")).length, 0, "no new issue");
      const comment = calls.find((c) => c.url.endsWith("/issues/7/comments"));
      assert.ok(comment, "a comment is added");
      assert.match(comment.body.body, /Sign says closed down/);
    }
  );
});

test("a place check keyed by a real OSM or manual place id is accepted", async () => {
  await withStubbedGithub(
    (url, method) => (url.includes("/search/issues") ? jsonResponse(200, { items: [] }) : jsonResponse(201, { number: 8, html_url: "https://github.com/x/y/issues/8" })),
    async (handler, calls) => {
      for (const key of ["place:id:node/5903400322", "place:id:manual/onest"]) {
        const result = await handler(placeCheckEvent({ placeCheck: { status: "DETAILS_CHANGED", key, name: "Onest" } }));
        assert.equal(result.statusCode, 200, key);
      }
      assert.equal(calls.filter((c) => c.method === "POST" && c.url.endsWith("/issues")).length, 2);
    }
  );
});

test("a place-check issue is labelled with the place so all its issues can be listed", async () => {
  await withStubbedGithub(
    (url) => (url.includes("/search/issues") ? jsonResponse(200, { items: [] }) : jsonResponse(201, { number: 9, html_url: "https://github.com/x/y/issues/9" })),
    async (handler, calls) => {
      const result = await handler(placeCheckEvent({ placeCheck: { status: "CLOSED", key: "place:id:node/5903400322", name: "Onest" } }));
      assert.equal(result.statusCode, 200);
      const created = calls.find((c) => c.method === "POST" && c.url.endsWith("/issues"));
      const labels = created.body.labels;
      assert.deepEqual(labels, ["place-check", "user-report", "place:node/5903400322"]);
    }
  );
  const reportFunction = require("../netlify/functions/report-missing-data");
  assert.equal(reportFunction.placeLabelName("place:id:manual/onest"), "place:manual/onest");
  assert.ok(reportFunction.placeLabelName(`place:id:${"x".repeat(100)}`).length <= 50, "GitHub label names are capped at 50 characters");
});

test("a place check with an unknown status or an unsafe key is rejected", async () => {
  await withStubbedGithub(() => jsonResponse(200, { items: [] }), async (handler) => {
    assert.equal((await handler(placeCheckEvent({ placeCheck: { status: "OPEN_CONFIRMED", key: "place:id:1", name: "x" } }))).statusCode, 400);
    assert.equal((await handler(placeCheckEvent({ placeCheck: { status: "CLOSED", key: 'place:" OR is:private', name: "x" } }))).statusCode, 400);
  });
});

test("a missing place is filed as a place-check issue keyed on its position, and needs a name", async () => {
  await withStubbedGithub(
    (url) => (url.includes("/search/issues") ? jsonResponse(200, { items: [] }) : jsonResponse(201, { number: 8, html_url: "https://github.com/x/y/issues/8" })),
    async (handler, calls) => {
      const key = "new:51.66512,0.04512";
      const ok = await handler(placeCheckEvent({ placeCheck: { status: "NEW_PLACE", key, name: "The New Arms", category: "Pub" }, details: "Opened last week" }));
      assert.equal(ok.statusCode, 200);
      const created = calls.find((c) => c.method === "POST" && c.url.endsWith("/issues"));
      assert.match(created.body.title, /^Place check: The New Arms: A place is missing from the map/);
      assert.ok(created.body.labels.includes("place:new:51.66512,0.04512"));
      assert.match(created.body.body, /Reported status: NEW_PLACE/);
      assert.match(created.body.body, /Opened last week/);
      const nameless = await handler(placeCheckEvent({ placeCheck: { status: "NEW_PLACE", key, name: "  " } }));
      assert.equal(nameless.statusCode, 400);
    }
  );
});

const reportRateLimit = require("../netlify/functions/lib/report-rate-limit");

test("a device that sends too many reports in an hour is refused with 429 and a Retry-After", async () => {
  await withStubbedGithub(
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

test("many people behind one mobile-network address can all report, well past one device's hourly allowance", async () => {
  const reportEndpoint = require("../netlify/functions/community-report");
  reportEndpoint.setStore(memoryStore());
  try {
    for (let n = 0; n < 150; n += 1) {
      const result = await reportEndpoint.handler({
        httpMethod: "POST",
        headers: { "x-nf-client-connection-ip": "198.51.100.20" },
        body: JSON.stringify({ id: `report-cgnat-${String(n).padStart(4, "0")}`, deviceId: `device-cgnat-${n}-x`, kind: "tree", target: `tree:${n}`, status: "VERIFIED", targetLat: 51.64, targetLon: 0.01, lat: 51.64, lon: 0.01 }),
      });
      assert.equal(result.statusCode, 200, `report ${n + 1} from the shared address`);
    }
  } finally {
    reportEndpoint.setStore(null);
  }
});

test("'My reports' keeps a device's latest 1,000 reports, dropping the oldest", async () => {
  const reportEndpoint = require("../netlify/functions/community-report");
  const store = memoryStore();
  const deviceId = "device-prolific-1";
  await store.put(`mine/${deviceId}`, Array.from({ length: 1000 }, (_, i) => ({ id: `old-${i}`, kind: "tree", status: "VERIFIED", ts: i })));
  reportEndpoint.setStore(store);
  try {
    const result = await reportEndpoint.handler({
      httpMethod: "POST",
      headers: { "x-nf-client-connection-ip": "198.51.100.21" },
      body: JSON.stringify({ id: "report-newest-0001", deviceId, kind: "tree", target: "tree:9", status: "VERIFIED", targetLat: 51.64, targetLon: 0.01, lat: 51.64, lon: 0.01 }),
    });
    assert.equal(result.statusCode, 200);
    const mine = await store.get(`mine/${deviceId}`);
    assert.equal(mine.length, 1000);
    assert.equal(mine[mine.length - 1].id, "report-newest-0001");
    assert.equal(mine[0].id, "old-1", "the oldest entry made room");
  } finally {
    reportEndpoint.setStore(null);
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

test("a data deletion leaves no cached copy of the deleted person's reports", async () => {
  const store = await deletionFixture();
  const cachedIds = () => [...store.data.keys()].filter((k) => /^ledger-cache\/\d+$/.test(k))
    .flatMap((k) => store.data.get(k).entries.map(([, report]) => report.deviceId));
  assert.ok(cachedIds().includes("phone-device-a1"), "the rebuild cached the report first");
  await communityDelete.deleteCommunityData(store, { deviceId: "phone-device-a1" });
  assert.ok(!cachedIds().includes("phone-device-a1"));
  assert.ok(cachedIds().includes("other-device-b1"), "other people's reports stay cached");
});

test("deletion finds every issue a device filed, even past the mine index cap", async () => {
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

// Cross-file invariant: the cow proxy refuses any centre but the app's own (netlify/functions/cows.js).
test("the cow request the app builds is one the proxy accepts", async () => {
  const cows = require("../netlify/functions/cows");
  const url = new URL(app.cowEndpointUrl(app.cowCenterForRequest()), "http://localhost");
  const original = global.fetch;
  global.fetch = async () => new Response("{}", { status: 200 });
  try {
    const result = await cows.handler({ httpMethod: "GET", queryStringParameters: { center: url.searchParams.get("center") } });
    assert.equal(result.statusCode, 200);
  } finally {
    global.fetch = original;
  }
});
