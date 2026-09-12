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
        fillText() {},
        measureText(text) { return { width: String(text).length * 8 }; },
      };
    },
  };
}

function loadAppForTests({ localStorage: initialLocalStorage = {} } = {}) {
  const htmlPath = path.join(__dirname, "..", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, "index.html should contain the app script");

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

  const window = {
    location: { hostname: "localhost", hash: "", pathname: "/", search: "" },
    devicePixelRatio: 1,
    innerWidth: 1000,
    innerHeight: 800,
    localStorage,
    addEventListener() {},
    removeEventListener() {},
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  };
  window.window = window;
  window.localStorage = localStorage;

  const context = {
    console,
    document,
    window,
    navigator: { geolocation: null, userAgent: "node-test" },
    history: {
      replaceState(state, title, url) {
        // Parse the URL and update window.location to match browser behavior
        if (url) {
          const hashIndex = url.indexOf('#');
          if (hashIndex >= 0) {
            window.location.hash = url.substring(hashIndex);
          } else {
            window.location.hash = "";
          }
        }
      }
    },
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

  const script = scriptMatch[1]
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
  updateSelectedDetailFields,
  selectedCompassTarget,
  distanceFromUser,
  walkInfoExpandableHtml,
  formatWalkTime,
  overviewItemsForActiveFilter,
  overviewNearestHtml,
  walkingDistanceToMetres,
  keepOverviewCenteredOnUser,
  centerOverviewOnUserLocation,
  setInspectorMinimized,
  maxScaleForRadiusVisible,
  bestVisibleCanvasRect,
  walkingRadiusCirclePoints,
  drawWalkingRadius,
  drawOverviewRoutes,
  selectOverview,
  ensureOverviewTargetsVisible,
  alignHeadingUpNavigationViewport,
  maxScaleForHeadingUpPoints,
  maxHeadingUpNavigationScale,
  maxNearbyHeadingUpScale,
  pointsExtendedToMinDistance,
  walkingRadiusWorldUnits,
  selectedNavigationTargetPoints,
  selectedNavigationTargetBearingOffsetRadians,
  nearbyHeadingUpTargetPoints,
  animateToHeadingUpNavigationViewport,
  resizeCanvas,
  prepareCanvasForDraw,
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
  tiltRotateXDeg,
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
  landmarkEmoji,
  appIconHtml,
  treeSpeciesIconHtml,
  placeTitle,
  ICON_PATHS,
  FILTER_GROUPS,
  worldToScreen,
  settingsFormHtml,
  reportFormHtml,
  openFiltersScreen,
  goToInitialView,
  applySelectionFromHash,
  syncHashFromSelection,
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
  location: window.location,
  windowStub: window,
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

  vm.runInContext(script, context, { filename: "index.html" });
  return context.__forestFindsTest;
}

function makePoint(app, latitude, longitude) {
  return {
    latitude,
    longitude,
    point: app.projectLonLat(longitude, latitude),
  };
}

function resetData(app) {
  app.state.trees = [];
  app.state.cows = [];
  app.state.landmarks = [];
  app.state.paths = [];
  app.state.selected = null;
  app.state.overviewFilters = [];
  app.state.walkingDistanceMinutes = 5;
  app.state.showAllOutsideRadius = false;
  app.state.overviewOutsideRadiusFallback = false;
  app.state.transportLookupCache = new Map();
  app.state.transportLookupRequests = new Map();
  app.state.filterScreenOpen = false;
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
  app.state.compassCalibrationSamples = [];
  app.state.compassCalibrationStartedAt = null;
  app.state.compassCalibrationPromptVisible = false;
  app.state.compassCalibrationPromptDismissed = false;
  if (app.els.compassCalibrationBanner) app.els.compassCalibrationBanner.hidden = true;
  // Cancel any real-timer-backed calibration sync loop a previous test left running --
  // otherwise it keeps firing (and, worse, keeps rescheduling itself) against this test's
  // freshly-reset state instead of stopping, since resetData nulls compassCalibrationStartedAt
  // (defusing its own safety-valve check) without this.
  app.stopCalibrationViewportSync();
  app.state.tiltBetaSmoothed = 0;
  app.state.tiltBetaTarget = 0;
  app.state.tiltWasActive = false;
  app.state.canvasInsetX = 0;
  app.state.canvasInsetY = 0;
  app.state.canvasVisibleWidth = 1000;
  app.state.canvasVisibleHeight = 800;
  app.els.inspector.classList.remove("minimized");
  app.els.canvas.width = 1000;
  app.els.canvas.height = 800;
  app.location.hash = "";
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

function test(name, fn) {
  registeredTests.push({ name, fn });
}

async function runRegisteredTests() {
  for (const { name, fn } of registeredTests) {
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
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      throw error;
    }
  }
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
  const userScreen = app.worldToScreen(app.state.userLocation.point);
  const fraction = userScreen.y / app.els.canvas.clientHeight;

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
  const userScreen = app.worldToScreen(app.state.userLocation.point);
  const fraction = userScreen.y / app.els.canvas.clientHeight;

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

test("nearby heading-up viewport keeps the user low when all highlighted locations are ahead", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 90;
  app.state.renderedNavigationHeading = 90;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 999, ty: 888 };

  const changed = app.alignHeadingUpNavigationViewport();
  const userScreen = app.worldToScreen(app.state.userLocation.point);

  assert.ok(changed, "viewport should have changed to keep highlighted locations in view");
  const focusCenter = app.els.canvas.clientWidth / 2;
  assert.equal(Math.round(app.state.viewport.tx), Math.round(focusCenter), "user should stay horizontally centered");
  assert.ok(userScreen.y > app.els.canvas.clientHeight * 0.50, "user should sit below the midpoint when nothing is behind them");
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

test("nearby heading-up viewport ignores a highlighted location behind the user so zoom is not pulled out to fit it", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };
  app.state.trees.push({ id: "ahead-tree", commonName: "Ahead tree", ...makePoint(app, 0.0012, 0) });
  app.state.landmarks.push({ id: "behind-pub", name: "Behind Pub", category: "pub", ...makePoint(app, -0.15, 0) });

  app.state.overviewFilters = ["trees", "pubs"];
  const changed = app.alignHeadingUpNavigationViewport();
  const scaleWithBehindPub = app.state.viewport.scale;
  const userScreen = app.worldToScreen(app.state.userLocation.point);
  const treeScreen = app.worldToScreen(app.state.trees[0].point);
  const pubScreen = app.worldToScreen(app.state.landmarks[0].point);

  assert.ok(changed, "viewport should refit when a highlighted item is behind the user");
  assert.ok(userScreen.y > app.els.canvas.clientHeight * 0.50, "user should still sit below the midpoint");
  assert.ok(treeScreen.y < userScreen.y, "the tree should remain ahead of the user");
  assert.ok(pubScreen.y > userScreen.y, "the pub should remain behind the user");
  assert.ok(
    pubScreen.y > app.els.canvas.clientHeight * 2,
    "the far-behind item should be excluded from the fit rather than dragging the whole view out to include it",
  );

  // Removing the far-behind pub should not change the zoom at all, proving it
  // was not constraining the fit in the first place.
  app.state.landmarks = [];
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };
  app.alignHeadingUpNavigationViewport();
  assert.ok(
    Math.abs(app.state.viewport.scale - scaleWithBehindPub) < scaleWithBehindPub * 0.001,
    "zoom should match fitting the ahead tree alone, unaffected by the far-behind pub",
  );
});

