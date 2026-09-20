// Data normalization and transformation layer.
// Converts raw GeoJSON/API data into the app's internal format.
// Depends on: js/categories.js (loaded first), projectLonLat/unprojectPoint (main script, called at runtime only).

// --- Geometry helpers ---

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

// --- Path utilities ---

function pathLabelAnchor(path) {
  let bestSegment = null;
  let bestLength = 0;

  for (const segment of path.segments) {
    let length = 0;
    for (let i = 1; i < segment.length; i += 1) {
      const prev = segment[i - 1];
      const next = segment[i];
      length += Math.hypot(next.x - prev.x, next.y - prev.y);
    }
    if (length > bestLength) {
      bestLength = length;
      bestSegment = segment;
    }
  }

  if (!bestSegment || bestSegment.length < 2 || bestLength <= 0.001) return null;

  const halfway = bestLength / 2;
  let walked = 0;
  for (let i = 1; i < bestSegment.length; i += 1) {
    const prev = bestSegment[i - 1];
    const next = bestSegment[i];
    const length = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (walked + length >= halfway) {
      const ratio = (halfway - walked) / Math.max(0.000001, length);
      return {
        x: prev.x + (next.x - prev.x) * ratio,
        y: prev.y + (next.y - prev.y) * ratio,
      };
    }
    walked += length;
  }

  return bestSegment[Math.floor(bestSegment.length / 2)] || null;
}

function pathHashKey(path) {
  if (!path) return "";
  if (path.key) return path.key;
  return [
    path.name || path.ref || path.pathType || "path",
    path.bbox ? path.bbox.minX.toFixed(2) : "0",
    path.bbox ? path.bbox.minY.toFixed(2) : "0",
    path.bbox ? path.bbox.maxX.toFixed(2) : "0",
    path.bbox ? path.bbox.maxY.toFixed(2) : "0",
  ].join(":");
}

// Roads and railways are tap-only selections, but every screen the app can be on needs a URL
// for the router (see "Router" in js/app.js) -- without one, tapping a street rewrote the
// address bar to the Nearby screen's URL while a street was on screen. Roads carry no id, so
// they are keyed exactly the way paths are: what they are called plus where they are.
function roadHashKey(road) {
  if (!road) return "";
  if (road.key) return road.key;
  return [
    road.name || road.ref || road.roadType || "road",
    road.bbox ? road.bbox.minX.toFixed(2) : "0",
    road.bbox ? road.bbox.minY.toFixed(2) : "0",
    road.bbox ? road.bbox.maxX.toFixed(2) : "0",
    road.bbox ? road.bbox.maxY.toFixed(2) : "0",
  ].join(":");
}

// Railways are raw environment features, which do carry an OSM id ("way/30804").
function railwayHashKey(railway) {
  return (railway && railway.properties && railway.properties.id) || "";
}

function isWaymarkedTrail(path) {
  return Boolean(path) && path.pathType === "waymarked_trail";
}

// --- Path and road feature transforms ---
// projectLonLat and unprojectPoint are defined in the main script and available at call time.

