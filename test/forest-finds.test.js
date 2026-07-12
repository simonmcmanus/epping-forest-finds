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
  projectLonLat,
  overviewItemsForActiveFilter,
  overviewNearestHtml,
  walkingDistanceToMetres,
  keepOverviewCenteredOnUser,
  centerOverviewOnUserLocation,
  maxScaleForRadiusVisible,
  drawWalkingRadius,
  selectOverview,
  ensureOverviewTargetsVisible,
  alignHeadingUpNavigationViewport,
  animateToHeadingUpNavigationViewport,
  nearbyHeadingUpActive,
  headingUpActive,
  buildNearbyIconLookup,
  isNearCanvas,
  landmarkEmoji,
  appIconHtml,
  treeSpeciesIconHtml,
  placeTitle,
  ICON_PATHS,
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
  location: window.location,
};
`;

  vm.createContext(context);

  const rootDir = path.join(__dirname, "..");
  const externalScripts = ["js/categories.js", "js/normalize.js", "js/onboarding.js", "js/nav.js", "js/loader.js", "js/renderer.js", "js/inspector.js"];
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
  app.state.viewportAnimationFrame = null;
  app.state.viewportAnimationFrom = null;
  app.state.viewportAnimationTo = null;
  app.state.viewportAnimationStartTime = null;
  app.state.viewportAnimationDuration = 0;
  app.state.selectionViewportTransitionPending = false;
  app.state.headingUpEntryAnim = null;
  app.state.renderedNavigationHeading = null;
  app.state.compassHeading = null;
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

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
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

test("first-visit onboarding requests compass access during setup", () => {
  const { ONBOARDING_STEPS: steps } = app;
  const locationStep = steps.findIndex((step) => step.type === "location");
  const compassStep = steps.findIndex((step) => step.type === "compass");

  assert.ok(locationStep >= 0, "location onboarding step should exist");
  assert.ok(compassStep >= 0, "compass onboarding step should exist");
  assert.ok(compassStep > locationStep, "compass onboarding should come after location setup");
});

test("compass onboarding renders permission and fallback states", () => {
  const { compassStepMarkup: fn } = app;

  const prompt = fn({ hasCompassSupport: true, needsCompassPrompt: true });
  assert.match(prompt.subtitle, /unlock the nearby screen/);
  assert.match(prompt.actionsHtml, /ob-compass-enable/);
  assert.match(prompt.actionsHtml, /Continue without compass/);

  const blocked = fn({ blocked: true, hasCompassSupport: true, needsCompassPrompt: true });
  assert.match(blocked.subtitle, /Compass access was blocked/);
  assert.match(blocked.actionsHtml, /ob-compass-finish/);

  const noSupport = fn({ hasCompassSupport: false, needsCompassPrompt: false });
  assert.match(noSupport.subtitle, /unavailable on this device or browser/);
  assert.match(noSupport.actionsHtml, /ob-compass-finish/);
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
  assert.ok(userScreen.y > app.els.canvas.clientHeight * 0.65, "user should sit low on the map when nothing is behind them");
});

test("nearby heading-up viewport keeps highlighted locations visible when one sits behind the user", () => {
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
  const userScreen = app.worldToScreen(app.state.userLocation.point);
  const treeScreen = app.worldToScreen(app.state.trees[0].point);
  const pubScreen = app.worldToScreen(app.state.landmarks[0].point);

  assert.ok(changed, "viewport should refit when a highlighted item is behind the user");
  assert.ok(userScreen.y > app.els.canvas.clientHeight * 0.65, "user should still sit low on the map");
  assert.ok(treeScreen.y < userScreen.y, "the tree should remain ahead of the user");
  assert.ok(pubScreen.y > userScreen.y, "the pub should remain behind the user");
  assert.ok(pubScreen.y > app.els.canvas.clientHeight * 0.8, "the behind item should sit close to the bottom edge");
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

  assert.match(html, /id="inspectorBack"[\s\S]*data\/icons\/home\.png/);
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
  const shellMatch = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/);

  assert.ok(shellMatch, "APP_SHELL cache list exists");
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
  assert.equal(app.landmarkEmoji({ category: "bench", categoryTags: ["bench"] }), "🪑");
  assert.equal(app.landmarkEmoji({ category: "toilets", categoryTags: ["toilets"] }), "🚻");
  assert.match(app.landmarkEmoji({ category: "gate", categoryTags: ["gate"] }), /gate\.png/);
  assert.equal(app.landmarkEmoji({ category: "chemist", categoryTags: ["chemist"] }), "⚕️");
  assert.equal(app.landmarkEmoji({ category: "yes", categoryTags: ["yes", "cafe"] }), "☕");
  assert.equal(app.landmarkEmoji({ category: "something_unclear", categoryTags: ["something_unclear"] }), "📍");
});

test("overview GPS updates keep the user centered and animate large movements", () => {
  resetData(app);
  const previous = makePoint(app, 0, 0).point;
  app.state.userLocation = makePoint(app, 0.2, 0.2);
  app.state.viewport = { scale: 1000, tx: 500, ty: 400 };

  app.keepOverviewCenteredOnUser(previous);

  assert.ok(app.state.viewportAnimationTo, "large movement should create a viewport animation");
  assert.equal(app.state.viewportAnimationTo.scale, 1000);
  assert.equal(Math.round(app.state.viewportAnimationTo.tx), Math.round(500 - app.state.userLocation.point.x * 1000));
  assert.equal(Math.round(app.state.viewportAnimationTo.ty), Math.round(400 - app.state.userLocation.point.y * 1000));
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
  const pubPoint = app.worldToScreen(app.state.landmarks[0].point);

  assert.equal(app.state.viewportAnimationTo, null);
  assert.ok(fittedScale > 8, "nearby targets should zoom in from the initial full-map scale");
  assert.ok(app.state.viewport.scale > 8, "first location centering should not stay at full-map scale");
  assert.ok(app.state.viewport.scale <= fittedScale, "user-centered scale may be capped to keep nearby icons visible");
  assert.equal(lookup.tree.has(app.state.trees[0]), true);
  assert.equal(lookup.landmark.has(app.state.landmarks[0]), true);
  assert.equal(app.isNearCanvas(treePoint, 10), true, JSON.stringify({ treePoint, viewport: app.state.viewport }));
  assert.equal(app.isNearCanvas(pubPoint, 16), true, JSON.stringify({ pubPoint, viewport: app.state.viewport }));
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
  assert.match(app.appIconHtml("nearby", "app-icon title-icon"), /data\/icons\/nearby\.png/);
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
  const html = app.settingsFormHtml();

  assert.match(html, /v\d+/, "settings form should include the app version number");
  assert.match(html, /App version/, "settings form should label the app version");
});

test("report submission includes the app version", () => {
  const html = app.reportFormHtml();
  const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert.ok(!html.includes("App version:"), "report form should not display the app version");
  assert.match(source, /appVersion:\s*APP_VERSION/, "submitted report payload should include the app version");
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
