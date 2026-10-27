// Behaviour of sw.js, executed against an in-memory Cache Storage and a scripted network.
// Every test asserts what a visitor or the network would observe (what was served, fetched,
// cached, or posted to open pages), never what the source text says.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const ORIGIN = "http://localhost:8080";
const absolute = (key) => new URL(typeof key === "string" ? key : key.url, `${ORIGIN}/`).href;

function makeCacheStorage() {
  const stores = new Map();
  const open = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    const rebuild = (saved) => new Response(saved.body, { status: saved.status, headers: saved.headers });
    return {
      entries,
      async match(key) {
        const saved = entries.get(absolute(key));
        return saved ? rebuild(saved) : undefined;
      },
      async put(key, response) {
        entries.set(absolute(key), {
          status: response.status,
          headers: [...response.headers.entries()],
          body: await response.clone().text(),
        });
      },
      async keys() {
        return [...entries.keys()].map((url) => ({ url }));
      },
      async addAll(urls) {
        for (const url of urls) await this.put(url, await fetchLog.fetch(url));
      },
      async add(url) {
        await this.put(url, await fetchLog.fetch(url));
      },
    };
  };
  const fetchLog = { fetch: null };
  return {
    stores,
    fetchLog,
    async open(name) { return open(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(key) {
      for (const name of stores.keys()) {
        const hit = await open(name).match(key);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

// network: (url, init) => Response | throws. Defaults to 200 with the URL as the body.
// update: an older worker is already active in this registration (an app or data release), as
// opposed to a visitor's very first install.
function loadServiceWorker({ dev = false, network, update = false } = {}) {
  const handlers = {};
  const cacheStorage = makeCacheStorage();
  const requested = [];
  const posted = [];
  let skipWaitingCalls = 0;

  const fetchImpl = async (input, init = {}) => {
    const url = absolute(input);
    requested.push({ url, init });
    if (network) return network(url, init);
    return new Response(`body of ${url}`, { status: 200 });
  };
  cacheStorage.fetchLog.fetch = fetchImpl;

  const context = {
    self: {
      __DEV__: dev ? true : undefined,
      location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
      addEventListener: (type, handler) => { handlers[type] = handler; },
      skipWaiting: () => { skipWaitingCalls += 1; },
      clients: {
        claim: async () => {},
        matchAll: async () => [{ postMessage: (message) => posted.push(message) }],
      },
      registration: update ? { active: {} } : {},
    },
    importScripts: (...files) => {
      for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
    },
    caches: cacheStorage,
    fetch: fetchImpl,
    Response, Headers, URL, console, Date, Promise,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sw.js"), "utf8"), context, { filename: "sw.js" });

  const constant = (name) => vm.runInContext(name, context);

  async function dispatchLifecycle(type) {
    const waits = [];
    handlers[type]({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  }

  // Fires a fetch event; resolves to { handled, response }. handled is false when the worker
  // declined the request (so the browser goes to the network by itself).
  async function request(pathname, { mode = "cors", method = "GET" } = {}) {
    let responded;
    handlers.fetch({
      request: { url: `${ORIGIN}${pathname}`, method, mode },
      respondWith: (value) => { responded = Promise.resolve(value); },
    });
    if (!responded) return { handled: false };
    return { handled: true, response: await responded };
  }

  async function message(data) {
    const waits = [];
    const replies = [];
    handlers.message({ data, waitUntil: (p) => waits.push(p), source: { postMessage: (m) => replies.push(m) } });
    await Promise.all(waits);
    return replies;
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  return { cacheStorage, requested, posted, constant, dispatchLifecycle, request, message, settle, skipWaiting: () => skipWaitingCalls };
}

const body = async (response) => response.text();

test.describe("installing", () => {
  test("a first install downloads the app shell and leaves the map data to the page already fetching it", async () => {
    const sw = loadServiceWorker();
    await sw.dispatchLifecycle("install");
    await sw.settle();
    const fetched = new Set(sw.requested.map((r) => r.url));
    for (const file of sw.constant("APP_SHELL")) {
      assert.ok(fetched.has(absolute(file)), `${file} should be downloaded`);
    }
    assert.deepEqual(sw.requested.filter((r) => r.url.includes("/data/")).map((r) => r.url), [],
      "no map file is downloaded a second time while the first page is downloading it");
  });

  test("a first install leaves the map data to the page even when the page's first files have already reached the cache", async () => {
    const sw = loadServiceWorker();
    // js/loader.js can hand over a small file before install gets as far as the data cache.
    await (await sw.cacheStorage.open(sw.constant("DATA_CACHE_NAME"))).put("./data/events.json", new Response("{}"));
    await sw.dispatchLifecycle("install");
    await sw.settle();
    assert.deepEqual(sw.requested.filter((r) => r.url.includes("/data/")).map((r) => r.url), []);
  });

  test("after a first visit, the map files the page handed over are served offline and the next sync fills in the rest", async () => {
    const sw = loadServiceWorker();
    await sw.dispatchLifecycle("install");
    await sw.dispatchLifecycle("activate");
    // What js/loader.js does on a first visit, for each file the page downloaded.
    const dataCache = await sw.cacheStorage.open(sw.constant("DATA_CACHE_NAME"));
    await dataCache.put("./data/local-paths.geojson", new Response("paths from the page"));
    sw.requested.length = 0;

    const served = await sw.request("/data/local-paths.geojson");
    assert.equal(await body(served.response), "paths from the page");
    assert.equal(sw.requested.length, 0, "served from the cache, not downloaded again");

    await sw.message({ type: "SYNC_DATA" });
    const synced = new Set(sw.requested.map((r) => r.url));
    for (const file of sw.constant("DATA_SHELL")) {
      assert.ok(await dataCache.match(file), `${file} is cached after the first sync`);
    }
    assert.ok(synced.has(absolute("./data/local-environment.geojson")), "a file the page never handed over is fetched by the sync");
  });

  test("a reinstall fetches only the shell files that are not already cached", async () => {
    const sw = loadServiceWorker({ update: true });
    const appShell = sw.constant("APP_SHELL");
    const dataShell = sw.constant("DATA_SHELL");
    const appCache = await sw.cacheStorage.open(sw.constant("APP_CACHE_NAME"));
    const dataCache = await sw.cacheStorage.open(sw.constant("DATA_CACHE_NAME"));
    for (const file of appShell.slice(1)) await appCache.put(file, new Response("cached"));
    for (const file of dataShell.slice(1)) await dataCache.put(file, new Response("cached"));

    await sw.dispatchLifecycle("install");
    await sw.settle();

    const shellFetches = sw.requested.map((r) => r.url);
    assert.ok(shellFetches.includes(absolute(appShell[0])), "the one missing app file is fetched");
    assert.ok(shellFetches.includes(absolute(dataShell[0])), "the one missing data file is fetched");
    for (const file of [...appShell.slice(1), ...dataShell.slice(1)]) {
      assert.ok(!shellFetches.includes(absolute(file)), `${file} was already cached and must not be re-downloaded`);
    }
  });

  test("a data cache version bump keeps the previous data usable and schedules a background refresh", async () => {
    const sw = loadServiceWorker({ update: true });
    const previous = await sw.cacheStorage.open("forest-finds-data-0");
    await previous.put("./data/local-roads.geojson", new Response("old roads"));

    await sw.dispatchLifecycle("install");

    const current = await sw.cacheStorage.open(sw.constant("DATA_CACHE_NAME"));
    assert.equal(await body(await current.match("./data/local-roads.geojson")), "old roads", "old bodies carried over");
    assert.ok(
      !sw.requested.some((r) => r.url.endsWith("/data/local-roads.geojson")),
      "the carried-over file is not downloaded again during install"
    );
    const state = await (await current.match("./__data-sync-state")).json();
    assert.notEqual(state.staleSince, undefined, "the adopted data is marked stale so the next sync is not throttled");
  });

  test("install succeeds even when the optional tree chunks and icons cannot be downloaded", async () => {
    const sw = loadServiceWorker({
      update: true,
      network: (url) => (/\/data\/(trees\/chunk-|icons\/)/.test(url) ? Promise.reject(new TypeError("offline")) : new Response("ok")),
    });
    await sw.dispatchLifecycle("install");
    await sw.settle();
    const dataCache = await sw.cacheStorage.open(sw.constant("DATA_CACHE_NAME"));
    assert.ok(await dataCache.match("./data/trees/index.json"), "the tree chunk index is in the cache");
    assert.ok(!(await dataCache.match("./data/trees/chunk-lat5163_lon0.json")), "a chunk that failed to download is simply absent, not an install failure");
  });

  test("the app and data caches are named from their independent version markers", () => {
    const sw = loadServiceWorker();
    const read = (file, name) => vm.runInNewContext(`${fs.readFileSync(path.join(root, file), "utf8")}\n${name}`, {});
    assert.equal(sw.constant("APP_CACHE_NAME"), `forest-finds-app-${read("js/app-cache-version.js", "APP_CACHE_VERSION")}`);
    assert.equal(sw.constant("DATA_CACHE_NAME"), `forest-finds-data-${read("js/data-cache-version.js", "DATA_CACHE_VERSION")}`);
  });

  test("a new worker waits instead of taking over, until the page asks it to activate", async () => {
    const sw = loadServiceWorker();
    await sw.dispatchLifecycle("install");
    assert.equal(sw.skipWaiting(), 0, "install alone must not replace the running app");
    await sw.message({ type: "SKIP_WAITING" });
    assert.equal(sw.skipWaiting(), 1, "an explicit request activates it");
  });

  test("activating removes caches from older versions but keeps the current ones", async () => {
    const sw = loadServiceWorker();
    for (const name of ["forest-finds-app-0", "forest-finds-data-0", sw.constant("APP_CACHE_NAME"), sw.constant("DATA_CACHE_NAME"), sw.constant("COMMUNITY_CACHE_NAME")]) {
      await sw.cacheStorage.open(name);
    }
    await sw.dispatchLifecycle("activate");
    const remaining = await sw.cacheStorage.keys();
    assert.deepEqual(remaining.sort(), [sw.constant("APP_CACHE_NAME"), sw.constant("COMMUNITY_CACHE_NAME"), sw.constant("DATA_CACHE_NAME")].sort());
  });
});

test.describe("serving requests", () => {
  const offline = () => { throw new TypeError("offline"); };

  test("API calls always go to the network and are never cached", async () => {
    const sw = loadServiceWorker();
    const { response } = await sw.request("/api/cows");
    assert.equal(await body(response), `body of ${ORIGIN}/api/cows`);
    await sw.settle();
    for (const store of sw.cacheStorage.stores.values()) assert.equal(store.size, 0);
  });

  test("an offline API call fails for the caller to handle, rather than serving stale data", async () => {
    const sw = loadServiceWorker({ network: offline });
    await assert.rejects(sw.request("/api/cows"), /offline/);
  });

  test("a returning visitor gets the cached app instantly, and a newer deploy's page never replaces this release's", async () => {
    const sw = loadServiceWorker({ network: () => new Response("next release's shell") });
    const appCache = await sw.cacheStorage.open(sw.constant("APP_CACHE_NAME"));
    await appCache.put("./app.html", new Response("cached shell"));

    for (let visit = 0; visit < 2; visit += 1) {
      const { response } = await sw.request("/nearby", { mode: "navigate" });
      assert.equal(await body(response), "cached shell", "the page always matches the scripts this release cached");
      await sw.settle();
    }
    assert.equal(await body(await appCache.match("./app.html")), "cached shell");
  });

  test("every script and stylesheet app.html loads opens offline from the shell its release installed", async () => {
    let online = true;
    const sw = loadServiceWorker({
      network: (url) => {
        if (!online) throw new TypeError("offline");
        return new Response(`installed ${url}`);
      },
    });
    await sw.dispatchLifecycle("install");
    await sw.dispatchLifecycle("activate");
    online = false;

    const html = fs.readFileSync(path.join(root, "app.html"), "utf8");
    const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.some((ref) => ref.startsWith("js/")) && refs.some((ref) => ref.startsWith("css/")));
    for (const ref of refs) {
      const { handled, response } = await sw.request(`/${ref}`);
      assert.ok(handled, `${ref} should be answered by the worker`);
      assert.equal(await body(response), `installed ${ORIGIN}/${ref.split("?")[0]}`, `${ref} should come from the installed shell`);
    }
  });

  test("an app worker never serves a newer, still-waiting release's files", async () => {
    const sw = loadServiceWorker({ network: () => new Response("network js") });
    const waiting = await sw.cacheStorage.open("forest-finds-app-v999999");
    await waiting.put("./js/added-next-release.js", new Response("waiting release js"));
    const { response } = await sw.request("/js/added-next-release.js");
    assert.equal(await body(response), "network js");
  });

  test("with no cache yet, the first visit comes from the network", async () => {
    const sw = loadServiceWorker({ network: () => new Response("fresh shell") });
    const { response } = await sw.request("/nearby", { mode: "navigate" });
    assert.equal(await body(response), "fresh shell");
  });

  test("offline, every app screen opens from the cached shell", async () => {
    const sw = loadServiceWorker({ network: offline });
    const appCache = await sw.cacheStorage.open(sw.constant("APP_CACHE_NAME"));
    await appCache.put("./app.html", new Response("cached shell"));
    for (const pathname of ["/nearby", "/nearby/search", "/settings", "/nearby/pubs/", "/find/the-forresters/"]) {
      const { response } = await sw.request(pathname, { mode: "navigate" });
      assert.equal(await body(response), "cached shell", `${pathname} should open offline`);
    }
  });

  test("offline, a business or category page falls back to this release's shell, never a waiting release's", async () => {
    const sw = loadServiceWorker({ network: offline });
    // Created first, so a search across every cache would find it before this release's own.
    const waiting = await sw.cacheStorage.open("forest-finds-app-v0");
    await waiting.put("./app.html", new Response("waiting release shell"));
    const appCache = await sw.cacheStorage.open(sw.constant("APP_CACHE_NAME"));
    await appCache.put("./app.html", new Response("cached shell"));
    const { response } = await sw.request("/find/the-forresters/", { mode: "navigate" });
    assert.equal(await body(response), "cached shell");
  });

  test("online, a business or category page shows its own content rather than the generic shell", async () => {
    const sw = loadServiceWorker({ network: () => new Response("the forresters page") });
    const appCache = await sw.cacheStorage.open(sw.constant("APP_CACHE_NAME"));
    await appCache.put("./app.html", new Response("cached shell"));
    const { response } = await sw.request("/find/the-forresters/", { mode: "navigate" });
    assert.equal(await body(response), "the forresters page");
  });

  test("the marketing homepage and other site pages are left to the network", async () => {
    const sw = loadServiceWorker();
    const appCache = await sw.cacheStorage.open(sw.constant("APP_CACHE_NAME"));
    await appCache.put("./app.html", new Response("cached shell"));
    for (const pathname of ["/", "/reports/", "/terms.html"]) {
      assert.equal((await sw.request(pathname, { mode: "navigate" })).handled, false, `${pathname} must not be answered by the app cache`);
    }
  });

  test("marketing assets are never read from or written to the app caches", async () => {
    const sw = loadServiceWorker();
    assert.equal((await sw.request("/assets/home/hero.css")).handled, false);
  });

  test("the app shell does not contain the marketing homepage", () => {
    const shell = vm.runInContext("APP_SHELL", loadServiceWorkerContext());
    assert.ok(shell.includes("./app.html"));
    assert.ok(!shell.includes("./"), "'./' resolves to the marketing homepage");
  });

  test("app code is served cache-first in production", async () => {
    const sw = loadServiceWorker({ network: () => new Response("network js") });
    const appCache = await sw.cacheStorage.open(sw.constant("APP_CACHE_NAME"));
    await appCache.put("./js/app.js", new Response("cached js"));
    const { response } = await sw.request("/js/app.js");
    assert.equal(await body(response), "cached js");
    assert.equal(sw.requested.length, 0, "no network round trip for a cached file");
  });

  test("local dev prefers the network so edits show up, falling back to the cache offline", async () => {
    const sw = loadServiceWorker({ dev: true, network: () => new Response("edited js") });
    const appCache = await sw.cacheStorage.open(sw.constant("APP_CACHE_NAME"));
    await appCache.put("./js/app.js", new Response("cached js"));
    assert.equal(await body((await sw.request("/js/app.js")).response), "edited js");

    const offlineSw = loadServiceWorker({ dev: true, network: offline });
    const offlineCache = await offlineSw.cacheStorage.open(offlineSw.constant("APP_CACHE_NAME"));
    await offlineCache.put("./js/app.js", new Response("cached js"));
    assert.equal(await body((await offlineSw.request("/js/app.js")).response), "cached js");
  });

  test("the community overlay is served stale-while-revalidate and open pages hear about changes", async () => {
    const overlay = { reports: [1] };
    const sw = loadServiceWorker({ network: () => new Response(JSON.stringify(overlay), { headers: { "Content-Type": "application/json" } }) });
    const cache = await sw.cacheStorage.open(sw.constant("COMMUNITY_CACHE_NAME"));
    await cache.put("/api/community/overlay", new Response(JSON.stringify({ reports: [] })));

    const { response } = await sw.request("/api/community/overlay");
    assert.deepEqual(await response.json(), { reports: [] }, "the cached overlay is served immediately");
    await sw.settle();
    assert.deepEqual(JSON.parse(JSON.stringify(sw.posted)), [{ type: "COMMUNITY_UPDATED", data: overlay }]);

    sw.posted.length = 0;
    await sw.request("/api/community/overlay");
    await sw.settle();
    assert.deepEqual(sw.posted, [], "an unchanged overlay does not notify");
  });
});

test.describe("background data sync", () => {
  async function seededWorker(network, { fresh = false } = {}) {
    const sw = loadServiceWorker({ network });
    const cache = await sw.cacheStorage.open(sw.constant("DATA_CACHE_NAME"));
    await cache.put("./data/events.json", new Response("old events", { headers: { ETag: '"v1"' } }));
    if (fresh) await cache.put("./__data-sync-state", new Response(JSON.stringify({ lastSyncAt: Date.now() })));
    return { sw, cache };
  }

  const syncedUrls = (sw) => sw.requested.map((r) => r.url);

  test("an unchanged file costs a conditional request and no rewrite", async () => {
    const { sw, cache } = await seededWorker((url) => (url.endsWith("/events.json") ? new Response(null, { status: 304 }) : new Response("x", { status: 404 })));
    const [reply] = await sw.message({ type: "SYNC_DATA", force: true, requestId: "r1" });
    const events = sw.requested.find((r) => r.url.endsWith("/data/events.json"));
    assert.equal(events.init.headers.get("If-None-Match"), '"v1"', "revalidates with the validator it already holds");
    assert.equal(await body(await cache.match("./data/events.json")), "old events");
    assert.equal(sw.posted.length, 0, "nothing changed, so pages are not told");
    assert.equal(reply.requestId, "r1");
  });

  test("a changed file replaces the cached copy and open pages are told", async () => {
    const { sw, cache } = await seededWorker((url) =>
      url.endsWith("/events.json") ? new Response("new events", { headers: { ETag: '"v2"' } }) : new Response("x", { status: 404 }));
    await sw.message({ type: "SYNC_DATA", force: true });
    assert.equal(await body(await cache.match("./data/events.json")), "new events");
    assert.deepEqual(JSON.parse(JSON.stringify(sw.posted)), [{ type: "DATA_UPDATED", changed: 1 }]);
  });

  test("filling in map files the cache never had stores them without announcing new map data", async () => {
    const { sw, cache } = await seededWorker((url) =>
      url.endsWith("/events.json") ? new Response(null, { status: 304 }) : new Response("first download"));
    await sw.message({ type: "SYNC_DATA", force: true });
    assert.equal(await body(await cache.match("./data/local-roads.geojson")), "first download");
    assert.deepEqual(sw.posted, [], "nothing on the person's map changed, so no restart is offered");
  });

  test("a server that ignores the conditional request but returns the same validator is not rewritten", async () => {
    const { sw, cache } = await seededWorker((url) =>
      url.endsWith("/events.json") ? new Response("old events", { headers: { ETag: '"v1"' } }) : new Response("x", { status: 404 }));
    await sw.message({ type: "SYNC_DATA", force: true });
    assert.equal(sw.posted.length, 0);
    assert.equal(await body(await cache.match("./data/events.json")), "old events");
  });

  test("a sync that ran recently is skipped unless forced", async () => {
    const { sw } = await seededWorker((url) => new Response("x"), { fresh: true });
    await sw.message({ type: "SYNC_DATA" });
    assert.deepEqual(syncedUrls(sw), [], "throttled: no network at all");
    await sw.message({ type: "SYNC_DATA", force: true });
    assert.ok(syncedUrls(sw).length > 0, "a manual refresh always checks");
  });

  test("a cache marked stale syncs even inside the throttle window", async () => {
    const { sw, cache } = await seededWorker(() => new Response(null, { status: 304 }), { fresh: true });
    await cache.put("./__data-sync-state", new Response(JSON.stringify({ lastSyncAt: Date.now(), staleSince: Date.now() })));
    await sw.message({ type: "SYNC_DATA" });
    assert.ok(syncedUrls(sw).length > 0);
  });

  test("a forced sync repairs files missing from a partial cache", async () => {
    const { sw, cache } = await seededWorker(() => new Response("downloaded"));
    await sw.message({ type: "SYNC_DATA", force: true });
    assert.equal(await body(await cache.match("./data/local-roads.geojson")), "downloaded");
  });

  test("a sync where the network is unreachable reports failure and keeps the cached data and the stale flag", async () => {
    const { sw, cache } = await seededWorker(() => { throw new TypeError("offline"); });
    await cache.put("./__data-sync-state", new Response(JSON.stringify({ staleSince: 123 })));
    const [reply] = await sw.message({ type: "SYNC_DATA", force: true });
    assert.equal(reply.ok, false);
    assert.equal(await body(await cache.match("./data/events.json")), "old events");
    const state = await (await cache.match("./__data-sync-state")).json();
    assert.equal(state.staleSince, 123, "a wholly failed sweep must not clear the stale flag");
    assert.equal(state.lastSyncAt, undefined, "and must not count as a successful check");
  });

  test("a fully successful sync records the check and clears the stale flag", async () => {
    const { sw, cache } = await seededWorker(() => new Response(null, { status: 304 }));
    await cache.put("./__data-sync-state", new Response(JSON.stringify({ staleSince: 123 })));
    const [reply] = await sw.message({ type: "SYNC_DATA", force: true });
    assert.equal(reply.ok, true);
    const state = await (await cache.match("./__data-sync-state")).json();
    assert.equal(state.staleSince, null);
    assert.ok(state.lastSyncAt > 0);
  });
});

// A bare context with the worker's constants, for data-level checks that need no events.
function loadServiceWorkerContext() {
  const context = {
    self: { location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN }, addEventListener() {} },
    importScripts: (...files) => files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), context)),
    Response, Headers, URL, console,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "sw.js"), "utf8"), context, { filename: "sw.js" });
  return context;
}
