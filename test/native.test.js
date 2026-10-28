"use strict";
// The native shell's three moving parts (spec/spec-native.md): the js/native.js capability layer,
// executed against a fake Capacitor at the boundary; the www sync that decides what ships inside
// the app binary; and the CORS edge function the bundled app's API calls go through.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const NATIVE_SOURCE = fs.readFileSync(path.join(ROOT, "js", "native.js"), "utf8");
const PRODUCTION_ORIGIN = "https://www.eppingforestfinds.uk";

// Runs js/native.js in a page-like context. `capacitor` stands in for what the shell injects;
// `routes` answers fetch() by URL (anything else is a plain { ok: true }).
function loadNative({ capacitor = null, permissionsState = "prompt", apiBase, bundle, storage = {}, routes = {}, location = "capacitor://localhost/nearby#tree=r1" } = {}) {
  const requested = [];
  const listeners = new Map();
  const store = new Map(Object.entries(storage));
  const browserGeolocation = { getCurrentPosition() {}, watchPosition() {}, clearWatch() {} };
  const opened = [];
  const window = {
    fetch: async (url) => {
      requested.push(url);
      const route = routes[url];
      if (!route) return { ok: true };
      const bytes = Buffer.from(typeof route === "string" ? route : JSON.stringify(route));
      return {
        ok: true,
        json: async () => JSON.parse(bytes.toString()),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
      };
    },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
    location: new URL(location),
    open: (url, target) => opened.push({ url, target }),
  };
  if (capacitor) window.Capacitor = capacitor;
  if (apiBase) window.__FOREST_FINDS_API_BASE__ = apiBase;
  if (bundle) window.__FOREST_FINDS_BUNDLE__ = bundle;
  const context = {
    window,
    navigator: {
      geolocation: browserGeolocation,
      permissions: { query: async () => ({ state: permissionsState }) },
    },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    crypto: globalThis.crypto,
    TextDecoder,
    URL,
    Promise,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(NATIVE_SOURCE, context);
  const fire = (type) => (listeners.get(type) || []).slice().forEach((fn) => fn({ type }));
  return { Native: context.Native, window, requested, browserGeolocation, fire, store, opened, context };
}

function fakeCapacitor({ platform = "ios", permission = "granted", position, failWith } = {}) {
  const calls = { clearWatch: [] };
  let watchCallback = null;
  return {
    calls,
    emitWatch: (pos, err) => watchCallback(pos, err),
    isNativePlatform: () => true,
    getPlatform: () => platform,
    Plugins: {
      Geolocation: {
        checkPermissions: async () => ({ location: permission, coarseLocation: permission }),
        getCurrentPosition: async () => {
          if (failWith) throw new Error(failWith);
          return position;
        },
        watchPosition: (options, callback) => { watchCallback = callback; return "watch-7"; },
        clearWatch: async ({ id }) => { calls.clearWatch.push(id); },
      },
    },
  };
}

const FIX = { timestamp: 1, coords: { latitude: 51.665, longitude: 0.045, accuracy: 8 } };

test("on the web nothing changes: same-origin API calls and the browser's own geolocation", async () => {
  const { Native, window, requested, browserGeolocation } = loadNative();
  assert.equal(Native.isNative, false);
  assert.equal(Native.platform, "web");
  await window.fetch("/api/track");
  assert.deepEqual(requested, ["/api/track"]);
  assert.equal(Native.geolocation, browserGeolocation);
  assert.equal(Native.compassNeedsPrompt, true, "iOS Safari still needs its in-app compass ask");
  assert.equal(await Native.locationPermissionState(), "prompt");
});

test("in the app, API calls go to the website and bundled files stay local", async () => {
  const { window, requested } = loadNative({ capacitor: fakeCapacitor() });
  await window.fetch("/api/track");
  await window.fetch("/.netlify/functions/report-missing-data");
  await window.fetch("data/trees/index.json");
  assert.deepEqual(requested, [
    `${PRODUCTION_ORIGIN}/api/track`,
    `${PRODUCTION_ORIGIN}/.netlify/functions/report-missing-data`,
    "data/trees/index.json",
  ]);
});

test("a build pointed at another deployment sends its API calls there", async () => {
  const { window, requested } = loadNative({ capacitor: fakeCapacitor(), apiBase: "https://deploy-preview-1--example.netlify.app" });
  await window.fetch("/api/cows?center=1,2");
  assert.deepEqual(requested, ["https://deploy-preview-1--example.netlify.app/api/cows?center=1,2"]);
});

test("in the app, location comes from the native plugin through the browser's callback API", async () => {
  const capacitor = fakeCapacitor({ position: FIX });
  const { Native, browserGeolocation } = loadNative({ capacitor });
  assert.notEqual(Native.geolocation, browserGeolocation, "never WebKit's own geolocation, which prompts a second time");
  const position = await new Promise((resolve, reject) => Native.geolocation.getCurrentPosition(resolve, reject));
  assert.equal(position.coords.latitude, 51.665);
});

test("a refusal in the app reports PERMISSION_DENIED, so the app remembers it like a browser refusal", async () => {
  const { Native } = loadNative({ capacitor: fakeCapacitor({ permission: "denied", failWith: "Location permission was denied" }) });
  const error = await new Promise((resolve) => Native.geolocation.getCurrentPosition(() => {}, resolve));
  assert.equal(error.code, 1);
});

test("a fix that does not arrive in time reports TIMEOUT, not a refusal", async () => {
  const { Native } = loadNative({ capacitor: fakeCapacitor({ permission: "granted", failWith: "Location request timed out" }) });
  const error = await new Promise((resolve) => Native.geolocation.getCurrentPosition(() => {}, resolve));
  assert.equal(error.code, 3);
});

test("a native watch delivers each fix and stops the plugin's watch when cleared", async () => {
  const capacitor = fakeCapacitor();
  const { Native } = loadNative({ capacitor });
  const fixes = [];
  const id = Native.geolocation.watchPosition((pos) => fixes.push(pos));
  capacitor.emitWatch(FIX);
  assert.equal(fixes.length, 1);
  Native.geolocation.clearWatch(id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(capacitor.calls.clearWatch, ["watch-7"]);
  capacitor.emitWatch(FIX);
  assert.equal(fixes.length, 1, "nothing is delivered once cleared");
});

test("the native permission state answers in the same terms as the browser's", async () => {
  for (const [plugin, expected] of [["granted", "granted"], ["denied", "denied"], ["prompt", "prompt"], ["prompt-with-rationale", "prompt"]]) {
    const { Native } = loadNative({ capacitor: fakeCapacitor({ permission: plugin }) });
    assert.equal(await Native.locationPermissionState(), expected, plugin);
  }
});

test("in the app the compass is never asked for: the first tap collects the shell's grant silently", async () => {
  const { Native, window, fire } = loadNative({ capacitor: fakeCapacitor() });
  assert.equal(Native.compassNeedsPrompt, false);
  let asked = 0;
  window.DeviceOrientationEvent = { requestPermission: async () => { asked += 1; return "granted"; } };
  let granted = 0;
  Native.unlockMotionOnFirstGesture(() => { granted += 1; });
  fire("touchend");
  fire("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(asked, 1, "collected once, on the first tap only");
  assert.equal(granted, 1);
});

test("on the web the first tap is never used to ask for the compass", async () => {
  const { Native, window, fire } = loadNative();
  let asked = 0;
  window.DeviceOrientationEvent = { requestPermission: async () => { asked += 1; return "granted"; } };
  Native.unlockMotionOnFirstGesture(() => {});
  fire("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(asked, 0);
});

// --- Native features ------------------------------------------------------------------------

const crypto = require("crypto");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

function withPlugins(extra) {
  const capacitor = fakeCapacitor();
  Object.assign(capacitor.Plugins, extra);
  capacitor.convertFileSrc = (uri) => `capacitor://localhost/_capacitor_file_${uri.replace(/^file:\/\//, "")}`;
  return capacitor;
}

test("the native heading delivers every reading to the map, from one listener however often it is started", async () => {
  const calls = { start: 0, stop: 0, listeners: [], located: [] };
  const ForestHeading = {
    addListener: (event, fn) => { calls.listeners.push({ event, fn }); return { remove() {} }; },
    start: async () => { calls.start += 1; return { started: true }; },
    stop: async () => { calls.stop += 1; },
    setLocation: async (where) => { calls.located.push(where); },
  };
  const { Native } = loadNative({ capacitor: withPlugins({ ForestHeading }) });
  const readings = [];
  assert.equal(await Native.heading.start((r) => readings.push(r)), true);
  await Native.heading.start((r) => readings.push(r));
  assert.equal(calls.listeners.length, 1, "restarting after the background adds no second listener");
  calls.listeners[0].fn({ trueHeading: 12, magneticHeading: 11, accuracy: 5 });
  assert.equal(readings.length, 1);
  Native.heading.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.stop, 1);
});

test("the native heading is told where the walker is only when it has moved far enough to matter", () => {
  const located = [];
  const ForestHeading = { addListener() {}, start: async () => ({}), stop: async () => {}, setLocation: async (w) => { located.push(w); } };
  const { Native } = loadNative({ capacitor: withPlugins({ ForestHeading }) });
  Native.heading.setLocation(51.66, 0.04);
  Native.heading.setLocation(51.661, 0.041);
  Native.heading.setLocation(52.2, 0.12);
  assert.deepEqual(located.map((w) => w.latitude), [51.66, 52.2]);
});

test("on the web there is no native heading, and keep-awake and haptics do nothing", () => {
  const { Native } = loadNative();
  assert.equal(Native.heading, null);
  Native.keepAwake.set(true);
  assert.equal(Native.keepAwake.active, false);
  Native.haptics.arrive();
});

test("the screen is asked to stay awake once when navigation starts and released once when it ends", async () => {
  const asked = [];
  const KeepAwake = { keepAwake: async () => asked.push("awake"), allowSleep: async () => asked.push("sleep") };
  const { Native } = loadNative({ capacitor: withPlugins({ KeepAwake }) });
  Native.keepAwake.set(true);
  Native.keepAwake.set(true);
  Native.keepAwake.set(false);
  Native.keepAwake.set(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, ["awake", "sleep"]);
});

test("sharing from the app sends the website address of the screen, never the app's own", async () => {
  const shared = [];
  const Share = { share: async (what) => { shared.push(what); } };
  const { Native } = loadNative({ capacitor: withPlugins({ Share }), location: "capacitor://localhost/nearby#tree=r17338" });
  assert.equal(await Native.share({ title: "English Oak" }), "shared");
  assert.equal(shared[0].url, `${PRODUCTION_ORIGIN}/nearby#tree=r17338`);
});

test("the app reports the store version and build it was installed as", async () => {
  const App = { getInfo: async () => ({ version: "1.0.0", build: "42" }) };
  const { Native } = loadNative({ capacitor: withPlugins({ App }) });
  assert.deepEqual({ ...(await Native.appInfo()) }, { version: "1.0.0", build: "42" });
  assert.equal(await loadNative().Native.appInfo(), null);
});

// A fake app-storage that records what was written.
function fakeFilesystem() {
  const files = new Map();
  return {
    files,
    writeFile: async ({ path: filePath, data, directory, encoding }) => {
      assert.equal(directory, "DATA");
      assert.equal(encoding, "utf8");
      files.set(filePath, data);
      return { uri: `file:///data/${filePath}` };
    },
  };
}

const BUNDLE = { dataVersion: "v43", generatedAt: "2026-10-27T00:00:00.000Z" };
const OLD_TREES = '{"trees":1}';
const NEW_TREES = '{"trees":2}';
const PATHS = '{"paths":1}';
const bundledManifest = { dataVersion: "v43", files: { "data/trees/index.json": { sha256: sha(OLD_TREES) }, "data/local-paths.geojson": { sha256: sha(PATHS) } } };
const liveManifest = { dataVersion: "v44", files: { "data/trees/index.json": { sha256: sha(NEW_TREES) }, "data/local-paths.geojson": { sha256: sha(PATHS) } } };
const dataRoutes = (treesBody = NEW_TREES) => ({
  [`${PRODUCTION_ORIGIN}/data/manifest.json`]: liveManifest,
  "data/manifest.json": bundledManifest,
  [`${PRODUCTION_ORIGIN}/data/trees/index.json`]: treesBody,
});

test("a data update downloads only the files the website has changed, and they are used from the next launch", async () => {
  const Filesystem = fakeFilesystem();
  const first = loadNative({ capacitor: withPlugins({ Filesystem }), bundle: BUNDLE, routes: dataRoutes() });
  const result = await first.Native.data.checkForUpdates();
  assert.equal(result.status, "updated");
  assert.deepEqual([...result.updated], ["data/trees/index.json"]);
  assert.ok(!first.requested.includes(`${PRODUCTION_ORIGIN}/data/local-paths.geojson`), "an unchanged file is never downloaded");
  assert.deepEqual([...Filesystem.files.values()], [NEW_TREES]);

  // This launch keeps loading what it started with.
  await first.window.fetch("data/trees/index.json");
  assert.equal(first.requested.at(-1), "data/trees/index.json");

  // The next launch loads the downloaded copy, and reports the new data release.
  const next = loadNative({ capacitor: withPlugins({ Filesystem }), bundle: BUNDLE, storage: Object.fromEntries(first.store) });
  await next.window.fetch("./data/trees/index.json");
  assert.match(next.requested.at(-1), /^capacitor:\/\/localhost\/_capacitor_file_.*data-updates\/[0-9a-f]{64}\.json$/);
  await next.window.fetch("data/local-paths.geojson");
  assert.equal(next.requested.at(-1), "data/local-paths.geojson");
  assert.equal(next.Native.data.activeVersion, "v44");
});

test("a downloaded file that does not match the website's manifest is never used", async () => {
  const Filesystem = fakeFilesystem();
  const app = loadNative({ capacitor: withPlugins({ Filesystem }), bundle: BUNDLE, routes: dataRoutes('{"trees":"tampered"}') });
  const result = await app.Native.data.checkForUpdates();
  assert.equal(result.status, "failed");
  assert.equal(Filesystem.files.size, 0);
  const next = loadNative({ capacitor: withPlugins({ Filesystem }), bundle: BUNDLE, storage: Object.fromEntries(app.store) });
  await next.window.fetch("data/trees/index.json");
  assert.equal(next.requested.at(-1), "data/trees/index.json");
  assert.equal(next.Native.data.activeVersion, "v43", "an incomplete update does not claim the new release");
});

test("the website is asked about data at most once a day unless the person asks", async () => {
  const Filesystem = fakeFilesystem();
  const app = loadNative({ capacitor: withPlugins({ Filesystem }), bundle: BUNDLE, routes: dataRoutes() });
  await app.Native.data.checkForUpdates();
  assert.equal((await app.Native.data.checkForUpdates()).status, "skipped");
  assert.equal((await app.Native.data.checkForUpdates({ force: true })).status, "current");
});

test("data downloaded for an older install is dropped once the app update bundles newer data", async () => {
  const Filesystem = fakeFilesystem();
  const first = loadNative({ capacitor: withPlugins({ Filesystem }), bundle: BUNDLE, routes: dataRoutes() });
  await first.Native.data.checkForUpdates();
  const updatedApp = loadNative({ capacitor: withPlugins({ Filesystem }), bundle: { dataVersion: "v45", generatedAt: "2026-11-03T00:00:00.000Z" }, storage: Object.fromEntries(first.store) });
  await updatedApp.window.fetch("data/trees/index.json");
  assert.equal(updatedApp.requested.at(-1), "data/trees/index.json");
  assert.equal(updatedApp.Native.data.activeVersion, "v45");
});

test("on the web there are no data updates to make: the service worker keeps data fresh", () => {
  assert.equal(loadNative().Native.data, null);
});

// --- What ships inside the binary ------------------------------------------------------------

const { sync, compactJson } = require("../native/scripts/sync-www.js");
let built;
function builtWww() {
  if (!built) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "ff-www-"));
    built = { out, result: sync({ root: ROOT, out, apiBase: "" }) };
  }
  return built;
}