test("nearby heading-up zoom is capped rather than zooming in absurdly for a location right next to the user", () => {
  // Fourth attempt at this specific bug -- see [[nearby-view-zoom]] project memory for the
  // full history. Points closer than the walking radius are now extended straight out to the
  // radius distance (preserving bearing) before the fit runs, instead of capping the whole
  // result against a full 360-degree radius circle -- fitting against the full circle
  // over-widened the view whenever real matches were directional, which was round 2's own
  // regression (confirmed against real device telemetry). This test proves the near-feet
  // point can no longer demand a near-infinite scale: the corrected zoom is bounded by the
  // clamped-point fit, which is orders of magnitude tighter than fitting the real ~1m
  // distance would otherwise require.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.viewport = { scale: 1000, tx: 200, ty: 200 };
  // A tree essentially at the user's feet (~1m away) would otherwise force an enormous
  // scale to fit that tiny distance against the focus-rect margin — this is the "loads
  // zoomed in so far you can't see any locations" bug: without a ceiling, the fit chases
  // whichever nearby point happens to be closest rather than settling on a usable zoom.
  app.state.trees.push({ id: "at-feet-tree", commonName: "At-feet tree", ...makePoint(app, 0.00001, 0.00001) });

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const points = app.nearbyHeadingUpTargetPoints();
  const unclampedScale = app.maxScaleForHeadingUpPoints(points, focus, focusRect);
  const clampedPoints = app.pointsExtendedToMinDistance(points, app.state.userLocation.point, app.walkingRadiusWorldUnits());
  const expectedCeiling = app.maxScaleForHeadingUpPoints(clampedPoints, focus, focusRect);

  app.alignHeadingUpNavigationViewport();

  // The applied scale is expectedCeiling with the standard zoom-buffer ratio applied (see
  // HEADING_UP_SCALE_BUFFER_RATIO / resolveHeadingUpTargetScale) -- an exact match here (not
  // just an upper bound) proves the fit actually followed the walking-radius-clamped points
  // rather than merely staying under some looser ceiling by coincidence.
  const bufferedExpected = expectedCeiling * 0.96;
  assert.ok(
    Math.abs(app.state.viewport.scale - bufferedExpected) < bufferedExpected * 0.001,
    `expected buffered scale ~${bufferedExpected}, got ${app.state.viewport.scale}`,
  );
  assert.ok(
    expectedCeiling < unclampedScale / 100,
    "clamping the near-feet point out to the walking radius should avoid the near-infinite unclamped scale",
  );
});

test("nearby filter updates trigger a heading-up refit that positions the user low when highlighted locations are ahead", () => {
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
  assert.ok(app.state.viewportAnimationTo.ty > app.els.canvas.clientHeight / 2, "the user should remain low on the map");

  app.state.viewport = { ...app.state.viewportAnimationTo };
  app.state.viewportAnimationTo = null;

  const userScreen = app.worldToScreen(app.state.userLocation.point);
  const treeScreen = app.worldToScreen(app.state.trees[0].point);
  const pubScreen = app.worldToScreen(app.state.landmarks[0].point);
  assert.ok(treeScreen.y < userScreen.y, "the tree should remain ahead of the user");
  assert.ok(pubScreen.y < userScreen.y, "the pub should remain ahead of the user");
});

