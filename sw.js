// self.__DEV__ is injected into the response by the local dev server (see
// injectDevFlag() in server.js) — the file on disk here never sets it, so a
// production/Netlify deploy (which serves this file untouched) always gets
// IS_DEV === false. This lets local testing bypass the cache-first strategy
// below without needing a CACHE_NAME bump, which only ever happens in CI
// (.github/workflows/sw-bump.yml and sw-release.yml) and so never fires
// while iterating locally before a commit/push.
const IS_DEV = self.__DEV__ === true;

const APP_CACHE_NAME = "forest-finds-app-v27";
const DATA_CACHE_NAME = "forest-finds-data-v4";

// APP_SHELL: Critical app code only — install blocks until all succeed
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./tree-icon.svg",
  "./css/base.css",
  "./css/filter.css",
  "./css/loading.css",
  "./css/inspector.css",
  "./css/map-ui.css",
  "./css/onboarding.css",
  "./css/tracking.css",
  "./js/categories.js",
  "./js/normalize.js",
  "./js/loader.js",
  "./js/routing.js",
  "./js/renderer.js",
  "./js/inspector.js",
  "./js/nav.js",
  "./js/onboarding.js",
  "./js/tracker.js",
];

// DATA_SHELL: Essential data that loads with the app (install blocks until all succeed)
const DATA_SHELL = [
  "./data/trees/index.json",
  "./data/epping-forest-land.geojson",
  "./data/epping-buffer-land.geojson",
  "./data/local-landmarks-food.geojson",
  "./data/local-landmarks-transport.geojson",
  "./data/local-landmarks-gates.geojson",
  "./data/local-landmarks-facilities.geojson",
  "./data/local-landmarks-historic.geojson",
  "./data/local-landmarks-tourism.geojson",
  "./data/local-landmarks-misc.geojson",
  "./data/epping_forest_folklore_locations.json",
  "./data/local-paths.geojson",
  "./data/local-environment.geojson",
];

