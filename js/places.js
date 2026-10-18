// Pure place helpers shared by the live app (js/app.js, js/inspector.js, js/loader.js) and the
// static category generator (scripts/generate-find-pages.js, via loadAppRules). No DOM and no
// app state here, so both can load this file -- the generator through the same vm sandbox it
// already uses for categories.js and normalize.js -- and a place is keyed, titled and normalised
// the same way wherever it is listed.

// A bus stop's direction wording: "towards X", "Westbound", "via Y" read as direction already.
const HAS_DIRECTIONAL_WORDING_REGEX = /bound|towards|via/i;

// The stable key a place is linked and selected by (#place=<key>, selection routes, list rows).
// Prefers the source id; falls back to coordinates for a place without one.
function placeHashKey(place) {
  if (place.id !== null && place.id !== undefined && place.id !== "") {
    return `id:${String(place.id)}`;
  }
  return `ll:${Number(place.latitude).toFixed(6)},${Number(place.longitude).toFixed(6)}`;
}

// One OSM point feature as a place record. The live loader adds its map projection and find-page
// slug on top; neither belongs here, since both depend on the camera or the business index.
function landmarkFromOsmFeature(feature, buildOsmCategoryTags) {
  return {
    ...feature.properties,
    categoryTags: buildOsmCategoryTags(feature.properties),
    latitude: Number(feature.geometry.coordinates[1]),
    longitude: Number(feature.geometry.coordinates[0]),
  };
}

// A place's display title. cachedTransport is the live transport lookup for a bus stop, when one
// has been fetched; a static page has no such lookup, so it passes nothing and gets the record's
// own name. The live placeTitle (js/inspector.js) supplies the cache; everything else is shared.
function placeDisplayTitle(place, cachedTransport = null) {
  const baseName = cachedTransport?.stopName || place.transportStopName || place.name || place.categoryLabel || "Local place";
  const rawDirection = cachedTransport?.stopDirection || place.stopDirection;
  if (!isBusCategory(place) || !rawDirection) return baseName;
  const direction = String(rawDirection).replace(/\s+/g, " ").trim();
  if (!direction) return baseName;
  const directionLabel = HAS_DIRECTIONAL_WORDING_REGEX.test(direction)
    ? direction
    : `towards ${direction}`;
  if (baseName.toLowerCase().includes(directionLabel.toLowerCase())) return baseName;
  return `${baseName} — ${directionLabel}`;
}