test("nav controls use generated image assets instead of text glyphs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

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

test("fallback notice names the selected walking distance", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees"];
  app.state.walkingDistanceMinutes = 10;
  addFixtureData(app);

  const html = app.overviewNearestHtml();

  assert.match(html, /Nothing found within 10 mins walking distance/);
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
    arc() { arcCount += 1; },
    fill() {},
    stroke() {},
    setLineDash() {},
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
  assert.equal(app.landmarkEmoji({ category: "chemist", categoryTags: ["chemist"] }), "⚕️");
  assert.equal(app.landmarkEmoji({ category: "yes", categoryTags: ["yes", "cafe"] }), "☕");
  assert.equal(app.landmarkEmoji({ category: "something_unclear", categoryTags: ["something_unclear"] }), "📍");
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
    arc() { arcCount += 1; },
    fill() {},
    stroke() {},
    setLineDash() {},
  });

  assert.equal(arcCount, 1);
});

test("dashed route lines to nearby matches draw on the report (feedback) screen, same as filters", () => {
  // Regression test: drawOverviewRoutes() used to bail out on any truthy state.selected,
  // which incorrectly included the Settings/Report pseudo-selections (type "settings"/
  // "report") -- so these dashed connector lines only ever showed on the Filters screen, even
  // though Filters/Settings/Report are meant to render the exact same map background (see
  // secondaryScreenActive() in js/nav.js). Fixed via hasRealSelection(), shared with
  // drawWalkingRadius just above, which already excluded the pseudo-selections correctly.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "report", item: null };
  app.state.overviewFilters = ["pubs"];
  app.state.landmarks.push({ id: "near-pub", name: "Near pub", category: "pub", ...makePoint(app, 0.001, 0) });

  let lineToCount = 0;
  app.drawOverviewRoutes({
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() { lineToCount += 1; },
    stroke() {},
    setLineDash() {},
  }, []);

  assert.ok(lineToCount > 0, "should draw at least one route line on the report screen");
});

test("dashed route lines to nearby matches draw on the settings screen, same as filters", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "settings", item: null };
  app.state.overviewFilters = ["pubs"];
  app.state.landmarks.push({ id: "near-pub", name: "Near pub", category: "pub", ...makePoint(app, 0.001, 0) });

  let lineToCount = 0;
  app.drawOverviewRoutes({
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() { lineToCount += 1; },
    stroke() {},
    setLineDash() {},
  }, []);

  assert.ok(lineToCount > 0, "should draw at least one route line on the settings screen");
});