// Additional data files — cached opportunistically; individual failures do not break install
const DATA_CACHE_OPPORTUNISTIC = [
  // Large GeoJSON data
  "./data/local-roads.geojson",
  "./data/local-environment-buildings.geojson",

  // Tree data chunks
  "./data/trees/chunk-lat0_lon0.json",
  "./data/trees/chunk-lat5158_lon0.json",
  "./data/trees/chunk-lat5159_lon0.json",
  "./data/trees/chunk-lat5159_lon1.json",
  "./data/trees/chunk-lat5160_lon0.json",
  "./data/trees/chunk-lat5161_lon0.json",
  "./data/trees/chunk-lat5161_lon1.json",
  "./data/trees/chunk-lat5161_lon3.json",
  "./data/trees/chunk-lat5161_lon4.json",
  "./data/trees/chunk-lat5162_lon1.json",
  "./data/trees/chunk-lat5162_lon2.json",
  "./data/trees/chunk-lat5162_lon3.json",
  "./data/trees/chunk-lat5162_lon4.json",
  "./data/trees/chunk-lat5163_lon-1.json",
  "./data/trees/chunk-lat5163_lon0.json",
  "./data/trees/chunk-lat5163_lon1.json",
  "./data/trees/chunk-lat5163_lon2.json",
  "./data/trees/chunk-lat5163_lon3.json",
  "./data/trees/chunk-lat5164_lon-1.json",
  "./data/trees/chunk-lat5164_lon0.json",
  "./data/trees/chunk-lat5164_lon1.json",
  "./data/trees/chunk-lat5164_lon2.json",
  "./data/trees/chunk-lat5164_lon3.json",
  "./data/trees/chunk-lat5164_lon4.json",
  "./data/trees/chunk-lat5165_lon0.json",
  "./data/trees/chunk-lat5165_lon1.json",
  "./data/trees/chunk-lat5165_lon2.json",
  "./data/trees/chunk-lat5165_lon3.json",
  "./data/trees/chunk-lat5165_lon4.json",
  "./data/trees/chunk-lat5165_lon5.json",
  "./data/trees/chunk-lat5165_lon6.json",
  "./data/trees/chunk-lat5166_lon1.json",
  "./data/trees/chunk-lat5166_lon3.json",
  "./data/trees/chunk-lat5166_lon4.json",
  "./data/trees/chunk-lat5166_lon5.json",
  "./data/trees/chunk-lat5166_lon6.json",
  "./data/trees/chunk-lat5166_lon7.json",
  "./data/trees/chunk-lat5166_lon8.json",
  "./data/trees/chunk-lat5167_lon3.json",
  "./data/trees/chunk-lat5167_lon4.json",
  "./data/trees/chunk-lat5167_lon5.json",
  "./data/trees/chunk-lat5167_lon6.json",
  "./data/trees/chunk-lat5167_lon7.json",
  "./data/trees/chunk-lat5167_lon8.json",
  "./data/trees/chunk-lat5168_lon6.json",
  "./data/trees/chunk-lat5168_lon7.json",
  "./data/trees/chunk-lat5168_lon8.json",
  "./data/trees/chunk-lat5169_lon10.json",
  "./data/trees/chunk-lat5169_lon3.json",
  "./data/trees/chunk-lat5169_lon4.json",
  "./data/trees/chunk-lat5169_lon5.json",
  "./data/trees/chunk-lat5170_lon12.json",
  "./data/trees/chunk-lat5171_lon12.json",
  "./data/trees/chunk-lat5171_lon13.json",
  "./data/trees/chunk-lat5171_lon14.json",

  // Icons
  "./data/icons/apple-touch-icon.png",
  "./data/icons/art.png",
  "./data/icons/beer.png",
  "./data/icons/blue-plaques.png",
  "./data/icons/bus.png",
  "./data/icons/cafe.png",
  "./data/icons/campsite.png",
  "./data/icons/celebreties.png",
  "./data/icons/church.png",
  "./data/icons/compass.png",
  "./data/icons/cow.png",
  "./data/icons/crown.png",
  "./data/icons/distance.png",
  "./data/icons/dry-cleaning.png",
  "./data/icons/education.png",
  "./data/icons/feedback.png",
  "./data/icons/film.png",
  "./data/icons/filter.png",
  "./data/icons/food.png",
  "./data/icons/gate.png",
  "./data/icons/historic.png",
  "./data/icons/history.png",
  "./data/icons/home.png",
  "./data/icons/icon-192.png",
  "./data/icons/icon-512.png",
  "./data/icons/icon-maskable-512.png",
  "./data/icons/landmark-archaeological.png",
  "./data/icons/landmark-bench.png",
  "./data/icons/landmark-campsite.png",
  "./data/icons/landmark-drinking-water.png",
  "./data/icons/landmark-dry-cleaning.png",
  "./data/icons/landmark-information.png",
  "./data/icons/landmark-monument.png",
  "./data/icons/landmark-museum.png",
  "./data/icons/landmark-parking.png",
  "./data/icons/landmark-taxi.png",
  "./data/icons/landmark-toilets.png",
  "./data/icons/legends.png",
  "./data/icons/literature.png",
  "./data/icons/medicine.png",
  "./data/icons/national-rail.png",
  "./data/icons/nature.png",
  "./data/icons/nearby.png",
  "./data/icons/oak.png",
  "./data/icons/pin.png",
  "./data/icons/plaques.png",
  "./data/icons/politics.png",
  "./data/icons/ponds.png",
  "./data/icons/restaurant.png",
  "./data/icons/science.png",
  "./data/icons/settings.png",
  "./data/icons/shop.png",
  "./data/icons/signal.png",
  "./data/icons/social-history.png",
  "./data/icons/stories.png",
  "./data/icons/theatre.png",
  "./data/icons/tick.png",
  "./data/icons/tree.png",
  "./data/icons/trees/ash.png",
  "./data/icons/trees/beach.png",
  "./data/icons/trees/holly.png",
  "./data/icons/trees/hornbeam.png",
  "./data/icons/trees/logo.png",
  "./data/icons/trees/oak.png",
  "./data/icons/trees/wild.png",
  "./data/icons/underground.png",
  "./data/icons/walking.png",
  "./data/icons/waymarked.png",
  "./data/icons/wwII.png",
];

// Helper: determine if a path is app code vs data
function isAppCodePath(pathname) {
  // App code: CSS, JS, HTML, SVG, manifest
  return (
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webmanifest") ||
    pathname === "/" ||
    pathname === ""
  );
}

function isDataPath(pathname) {
  // Data: anything under /data/ or icons
  return pathname.startsWith("/data/");
}

// Synthetic cache entry (never requested by the page) recording when the data cache was last
// checked against the network, and whether something has marked it stale. Lives in the data cache
// itself so it is created, migrated, and thrown away with the data it describes.
const DATA_SYNC_STATE_URL = "./__data-sync-state";
const DATA_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DATA_SYNC_CONCURRENCY = 6;

function isDataSyncStateRequest(request) {
  return request.url.endsWith("__data-sync-state");
}

