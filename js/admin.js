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

// Colour palette for distinguishing users (cycles)
const USER_COLOURS = [
  "#4fc97e", "#e05f4f", "#5b8de8", "#e8a93c", "#b45be8",
  "#5ecdc8", "#e87f5b", "#a3c95e", "#e85b9a", "#5bb8e8",
  "#d4e85b", "#7e4fe8", "#e8c35b", "#5be888", "#e85b5b",
];

// ---- Coordinate helpers ----

let _fallbackBoundsCache = null;
let _mapFitCache = null;

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
  ) {
    return _mapFitCache.fit;
  }

  const pad = Math.max(18, Math.min(canvasW, canvasH) * 0.045);
  const rangeX = Math.max(0.000001, bounds.maxX - bounds.minX);
  const rangeY = Math.max(0.000001, bounds.maxY - bounds.minY);
  const scale = Math.min((canvasW - pad * 2) / rangeX, (canvasH - pad * 2) / rangeY);
  const contentW = rangeX * scale;
  const contentH = rangeY * scale;
  const fit = {
    scale,
    tx: (canvasW - contentW) / 2 - bounds.minX * scale,
    ty: (canvasH - contentH) / 2 - bounds.minY * scale,
  };
  _mapFitCache = { canvasW, canvasH, bounds, fit };
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
  drawClickMarkers(ctx, w, h);
  drawCurrentPositions(ctx, w, h);
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

  if (!adminMap.loaded) {
    drawForestOutline(ctx, w, h);
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

function filteredLocations() {
  const locs = allData.locations;
  if (!selectedUid) return locs;
  return locs.filter((e) => e.uid === selectedUid);
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
  const clicks = allData.clicks.filter((e) => !selectedUid || e.uid === selectedUid);
  for (const e of clicks) {
    if (e.userLat == null || e.userLng == null) continue;
    const { x, y } = latLngToCanvas(e.userLat, e.userLng, w, h);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 200, 50, 0.55)";
    ctx.fill();
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

function buildUserList() {
  const list = document.getElementById("adminUserList");
  if (!list) return;

  const byUser = new Map();
  for (const e of allData.locations) {
    if (!byUser.has(e.uid)) byUser.set(e.uid, { count: 0, last: e.ts });
    const u = byUser.get(e.uid);
    u.count++;
    if (e.ts > u.last) u.last = e.ts;
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
      <span class="admin-user-meta">${info.count} pts</span>
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
  const clicks = allData.clicks.filter((e) => !selectedUid || e.uid === selectedUid);
  const uids = new Set(locs.map((e) => e.uid));
  el.innerHTML = `<strong>${uids.size}</strong> user${uids.size !== 1 ? "s" : ""} &nbsp;·&nbsp; <strong>${locs.length}</strong> location pings &nbsp;·&nbsp; <strong>${clicks.length}</strong> taps`;
}

// ---- Data loading ----

async function loadData(password) {
  const url = `/api/admin/tracks?pw=${encodeURIComponent(password)}`;
  console.log("[admin] fetching", url);
  const resp = await fetch(url, { headers: { "Authorization": `Bearer ${password}` } });
  console.log("[admin] response status", resp.status);
  if (resp.status === 401) throw new Error("wrong-password");
  if (!resp.ok) throw new Error(`Server error ${resp.status}`);
  const data = await resp.json();
  console.log("[admin] data received", data);
  return data;
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
  const canvas = document.getElementById("adminCanvas");

  let password = "";
  loadAdminBaseMap();

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
      loginScreen.hidden = true;
      adminApp.hidden = false;
      console.log("[admin] building UI");
      buildUserList();
      updateStats();
      console.log("[admin] rendering canvas");
      // Defer render one frame so the browser lays out adminApp before
      // we measure the canvas dimensions.
      requestAnimationFrame(render);
      console.log("[admin] done");
    } catch (err) {
      console.error("[admin] login failed:", err);
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
      render();
    } catch {}
    refreshBtn.disabled = false;
  });

  window.addEventListener("resize", () => render());

  // Auto-refresh every 5 minutes
  setInterval(async () => {
    if (!password) return;
    try { allData = await loadData(password); buildUserList(); updateStats(); render(); } catch {}
  }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", adminBoot);
