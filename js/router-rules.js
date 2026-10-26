// Shared URL vocabulary and serialization primitives for the app router.
// Loaded before js/app.js so the router's screen names and URL shapes are defined in one
// small, dependency-free boundary. The route actions themselves stay in js/app.js because
// they coordinate app state and screen rendering.

const ROUTE_FILTERS = "filters";
const ROUTE_SEARCH = "search";
const ROUTE_SETTINGS = "settings";
const ROUTE_REPORT = "report";
const ROUTE_COMMUNITY = "community";

const ROUTE_PATHS = {
  [ROUTE_FILTERS]: "/nearby/filter",
  [ROUTE_SEARCH]: "/nearby/search",
  [ROUTE_SETTINGS]: "/settings",
  [ROUTE_REPORT]: "/feedback",
  [ROUTE_COMMUNITY]: "/community",
};
const NEARBY_PATH = "/nearby";
const NAV_DEPTH_KEY = "forestNavDepth";
const NEARBY_ANCHOR_KEY = "forestNearbyAnchor";
const NEARBY_ANCHOR_PARAM = "near";
const NEARBY_ANCHOR_LABEL_PARAM = "label";

function nearbyAnchorRouteValue(anchor) {
  const params = new URLSearchParams();
  params.set(NEARBY_ANCHOR_PARAM, `${anchor.latitude.toFixed(6)},${anchor.longitude.toFixed(6)}`);
  if (anchor.label) params.set(NEARBY_ANCHOR_LABEL_PARAM, anchor.label);
  return params.toString();
}

function parseNearbyAnchorParam(raw) {
  const parts = String(raw || "").split(",");
  if (parts.length !== 2) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function routeParam(name, value) {
  const params = new URLSearchParams();
  params.set(name, value);
  return params.toString();
}

function routeName(raw) {
  const value = String(raw || "");
  const separator = value.indexOf("=");
  return separator === -1 ? value : value.slice(0, separator);
}