// Returns only the URLs that are not already in this cache. Every app release bumps
// APP_CACHE_NAME, which re-runs install -- and install used to cache.addAll() the whole DATA_SHELL
// plus every opportunistic entry each time, re-downloading ~67 MB of unchanged GeoJSON on what
// should have been an instant reload for a returning user. The data cache survives app bumps
// (its own name only moves when the data does), so skipping what is already there makes an app
// release cost the app shell and nothing else.
async function missingFromCache(cache, urls) {
  const missing = [];
  for (const url of urls) {
    const hit = await cache.match(url);
    if (!hit) missing.push(url);
  }
  return missing;
}

async function readDataSyncState(cache) {
  try {
    const stored = await cache.match(DATA_SYNC_STATE_URL);
    if (!stored) return {};
    return await stored.json();
  } catch (error) {
    return {};
  }
}

async function writeDataSyncState(cache, patch) {
  const next = Object.assign(await readDataSyncState(cache), patch);
  await cache.put(
    DATA_SYNC_STATE_URL,
    new Response(JSON.stringify(next), { headers: { "Content-Type": "application/json" } })
  );
}

// When DATA_CACHE_NAME moves, carry the previous cache's bodies into the new one instead of
// letting activate drop them and install re-download everything. The user keeps a working offline
// map for the whole of the upgrade, and the actual refresh happens later, off the critical path,
// through syncData() below -- which the staleSince stamp forces on the next boot.
async function adoptPreviousDataCache(cache) {
  const keys = await caches.keys();
  const previous = keys.filter((key) => key !== DATA_CACHE_NAME && /^forest-finds-(dev-)?data-/.test(key));
  let adopted = 0;

  for (const name of previous) {
    const old = await caches.open(name);
    for (const request of await old.keys()) {
      if (isDataSyncStateRequest(request)) continue;
      if (await cache.match(request)) continue;
      const response = await old.match(request);
      if (!response) continue;
      await cache.put(request, response);
      adopted += 1;
    }
  }

  if (adopted > 0) await writeDataSyncState(cache, { staleSince: Date.now() });
  return adopted;
}