function toPathFeature(feature) {
  if (!feature || !feature.geometry) return null;

  const tags = feature.properties || {};
  const name = tags.name || tags.ref || null;
  const highway = tags.highway || null;
  const designation = String(tags.designation || "").toLowerCase();
  const horse = tags.horse || null;
  const foot = tags.foot || null;
  const access = tags.access || null;

  const pathType = highway === "bridleway"
    || designation.includes("bridleway")
    || horse === "designated"
    ? "bridleway"
    : (designation.includes("byway") || highway === "byway")
      ? "byway"
      : (access === "permissive" || foot === "permissive" || horse === "permissive")
        ? "permissive"
        : (tags.osmcSymbol || tags.trailVisibility)
          ? "waymarked_trail"
          : "trail";

  const segments = lineSegmentsFromGeometry(feature.geometry)
    .map((segment) => segment
      .map(([longitude, latitude]) => projectLonLat(Number(longitude), Number(latitude)))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
    .filter((segment) => segment.length >= 2);

  if (!segments.length) return null;

  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let totalLength = 0;

  for (const segment of segments) {
    for (let i = 0; i < segment.length; i += 1) {
      const point = segment[i];
      bbox.minX = Math.min(bbox.minX, point.x);
      bbox.minY = Math.min(bbox.minY, point.y);
      bbox.maxX = Math.max(bbox.maxX, point.x);
      bbox.maxY = Math.max(bbox.maxY, point.y);
      if (i > 0) {
        const prev = segment[i - 1];
        totalLength += Math.hypot(point.x - prev.x, point.y - prev.y);
      }
    }
  }

  const path = {
    name,
    ref: tags.ref || null,
    key: tags.id || feature.id || null,
    pathType,
    highway,
    foot,
    horse,
    access,
    segments,
    bbox,
    totalLength,
  };
  const anchor = pathLabelAnchor(path);
  if (anchor) {
    const lonLat = unprojectPoint(anchor);
    path.point = anchor;
    path.latitude = lonLat.latitude;
    path.longitude = lonLat.longitude;
  }
  path.key = pathHashKey(path);
  return path;
}

function toRoadFeature(feature) {
  if (!feature || !feature.geometry) return null;

  const tags = feature.properties || {};
  const name = tags.name || tags.ref || null;
  const highway = tags.highway || null;
  const service = tags.service || null;
  const ref = tags.ref || null;

  const roadType = highway === "motorway" || highway === "motorway_link"
    ? "motorway"
    : highway === "trunk" || highway === "trunk_link"
      ? "trunk"
      : highway === "primary" || highway === "primary_link"
        ? "primary"
        : highway === "secondary" || highway === "secondary_link"
          ? "secondary"
          : highway === "tertiary" || highway === "tertiary_link"
            ? "tertiary"
            : highway === "residential"
              ? "residential"
              : highway === "service" && service === "alley"
                ? "alley"
                : highway === "service"
                  ? "service"
                  : "unclassified";

  const segments = lineSegmentsFromGeometry(feature.geometry)
    .map((segment) => segment
      .map(([longitude, latitude]) => projectLonLat(Number(longitude), Number(latitude)))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
    .filter((segment) => segment.length >= 2);

  if (!segments.length) return null;

  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const segment of segments) {
    for (const point of segment) {
      bbox.minX = Math.min(bbox.minX, point.x);
      bbox.minY = Math.min(bbox.minY, point.y);
      bbox.maxX = Math.max(bbox.maxX, point.x);
      bbox.maxY = Math.max(bbox.maxY, point.y);
    }
  }

  return { name, ref, roadType, highway, service, segments, bbox };
}

// --- Water feature extraction ---

function extractWaterFeatures(features) {
  const seen = new Map();
  for (const feature of features) {
    const p = feature.properties;
    if (!p || !p.name) continue;
    if (p.featureType !== "hydrology_area" && p.featureType !== "hydrology_line") continue;
    if (seen.has(p.name)) continue;
    const geom = feature.geometry;
    if (!geom) continue;
    let lat, lng;
    if (geom.type === "Polygon" && geom.coordinates[0] && geom.coordinates[0].length) {
      const ring = geom.coordinates[0];
      lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    } else if (geom.type === "LineString" && geom.coordinates.length) {
      const mid = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
      lng = mid[0]; lat = mid[1];
    } else {
      continue;
    }
    seen.set(p.name, {
      id: p.id,
      name: p.name,
      featureType: p.featureType,
      waterway: p.waterway || null,
      latitude: lat,
      longitude: lng,
      point: projectLonLat(lng, lat),
    });
  }
  return Array.from(seen.values());
}

function waterHashKey(water) {
  return water.id || water.name;
}

// --- Folklore normalization ---
// Depends on classifyFolkloreCategory, classifyFolkloreTopics, buildFolkloreCategoryTags from categories.js

function normalizeFolkloreLocations(data) {
  const input = Array.isArray(data && data.locations) ? data.locations : [];
  return input
    .filter((item) => !isGenericFolkloreLocation(item))
    .map((item, index) => {
      const coords = parseFolkloreCoordinates(item && item.coordinates);
      if (!coords) return null;
      const folkloreCategory = classifyFolkloreCategory(item);
      const folkloreTopics = classifyFolkloreTopics(item);
      const summary = item.folklore_summary || item.story_summary || item.story || "";
      return {
        id: item.id || `folklore-${index + 1}`,
        name: item.name || "Folklore location",
        category: folkloreCategory,
        categoryTags: buildFolkloreCategoryTags(item),
        folkloreCategory,
        folkloreTopics,
        categoryLabel: `Folklore · ${folkloreCategory.charAt(0).toUpperCase()}${folkloreCategory.slice(1)}`,
        type: item.type || null,
        area: item.area || item.location_description || null,
        confidence: item.confidence || null,
        address: item.address || null,
        latitude: coords.latitude,
        longitude: coords.longitude,
        point: projectLonLat(coords.longitude, coords.latitude),
        folkloreSummary: summary,
        sourceLinks: Array.isArray(item.source_links) ? item.source_links : [],
        externalLinks: Array.isArray(item.external_links) ? item.external_links : [],
        source: "Folklore dataset",
        dataSource: "folklore",
      };
    })
    .filter(Boolean);
}

function isGenericFolkloreLocation(item) {
  const blob = [
    item && item.type,
    item && item.name,
    Array.isArray(item && item.category) ? item.category.join(" ") : item && item.category,
    item && item.location_description,
    item && item.notes,
  ].filter(Boolean).join(" ").toLowerCase();
  const precision = String(item && item.location_precision || "").toLowerCase();
  return blob.includes("generic location")
    || precision.startsWith("general_")
    || blob.includes("general location credit");
}

function parseFolkloreCoordinates(coordinates) {
  if (!coordinates || typeof coordinates !== "object") return null;
  const latitude = Number(coordinates.lat ?? coordinates.latitude);
  const longitude = Number(coordinates.lng ?? coordinates.lon ?? coordinates.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}
