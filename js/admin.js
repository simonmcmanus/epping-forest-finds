// Admin map renderer for Epping Forest Finds tracking data.

// Approximate bounding box for Epping Forest area
const BOUNDS = { minLat: 51.595, maxLat: 51.730, minLng: -0.110, maxLng: 0.155 };

const ADMIN_MAP_URLS = {
  forest: "data/epping-forest-land.geojson",
  buffer: "data/epping-buffer-land.geojson",
  environment: "data/local-environment.geojson",
  roads: "data/local-roads.geojson",
  paths: "data/local-paths.geojson",
};
const ADMIN_SESSION_KEY = "ff-admin-session-password";
const ADMIN_VIEWPORT_KEY = "ff-admin-map-viewport";
const BASE_MAP_OPACITY = 0.42;
const MIN_MAP_ZOOM = 0.85;
const MAX_MAP_ZOOM = 14;
const MAP_ZOOM_STEP = 1.35;

// Colour palette for distinguishing users (cycles)
const USER_COLOURS = [
  "#4fc97e", "#e05f4f", "#5b8de8", "#e8a93c", "#b45be8",
  "#5ecdc8", "#e87f5b", "#a3c95e", "#e85b9a", "#5bb8e8",
  "#d4e85b", "#7e4fe8", "#e8c35b", "#5be888", "#e85b5b",
];

// ---- Coordinate helpers ----

let _fallbackBoundsCache = null;
let _mapFitCache = null;

let adminViewport = {
  zoom: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  dragMoved: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0,
};

function projectLonLat(longitude, latitude) {
  const clamped = Math.min(85, Math.max(-85, latitude));
  const rad = clamped * Math.PI / 180;
  return {
    x: longitude,
    y: -Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 180 / Math.PI,
  };
}

function fallbackWorldBounds() {
  if (_fallbackBoundsCache) return _fallbackBoundsCache;
  const points = [
    projectLonLat(BOUNDS.minLng, BOUNDS.minLat),
    projectLonLat(BOUNDS.maxLng, BOUNDS.maxLat),
  ];
  _fallbackBoundsCache = boundsFromPoints(points);
  return _fallbackBoundsCache;
}