self.addEventListener("install", (event) => {
  // Block install on critical app shell
  const appReady = caches
    .open(APP_CACHE_NAME)
    .then(async (cache) => {
      const missing = await missingFromCache(cache, APP_SHELL);
      if (missing.length > 0) await cache.addAll(missing);
    })
    .then(() => self.skipWaiting());

  // Block install on critical data shell -- inheriting whatever a previous data cache already
  // holds first, so only genuinely absent files are fetched.
  const dataReady = caches
    .open(DATA_CACHE_NAME)
    .then(async (cache) => {
      await adoptPreviousDataCache(cache);
      const missing = await missingFromCache(cache, DATA_SHELL);
      if (missing.length > 0) await cache.addAll(missing);

      // Pre-cache optional data in the background, again only what is missing
      missingFromCache(cache, DATA_CACHE_OPPORTUNISTIC).then((optional) => {
        optional.forEach((url) => cache.add(url).catch(() => {}));
      });
    });

  event.waitUntil(Promise.all([appReady, dataReady]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_CACHE_NAME && key !== DATA_CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Builds the conditional headers for revalidating one cached entry. Leaning on the browser's own
// HTTP cache (`cache: "no-cache"`) is not enough here: the two largest datasets (local-roads and
// local-paths, ~34 MB together) exceed Chromium's per-entry disk-cache limit, so it holds no
// validator for them and silently re-downloads both in full on every sync. Sending the validator
// we already hold in Cache Storage makes the revalidation work for every entry regardless of size.
function conditionalHeaders(cached) {
  const headers = new Headers();
  if (!cached) return headers;
  const etag = cached.headers.get("ETag");
  const modified = cached.headers.get("Last-Modified");
  if (etag) headers.set("If-None-Match", etag);
  else if (modified) headers.set("If-Modified-Since", modified);
  return headers;
}

// A server that honours the conditional request answers 304 and we never see a body. One that
// ignores it sends the whole file back, so compare validators before writing anything.
function responseChanged(cached, fresh) {
  const etag = fresh.headers.get("ETag");
  if (etag) return etag !== cached.headers.get("ETag");
  const modified = fresh.headers.get("Last-Modified");
  if (modified) return modified !== cached.headers.get("Last-Modified");
  const length = fresh.headers.get("Content-Length");
  if (length) return length !== cached.headers.get("Content-Length");
  return true;
}

let dataSyncInFlight = null;

// Background freshness pass. The production fetch handler below is cache-first, so on its own it
// would serve the same map data forever; this is what eventually replaces it, without any page
// load ever waiting on the network. The client asks for it once the map is up
// (requestBackgroundDataSync in js/nav.js). Each entry is revalidated conditionally, so an
// unchanged file costs a 304 and no bytes; only entries whose validators moved are written back.
async function syncData({ force = false } = {}) {
  if (dataSyncInFlight) return dataSyncInFlight;

  dataSyncInFlight = (async () => {
    const cache = await caches.open(DATA_CACHE_NAME);
    const syncState = await readDataSyncState(cache);
    const due =
      force ||
      syncState.staleSince != null ||
      !syncState.lastSyncAt ||
      Date.now() - syncState.lastSyncAt >= DATA_SYNC_INTERVAL_MS;
    if (!due) return { ran: false, changed: 0 };

    const requests = (await cache.keys()).filter((request) => !isDataSyncStateRequest(request));
    let next = 0;
    let changed = 0;
    let failed = 0;

    const worker = async () => {
      while (next < requests.length) {
        const request = requests[next];
        next += 1;
        try {
          const cached = await cache.match(request);
          // "no-store" keeps the browser's HTTP cache out of it entirely — the conditional
          // headers above are the whole mechanism, so a 304 here really did cost no bytes.
          const fresh = await fetch(request.url, { cache: "no-store", headers: conditionalHeaders(cached) });
          if (fresh.status === 304) continue;
          if (!fresh.ok) continue;
          if (cached && !responseChanged(cached, fresh)) continue;
          await cache.put(request, fresh.clone());
          changed += 1;
        } catch (error) {
          failed += 1;
          // Offline, or one file the server no longer serves -- keep the cached copy either way.
        }
      }
    };

    await Promise.all(Array.from({ length: DATA_SYNC_CONCURRENCY }, worker));

    // Only record a pass that actually reached the network. Stamping a wholly failed sweep (the
    // connection dropped mid-walk, say) would push the real check six hours out and quietly clear
    // the staleSince flag that a just-migrated cache depends on.
    if (requests.length > 0 && failed === requests.length) return { ran: false, changed: 0 };

    await writeDataSyncState(cache, { lastSyncAt: Date.now(), staleSince: null });
    return { ran: true, changed };
  })().finally(() => {
    dataSyncInFlight = null;
  });

  return dataSyncInFlight;
}

async function notifyDataUpdated(changed) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: "DATA_UPDATED", changed }));
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === "SYNC_DATA") {
    event.waitUntil(
      syncData({ force: event.data.force === true })
        .then((result) => (result.ran && result.changed > 0 ? notifyDataUpdated(result.changed) : undefined))
        .catch(() => {})
    );
  }
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  // Always bypass cache for API and admin requests
  if (
    requestUrl.origin === self.location.origin &&
    (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.startsWith("/.netlify/functions/"))
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== "GET") return;

  // Always bypass cache for admin pages
  if (requestUrl.pathname === "/admin" || requestUrl.pathname === "/admin.html") {
    event.respondWith(fetch(event.request));
    return;
  }

  // Navigation requests (full page loads) — serve the cached shell straight away, then refresh
  // the cached copy behind the scenes. This used to be network-first, which meant every reload,
  // however warm the cache, blocked on a ~290 KB index.html round trip before a single pixel
  // appeared; on a phone in the forest that is the difference between "instant" and "loading".
  // Staleness is still bounded: the browser re-checks sw.js on every navigation, and a release
  // bumps APP_CACHE_NAME, so a new worker installs, caches the new shell, and claims the page
  // (setupPwa in js/nav.js then surfaces the update). Locally the dev server is the source of
  // truth, so IS_DEV keeps navigation network-first there.
  if (event.request.mode === "navigate") {
    const fromNetwork = fetch(event.request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(APP_CACHE_NAME).then((cache) => cache.put("./index.html", copy));
      }
      return response;
    });

    event.respondWith(
      IS_DEV
        ? fromNetwork.catch(() => caches.match("./index.html"))
        : caches.match("./index.html").then((cached) => {
            if (cached) {
              fromNetwork.catch(() => {});
              return cached;
            }
            return fromNetwork.catch(() => caches.match("./index.html"));
          })
    );
    return;
  }

  // Determine which cache to use based on request type
  let cacheName;
  if (isAppCodePath(requestUrl.pathname)) {
    cacheName = APP_CACHE_NAME;
  } else if (isDataPath(requestUrl.pathname)) {
    cacheName = DATA_CACHE_NAME;
  } else {
    return;
  }

  if (IS_DEV) {
    // Always prefer the network locally so edits show up on refresh
    // Cache is kept as an offline fallback only
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(cacheName).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
