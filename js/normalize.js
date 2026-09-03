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

// --- Building height estimation ---
// Real height/building:levels OSM tags are rare in this area's extract (most buildings
// carry neither), so ensureBuildingHeight always needs a usable fallback -- see
// estimateBuildingHeightMetres below. projectLonLat and metresPerWorldUnit are defined in
// the main script and available at call time (same pattern as the rest of this file).

const BUILDING_HEIGHT_MIN_METRES = 4.5;
const BUILDING_HEIGHT_MAX_METRES = 24;

function clampBuildingHeight(metres) {
  return Math.min(BUILDING_HEIGHT_MAX_METRES, Math.max(BUILDING_HEIGHT_MIN_METRES, metres));
}

// Pulls a leading number out of an OSM-style height value ("12", "12.5", "12.5 m" all
// parse to 12.5). Returns null for anything that isn't a usable positive number.
function parseHeightMetres(value) {
  if (value == null) return null;
  const match = String(value).match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const metres = Number(match[0]);
  return Number.isFinite(metres) && metres > 0 ? metres : null;
}

function buildingFootprintCentroidLatLon(geometry) {
  const polygons = polygonRingsFromGeometry(geometry);
  const ring = polygons[0] && polygons[0][0];
  if (!ring || !ring.length) return null;
  let sumLon = 0;
  let sumLat = 0;
  for (const coordinate of ring) {
    sumLon += Number(coordinate[0]);
    sumLat += Number(coordinate[1]);
  }
  return { longitude: sumLon / ring.length, latitude: sumLat / ring.length };
}

// Shoelace area of the outer ring only (courtyard holes and any additional polygons of a
// MultiPolygon are ignored -- both are rare here and this is a townscape-plausible height
// guess, not a survey). Converted from world-projection units to real square metres via
// metresPerWorldUnit, valid locally since the projection is conformal.
function footprintAreaSquareMetres(geometry, centroidLatitude) {
  const polygons = polygonRingsFromGeometry(geometry);
  const ring = polygons[0] && polygons[0][0];
  if (!ring || ring.length < 3) return 0;
  let shoelace = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = projectLonLat(Number(ring[i][0]), Number(ring[i][1]));
    const next = ring[(i + 1) % ring.length];
    const b = projectLonLat(Number(next[0]), Number(next[1]));
    shoelace += a.x * b.y - b.x * a.y;
  }
  const areaWorldUnits = Math.abs(shoelace) / 2;
  const metresPerUnit = metresPerWorldUnit(centroidLatitude);
  return areaWorldUnits * metresPerUnit * metresPerUnit;
}

// Deterministic 0..1 value derived from a footprint's own centroid, standing in for
// Math.random() so a building's estimated height stays fixed across draws, frames, and
// app reloads instead of flickering or drifting.
function seededUnitInterval(longitude, latitude) {
  const seed = Math.sin(longitude * 12.9898 + latitude * 78.233) * 43758.5453;
  return seed - Math.floor(seed);
}

// Real height/building:levels tags win when present (forward-compatible with a future
// data pipeline that retains them -- see scripts/regenerate_local_environment.py). Most
// buildings in the current extract have neither, so the common path is the footprint-area
// heuristic: small structures (garages, sheds) stay low, typical two-storey houses land
// around 7-8m, larger footprints (halls, schools, retail units) scale up but are capped --
// plus a small deterministic jitter so a run of similar-sized neighbouring buildings
// doesn't look like uniform toy blocks.
function estimateBuildingHeightMetres(feature) {
  const props = (feature && feature.properties) || {};

  const explicit = parseHeightMetres(props.heightMetres) || parseHeightMetres(props.height);
  if (explicit != null) return clampBuildingHeight(explicit);

  const levels = parseFloat(props["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) return clampBuildingHeight(levels * 3 + 1.5);

  const centroid = buildingFootprintCentroidLatLon(feature && feature.geometry);
  if (!centroid) return BUILDING_HEIGHT_MIN_METRES;

  const areaSquareMetres = footprintAreaSquareMetres(feature.geometry, centroid.latitude);
  const base = 4.5 + Math.sqrt(Math.max(areaSquareMetres, 0)) * 0.55;
  const jitter = 0.85 + seededUnitInterval(centroid.longitude, centroid.latitude) * 0.3;
  return clampBuildingHeight(base * jitter);
}

// Computes (once) and caches a building's extrusion height directly on the feature so
// repeated frames/draws don't redo the footprint-area work every time -- called once per
// feature when buildings are loaded (js/loader.js's loadBuildingsIfNeeded).
function ensureBuildingHeight(feature) {
  if (!feature) return feature;
  if (!feature.properties) feature.properties = {};
  if (!Number.isFinite(feature.properties.heightMetres)) {
    feature.properties.heightMetres = estimateBuildingHeightMetres(feature);
  }
  return feature;
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