function boundsFromPoints(points) {
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function mapFit(canvasW, canvasH) {
  const bounds = adminMap.bounds || fallbackWorldBounds();
  if (
    _mapFitCache
    && _mapFitCache.canvasW === canvasW
    && _mapFitCache.canvasH === canvasH
    && _mapFitCache.bounds === bounds
    && _mapFitCache.zoom === adminViewport.zoom
    && _mapFitCache.panX === adminViewport.panX
    && _mapFitCache.panY === adminViewport.panY
  ) {
    return _mapFitCache.fit;
  }

  const pad = Math.max(18, Math.min(canvasW, canvasH) * 0.045);
  const rangeX = Math.max(0.000001, bounds.maxX - bounds.minX);
  const rangeY = Math.max(0.000001, bounds.maxY - bounds.minY);
  const baseScale = Math.min((canvasW - pad * 2) / rangeX, (canvasH - pad * 2) / rangeY);
  const contentW = rangeX * baseScale;
  const contentH = rangeY * baseScale;
  const baseTx = (canvasW - contentW) / 2 - bounds.minX * baseScale;
  const baseTy = (canvasH - contentH) / 2 - bounds.minY * baseScale;
  const centerX = canvasW / 2;
  const centerY = canvasH / 2;
  const scale = baseScale * adminViewport.zoom;
  const fit = {
    scale,
    tx: baseTx * adminViewport.zoom + centerX * (1 - adminViewport.zoom) + adminViewport.panX,
    ty: baseTy * adminViewport.zoom + centerY * (1 - adminViewport.zoom) + adminViewport.panY,
  };
  _mapFitCache = {
    canvasW,
    canvasH,
    bounds,
    zoom: adminViewport.zoom,
    panX: adminViewport.panX,
    panY: adminViewport.panY,
    fit,
  };
  return fit;
}

function worldToCanvas(point, canvasW, canvasH) {
  const fit = mapFit(canvasW, canvasH);
  return {
    x: point.x * fit.scale + fit.tx,
    y: point.y * fit.scale + fit.ty,
  };
}

function latLngToCanvas(lat, lng, canvasW, canvasH) {
  return worldToCanvas(projectLonLat(Number(lng), Number(lat)), canvasW, canvasH);
}

function canvasToWorld(x, y, canvasW, canvasH) {
  const fit = mapFit(canvasW, canvasH);
  return {
    x: (x - fit.tx) / fit.scale,
    y: (y - fit.ty) / fit.scale,
  };
}

function invalidateMapFit() {
  _mapFitCache = null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readSavedViewport() {
  try {
    const saved = JSON.parse(localStorage.getItem(ADMIN_VIEWPORT_KEY) || "null");
    if (!saved || typeof saved !== "object") return;

    const zoom = finiteNumber(saved.zoom);
    const panX = finiteNumber(saved.panX);
    const panY = finiteNumber(saved.panY);
    if (zoom == null || panX == null || panY == null) return;

    adminViewport.zoom = clamp(zoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
    adminViewport.panX = panX;
    adminViewport.panY = panY;
    invalidateMapFit();
  } catch {}
}

function saveViewport() {
  try {
    localStorage.setItem(ADMIN_VIEWPORT_KEY, JSON.stringify({
      zoom: adminViewport.zoom,
      panX: adminViewport.panX,
      panY: adminViewport.panY,
    }));
  } catch {}
}

// ---- User colour assignment ----

const _userColourMap = new Map();
let _colourIndex = 0;

function userColour(uid) {
  if (!_userColourMap.has(uid)) {
    _userColourMap.set(uid, USER_COLOURS[_colourIndex % USER_COLOURS.length]);
    _colourIndex++;
  }
  return _userColourMap.get(uid);
}

function shortUid(uid) {
  return typeof uid === "string" ? uid.slice(0, 8) : "unknown";
}

// ---- State ----

let allData = { locations: [], clicks: [] };
let selectedUid = null; // null = show all users
let selectedClickKey = null;
let viewMode = "tracks"; // "tracks" | "heatmap"

let adminMap = {
  loaded: false,
  loading: false,
  error: null,
  layers: [],
  environmentFeatures: [],
  roads: [],
  paths: [],
  bounds: null,
};

// ---- Base map loading ----

async function fetchGeojson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function loadAdminBaseMap() {
  if (adminMap.loaded || adminMap.loading) return;
  adminMap.loading = true;

  const safeLoad = (url) => fetchGeojson(url).catch((error) => {
    console.warn("[admin] map layer failed", url, error);
    return { type: "FeatureCollection", features: [] };
  });

  try {
    const [forest, buffer, environment, roads, paths] = await Promise.all([
      safeLoad(ADMIN_MAP_URLS.forest),
      safeLoad(ADMIN_MAP_URLS.buffer),
      safeLoad(ADMIN_MAP_URLS.environment),
      safeLoad(ADMIN_MAP_URLS.roads),
      safeLoad(ADMIN_MAP_URLS.paths),
    ]);

    const layers = [
      { key: "buffer", data: buffer },
      { key: "forest", data: forest },
    ];

    adminMap = {
      loaded: true,
      loading: false,
      error: null,
      layers,
      environmentFeatures: (environment.features || []).filter((feature) => feature && feature.geometry && feature.properties),
      roads: (roads.features || []).map(toAdminRoadFeature).filter(Boolean),
      paths: (paths.features || []).map(toAdminPathFeature).filter(Boolean),
      bounds: calculateBaseMapBounds(layers),
    };
  } catch (error) {
    adminMap = { ...adminMap, loaded: false, loading: false, error };
    console.warn("[admin] base map failed", error);
  }

  render();
}

function calculateBaseMapBounds(layers) {
  const points = [];
  for (const layer of layers) {
    forEachGeojsonCoordinate(layer.data, ([longitude, latitude]) => {
      const point = projectLonLat(Number(longitude), Number(latitude));
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
    });
  }
  return points.length ? boundsFromPoints(points) : fallbackWorldBounds();
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

function projectLineFeature(feature) {
  const segments = lineSegmentsFromGeometry(feature.geometry)
    .map((segment) => segment
      .map(([longitude, latitude]) => projectLonLat(Number(longitude), Number(latitude)))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
    .filter((segment) => segment.length >= 2);

  if (!segments.length) return null;

  const points = segments.flat();
  return { segments, bbox: boundsFromPoints(points) };
}

function toAdminPathFeature(feature) {
  const projected = projectLineFeature(feature);
  if (!projected) return null;

  const tags = feature.properties || {};
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

  return {
    ...projected,
    pathType,
    name: tags.name || tags.ref || null,
  };
}

function toAdminRoadFeature(feature) {
  const projected = projectLineFeature(feature);
  if (!projected) return null;

  const tags = feature.properties || {};
  const highway = tags.highway || null;
  const service = tags.service || null;
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

  return {
    ...projected,
    roadType,
    name: tags.name || tags.ref || null,
  };
}

// ---- Rendering ----

function render() {
  const canvas = document.getElementById("adminCanvas");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const W = canvas.width;
  const H = canvas.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const w = W / dpr;
  const h = H / dpr;

  drawBaseMap(ctx, w, h);

  if (viewMode === "heatmap") {
    drawHeatmap(ctx, w, h);
  } else {
    drawTracks(ctx, w, h);
  }
  drawCurrentPositions(ctx, w, h);
  drawClickMarkers(ctx, w, h);
}

function drawForestOutline(ctx, w, h) {
  // Rough polygon approximating Epping Forest shape (simplified keypoints)
  const outline = [
    [51.730, 0.012], [51.720, 0.058], [51.700, 0.080], [51.685, 0.098],
    [51.660, 0.105], [51.645, 0.085], [51.625, 0.070], [51.605, 0.040],
    [51.598, -0.005], [51.610, -0.055], [51.635, -0.075], [51.660, -0.060],
    [51.690, -0.025], [51.710, -0.010], [51.730, 0.012],
  ];
  ctx.beginPath();
  outline.forEach(([lat, lng], i) => {
    const { x, y } = latLngToCanvas(lat, lng, w, h);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(47, 111, 78, 0.15)";
  ctx.fill();
  ctx.strokeStyle = "rgba(79, 201, 126, 0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawBaseMap(ctx, w, h) {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, "#edf2e9");
  gradient.addColorStop(1, "#cfdccb");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = BASE_MAP_OPACITY;

  if (!adminMap.loaded) {
    drawForestOutline(ctx, w, h);
    ctx.restore();
    if (adminMap.loading) {
      ctx.fillStyle = "rgba(36, 56, 47, 0.78)";
      ctx.font = "600 12px system-ui";
      ctx.fillText("Loading map context...", 16, 24);
    }
    return;
  }

  for (const layer of adminMap.layers) drawAdminLayer(ctx, w, h, layer);
  drawAdminEnvironment(ctx, w, h);
  drawAdminRoads(ctx, w, h);
  drawAdminPaths(ctx, w, h);
  ctx.restore();
}

function drawAdminLayer(ctx, w, h, layer) {
  const style = layer.key === "buffer"
    ? { fill: "rgba(85, 167, 160, 0.24)", stroke: "rgba(20, 110, 105, 0.52)", width: 1.2 }
    : { fill: "rgba(79, 139, 98, 0.29)", stroke: "rgba(21, 96, 56, 0.66)", width: 1.5 };

  ctx.save();
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width;

  for (const feature of layer.data.features || []) {
    drawAdminPolygon(ctx, w, h, feature.geometry, style);
  }

  ctx.restore();
}

function drawAdminEnvironment(ctx, w, h) {
  if (!adminMap.environmentFeatures.length) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const feature of adminMap.environmentFeatures) {
    const geometry = feature.geometry || {};
    const type = feature.properties && feature.properties.featureType;

    if (type === "hydrology_area") {
      drawAdminPolygon(ctx, w, h, geometry, {
        fill: "rgba(88, 151, 212, 0.22)",
        stroke: "rgba(47, 114, 178, 0.55)",
        width: 1,
      });
    } else if (type === "nature_designation") {
      drawAdminPolygon(ctx, w, h, geometry, {
        fill: "rgba(105, 163, 94, 0.11)",
        stroke: "rgba(72, 130, 65, 0.35)",
        width: 1,
      });
    } else if (type === "garden") {
      drawAdminPolygon(ctx, w, h, geometry, {
        fill: "rgba(120, 175, 90, 0.16)",
        stroke: "rgba(90, 140, 70, 0.36)",
        width: 1,
      });
    } else if (type === "hydrology_line") {
      drawAdminLines(ctx, w, h, geometry, {
        stroke: "rgba(47, 114, 178, 0.62)",
        width: 1.25,
      });
    } else if (type === "railway") {
      drawAdminLines(ctx, w, h, geometry, {
        stroke: "rgba(60, 60, 60, 0.72)",
        casing: "rgba(255, 255, 255, 0.55)",
        width: 1.5,
        casingWidth: 3.2,
      });
    }
  }

  ctx.restore();
}

function drawAdminRoads(ctx, w, h) {
  if (!adminMap.roads.length) return;
  const visible = visibleWorldBounds(w, h);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const road of adminMap.roads) {
    if (!bboxIntersects(road.bbox, visible)) continue;
    const style = roadStyle(road.roadType);
    for (const segment of road.segments) drawProjectedSegment(ctx, w, h, segment, style);
  }

  ctx.restore();
}

function drawAdminPaths(ctx, w, h) {
  if (!adminMap.paths.length) return;
  const visible = visibleWorldBounds(w, h);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const path of adminMap.paths) {
    if (!bboxIntersects(path.bbox, visible)) continue;
    const style = pathStyle(path.pathType);
    for (const segment of path.segments) drawProjectedSegment(ctx, w, h, segment, style);
  }

  ctx.restore();
}

function roadStyle(roadType) {
  switch (roadType) {
    case "motorway":
      return { stroke: "rgba(229, 105, 82, 0.68)", casing: "rgba(0,0,0,0.12)", width: 3.3, casingWidth: 4.8 };
    case "trunk":
      return { stroke: "rgba(245, 161, 80, 0.66)", casing: "rgba(0,0,0,0.10)", width: 3, casingWidth: 4.3 };
    case "primary":
      return { stroke: "rgba(232, 190, 77, 0.66)", casing: "rgba(255,255,255,0.45)", width: 2.4, casingWidth: 3.7 };
    case "secondary":
      return { stroke: "rgba(244, 250, 191, 0.72)", casing: "rgba(110,110,90,0.18)", width: 2, casingWidth: 3 };
    case "tertiary":
      return { stroke: "rgba(255, 255, 255, 0.66)", casing: "rgba(90,90,90,0.16)", width: 1.7, casingWidth: 2.5 };
    case "residential":
      return { stroke: "rgba(255, 255, 255, 0.56)", casing: "rgba(90,90,90,0.14)", width: 1.35, casingWidth: 2.1 };
    case "service":
      return { stroke: "rgba(255, 255, 255, 0.44)", casing: "rgba(90,90,90,0.12)", width: 1, casingWidth: 1.7 };
    case "alley":
      return { stroke: "rgba(255, 255, 255, 0.32)", casing: "rgba(90,90,90,0.10)", width: 0.8, casingWidth: 1.3 };
    default:
      return { stroke: "rgba(255, 255, 255, 0.48)", casing: "rgba(90,90,90,0.12)", width: 1.2, casingWidth: 1.9 };
  }
}

function pathStyle(pathType) {
  const stroke = pathType === "bridleway"
    ? "rgba(113, 77, 35, 0.78)"
    : pathType === "byway"
      ? "rgba(72, 61, 139, 0.80)"
      : pathType === "permissive"
        ? "rgba(57, 90, 138, 0.76)"
        : pathType === "waymarked_trail"
          ? "rgba(109, 68, 140, 0.80)"
          : "rgba(41, 82, 59, 0.74)";
  const dash = pathType === "bridleway"
    ? [7, 4.5]
    : pathType === "byway"
      ? [2, 3]
      : pathType === "permissive"
        ? [4, 3]
        : pathType === "waymarked_trail"
          ? [9, 5]
          : [];
  return { stroke, casing: "rgba(255,255,255,0.70)", width: 1.15, casingWidth: 2.7, dash };
}

function drawAdminPolygon(ctx, w, h, geometry, style) {
  const polygons = polygonRingsFromGeometry(geometry);
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    ctx.beginPath();
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      for (let i = 0; i < ring.length; i += 1) {
        const point = worldToCanvas(projectLonLat(Number(ring[i][0]), Number(ring[i][1])), w, h);
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
    }
    ctx.fillStyle = style.fill;
    ctx.fill("evenodd");
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.width;
    ctx.stroke();
  }
}

function drawAdminLines(ctx, w, h, geometry, style) {
  const segments = lineSegmentsFromGeometry(geometry);
  for (const segment of segments) {
    const projected = segment
      .map(([longitude, latitude]) => projectLonLat(Number(longitude), Number(latitude)))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    drawProjectedSegment(ctx, w, h, projected, style);
  }
}

function drawProjectedSegment(ctx, w, h, segment, style) {
  if (!Array.isArray(segment) || segment.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i < segment.length; i += 1) {
    const point = worldToCanvas(segment[i], w, h);
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }

  if (style.casing) {
    ctx.setLineDash(style.dash || []);
    ctx.strokeStyle = style.casing;
    ctx.lineWidth = style.casingWidth;
    ctx.stroke();
  }

  ctx.setLineDash(style.dash || []);
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width;
  ctx.stroke();
  ctx.setLineDash([]);
}

function visibleWorldBounds(w, h) {
  const fit = mapFit(w, h);
  const topLeft = { x: (0 - fit.tx) / fit.scale, y: (0 - fit.ty) / fit.scale };
  const bottomRight = { x: (w - fit.tx) / fit.scale, y: (h - fit.ty) / fit.scale };
  const marginX = Math.abs(bottomRight.x - topLeft.x) * 0.04;
  const marginY = Math.abs(bottomRight.y - topLeft.y) * 0.04;
  return {
    minX: Math.min(topLeft.x, bottomRight.x) - marginX,
    minY: Math.min(topLeft.y, bottomRight.y) - marginY,
    maxX: Math.max(topLeft.x, bottomRight.x) + marginX,
    maxY: Math.max(topLeft.y, bottomRight.y) + marginY,
  };
}

function bboxIntersects(a, b) {
  return a && b && a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

function canvasCssSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  return { width: rect.width, height: rect.height, rect };
}

function setMapZoom(nextZoom, anchor) {
  const canvas = document.getElementById("adminCanvas");
  if (!canvas) return;
  const { width, height } = canvasCssSize(canvas);
  if (!width || !height) return;

  const targetZoom = clamp(nextZoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
  if (Math.abs(targetZoom - adminViewport.zoom) < 0.001) return;

  const focus = anchor || { x: width / 2, y: height / 2 };
  const before = canvasToWorld(focus.x, focus.y, width, height);

  adminViewport.zoom = targetZoom;
  invalidateMapFit();

  const after = worldToCanvas(before, width, height);
  adminViewport.panX += focus.x - after.x;
  adminViewport.panY += focus.y - after.y;
  invalidateMapFit();
  saveViewport();

  render();
}

function zoomMapBy(factor, anchor) {
  setMapZoom(adminViewport.zoom * factor, anchor);
}

function resetMapView() {
  adminViewport.zoom = 1;
  adminViewport.panX = 0;
  adminViewport.panY = 0;
  adminViewport.dragging = false;
  adminViewport.pointerId = null;
  invalidateMapFit();
  saveViewport();
  render();
}

function eventCanvasPoint(canvas, event) {
  const { rect } = canvasCssSize(canvas);
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function setupMapViewportHandlers(canvas, zoomInBtn, zoomOutBtn, resetMapBtn) {
  if (!canvas) return;

  if (zoomInBtn) zoomInBtn.addEventListener("click", () => zoomMapBy(MAP_ZOOM_STEP));
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => zoomMapBy(1 / MAP_ZOOM_STEP));
  if (resetMapBtn) resetMapBtn.addEventListener("click", resetMapView);

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const point = eventCanvasPoint(canvas, event);
    zoomMapBy(event.deltaY < 0 ? MAP_ZOOM_STEP : 1 / MAP_ZOOM_STEP, point);
  }, { passive: false });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    adminViewport.dragging = true;
    adminViewport.dragMoved = false;
    adminViewport.pointerId = event.pointerId;
    adminViewport.startX = event.clientX;
    adminViewport.startY = event.clientY;
    adminViewport.startPanX = adminViewport.panX;
    adminViewport.startPanY = adminViewport.panY;
    canvas.classList.add("dragging");
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!adminViewport.dragging || event.pointerId !== adminViewport.pointerId) return;
    const deltaX = event.clientX - adminViewport.startX;
    const deltaY = event.clientY - adminViewport.startY;
    if (Math.hypot(deltaX, deltaY) > 4) adminViewport.dragMoved = true;
    adminViewport.panX = adminViewport.startPanX + (event.clientX - adminViewport.startX);
    adminViewport.panY = adminViewport.startPanY + (event.clientY - adminViewport.startY);
    invalidateMapFit();
    render();
  });

  function endDrag(event) {
    if (!adminViewport.dragging || event.pointerId !== adminViewport.pointerId) return;
    adminViewport.dragging = false;
    adminViewport.pointerId = null;
    canvas.classList.remove("dragging");
    if (canvas.releasePointerCapture) canvas.releasePointerCapture(event.pointerId);
    saveViewport();
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", () => {
    if (adminViewport.dragging) saveViewport();
    adminViewport.dragging = false;
    adminViewport.pointerId = null;
    canvas.classList.remove("dragging");
  });

  canvas.addEventListener("click", (event) => {
    if (adminViewport.dragMoved) {
      adminViewport.dragMoved = false;
      return;
    }
    const point = eventCanvasPoint(canvas, event);
    const click = findClickMarkerAt(canvas, point.x, point.y);
    if (!click) return;
    selectedClickKey = clickTargetKey(click);
    renderClickDetails(selectedClickKey);
    render();
  });
}

