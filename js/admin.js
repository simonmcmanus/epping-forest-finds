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
// Beta marking only began when the server started tagging events, so older activity is never counted under the beta filter.
const BETA_EMPTY_TEXT = "No beta user activity in this window yet — only activity from after beta tagging was released is marked.";
const BETA_CAVEAT_TEXT = "Beta users only: activity from before beta marking began isn't marked, so it isn't counted here.";
const ME_CHECK_TIMEOUT_MS = 8000;
const ADMIN_VIEWPORT_KEY = "ff-admin-map-viewport";
const BASE_MAP_OPACITY = 0.42;
const MIN_MAP_ZOOM = 0.85;
const MAX_MAP_ZOOM = 14;
const MAP_ZOOM_STEP = 1.35;
const TRACK_TOLERANCE_TOUCH = 12; // css px: how near a tap must land to a route line to pick it
const TRACK_TOLERANCE_MOUSE = 8;

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

// rawData is what the server returned; allData is what the dashboard shows (rawData, or only beta members' events when the beta filter is on).
let rawData = { locations: [], clicks: [], navigation: [] };
let allData = rawData;
let lastMeta = null;
let selectedUid = null; // null = show all users
let selectedTrackUid = null; // the user whose track sheet is open (start and stop markers show for it and for selectedUid)
let trackWalkIndex = 0; // which of the user's walks (0 = oldest) the open track sheet shows
let trackSheetFromList = false; // opened with the Track details button in the Users list, so closing returns focus there
// Time frame (`days` query value: 1, 7, 30, 90 or all) and beta filter, both kept in the page address (?days=7&beta=1).
let requestedWindow = "30"; // set from the address when the dashboard boots
let committedWindow = "30"; // the window asked for when the data on screen was loaded (differs from loadedWindow after a fallback)
let loadedWindow = null; // the window the data on screen actually covers (a 5xx can fall back to a shorter one)
let betaOnly = false; // set from the address when the dashboard boots
let selectedClickKey = null;
let viewMode = "tracks"; // "tracks" | "heatmap" (the last map view; the Navigation page is a separate page-level view, not a map mode)
const PAGE_VIEWS = ["navigation", "stats", "community", "beta"];
let activePage = null; // "navigation" | "stats" | "community" | "beta" while that page is shown instead of the map

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

// Drag and pinch fire pointermove faster than the screen refreshes: draw at most once a frame.
let _renderPending = false;
function scheduleRender() {
  if (_renderPending) return;
  _renderPending = true;
  requestAnimationFrame(() => { _renderPending = false; render(); });
}

