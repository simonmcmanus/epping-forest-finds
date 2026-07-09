const CACHE_NAME = "veteran-tree-finder-v106";
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
  "./js/categories.js",
  "./js/normalize.js",
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
  "./data/local-environment.geojson"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
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
