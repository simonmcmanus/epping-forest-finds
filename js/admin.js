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
// Earlier versions kept the password under this key. It is only ever removed now, never written.
const LEGACY_SESSION_PASSWORD_KEY = "ff-admin-session-password";
// The dashboard signs in with Auth0 (GET /api/auth/login?admin=1). The server keeps the sign-in in an HttpOnly
// cookie this script cannot read, so nothing about it is stored here. Every admin request carries this header
// instead: with a cookie it is the CSRF guard (another site cannot add it without a preflight, which is refused).
const ADMIN_FETCH_HEADERS = { "X-Requested-With": "admin" };
const adminFetch = (url, options = {}) => fetch(url, { ...options, headers: { ...ADMIN_FETCH_HEADERS, ...(options.headers || {}) } });
const SIGNIN_MESSAGES = {
  denied: "This account isn't on the admin list. Ask an existing admin to add it, or sign in with a different account.",
  failed: "Sign-in didn't finish. Try again.",
  unavailable: "Admin sign-in isn't set up on this site yet. The site owner needs to configure Auth0 and ADMIN_SUBJECTS.",
};
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

let allData = { locations: [], clicks: [], navigation: [] };
let lastMeta = null;
let selectedUid = null; // null = show all users
let selectedClickKey = null;
let viewMode = "tracks"; // "tracks" | "heatmap" (the last map view; the Navigation page is a separate page-level view, not a map mode)
let navigationOpen = false; // true while the Navigation page is shown instead of the map

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
    closeOverlayPanels("details");
    selectedClickKey = clickTargetKey(click);
    renderClickDetails(selectedClickKey);
    render();
    const detailsClose = document.getElementById("adminClickDetailsClose");
    if (!document.getElementById("adminClickDetails")?.hidden) detailsClose?.focus();
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

function buildUserList({ reveal = false } = {}) {
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
    const div = document.createElement("button");
    div.type = "button";
    div.className = "admin-user-item" + (uid === selectedUid ? " selected" : "");
    div.dataset.uid = uid;
    div.setAttribute("aria-pressed", uid === selectedUid ? "true" : "false");
    div.innerHTML = `
      <span class="admin-user-dot" style="background:${colour}"></span>
      <span class="admin-user-label">${escapeHtml(shortUid(uid))}</span>
      <span class="admin-user-meta">${info.count} pts · ${info.clicks} taps</span>
    `;
    div.title = `Last seen: ${lastSeen}`;
    div.addEventListener("click", () => {
      selectedUid = selectedUid === uid ? null : uid;
      buildUserList({ reveal: true });
      render();
    });
    return div;
  });

  // A re-render replaces the buttons, so remember which row had focus and give it back.
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const focusedUid = focused ? (focused.dataset.uid || "") : null;
  // Emptying the list collapses it and would reset the strip to its start, so remember where it was scrolled.
  const scrollLeft = list.scrollLeft;
  const scrollTop = list.scrollTop;
  list.innerHTML = "";
  // "All users" row
  const allRow = document.createElement("button");
  allRow.type = "button";
  allRow.className = "admin-user-item" + (!selectedUid ? " selected" : "");
  allRow.dataset.uid = "";
  allRow.setAttribute("aria-pressed", !selectedUid ? "true" : "false");
  allRow.innerHTML = `<span class="admin-user-dot" style="background:#aaa"></span><span class="admin-user-label">All users</span><span class="admin-user-meta">${users.length} user${users.length === 1 ? "" : "s"}</span>`;
  allRow.addEventListener("click", () => { selectedUid = null; buildUserList({ reveal: true }); render(); });
  list.appendChild(allRow);
  items.forEach((el) => list.appendChild(el));
  list.scrollLeft = scrollLeft;
  list.scrollTop = scrollTop;
  if (focusedUid !== null) {
    const row = [...list.children].find((el) => (el.dataset.uid || "") === focusedUid);
    if (row) row.focus();
  }
  // Choosing a chip scrolls it fully into the strip; an already visible chip does not move.
  if (reveal) {
    const chosen = list.querySelector(".admin-user-item.selected");
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (chosen) chosen.scrollIntoView({ inline: "nearest", block: "nearest", behavior: calm ? "auto" : "smooth" });
  }
  refreshScrollCues();
  refreshNavigationView();
}

// Fade cue: mark the nav row and user strip with cue-start / cue-end while more of them is scrolled out of view at that edge.
function refreshScrollCues() {
  for (const el of document.querySelectorAll(".admin-user-list, .admin-nav")) {
    if (!el.dataset.cueBound) {
      el.dataset.cueBound = "1";
      el.addEventListener("scroll", refreshScrollCues, { passive: true });
      // On phones, keyboard focus brings its control into view clear of the fade (scroll-padding in the CSS); the browser alone left it half cut off at 360px and 320px.
      el.addEventListener("focusin", (event) => {
        if (event.target !== el && window.matchMedia("(max-width: 720px)").matches) event.target.scrollIntoView({ inline: "nearest", block: "nearest" });
      });
    }
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle("cue-start", max > 1 && el.scrollLeft > 1);
    el.classList.toggle("cue-end", max > 1 && el.scrollLeft < max - 1);
  }
}

function updateStats() {
  const el = document.getElementById("adminStats");
  if (!el) return;
  const locs = filteredLocations();
  const clicks = filteredClicks();
  const uids = new Set([...locs, ...clicks].map((e) => e.uid));
  const chip = (html, cls = "") => `<span class="admin-stat-chip${cls ? ` ${cls}` : ""}">${html}<span class="sr-only">, </span></span>`;
  const windowChip = Number.isFinite(lastMeta?.windowDays) ? chip(`last ${lastMeta.windowDays} days`) : "";
  const partialChip = lastMeta?.partial
    ? chip(`<em>partial: too much data for one read, newest shown${lastMeta.oldestDay
      ? ` (back to ${escapeHtml(lastMeta.oldestDay)}${lastMeta.oldestDayIncomplete ? ", that day only in part" : ""})`
      : ""}</em>`, "wrap")
    : "";
  el.innerHTML = `<div class="admin-stats-row">${[chip(`<strong>${uids.size}</strong> user${uids.size !== 1 ? "s" : ""}`), chip(`<strong>${locs.length}</strong> location pings`), chip(`<strong>${clicks.length}</strong> taps`), windowChip, partialChip].join(" ")}</div>${navigationStatsHtml(locs)}`;
  syncSheetInset();
}

// Overlay sheets sit above the stats bar: tell the CSS how tall it is.
function syncSheetInset() {
  const area = document.querySelector(".admin-map-area");
  const stats = document.getElementById("adminStats");
  if (!area || !stats) return;
  const areaBox = area.getBoundingClientRect();
  const statsBox = stats.getBoundingClientRect();
  if (!statsBox.height) { area.style.removeProperty("--stats-clear"); return; }
  area.style.setProperty("--stats-clear", `${Math.ceil(areaBox.bottom - statsBox.top + 8)}px`);
}