function render() {
  const canvas = document.getElementById("adminCanvas");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Resizing the backing store is costly and clears it: only do it when the css size or the pixel ratio changed.
  const pixelW = Math.round(rect.width * dpr);
  const pixelH = Math.round(rect.height * dpr);
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }
  const W = canvas.width;
  const H = canvas.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W / dpr, H / dpr);
  const w = W / dpr;
  const h = H / dpr;

  drawBaseMap(ctx, w, h);

  if (viewMode === "heatmap") {
    drawHeatmap(ctx, w, h);
  } else {
    drawTracks(ctx, w, h);
  }
  drawCurrentPositions(ctx, w, h);
  if (viewMode !== "heatmap") drawTrackEnds(ctx, w, h); // over the last-position dot, which would hide the stop marker
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

  // Every pointer on the canvas (a mouse, or up to two fingers). One pointer drags; two pinch (zoom about their midpoint and pan with it).
  const pointers = new Map(); // pointerId -> { x, y } in client pixels
  let pinch = null; // { zoom, panX, panY, mid, dist } at the start of the pinch
  let gestureRect = null; // the canvas box, read once when a gesture starts (not on every move)

  function pinchNow() {
    const [a, b] = [...pointers.values()];
    const rect = gestureRect || canvas.getBoundingClientRect();
    return { mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  function beginDrag(id, point) {
    adminViewport.dragging = true;
    adminViewport.pointerId = id;
    adminViewport.startX = point.x;
    adminViewport.startY = point.y;
    adminViewport.startPanX = adminViewport.panX;
    adminViewport.startPanY = adminViewport.panY;
    canvas.classList.add("dragging");
  }

  function endGesture() {
    adminViewport.dragging = false;
    adminViewport.pointerId = null;
    pinch = null;
    gestureRect = null;
    canvas.classList.remove("dragging");
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    if (pointers.size >= 2 || pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) gestureRect = canvas.getBoundingClientRect();
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    if (pointers.size === 1) {
      adminViewport.dragMoved = false;
      beginDrag(event.pointerId, { x: event.clientX, y: event.clientY });
      return;
    }
    // Second finger: the drag turns into a pinch. It never counts as a tap.
    adminViewport.dragMoved = true;
    adminViewport.dragging = false;
    const now = pinchNow();
    pinch = { zoom: adminViewport.zoom, panX: adminViewport.panX, panY: adminViewport.panY, mid: now.mid, dist: now.dist };
    canvas.classList.add("dragging");
  });

  canvas.addEventListener("pointermove", (event) => {
    const known = pointers.get(event.pointerId);
    if (!known) return;
    known.x = event.clientX;
    known.y = event.clientY;
    if (pinch && pointers.size === 2) {
      const size = { width: (gestureRect || canvas.getBoundingClientRect()).width, height: (gestureRect || canvas.getBoundingClientRect()).height };
      const next = AdminTools.pinchViewport(pinch, pinchNow(), size, { min: MIN_MAP_ZOOM, max: MAX_MAP_ZOOM });
      adminViewport.zoom = next.zoom;
      adminViewport.panX = next.panX;
      adminViewport.panY = next.panY;
      invalidateMapFit();
      scheduleRender();
      return;
    }
    if (!adminViewport.dragging || event.pointerId !== adminViewport.pointerId) return;
    if (Math.hypot(event.clientX - adminViewport.startX, event.clientY - adminViewport.startY) > 4) adminViewport.dragMoved = true;
    adminViewport.panX = adminViewport.startPanX + (event.clientX - adminViewport.startX);
    adminViewport.panY = adminViewport.startPanY + (event.clientY - adminViewport.startY);
    invalidateMapFit();
    scheduleRender();
  });

  // A finger lifted (or cancelled): lifting one of two continues as a pan from where the other finger is now, so the map does not jump.
  function releasePointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch {}
    saveViewport();
    if (pointers.size === 0) { endGesture(); return; }
    const [[id, point]] = [...pointers.entries()];
    pinch = null;
    beginDrag(id, point);
  }

  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", releasePointer);

  canvas.addEventListener("click", (event) => {
    if (adminViewport.dragMoved) {
      adminViewport.dragMoved = false;
      return;
    }
    const point = eventCanvasPoint(canvas, event);
    const click = findClickMarkerAt(canvas, point.x, point.y);
    if (click) {
      // Tap markers win over a route line underneath them.
      closeTrackDetails();
      selectedClickKey = clickTargetKey(click);
      renderClickDetails(selectedClickKey);
      render();
      const detailsClose = document.getElementById("adminClickDetailsClose");
      if (!document.getElementById("adminClickDetails")?.hidden) detailsClose?.focus();
      return;
    }
    if (viewMode !== "tracks" || activePage) return;
    const touch = event.pointerType === "touch" || event.pointerType === "pen";
    const hit = findTrackAt(canvas, point.x, point.y, touch ? TRACK_TOLERANCE_TOUCH : TRACK_TOLERANCE_MOUSE);
    if (hit) openTrackDetails(hit.uid, false, hit.walk);
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

// One time-sorted grouping of the pings by user, built once per load or filter change (not per frame, tap or list redraw):
// uid -> { walks: [[ping, ...], ...] (split at gaps over 30 minutes), events: all the user's usable pings oldest first, count (all pings), last (latest ts) }.
let _trackCache = { source: null, groups: null };
function trackGroups() {
  if (_trackCache.source === allData.locations && _trackCache.groups) return _trackCache.groups;
  const raw = new Map();
  const stats = new Map();
  for (const e of allData.locations) {
    if (!e) continue;
    if (!stats.has(e.uid)) stats.set(e.uid, { count: 0, last: e.ts });
    const st = stats.get(e.uid);
    st.count += 1;
    if (e.ts > st.last) st.last = e.ts;
    if (e.lat == null || e.lng == null) continue;
    if (!raw.has(e.uid)) raw.set(e.uid, []);
    raw.get(e.uid).push(e);
  }
  const groups = new Map();
  for (const [uid, st] of stats) {
    const walks = AdminTools.splitWalks(raw.get(uid) || []);
    groups.set(uid, { walks, events: walks.flat(), count: st.count, last: st.last });
  }
  _trackCache = { source: allData.locations, groups };
  return groups;
}

// The groups the map shows (the chosen user only, when one is chosen).
function visibleTrackGroups() {
  const groups = trackGroups();
  if (!selectedUid) return groups;
  return groups.has(selectedUid) ? new Map([[selectedUid, groups.get(selectedUid)]]) : new Map();
}

function walksFor(uid) {
  return visibleTrackGroups().get(uid)?.walks || [];
}

// The walk whose start and stop are shown for a user: the open sheet's walk, otherwise their most recent.
function shownWalk(uid) {
  const walks = walksFor(uid);
  if (!walks.length) return null;
  if (uid === selectedTrackUid) return walks[Math.min(trackWalkIndex, walks.length - 1)];
  return walks[walks.length - 1];
}

// Which user's route, and which of their walks, lies under a point (canvas css px); null when none is within tolerance.
function findTrackAt(canvas, x, y, tolerance) {
  const { width, height } = canvasCssSize(canvas);
  if (!width || !height) return null;
  const tracks = [];
  for (const [uid, group] of visibleTrackGroups()) {
    tracks.push({ uid, points: group.events.map((e) => latLngToCanvas(e.lat, e.lng, width, height)) });
  }
  const hit = AdminTools.nearestTrackAt(tracks, x, y, tolerance);
  if (!hit) return null;
  // The segment's nearer end decides the walk (a segment across a long gap belongs to whichever walk the tap is closer to).
  const pointIndex = hit.t < 0.5 ? hit.index : Math.min(hit.index + 1, tracks.find((t) => t.uid === hit.uid).points.length - 1);
  let walk = 0;
  let seen = 0;
  for (const [i, w] of walksFor(hit.uid).entries()) {
    seen += w.length;
    if (pointIndex < seen) { walk = i; break; }
  }
  return { uid: hit.uid, walk };
}

// The nearest named road or path within 80 m of a point, from the base map layers ("" when none is that close or the layers are not loaded).
function placeNameAt(lat, lng) {
  const p = projectLonLat(lng, lat);
  const reach = 80 / (111320 * Math.cos(lat * Math.PI / 180)); // metres to map units (degrees)
  let best = "";
  let bestDistance = reach;
  for (const features of [adminMap.roads, adminMap.paths]) {
    for (const f of features || []) {
      const box = f.bbox;
      if (!f.name || !box || p.x < box.minX - reach || p.x > box.maxX + reach || p.y < box.minY - reach || p.y > box.maxY + reach) continue;
      for (const segment of f.segments) {
        for (let i = 0; i + 1 < segment.length; i += 1) {
          const d = AdminTools.pointSegmentDistance(p.x, p.y, segment[i].x, segment[i].y, segment[i + 1].x, segment[i + 1].y);
          if (d < bestDistance) { bestDistance = d; best = f.name; }
        }
      }
    }
  }
  return best;
}

function drawTracks(ctx, w, h) {
  // Draw route lines (grouped and sorted once per load, see trackGroups)
  for (const [uid, { events }] of visibleTrackGroups()) {
    const colour = userColour(uid);
    ctx.beginPath();
    ctx.strokeStyle = colour + "88";
    ctx.lineWidth = selectedUid === uid ? 2.5 : 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let moved = false;
    for (const e of events) {
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

// The marker colours are CSS tokens (--track-start, --track-stop) so the canvas and the legend cannot drift apart.
let _trackColours = null;
function trackMarkerColours() {
  if (!_trackColours) {
    const css = getComputedStyle(document.documentElement);
    _trackColours = { start: css.getPropertyValue("--track-start").trim() || "#1fa855", stop: css.getPropertyValue("--track-stop").trim() || "#e5383b" };
  }
  return _trackColours;
}

// Start (green circle) and stop (red square) of the selected user's track and of the track whose sheet is open. Different shapes, so colour is not the only cue.
function drawTrackEnds(ctx, w, h) {
  const uids = new Set([selectedUid, selectedTrackUid].filter(Boolean));
  for (const uid of uids) {
    const summary = AdminTools.summariseTrack(shownWalk(uid));
    if (!summary) continue;
    const start = latLngToCanvas(summary.start.lat, summary.start.lng, w, h);
    const stop = latLngToCanvas(summary.stop.lat, summary.stop.lng, w, h);
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = trackMarkerColours().stop;
    ctx.beginPath();
    ctx.rect(stop.x - 7, stop.y - 7, 14, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = trackMarkerColours().start;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
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
  for (const [uid, g] of trackGroups()) byUser.set(uid, { count: g.count, clicks: 0, last: g.last });
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
      closeTrackDetails();
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
  allRow.innerHTML = `<span class="admin-user-dot" style="background:#aaa"></span><span class="admin-user-label">${betaOnly ? "All beta users" : "All users"}</span><span class="admin-user-meta">${users.length} user${users.length === 1 ? "" : "s"}</span>`;
  allRow.addEventListener("click", () => { selectedUid = null; closeTrackDetails(); buildUserList({ reveal: true }); render(); });
  list.appendChild(allRow);
  items.forEach((el) => {
    list.appendChild(el);
    // Keyboard and screen-reader route to the track sheet (a canvas hit is not reachable that way): beside the chosen user, on the Tracks view.
    if (selectedUid && el.dataset.uid === selectedUid && viewMode === "tracks" && !activePage && walksFor(selectedUid).length) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "admin-track-btn";
      open.dataset.uid = `track:${selectedUid}`;
      open.textContent = "Track details";
      open.setAttribute("aria-label", `Track details for ${shortUid(selectedUid)}`);
      open.setAttribute("aria-controls", "adminTrackDetails");
      open.setAttribute("aria-expanded", document.getElementById("adminTrackDetails")?.hidden === false && selectedTrackUid === selectedUid ? "true" : "false");
      open.addEventListener("click", () => openTrackDetails(selectedUid, true));
      list.appendChild(open);
    }
  });
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
  refreshStatsView();
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

// The tap details and the track details are the only overlays, over the map (one at a time). Closing one hands focus back when focus was inside.
function closeClickDetails() {
  if (selectedClickKey || !document.getElementById("adminClickDetails")?.hidden) hideClickDetails();
  closeTrackDetails();
}

// ---- Track details sheet (start and stop of one user's route) ----

function syncTrackButton() {
  const open = document.getElementById("adminTrackDetails")?.hidden === false;
  for (const btn of document.querySelectorAll(".admin-track-btn")) btn.setAttribute("aria-expanded", open && btn.dataset.uid === `track:${selectedTrackUid}` ? "true" : "false");
}

function trackPlaceHtml(point) {
  const name = placeNameAt(point.lat, point.lng);
  const coords = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  return `${name ? `${escapeHtml(name)} <span class="admin-click-muted">(${coords})</span>` : coords}`;
}

// Fills the sheet for selectedTrackUid. False when that user has no pings in the current view (the sheet is then closed).
function renderTrackDetails() {
  const body = document.getElementById("adminTrackDetailsBody");
  const walks = selectedTrackUid ? walksFor(selectedTrackUid) : [];
  if (!walks.length) return false;
  trackWalkIndex = Math.min(Math.max(trackWalkIndex, 0), walks.length - 1);
  const summary = AdminTools.summariseTrack(walks[trackWalkIndex]);
  if (!body || !summary) return false;
  const walkNav = `
    <div class="admin-walk-nav" role="group" aria-label="Walks">
      ${walks.length > 1 ? `<button id="adminTrackPrev" class="admin-walk-btn" type="button"${trackWalkIndex === 0 ? ' aria-disabled="true"' : ""}>Previous walk</button>` : ""}
      <span id="adminTrackWalkLabel" class="admin-walk-label" role="status">Walk ${trackWalkIndex + 1} of ${walks.length}</span>
      ${walks.length > 1 ? `<button id="adminTrackNext" class="admin-walk-btn" type="button"${trackWalkIndex === walks.length - 1 ? ' aria-disabled="true"' : ""}>Next walk</button>` : ""}
    </div>`;
  const when = (t) => escapeHtml(formatEventTime(new Date(t).toISOString()));
  body.innerHTML = `
    <h2 class="admin-click-title">Track details</h2>
    <p class="admin-click-subtitle"><span class="admin-user-dot" style="background:${userColour(selectedTrackUid)}"></span> User ${escapeHtml(shortUid(selectedTrackUid))}</p>
    ${walkNav}
    <div class="admin-click-summary">
      <div class="admin-click-summary-item">
        <span class="admin-click-summary-value">${escapeHtml(AdminTools.formatDuration(summary.durationMs))}</span>
        <span class="admin-click-summary-label">duration</span>
      </div>
      <div class="admin-click-summary-item">
        <span class="admin-click-summary-value">${summary.count}</span>
        <span class="admin-click-summary-label">ping${summary.count !== 1 ? "s" : ""}</span>
      </div>
      <div class="admin-click-summary-item">
        <span class="admin-click-summary-value">${escapeHtml(AdminTools.formatDistance(summary.distanceM))}</span>
        <span class="admin-click-summary-label">walked</span>
      </div>
    </div>
    <dl class="admin-click-meta">
      <div class="admin-click-meta-row">
        <dt class="admin-click-meta-label"><span class="admin-track-key admin-track-key-start" aria-hidden="true"></span>Start</dt>
        <dd class="admin-click-meta-value">${when(summary.start.t)}<br>${trackPlaceHtml(summary.start)}</dd>
      </div>
      <div class="admin-click-meta-row">
        <dt class="admin-click-meta-label"><span class="admin-track-key admin-track-key-stop" aria-hidden="true"></span>Stop</dt>
        <dd class="admin-click-meta-value">${when(summary.stop.t)}<br>${trackPlaceHtml(summary.stop)}</dd>
      </div>
    </dl>
    <p class="admin-click-muted">A new walk starts after a gap of more than 30 minutes. Distance adds up straight lines between pings, skipping gaps of more than 3 minutes. On the map the start is the green circle and the stop the red square.</p>
  `;
  return true;
}

// walk: which walk to show (0 = oldest); omitted, the user's most recent walk.
function openTrackDetails(uid, fromList, walk) {
  const walks = walksFor(uid);
  if (!walks.length) return;
  trackWalkIndex = Number.isInteger(walk) ? walk : walks.length - 1;
  // One overlay at a time: the tap details give way (focus is not inside them, the pointer or list is where the user is).
  selectedClickKey = null;
  const tap = document.getElementById("adminClickDetails");
  if (tap) tap.hidden = true;
  selectedTrackUid = uid;
  trackSheetFromList = !!fromList;
  renderTrackDetails();
  const panel = document.getElementById("adminTrackDetails");
  if (panel) panel.hidden = false;
  syncTrackButton();
  render();
  document.getElementById("adminTrackDetailsClose")?.focus();
}

function closeTrackDetails() {
  const panel = document.getElementById("adminTrackDetails");
  if (!selectedTrackUid && (!panel || panel.hidden)) return;
  const uid = selectedTrackUid;
  const hadFocus = !!panel && panel.contains(document.activeElement);
  const fromList = trackSheetFromList;
  selectedTrackUid = null;
  trackSheetFromList = false;
  if (panel) panel.hidden = true;
  if (hadFocus) {
    const opener = fromList ? document.querySelector(`#adminUserList [data-uid="track:${CSS.escape(uid || "")}"]`) : null;
    (opener || document.getElementById("adminCanvas"))?.focus();
  }
  syncTrackButton();
  render();
}

// Previous / Next walk: keep focus on the button that was pressed (it stays in the page, aria-disabled at either end).
function stepTrackWalk(delta) {
  const walks = selectedTrackUid ? walksFor(selectedTrackUid) : [];
  const next = trackWalkIndex + delta;
  if (next < 0 || next >= walks.length) return;
  trackWalkIndex = next;
  renderTrackDetails();
  render();
  document.getElementById(delta < 0 ? "adminTrackPrev" : "adminTrackNext")?.focus();
}

// After a refresh or a filter change: redraw the open sheet from the current data, or close it when its user is gone.
function refreshTrackDetails() {
  if (!selectedTrackUid) return;
  if (!renderTrackDetails()) closeTrackDetails();
}

// ---- Data loading ----

function updateEnvBadge(meta) {
  const badge = document.getElementById("adminEnvBadge");
  if (!badge) return;
  const storeName = meta?.storeName || "";
  const context = meta?.context || "local";
  // A local or unlinked server has no Netlify deploy context, so there is nothing to name: the badge is only for production and previews.
  if (!storeName || context === "local") {
    badge.hidden = true;
    return;
  }
  let label, cssClass;
  if (storeName === "tracking") {
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
  // Rows the server marked as posted by a beta member (absent on old data and when no row is beta).
  const beta = new Set(Array.isArray(packed.beta) ? packed.beta : []);
  return packed.rows.map((row, index) => {
    const event = { type: packed.type, uid: packed.uids[row[0]], ts: new Date(row[1]).toISOString() };
    fields.forEach((field, i) => { event[field] = row[i + 2]; });
    // A navigation row ends with its kind (start, arrive or end); it becomes navigation_<kind>.
    if (packed.type === "navigation") event.type = `navigation_${row[fields.length + 2]}`;
    if (packed.type === "location") {
      const target = row[fields.length + 2];
      event.navTarget = target >= 0 ? packed.targets[target] : null;
    }
    if (beta.has(index)) event.beta = true;
    return event;
  });
}

// When a window still has too much for one response the function can fail with a 5xx. Fall back to shorter windows (7 days, then 1; see
// AdminTools.windowAttempts) so the dashboard still opens, and say which window it ended up with (data.loadedWindow; the time frame control shows it).
const HTTP_STATUS_NAMES = { 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" };

async function loadData(requested = requestedWindow) {
  let resp;
  let loaded = null;
  for (const days of AdminTools.windowAttempts(requested)) {
    loaded = days;
    try {
      resp = await adminFetch(`/api/admin/tracks?days=${days}`);
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
  data.loadedWindow = loaded;
  return data;
}

// Keep the loaded data and what it says about itself, then derive what is shown (the beta filter). Called only for the newest load, so a late answer never lands here.
function setLoadedData(data) {
  rawData = data;
  loadedWindow = data.loadedWindow || loadedWindow;
  lastMeta = data.meta || null;
  updateEnvBadge(data.meta);
  applyDataFilter();
}

function userHasData(uid) {
  return allData.locations.some((e) => e.uid === uid) || allData.clicks.some((e) => e.uid === uid) || (allData.navigation || []).some((e) => e.uid === uid);
}

function applyDataFilter() {
  allData = betaOnly
    ? { ...rawData, locations: AdminTools.onlyBeta(rawData.locations), clicks: AdminTools.onlyBeta(rawData.clicks), navigation: AdminTools.onlyBeta(rawData.navigation) }
    : rawData;
  // A selected user the filter or the new window hides would leave an empty map with no way to see why: clear the selection.
  if (selectedUid && !userHasData(selectedUid)) selectedUid = null;
}

// The days the data on screen covers, or null for all history.
function loadedDays() {
  if (loadedWindow) return loadedWindow === "all" ? null : Number(loadedWindow);
  return Number.isFinite(lastMeta?.windowDays) ? lastMeta.windowDays : null;
}

function audienceText() {
  return selectedUid ? `user ${shortUid(selectedUid)}` : betaOnly ? "beta users" : "all users";
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
  const card = (label, value) => `<li class="nav-card"><span class="nav-card-value">${escapeHtml(String(value))}</span><span class="nav-card-label">${escapeHtml(label)}</span></li>`;
  const statusRows = Object.entries(stats.byStatus || {}).sort((a, b) => b[1] - a[1])
    .map(([status, n]) => row(status, n)).join("");
  const days = Object.entries(stats.perDay || {}).sort().slice(-7)
    .map(([day, n]) => row(day, n)).join("");
  return `${stats.generatedAt ? `<p class="admin-community-asof">As of the last snapshot, ${escapeHtml(formatEventTime(new Date(stats.generatedAt).toISOString()))}</p>` : ""}
    <ul class="nav-cards">
      ${card("People reporting (all time)", stats.devices)}
      ${card("Active, last 24 h / 7 days", `${stats.activeDevices1d} / ${stats.activeDevices7d}`)}
      ${card("Reports", stats.reports)}
      ${card("Trees questioned", stats.questioned)}
      ${card("Trees verified", stats.verified)}
      ${card("New trees (unconfirmed / confirmed)", `${stats.newTreesUnconfirmed} / ${stats.newTreesConfirmed}`)}
      ${card("Conflicts awaiting review", stats.conflicts)}
      ${card("Points awarded", stats.totalPoints)}
    </ul>
    <div class="nav-grid">
      <section class="nav-panel"><h3>By report type</h3><table class="nav-trend-table">${statusRows || row("None yet", "")}</table></section>
      <section class="nav-panel"><h3>Last 7 days with reports</h3><table class="nav-trend-table">${days || row("None yet", "")}</table></section>
    </div>`;
}

function renderCommunityStats(stats) {
  return `<div class="admin-panel-actions"><button type="button" class="admin-btn" id="communityRebuildBtn">Rebuild snapshot now</button> <button type="button" class="admin-btn" id="communityValidateBtn">Run reward check now</button></div>
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

function navPanel(cls, title, legend, svg, table, note) {
  return `<section class="nav-panel ${cls}"><h3>${title}</h3>${note ? `<p class="nav-note">${escapeHtml(note)}</p>` : ""}<ul class="nav-legend">${legend}</ul>${svg}${table}</section>`;
}

function navigationViewHtml() {
  const journeys = navigationJourneysForView();
  if (!journeys.length) return `<p class="nav-empty nav-empty-state">${betaOnly && !selectedUid ? `No beta user navigation journeys in this window yet — only activity from after beta tagging was released is marked.` : `No navigation journeys in this window${selectedUid ? " for the selected user" : ""}.`}</p>`;
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
  const panel = navPanel;
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
  const windowText = AdminTools.windowPhrase(loadedDays());
  if (sub) sub.textContent = `Navigation journeys over ${windowText}, for ${audienceText()}.${selectedUid ? "" : " Choose a user in the Users list to filter these figures."}`;
}

// ---- Stats page (summary cards and daily trends) ----

// The navigation summary on the Stats page: the headline figures and a link to the Navigation page, which has the detail.
function statsNavigationHtml() {
  const link = `<a href="#navigation">Open the Navigation page</a>`;
  const journeys = navigationJourneysForView();
  if (!journeys.length) return `<p class="nav-note">No navigation journeys in this window. ${link}.</p>`;
  const s = summariseNavJourneys(journeys);
  const rate = s.completionRate === null ? "n/a" : `${Math.round(s.completionRate * 100)}%`;
  return `<p class="nav-note">Navigation: ${s.started} journey${s.started === 1 ? "" : "s"} started, ${s.completed} arrived (${rate}), ${(s.totalDistanceWalkedM / 1000).toFixed(1)} km walked. ${link}.</p>`;
}

function statsBarChartSvg(rows, key, what, unit, cls, width, sumsUp = true) {
  const { p, ph, band, xLabels, cx, grid } = navChartFrame(rows, width);
  const total = rows.reduce((a, r) => a + r[key], 0);
  const max = Math.max(1, ...rows.map((r) => r[key]));
  const bw = Math.min(width > NAV_SVG_W ? 26 : 22, band * 0.7);
  const plural = (n) => `${n} ${n === 1 ? unit : `${unit}s`}`;
  const bars = rows.map((r, i) => {
    const h = (r[key] / max) * ph;
    return `<rect class="nav-bar-${cls}" x="${(cx(i) - bw / 2).toFixed(1)}" y="${(p.t + ph - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}">${navTitle(`${r.day}: ${plural(r[key])}`)}</rect>`;
  }).join("");
  const busiest = rows.reduce((best, r) => (r[key] > best[key] ? r : best), rows[0]);
  const label = `${what} per day, over ${rows.length} day${rows.length === 1 ? "" : "s"} from ${rows[0].day} to ${rows[rows.length - 1].day}: ${sumsUp ? `${plural(total)} in all, ` : ""}busiest day ${busiest.day} with ${busiest[key]}.`;
  return `<svg class="nav-chart" viewBox="0 0 ${width} ${NAV_SVG_H}" role="img" aria-label="${escapeHtml(label)}">`
    + grid([p.t, p.t + ph / 2])
    + `<line class="nav-axis" x1="${p.l}" y1="${p.t + ph}" x2="${width - p.r}" y2="${p.t + ph}"/>`
    + `<text x="${p.l - 4}" y="${p.t + 4}" text-anchor="end">${max}</text><text x="${p.l - 4}" y="${p.t + ph + 4}" text-anchor="end">0</text>`
    + `${bars}${xLabels}</svg>`;
}

function statsViewHtml() {
  const locs = filteredLocations();
  const clicks = filteredClicks();
  const uids = new Set([...locs, ...clicks].map((e) => e.uid));
  const windowDays = loadedDays();
  const card = (label, value, title) => `<li class="nav-card"${title ? ` title="${escapeHtml(title)}"` : ""}><span class="nav-card-value">${escapeHtml(String(value))}</span><span class="nav-card-label">${escapeHtml(label)}</span></li>`;
  const cards = [
    card("Users", uids.size),
    card("Location pings", locs.length),
    card("Taps", clicks.length),
    card("Time window", AdminTools.windowShort(windowDays), windowDays ? `Last ${AdminTools.windowShort(windowDays)}` : "All loaded history"),
  ].join("");
  const partial = lastMeta?.partial
    ? `<p class="nav-note">Partial: too much data for one read, newest shown${lastMeta.oldestDay ? ` (back to ${escapeHtml(lastMeta.oldestDay)}${lastMeta.oldestDayIncomplete ? ", that day only in part" : ""})` : ""}.</p>`
    : "";
  const head = `<ul class="nav-cards">${cards}</ul>${partial}${statsNavigationHtml()}`;
  const rows = typeof groupActivityByDay === "function" ? groupActivityByDay(locs, clicks) : [];
  if (!rows.length) return `${head}<p class="nav-empty nav-empty-state">${betaOnly && !selectedUid ? BETA_EMPTY_TEXT : `No tracking activity in this window${selectedUid ? " for the selected user" : ""}.`}</p>`;
  const swatch = (cls, text) => `<li><span class="nav-swatch nav-bar-${cls}"></span>${text}</li>`;
  const note = (key, what) => {
    const total = rows.reduce((a, r) => a + r[key], 0);
    const best = rows.reduce((b, r) => (r[key] > b[key] ? r : b), rows[0]);
    return `${what}: busiest day ${best.day} (${best[key]}), average ${(total / rows.length).toFixed(1)} a day.`;
  };
  const panel = (cls, title, key, what, unit, barCls, width, tableHead) => navPanel(cls, title, swatch(barCls, title.replace(/ by day$/, "")),
    statsBarChartSvg(rows, key, what, unit, barCls, width, key !== "users"),
    navTable(`${tableHead} per day`, `Daily ${tableHead.toLowerCase()}, scrollable`, ["Day", tableHead], rows.map((r) => [r.day, String(r[key])])), note(key, what));
  return `${head}<div class="nav-grid">`
    + panel("nav-panel-wide", "Users active by day", "users", "Users active", "user", "started", NAV_SVG_WIDE_W, "Users")
    + panel("", "Location pings by day", "pings", "Location pings", "location ping", "completed", NAV_SVG_W, "Location pings")
    + panel("", "Taps by day", "taps", "Taps", "tap", "b15to30", NAV_SVG_W, "Taps")
    + `</div>`;
}

function refreshStatsView() {
  const el = document.getElementById("adminStatsPage");
  const body = document.getElementById("adminStatsBody");
  if (!el || !body || el.hidden) return;
  body.innerHTML = statsViewHtml();
  const sub = document.getElementById("adminStatsSub");
  const windowText = AdminTools.windowPhrase(loadedDays());
  if (sub) sub.textContent = `Users, location pings and taps over ${windowText}, for ${audienceText()}.${selectedUid ? "" : " Choose a user in the Users list to filter these figures."}`;
}

// ---- Boot ----

async function adminBoot() {
  const loginScreen = document.getElementById("loginScreen");
  const adminApp = document.getElementById("adminApp");
  const loginBtn = document.getElementById("loginBtn");
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
  const communityBody = document.getElementById("adminCommunityBody");
  const communityStatus = document.getElementById("adminCommunityStatus");
  const toolbar = document.getElementById("adminToolbar");
  const windowSelect = document.getElementById("adminWindowSelect");
  const windowNote = document.getElementById("adminWindowNote");
  const filterNote = document.getElementById("adminFilterNote");
  const audienceBtns = { all: document.getElementById("adminAudienceAll"), beta: document.getElementById("adminAudienceBeta") };
  const trackDetailsClose = document.getElementById("adminTrackDetailsClose");

  let signedIn = false;
  const initialQuery = new URLSearchParams(location.search);
  requestedWindow = AdminTools.normaliseWindow(initialQuery.get("days"));
  betaOnly = initialQuery.get("beta") === "1";
  clearLegacyStoredPassword();
  readSavedViewport();
  loadAdminBaseMap();
  setupMapViewportHandlers(canvas, zoomInBtn, zoomOutBtn, resetMapBtn);

  const refreshStatus = document.getElementById("adminRefreshStatus");
  const communityRetry = document.getElementById("adminCommunityRetry");

  // The sign-in card stays hidden (admin-checking, set before first paint in admin.html) until the check below resolves.
  // The safety timer in admin.html is only cancelled once the check has resolved (endChecking), so a hung check or a throw before it can never leave the note up forever.
  const endChecking = () => {
    clearTimeout(Number(document.documentElement.dataset.checkTimer));
    document.documentElement.classList.remove("admin-checking");
  };

  let sessionId = 0; // bumped on sign-out so a late response cannot bring old data back
  let lastLoadedAt = null;

  function clockText(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // The refresh note changes the map's height, so lay the map out again.
  function relayout() {
    invalidateMapFit();
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

  // ---- Time frame and beta filter (toolbar under the top bar) ----
  windowSelect.replaceChildren(...AdminTools.WINDOW_OPTIONS.map((o) => {
    const option = document.createElement("option");
    option.value = o.value;
    option.textContent = o.label;
    return option;
  }));
  let loadSeq = 0; // newest load wins: a slower, older answer is dropped

  function syncUrl() {
    const query = new URLSearchParams(location.search);
    if (requestedWindow === AdminTools.DEFAULT_WINDOW) query.delete("days"); else query.set("days", requestedWindow);
    if (betaOnly) query.set("beta", "1"); else query.delete("beta");
    const text = query.toString();
    history.replaceState(null, "", `${location.pathname}${text ? `?${text}` : ""}${location.hash}`);
  }

  // The control shows the window actually loaded, which is shorter than the one asked for after a fallback.
  function syncToolbar() {
    windowSelect.value = loadedWindow && AdminTools.WINDOW_OPTIONS.some((o) => o.value === loadedWindow) ? loadedWindow : requestedWindow;
    audienceBtns.all.setAttribute("aria-pressed", betaOnly ? "false" : "true");
    audienceBtns.beta.setAttribute("aria-pressed", betaOnly ? "true" : "false");
    audienceBtns.all.classList.toggle("active", !betaOnly);
    audienceBtns.beta.classList.toggle("active", betaOnly);
  }

  function setToolbarBusy(busy) {
    toolbar.setAttribute("aria-busy", busy ? "true" : "false");
  }

  // Beta users only, with nothing to show: say why (events are only marked from the release of beta tagging on).
  function updateFilterNote() {
    const empty = betaOnly && !allData.locations.length && !allData.clicks.length && !(allData.navigation || []).length;
    filterNote.textContent = empty ? BETA_EMPTY_TEXT : betaOnly ? BETA_CAVEAT_TEXT : "";
  }

  // Redraw everything that depends on the data or the filters.
  function renderAll() {
    buildUserList();
    refreshClickDetails();
    refreshTrackDetails();
    updateFilterNote();
    syncToolbar();
    render();
  }

  // One result of a load (first, Refresh, auto-refresh or a time frame change) landing on screen.
  function applyLoaded(data, asked) {
    committedWindow = asked;
    setLoadedData(data);
    lastLoadedAt = new Date();
    setRefreshNote("");
    windowNote.textContent = loadedWindow !== asked ? `Showing ${AdminTools.windowPhrase(loadedDays())}: ${AdminTools.windowPhrase(asked === "all" ? null : Number(asked))} was too much to load.` : "";
    renderAll();
  }

  // A load for another window failed: go back to the window the data on screen was asked for, in the control, the address and a note.
  function revertWindow(failed) {
    requestedWindow = committedWindow;
    syncUrl();
    syncToolbar();
    windowNote.textContent = `Could not load ${AdminTools.windowPhrase(failed === "all" ? null : Number(failed))}. Still showing ${AdminTools.windowPhrase(loadedDays())}.`;
  }

  async function changeWindow(value) {
    const asked = AdminTools.normaliseWindow(value);
    requestedWindow = asked;
    syncUrl();
    const seq = ++loadSeq;
    const sid = sessionId;
    setToolbarBusy(true);
    windowNote.textContent = `Loading ${AdminTools.windowPhrase(asked === "all" ? null : Number(asked))}…`;
    try {
      const data = await loadData(asked);
      if (seq !== loadSeq || sid !== sessionId) return;
      applyLoaded(data, asked);
    } catch (err) {
      if (seq !== loadSeq || sid !== sessionId) return;
      if (err.message === "unauthorised") { forgetSession("Admin session expired. Sign in again."); return; }
      // Keep the data (and the window it covers) on screen; the next Refresh uses the window that works.
      revertWindow(asked);
    } finally {
      if (seq === loadSeq && sid === sessionId) setToolbarBusy(false);
    }
  }

  function setAudience(onlyBeta) {
    if (betaOnly === onlyBeta) return;
    betaOnly = onlyBeta;
    syncUrl();
    closeTrackDetails();
    applyDataFilter();
    renderAll();
  }

  windowSelect.addEventListener("change", () => changeWindow(windowSelect.value));
  audienceBtns.all.addEventListener("click", () => setAudience(false));
  audienceBtns.beta.addEventListener("click", () => setAudience(true));

  function showAdminApp() {
    endChecking();
    loginScreen.hidden = true;
    adminApp.hidden = false;
    lastLoadedAt = new Date();
    committedWindow = requestedWindow;
    setRefreshNote("");
    windowNote.textContent = loadedWindow !== requestedWindow ? `Showing ${AdminTools.windowPhrase(loadedDays())}: ${AdminTools.windowPhrase(requestedWindow === "all" ? null : Number(requestedWindow))} was too much to load.` : "";
    buildUserList();
    refreshClickDetails();
    refreshTrackDetails();
    updateFilterNote();
    syncToolbar();
    refreshScrollCues();
    applyView(hashView(), { focusHeading: PAGE_VIEWS.includes(hashView()) });
    requestAnimationFrame(render);
  }

  function showLogin(message = "") {
    endChecking();
    adminApp.hidden = true;
    loginScreen.hidden = false;
    loginError.textContent = message;
  }

  function forgetSession(message = "") {
    sessionId++;
    signedIn = false;
    setRefreshing(false); // an answer still on its way is ignored, so it can no longer re-enable the button
    communityAction = null;
    communityResultStash = "";
    rawData = { locations: [], clicks: [], navigation: [] };
    allData = rawData;
    loadedWindow = null;
    loadSeq++;
    setToolbarBusy(false);
    windowNote.textContent = "";
    filterNote.textContent = "";
    selectedUid = null;
    selectedClickKey = null;
    selectedTrackUid = null;
    // Nothing from this session may reappear at the next sign-in: close the tap details, leave the pages and empty what they held.
    closeClickDetails();
    resetView();
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
      // A check that never answers is a failed check: abort after 8 s.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), ME_CHECK_TIMEOUT_MS);
      let me;
      try { me = await adminFetch("/api/admin/me", { signal: controller.signal }); } finally { clearTimeout(abortTimer); }
      if (me.status === 401) { showLogin(signinMessage); return; }
      if (!me.ok) throw Object.assign(new Error(`Server error ${me.status}`), { status: me.status });
      const data = await loadData();
      setLoadedData(data);
      signedIn = true;
      showAdminApp();
    } catch (err) {
      console.error("[admin] could not restore the sign-in:", err, err.detail || "");
      if (err.message === "unauthorised") showLogin(signinMessage || "Admin session expired. Sign in again.");
      else {
        showLogin(err.network || err instanceof TypeError ? "Cannot reach the server. Check your connection, then reload the page." : "Couldn't check your sign-in. Reload the page, then sign in.");
      }
    }
  }
  restoreSession();

  const navigationBtn = document.getElementById("navigationBtn");
  const statsBtn = document.getElementById("statsBtn");
  const communityBtn = document.getElementById("communityBtn");
  const betaBtn = document.getElementById("betaBtn");
  const mapArea = document.querySelector(".admin-map-area");
  const sidebar = document.querySelector(".admin-sidebar");
  // Pages sit beside the map area, never over it: the map area is hidden while one is shown. Navigation and Stats keep the
  // Users list as their filter; Community and Beta have no use for it and take the full width.
  const PAGES = {
    navigation: { el: document.getElementById("adminNavigation"), title: "adminNavigationTitle", btn: navigationBtn, users: true },
    stats: { el: document.getElementById("adminStatsPage"), title: "adminStatsTitle", btn: statsBtn, users: true },
    community: { el: document.getElementById("adminCommunity"), title: "adminCommunityTitle", btn: communityBtn, users: false },
    beta: { el: document.getElementById("adminBeta"), title: "adminBetaTitle", btn: betaBtn, users: false },
  };
  const VIEW_HASHES = ["tracks", "heatmap", ...PAGE_VIEWS];
  const hashView = () => {
    const name = location.hash.replace(/^#/, "");
    return VIEW_HASHES.includes(name) ? name : "tracks";
  };
  const currentView = () => activePage || viewMode;

  // Show one view: a page (map area hidden, tap details closed) or a map view. Entering Community or Beta loads its data.
  function applyView(name, { focusHeading = false } = {}) {
    const wasPage = activePage;
    // Leaving a page hides its focused heading: decide before hiding (browsers fix focus up at different times), then hand it to the matching view button.
    const lostFocus = wasPage && PAGES[wasPage].el.contains(document.activeElement);
    if (PAGES[name]) {
      closeClickDetails();
      for (const [key, page] of Object.entries(PAGES)) page.el.hidden = key !== name;
      activePage = name;
      mapArea.hidden = true;
      sidebar.hidden = !PAGES[name].users;
      toolbar.hidden = !PAGES[name].users;
      if (PAGES[name].users) buildUserList(); // drops the Track details button, which belongs to the Tracks view
      setActiveView(name);
      if (name === "navigation") refreshNavigationView();
      else if (name === "stats") refreshStatsView();
      else if (wasPage !== name) (name === "community" ? loadCommunity : loadBeta)();
      if (focusHeading) document.getElementById(PAGES[name].title).focus({ preventScroll: true });
      return;
    }
    activePage = null;
    viewMode = name;
    mapArea.dataset.view = name;
    for (const page of Object.values(PAGES)) page.el.hidden = true;
    sidebar.hidden = false;
    toolbar.hidden = false;
    mapArea.hidden = false;
    // Start and stop markers and the track sheet are for the Tracks view only.
    if (name === "heatmap") closeTrackDetails();
    if (adminApp.hidden === false) buildUserList();
    setActiveView(name);
    if (lostFocus) (name === "heatmap" ? heatmapBtn : tracksBtn).focus();
    if (wasPage) invalidateMapFit();
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
    for (const [key, btn] of [["tracks", tracksBtn], ["heatmap", heatmapBtn], ...Object.entries(PAGES).map(([k, page]) => [k, page.btn])]) {
      btn.classList.toggle("active", key === name);
      btn.setAttribute("aria-pressed", key === name ? "true" : "false");
    }
  }
  heatmapBtn.addEventListener("click", () => showMapView("heatmap"));
  for (const [key, page] of Object.entries(PAGES)) page.btn.addEventListener("click", () => goToView(key, { focusHeading: true }));
  window.addEventListener("hashchange", () => {
    if (adminApp.hidden) return;
    const name = hashView();
    if (name !== currentView()) applyView(name, { focusHeading: PAGE_VIEWS.includes(name) });
  });

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

  communityRetry.addEventListener("click", () => {
    document.getElementById("adminCommunityTitle").focus({ preventScroll: true });
    loadCommunity();
  });

  // ---- Beta codes: one code per person, shared as /beta/<code>. Revoking a claimed code removes that person's access. ----
  const betaPanel = document.getElementById("adminBeta");
  const betaLists = {
    users: document.getElementById("adminBetaUsers"),
    open: document.getElementById("adminBetaOpen"),
    revoked: document.getElementById("adminBetaRevoked"),
  };
  const betaStatus = document.getElementById("adminBetaStatus");
  const betaNote = document.getElementById("adminBetaNote");
  const betaCreate = document.getElementById("adminBetaCreate");
  const betaRetry = document.getElementById("adminBetaRetry");
  let betaCodes = [];
  let betaLoaded = false;
  let betaBusy = false;
  let betaArmed = ""; // the code whose Revoke awaits its confirming second press
  let betaToken = 0;
  let betaStatusSeq = 0;

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
    for (const btn of betaPanel.querySelectorAll("button[data-revoke]")) {
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
    for (const btn of betaPanel.querySelectorAll("button[data-revoke]")) set(btn, !enabled);
    for (const btn of betaPanel.querySelectorAll("button[data-share]")) set(btn, !enabled);
    syncBetaCreate();
    if (betaCreate === document.activeElement && betaBusy) { betaCreate.setAttribute("aria-disabled", "true"); betaCreate.disabled = false; }
    else betaCreate.removeAttribute("aria-disabled");
  }

  // focusWhat: "copy" focuses the row's Copy link button, or its code if there is none; "revoke" focuses its Revoke button.
  function renderBeta(focusCode = "", focusWhat = "") {
    for (const list of Object.values(betaLists)) list.textContent = "";
    betaNote.removeAttribute("aria-disabled");
    betaCreate.removeAttribute("aria-disabled");
    const enabled = betaLoaded && !betaBusy;
    betaNote.disabled = !enabled;
    betaNote.readOnly = betaBusy;
    syncBetaCreate();
    let target = null;
    const groups = { users: [], open: [], revoked: [] };
    for (const item of betaCodes) {
      const li = document.createElement("li");
      const code = document.createElement("span");
      code.className = "admin-beta-code";
      code.tabIndex = -1;
      code.textContent = item.code;
      const note = document.createElement("span");
      note.className = "admin-beta-note";
      note.textContent = item.note || "";
      if (!item.note) { note.textContent = "No name"; note.classList.add("admin-beta-noname"); }
      const state = document.createElement("span");
      const claimed = item.claimedAt && betaDate(item.claimedAt) ? ` ${betaDate(item.claimedAt)}` : "";
      const revokedOn = item.revokedAt && betaDate(item.revokedAt) ? ` ${betaDate(item.revokedAt)}` : "";
      state.textContent = item.status === "claimed"
        ? `claimed${claimed}`
        : item.status === "revoked" ? `${item.claimedAt ? `claimed${claimed}, ` : ""}revoked${revokedOn}` : "open";
      state.className = "admin-beta-state";
      li.append(note, code, state);
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
      const group = item.status === "claimed" ? "users" : item.status === "revoked" ? "revoked" : "open";
      groups[group].push(item);
      betaLists[group].append(li);
    }
    // Section headings carry the counts; an empty section says so once the list has loaded (not while loading or after a failed load).
    for (const [group, title] of [["users", "Beta users"], ["open", "Open codes"], ["revoked", "Revoked"]]) {
      const id = group[0].toUpperCase() + group.slice(1);
      document.getElementById(`adminBeta${id}Head`).textContent = betaLoaded ? `${title} (${groups[group].length})` : title;
      document.getElementById(`adminBeta${id}Empty`).hidden = !(betaLoaded && !groups[group].length);
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
      const copy = betaPanel.querySelector(`button[data-copy="${code}"]`);
      const row = copy || [...betaPanel.querySelectorAll(".admin-beta-code")].find((el) => el.textContent === code);
      if (row) row.focus();
    }
  }

  // The Retry button hides itself when the load starts, so focus moves to the page heading first.
  betaRetry.addEventListener("click", () => {
    document.getElementById("adminBetaTitle").focus({ preventScroll: true });
    loadBeta();
  });

  tracksBtn.addEventListener("click", () => showMapView("tracks"));

  // Refresh and the 5-minute auto-refresh share this: a failure leaves the data on screen and says so (a 401 still signs out).
  // A repeated failure adds the time of the latest attempt and is announced again.
  async function refreshData() {
    const sid = sessionId;
    const seq = ++loadSeq;
    const asked = requestedWindow; // Refresh and the auto-refresh keep the chosen time frame
    setRefreshing(true);
    try {
      const data = await loadData(asked);
      if (sid !== sessionId || seq !== loadSeq) return; // signed out, or a newer load (a time frame change) took over
      applyLoaded(data, asked);
    } catch (err) {
      if (sid !== sessionId || seq !== loadSeq) return;
      if (err.message === "unauthorised") {
        forgetSession("Admin session expired. Sign in again.");
      } else {
        // A Refresh that overtook a time frame change and failed: the data is still the old window, so the control must say so.
        if (asked !== committedWindow) revertWindow(asked);
        const again = refreshStatus.textContent.startsWith("Could not refresh");
        const base = `Could not refresh — showing data from ${clockText(lastLoadedAt || new Date())}.`;
        setRefreshNote(again ? `${base} Tried again at ${clockText(new Date())}.` : base, again);
      }
    } finally {
      // A late answer from a signed-out session must not touch the new session's button (forgetSession already reset it).
      if (sid === sessionId) {
        setRefreshing(false);
        if (seq === loadSeq) {
          setToolbarBusy(false);
          if (windowNote.textContent.startsWith("Loading")) windowNote.textContent = "";
        }
      }
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
  if (trackDetailsClose) trackDetailsClose.addEventListener("click", closeTrackDetails);
  document.getElementById("adminTrackDetailsBody")?.addEventListener("click", (event) => {
    const button = event.target.closest("#adminTrackPrev, #adminTrackNext");
    if (button) stepTrackWalk(button.id === "adminTrackPrev" ? -1 : 1);
  });

  // Escape closes the tap details (the only overlay left).
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !adminApp.hidden) closeClickDetails();
  });

  window.addEventListener("resize", () => { invalidateMapFit(); refreshScrollCues(); render(); });

  // Auto-refresh every 5 minutes
  // (skipped while the tab is hidden; coming back to a tab whose data is older than that refreshes it once)
  const AUTO_REFRESH_MS = 5 * 60 * 1000;
  setInterval(() => { if (signedIn && !document.hidden) refreshData(); }, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && signedIn && lastLoadedAt && Date.now() - lastLoadedAt.getTime() >= AUTO_REFRESH_MS) refreshData();
  });
}

// A throw anywhere in boot must still end the "Checking your sign-in…" note: show the card with its link.
async function adminBootSafely() {
  try {
    await adminBoot();
  } catch (error) {
    console.error("[admin] boot failed:", error);
    clearTimeout(Number(document.documentElement.dataset.checkTimer));
    document.documentElement.classList.remove("admin-checking");
    const adminApp = document.getElementById("adminApp");
    const loginScreen = document.getElementById("loginScreen");
    const loginError = document.getElementById("loginError");
    if (adminApp) adminApp.hidden = true;
    if (loginScreen) loginScreen.hidden = false;
    if (loginError) loginError.textContent = "Couldn't check your sign-in. Reload the page, then sign in.";
  }
}

document.addEventListener("DOMContentLoaded", adminBootSafely);
