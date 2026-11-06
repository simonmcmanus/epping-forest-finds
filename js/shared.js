// Helpers that more than one page needs: the app (app.html, loaded before every other app script) and the
// admin dashboard (admin.html). Plain functions only, no state and no DOM access at load time.

function escapeHtml(value) {
  // A missing value is empty text, not the word "undefined" or "null" on the screen.
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function forEachGeojsonCoordinate(collection, visit) {
  for (const feature of collection.features || []) {
    walkCoordinates(feature.geometry && feature.geometry.coordinates, visit);
  }
}

function walkCoordinates(value, visit) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value);
    return;
  }
  for (const item of value) walkCoordinates(item, visit);
}

function lineSegmentsFromGeometry(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates || []];
  if (geometry.type === "MultiLineString") return geometry.coordinates || [];
  return [];
}

function polygonRingsFromGeometry(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates || []];
  if (geometry.type === "MultiPolygon") return geometry.coordinates || [];
  return [];
}