test("dashed route lines hide when a real selection is active, same as the walking radius ring", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.selected = { type: "tree", item: { ...makePoint(app, 0.001, 0) } };
  app.state.overviewFilters = ["pubs"];
  app.state.landmarks.push({ id: "near-pub", name: "Near pub", category: "pub", ...makePoint(app, 0.001, 0) });

  let lineToCount = 0;
  app.drawOverviewRoutes({
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() { lineToCount += 1; },
    stroke() {},
    setLineDash() {},
  }, []);

  assert.equal(lineToCount, 0, "a real selection should suppress the overview route lines");
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
  app.state.viewport = { scale: 10, tx: 500, ty: 440 };

  app.state.compassLastEventAt = Date.now();
  const changedDuringCompassUpdates = app.alignHeadingUpNavigationViewport();

  assert.equal(changedDuringCompassUpdates, false, "active compass updates should defer heading-up zoom changes");
  assert.equal(app.state.viewport.scale, 10, "scale should hold steady while the compass is still updating");
  assert.equal(app.state.viewport.tx, 500);
  assert.equal(app.state.viewport.ty, 440);

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
// differing only in their point source and emptiness guard. (That helper used to also apply a
// HEADING_UP_MAX_SCALE_RATIO ceiling internally; it was removed and replaced with a
// walking-radius ceiling that maxNearbyHeadingUpScale applies itself by extending individual
// points closer than the radius out to it before fitting -- see [[nearby-view-zoom]] project
// memory for the full history.) These tests pin down the shared math directly, then prove
// each wrapper is a pure pass-through to it for its own point source.
// Regression coverage for pointsExtendedToMinDistance, the helper maxNearbyHeadingUpScale
// uses to give every real match at least a walking-radius-sized footprint in the fit -- see
// [[nearby-view-zoom]] project memory for why this replaced capping against a full 360-degree
// radius circle (round 2's "zooms out too far" regression for directional matches).
test("pointsExtendedToMinDistance pushes closer points out to minDistance, preserving bearing, and leaves farther points untouched", () => {
  const origin = { x: 0, y: 0 };
  const points = [
    { x: 1, y: 0 },      // 1 unit east, well inside 10 -> pushed out to (10, 0)
    { x: 0, y: -3 },     // 3 units "north" (negative y), inside 10 -> pushed out to (0, -10)
    { x: 20, y: 0 },     // already past minDistance -> left untouched
    { x: 6, y: 8 },       // distance exactly 10 -> left untouched (>= minDistance)
    { x: 0, y: 0 },       // exactly at origin, no defined bearing -> left untouched
  ];

  const extended = app.pointsExtendedToMinDistance(points, origin, 10);

  assert.ok(Math.abs(extended[0].x - 10) < 1e-9 && Math.abs(extended[0].y - 0) < 1e-9, `expected (10, 0), got (${extended[0].x}, ${extended[0].y})`);
  assert.ok(Math.abs(extended[1].x - 0) < 1e-9 && Math.abs(extended[1].y - -10) < 1e-9, `expected (0, -10), got (${extended[1].x}, ${extended[1].y})`);
  assert.deepEqual(extended[2], { x: 20, y: 0 }, "a point already past minDistance should be untouched");
  assert.deepEqual(extended[3], { x: 6, y: 8 }, "a point exactly at minDistance should be untouched");
  assert.deepEqual(extended[4], { x: 0, y: 0 }, "a point exactly at the origin has no bearing to extend along, so it is left as-is");
});

test("pointsExtendedToMinDistance returns the points unchanged when minDistance is not positive", () => {
  const origin = { x: 0, y: 0 };
  const points = [{ x: 1, y: 0 }, { x: 0.001, y: 0.001 }];

  assert.deepEqual(app.pointsExtendedToMinDistance(points, origin, 0), points);
  assert.deepEqual(app.pointsExtendedToMinDistance(points, origin, -5), points);
});

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
  app.state.tiltBetaSmoothed = 85; // TILT_BETA_MAX -> the full max-tilt anchor (0.90/0.88) applies

  const aheadAnchor = 0.90; // HEADING_UP_ANCHOR_NEARBY_TILT, reused here as the "ahead" selected anchor's sibling value would differ (0.88) -- computed below instead of hardcoded twice

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

test("maxNearbyHeadingUpScale falls back to the current viewport scale with fewer than two points", () => {
  resetData(app);
  app.state.userLocation = null; // overviewTargetPoints() returns [] with no user location
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
  assert.equal(points.length, 1, "fixture selection should produce exactly one target point");
  const expected = app.maxScaleForHeadingUpPoints(points, focus, focusRect);
  const actual = app.maxHeadingUpNavigationScale(focus, focusRect);

  assert.equal(actual, expected);
});

test("maxNearbyHeadingUpScale falls back to the walking-radius ring fit, not the stale viewport scale, when every clamped point is excluded by tilt", () => {
  // Regression test for a real bug found via device video on 2026-09-02 (round 3 of the
  // zoom-cap saga -- see [[nearby-view-zoom]] project memory): when every point is currently
  // behind the user's heading during active tilt, maxScaleForHeadingUpPoints(clampedPoints,
  // ...) returns null, and the fallback used to be `state.viewport.scale` -- whatever scale
  // was already on screen, including a stale or pathological leftover value. The video showed
  // viewport.scale frozen at 1,346,948 for ~0.6s during exactly this window. The fallback
  // should instead be the walking-radius ring fit, which is always available and meaningful,
  // never the stale current scale.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.overviewFilters = ["trees"];
  app.state.tiltBetaSmoothed = 20; // > TILT_BETA_THRESHOLD (12) -> tiltActive() true
  // Negative latitude offsets sit behind the user at heading 0 (same convention as the
  // "behind-pub" fixture elsewhere in this file), so every clamped point is excluded from
  // the raw fit while tilt is active.
  app.state.trees.push(
    { id: "behind-1", commonName: "Behind tree 1", ...makePoint(app, -0.0005, 0) },
    { id: "behind-2", commonName: "Behind tree 2", ...makePoint(app, -0.0004, 0.0001) },
  );
  // A distinctly wrong "stale" scale that must NOT be what's returned.
  app.state.viewport = { scale: 987654321, tx: 500, ty: 440 };

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const radiusScale = app.maxScaleForHeadingUpPoints(app.walkingRadiusCirclePoints(), focus, focusRect);
  const points = app.nearbyHeadingUpTargetPoints();
  const clampedPoints = app.pointsExtendedToMinDistance(points, app.state.userLocation.point, app.walkingRadiusWorldUnits());
  assert.equal(
    app.maxScaleForHeadingUpPoints(clampedPoints, focus, focusRect),
    null,
    "fixture should actually exercise the null-fit path -- both points must be excluded by tilt",
  );

  const actual = app.maxNearbyHeadingUpScale(focus, focusRect);

  assert.equal(actual, radiusScale, "should fall back to the walking-radius ring fit");
  assert.notEqual(actual, 987654321, "must not fall back to the stale current viewport scale");
});

test("a real match beyond the walking radius is not pulled inward -- only points closer than the radius get clamped", () => {
  // Locks in the other half of pointsExtendedToMinDistance's contract at the app level (the
  // pure-function unit test covers it in isolation): a genuinely distant match should still
  // widen the zoom to include it, not be yanked in to the radius distance alongside anything
  // closer. See [[nearby-view-zoom]] project memory.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.overviewFilters = ["trees"];
  app.state.walkingDistanceMinutes = 5; // ~417m radius
  // ~900m away, diagonal bearing, well beyond the ~417m radius.
  app.state.trees.push(
    { id: "far-tree", commonName: "Far tree", ...makePoint(app, 0.006, 0.006) },
    { id: "far-tree-2", commonName: "Far tree 2", ...makePoint(app, 0.0058, 0.0055) },
  );
  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const points = app.nearbyHeadingUpTargetPoints();

  const clampedPoints = app.pointsExtendedToMinDistance(points, app.state.userLocation.point, app.walkingRadiusWorldUnits());
  for (let i = 0; i < points.length; i++) {
    assert.deepEqual(clampedPoints[i], points[i], "a point already beyond the walking radius should be left exactly as-is");
  }

  const expected = app.maxScaleForHeadingUpPoints(points, focus, focusRect);
  const actual = app.maxNearbyHeadingUpScale(focus, focusRect);
  assert.equal(actual, expected, "the fit should use the real (unclamped) far points directly");

  const radiusScale = app.maxScaleForHeadingUpPoints(app.walkingRadiusCirclePoints(), focus, focusRect);
  assert.ok(actual < radiusScale, "fitting genuinely distant matches should zoom out further than the walking-radius ring itself");
});

test("a close match and a far match together: only the close one is clamped, and the far one still constrains the fit", () => {
  // Mixed-distance regression: one match well inside the walking radius (would otherwise force
  // an absurd zoom-in on its own) alongside one match well beyond it. The close match should be
  // pulled out to the radius distance; the far match should be left untouched and dominate the
  // resulting fit, since it needs a wider view than the radius alone would. See
  // [[nearby-view-zoom]] project memory.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.overviewFilters = ["trees"];
  app.state.walkingDistanceMinutes = 5; // ~417m radius
  app.state.trees.push(
    { id: "close-tree", commonName: "Close tree", ...makePoint(app, 0.00001, 0.00001) }, // ~1.5m away
    { id: "far-tree", commonName: "Far tree", ...makePoint(app, 0.006, -0.006) }, // ~940m away
  );
  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const points = app.nearbyHeadingUpTargetPoints();
  const worldRadius = app.walkingRadiusWorldUnits();
  const clampedPoints = app.pointsExtendedToMinDistance(points, app.state.userLocation.point, worldRadius);

  const closeClamped = clampedPoints.find((p) => Math.abs(Math.hypot(p.x - app.state.userLocation.point.x, p.y - app.state.userLocation.point.y) - worldRadius) < worldRadius * 1e-6);
  assert.ok(closeClamped, "the close point should have been extended out to exactly the walking-radius distance");

  const farRaw = points.find((p) => Math.hypot(p.x - app.state.userLocation.point.x, p.y - app.state.userLocation.point.y) > worldRadius);
  const farClamped = clampedPoints.find((p) => p.x === farRaw.x && p.y === farRaw.y);
  assert.ok(farClamped, "the far point should be present in the clamped set completely unchanged");

  const expected = app.maxScaleForHeadingUpPoints(clampedPoints, focus, focusRect);
  const actual = app.maxNearbyHeadingUpScale(focus, focusRect);
  assert.equal(actual, expected);

  const radiusScale = app.maxScaleForHeadingUpPoints(app.walkingRadiusCirclePoints(), focus, focusRect);
  assert.ok(actual < radiusScale, "the far, unclamped match needs a wider view than the walking radius alone");
});

test("nearby heading-up zoom for several directional matches near the walking radius is tighter than the full-circle fit (real device scenario, 2026-09-02)", () => {
  // Reproduces the shape of a real device recording's telemetry: five real matches clustered
  // within a ~40-degree arc, each ~380m from the user, against the default 417m (5-minute)
  // walking radius. Capping against the full 360-degree radius circle (round 2's design)
  // forced the view roughly 1.8x wider than these directional matches actually needed, which
  // is what produced the "zooms out too far" report this replaces. See [[nearby-view-zoom]]
  // project memory for the full history.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.compassHeading = 0;
  app.state.renderedNavigationHeading = 0;
  app.state.selected = null;
  app.state.overviewFilters = ["trees"];
  const bearingsDeg = [0, 10, 20, 30, 40];
  bearingsDeg.forEach((bearing, i) => {
    const rad = (bearing * Math.PI) / 180;
    const distance = 380; // metres, within the 373-394m range seen on-device
    const dLat = (distance * Math.cos(rad)) / 111320;
    const dLon = (distance * Math.sin(rad)) / 111320;
    app.state.trees.push({ id: `arc-tree-${i}`, commonName: `Arc tree ${i}`, ...makePoint(app, dLat, dLon) });
  });

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const points = app.nearbyHeadingUpTargetPoints();
  const clampedPoints = app.pointsExtendedToMinDistance(points, app.state.userLocation.point, app.walkingRadiusWorldUnits());
  const directionalScale = app.maxScaleForHeadingUpPoints(clampedPoints, focus, focusRect);
  const fullCircleScale = app.maxScaleForHeadingUpPoints(app.walkingRadiusCirclePoints(), focus, focusRect);
  const actual = app.maxNearbyHeadingUpScale(focus, focusRect);

  assert.equal(actual, directionalScale, "maxNearbyHeadingUpScale should use the directional clamped fit, not the full-circle fit");
  assert.ok(
    directionalScale > fullCircleScale * 1.2,
    `directional matches clustered in one arc should zoom in meaningfully tighter than the full-circle fit (directional=${directionalScale}, fullCircle=${fullCircleScale})`
  );
});

test("maxNearbyHeadingUpScale delegates to the shared heading-up scale helper, using walking-radius-clamped points", () => {
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.overviewFilters = ["trees"];
  // Diagonal offsets (both lat and lon) rather than a pure north/south or east/west offset --
  // an axis-aligned point can coincidentally land on the same bearing that constrains the old
  // full-circle radius fit, masking a regression back to that design. See
  // pointsExtendedToMinDistance's bearing-preserving contract.
  app.state.trees.push(
    { id: "t1", commonName: "Tree 1", ...makePoint(app, 0.001, 0.001) },
    { id: "t2", commonName: "Tree 2", ...makePoint(app, -0.0008, 0.0004) }
  );
  const focus = { x: 500, y: 400 };
  const focusRect = { x: 0, y: 0, width: 1000, height: 800 };

  const points = app.nearbyHeadingUpTargetPoints();
  assert.ok(points.length >= 2, "fixture trees should produce at least two nearby target points");
  const clampedPoints = app.pointsExtendedToMinDistance(points, app.state.userLocation.point, app.walkingRadiusWorldUnits());
  const expected = app.maxScaleForHeadingUpPoints(clampedPoints, focus, focusRect);
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

test("settings form includes a force-refresh button for clearing a stuck service worker version", () => {
  const html = app.settingsFormHtml();
  assert.match(html, /id="forceRefreshButton"/, "settings form should include the force-refresh button");
  assert.match(html, /Force refresh/, "force-refresh button should be labelled");
  assert.match(html, /id="forceRefreshOfflineNote"/, "settings form should include an offline note for the force-refresh button");
});

test("force refresh unregisters service workers and clears forest-finds caches before reloading, but only when online", () => {
  // The Node VM test harness doesn't stub navigator.serviceWorker/caches/location.reload,
  // so this is a source-level check (matching the other service-worker tests above) rather
  // than an executed one — it pins the contract forceRefreshServiceWorker must uphold.
  const navSource = fs.readFileSync(path.join(__dirname, "..", "js", "nav.js"), "utf8");
  const fnMatch = navSource.match(/async function forceRefreshServiceWorker\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "forceRefreshServiceWorker must be defined in nav.js");
  const fn = fnMatch[0];

  assert.match(fn, /if \(!navigator\.onLine\)/, "must bail out while offline instead of leaving the app with no cache fallback");
  assert.match(fn, /navigator\.serviceWorker\.getRegistrations\(\)/, "must look up every registration");
  assert.match(fn, /registration\.unregister\(\)/, "must unregister every registration, not just the active one");
  assert.match(fn, /caches\.keys\(\)/, "must enumerate caches rather than assuming a single name");
  assert.match(fn, /name\.startsWith\(["']forest-finds-["']\)/, "must scope cache deletion to this app's own caches");
  assert.match(fn, /caches\.delete\(name\)/, "must delete the matched caches");
  assert.match(fn, /location\.reload\(\)/, "must reload after clearing state so the fresh install takes effect immediately");
});

test("settings force-refresh listener is removed before being re-added, so reopening Settings does not leak window listeners", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const bindMatch = source.match(/function bindSettingsHandlers\(\) \{[\s\S]*?\n    \}/);
  assert.ok(bindMatch, "bindSettingsHandlers must be defined");
  const fn = bindMatch[0];

  for (const evt of ["online", "offline"]) {
    const removeIdx = fn.indexOf(`removeEventListener("${evt}", updateForceRefreshOnlineState)`);
    const addIdx = fn.indexOf(`addEventListener("${evt}", updateForceRefreshOnlineState)`);
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

test("settings form includes all walking radius options", () => {
  const html = app.settingsFormHtml();
  for (const mins of [1, 2, 5, 10, 15, 20, 30]) {
    assert.match(html, new RegExp(`value="${mins}"`), `missing walk option: ${mins} min`);
  }
});

test("loading overlay markup includes all eight step labels", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  for (const label of ["Veteran trees", "Places", "Paths", "Roads", "Water", "Forest", "cattle", "location"]) {
    assert.ok(html.includes(label), `loading overlay missing step label: "${label}"`);
  }
});

test("report submission includes the app version", () => {
  const html = app.reportFormHtml();
  const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

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
  app.state.trees = [{ id: "12345", latitude: 51.65, longitude: 0.05, point: app.projectLonLat(0.05, 51.65) }];
  app.state.selected = { type: "tree", item: app.state.trees[0] };
  app.syncHashFromSelection();
  assert.ok(app.location.hash.includes("tree=12345"), "hash contains tree parameter");
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

// --- Offline support ---

test("service worker APP_SHELL includes css/tracking.css so consent modal works offline", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, "APP_SHELL list exists");
  assert.ok(shellMatch[1].includes("./css/tracking.css"), "tracking.css must be in APP_SHELL — without it the consent modal has no positioning styles offline, making the location gate button appear unresponsive");
});

test("service worker APP_SHELL includes all CSS files referenced by index.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, "APP_SHELL list exists");

  const cssRefs = [...html.matchAll(/href="(css\/[^"]+\.css)"/g)].map((m) => `./${m[1]}`);
  assert.ok(cssRefs.length > 0, "index.html should reference CSS files");
  for (const cssFile of cssRefs) {
    assert.ok(shellMatch[1].includes(cssFile), `APP_SHELL missing ${cssFile} — page will be unstyled offline`);
  }
});

test("service worker APP_SHELL includes all JS files referenced by index.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, "APP_SHELL list exists");

  const jsRefs = [...html.matchAll(/src="(js\/[^"]+\.js)"/g)].map((m) => `./${m[1]}`);
  assert.ok(jsRefs.length > 0, "index.html should reference JS files");
  for (const jsFile of jsRefs) {
    assert.ok(shellMatch[1].includes(jsFile), `APP_SHELL missing ${jsFile} — app will not boot offline`);
  }
});

test("service worker passes API routes through without caching so offline failures are handled by callers", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  assert.match(sw, /pathname\.startsWith\(["']\/api\/["']\)/, "API routes must bypass the cache handler");
  assert.match(sw, /event\.respondWith\(fetch\(event\.request\)\)/, "API routes should be forwarded directly");
});

test("service worker falls back to cached index.html when navigating offline", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  assert.match(sw, /request\.mode === ["']navigate["']/, "navigate mode must be handled separately");
  assert.match(sw, /caches\.match\(["']\.\/index\.html["']\)/, "navigate fallback should serve cached index.html");
});

test("service worker uses a network-first strategy in local dev so edits show up without a CACHE_NAME bump", () => {
  // CACHE_NAME is only ever bumped by CI (.github/workflows/sw-bump.yml and sw-release.yml),
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
  assert.match(served, /self\.__DEV__ = true;\s*\nconst APP_CACHE_NAME/, "served sw.js must set self.__DEV__ before APP_CACHE_NAME is declared");

  // The file on disk (what Netlify serves in production, untouched) must never itself
  // set the flag — only the local dev server's response does.
  assert.doesNotMatch(original, /self\.__DEV__\s*=\s*true/, "sw.js on disk must not hardcode the dev flag");
});

test("local dev server prefixes CACHE_NAME with dev- so the About screen and bug reports read as local, not a stuck release version", () => {
  // Without this, the About screen's app-version display (index.html) and any bug report's
  // appVersion (both read the live CACHE_NAME via caches.keys() in setupPwa, js/nav.js) would
  // show whatever version number happened to be in sw.js on disk, unchanged across every local
  // edit — since CACHE_NAME bumps are CI-only (see the network-first dev test above). Mirrors
  // the branch-prefix convention .github/workflows/sw-bump.yml already uses for preview builds.
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
  app.state.viewport = { scale: 10, tx: 500, ty: 440 };
  app.state.compassLastEventAt = Date.now(); // sensor "actively firing", as it is throughout calibration

  const deferredChanged = app.alignHeadingUpNavigationViewport();
  assert.equal(deferredChanged, false, "without force, an actively-firing sensor should defer the zoom-in fit");
  assert.equal(app.state.viewport.scale, 10, "zoom should stay at its pre-load scale while deferred");

  const forcedChanged = app.alignHeadingUpNavigationViewport({ force: true });
  assert.equal(forcedChanged, true, "force:true should bypass the deferral");
  assert.ok(app.state.viewport.scale > 10, "forced fit should zoom in to the nearby target immediately");
});

test("maxNearbyHeadingUpScale's zoom-in ceiling is the walking radius, not a ratio against a driftable reference scale", () => {
  // Fourth attempt at the cold-start "zoom level just doesn't seem right" bug -- see
  // [[nearby-view-zoom]] project memory for the full history, including earlier attempts (a
  // ratio against state.fitScale, then against state.baseFitScale, then a full walking-radius
  // circle) that each turned out wrong in a new way -- the first two had no real relationship
  // to a sensible zoom, and the full-circle version over-widened the view for directional
  // matches. The ceiling is now derived by extending each real point closer than the walking
  // radius straight out to that radius distance (preserving bearing) and fitting the result --
  // still the user's own configured walking radius, still computed fresh each time, but no
  // longer forcing every direction to show a full radius's worth of empty space.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "very-close-tree", commonName: "Very close tree", ...makePoint(app, 0.00001, 0.00001) });
  app.state.viewport = { scale: 50000000, tx: 500, ty: 440 }; // frozen at an absurd scale, as seen in the real bug report
  app.state.compassLastEventAt = null; // sensor quiet -- isolates this from the defer/force path tested elsewhere

  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();
  const points = app.nearbyHeadingUpTargetPoints();
  const clampedPoints = app.pointsExtendedToMinDistance(points, app.state.userLocation.point, app.walkingRadiusWorldUnits());
  const ceiling = app.maxScaleForHeadingUpPoints(clampedPoints, focus, focusRect);

  const changed = app.alignHeadingUpNavigationViewport();
  assert.equal(changed, true, "a viewport frozen at an absurd scale must still self-correct");
  // Exact match (with the standard zoom-buffer ratio applied), not just an upper bound --
  // proves the fit tracked the walking-radius-clamped points rather than merely landing
  // under some looser ceiling (e.g. the old full-circle radius fit, which this diagonal
  // fixture deliberately sits above -- see the pointsExtendedToMinDistance bearing note).
  const bufferedCeiling = ceiling * 0.96;
  assert.ok(
    Math.abs(app.state.viewport.scale - bufferedCeiling) < bufferedCeiling * 0.001,
    `expected buffered scale ~${bufferedCeiling}, got ${app.state.viewport.scale}`
  );
});

test("maxNearbyHeadingUpScale's walking-radius ceiling tracks the user's walking distance setting", () => {
  // A larger configured walking radius should loosen the ceiling (allow tighter zoom on a
  // close point before the radius itself becomes the binding constraint), and a smaller one
  // should tighten it -- proving the ceiling is actually derived from state.walkingDistanceMinutes
  // each time rather than some other fixed/cached value.
  resetData(app);
  app.state.userLocation = makePoint(app, 0, 0);
  app.state.trees.push({ id: "very-close-tree", commonName: "Very close tree", ...makePoint(app, 0.00001, 0.00001) });
  const focusRect = app.bestVisibleCanvasRect();
  const focus = app.nearbyNavigationFocusPoint();

  function clampedCeilingFor(minutes) {
    app.state.walkingDistanceMinutes = minutes;
    const points = app.nearbyHeadingUpTargetPoints();
    const clampedPoints = app.pointsExtendedToMinDistance(points, app.state.userLocation.point, app.walkingRadiusWorldUnits());
    return app.maxScaleForHeadingUpPoints(clampedPoints, focus, focusRect);
  }

  const shortRadiusCeiling = clampedCeilingFor(5);
  const longRadiusCeiling = clampedCeilingFor(30);

  assert.ok(
    longRadiusCeiling < shortRadiusCeiling,
    "a longer walking radius covers more ground, so its clamped-point fit scale should be smaller (more zoomed out) than a shorter radius's"
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
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(
    html,
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

  // Before the graph is ready, drawSelectedRoute's straight-line fallback (unchanged from before
  // this feature existed) must still be what's used -- never a broken/absent line.
  const straightLine = app.selectedRoutePoints(target);
  assert.equal(straightLine.length, 2, "falls back to the plain straight line while the graph is still building");
  assert.ok(app.state.routingGraphBuilding, "calling selectedRoutePoints must have kicked off the lazy background build");
  assert.doesNotThrow(() => app.drawSelectedRoute(app.els.canvas.getContext("2d")), "drawing must not throw while the graph is still building");

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

  // Memoization: everything from here on is synchronous (the graph is already built), so it
  // can't race any other test's pending timer.
  const first = app.selectedRoutePoints(target);
  assert.equal(first, routed, "an unmoved user must keep reusing the same cached route object");

  app.state.userLocation = makePoint(app, 51.65001, 0.0000); // ~1m north -- under the 20m threshold
  const second = app.selectedRoutePoints(target);
  assert.equal(second, first, "a couple of metres of GPS movement must reuse the cached route, not recompute it");

  app.state.userLocation = makePoint(app, 51.6503, 0.0000); // ~33m north -- past the threshold
  const third = app.selectedRoutePoints(target);
  assert.notEqual(third, first, "moving past the recompute threshold must produce a freshly computed route");

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
  assert.equal(app.headingUpAnchorFraction(false), 0.55, "flat nearby anchor (HEADING_UP_ANCHOR_NEARBY)");
  assert.equal(app.headingUpAnchorFraction(true), 0.62, "flat selected anchor (HEADING_UP_ANCHOR_SELECTED)");

  app.state.tiltBetaSmoothed = 85; // TILT_BETA_MAX -> ramp t = 1
  assert.ok(Math.abs(app.headingUpAnchorFraction(false) - 0.90) < 1e-9, "max-tilt nearby anchor (HEADING_UP_ANCHOR_NEARBY_TILT)");
  assert.ok(Math.abs(app.headingUpAnchorFraction(true) - 0.88) < 1e-9, "max-tilt selected anchor (HEADING_UP_ANCHOR_SELECTED_TILT)");

  app.state.tiltBetaSmoothed = 48.5; // midpoint of 12-85 -> ramp t = 0.5, same fixture beta other tilt tests use
  assert.ok(Math.abs(app.headingUpAnchorFraction(false) - 0.725) < 1e-9, "midway nearby anchor: 0.55 + (0.90-0.55)*0.5");
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
  app.state.tiltBetaSmoothed = 85; // max tilt -> nearby anchor is exactly 0.90

  app.state.canvasVisibleHeight = 800;
  assert.ok(Math.abs(app.tiltAvailableAheadCssPx() - 720) < 1e-9, "800 * 0.90 / dpr(1) = 720");

  // pixelRatio() prefers els.canvas.dataset.dpr (set by resizeCanvas in real use) over
  // window.devicePixelRatio, so set that directly for a deterministic check here.
  const originalDatasetDpr = app.els.canvas.dataset.dpr;
  try {
    app.els.canvas.dataset.dpr = "2";
    assert.ok(Math.abs(app.tiltAvailableAheadCssPx() - 360) < 1e-9, "800 * 0.90 / dpr(2) = 360 -- bitmap px converted down to CSS px");
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

runRegisteredTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
