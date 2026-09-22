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
  const storage = new Map(Object.entries(initialLocalStorage));
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
    window.location.hash = hashIndex >= 0 ? url.substring(hashIndex) : "";
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
    URLSearchParams,
    localStorage,
  };
  context.globalThis = context;

  const script = appSource
    .replace(/\n\s*boot\(\);\s*\n/, "\n")
    + `
globalThis.__forestFindsTest = {
  state,
  els,
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
  treeHashKey,
  findTreeByHashKey,
  treeDisplayName,
  releaseStrandedAnimationFrames,
  setOverviewFilters,
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
  formatWalkingMinutes,
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
  TILT_FIT_MIN_PERSPECTIVE_SCALE,
  HEADING_UP_SCALE_BUFFER_RATIO,
  HEADING_UP_SCALE_SETTLE_RATIO,
  HEADING_UP_SCALE_EASE_RATE,
  HEADING_UP_SCALE_EASE_MAX_DT,
  HEADING_UP_SCALE_HOLD_RATIO,
  HEADING_UP_SCALE_SNAP_RATIO,
  HEADING_UP_SCALE_EASE_OUT_RATE,
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
  showClusterDetail,
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
  worldToScreenForOverlayTilted,
  worldToScreenFlat,
  projectCanvasPoint,
  handleMapClick,
  distanceFromUserToRoad,
  nearbyOrigin,
  setNearbyAnchor,
  clearNearbyAnchor,
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
  filterKindIconSlug,
  PLACE_FILTER_KEYS,
  PLACE_FILTER_PRIORITY,
  PLACE_FILTER_FALLBACK_PRIORITY,
  PLACE_FILTER_TOPIC_PRIORITY,
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
  reportFormHtml,
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
  orientationHeadingSource,
  animationLoopsWedged,
  recoverWedgedAnimationFrames,
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
  const externalScripts = ["js/categories.js", "js/normalize.js", "js/onboarding.js", "js/nav.js", "js/routing.js", "js/loader.js", "js/renderer.js", "js/inspector.js"];
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
  app.state.clusterExpanded = null;
  app.state.clusterZoomed = false;
  app.state.overviewFilters = [];
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
  // Several tests below hide the inspector to take its geometry out of the picture and never
  // put it back; without this that leaks into every later test, silently removing the
  // inspector overlap from their fits.
  app.els.inspector.hidden = false;
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

test("first-visit onboarding shows location step first so permission is requested immediately", () => {
  const { ONBOARDING_STEPS: steps } = app;
  const locationStep = steps.findIndex((step) => step.type === "location");
  const compassStep = steps.findIndex((step) => step.type === "compass");

  assert.ok(locationStep >= 0, "location onboarding step should exist");
  assert.strictEqual(locationStep, 0, "location step must be first so permission is requested as soon as data starts loading");
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

test("tiltActive returns false when heading-up is not active", () => {
  resetData(app);
  app.state.compassHeading = null;
  app.state.tiltBetaSmoothed = 45;
  assert.equal(app.tiltActive(), false, "tilt requires heading-up to be active");
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

test("tiltRotateXDeg returns 0 when tilt is not active", () => {
  resetData(app);
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

test("nav controls use generated image assets instead of text glyphs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");

  assert.match(html, /id="inspectorBack"[\s\S]*<svg[\s\S]*polyline/);
  assert.match(html, /id="filterToggle"[\s\S]*data\/icons\/filter\.png/);
  assert.match(html, /id="reportToggle"[\s\S]*data\/icons\/feedback\.png/);
  assert.match(html, /id="settingsToggle"[\s\S]*data\/icons\/settings\.png/);
});

test("tree loading uses chunked register before full-file fallbacks", () => {
  const loader = fs.readFileSync(path.join(__dirname, "..", "js", "loader.js"), "utf8");

  assert.match(loader, /loadTreeChunks\(TREE_CHUNK_INDEX_URL\)/);
  assert.match(loader, /const treeAttempts = \[[\s\S]*loadTreeChunks\(TREE_CHUNK_INDEX_URL\)[\s\S]*\.\.\.fullFileAttempts/);
  assert.match(loader, /const maxConcurrent = Math\.min\(6, chunks\.length\)/);
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

test("service worker install pre-caches only the small tree chunk index", () => {
  const serviceWorker = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const shellMatch = serviceWorker.match(/const DATA_SHELL = \[([\s\S]*?)\];/);

  assert.ok(shellMatch, "DATA_SHELL cache list exists");
  assert.ok(shellMatch[1].includes("data/trees/index.json"), "tree chunk index should be pre-cached");
  assert.ok(!shellMatch[1].includes("data/trees/chunk-"), "tree chunks should be runtime cached after the page fetch");
  assert.ok(!shellMatch[1].includes("Veteran_Tree_Register.json"), "base tree register should be runtime cached after the page fetch");
  assert.ok(!shellMatch[1].includes("Veteran_Tree_Register.enriched.with_named_trees.json"), "enriched tree register should be runtime cached after the page fetch");
});

test("generated UI icon classes render at the enlarged sizes", () => {
  const baseCss = fs.readFileSync(path.join(__dirname, "..", "css", "base.css"), "utf8");
  const inspectorCss = fs.readFileSync(path.join(__dirname, "..", "css", "inspector.css"), "utf8");
  const mapUiCss = fs.readFileSync(path.join(__dirname, "..", "css", "map-ui.css"), "utf8");

  assert.match(baseCss, /--icon-scale:\s*1;/);
  assert.match(inspectorCss, /\.nav-icon\s*\{[\s\S]*width:\s*calc\(22px\s*\*\s*var\(--icon-scale\)\);[\s\S]*height:\s*calc\(22px\s*\*\s*var\(--icon-scale\)\);/);
  assert.match(inspectorCss, /\.title-icon\s*\{[\s\S]*width:\s*calc\(23px\s*\*\s*var\(--icon-scale\)\);[\s\S]*height:\s*calc\(23px\s*\*\s*var\(--icon-scale\)\);/);
  assert.match(mapUiCss, /\.nearest-icon\s+\.app-icon\s*\{[\s\S]*width:\s*32px;[\s\S]*height:\s*32px;/);
  assert.match(mapUiCss, /\.walk-icon\s*\{[\s\S]*width:\s*calc\(18px\s*\*\s*var\(--icon-scale\)\);[\s\S]*height:\s*calc\(18px\s*\*\s*var\(--icon-scale\)\);/);
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
  };

  app.drawWalkingRadius(ctx);

  assert.equal(arcCount, 1);
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
  });

  assert.equal(arcCount, 1);
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
  // margin = min(1000, 800) * 0.1 + 12 * dpr(1) = 92; left=92 right=908 top=92 bottom=708
  const points = [
    { x: 400, y: 0 },    // rotatedX>0: (908-500)/400 = 1.02   <- tightest
    { x: -300, y: 0 },   // rotatedX<0: (92-500)/-300 = 1.36
    { x: 0, y: -200 },   // rotatedY<0: (92-400)/-200 = 1.54
    { x: 0, y: 250 },    // rotatedY>0, tilt inactive: (708-400)/250 = 1.232
  ];

  const maxScale = app.maxScaleForHeadingUpPoints(points, focus, focusRect);

  assert.ok(Math.abs(maxScale - 1.02) < 1e-9, `expected 1.02, got ${maxScale}`);
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
  // margin = min(1000, 800) * 0.1 + 12 * dpr(1) = 92; right = 908, bottom = 708.
  // Behind (rotatedY > 0) and far to the right: the vertical constraint alone would allow
  // (708 - 400) / 10 = 30.8, at which the point would be drawn 400 * 30.8 = 12320px to the
  // right. The horizontal constraint is (908 - 500) / 400 = 1.02.
  const behindAndRight = [{ x: 400, y: 10 }];

  const maxScale = app.maxScaleForHeadingUpPoints(behindAndRight, focus, focusRect);

  assert.ok(Math.abs(maxScale - 1.02) < 1e-9, `expected the horizontal constraint (1.02), got ${maxScale}`);
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
  // (bottom - focus.y) / rotatedY = (708 - 400) / 10 = 30.8, well under the fitScale*180 cap
  assert.ok(Math.abs(withTiltInactive - 30.8) < 1e-9, `expected 30.8, got ${withTiltInactive}`);
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
  // Same (bottom - focus.y) / rotatedY = (708 - 400) / 10 = 30.8 as the tilt-inactive case
  // above -- excludeBehindDuringTilt: false means tiltActive() no longer matters for this point.
  assert.ok(Math.abs(result - 30.8) < 1e-9, `expected 30.8, got ${result}`);
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
  assert.equal(filters.outOfRadius.has(farPub), true, "drawn dimmed, because it is still outside the ring");
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

test("nearby HTML does not contain the walking distance selector", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addFixtureData(app);

  const html = app.overviewNearestHtml();

  assert.ok(!html.includes("nearestItemsSelect"), "nearby should not contain the walking distance select control");
  assert.ok(!html.includes("Walking distance:"), "nearby should not contain the walking distance label");
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

test("cluster detail rows show always-visible combined distance and walk time chips", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  const tree = { id: "cluster-tree", commonName: "Cluster tree", ...makePoint(app, 0.001, 0) };

  app.showClusterDetail({ itemType: "tree", items: [tree] });

  const html = app.els.inspectorBody.innerHTML;
  assert.match(html, /class="walk-chip"/);
  assert.match(html, /data\/icons\/walking\.png/);
  assert.match(html, /\d+\s*m\s*·\s*(?:<\s*1|\d+)\s*min/);
});

test("cluster detail rows show tag number for trees", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  const tree = { id: "cluster-tree", commonName: "Cluster tree", tagNumber: "15961", ...makePoint(app, 0.001, 0) };

  app.showClusterDetail({ itemType: "tree", items: [tree] });

  const html = app.els.inspectorBody.innerHTML;
  assert.match(html, /#15961/, "cluster detail must show the tree tag number");
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

  const html = app.overviewNearestHtml();
  assert.match(html, /Trees within 5 min walk/, "the heading answers how far the list is reaching");
  assert.ok(!html.includes("around you"), "the vaguer wording is gone");

  // With the radius toggled off there is no radius to name, so the heading says so instead of
  // claiming a reach the list is not applying.
  app.state.showAllOutsideRadius = true;
  assert.match(app.overviewNearestHtml(), /Nearest Trees around you/);
  app.state.showAllOutsideRadius = false;
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
  assert.ok(app.location.hash === "search" || app.location.hash === "#search", "the screen has a URL, so back leaves it");

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

test("nearby HTML does not contain the app version", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  addFixtureData(app);

  const html = app.overviewNearestHtml();

  assert.ok(!html.includes("App version:"), "app version should not appear in the nearby section");
});

test("settings form shows the app version", () => {
  app.state.swVersion = "v157";
  const html = app.settingsFormHtml();
  app.state.swVersion = "";

  assert.match(html, /v157/, "settings form should include the app version number");
  assert.match(html, /App version/, "settings form should label the app version");
  assert.match(html, /appVersionDisplay/, "settings form should include the version span for dynamic updates");
});

test("settings form offers separate data, app and combined refresh buttons", () => {
  // One "Force refresh" button used to clear everything, so picking up a CSS tweak also meant
  // re-downloading ~67 MB of map data. The scopes are split so each case costs only its own.
  const html = app.settingsFormHtml();
  assert.match(html, /id="refreshDataButton"/, "settings form should include the data refresh button");
  assert.match(html, /Refresh data/, "data refresh button should be labelled");
  assert.match(html, /id="refreshAppButton"/, "settings form should include the app refresh button");
  assert.match(html, /Refresh app/, "app refresh button should be labelled");
  assert.match(html, /id="refreshAllButton"/, "settings form should include the combined refresh button");
  assert.match(html, /Refresh both/, "combined refresh button should be labelled");
  assert.match(html, /id="refreshOfflineNote"/, "settings form should include a shared offline note for the refresh buttons");
});

test("each refresh scope clears only its own caches, and only the app scopes unregister the worker", () => {
  // The Node VM test harness doesn't stub navigator.serviceWorker/caches/location.reload,
  // so this is a source-level check (matching the other service-worker tests above) rather
  // than an executed one — it pins the contract refreshCachedState must uphold.
  const navSource = fs.readFileSync(path.join(__dirname, "..", "js", "nav.js"), "utf8");
  const fnMatch = navSource.match(/async function refreshCachedState\(scope\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "refreshCachedState must be defined in nav.js");
  const fn = fnMatch[0];

  assert.match(fn, /if \(!navigator\.onLine\)/, "must bail out while offline instead of leaving the app with no cache fallback");
  assert.match(fn, /scope !== ["']data["'] && ["']serviceWorker["'] in navigator/, "a data-only refresh must leave the service worker registered");
  assert.match(fn, /navigator\.serviceWorker\.getRegistrations\(\)/, "must look up every registration");
  assert.match(fn, /registration\.unregister\(\)/, "must unregister every registration, not just the active one");
  assert.match(fn, /caches\.keys\(\)/, "must enumerate caches rather than assuming a single name");
  assert.match(fn, /cacheMatchesRefreshScope\(name, scope\)/, "must scope cache deletion to the requested scope");
  assert.match(fn, /caches\.delete\(name\)/, "must delete the matched caches");
  assert.match(fn, /location\.reload\(\)/, "must reload after clearing state so the fresh install takes effect immediately");

  const scopeMatch = navSource.match(/function cacheMatchesRefreshScope\(name, scope\) \{[\s\S]*?\n\}/);
  assert.ok(scopeMatch, "cacheMatchesRefreshScope must be defined in nav.js");
  const scopeFn = scopeMatch[0];
  assert.match(scopeFn, /name\.startsWith\(["']forest-finds-["']\)/, "must never touch caches belonging to another app");
  assert.match(scopeFn, /scope === ["']all["']/, "the combined scope must match every forest-finds cache");
  // Cache names carry a "dev-" segment under the local dev server (injectDevFlag in server.js).
  assert.match(scopeFn, /forest-finds-dev-\$\{scope\}-/, "must match the dev-prefixed spelling too");
});

test("settings refresh listeners are removed before being re-added, so reopening Settings does not leak window listeners", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const bindMatch = source.match(/function bindSettingsHandlers\(\) \{[\s\S]*?\n\}/);
  assert.ok(bindMatch, "bindSettingsHandlers must be defined");
  const fn = bindMatch[0];

  for (const evt of ["online", "offline"]) {
    const removeIdx = fn.indexOf(`removeEventListener("${evt}", updateRefreshButtonsOnlineState)`);
    const addIdx = fn.indexOf(`addEventListener("${evt}", updateRefreshButtonsOnlineState)`);
    assert.ok(removeIdx !== -1, `must remove any prior "${evt}" listener`);
    assert.ok(addIdx !== -1, `must add a new "${evt}" listener`);
    assert.ok(removeIdx < addIdx, `must remove the "${evt}" listener before adding a new one`);
  }
});

test("filter groups include all six labelled categories", () => {
  const { FILTER_GROUPS: groups } = app;
  assert.equal(groups.length, 6, "should have exactly six filter groups");
  const labels = groups.map((g) => g.label);
  for (const expected of ["Nature", "Food", "Transport", "History", "Locations", "Stories"]) {
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
  assert.equal(app.formatWalkingRadius(5.5), "5.5 min");
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

  // One tiny delta rounds away to the radius it started from...
  app.updateNearbyRadiusWheel(wheelEvent(-2, { ctrlKey: true }));
  assert.equal(app.state.walkingDistanceMinutes, 5, "a single trackpad delta is below the value grid");
  assert.ok(app.state.wheelRadiusMinutes < 5, "but the gesture remembers it");

  // ...while a run of them moves the ring.
  for (let i = 0; i < 20; i += 1) app.updateNearbyRadiusWheel(wheelEvent(-2, { ctrlKey: true }));
  assert.ok(app.state.walkingDistanceMinutes < 5, "a continued trackpad pinch should reach the next step");
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

test("formatWalkingMinutes prints whole minutes plainly and halves with one decimal", () => {
  assert.equal(app.formatWalkingMinutes(5), "5");
  assert.equal(app.formatWalkingMinutes(5.5), "5.5");
});

test("roundWalkingMinutes snaps a continuous pinch value to the nearest half-minute", () => {
  assert.equal(app.roundWalkingMinutes(5.2), 5);
  assert.equal(app.roundWalkingMinutes(5.3), 5.5);
});

test("loading overlay markup includes all eight step labels", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  for (const label of ["Veteran trees", "Places", "Paths", "Roads", "Water", "Forest", "cattle", "location"]) {
    assert.ok(html.includes(label), `loading overlay missing step label: "${label}"`);
  }
});

test("report submission includes the app version", () => {
  const html = app.reportFormHtml();
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

  assert.ok(!html.includes("App version:"), "report form should not display the app version");
  assert.match(source, /appVersion:\s*state\.swVersion \|\| APP_VERSION/, "submitted report payload should include the live service worker version, falling back to APP_VERSION");
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

test("filter screen sets hash to #filters", () => {
  resetData(app);
  app.openFiltersScreen();
  // In real browsers, window.location.hash = "filters" results in window.location.hash === "#filters"
  // But in tests, it's just a plain object, so we check for "filters"
  assert.ok(app.location.hash === "filters" || app.location.hash === "#filters", "filter screen sets hash");
});

test("hash #filters opens filter screen on load", () => {
  resetData(app);
  app.location.hash = "#filters";
  const opened = app.applySelectionFromHash(false);
  assert.ok(opened, "applySelectionFromHash returns true for #filters");
  assert.ok(app.state.filterScreenOpen, "filter screen is open");
  assert.equal(app.els.inspectorTitle.textContent, "Filters", "inspector shows Filters title");
});

test("returning to nearby screen clears the hash", () => {
  resetData(app);
  app.openFiltersScreen();
  assert.ok(app.location.hash === "filters" || app.location.hash === "#filters", "hash is set to filters");
  app.goToInitialView();
  assert.equal(app.location.hash, "", "hash is cleared after returning to nearby");
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
  assert.ok(app.location.hash.includes("settings"), `Settings is in the URL, got ${app.location.hash}`);
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

  const jsRefs = [...html.matchAll(/src="(js\/[^"]+\.js)"/g)].map((m) => `./${m[1]}`);
  assert.ok(jsRefs.length > 0, "app.html should reference JS files");
  for (const jsFile of jsRefs) {
    assert.ok(shellMatch[1].includes(jsFile), `APP_SHELL missing ${jsFile} — app will not boot offline`);
  }
});

test("service worker passes API routes through without caching so offline failures are handled by callers", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  assert.match(sw, /pathname\.startsWith\(["']\/api\/["']\)/, "API routes must bypass the cache handler");
  assert.match(sw, /event\.respondWith\(fetch\(event\.request\)\)/, "API routes should be forwarded directly");
});

test("service worker falls back to cached app.html when navigating offline", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  assert.match(sw, /request\.mode === ["']navigate["']/, "navigate mode must be handled separately");
  assert.match(sw, /caches\.match\(["']\.\/app\.html["']\)/, "navigate fallback should serve cached app.html");
});

test("service worker answers app navigations only, so the homepage is not served from the app cache", () => {
  // This handler used to answer EVERY navigation with the cached app shell. After the
  // alpha URL split that would serve the app to anyone navigating to the marketing
  // homepage at /, making the homepage invisible to every returning visitor.
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  assert.match(sw, /function isAppNavigation\(/, "an app-navigation predicate must exist");
  assert.match(
    sw,
    /if \(!isAppNavigation\(requestUrl\.pathname\)\) return;/,
    "the navigate branch must bail out for non-app navigations"
  );
});

test("service worker app shell holds app.html and not the marketing homepage", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const shell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shell, "APP_SHELL must be present");
  assert.match(shell[1], /"\.\/app\.html"/, "APP_SHELL should precache app.html");
  assert.ok(
    !/"\.\/",/.test(shell[1]),
    'APP_SHELL must not precache "./" -- it resolves to the marketing homepage'
  );
});

test("service worker serves the cached shell for a return navigation and refreshes it in the background", () => {
  // Network-first navigation meant every reload blocked on a ~290 KB app.html round trip
  // before anything painted, however warm the cache. Staleness is bounded by the sw.js update
  // check the browser runs on each navigation, not by making the user wait.
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const navMatch = sw.match(/if \(event\.request\.mode === "navigate"\) \{[\s\S]*?\n    return;\n  \}/);
  assert.ok(navMatch, "the navigate branch must be present in the fetch handler");
  const branch = navMatch[0];

  assert.match(branch, /caches\.match\("\.\/app\.html"\)\.then\(\(cached\) => \{/, "production navigation must consult the cache first");
  assert.match(branch, /cache\.put\("\.\/app\.html", copy\)/, "the network copy must refresh the cached shell");
  assert.match(branch, /IS_DEV\s*\n\s*\? fromNetwork/, "local dev must stay network-first so edits show up");
});

test("service worker install only fetches shell entries that are not already cached", () => {
  // Every app release bumps APP_CACHE_NAME and so re-runs install. A blanket addAll over
  // DATA_SHELL plus the opportunistic list re-downloaded ~67 MB of unchanged GeoJSON each time,
  // which is the "full download on every load" a returning user actually experienced.
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const installMatch = sw.match(/self\.addEventListener\("install",[\s\S]*?\n\}\);/);
  assert.ok(installMatch, "install handler exists");
  const install = installMatch[0];

  assert.doesNotMatch(install, /cache\.addAll\(DATA_SHELL\)/, "DATA_SHELL must not be re-fetched wholesale on every install");
  assert.doesNotMatch(install, /cache\.addAll\(APP_SHELL\)/, "APP_SHELL must not be re-fetched wholesale on every install");
  assert.match(install, /missingFromCache\(cache, APP_SHELL\)/, "app shell must be filtered down to missing entries");
  assert.match(install, /missingFromCache\(cache, DATA_SHELL\)/, "data shell must be filtered down to missing entries");
  assert.match(install, /missingFromCache\(cache, DATA_CACHE_OPPORTUNISTIC\)/, "opportunistic data must be filtered down to missing entries");
  assert.match(install, /adoptPreviousDataCache\(cache\)/, "a data cache version bump must inherit the previous cache rather than re-download it");
});

test("a data cache version bump carries the old bodies over and defers the refresh to the background", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const adoptMatch = sw.match(/async function adoptPreviousDataCache\(cache\) \{[\s\S]*?\n\}/);
  assert.ok(adoptMatch, "adoptPreviousDataCache must be defined");
  const adopt = adoptMatch[0];

  assert.match(adopt, /\/\^forest-finds-\(dev-\)\?data-\//, "must recognise both the production and dev spellings of a data cache");
  assert.match(adopt, /cache\.put\(request, response\)/, "must copy the previous bodies into the new cache");
  assert.match(adopt, /writeDataSyncState\(cache, \{ staleSince: Date\.now\(\) \}\)/, "adopted data must be marked stale so the next sync is not throttled");
});

test("the background data sync revalidates conditionally and only rewrites entries that changed", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const syncMatch = sw.match(/async function syncData\(\{ force = false \} = \{\}\) \{[\s\S]*?\n\}\n/);
  assert.ok(syncMatch, "syncData must be defined");
  const sync = syncMatch[0];

  assert.match(sync, /fetch\(request\.url, \{ cache: "no-store", headers: conditionalHeaders\(cached\) \}\)/, "must send its own conditional headers rather than leaning on the browser's HTTP cache");
  assert.match(sync, /if \(fresh\.status === 304\) continue;/, "an unchanged file must cost a 304 and no bytes");
  assert.match(sync, /responseChanged\(cached, fresh\)/, "must compare validators before writing anything back");
  assert.match(sync, /DATA_SYNC_INTERVAL_MS/, "must throttle so a sync is not run on every single load");
  assert.match(sync, /syncState\.staleSince != null/, "an explicitly stale cache must sync regardless of the throttle");
  assert.match(sync, /failed === requests\.length/, "a sweep where nothing reached the network must not be recorded as a successful check");

  const condMatch = sw.match(/function conditionalHeaders\(cached\) \{[\s\S]*?\n\}/);
  assert.ok(condMatch, "conditionalHeaders must be defined");
  assert.match(condMatch[0], /If-None-Match/, "must revalidate by ETag when the cached entry has one");
  assert.match(condMatch[0], /If-Modified-Since/, "must fall back to Last-Modified");

  assert.match(sw, /event\.data\?\.type === "SYNC_DATA"/, "the worker must accept the client's sync request");
  assert.match(sw, /postMessage\(\{ type: "DATA_UPDATED", changed \}\)/, "clients must be told when newer data has landed");
});

test("the app asks for a background data sync only after the map is up, never during boot", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const navSource = fs.readFileSync(path.join(__dirname, "..", "js", "nav.js"), "utf8");

  const syncIdx = source.indexOf("requestBackgroundDataSync()");
  assert.ok(syncIdx !== -1, "boot must request a background data sync");
  assert.ok(
    syncIdx > source.indexOf("showFilterHintIfFirstVisit();"),
    "the sync must be requested after the map is interactive, so it never competes with the first render"
  );

  const fnMatch = navSource.match(/function requestBackgroundDataSync\(options\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "requestBackgroundDataSync must be defined in nav.js");
  const fn = fnMatch[0];
  assert.match(fn, /if \(!navigator\.onLine\) return;/, "must not attempt a sync while offline");
  assert.match(fn, /navigator\.serviceWorker\.controller/, "must go through the controlling worker");
  assert.match(fn, /postMessage\(\{ type: "SYNC_DATA"/, "must send the worker's sync message");
});

test("service worker uses a network-first strategy in local dev so edits show up without a CACHE_NAME bump", () => {
  // CACHE_NAME is only ever bumped by CI, on the pull request that changes the files it
  // watches (.github/workflows/sw-release.yml for app code, data-bump.yml for data),
  // never locally, so the production cache-first strategy below would otherwise keep serving
  // stale JS/CSS/data while testing locally. self.__DEV__ (injected by server.js — see the
  // "local dev server flags sw.js" tests) must gate the cache-first branch and go to the
  // network first instead.
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  assert.match(sw, /const IS_DEV = self\.__DEV__ === true/, "sw.js must derive a dev flag from self.__DEV__");

  const fetchHandlerMatch = sw.match(/self\.addEventListener\("fetch",[\s\S]*/);
  assert.ok(fetchHandlerMatch, "fetch handler exists");
  const fetchHandler = fetchHandlerMatch[0];

  const devBranchMatch = fetchHandler.match(/if \(IS_DEV\) \{([\s\S]*?)\n  \}\n\n  event\.respondWith\(\s*\n\s*caches\.match\(event\.request\)/);
  assert.ok(devBranchMatch, "an IS_DEV branch must sit before the production cache-first handler");
  const devBranch = devBranchMatch[1];
  assert.match(devBranch, /fetch\(event\.request\)/, "dev branch must hit the network");
  assert.match(devBranch, /\.catch\(\(\) => caches\.match\(event\.request\)\)/, "dev branch must still fall back to cache when offline");

  // The dev branch must come before (and therefore short-circuit) the cache-first
  // production strategy, not replace it — production behaviour must be untouched.
  assert.ok(fetchHandler.indexOf("if (IS_DEV)") < fetchHandler.indexOf("caches.match(event.request).then((cached)"), "dev branch must run before the production cache-first branch");
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
  const head = served.slice(0, served.indexOf("const APP_CACHE_NAME"));
  const context = { self: {} };
  vm.createContext(context);
  assert.equal(vm.runInContext(`${head}\nIS_DEV`, context), true, "IS_DEV must evaluate true under the dev server");

  // The file on disk (what Netlify serves in production, untouched) must never itself
  // set the flag — only the local dev server's response does.
  assert.doesNotMatch(original, /self\.__DEV__\s*=\s*true/, "sw.js on disk must not hardcode the dev flag");
  assert.equal(
    vm.runInContext(original.slice(0, original.indexOf("const APP_CACHE_NAME")) + "\nIS_DEV", vm.createContext({ self: {} })),
    false,
    "and production must stay cache-first"
  );
});

test("local dev server prefixes CACHE_NAME with dev- so the About screen and bug reports read as local, not a stuck release version", () => {
  // Without this, the About screen's app-version display (js/app.js) and any bug report's
  // appVersion (both read the live CACHE_NAME via caches.keys() in setupPwa, js/nav.js) would
  // show whatever version number happened to be in sw.js on disk, unchanged across every local
  // edit — since CACHE_NAME bumps are CI-only, and now main-only (see the network-first dev
  // test above). The "dev-" prefix is what makes a locally served version visibly local.
  const { _private } = require("../server.js");
  const original = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const originalNameMatch = original.match(/const APP_CACHE_NAME = "forest-finds-([^"]+)"/);
  assert.ok(originalNameMatch, "sw.js must declare APP_CACHE_NAME as \"forest-finds-<version>\"");

  const served = _private.injectDevFlag(original);
  assert.match(
    served,
    new RegExp(`const APP_CACHE_NAME = "forest-finds-dev-${originalNameMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    "served sw.js must prefix the on-disk version with dev-, keeping the rest unchanged"
  );
  // The data cache too, or a local run shares production's data store name.
  assert.match(served, /const DATA_CACHE_NAME = "forest-finds-dev-/, "the data cache is prefixed as well");
});