// The entry page with the one script the sync adds removed (see the test after next).
function entryPageWithoutHeadScript(out) {
  return fs.readFileSync(path.join(out, "index.html"), "utf8").replace(/<script>window\.__FOREST_FINDS_[^<]*<\/script>\n  /, "");
}

test("the app binary's entry page is the map app, never the marketing homepage", () => {
  const { out } = builtWww();
  assert.equal(entryPageWithoutHeadScript(out), fs.readFileSync(path.join(ROOT, "app.html"), "utf8"));
});

test("the app binary names the data release it carries, before any app script runs", () => {
  const { out, result } = builtWww();
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  const firstScript = html.slice(html.indexOf("<script"));
  assert.ok(firstScript.startsWith(`<script>window.__FOREST_FINDS_BUNDLE__ = ${JSON.stringify(result.bundle)};</script>`));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "data", "manifest.json"), "utf8"));
  assert.equal(manifest.generatedAt, result.bundle.generatedAt);
  assert.ok(manifest.files["data/trees/index.json"].sha256.match(/^[0-9a-f]{64}$/));
});

test("the app binary carries no admin dashboard, server code or source artwork", () => {
  const { out } = builtWww();
  for (const forbidden of ["admin.html", "js/admin.js", "css/admin.css", "netlify", "server.js", "scripts", "spec", "test", "data/icons/src", "data/tracking"]) {
    assert.equal(fs.existsSync(path.join(out, forbidden)), false, forbidden);
  }
});

