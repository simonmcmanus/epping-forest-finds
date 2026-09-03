
const CACHE_NAME = "forest-finds-v307";
// self.__DEV__ is injected into the response by the local dev server (see
// injectDevFlag() in server.js) — the file on disk here never sets it, so a
// production/Netlify deploy (which serves this file untouched) always gets
// IS_DEV === false. This lets local testing bypass the cache-first strategy
// below without needing a CACHE_NAME bump, which only ever happens in CI
// (.github/workflows/sw-bump.yml and sw-release.yml) and so never fires
// while iterating locally before a commit/push.
const IS_DEV = self.__DEV__ === true;

// Critical assets — install blocks until all succeed
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

// Data and asset files — cached opportunistically; individual failures do not break install
const DATA_CACHE = [
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

self.addEventListener("install", (event) => {
  // Block install only on the critical shell; pre-cache data files in the background
  const shellReady = caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(APP_SHELL))
    .then(() => self.skipWaiting());

  caches.open(CACHE_NAME).then((cache) => {
    DATA_CACHE.forEach((url) => cache.add(url).catch(() => {}));
  });

  event.waitUntil(shellReady);
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (
    requestUrl.origin === self.location.origin &&
    (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.startsWith("/.netlify/functions/"))
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== "GET") return;

  if (requestUrl.pathname === "/admin" || requestUrl.pathname === "/admin.html") {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (IS_DEV) {
    // Always prefer the network locally so edits to cached files (JS, CSS, data) show up
    // on the next refresh instead of the stale cached copy. Cache is kept as an offline
    // fallback only; it is not consulted before the network the way it is in production.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
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
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