function filteredLocations() {
  const locs = allData.locations;
  if (!selectedUid) return locs;
  return locs.filter((e) => e.uid === selectedUid);
}

function filteredClicks() {
  const clicks = adminClickEvents();
  if (!selectedUid) return clicks;
  return clicks.filter((e) => e.uid === selectedUid);
}

let _locationsByUidCacheSource = null;
let _locationsByUidCache = null;
let _adminClickEventsCacheSource = null;
let _adminClickEventsCacheLocations = null;
let _adminClickEventsCache = null;

function eventTimeMs(event) {
  const time = Date.parse(event && event.ts);
  return Number.isFinite(time) ? time : null;
}

function locationsByUid() {
  if (_locationsByUidCacheSource === allData.locations && _locationsByUidCache) {
    return _locationsByUidCache;
  }

  const byUser = new Map();
  for (const event of allData.locations) {
    if (!event || event.uid == null || event.lat == null || event.lng == null) continue;
    if (!byUser.has(event.uid)) byUser.set(event.uid, []);
    byUser.get(event.uid).push({ ...event, _timeMs: eventTimeMs(event) });
  }
  for (const events of byUser.values()) {
    events.sort((a, b) => (a._timeMs ?? 0) - (b._timeMs ?? 0));
  }

  _locationsByUidCacheSource = allData.locations;
  _locationsByUidCache = byUser;
  return byUser;
}