test("every script, stylesheet and icon the app page links is in the app binary (cross-file invariant)", () => {
  const { out } = builtWww();
  const html = fs.readFileSync(path.join(ROOT, "app.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="\/?((?:js|css|data)\/[^"?#]+|cookie-consent\.js|manifest\.webmanifest|terms\.html)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 20);
  for (const ref of refs) assert.ok(fs.existsSync(path.join(out, ref)), ref);
});

test("every dataset the offline service worker caches is in the app binary too (cross-file invariant)", () => {
  const { out } = builtWww();
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const dataFiles = [...sw.matchAll(/"\.\/(data\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(dataFiles.length > 20);
  for (const file of dataFiles) assert.ok(fs.existsSync(path.join(out, file)), file);
});

test("bundled GeoJSON keeps its properties and rounds only geometry, to six decimals", () => {
  const source = JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { name: "Oak", girth: 4.123456789 }, geometry: { type: "Point", coordinates: [0.0451234567, 51.6651234567] } }],
  }, null, 2);
  const compact = JSON.parse(compactJson(source, true));
  assert.deepEqual(compact.features[0].geometry.coordinates, [0.045123, 51.665123]);
  assert.equal(compact.features[0].properties.girth, 4.123456789);
});

test("a build for another deployment names it before any app script runs", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ff-www-"));
  sync({ root: ROOT, out, apiBase: "https://deploy-preview-1--example.netlify.app" });
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  const firstScript = html.indexOf("<script");
  assert.ok(html.slice(firstScript).startsWith('<script>window.__FOREST_FINDS_API_BASE__ = "https://deploy-preview-1--example.netlify.app";'));
});

// --- CORS for the bundled app ------------------------------------------------------------------

async function loadEdgeFunction() {
  const source = fs.readFileSync(path.join(ROOT, "netlify", "edge-functions", "native-cors.js"), "utf8");
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

function edgeContext(body = "ok") {
  const context = { reached: 0, next: async () => { context.reached += 1; return new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } }); } };
  return context;
}