// Navigation journey block under the stats bar: derived from the same filtered pings.
function navigationStatsHtml(locs) {
  if (typeof deriveNavJourneys !== "function") return "";
  const navEvents = (allData.navigation || []).filter((e) => !selectedUid || e.uid === selectedUid);
  const s = summariseNavJourneys(combineNavJourneys(buildExplicitJourneys(navEvents), deriveNavJourneys(locs)));
  if (!s.started) return "";
  const km = (m) => (m / 1000).toFixed(1);
  const rate = Math.round(s.completionRate * 100);
  const b = s.timeBuckets;
  const median = s.medianRemainingM === null ? "n/a" : `${Math.round(s.medianRemainingM)} m`;
  const chip = (html) => `<span class="admin-stat-chip">${html}<span class="sr-only">, </span></span>`;
  const row = (...chips) => `<div class="admin-stats-row">${chips.join(" ")}</div>`;
  return row(`<strong class="admin-stats-label">Navigation:</strong>`, chip(`<strong>${s.started}</strong> started`), chip(`<strong>${s.completed}</strong> arrived (${rate}%)`))
    + row(chip(`Time to arrive: &lt;5 min <strong>${b.lt5}</strong>`), chip(`5-15 <strong>${b.b5to15}</strong>`), chip(`15-30 <strong>${b.b15to30}</strong>`), chip(`&gt;30 <strong>${b.gt30}</strong>`))
    + row(chip(`Walked <strong>${km(s.totalDistanceWalkedM)}</strong> km`), chip(`<strong>${s.abandoned}</strong> abandoned (median <strong>${median}</strong> short)`))
    + (s.detourCount ? row(chip(`Detour: walked <strong>${s.medianDetourRatio.toFixed(2)}</strong>x the shortest route (median of ${s.detourCount})`)) : "");
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
  if (panel) {
    if (panel.contains(document.activeElement)) document.getElementById("adminCanvas")?.focus();
    panel.hidden = true;
  }
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
    if (panel.contains(document.activeElement)) document.getElementById("adminCanvas")?.focus();
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

// Overlay panels (Community, Access, tap details): one is open at a time. Closing one hands focus
// back to what opened it when focus was inside, so keyboard users never lose their place.
const OVERLAY_PANELS = {
  community: { id: "adminCommunity", opener: "communityBtn" },
  access: { id: "adminAccess", opener: "accessBtn", onClose: null },
  beta: { id: "adminBeta", opener: "betaBtn", onClose: null },
};

function closeOverlay(key) {
  if (key === "details") {
    if (selectedClickKey || !document.getElementById("adminClickDetails")?.hidden) hideClickDetails();
    return;
  }
  const cfg = OVERLAY_PANELS[key];
  const panel = document.getElementById(cfg.id);
  if (!panel || panel.hidden) return;
  if (panel.contains(document.activeElement)) document.getElementById(cfg.opener)?.focus();
  panel.hidden = true;
  if (cfg.onClose) cfg.onClose();
  syncPanelButtons();
}

// The Community and Access buttons say whether their panel is open (aria-expanded, plus a lit style in the CSS).
function syncPanelButtons() {
  for (const cfg of Object.values(OVERLAY_PANELS)) {
    const panel = document.getElementById(cfg.id);
    document.getElementById(cfg.opener)?.setAttribute("aria-expanded", panel && !panel.hidden ? "true" : "false");
  }
}

function closeOverlayPanels(except) {
  for (const key of ["community", "access", "beta", "details"]) if (key !== except) closeOverlay(key);
}

// ---- Data loading ----

function updateEnvBadge(meta) {
  const badge = document.getElementById("adminEnvBadge");
  if (!badge) return;
  const storeName = meta?.storeName || "";
  const context = meta?.context || "local";
  let label, cssClass;
  if (!storeName || context === "local") {
    label = "local";
    cssClass = "";
  } else if (storeName === "tracking") {
    label = "production";
    cssClass = "env-prod";
  } else {
    label = storeName.replace(/^tracking-/, "preview: ");
    cssClass = "env-preview";
  }
  badge.textContent = label;
  badge.className = "admin-env-badge" + (cssClass ? ` ${cssClass}` : "");
  badge.hidden = false;
}

// The tracking function packs events (netlify/functions/lib/tracking-store.js packEvents): a shared
// uid table and one short row per event. Unpack them into the event objects the dashboard draws; a
// plain array (an older server, or a test fixture) is used as it is.
const PACKED_FIELDS = {
  location: ["lat", "lng", "heading"],
  click: ["userLat", "userLng", "targetLat", "targetLng", "itemType", "itemId", "itemName", "source"],
  navigation: ["navId", "navName", "navType", "targetLat", "targetLng", "userLat", "userLng", "routeM", "walkedM", "remainingM", "reason"],
};

function unpackTrackingEvents(packed) {
  if (Array.isArray(packed)) return packed;
  if (!packed || !Array.isArray(packed.rows)) return [];
  const fields = PACKED_FIELDS[packed.type] || [];
  return packed.rows.map((row) => {
    const event = { type: packed.type, uid: packed.uids[row[0]], ts: new Date(row[1]).toISOString() };
    fields.forEach((field, i) => { event[field] = row[i + 2]; });
    // A navigation row ends with its kind (start, arrive or end); it becomes navigation_<kind>.
    if (packed.type === "navigation") event.type = `navigation_${row[fields.length + 2]}`;
    if (packed.type === "location") {
      const target = row[fields.length + 2];
      event.navTarget = target >= 0 ? packed.targets[target] : null;
    }
    return event;
  });
}

// When a window still has too much for one response the function can fail with a 5xx. Fall back to shorter windows (7 days, then 1) so the dashboard still opens, and
// say which window it ended up with (the stats bar shows it).
const ADMIN_WINDOW_FALLBACKS = [null, 7, 1];

const HTTP_STATUS_NAMES = { 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" };

async function loadData() {
  let resp;
  let url;
  for (const days of ADMIN_WINDOW_FALLBACKS) {
    url = days ? `/api/admin/tracks?days=${days}` : "/api/admin/tracks";
    try {
      resp = await adminFetch(url);
    } catch (cause) {
      const failure = new Error("network");
      failure.network = true;
      throw failure;
    }
    if (resp.status === 401) throw new Error("unauthorised");
    if (resp.ok || resp.status < 500) break;
  }
  if (!resp.ok) {
    // The raw body (possibly a page of HTML) goes to the console only; the screen gets the status and its plain name.
    const detail = await resp.text().catch(() => "");
    const name = resp.statusText || HTTP_STATUS_NAMES[resp.status] || "";
    const failure = new Error(`Server error ${resp.status}${name ? `: ${name}` : ""}`);
    failure.detail = detail.slice(0, 160);
    throw failure;
  }
  const data = await resp.json();
  data.locations = unpackTrackingEvents(data.locations);
  data.clicks = unpackTrackingEvents(data.clicks);
  data.navigation = unpackTrackingEvents(data.navigation);
  updateEnvBadge(data.meta);
  lastMeta = data.meta;
  return data;
}

// Community verification usage (netlify/functions/community-overlay.js ?admin=1).
async function loadCommunityStats() {
  const resp = await adminFetch("/api/community/overlay?admin=1");
  if (!resp.ok) {
    const failure = new Error(`Server error ${resp.status}`);
    failure.status = resp.status;
    throw failure;
  }
  return resp.json();
}

function communityRow(label, value) {
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

// The figures part of the Community panel: replaced after a rebuild without touching the buttons or the result line.
function renderCommunityFigures(stats) {
  const row = communityRow;
  const card = (label, value) => `<li class="admin-stat-card"><span class="admin-stat-value">${escapeHtml(value)}</span><span class="admin-stat-label">${escapeHtml(label)}</span></li>`;
  const statusRows = Object.entries(stats.byStatus || {}).sort((a, b) => b[1] - a[1])
    .map(([status, n]) => row(status, n)).join("");
  const days = Object.entries(stats.perDay || {}).sort().slice(-7)
    .map(([day, n]) => row(day, n)).join("");
  return `${stats.generatedAt ? `<p class="admin-community-asof">As of the last snapshot, ${escapeHtml(formatEventTime(new Date(stats.generatedAt).toISOString()))}</p>` : ""}
    <ul class="admin-stat-grid">
      ${card("People reporting (all time)", stats.devices)}
      ${card("Active, last 24 h / 7 days", `${stats.activeDevices1d} / ${stats.activeDevices7d}`)}
      ${card("Reports", stats.reports)}
      ${card("Trees questioned", stats.questioned)}
      ${card("Trees verified", stats.verified)}
      ${card("New trees (unconfirmed / confirmed)", `${stats.newTreesUnconfirmed} / ${stats.newTreesConfirmed}`)}
      ${card("Conflicts awaiting review", stats.conflicts)}
      ${card("Points awarded", stats.totalPoints)}
    </ul>
    <h4>By report type</h4><table>${statusRows || row("None yet", "")}</table>
    <h4>Last 7 days with reports</h4><table>${days || row("None yet", "")}</table>`;
}

function renderCommunityStats(stats) {
  return `<h3 class="admin-panel-title">Community verification</h3>
    <div class="admin-panel-actions"><button type="button" class="admin-btn" id="communityRebuildBtn">Rebuild snapshot now</button> <button type="button" class="admin-btn" id="communityValidateBtn">Run reward check now</button></div>
    <span id="communityValidateResult" class="admin-panel-status" role="status"></span>
    <p class="admin-panel-links"><a href="/reports/tree-report" target="_blank" rel="noopener">City of London discrepancy report</a> · <a href="/reports/tree-report?format=csv">CSV</a></p>
    <div id="communityFigures">${renderCommunityFigures(stats)}</div>`;
}

// Plain-language result of the reward check; a GitHub error is cut down to a short single-line reason.
function rewardCheckText(data) {
  const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? "" : "s"}`;
  const register = Number(data.newRegisterRewards) || 0;
  const issues = Number(data.issueRewards) || 0;
  const parts = [];
  if (data.baseline) parts.push("first check done — today's register is now the baseline.");
  else if (!data.registerChecked) parts.push("the register was not checked.");
  const given = [register && plural(register, "register reward"), issues && plural(issues, "issue reward")].filter(Boolean);
  if (given.length) parts.push(`${given.join(" and ")} given.`);
  else if (data.baseline || !data.registerChecked) parts.push("No rewards given yet.");
  else if (!data.issueError) parts.push("nothing new to reward.");
  if (data.issueError) {
    const flat = String(data.issueError).replace(/\s+/g, " ").trim();
    const reason = flat.length > 40 ? `${flat.slice(0, 40).trimEnd()}…` : flat;
    parts.push(`${parts.length ? "Issue" : "issue"} rewards could not be checked${reason ? ` (${reason})` : ""}.`);
  }
  return parts.join(" ");
}

// A password copy left in browser storage by an earlier version is removed on load.
function clearLegacyStoredPassword() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      store.removeItem(LEGACY_SESSION_PASSWORD_KEY);
    } catch {}
  }
}

// ---- Navigation view (daily trend charts) ----

// Journeys for the Navigation view: the same user filter and loaded (time-windowed) data as the stats block.
function navigationJourneysForView() {
  if (typeof deriveNavJourneys !== "function") return [];
  const navEvents = (allData.navigation || []).filter((e) => !selectedUid || e.uid === selectedUid);
  return combineNavJourneys(buildExplicitJourneys(navEvents), deriveNavJourneys(filteredLocations()));
}

const NAV_SVG_W = 420;
const NAV_SVG_WIDE_W = 840;
const NAV_SVG_H = 200;
const NAV_PLOT = { l: 34, r: 34, t: 10, b: 24 };

function navChartFrame(rows, width = NAV_SVG_W) {
  const p = NAV_PLOT;
  const pw = width - p.l - p.r;
  const ph = NAV_SVG_H - p.t - p.b;
  const band = pw / rows.length;
  const step = Math.ceil(rows.length / (width > NAV_SVG_W ? 14 : 6));
  const xLabels = rows.map((r, i) => (i % step === 0
    ? `<text x="${(p.l + band * (i + 0.5)).toFixed(1)}" y="${NAV_SVG_H - 8}" text-anchor="middle">${escapeHtml(r.day.slice(5))}</text>` : "")).join("");
  const grid = (ys) => ys.map((y) => `<line class="nav-grid-line" x1="${p.l}" y1="${y.toFixed(1)}" x2="${width - p.r}" y2="${y.toFixed(1)}"/>`).join("");
  return { p, pw, ph, band, xLabels, width, grid, cx: (i) => p.l + band * (i + 0.5) };
}

function navLinePath(points) {
  // points: [x, y] or null for a gap; returns one path per run plus dots.
  let d = "";
  let pen = false;
  for (const pt of points) {
    if (!pt) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

function navTitle(text) {
  return `<title>${escapeHtml(text)}</title>`;
}

function navTrendChartSvg(rows) {
  const { p, ph, band, xLabels, cx, width, grid } = navChartFrame(rows, NAV_SVG_WIDE_W);
  const max = Math.max(1, ...rows.map((r) => r.started));
  const yCount = (v) => p.t + ph - (v / max) * ph;
  const yRate = (v) => p.t + ph - v * ph;
  const bw = Math.min(18, band * 0.35);
  const rateText = (r) => (r.completionRate === null ? "" : `, ${Math.round(r.completionRate * 100)}%`);
  const dayText = (r) => `${r.day}: ${r.started} started, ${r.completed} completed${rateText(r)}`;
  const bars = rows.map((r, i) => `<rect class="nav-bar-started" x="${(cx(i) - bw).toFixed(1)}" y="${yCount(r.started).toFixed(1)}" width="${bw.toFixed(1)}" height="${(p.t + ph - yCount(r.started)).toFixed(1)}">${navTitle(dayText(r))}</rect>`
    + `<rect class="nav-bar-completed" x="${cx(i).toFixed(1)}" y="${yCount(r.completed).toFixed(1)}" width="${bw.toFixed(1)}" height="${(p.t + ph - yCount(r.completed)).toFixed(1)}">${navTitle(dayText(r))}</rect>`).join("");
  const pts = rows.map((r, i) => (r.completionRate === null ? null : [cx(i), yRate(r.completionRate)]));
  const dots = rows.map((r, i) => (pts[i] ? `<circle class="nav-dot" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="3.5">${navTitle(dayText(r))}</circle>` : "")).join("");
  const rightTicks = [0, 0.5, 1].map((v) => `<text x="${width - p.r + 4}" y="${(yRate(v) + 4).toFixed(1)}">${v * 100}%</text>`).join("");
  const totalStarted = rows.reduce((a, r) => a + r.started, 0);
  const totalCompleted = rows.reduce((a, r) => a + r.completed, 0);
  const label = `Journeys started and completed per day, with completion rate, over ${rows.length} day${rows.length === 1 ? "" : "s"} from ${rows[0].day} to ${rows[rows.length - 1].day}: ${totalStarted} started, ${totalCompleted} completed.`;
  return `<svg class="nav-chart" viewBox="0 0 ${width} ${NAV_SVG_H}" role="img" aria-label="${escapeHtml(label)}">`
    + grid([p.t, yRate(0.5)])
    + `<line class="nav-axis" x1="${p.l}" y1="${p.t + ph}" x2="${width - p.r}" y2="${p.t + ph}"/>`
    + `<text x="${p.l - 4}" y="${p.t + 4}" text-anchor="end">${max}</text><text x="${p.l - 4}" y="${p.t + ph + 4}" text-anchor="end">0</text>`
    + `${rightTicks}${bars}<path class="nav-line" d="${navLinePath(pts)}"/>${dots}${xLabels}</svg>`;
}

function navBucketChartSvg(rows) {
  const { p, ph, band, xLabels, cx, width, grid } = navChartFrame(rows);
  const keys = ["lt5", "b5to15", "b15to30", "gt30"];
  const names = { lt5: "under 5 min", b5to15: "5-15 min", b15to30: "15-30 min", gt30: "over 30 min" };
  const total = (r) => keys.reduce((a, k) => a + r.timeBuckets[k], 0);
  const max = Math.max(1, ...rows.map(total));
  const bw = Math.min(28, band * 0.6);
  const bars = rows.map((r, i) => {
    let y = p.t + ph;
    return keys.map((k) => {
      const h = (r.timeBuckets[k] / max) * ph;
      y -= h;
      return h > 0 ? `<rect class="nav-bar-${k}" x="${(cx(i) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}">${navTitle(`${r.day}: ${r.timeBuckets[k]} ${names[k]} (${total(r)} completed)`)}</rect>` : "";
    }).join("");
  }).join("");
  const sum = (k) => rows.reduce((a, r) => a + r.timeBuckets[k], 0);
  const label = `Completed journeys per day by time to arrive, from ${rows[0].day} to ${rows[rows.length - 1].day}: under 5 minutes ${sum("lt5")}, 5 to 15 minutes ${sum("b5to15")}, 15 to 30 minutes ${sum("b15to30")}, over 30 minutes ${sum("gt30")}.`;
  return `<svg class="nav-chart" viewBox="0 0 ${width} ${NAV_SVG_H}" role="img" aria-label="${escapeHtml(label)}">`
    + grid([p.t, p.t + ph / 2])
    + `<line class="nav-axis" x1="${p.l}" y1="${p.t + ph}" x2="${width - p.r}" y2="${p.t + ph}"/>`
    + `<text x="${p.l - 4}" y="${p.t + 4}" text-anchor="end">${max}</text><text x="${p.l - 4}" y="${p.t + ph + 4}" text-anchor="end">0</text>`
    + `${bars}${xLabels}</svg>`;
}

function navDetourChartSvg(rows) {
  const { p, ph, xLabels, cx, width, grid } = navChartFrame(rows);
  const vals = rows.map((r) => r.medianDetourRatio).filter((v) => v !== null);
  const lo = Math.floor((Math.min(1, ...vals) - 0.1) * 10) / 10;
  const hi = Math.ceil((Math.max(1, ...vals) + 0.1) * 10) / 10;
  const y = (v) => p.t + ph - ((v - lo) / (hi - lo)) * ph;
  const pts = rows.map((r, i) => (r.medianDetourRatio === null ? null : [cx(i), y(r.medianDetourRatio)]));
  const dots = rows.map((r, i) => (pts[i] ? `<circle class="nav-dot nav-dot-detour" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="3.5">${navTitle(`${r.day}: median detour ${r.medianDetourRatio.toFixed(2)}x`)}</circle>` : "")).join("");
  const label = vals.length
    ? `Median detour ratio per day, from ${rows[0].day} to ${rows[rows.length - 1].day}: lowest ${Math.min(...vals).toFixed(2)}, highest ${Math.max(...vals).toFixed(2)}, where 1.0 is the shortest route.`
    : "Median detour ratio per day: no completed journeys with a detour ratio in this window.";
  return `<svg class="nav-chart" viewBox="0 0 ${width} ${NAV_SVG_H}" role="img" aria-label="${escapeHtml(label)}">`
    + grid([y(hi), (y(hi) + y(lo)) / 2])
    + `<line class="nav-axis" x1="${p.l}" y1="${p.t + ph}" x2="${width - p.r}" y2="${p.t + ph}"/>`
    + `<text x="${p.l - 4}" y="${(y(hi) + 4).toFixed(1)}" text-anchor="end">${hi.toFixed(1)}</text><text x="${p.l - 4}" y="${(y(lo) + 4).toFixed(1)}" text-anchor="end">${lo.toFixed(1)}</text>`
    + `<line class="nav-ref" x1="${p.l}" y1="${y(1).toFixed(1)}" x2="${width - p.r}" y2="${y(1).toFixed(1)}"/>`
    + `<text x="${width - p.r}" y="${(y(1) - 4).toFixed(1)}" text-anchor="end">1.0 shortest route</text>`
    + `<path class="nav-line nav-line-detour" d="${navLinePath(pts)}"/>${dots}${xLabels}</svg>`;
}

function navTable(caption, label, headers, bodyRows) {
  return `<div class="nav-table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(label)}"><table class="nav-trend-table"><caption class="sr-only">${escapeHtml(caption)}</caption>`
    + `<thead><tr>${headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead>`
    + `<tbody>${bodyRows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// "Top destinations this week": journeys started in the last 7 days, grouped by destination.
function navigationDestinationsHtml(journeys) {
  const head = `<h3>Top destinations, last 7 days</h3><p class="nav-note">Counted back from now, within the loaded data and selected user.</p>`;
  const rows = typeof topDestinationsThisWeek === "function" ? topDestinationsThisWeek(journeys, { now: Date.now() }) : [];
  if (!rows.length) return `<section class="nav-panel nav-panel-wide nav-destinations">${head}<p class="nav-empty">No navigation journeys in the last 7 days.</p></section>`;
  const min = (v) => (v === null ? "n/a" : `${v.toFixed(v % 1 ? 1 : 0)} min`);
  const body = rows.map((r) => `<tr><th scope="row"><span class="nav-dest-name">${escapeHtml(r.name)}</span>`
    + `<span class="nav-dest-bar" aria-hidden="true"><span style="width:${Math.max(2, Math.round(r.share * 100))}%"></span></span></th>`
    + `<td>${r.started}</td><td>${r.completed}</td><td>${r.completionRate === null ? "n/a" : `${Math.round(r.completionRate * 100)}%`}</td><td>${min(r.medianMinutesToArrive)}</td></tr>`).join("");
  return `<section class="nav-panel nav-panel-wide nav-destinations">${head}<div class="nav-table-wrap" tabindex="0" role="region" aria-label="Top destinations, scrollable"><table class="nav-trend-table nav-dest-table">`
    + `<caption class="sr-only">Top destinations by journeys started in the last 7 days</caption>`
    + `<thead><tr><th scope="col">Destination</th><th scope="col">Started</th><th scope="col">Completed</th><th scope="col">Completion rate</th><th scope="col">Median time</th></tr></thead>`
    + `<tbody>${body}</tbody></table></div></section>`;
}

function navigationViewHtml() {
  const journeys = navigationJourneysForView();
  if (!journeys.length) return `<p class="nav-empty nav-empty-state">No navigation journeys in this window${selectedUid ? " for the selected user" : ""}.</p>`;
  const s = summariseNavJourneys(journeys);
  const rows = groupJourneysByDay(journeys);
  const pct = (v) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
  const card = (label, value, title, full) => `<li class="nav-card"${title ? ` title="${escapeHtml(title)}"` : ""}><span class="nav-card-value">${escapeHtml(value)}</span><span class="nav-card-label">${escapeHtml(label)}</span>${full ? `<span class="sr-only">${escapeHtml(full)}</span>` : ""}</li>`;
  const cards = [
    card("Started", String(s.started)),
    card("Completed", String(s.completed)),
    card("Completion rate", pct(s.completionRate)),
    card("Median arrival", s.medianArriveMinutes === null ? "n/a" : `${s.medianArriveMinutes.toFixed(s.medianArriveMinutes % 1 ? 1 : 0)} min`, "Median time to arrive", "median time to arrive"),
    card("Distance walked", `${(s.totalDistanceWalkedM / 1000).toFixed(2)} km`),
    card("Median detour", s.medianDetourRatio === null ? "n/a" : `${s.medianDetourRatio.toFixed(2)}x`, "Median detour ratio: distance walked divided by the shortest route"),
    card("Detour sample", String(s.detourCount), "Number of journeys with a detour ratio", "number of journeys with a detour ratio"),
  ].join("");
  const swatch = (cls, text, line) => `<li><span class="nav-swatch${line ? " nav-swatch-line" : ""} nav-bar-${cls}"></span>${text}</li>`;
  const md = s.medianDetourRatio;
  const detourNote = md === null ? "No completed walks with a route yet."
    : `${md.toFixed(2)}x means the walk was ${Math.round(Math.abs(md - 1) * 100)}% ${md < 1 ? "shorter" : "longer"} than the shortest route.`;
  const ratio = (v) => (v === null ? "n/a" : `${v.toFixed(2)}x`);
  const panel = (cls, title, legend, svg, table, note) => `<section class="nav-panel ${cls}"><h3>${title}</h3>${note ? `<p class="nav-note">${escapeHtml(note)}</p>` : ""}<ul class="nav-legend">${legend}</ul>${svg}${table}</section>`;
  return `<ul class="nav-cards">${cards}</ul><p class="nav-note">Started and completed count journeys, not people. Distance includes abandoned walks.</p><div class="nav-grid">`
    + navigationDestinationsHtml(journeys)
    + panel("nav-panel-wide", "Started, completed and completion rate by day",
      `${swatch("started", "Started")}${swatch("completed", "Completed")}<li><span class="nav-swatch nav-swatch-line" style="background:var(--nav-rate)"></span>Completion rate (right axis, 0-100%)</li>`,
      navTrendChartSvg(rows),
      navTable("Journeys by day", "Daily figures, scrollable", ["Day", "Started", "Completed", "Completion rate"], rows.map((r) => [r.day, String(r.started), String(r.completed), pct(r.completionRate)])))
    + panel("", "Time to arrive by day",
      `${swatch("lt5", "Under 5 min")}${swatch("b5to15", "5-15 min")}${swatch("b15to30", "15-30 min")}${swatch("gt30", "Over 30 min")}`,
      navBucketChartSvg(rows),
      navTable("Completed journeys by time to arrive per day", "Daily time to arrive figures, scrollable", ["Day", "Under 5 min", "5-15 min", "15-30 min", "Over 30 min"], rows.map((r) => [r.day, ...["lt5", "b5to15", "b15to30", "gt30"].map((k) => String(r.timeBuckets[k]))])), "Completed journeys only.")
    + panel("", "Median detour by day",
      `<li><span class="nav-swatch nav-swatch-line" style="background:var(--nav-completed)"></span>Median detour ratio</li>`,
      navDetourChartSvg(rows),
      navTable("Median detour ratio per day", "Daily detour figures, scrollable", ["Day", "Median detour", "Journeys with a ratio"], rows.map((r) => [r.day, ratio(r.medianDetourRatio), String(r.detourCount)])), detourNote)
    + `</div>`;
}

function refreshNavigationView() {
  const el = document.getElementById("adminNavigation");
  const body = document.getElementById("adminNavigationBody");
  if (!el || !body || el.hidden) return;
  body.innerHTML = navigationViewHtml();
  const sub = document.getElementById("adminNavigationSub");
  const windowText = Number.isFinite(lastMeta?.windowDays) ? `the last ${lastMeta.windowDays} days` : "all loaded history";
  if (sub) sub.textContent = `Navigation journeys over ${windowText}, for ${selectedUid ? `user ${shortUid(selectedUid)}` : "all users"}.${selectedUid ? "" : " Choose a user in the Users list to filter these figures."}`;
}

// ---- Boot ----

async function adminBoot() {
  const loginScreen = document.getElementById("loginScreen");
  const adminApp = document.getElementById("adminApp");
  const loginBtn = document.getElementById("loginBtn");
  const loginError = document.getElementById("loginError");
  const loginRetry = document.getElementById("loginRetry");
  const heatmapBtn = document.getElementById("heatmapBtn");
  const tracksBtn = document.getElementById("tracksBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const canvas = document.getElementById("adminCanvas");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const resetMapBtn = document.getElementById("resetMapBtn");
  const clickDetailsClose = document.getElementById("adminClickDetailsClose");
  const communityBtn = document.getElementById("communityBtn");
  const communityPanel = document.getElementById("adminCommunity");
  const communityBody = document.getElementById("adminCommunityBody");
  const communityStatus = document.getElementById("adminCommunityStatus");

  let signedIn = false;
  clearLegacyStoredPassword();
  readSavedViewport();
  loadAdminBaseMap();
  setupMapViewportHandlers(canvas, zoomInBtn, zoomOutBtn, resetMapBtn);

  const refreshStatus = document.getElementById("adminRefreshStatus");
  const communityRetry = document.getElementById("adminCommunityRetry");
  const accessPanel = document.getElementById("adminAccess");
  const accessList = document.getElementById("adminAccessList");
  const accessStatus = document.getElementById("adminAccessStatus");
  const accessSave = document.getElementById("adminAccessSave");
  const accessRetry = document.getElementById("adminAccessRetry");
  const communityClose = document.getElementById("adminCommunityClose");
  const accessClose = document.getElementById("adminAccessClose");

  let sessionId = 0; // bumped on sign-out so a late response cannot bring old data back
  let lastLoadedAt = null;

  function clockText(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // The refresh note changes the map's height, so lay the map out again.
  function relayout() {
    invalidateMapFit();
    syncSheetInset();
    render();
  }

  function setRefreshNote(text, announceAgain = false) {
    if (refreshStatus.textContent === text) {
      // Same words again: write the live region afresh (no layout change) so it is announced once more.
      if (announceAgain && text) refreshStatus.replaceChildren(document.createTextNode(text));
      return;
    }
    refreshStatus.textContent = text;
    relayout();
  }

  let refreshHadFocus = false;
  function setRefreshing(busy) {
    // A disabled button drops focus to the body: give it back when the refresh is over.
    if (busy && !refreshBtn.disabled) refreshHadFocus = document.activeElement === refreshBtn;
    refreshBtn.disabled = busy;
    if (!busy && refreshHadFocus && (!document.activeElement || document.activeElement === document.body)) refreshBtn.focus();
    if (!busy) refreshHadFocus = false;
    refreshBtn.textContent = busy ? "Refreshing…" : "Refresh";
    if (busy) refreshBtn.setAttribute("aria-busy", "true");
    else refreshBtn.removeAttribute("aria-busy");
  }

  function showAdminApp() {
    loginScreen.hidden = true;
    adminApp.hidden = false;
    lastLoadedAt = new Date();
    setRefreshNote("");
    buildUserList();
    updateStats();
    refreshClickDetails();
    refreshScrollCues();
    applyView(hashView(), { focusHeading: hashView() === "navigation" });
    requestAnimationFrame(render);
  }

  function showLogin(message = "") {
    adminApp.hidden = true;
    loginScreen.hidden = false;
    loginError.textContent = message;
    loginRetry.hidden = true;
  }

  function forgetSession(message = "") {
    sessionId++;
    signedIn = false;
    setRefreshing(false); // an answer still on its way is ignored, so it can no longer re-enable the button
    communityAction = null;
    communityResultStash = "";
    allData = { locations: [], clicks: [], navigation: [] };
    selectedUid = null;
    selectedClickKey = null;
    // Nothing from this session may reappear at the next sign-in: close every panel and empty what they held.
    closeOverlayPanels();
    resetView();
    resetAccessPanel();
    resetBetaPanel();
    communityToken++;
    communityBody.textContent = "";
    communityStatus.textContent = "";
    communityRetry.hidden = true;
    document.getElementById("adminClickDetailsBody").textContent = "";
    setRefreshNote("");
    showLogin(message);
    loginBtn.focus();
  }

  // On load, ask the server who is signed in (the HttpOnly cookie rides along). 200 shows the dashboard, 401 the
  // sign-in card. Coming back from Auth0 with ?signin=denied|failed shows why, then the address is cleaned.
  const signinResult = new URLSearchParams(location.search).get("signin");
  const signinMessage = Object.prototype.hasOwnProperty.call(SIGNIN_MESSAGES, signinResult) ? SIGNIN_MESSAGES[signinResult] : "";
  if (signinResult !== null) history.replaceState(null, "", `/admin${location.hash}`);
  async function restoreSession() {
    try {
      const me = await adminFetch("/api/admin/me");
      if (me.status === 401) { showLogin(signinMessage); return; }
      if (!me.ok) throw Object.assign(new Error(`Server error ${me.status}`), { status: me.status });
      const data = await loadData();
      allData = data;
      signedIn = true;
      showAdminApp();
    } catch (err) {
      console.error("[admin] could not restore the sign-in:", err, err.detail || "");
      if (err.message === "unauthorised") showLogin(signinMessage || "Admin session expired. Sign in again.");
      else {
        showLogin(err.network || err instanceof TypeError ? "Cannot reach the server. Check your connection and try again." : "Couldn't check your sign-in. Try again.");
        loginRetry.hidden = false;
      }
    }
  }
  loginRetry.addEventListener("click", () => { loginRetry.hidden = true; loginError.textContent = ""; restoreSession(); });
  restoreSession();

  const navigationBtn = document.getElementById("navigationBtn");
  const navigationPanel = document.getElementById("adminNavigation");
  const mapArea = document.querySelector(".admin-map-area");
  const VIEW_HASHES = ["tracks", "heatmap", "navigation"];
  const hashView = () => {
    const name = location.hash.replace(/^#/, "");
    return VIEW_HASHES.includes(name) ? name : "tracks";
  };
  const currentView = () => (navigationOpen ? "navigation" : viewMode);

  // Show one view: the Navigation page (map UI and every overlay panel hidden or closed) or a map view.
  function applyView(name, { focusHeading = false } = {}) {
    if (name === "navigation") {
      closeOverlayPanels();
      navigationOpen = true;
      mapArea.hidden = true;
      navigationPanel.hidden = false;
      setActiveView("navigation");
      refreshNavigationView();
      if (focusHeading) document.getElementById("adminNavigationTitle").focus({ preventScroll: true });
      return;
    }
    const wasNavigation = navigationOpen;
    // Leaving the page hides the focused heading: decide before hiding (browsers fix focus up at different times), then hand it to the matching view button.
    const lostFocus = wasNavigation && navigationPanel.contains(document.activeElement);
    navigationOpen = false;
    viewMode = name;
    navigationPanel.hidden = true;
    mapArea.hidden = false;
    setActiveView(name);
    if (lostFocus) (name === "heatmap" ? heatmapBtn : tracksBtn).focus();
    if (wasNavigation) { invalidateMapFit(); syncSheetInset(); }
    render();
  }
  // Clicks go through the hash so the browser's Back and Forward restore the view.
  function goToView(name, opts) {
    applyView(name, opts);
    if (location.hash !== `#${name}` && !(name === "tracks" && !location.hash)) location.hash = name;
  }
  function resetView() {
    applyView("tracks");
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  function showMapView(mode) { goToView(mode); }
  function setActiveView(name) {
    for (const [key, btn] of [["tracks", tracksBtn], ["heatmap", heatmapBtn], ["navigation", navigationBtn]]) {
      btn.classList.toggle("active", key === name);
      btn.setAttribute("aria-pressed", key === name ? "true" : "false");
    }
  }
  heatmapBtn.addEventListener("click", () => showMapView("heatmap"));
  navigationBtn.addEventListener("click", () => goToView("navigation", { focusHeading: true }));
  window.addEventListener("hashchange", () => {
    if (adminApp.hidden) return;
    const name = hashView();
    if (name !== currentView()) applyView(name, { focusHeading: name === "navigation" });
  });
  // Panels live on the map, so opening one from the Navigation page returns to the last map view first.
  function leaveNavigationForMap() { if (navigationOpen) goToView(viewMode); }

  // ---- Community panel ----
  let communityToken = 0;
  // One rebuild / reward check at a time, even if the panel is closed and reopened meanwhile: the fresh buttons come up
  // disabled with the progress text. A result that finds no result line is kept for the next render.
  let communityAction = null;
  let communityResultStash = "";

  function setCommunityBusy(busy, text) {
    const rebuildBtn = document.getElementById("communityRebuildBtn");
    const validateBtn = document.getElementById("communityValidateBtn");
    const result = document.getElementById("communityValidateResult");
    if (!rebuildBtn || !validateBtn || !result) return false;
    rebuildBtn.disabled = busy;
    validateBtn.disabled = busy;
    result.textContent = text;
    return true;
  }

  async function loadCommunity() {
    const token = ++communityToken;
    communityRetry.hidden = true;
    communityBody.textContent = "";
    communityStatus.textContent = "Loading…";
    const sid = sessionId;
    try {
      const html = renderCommunityStats(await loadCommunityStats());
      if (token !== communityToken || sid !== sessionId) return;
      communityStatus.textContent = "";
      communityBody.innerHTML = html;
      document.getElementById("communityRebuildBtn").addEventListener("click", () => runCommunityAction({
        buttonId: "communityRebuildBtn",
        name: "Rebuild",
        progress: "Rebuilding…",
        url: "/api/community/rebuild",
        failure: "Could not rebuild the snapshot",
        success: (data) => `Rebuilt from ${data.reports} reports (${data.targets} trees on the overlay).`,
        refreshFigures: true,
      }));
      document.getElementById("communityValidateBtn").addEventListener("click", () => runCommunityAction({
        buttonId: "communityValidateBtn",
        name: "Reward check",
        progress: "Checking rewards…",
        url: "/api/community/validate",
        failure: "Could not run the reward check",
        success: rewardCheckText,
      }));
      if (communityAction) setCommunityBusy(true, communityAction.progress);
      else if (communityResultStash) {
        document.getElementById("communityValidateResult").textContent = communityResultStash;
        communityResultStash = "";
      }
    } catch (error) {
      if (token !== communityToken || sid !== sessionId) return;
      if (error.status === 401) {
        forgetSession("Admin session expired. Sign in again.");
        return;
      }
      communityBody.textContent = "";
      communityStatus.textContent = error.status ? `Could not load community stats (${error.status}).` : "Could not load community stats. Check your connection.";
      communityRetry.hidden = false;
    }
  }

  // Rebuild and the reward check: say what is running, keep both buttons off meanwhile, prefix the result with the action,
  // and after a rebuild refresh the figures in place (the buttons and the result line are not replaced, so focus stays put).
  // The result line is written once, when everything is done, so a screen reader reads it once.
  async function runCommunityAction({ buttonId, name, progress, url, failure, success, refreshFigures }) {
    if (communityAction) return;
    const sid = sessionId;
    const action = { progress };
    communityAction = action;
    setCommunityBusy(true, progress);
    let ok = false;
    let text;
    try {
      const resp = await adminFetch(url);
      if (sid !== sessionId) return;
      if (resp.status === 401) {
        forgetSession("Admin session expired. Sign in again.");
        return;
      }
      if (resp.ok) {
        text = `${name}: ${success(await resp.json())}`;
        ok = true;
      } else {
        text = `${name}: ${failure} (${resp.status}). Try again.`;
      }
    } catch (error) {
      if (sid !== sessionId) return;
      text = `${name}: ${failure}. Check your connection and try again.`;
    }
    if (ok && refreshFigures) {
      try {
        const stats = await loadCommunityStats();
        if (sid !== sessionId) return;
        const figures = document.getElementById("communityFigures");
        if (figures) figures.innerHTML = renderCommunityFigures(stats);
      } catch (error) {
        if (sid !== sessionId) return;
        if (error.status === 401) {
          forgetSession("Admin session expired. Sign in again.");
          return;
        }
        text += " The figures below could not be refreshed.";
      }
    }
    if (communityAction === action) communityAction = null;
    if (!setCommunityBusy(false, text)) communityResultStash = text;
    const button = document.getElementById(buttonId);
    const active = document.activeElement;
    if (button && (!active || active === document.body || active === button)) button.focus();
  }

  communityBtn.addEventListener("click", () => {
    leaveNavigationForMap();
    closeOverlayPanels("community");
    communityPanel.hidden = false;
    syncPanelButtons();
    communityClose.focus();
    loadCommunity();
  });
  communityRetry.addEventListener("click", () => {
    communityClose.focus();
    loadCommunity();
  });
  communityClose.addEventListener("click", () => closeOverlay("community"));

  // ---- Early-access list: who sees the gated Community features. Stored server-side, so no deploy to change it. ----
  // The list is only editable once it has loaded: saving after a failed load would send an empty list and switch the gate off for everyone.
  // Escape on unsaved text is a two-step: the first press only warns. The warning stays armed (no timeout) until the admin types or the panel is hidden.
  let accessLoaded = false;
  let accessBaseline = "";
  let accessEscArmed = false;
  let accessNotice = false; // the status line shows an "unsaved changes" note, which typing clears
  let accessSaving = false;
  let accessToken = 0;
  const accessText = (entries) => entries.map((e) => `${e.id}${e.note ? ` ${e.note}` : ""}`).join("\n");
  const accessDirty = () => accessLoaded && accessList.value !== accessBaseline;
  OVERLAY_PANELS.access.onClose = () => { accessEscArmed = false; };

  function sayAccess(text, notice = false) {
    accessStatus.textContent = text;
    accessNotice = notice;
  }

  function setAccessEditable(editable) {
    accessList.disabled = !editable;
    accessSave.disabled = !editable;
  }

  function resetAccessPanel() {
    accessToken++;
    accessLoaded = false;
    accessSaving = false;
    accessEscArmed = false;
    accessBaseline = "";
    accessList.value = "";
    sayAccess("");
    accessRetry.hidden = true;
    setAccessEditable(false);
  }

  // A failed request is told in plain words: no connection, or the server's status. Never the browser's own text.
  function accessProblem(error, what, retryAdvice) {
    return error.status
      ? `Could not ${what} (${error.status}). Try again.`
      : `Could not ${retryAdvice}. Check your connection and try again.`;
  }

  async function loadAccess() {
    const token = ++accessToken;
    const sid = sessionId;
    accessLoaded = false;
    accessEscArmed = false;
    accessRetry.hidden = true;
    setAccessEditable(false);
    sayAccess("Loading…");
    try {
      const resp = await adminFetch("/api/features?admin=1");
      if (token !== accessToken || sid !== sessionId) return;
      if (resp.status === 401) {
        forgetSession("Admin session expired. Sign in again.");
        return;
      }
      if (!resp.ok) throw Object.assign(new Error("http"), { status: resp.status });
      const data = await resp.json();
      if (token !== accessToken || sid !== sessionId) return;
      accessList.value = accessText(data.community || []);
      accessBaseline = accessList.value;
      accessLoaded = true;
      setAccessEditable(true);
      sayAccess("");
    } catch (error) {
      if (token !== accessToken || sid !== sessionId) return;
      accessList.value = "";
      sayAccess(accessProblem(error, "load the list", "load the list"));
      accessRetry.hidden = false;
    }
  }

  document.getElementById("accessBtn").addEventListener("click", () => {
    leaveNavigationForMap();
    const wasOpen = !accessPanel.hidden;
    closeOverlayPanels("access");
    accessPanel.hidden = false;
    syncPanelButtons();
    if (accessDirty() || accessSaving) {
      // Never overwrite what is typed: just bring the panel (and the cursor) back.
      if (!wasOpen) {
        accessEscArmed = false;
        if (accessDirty()) sayAccess("Unsaved changes kept — Save, or press Esc twice to discard.", true);
      }
      (wasOpen ? accessList : accessClose).focus();
      return;
    }
    accessClose.focus();
    loadAccess();
  });
  accessRetry.addEventListener("click", () => {
    accessClose.focus();
    loadAccess();
  });
  accessList.addEventListener("input", () => {
    accessEscArmed = false;
    if (accessNotice) sayAccess("");
  });
  accessSave.addEventListener("click", async () => {
    if (!accessLoaded || accessSaving) return;
    const lines = accessList.value.split("\n").map((line) => line.trim()).filter(Boolean);
    const community = lines.map((line) => {
      const [id, ...rest] = line.split(/\s+/);
      return { id, note: rest.join(" ") };
    });
    const sid = sessionId;
    accessSaving = true;
    accessEscArmed = false;
    setAccessEditable(false);
    sayAccess("Saving…");
    try {
      const resp = await adminFetch("/api/features", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ community }) });
      if (sid !== sessionId) return;
      if (resp.status === 401) {
        forgetSession("Admin session expired. Sign in again.");
        return;
      }
      if (!resp.ok) throw Object.assign(new Error("http"), { status: resp.status });
      const saved = await resp.json();
      if (sid !== sessionId) return;
      accessList.value = accessText(saved.community);
      accessBaseline = accessList.value;
      const dropped = lines.length - saved.community.length;
      const droppedText = dropped > 0
        ? ` ${dropped} line${dropped === 1 ? " was not a valid tester ID" : "s were not valid tester IDs"} (10 characters, 0-9 and a-f) or ${dropped === 1 ? "was" : "were"} repeated, and ${dropped === 1 ? "was" : "were"} dropped.`
        : "";
      sayAccess(`Saved ${saved.community.length} tester${saved.community.length === 1 ? "" : "s"}.${droppedText}`);
    } catch (error) {
      if (sid !== sessionId) return;
      sayAccess(accessProblem(error, "save", "save"));
    }
    accessSaving = false;
    setAccessEditable(true);
    if (!document.activeElement || document.activeElement === document.body) accessSave.focus();
  });
  accessClose.addEventListener("click", () => {
    // The cross keeps any unsaved text (reopening restores it); only a second Escape discards.
    closeOverlay("access");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || adminApp.hidden) return;
    if (!accessPanel.hidden && accessDirty()) {
      if (!accessEscArmed) {
        accessEscArmed = true;
        sayAccess("Unsaved changes — Save or press Esc again to discard.", true);
        return;
      }
      accessList.value = accessBaseline;
      accessEscArmed = false;
      sayAccess("");
    }
    closeOverlayPanels();
  });

  // ---- Beta codes: one code per person, shared as /beta/<code>. Revoking a claimed code removes that person's access. ----
  const betaPanel = document.getElementById("adminBeta");
  const betaList = document.getElementById("adminBetaList");
  const betaStatus = document.getElementById("adminBetaStatus");
  const betaNote = document.getElementById("adminBetaNote");
  const betaCreate = document.getElementById("adminBetaCreate");
  const betaRetry = document.getElementById("adminBetaRetry");
  const betaClose = document.getElementById("adminBetaClose");
  let betaCodes = [];
  let betaLoaded = false;
  let betaBusy = false;
  let betaArmed = ""; // the code whose Revoke awaits its confirming second press
  let betaToken = 0;
  let betaStatusSeq = 0;
  OVERLAY_PANELS.beta.onClose = () => { betaArmed = ""; renderBeta(); };

  const betaLink = (code) => `${location.origin}/beta/${code}`;
  const betaDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  function betaShareButton(code) {
    const share = document.createElement("button");
    share.type = "button";
    share.className = "admin-btn";
    share.dataset.share = code;
    share.textContent = "Share link";
    share.setAttribute("aria-label", `Share link for ${code}`);
    share.addEventListener("click", () => { betaDisarm(); shareBetaLink(code, share); });
    return share;
  }

  // shareCode adds a Share link button after the text (used right after a code is created).
  function setBetaStatus(text, shareCode = "") {
    // Clear first, then set on the next tick, so identical text is announced again.
    const seq = ++betaStatusSeq;
    betaStatus.textContent = "";
    if (!text) return;
    setTimeout(() => {
      if (seq !== betaStatusSeq) return;
      betaStatus.textContent = text;
      if (shareCode) {
        const share = betaShareButton(shareCode);
        share.disabled = !betaLoaded || betaBusy;
        betaStatus.append(" ", share);
      }
    }, 0);
  }

  function syncBetaCreate() {
    betaCreate.disabled = !(betaLoaded && !betaBusy && betaNote.value.trim());
  }

  function betaDisarm() {
    if (!betaArmed) return;
    betaArmed = "";
    syncBetaArmed();
  }

  function syncBetaArmed() {
    for (const btn of betaList.querySelectorAll("button[data-revoke]")) {
      const armed = btn.dataset.revoke === betaArmed;
      btn.textContent = armed ? "Confirm revoke" : "Revoke";
      btn.setAttribute("aria-label", `${armed ? "Confirm revoke code" : "Revoke code"} ${btn.dataset.revoke}`);
    }
  }

  function syncBetaEnabled() {
    const enabled = betaLoaded && !betaBusy;
    // A focused control gets aria-disabled instead of disabled: disabling it would blur it and drop focus to the body.
    const set = (el, off) => {
      if (off && el === document.activeElement) { el.setAttribute("aria-disabled", "true"); el.disabled = false; }
      else { el.removeAttribute("aria-disabled"); el.disabled = off; }
    };
    set(betaNote, !enabled);
    betaNote.readOnly = betaBusy; // text typed while a request is pending would be lost when it finishes
    for (const btn of betaList.querySelectorAll("button[data-revoke]")) set(btn, !enabled);
    for (const btn of betaPanel.querySelectorAll("button[data-share]")) set(btn, !enabled);
    syncBetaCreate();
    if (betaCreate === document.activeElement && betaBusy) { betaCreate.setAttribute("aria-disabled", "true"); betaCreate.disabled = false; }
    else betaCreate.removeAttribute("aria-disabled");
  }

  // focusWhat: "copy" focuses the row's Copy link button, or its code if there is none; "revoke" focuses its Revoke button.
  function renderBeta(focusCode = "", focusWhat = "") {
    betaList.textContent = "";
    betaNote.removeAttribute("aria-disabled");
    betaCreate.removeAttribute("aria-disabled");
    const enabled = betaLoaded && !betaBusy;
    betaNote.disabled = !enabled;
    betaNote.readOnly = betaBusy;
    syncBetaCreate();
    let target = null;
    for (const item of betaCodes) {
      const li = document.createElement("li");
      const code = document.createElement("span");
      code.className = "admin-beta-code";
      code.tabIndex = -1;
      code.textContent = item.code;
      const note = document.createElement("span");
      note.className = "admin-beta-note";
      note.textContent = item.note || "";
      const state = document.createElement("span");
      const claimed = item.claimedAt && betaDate(item.claimedAt) ? ` ${betaDate(item.claimedAt)}` : "";
      const revokedOn = item.revokedAt && betaDate(item.revokedAt) ? ` ${betaDate(item.revokedAt)}` : "";
      state.textContent = item.status === "claimed"
        ? `claimed${claimed}`
        : item.status === "revoked" ? `${item.claimedAt ? `claimed${claimed}, ` : ""}revoked${revokedOn}` : "open";
      li.append(code, note, state);
      let copy = null;
      if (item.status !== "revoked") {
        copy = document.createElement("button");
        copy.type = "button";
        copy.className = "admin-btn";
        copy.textContent = "Copy link";
        copy.setAttribute("aria-label", `Copy link for ${item.code}`);
        copy.addEventListener("click", () => { betaDisarm(); copyBetaLink(item.code); });
        copy.dataset.copy = item.code;
        li.append(copy);
        const share = betaShareButton(item.code);
        share.disabled = !enabled;
        li.append(share);
      }
      let revoke = null;
      if (item.status === "open" || item.status === "claimed") {
        revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "admin-btn";
        revoke.dataset.revoke = item.code;
        revoke.disabled = !enabled;
        revoke.addEventListener("click", () => revokeBeta(item.code));
        li.append(revoke);
      }
      if (item.code === focusCode) target = focusWhat === "revoke" && revoke ? revoke : copy || code;
      betaList.append(li);
    }
    syncBetaArmed();
    if (target) target.focus();
  }

  function resetBetaPanel() {
    betaToken++;
    betaCodes = [];
    betaLoaded = false;
    betaBusy = false;
    betaArmed = "";
    betaNote.value = "";
    setBetaStatus("");
    betaRetry.hidden = true;
    renderBeta();
  }

  async function betaFetch(options) {
    const resp = await adminFetch("/api/beta/codes", options);
    if (resp.status === 401) return { unauthorised: true };
    let data = null;
    try { data = await resp.json(); } catch { /* not JSON */ }
    if (!resp.ok) throw Object.assign(new Error("http"), { status: resp.status, serverMessage: data && data.error });
    return { data };
  }

  function betaProblem(error, what, useServerText = true) {
    if (useServerText && error.status === 503 && error.serverMessage) return error.serverMessage;
    return error.status ? `Could not ${what}. Try again.` : `Could not ${what}. Check your connection and try again.`;
  }

  async function loadBeta() {
    const token = ++betaToken;
    const sid = sessionId;
    betaLoaded = false;
    betaBusy = false;
    betaArmed = "";
    betaRetry.hidden = true;
    setBetaStatus("Loading…");
    renderBeta();
    try {
      const result = await betaFetch({});
      if (token !== betaToken || sid !== sessionId) return;
      if (result.unauthorised) { forgetSession("Admin session expired. Sign in again."); return; }
      betaCodes = Array.isArray(result.data.codes) ? result.data.codes : [];
      betaLoaded = true;
      setBetaStatus("");
    } catch (error) {
      if (token !== betaToken || sid !== sessionId) return;
      betaCodes = [];
      setBetaStatus(betaProblem(error, "load beta codes", false));
      betaRetry.hidden = false;
    }
    renderBeta();
  }

  async function betaAction(body, onDone, onFailFocus = null) {
    const token = betaToken;
    const sid = sessionId;
    let focus = onFailFocus;
    betaBusy = true;
    syncBetaEnabled(); // not renderBeta(): rebuilding the list would drop the focused button mid-request
    try {
      const result = await betaFetch({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (token !== betaToken || sid !== sessionId) return;
      if (result.unauthorised) { forgetSession("Admin session expired. Sign in again."); return; }
      betaBusy = false;
      focus = onDone(result.data) || null;
    } catch (error) {
      if (token !== betaToken || sid !== sessionId) return;
      betaBusy = false;
      setBetaStatus(betaProblem(error, body.action === "create" ? "create a code" : "revoke the code"));
    }
    if (focus) renderBeta(focus.code, focus.what);
    else renderBeta();
    if (!focus && body.action === "create") betaNote.focus();
  }

  betaNote.addEventListener("input", syncBetaCreate);
  betaCreate.addEventListener("click", () => {
    if (!betaLoaded || betaBusy || !betaNote.value.trim()) return;
    betaArmed = "";
    setBetaStatus("Creating…");
    betaAction({ action: "create", note: betaNote.value.trim().slice(0, 80) }, (created) => {
      betaCodes.unshift(created);
      betaNote.value = "";
      setBetaStatus(`New code ${created.code}: ${betaLink(created.code)}`, created.code);
      return { code: created.code, what: "copy" };
    });
  });

  function revokeBeta(code) {
    if (!betaLoaded || betaBusy) return;
    if (betaArmed !== code) {
      betaArmed = code;
      setBetaStatus(`Revoke ${code}? Press Confirm revoke to be sure. A claimed code loses that person's beta access.`);
      syncBetaArmed();
      return;
    }
    betaArmed = "";
    setBetaStatus("Revoking…");
    betaAction({ action: "revoke", code }, () => {
      const row = betaCodes.find((c) => c.code === code);
      if (row) { row.status = "revoked"; row.revokedAt = Date.now(); }
      setBetaStatus(`Revoked ${code}.`);
      return { code, what: "copy" };
    }, { code, what: "revoke" });
  }

  async function copyBetaLink(code) {
    const link = betaLink(code);
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(link);
      setBetaStatus(`Copied ${link}`);
    } catch {
      setBetaStatus(`Could not copy automatically. Copy this link: ${link}`);
    }
  }

  // The native share sheet where there is one; otherwise (or if it fails) the copy behaviour. The note is never shared.
  async function shareBetaLink(code, button) {
    if (!betaLoaded || betaBusy) return;
    const token = betaToken;
    let done = false;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Epping Forest Finds beta", text: "Join the Epping Forest Finds beta. Let us know what you like, what you don't like, and anything that isn't working.", url: betaLink(code) });
        done = true;
      } catch (error) {
        if (error && error.name === "AbortError") done = true;
      }
    }
    if (token !== betaToken) return;
    if (!done) {
      await copyBetaLink(code);
      if (token !== betaToken) return;
    }
    if (button.isConnected) button.focus();
    else if (betaCodes.some((c) => c.code === code)) {
      const copy = betaList.querySelector(`button[data-copy="${code}"]`);
      const row = copy || [...betaList.querySelectorAll(".admin-beta-code")].find((el) => el.textContent === code);
      if (row) row.focus();
    }
  }

  document.getElementById("betaBtn").addEventListener("click", () => {
    leaveNavigationForMap();
    closeOverlayPanels("beta");
    betaPanel.hidden = false;
    syncPanelButtons();
    betaClose.focus();
    loadBeta();
  });
  betaRetry.addEventListener("click", () => {
    betaClose.focus();
    loadBeta();
  });
  betaClose.addEventListener("click", () => closeOverlay("beta"));

  tracksBtn.addEventListener("click", () => showMapView("tracks"));

  // Refresh and the 5-minute auto-refresh share this: a failure leaves the data on screen and says so (a 401 still signs out).
  // A repeated failure adds the time of the latest attempt and is announced again.
  async function refreshData() {
    const sid = sessionId;
    setRefreshing(true);
    try {
      const data = await loadData();
      if (sid !== sessionId) return;
      allData = data;
      lastLoadedAt = new Date();
      setRefreshNote("");
      buildUserList();
      updateStats();
      refreshClickDetails();
      render();
    } catch (err) {
      if (sid !== sessionId) return;
      if (err.message === "unauthorised") {
        forgetSession("Admin session expired. Sign in again.");
      } else {
        const again = refreshStatus.textContent.startsWith("Could not refresh");
        const base = `Could not refresh — showing data from ${clockText(lastLoadedAt || new Date())}.`;
        setRefreshNote(again ? `${base} Tried again at ${clockText(new Date())}.` : base, again);
      }
    } finally {
      // A late answer from a signed-out session must not touch the new session's button (forgetSession already reset it).
      if (sid === sessionId) setRefreshing(false);
    }
  }
  refreshBtn.addEventListener("click", refreshData);

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      // Clear the cookie on the server first. If that fails the admin is still signed in, so say so and keep the dashboard.
      let ok = false;
      try { const resp = await adminFetch("/api/admin/logout", { method: "POST" }); ok = resp.ok || resp.status === 401; } catch {}
      if (!ok) { setRefreshNote("Couldn't log out. Check your connection and try again.", true); return; }
      forgetSession("");
    });
  }

  if (clickDetailsClose) {
    clickDetailsClose.addEventListener("click", hideClickDetails);
  }

  window.addEventListener("resize", () => { invalidateMapFit(); syncSheetInset(); refreshScrollCues(); render(); });

  // Auto-refresh every 5 minutes
  setInterval(() => { if (signedIn) refreshData(); }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", adminBoot);