function latLngFromKeys(event, latKeys, lngKeys) {
  for (let i = 0; i < latKeys.length; i += 1) {
    const lat = Number(event && event[latKeys[i]]);
    const lng = Number(event && event[lngKeys[i]]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

function nearestLocationForClick(event) {
  const userEvents = locationsByUid().get(event && event.uid);
  if (!userEvents || !userEvents.length) return null;

  const clickTime = eventTimeMs(event);
  if (clickTime == null) {
    const last = userEvents[userEvents.length - 1];
    return { lat: Number(last.lat), lng: Number(last.lng) };
  }

  let best = null;
  let bestDelta = Infinity;
  for (const location of userEvents) {
    if (location._timeMs == null) continue;
    const delta = Math.abs(location._timeMs - clickTime);
    if (delta < bestDelta) {
      best = location;
      bestDelta = delta;
    }
  }

  if (!best || bestDelta > 10 * 60 * 1000) return null;
  return { lat: Number(best.lat), lng: Number(best.lng) };
}

function clickLatLng(event) {
  return latLngFromKeys(event, ["targetLat", "itemLat", "lat"], ["targetLng", "itemLng", "lng"])
    || latLngFromKeys(event, ["userLat"], ["userLng"])
    || nearestLocationForClick(event);
}

function targetKey(target) {
  if (!target || typeof target !== "object") return "";
  return `${target.type || ""}:${target.id || target.name || ""}`;
}

function explicitClickMatchesTarget(clicks, location, target) {
  const key = targetKey(target);
  if (!key) return false;
  const locationTime = eventTimeMs(location);
  return clicks.some((click) => {
    if (!click || click.uid !== location.uid) return false;
    const clickKey = `${click.itemType || ""}:${click.itemId || click.itemName || ""}`;
    if (clickKey !== key) return false;
    const clickTime = eventTimeMs(click);
    return locationTime == null || clickTime == null || Math.abs(clickTime - locationTime) <= 2 * 60 * 1000;
  });
}

function navTargetClickEvents() {
  const clicks = Array.isArray(allData.clicks) ? allData.clicks : [];
  const derived = [];

  for (const [uid, events] of locationsByUid()) {
    let previousTargetKey = "";
    for (const event of events) {
      const target = event && event.navTarget;
      const key = targetKey(target);
      const targetLatLng = latLngFromKeys(target, ["targetLat", "lat"], ["targetLng", "lng"]);
      if (!key || !targetLatLng || key === previousTargetKey) continue;
      previousTargetKey = key;
      if (explicitClickMatchesTarget(clicks, event, target)) continue;

      derived.push({
        type: "click",
        uid,
        ts: event.ts,
        userLat: event.lat,
        userLng: event.lng,
        targetLat: targetLatLng.lat,
        targetLng: targetLatLng.lng,
        itemType: target.type || null,
        itemId: target.id || null,
        itemName: target.name || null,
        source: "navigation",
        derived: true,
      });
    }
  }

  return derived;
}

function adminClickEvents() {
  if (
    _adminClickEventsCacheSource === allData.clicks
    && _adminClickEventsCacheLocations === allData.locations
    && _adminClickEventsCache
  ) {
    return _adminClickEventsCache;
  }

  const explicit = Array.isArray(allData.clicks) ? allData.clicks : [];
  _adminClickEventsCacheSource = allData.clicks;
  _adminClickEventsCacheLocations = allData.locations;
  _adminClickEventsCache = explicit.concat(navTargetClickEvents());
  return _adminClickEventsCache;
}

function clickTargetKey(event) {
  if (!event || typeof event !== "object") return "";
  const type = event.itemType || event.type || "unknown";
  const id = event.itemId || event.itemName || `${event.targetLat || event.lat || ""},${event.targetLng || event.lng || ""}`;
  return `${type}:${id}`;
}

function clickTargetTitle(event) {
  return event?.itemName || event?.itemId || "Unknown target";
}

function clickTargetType(event) {
  const type = event?.itemType || "unknown";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function clickEventsForTarget(key) {
  return adminClickEvents().filter((event) => clickTargetKey(event) === key);
}

function clickTargetSummary(key) {
  const events = clickEventsForTarget(key);
  const sorted = [...events].sort((a, b) => (eventTimeMs(b) ?? 0) - (eventTimeMs(a) ?? 0));
  const first = sorted[0] || events[0] || null;
  return {
    key,
    first,
    events: sorted,
    totalClicks: events.length,
    uniqueUsers: new Set(events.map((event) => event.uid || "unknown")).size,
    explicitClicks: events.filter((event) => !event.derived).length,
    navigationClicks: events.filter((event) => event.derived || event.source === "navigation").length,
  };
}

function findClickMarkerAt(canvas, x, y) {
  const { width, height } = canvasCssSize(canvas);
  if (!width || !height) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const event of filteredClicks()) {
    const latLng = clickLatLng(event);
    if (!latLng) continue;
    const point = latLngToCanvas(latLng.lat, latLng.lng, width, height);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= 12 && distance < bestDistance) {
      best = event;
      bestDistance = distance;
    }
  }
  return best;
}

function drawTracks(ctx, w, h) {
  const locs = filteredLocations();
  if (!locs.length) return;

  // Group by uid and sort by timestamp
  const byUser = new Map();
  for (const e of locs) {
    if (!byUser.has(e.uid)) byUser.set(e.uid, []);
    byUser.get(e.uid).push(e);
  }
  for (const events of byUser.values()) {
    events.sort((a, b) => a.ts < b.ts ? -1 : 1);
  }

  // Draw route lines
  for (const [uid, events] of byUser) {
    const colour = userColour(uid);
    ctx.beginPath();
    ctx.strokeStyle = colour + "88";
    ctx.lineWidth = selectedUid === uid ? 2.5 : 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let moved = false;
    for (const e of events) {
      if (e.lat == null || e.lng == null) continue;
      const { x, y } = latLngToCanvas(e.lat, e.lng, w, h);
      if (!moved) { ctx.moveTo(x, y); moved = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    // Direction arrows along route (every 5th point)
    events.forEach((e, i) => {
      if (i === 0 || i % 5 !== 0 || e.heading == null) return;
      const { x, y } = latLngToCanvas(e.lat, e.lng, w, h);
      const rad = (e.heading - 90) * Math.PI / 180;
      const len = 6;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rad);
      ctx.beginPath();
      ctx.moveTo(len, 0);
      ctx.lineTo(-len * 0.6, -len * 0.4);
      ctx.lineTo(-len * 0.6, len * 0.4);
      ctx.closePath();
      ctx.fillStyle = colour + "bb";
      ctx.fill();
      ctx.restore();
    });
  }
}

function drawHeatmap(ctx, w, h) {
  const locs = allData.locations;
  if (!locs.length) return;

  const cellsX = 60;
  const cellsY = 45;
  const cellW = w / cellsX;
  const cellH = h / cellsY;
  const grid = new Array(cellsX * cellsY).fill(0);

  for (const e of locs) {
    if (e.lat == null || e.lng == null) continue;
    const { x, y } = latLngToCanvas(e.lat, e.lng, w, h);
    const cx = Math.floor(x / cellW);
    const cy = Math.floor(y / cellH);
    if (cx >= 0 && cx < cellsX && cy >= 0 && cy < cellsY) {
      grid[cy * cellsX + cx]++;
    }
  }

  const maxCount = Math.max(...grid, 1);

  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const count = grid[cy * cellsX + cx];
      if (count === 0) continue;
      const t = Math.sqrt(count / maxCount);
      const alpha = 0.15 + t * 0.75;
      // Cold (blue) → warm (yellow) → hot (red)
      const r = Math.round(t < 0.5 ? t * 2 * 200 : 200 + (t - 0.5) * 2 * 55);
      const g = Math.round(t < 0.5 ? 50 + t * 2 * 150 : 200 - (t - 0.5) * 2 * 160);
      const b = Math.round(t < 0.5 ? 200 - t * 2 * 200 : 0);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      ctx.fillRect(cx * cellW, cy * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
}

function drawClickMarkers(ctx, w, h) {
  const clicks = filteredClicks();
  ctx.save();
  for (const e of clicks) {
    const latLng = clickLatLng(e);
    if (!latLng) continue;
    const { x, y } = latLngToCanvas(latLng.lat, latLng.lng, w, h);
    const selected = selectedClickKey && clickTargetKey(e) === selectedClickKey;
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = selected ? 8 : 5;
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? "rgba(255, 255, 255, 0.96)" : "rgba(255, 224, 94, 0.95)";
    ctx.beginPath();
    ctx.arc(x, y, selected ? 10 : 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x, y, selected ? 4.2 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "rgba(255, 244, 146, 1)" : "rgba(255, 210, 50, 0.95)";
    ctx.fill();
  }
  ctx.restore();
}

function drawCurrentPositions(ctx, w, h) {
  // Show last known position for each user (or selected user)
  const byUser = new Map();
  for (const e of allData.locations) {
    if (!selectedUid || e.uid === selectedUid) {
      if (!byUser.has(e.uid) || e.ts > byUser.get(e.uid).ts) {
        byUser.set(e.uid, e);
      }
    }
  }
  for (const [uid, e] of byUser) {
    if (e.lat == null || e.lng == null) continue;
    const { x, y } = latLngToCanvas(e.lat, e.lng, w, h);
    const colour = userColour(uid);
    const isSelected = uid === selectedUid;
    ctx.beginPath();
    ctx.arc(x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// ---- User list sidebar ----

function buildUserList() {
  const list = document.getElementById("adminUserList");
  if (!list) return;

  const byUser = new Map();
  for (const e of allData.locations) {
    if (!byUser.has(e.uid)) byUser.set(e.uid, { count: 0, clicks: 0, last: e.ts });
    const u = byUser.get(e.uid);
    u.count++;
    if (e.ts > u.last) u.last = e.ts;
  }
  for (const e of adminClickEvents()) {
    if (!byUser.has(e.uid)) byUser.set(e.uid, { count: 0, clicks: 0, last: e.ts });
    const u = byUser.get(e.uid);
    u.clicks++;
    if (!u.last || e.ts > u.last) u.last = e.ts;
  }

  // Sort by last seen desc
  const users = [...byUser.entries()].sort((a, b) => b[1].last < a[1].last ? -1 : 1);

  const items = users.map(([uid, info]) => {
    const colour = userColour(uid);
    const lastSeen = new Date(info.last).toLocaleString();
    const div = document.createElement("div");
    div.className = "admin-user-item" + (uid === selectedUid ? " selected" : "");
    div.dataset.uid = uid;
    div.innerHTML = `
      <span class="admin-user-dot" style="background:${colour}"></span>
      <span class="admin-user-label">${shortUid(uid)}</span>
      <span class="admin-user-meta">${info.count} pts · ${info.clicks} taps</span>
    `;
    div.title = `Last seen: ${lastSeen}`;
    div.addEventListener("click", () => {
      selectedUid = selectedUid === uid ? null : uid;
      buildUserList();
      render();
    });
    return div;
  });

  list.innerHTML = "";
  // "All users" row
  const allRow = document.createElement("div");
  allRow.className = "admin-user-item" + (!selectedUid ? " selected" : "");
  allRow.innerHTML = `<span class="admin-user-dot" style="background:#aaa"></span><span class="admin-user-label">All users</span><span class="admin-user-meta">${users.length}</span>`;
  allRow.addEventListener("click", () => { selectedUid = null; buildUserList(); render(); });
  list.appendChild(allRow);
  items.forEach((el) => list.appendChild(el));
}

function updateStats() {
  const el = document.getElementById("adminStats");
  if (!el) return;
  const locs = filteredLocations();
  const clicks = filteredClicks();
  const uids = new Set([...locs, ...clicks].map((e) => e.uid));
  el.innerHTML = `<strong>${uids.size}</strong> user${uids.size !== 1 ? "s" : ""} &nbsp;·&nbsp; <strong>${locs.length}</strong> location pings &nbsp;·&nbsp; <strong>${clicks.length}</strong> taps`;
}

function formatEventTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Unknown time";
  return new Date(time).toLocaleString();
}

function sourceLabel(event) {
  if (event?.derived || event?.source === "navigation") return "Navigation";
  if (event?.source === "overview") return "Nearby list";
  if (event?.source === "map") return "Map tap";
  return "Tap";
}

function hideClickDetails() {
  selectedClickKey = null;
  const panel = document.getElementById("adminClickDetails");
  if (panel) panel.hidden = true;
  render();
}

function refreshClickDetails() {
  if (!selectedClickKey) return;
  renderClickDetails(selectedClickKey);
}

function renderClickDetails(key) {
  const panel = document.getElementById("adminClickDetails");
  const body = document.getElementById("adminClickDetailsBody");
  if (!panel || !body) return;

  const summary = clickTargetSummary(key);
  if (!summary.first || !summary.totalClicks) {
    panel.hidden = true;
    selectedClickKey = null;
    return;
  }

  const title = clickTargetTitle(summary.first);
  const type = clickTargetType(summary.first);
  const id = summary.first.itemId || "Unknown";
  const recent = summary.events.slice(0, 6).map((event) => `
    <li>
      <span>${escapeHtml(shortUid(event.uid))} · ${escapeHtml(sourceLabel(event))}</span>
      <span>${escapeHtml(formatEventTime(event.ts))}</span>
    </li>
  `).join("");

  body.innerHTML = `
    <h2 class="admin-click-title">${escapeHtml(title)}</h2>
    <p class="admin-click-subtitle">${escapeHtml(type)}</p>
    <div class="admin-click-summary">
      <div class="admin-click-summary-item">
        <span class="admin-click-summary-value">${summary.totalClicks}</span>
        <span class="admin-click-summary-label">tap${summary.totalClicks !== 1 ? "s" : ""}</span>
      </div>
      <div class="admin-click-summary-item">
        <span class="admin-click-summary-value">${summary.uniqueUsers}</span>
        <span class="admin-click-summary-label">user${summary.uniqueUsers !== 1 ? "s" : ""}</span>
      </div>
    </div>
    <dl class="admin-click-meta">
      <div class="admin-click-meta-row">
        <dt class="admin-click-meta-label">ID</dt>
        <dd class="admin-click-meta-value">${escapeHtml(id)}</dd>
      </div>
      <div class="admin-click-meta-row">
        <dt class="admin-click-meta-label">Explicit taps</dt>
        <dd class="admin-click-meta-value">${summary.explicitClicks}</dd>
      </div>
      <div class="admin-click-meta-row">
        <dt class="admin-click-meta-label">Navigation selections</dt>
        <dd class="admin-click-meta-value">${summary.navigationClicks}</dd>
      </div>
      <div class="admin-click-meta-row">
        <dt class="admin-click-meta-label">Last clicked</dt>
        <dd class="admin-click-meta-value">${escapeHtml(formatEventTime(summary.events[0].ts))}</dd>
      </div>
    </dl>
    <h3 class="admin-click-recent-title">Recent taps</h3>
    <ul class="admin-click-recent-list">${recent}</ul>
  `;
  panel.hidden = false;
}

// ---- Data loading ----

async function loadData(password) {
  const url = "/api/admin/tracks";
  console.log("[admin] fetching", url);
  const resp = await fetch(url, { headers: { "Authorization": `Bearer ${password}` } });
  console.log("[admin] response status", resp.status);
  if (resp.status === 401) throw new Error("wrong-password");
  if (!resp.ok) throw new Error(`Server error ${resp.status}`);
  const data = await resp.json();
  console.log("[admin] data received", {
    locations: Array.isArray(data.locations) ? data.locations.length : 0,
    clicks: Array.isArray(data.clicks) ? data.clicks.length : 0,
  });
  return data;
}

function readSessionPassword() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function saveSessionPassword(password) {
  try {
    sessionStorage.setItem(ADMIN_SESSION_KEY, password);
  } catch {}
}

function clearSessionPassword() {
  try {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {}
}

// ---- Boot ----

async function adminBoot() {
  const loginScreen = document.getElementById("loginScreen");
  const adminApp = document.getElementById("adminApp");
  const loginBtn = document.getElementById("loginBtn");
  const loginInput = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");
  const heatmapBtn = document.getElementById("heatmapBtn");
  const tracksBtn = document.getElementById("tracksBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const canvas = document.getElementById("adminCanvas");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const resetMapBtn = document.getElementById("resetMapBtn");
  const clickDetailsClose = document.getElementById("adminClickDetailsClose");

  let password = "";
  readSavedViewport();
  loadAdminBaseMap();
  setupMapViewportHandlers(canvas, zoomInBtn, zoomOutBtn, resetMapBtn);

  function showAdminApp() {
    loginScreen.hidden = true;
    adminApp.hidden = false;
    buildUserList();
    updateStats();
    refreshClickDetails();
    requestAnimationFrame(render);
  }

  function showLogin(message = "") {
    adminApp.hidden = true;
    loginScreen.hidden = false;
    loginError.textContent = message;
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign in";
  }

  function forgetSession(message = "") {
    password = "";
    allData = { locations: [], clicks: [] };
    selectedUid = null;
    selectedClickKey = null;
    clearSessionPassword();
    showLogin(message);
  }

  async function doLogin() {
    const pw = loginInput.value.trim();
    if (!pw) {
      loginError.textContent = "Enter the admin password.";
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";
    loginError.textContent = "";
    try {
      allData = await loadData(pw);
      console.log("[admin] login ok, switching screens");
      password = pw;
      saveSessionPassword(pw);
      console.log("[admin] building UI");
      showAdminApp();
      console.log("[admin] rendering canvas");
      console.log("[admin] done");
    } catch (err) {
      console.error("[admin] login failed:", err);
      clearSessionPassword();
      if (err.message === "wrong-password") {
        loginError.textContent = "Incorrect password — check ADMIN_PASSWORD in your .env file.";
      } else {
        loginError.textContent = `Cannot reach server: ${err.message}`;
      }
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign in";
    }
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) loginForm.addEventListener("submit", (e) => { e.preventDefault(); doLogin(); });
  else loginBtn.addEventListener("click", doLogin);

  async function restoreSession() {
    const savedPassword = readSessionPassword();
    if (!savedPassword) return;

    loginBtn.disabled = true;
    loginBtn.textContent = "Restoring…";
    loginError.textContent = "";
    try {
      allData = await loadData(savedPassword);
      password = savedPassword;
      showAdminApp();
    } catch (err) {
      console.warn("[admin] session restore failed:", err);
      clearSessionPassword();
      showLogin(err.message === "wrong-password" ? "Admin session expired. Sign in again." : "");
    }
  }

  restoreSession();

  heatmapBtn.addEventListener("click", () => {
    viewMode = "heatmap";
    heatmapBtn.classList.add("active");
    tracksBtn.classList.remove("active");
    render();
  });

  tracksBtn.addEventListener("click", () => {
    viewMode = "tracks";
    tracksBtn.classList.add("active");
    heatmapBtn.classList.remove("active");
    render();
  });

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      allData = await loadData(password);
      buildUserList();
      updateStats();
      refreshClickDetails();
      render();
    } catch (err) {
      if (err.message === "wrong-password") forgetSession("Admin session expired. Sign in again.");
    }
    refreshBtn.disabled = false;
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      loginInput.value = "";
      forgetSession("");
    });
  }

  if (clickDetailsClose) {
    clickDetailsClose.addEventListener("click", hideClickDetails);
  }

  window.addEventListener("resize", () => { invalidateMapFit(); render(); });

  // Auto-refresh every 5 minutes
  setInterval(async () => {
    if (!password) return;
    try { allData = await loadData(password); buildUserList(); updateStats(); refreshClickDetails(); render(); } catch (err) {
      if (err.message === "wrong-password") forgetSession("Admin session expired. Sign in again.");
    }
  }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", adminBoot);
