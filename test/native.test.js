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

// Runs js/native.js in a page-like context. `capacitor` stands in for what the shell injects.
function loadNative({ capacitor = null, permissionsState = "prompt", apiBase } = {}) {
  const requested = [];
  const listeners = new Map();
  const browserGeolocation = { getCurrentPosition() {}, watchPosition() {}, clearWatch() {} };
  const window = {
    fetch: async (url) => { requested.push(url); return { ok: true }; },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
  };
  if (capacitor) window.Capacitor = capacitor;
  if (apiBase) window.__FOREST_FINDS_API_BASE__ = apiBase;
  const context = {
    window,
    navigator: {
      geolocation: browserGeolocation,
      permissions: { query: async () => ({ state: permissionsState }) },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(NATIVE_SOURCE, context);
  const fire = (type) => (listeners.get(type) || []).slice().forEach((fn) => fn({ type }));
  return { Native: context.Native, window, requested, browserGeolocation, fire };
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

test("the app binary's entry page is the map app, never the marketing homepage", () => {
  const { out } = builtWww();
  assert.equal(fs.readFileSync(path.join(out, "index.html"), "utf8"), fs.readFileSync(path.join(ROOT, "app.html"), "utf8"));
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
  assert.ok(html.slice(firstScript).startsWith('<script>window.__FOREST_FINDS_API_BASE__ = "https://deploy-preview-1--example.netlify.app";</script>'));
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