test("the app's preflight is answered for both native WebView origins", async () => {
  const { default: handler } = await loadEdgeFunction();
  for (const origin of ["capacitor://localhost", "https://localhost"]) {
    const context = edgeContext();
    const response = await handler(new Request("https://www.eppingforestfinds.uk/api/track", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    }), context);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.match(response.headers.get("access-control-allow-methods"), /POST/);
    assert.equal(response.headers.get("access-control-allow-headers"), "content-type");
    assert.equal(context.reached, 0, "a preflight never reaches the function");
  }
});

test("the app's real request reaches the function and comes back readable by the app", async () => {
  const { default: handler } = await loadEdgeFunction();
  const context = edgeContext("tracked");
  const response = await handler(new Request("https://www.eppingforestfinds.uk/api/track", { method: "POST", headers: { Origin: "capacitor://localhost" } }), context);
  assert.equal(context.reached, 1);
  assert.equal(await response.text(), "tracked");
  assert.equal(response.headers.get("access-control-allow-origin"), "capacitor://localhost");
  assert.equal(response.headers.get("access-control-allow-credentials"), null, "no cookies are ever allowed cross-origin");
});

test("any other origin passes through untouched, with no CORS grant", async () => {
  const { default: handler } = await loadEdgeFunction();
  for (const origin of ["https://evil.example", null]) {
    const context = edgeContext();
    const headers = origin ? { Origin: origin } : {};
    const response = await handler(new Request("https://www.eppingforestfinds.uk/api/track", { method: "POST", headers }), context);
    assert.equal(context.reached, 1);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});

test("the iOS project ships the store version native/package.json names (cross-file invariant)", () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "native", "package.json"), "utf8"));
  const project = fs.readFileSync(path.join(ROOT, "native", "ios", "App", "App.xcodeproj", "project.pbxproj"), "utf8");
  const declared = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
  assert.ok(declared.length > 0);
  assert.deepEqual([...new Set(declared)], [version]);
});

test("the data manifest lists the same datasets whether or not git can be asked (CI containers and builds without .git)", () => {
  const { execFileSync } = require("child_process");
  const script = "const m=require('./scripts/lib/data-manifest.js');console.log(JSON.stringify(m.buildManifest('.').files))";
  const run = (env) => JSON.parse(execFileSync(process.execPath, ["-e", script], { cwd: ROOT, env }).toString());
  const withGit = run(process.env);
  const withoutGit = run({ ...process.env, PATH: "/nonexistent" });
  assert.ok(Object.keys(withGit).length > 20);
  assert.deepEqual(Object.keys(withoutGit), Object.keys(withGit));
});