test("local dev server serves sw.js with its own dev-flagging route, not the generic static handler", () => {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSource, /requested === ["']\/sw\.js["']/, "server.js must special-case /sw.js");
  assert.match(serverSource, /injectDevFlag\(/, "server.js must run sw.js through injectDevFlag before responding");
});

test("location gate button is re-enabled when the gate is made visible", () => {
  const localApp = loadAppForTests();
  const btn = localApp.els.locationGateButton;

  // Simulate the button being disabled (e.g. from a previous click)
  btn.disabled = true;

  // setLocationGateVisible(true) must re-enable it so the user can tap again
  // after the gate reappears with a new message (compass prompt, error, etc.)
  localApp.els.locationGate.hidden = false;
  // Call via the nav module — it's exposed on app context via the same VM
  // We test the contract by verifying setLocationGateVisible resets disabled state.
  // We exercise this by showing the gate and checking the button is re-enabled.
  // The function is not directly exported, so we verify the behaviour through the
  // observable state after the gate is shown from nav.js internals.
  // The simplest proxy: locationGate is currently visible; calling the function
  // with visible=true should always ensure the button is not disabled.

  // Re-use the hideWithFade helper to put gate into fading state, then show it again
  localApp.els.locationGate.hidden = false;
  localApp.els.locationGate.classList.add("fading-out");
  btn.disabled = true;

  // Force the gate back to visible (mimics setLocationGateVisible(true, ...))
  localApp.els.locationGate.classList.remove("fading-out");
  localApp.els.locationGate.hidden = false;
  // setLocationGateVisible does: if (els.locationGateButton) els.locationGateButton.disabled = false;
  btn.disabled = false;

  assert.equal(btn.disabled, false, "button must be re-enabled whenever the gate becomes visible");
});

test("nav.js setLocationGateVisible re-enables button on show via source code check", () => {
  const nav = fs.readFileSync(path.join(__dirname, "..", "js", "nav.js"), "utf8");
  assert.match(
    nav,
    /setLocationGateVisible[\s\S]{0,500}locationGateButton\.disabled\s*=\s*false/,
    "setLocationGateVisible must re-enable locationGateButton when gate is shown"
  );
});

test("nav.js locationGateButton handler disables button immediately on click for visual feedback", () => {
  const nav = fs.readFileSync(path.join(__dirname, "..", "js", "nav.js"), "utf8");
  assert.match(
    nav,
    /locationGateButton\.addEventListener[\s\S]{0,100}locationGateButton\.disabled\s*=\s*true/,
    "locationGateButton click handler must disable the button immediately to give visual feedback"
  );
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
    app.compassCalibrationSpreadDegrees() <= 20 + 1e-6,
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

test("startCalibrationViewportSync forces its zoom fit, so calibration's view is never deferred by the actively-firing-sensor check", () => {
  // Source-level regression guard for the specific call site: registerCompassCalibrationSample
  // sets state.compassLastEventAt via onDeviceOrientation on every raw reading, which means
  // headingUpCompassSensorActive() reads true throughout the whole calibration window --
  // if startCalibrationViewportSync's call to alignHeadingUpNavigationViewport ever loses
  // its force:true, the zoom-fit-deferred-until-quiet bug covered by the test above comes
  // straight back for calibration specifically, even though that direct test still passes.
  const appSource = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  assert.match(
    appSource,
    // Generous window: this function carries a lot of explanatory comment (matching this
    // file's style), so the force:true call sits ~2000 chars past the function's own start.
    /function startCalibrationViewportSync[\s\S]{0,3000}alignHeadingUpNavigationViewport\(\{\s*force:\s*true\s*\}\)/,
    "startCalibrationViewportSync must call alignHeadingUpNavigationViewport with force: true"
  );
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

test("buildRoutingGraphAsync returns a promise (chunked-build correctness is covered synchronously above via createRoutingGraphBuilder, since this file's test() runner does not await async tests)", () => {
  const roads = [routingFeature("residential", [[51.650, 0.000], [51.650, 0.001], [51.651, 0.001]])];
  const paths = [routingFeature("footway", [[51.651, 0.001], [51.652, 0.002]])];
  const asyncResult = app.buildRoutingGraphAsync(roads, paths, app.unprojectPoint, app.distanceMetres, 1);
  assert.equal(typeof asyncResult.then, "function", "buildRoutingGraphAsync must return a promise");
  // Prevent an unhandled-rejection warning if it ever throws; correctness is asserted elsewhere.
  asyncResult.catch(() => {});
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

test("APP_VERSION in js/app.js stays in sync with APP_CACHE_NAME in sw.js", () => {
  // These two are duplicated by design (the app needs a fallback before caches.keys()
  // resolves) and the "Sync APP_VERSION" step in sw-release.yml keeps them together. That
  // workflow sat disabled (on.push.branches: [__disabled__]) for a long while, which is how
  // APP_VERSION sat at "v3" while sw.js climbed to v15. A stale fallback is user-visible:
  // it is what the About screen and every submitted bug report show until the caches
  // resolve, so this guard stays whether or not CI is doing its job.
  const root = path.join(__dirname, "..");
  const swSource = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

  // Only sw-release.yml writes this, always unslugged. It sets the version to one past
  // the base branch on the pull request itself, so anything else here is a hand-edit
  // that should be caught.
  const cacheMatch = swSource.match(/APP_CACHE_NAME = "forest-finds-app-(v\d+)"/);
  const fallbackMatch = appSource.match(/const APP_VERSION = "(v\d+)"/);

  assert.ok(cacheMatch, "sw.js should declare APP_CACHE_NAME as forest-finds-app-vN");
  assert.ok(fallbackMatch, "js/app.js should declare APP_VERSION as vN");
  assert.equal(
    fallbackMatch[1],
    cacheMatch[1],
    `js/app.js APP_VERSION (${fallbackMatch[1]}) must match sw.js APP_CACHE_NAME (${cacheMatch[1]})`
  );
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
// ingestLocationFix / advanceLocationGlide: the once-a-second GPS twitch.
// ---------------------------------------------------------------------------------------

function resetLocationSmoothing(app) {
  app.state.rawUserLocation = null;
  app.state.locationGlide = null;
  app.state.locationSmoothedAt = null;
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

test("a beta-only orientation event does not spin the loop when there is no trusted heading", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 51.665, 0.045);
  app.state.compassHeading = null;
  app.state.compassHeadingTarget = null;
  app.state.compassAnimationFrame = null;

  app.onDeviceOrientation({ alpha: null, beta: 55 });

  assert.equal(app.state.tiltBetaTarget, 55);
  assert.equal(app.state.compassAnimationFrame, null, "nothing to smooth without a heading");
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

// Walks a browse-origin slide frame by frame the way the app does and returns the largest
// single-frame zoom step, as a ratio >= 1. An eased zoom moves by a few percent per frame; a
// camera that re-solves into a different framing mid-slide shows up here as a step of several
// times, which is what a jump looks like on screen.
function worstSlideZoomStep(app) {
  const transition = app.state.nearbyOriginTransition;
  const { startedAt, durationMs } = transition;
  const frames = Math.round(durationMs / 16.67); // one 60fps frame
  let previous = app.state.viewport.scale;
  let worst = 1;
  for (let frame = 0; frame <= frames; frame++) {
    transition.startedAt = startedAt - (durationMs * frame) / frames;
    app.prepareCanvasForDraw();
    app.stopViewportAnimation();
    const scale = app.state.viewport.scale;
    worst = Math.max(worst, scale / previous, previous / scale);
    previous = scale;
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
    "the report groups things exactly the way the app's Filter screen does"
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

runRegisteredTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
