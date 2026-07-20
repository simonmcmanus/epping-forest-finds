const MAP_ICON_SCALE = 2;
const MAP_PNG_ICON_SIZE = 12;
const BEER_ICON_SCALE = 1.15;

const mapImageCache = new Map();

function getMapImage(src) {
  if (!mapImageCache.has(src)) {
    const img = new Image();
    img.onload = () => { if (typeof requestDraw === "function") requestDraw(); };
    img.src = src;
    mapImageCache.set(src, img);
  }
  return mapImageCache.get(src);
}

function drawPngMapIcon(ctx, src, x, y, size) {
  if (!src) return false;
  const img = getMapImage(src);
  if (!img.complete || !img.naturalWidth) return false;

  const R = size / 2;
  const pH = R * 0.75;
  const cx = x;
  const cy = y - R - pH;
  const halfAngle = Math.PI / 5;

  ctx.save();

  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI / 2 + halfAngle, Math.PI / 2 - halfAngle, false);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = Math.max(1, size * 0.055);
  ctx.stroke();

  const iconSize = R * 1.3;
  ctx.drawImage(img, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);

  ctx.restore();
  return true;
}

function draw() {
  state.animationFrame = null;
  if (typeof prepareCanvasForDraw === "function") prepareCanvasForDraw();
  const ctx = els.canvas.getContext("2d");
  const width = els.canvas.width;
  const height = els.canvas.height;
  const animatedEmojiScale = updateAnimatedEmojiScale();
  const nearbyIconLookup = buildNearbyIconLookup();
  ctx.clearRect(0, 0, width, height);
  drawBase(ctx, width, height);

  if (!state.bounds) {
    drawLoading(ctx);
    return;
  }

  for (const layer of state.layers) drawLayer(ctx, layer);
  drawCowPastures(ctx);
  drawEnvironment(ctx);
  drawRoads(ctx);
  drawPaths(ctx);
  drawWalkingRadius(ctx);
  drawOverviewRoutes(ctx);
  drawSelectedRoute(ctx);
  const useOverlayForPins = typeof nearbyHeadingUpActive === "function" && nearbyHeadingUpActive();
  if (!useOverlayForPins) {
    drawTrees(ctx, nearbyIconLookup);
    drawLandmarks(ctx, nearbyIconLookup);
    drawCows(ctx, nearbyIconLookup);
  }
  drawSelectedRoadOverlay(ctx);
  drawSelectedPathOverlay(ctx);
  drawOverlay();

  if (Math.abs(animatedEmojiScale.target - animatedEmojiScale.value) > 0.001) {
    requestDraw();
  }

  if (state.selected && ["road", "path"].includes(state.selected.type)) {
    requestDraw();
  }
}

function drawOverlay() {
  const canvas = els.overlayCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.bounds) return;
  const useOverlayForPins = typeof nearbyHeadingUpActive === "function" && nearbyHeadingUpActive();
  const toScreen = typeof worldToScreenForOverlay === "function" ? worldToScreenForOverlay : worldToScreen;
  if (useOverlayForPins) {
    const nearbyIconLookup = buildNearbyIconLookup();
    drawTrees(ctx, nearbyIconLookup, toScreen);
    drawLandmarks(ctx, nearbyIconLookup, toScreen);
    drawCows(ctx, nearbyIconLookup, toScreen);
  }
  drawUser(ctx);
  drawSelectedOverlay(ctx, toScreen);
}

function drawCowPastures(ctx) {
  if (!state.cowPastures.length) return;
  const dpr = pixelRatio();
  ctx.save();
  ctx.fillStyle = "rgba(154, 106, 47, 0.10)";
  ctx.strokeStyle = "rgba(154, 106, 47, 0.35)";
  ctx.lineWidth = 1.3 * dpr;

  for (const pasture of state.cowPastures) {
    const polygons = pasture.geometry.type === "Polygon"
      ? [pasture.geometry.coordinates]
      : pasture.geometry.coordinates;
    for (const polygon of polygons) {
      ctx.beginPath();
      for (const ring of polygon) {
        ring.forEach(([longitude, latitude], index) => {
          const point = worldToScreen(projectLonLat(longitude, latitude));
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
      }
      ctx.fill("evenodd");
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawPaths(ctx) {
  if (!state.paths.length) return;

  const dpr = pixelRatio();
  const zoomLevel = Math.max(0, Math.log2(state.viewport.scale / state.fitScale));
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const baseWidth = clamp(1.35 + zoomLevel * 0.18, 1.35, isCoarsePointer ? 2.5 : 2.2) * dpr;
  const namedLabels = [];
  const worldTopLeft = screenToWorld(0, 0);
  const worldBottomRight = screenToWorld(els.canvas.width, els.canvas.height);
  const minWorldX = Math.min(worldTopLeft.x, worldBottomRight.x);
  const maxWorldX = Math.max(worldTopLeft.x, worldBottomRight.x);
  const minWorldY = Math.min(worldTopLeft.y, worldBottomRight.y);
  const maxWorldY = Math.max(worldTopLeft.y, worldBottomRight.y);
  const margin = (maxWorldX - minWorldX) * 0.05;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const path of state.paths) {
    if (path.bbox) {
      if (path.bbox.maxX < minWorldX - margin || path.bbox.minX > maxWorldX + margin) continue;
      if (path.bbox.maxY < minWorldY - margin || path.bbox.minY > maxWorldY + margin) continue;
    }

    const pathColor = path.pathType === "bridleway"
      ? "rgba(113, 77, 35, 0.9)"
      : path.pathType === "byway"
        ? "rgba(72, 61, 139, 0.92)"
        : path.pathType === "permissive"
          ? "rgba(57, 90, 138, 0.88)"
          : path.pathType === "waymarked_trail"
            ? "rgba(109, 68, 140, 0.9)"
            : "rgba(41, 82, 59, 0.86)";
    const dash = path.pathType === "bridleway"
      ? [7 * dpr, 4.5 * dpr]
      : path.pathType === "byway"
        ? [2 * dpr, 3 * dpr]
        : path.pathType === "permissive"
          ? [4 * dpr, 3 * dpr]
          : path.pathType === "waymarked_trail"
            ? [9 * dpr, 5 * dpr]
            : [];

    for (const segment of path.segments) {
      if (!segment || segment.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < segment.length; i += 1) {
        const screenPoint = worldToScreen(segment[i]);
        if (i === 0) ctx.moveTo(screenPoint.x, screenPoint.y);
        else ctx.lineTo(screenPoint.x, screenPoint.y);
      }

      ctx.setLineDash(dash);
      ctx.lineWidth = baseWidth + 1.9 * dpr;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
      ctx.stroke();

      ctx.lineWidth = baseWidth;
      ctx.strokeStyle = pathColor;
      ctx.stroke();
    }

    if (path.name && zoomLevel >= (isCoarsePointer ? 1.45 : 1.15)) {
      const anchor = pathLabelAnchor(path);
      if (anchor) namedLabels.push({ path, anchor, score: path.totalLength || 0 });
    }
  }

  if (namedLabels.length) {
    namedLabels.sort((a, b) => b.score - a.score);
    const limitedLabels = namedLabels.slice(0, isCoarsePointer ? 24 : 42);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(isCoarsePointer ? 9 : 10, Math.round((isCoarsePointer ? 9 : 10) * dpr))}px system-ui`;
    for (const item of limitedLabels) {
      const point = worldToScreen(item.anchor);
      if (!isNearCanvas(point, 28 * dpr)) continue;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.lineWidth = 3 * dpr;
      ctx.strokeText(item.path.name, point.x, point.y);
      ctx.fillStyle = "rgba(45, 59, 52, 0.95)";
      ctx.fillText(item.path.name, point.x, point.y);
    }
  }

  ctx.restore();
}

function drawRoads(ctx) {
  if (!state.roads.length) return;

  const dpr = pixelRatio();
  const zoomLevel = Math.max(0, Math.log2(state.viewport.scale / state.fitScale));

  if (zoomLevel < -0.5) return;

  const worldTopLeft = screenToWorld(0, 0);
  const worldBottomRight = screenToWorld(els.canvas.width, els.canvas.height);
  const minWorldX = Math.min(worldTopLeft.x, worldBottomRight.x);
  const maxWorldX = Math.max(worldTopLeft.x, worldBottomRight.x);
  const minWorldY = Math.min(worldTopLeft.y, worldBottomRight.y);
  const maxWorldY = Math.max(worldTopLeft.y, worldBottomRight.y);
  const margin = (maxWorldX - minWorldX) * 0.05;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const road of state.roads) {
    if (road.bbox) {
      if (road.bbox.maxX < minWorldX - margin || road.bbox.minX > maxWorldX + margin) continue;
      if (road.bbox.maxY < minWorldY - margin || road.bbox.minY > maxWorldY + margin) continue;
    }

    let roadColor, roadWidth;
    switch (road.roadType) {
      case "motorway":
        roadColor = "rgba(229, 105, 82, 0.75)";
        roadWidth = clamp(3.5 + zoomLevel * 0.35, 2.5, 5) * dpr;
        break;
      case "trunk":
        roadColor = "rgba(245, 161, 80, 0.7)";
        roadWidth = clamp(3 + zoomLevel * 0.3, 2, 4.5) * dpr;
        break;
      case "primary":
        roadColor = "rgba(252, 214, 112, 0.65)";
        roadWidth = clamp(2.5 + zoomLevel * 0.25, 1.8, 4) * dpr;
        break;
      case "secondary":
        roadColor = "rgba(244, 250, 191, 0.6)";
        roadWidth = clamp(2 + zoomLevel * 0.2, 1.5, 3.5) * dpr;
        break;
      case "tertiary":
        roadColor = "rgba(255, 255, 255, 0.55)";
        roadWidth = clamp(1.8 + zoomLevel * 0.18, 1.3, 3) * dpr;
        break;
      case "residential":
        roadColor = "rgba(255, 255, 255, 0.45)";
        roadWidth = clamp(1.5 + zoomLevel * 0.15, 1, 2.5) * dpr;
        break;
      case "service":
        roadColor = "rgba(255, 255, 255, 0.35)";
        roadWidth = clamp(1.2 + zoomLevel * 0.1, 0.8, 2) * dpr;
        break;
      case "alley":
        roadColor = "rgba(255, 255, 255, 0.25)";
        roadWidth = clamp(0.8 + zoomLevel * 0.08, 0.6, 1.5) * dpr;
        break;
      default:
        roadColor = "rgba(255, 255, 255, 0.4)";
        roadWidth = clamp(1.5 + zoomLevel * 0.15, 1, 2.5) * dpr;
    }

    for (const segment of road.segments) {
      if (segment.length < 2) continue;

      ctx.beginPath();
      for (let i = 0; i < segment.length; i += 1) {
        const point = worldToScreen(segment[i]);
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }

      ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
      ctx.lineWidth = roadWidth + (1.5 * dpr);
      ctx.stroke();

      ctx.strokeStyle = roadColor;
      ctx.lineWidth = roadWidth;
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawEnvironment(ctx) {
  if (!state.environmentFeatures.length) return;

  const dpr = pixelRatio();
  const zoomLevel = Math.max(0, Math.log2(state.viewport.scale / state.fitScale));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const feature of state.environmentFeatures) {
    const geometry = feature.geometry || {};
    const type = feature.properties && feature.properties.featureType;

    if (type === "hydrology_area") {
      drawEnvironmentPolygon(ctx, geometry, {
        fill: "rgba(88, 151, 212, 0.22)",
        stroke: "rgba(47, 114, 178, 0.62)",
        width: 1.1 * dpr,
      });
      continue;
    }

    if (type === "nature_designation") {
      drawEnvironmentPolygon(ctx, geometry, {
        fill: "rgba(105, 163, 94, 0.12)",
        stroke: "rgba(72, 130, 65, 0.46)",
        width: 1.1 * dpr,
      });
      continue;
    }

    if (type === "hydrology_line") {
      drawEnvironmentLines(ctx, geometry, {
        stroke: "rgba(47, 114, 178, 0.72)",
        width: 1.5 * dpr,
      });
    }

    if (type === "railway") {
      drawRailwayLines(ctx, geometry, feature.properties, {
        stroke: "rgba(60, 60, 60, 0.85)",
        casing: "rgba(255, 255, 255, 0.45)",
        width: 2.5 * dpr,
        casingWidth: 4.5 * dpr,
      });
    }

    if (type === "building") {
      drawEnvironmentPolygon(ctx, geometry, {
        fill: "rgba(120, 120, 120, 0.15)",
        stroke: "rgba(80, 80, 80, 0.35)",
        width: 0.8 * dpr,
      });
    }

    if (type === "garden") {
      drawEnvironmentPolygon(ctx, geometry, {
        fill: "rgba(120, 175, 90, 0.18)",
        stroke: "rgba(90, 140, 70, 0.45)",
        width: 1.2 * dpr,
      });
    }
  }

  loadBuildingsIfNeeded();
  if (state.buildingFeatures.length) {
    const BUILDINGS_FADE_MS = 1200;
    const fadeAlpha = state.buildingsRevealStartTime
      ? Math.min(1, (performance.now() - state.buildingsRevealStartTime) / BUILDINGS_FADE_MS)
      : 1;

    const worldTopLeft = screenToWorld(0, 0);
    const worldBottomRight = screenToWorld(els.canvas.width, els.canvas.height);
    const wMinX = Math.min(worldTopLeft.x, worldBottomRight.x);
    const wMaxX = Math.max(worldTopLeft.x, worldBottomRight.x);
    const wMinY = Math.min(worldTopLeft.y, worldBottomRight.y);
    const wMaxY = Math.max(worldTopLeft.y, worldBottomRight.y);
    const marginX = (wMaxX - wMinX) * 0.05;
    const marginY = (wMaxY - wMinY) * 0.05;

    ctx.save();
    ctx.globalAlpha = fadeAlpha;
    for (const feature of state.buildingFeatures) {
      const geom = feature.geometry || {};
      const coords = geom.type === "Polygon" ? geom.coordinates
        : geom.type === "MultiPolygon" ? geom.coordinates[0]
        : null;
      if (coords) {
        const ring = coords[0];
        if (ring && ring[0]) {
          const pt = projectLonLat(Number(ring[0][0]), Number(ring[0][1]));
          if (pt.x < wMinX - marginX || pt.x > wMaxX + marginX ||
              pt.y < wMinY - marginY || pt.y > wMaxY + marginY) continue;
        }
      }
      drawEnvironmentPolygon(ctx, geom, {
        fill: "rgba(120, 120, 120, 0.15)",
        stroke: "rgba(80, 80, 80, 0.35)",
        width: 0.8 * dpr,
      });
    }
    ctx.restore();

    if (fadeAlpha < 1) requestDraw();
  }

  ctx.restore();
}

function drawEnvironmentLines(ctx, geometry, style) {
  const segments = lineSegmentsFromGeometry(geometry);
  for (const segment of segments) {
    if (!Array.isArray(segment) || segment.length < 2) continue;
    ctx.beginPath();
    for (let i = 0; i < segment.length; i += 1) {
      const point = worldToScreen(projectLonLat(Number(segment[i][0]), Number(segment[i][1])));
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.width;
    ctx.stroke();
  }
}

function drawEnvironmentPolygon(ctx, geometry, style) {
  const polygons = polygonRingsFromGeometry(geometry);
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    ctx.beginPath();
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      for (let i = 0; i < ring.length; i += 1) {
        const point = worldToScreen(projectLonLat(Number(ring[i][0]), Number(ring[i][1])));
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

function drawRailwayLines(ctx, geometry, properties, style) {
  const segments = lineSegmentsFromGeometry(geometry);
  const railwayType = properties && properties.railway;

  for (const segment of segments) {
    if (!Array.isArray(segment) || segment.length < 2) continue;

    ctx.beginPath();
    for (let i = 0; i < segment.length; i += 1) {
      const point = worldToScreen(projectLonLat(Number(segment[i][0]), Number(segment[i][1])));
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }

    if (style.casing) {
      ctx.strokeStyle = style.casing;
      ctx.lineWidth = style.casingWidth;
      ctx.stroke();
    }

    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.width;
    ctx.stroke();

    if (railwayType === "subway") {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = style.width * 0.6;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawOverviewRoutes(ctx) {
  if (!state.userLocation || state.selected) return;

  const targets = overviewRouteTargets();
  if (!targets.length) return;

  const dpr = pixelRatio();
  const from = worldToScreen(state.userLocation.point);
  const routeLineWidth = 2.2 * dpr;
  const haloLineWidth = routeLineWidth + 2.6 * dpr;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([8 * dpr, 7 * dpr]);

  for (const target of targets) {
    const to = worldToScreen(target.point);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineWidth = haloLineWidth;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.stroke();
    ctx.lineWidth = routeLineWidth;
    ctx.strokeStyle = target.color;
    ctx.stroke();
  }

  ctx.restore();
}

function drawWalkingRadius(ctx) {
  if (!state.userLocation || (state.selected && state.selected.type !== "settings")) return;

  const dpr = pixelRatio();
  const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
  const center = worldToScreen(state.userLocation.point);
  const edgeWorld = projectLonLat(
    state.userLocation.longitude + (radiusMetres / (111320 * Math.cos(state.userLocation.latitude * Math.PI / 180))),
    state.userLocation.latitude
  );
  const edge = worldToScreen(edgeWorld);
  const radiusPx = Math.max(8, Math.hypot(edge.x - center.x, edge.y - center.y));

  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(47, 114, 178, 0.07)";
  ctx.fill();
  ctx.strokeStyle = "rgba(47, 114, 178, 0.45)";
  ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([6 * dpr, 6 * dpr]);
  ctx.stroke();
  ctx.restore();
}

function drawSelectedRoute(ctx) {
  const target = selectedCompassTarget();
  if (!state.userLocation || !target) return;

  const dpr = pixelRatio();
  const from = worldToScreen(state.userLocation.point);
  const to = worldToScreen(target.point);
  const routeLineWidth = 3 * dpr;
  const haloLineWidth = routeLineWidth + 3 * dpr;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.setLineDash([10 * dpr, 8 * dpr]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = haloLineWidth;
  ctx.stroke();
  ctx.strokeStyle = "rgba(179, 79, 49, 0.9)";
  ctx.lineWidth = routeLineWidth;
  ctx.stroke();
  ctx.restore();
}

function overviewRouteTargets() {
  const values = overviewItemsForActiveFilter()
    .filter((entry) => !entry.outOfRadius)
    .map((entry) => ({
      point: entry.item.point,
      color: filterKindColor(entry.kind),
    }));

  const seen = new Set();
  return values.filter((target) => {
    const key = `${target.point.x.toFixed(6)},${target.point.y.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function drawBase(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#edf2e9");
  gradient.addColorStop(1, "#cfdccb");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(42, 64, 55, 0.11)";
  ctx.lineWidth = 1.2 * pixelRatio();

  if (!state.bounds) {
    const gap = 86 * pixelRatio();
    for (let x = -gap; x < width + gap; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + gap * 0.6, height * 0.28, x - gap * 0.25, height * 0.62, x + gap * 0.8, height);
      ctx.stroke();
    }
    for (let y = gap * 0.45; y < height; y += gap) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(width * 0.25, y - gap * 0.55, width * 0.58, y + gap * 0.55, width, y - gap * 0.18);
      ctx.stroke();
    }
    return;
  }

  const worldTopLeft = screenToWorld(0, 0);
  const worldBottomRight = screenToWorld(width, height);
  const minWorldX = Math.min(worldTopLeft.x, worldBottomRight.x);
  const maxWorldX = Math.max(worldTopLeft.x, worldBottomRight.x);
  const minWorldY = Math.min(worldTopLeft.y, worldBottomRight.y);
  const maxWorldY = Math.max(worldTopLeft.y, worldBottomRight.y);

  const worldRangeX = Math.max(0.0001, state.bounds.maxX - state.bounds.minX);
  const worldRangeY = Math.max(0.0001, state.bounds.maxY - state.bounds.minY);
  const worldGap = Math.max(1, Math.min(worldRangeX, worldRangeY) / 11.5);
  const startX = Math.floor((minWorldX - worldGap) / worldGap) * worldGap;
  const endX = maxWorldX + worldGap;
  const startY = Math.floor((minWorldY - worldGap) / worldGap) * worldGap;
  const endY = maxWorldY + worldGap;

  for (let x = startX; x <= endX; x += worldGap) {
    const p0 = worldToScreen({ x, y: minWorldY - worldGap });
    const p1 = worldToScreen({ x: x + worldGap * 0.6, y: minWorldY + (maxWorldY - minWorldY) * 0.28 });
    const p2 = worldToScreen({ x: x - worldGap * 0.25, y: minWorldY + (maxWorldY - minWorldY) * 0.62 });
    const p3 = worldToScreen({ x: x + worldGap * 0.8, y: maxWorldY + worldGap });
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();
  }

  for (let y = startY; y <= endY; y += worldGap) {
    const p0 = worldToScreen({ x: minWorldX - worldGap, y });
    const p1 = worldToScreen({ x: minWorldX + (maxWorldX - minWorldX) * 0.25, y: y - worldGap * 0.55 });
    const p2 = worldToScreen({ x: minWorldX + (maxWorldX - minWorldX) * 0.58, y: y + worldGap * 0.55 });
    const p3 = worldToScreen({ x: maxWorldX + worldGap, y: y - worldGap * 0.18 });
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();
  }
}

function drawLoading(ctx) {
  ctx.fillStyle = "#526158";
  ctx.font = `${24 * pixelRatio()}px system-ui`;
  ctx.fillText("Loading offline map data...", 24 * pixelRatio(), 48 * pixelRatio());
}

function drawLayer(ctx, layer) {
  const style = layer.key === "buffer"
    ? { fill: "rgba(85, 167, 160, 0.24)", stroke: "rgba(20, 110, 105, 0.82)", width: 1.8 }
    : { fill: "rgba(79, 139, 98, 0.29)", stroke: "rgba(21, 96, 56, 0.9)", width: 2.1 };

  ctx.save();
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width * pixelRatio();

  for (const feature of layer.data.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      ctx.beginPath();
      for (const ring of polygon) {
        ring.forEach(([longitude, latitude], index) => {
          const point = worldToScreen(projectLonLat(longitude, latitude));
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
      }
      ctx.fill("evenodd");
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawTrees(ctx, nearbyIconLookup, toScreen) {
  const resolvedToScreen = toScreen || worldToScreen;
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const treeEmojiSize = MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE;
  const emojiCirclePadding = 5.6 * dpr * mapScale * MAP_ICON_SCALE;

  ctx.save();
  for (const tree of state.trees) {
    const point = resolvedToScreen(tree.point);
    if (!isNearCanvas(point, 10 * dpr * MAP_ICON_SCALE)) continue;
    if (!shouldDrawMapIcon("tree", tree, nearbyIconLookup)) continue;
    const isOutOfRadius = nearbyIconLookup.outOfRadius && nearbyIconLookup.outOfRadius.has(tree);
    ctx.globalAlpha = isOutOfRadius ? 0.4 : 1;
    const treeSrc = treeSpeciesIconPath(tree.commonName, tree.latinName) || iconPath("tree");
    drawPngMapIcon(ctx, treeSrc, point.x, point.y, treeEmojiSize);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawTreeMarker(ctx, tree, color, radius, showBorder = false) {
  const point = worldToScreen(tree.point);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (showBorder) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3 * pixelRatio();
    ctx.stroke();
  }
}

function getMarkerPulseOpacity(minOpacity = 0.3, maxOpacity = 0.8) {
  const now = Date.now();
  const cycle = (now % 2000) / 2000;
  const pulse = Math.sin(cycle * Math.PI * 2) * 0.5 + 0.5;
  return minOpacity + (maxOpacity - minOpacity) * pulse;
}

function drawUndergroundRoundel(ctx, x, y, sizePx) {
  const scale = sizePx / 24;
  ctx.save();
  ctx.translate(x - 12 * scale, y - 12 * scale);
  ctx.scale(scale, scale);

  ctx.fillStyle = "#C9181E";
  const path = new Path2D("M12 2.25a9.73 9.73 0 0 0-9.49 7.5H0v4.5h2.51a9.73 9.73 0 0 0 9.49 7.5c4.62 0 8.48-3.2 9.49-7.5H24v-4.5h-2.51A9.73 9.73 0 0 0 12 2.25zM12 6c2.5 0 4.66 1.56 5.56 3.75H6.44A6.02 6.02 0 0 1 12 6zm-5.56 8.25h11.12A6.02 6.02 0 0 1 12 18a6.02 6.02 0 0 1-5.56-3.75Z");
  ctx.fill(path);

  ctx.restore();
}

function drawNationalRailLogo(ctx, x, y, sizePx) {
  const scale = sizePx / 24;
  ctx.save();
  ctx.translate(x - 12 * scale, y - 12 * scale);
  ctx.scale(scale, scale);

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(12, 12, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#C9181E";
  const path = new Path2D("M0 12C0 5.373 5.372 0 12 0c6.627 0 11.999 5.373 11.999 12 0 6.628-5.372 12-11.999 12-6.628 0-12-5.372-12-12Zm6.195-5.842 6.076 2.794H2.835v1.884h9.499l-4.616 2.246H2.835v1.868h4.883l5.778 2.795h4.333l-6.092-2.795h9.469v-1.868h-9.453l4.616-2.246h4.837V8.952h-4.868l-5.777-2.794H6.195");
  ctx.fill(path);

  ctx.restore();
}

function drawMapEmoji(ctx, emoji, x, y, sizePx, options = {}) {
  const {
    backgroundColor = null,
    borderColor = null,
    borderWidth = 0,
    paddingPx = 0,
    yOffsetPx = 0,
  } = options;
  ctx.save();
  if (backgroundColor || borderColor) {
    const radius = Math.max((sizePx * 0.65) + paddingPx, sizePx * 0.65);
    if (backgroundColor) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = backgroundColor;
      ctx.fill();
    }
    if (borderColor) {
      const lineWidth = borderWidth || Math.max(2, sizePx * 0.08);
      const strokeRadius = radius + (lineWidth * 0.5);
      ctx.beginPath();
      ctx.arc(x, y, strokeRadius, 0, Math.PI * 2);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }
  ctx.font = `${sizePx}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#111";
  ctx.shadowColor = "rgba(255, 255, 255, 0.75)";
  ctx.shadowBlur = Math.max(1, sizePx * 0.16);
  ctx.fillText(emoji, x, y + yOffsetPx);
  ctx.restore();
}

function selectedIconScale(minScale = 1.05, maxScale = 1.17, cycleMs = 1200) {
  const now = Date.now();
  const cycle = (now % cycleMs) / cycleMs;
  const pulse = Math.sin(cycle * Math.PI * 2) * 0.5 + 0.5;
  const baseScale = minScale + (maxScale - minScale) * pulse;
  const zoomScale = mapEmojiScale();
  const zoomFactor = 0.7 + (zoomScale * 0.3);
  return baseScale * zoomFactor;
}

function buildNearbyIconLookup() {
  const tree = new Set();
  const landmark = new Set();
  const cow = new Set();
  const outOfRadius = new Set();
  for (const entry of overviewItemsForActiveFilter()) {
    if (!entry || !entry.item) continue;
    if (entry.outOfRadius) {
      outOfRadius.add(entry.item);
      if (!state.showAllOutsideRadius) continue;
    }
    if (entry.type === "tree") tree.add(entry.item);
    else if (entry.type === "landmark") landmark.add(entry.item);
    else if (entry.type === "cow") cow.add(entry.item);
  }
  return { tree, landmark, cow, outOfRadius };
}

function shouldDrawMapIcon(type, item, nearbyIconLookup) {
  if (state.selected && ["tree", "landmark", "cow", "path"].includes(state.selected.type)) return false;
  const typeSet = nearbyIconLookup && nearbyIconLookup[type];
  return Boolean(typeSet && typeSet.has(item));
}

function drawLandmarks(ctx, nearbyIconLookup, toScreen) {
  const resolvedToScreen = toScreen || worldToScreen;
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const emojiBadge = {
    backgroundColor: null,
    borderColor: null,
    borderWidth: 2 * dpr * mapScale * MAP_ICON_SCALE,
    paddingPx: 5.6 * dpr * mapScale * MAP_ICON_SCALE,
  };
  const candidates = state.landmarks;
  ctx.save();
  for (const place of candidates) {
    const point = resolvedToScreen(place.point);
    if (!isNearCanvas(point, 16 * dpr * MAP_ICON_SCALE)) continue;
    const showIcon = shouldDrawMapIcon("landmark", place, nearbyIconLookup);
    const isPub = isPubCategory(place);
    const isCafe = isCafeCategory(place);
    const isTransport = isTransportCategory(place);

    if (!showIcon) {
      continue;
    }

    const isOutOfRadius = nearbyIconLookup.outOfRadius && nearbyIconLookup.outOfRadius.has(place);
    const baseOpacity = markerOpacityFor("landmark", place);
    ctx.globalAlpha = isOutOfRadius ? Math.min(baseOpacity, 0.4) : baseOpacity;

    if (isPub) {
      drawPngMapIcon(ctx, iconPath("beer"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * BEER_ICON_SCALE);
    } else if (isCafe) {
      drawPngMapIcon(ctx, iconPath("cafe"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE);
    } else if (isShopCategory(place)) {
      drawPngMapIcon(ctx, iconPath("shop"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE);
    } else if (isTransport) {
      const transportType = getTransportType(place);

      if (transportType === "underground") {
        drawUndergroundRoundel(ctx, point.x, point.y, 8 * dpr * mapScale * MAP_ICON_SCALE);
      } else if (transportType === "national_rail") {
        drawNationalRailLogo(ctx, point.x, point.y, 8 * dpr * mapScale * MAP_ICON_SCALE);
      } else if (transportType === "parking") {
        drawPngMapIcon(ctx, iconPath("landmark-parking"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE);
      } else {
        drawPngMapIcon(ctx, iconPath("bus"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE);
      }
    } else {
      // Check if there's a PNG icon available for this place's primary filter
      let iconSlug = null;
      for (const filterKey of PLACE_FILTER_PRIORITY) {
        if (matchesPlaceFilter(place, filterKey)) {
          iconSlug = filterKindIconSlug(filterKey);
          break;
        }
      }
      if (!iconSlug) iconSlug = landmarkIconSlug(place);

      if (iconSlug) {
        const path = iconPath(iconSlug);
        if (path) {
          drawPngMapIcon(ctx, path, point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE);
        } else {
          const emoji = landmarkEmoji(place);
          drawMapEmoji(ctx, emoji, point.x, point.y, 22 * dpr * mapScale * MAP_ICON_SCALE, emojiBadge);
        }
      } else {
        const emoji = landmarkEmoji(place);
        drawMapEmoji(ctx, emoji, point.x, point.y, 22 * dpr * mapScale * MAP_ICON_SCALE, emojiBadge);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawCows(ctx, nearbyIconLookup, toScreen) {
  if (!state.cows.length) return;
  const resolvedToScreen = toScreen || worldToScreen;
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();

  ctx.save();
  for (const cow of state.cows) {
    const point = resolvedToScreen(cow.point);
    if (!isNearCanvas(point, 18 * dpr * MAP_ICON_SCALE)) continue;
    const showIcon = shouldDrawMapIcon("cow", cow, nearbyIconLookup);
    if (!showIcon) continue;
    const isOutOfRadius = nearbyIconLookup.outOfRadius && nearbyIconLookup.outOfRadius.has(cow);
    const baseOpacity = markerOpacityFor("cow", cow);
    ctx.globalAlpha = isOutOfRadius ? Math.min(baseOpacity, 0.4) : baseOpacity;
    drawPngMapIcon(ctx, iconPath("cow"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawUser(ctx) {
  if (!state.userLocation || !state.userInMapArea) return;
  const dpr = pixelRatio();
  const point = worldToScreen(state.userLocation.point);
  drawUserRadar(ctx, point, dpr);
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 12 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = "#1f5eff";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 4 * dpr;
  ctx.stroke();
  ctx.fillStyle = "#14211d";
  ctx.font = `800 ${14 * dpr}px system-ui`;
  ctx.fillText("You", point.x + 17 * dpr, point.y + 5 * dpr);
  ctx.restore();
}

function drawSelectedOverlay(ctx, toScreen) {
  if (!state.selected || !state.selected.item) return;
  if (!toScreen) toScreen = worldToScreen;

  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const selectedScale = selectedIconScale();
  const selectedEmojiPadding = 2.94 * dpr * mapScale * MAP_ICON_SCALE;
  const selectedEmojiYOffset = 1.1 * dpr * mapScale * MAP_ICON_SCALE;

  if (state.selected.type === "tree") {
    const point = toScreen(state.selected.item.point);
    if (isNearCanvas(point, 24 * dpr * MAP_ICON_SCALE)) {
      const selectedTree = state.selected.item;
      const selectedTreeSrc = treeSpeciesIconPath(selectedTree.commonName, selectedTree.latinName) || iconPath("tree");
      drawPngMapIcon(ctx, selectedTreeSrc, point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
    }
    return;
  }

  const point = toScreen(state.selected.item.point);
  if (!isNearCanvas(point, 24 * dpr * MAP_ICON_SCALE)) return;

  if (state.selected.type === "cow") {
    drawPngMapIcon(ctx, iconPath("cow"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
  } else if (state.selected.type === "landmark") {
    const selectedPlace = state.selected.item;

    // Check for PNG icon first
    let iconSlug = null;
    for (const filterKey of PLACE_FILTER_PRIORITY) {
      if (matchesPlaceFilter(selectedPlace, filterKey)) {
        iconSlug = filterKindIconSlug(filterKey);
        break;
      }
    }
    if (!iconSlug) iconSlug = landmarkIconSlug(selectedPlace);

    if (iconSlug && iconPath(iconSlug)) {
      // Generic landmark with PNG icon
      drawPngMapIcon(ctx, iconPath(iconSlug), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
    } else if (isPubCategory(selectedPlace)) {
      drawPngMapIcon(ctx, iconPath("beer"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale * BEER_ICON_SCALE);
    } else if (isCafeCategory(selectedPlace)) {
      drawPngMapIcon(ctx, iconPath("cafe"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
    } else if (isShopCategory(selectedPlace)) {
      drawPngMapIcon(ctx, iconPath("shop"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
    } else if (isTransportCategory(selectedPlace)) {
      const transportType = getTransportType(selectedPlace);
      if (transportType === "underground") {
        drawPngMapIcon(ctx, iconPath("underground"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
      } else if (transportType === "national_rail") {
        drawNationalRailLogo(ctx, point.x, point.y, 26 * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
      } else if (transportType === "parking") {
        drawPngMapIcon(ctx, iconPath("landmark-parking"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
      } else {
        drawPngMapIcon(ctx, iconPath("bus"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
      }
    } else {
      // Fall back to emoji rendering
      const emoji = landmarkEmoji(selectedPlace);
      if (emoji === "📍") {
        ctx.save();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 7.6 * dpr * MAP_ICON_SCALE * selectedScale, 0, Math.PI * 2);
        ctx.fillStyle = "#76702f";
        ctx.fill();
        ctx.restore();
      } else {
        drawMapEmoji(ctx, emoji, point.x, point.y, 24 * dpr * mapScale * MAP_ICON_SCALE * selectedScale, {
          backgroundColor: null,
          borderColor: null,
          borderWidth: 2.5 * dpr * mapScale * MAP_ICON_SCALE,
          paddingPx: selectedEmojiPadding,
          yOffsetPx: selectedEmojiYOffset,
        });
      }
    }
  }
}

function drawSelectedRoadOverlay(ctx) {
  if (!state.selected || state.selected.type !== "road" || !state.selected.item) return;

  const road = state.selected.item;
  const dpr = pixelRatio();
  const zoomLevel = Math.max(0, Math.log2(state.viewport.scale / state.fitScale));

  let highlightWidth;
  switch (road.roadType) {
    case "motorway":
      highlightWidth = clamp(4 + zoomLevel * 0.4, 3, 6) * dpr;
      break;
    case "trunk":
      highlightWidth = clamp(3.5 + zoomLevel * 0.35, 2.5, 5.5) * dpr;
      break;
    case "primary":
      highlightWidth = clamp(3 + zoomLevel * 0.3, 2.3, 5) * dpr;
      break;
    default:
      highlightWidth = clamp(2.5 + zoomLevel * 0.25, 2, 4.5) * dpr;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const segment of road.segments) {
    if (segment.length < 2) continue;

    ctx.beginPath();
    for (let i = 0; i < segment.length; i += 1) {
      const point = worldToScreen(segment[i]);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }

    const now = Date.now();
    const pulse = (Math.sin(now / 400) * 0.5 + 0.5);
    const alpha = 0.5 + pulse * 0.3;

    ctx.strokeStyle = `rgba(31, 94, 255, ${alpha})`;
    ctx.lineWidth = highlightWidth;
    ctx.stroke();
  }

  ctx.restore();
}

function drawSelectedPathOverlay(ctx) {
  if (!state.selected || state.selected.type !== "path" || !state.selected.item) return;

  const path = state.selected.item;
  const dpr = pixelRatio();
  const zoomLevel = Math.max(0, Math.log2(state.viewport.scale / state.fitScale));
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

  const baseWidth = clamp(1.35 + zoomLevel * 0.18, 1.35, isCoarsePointer ? 2.5 : 2.2) * dpr;
  const highlightWidth = baseWidth * 3.5 + 2 * dpr;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const segment of path.segments) {
    if (segment.length < 2) continue;

    ctx.beginPath();
    for (let i = 0; i < segment.length; i += 1) {
      const point = worldToScreen(segment[i]);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }

    const now = Date.now();
    const pulse = (Math.sin(now / 350) * 0.5 + 0.5);
    const alpha = 0.6 + pulse * 0.4;

    ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.lineWidth = highlightWidth;
    ctx.stroke();
  }

  ctx.restore();
}

function zoomEmojiScaleTarget() {
  const baselineScale = state.baseFitScale > 0 ? state.baseFitScale : state.fitScale;
  const zoomRatio = baselineScale > 0 ? state.viewport.scale / baselineScale : 1;
  return clamp(Math.pow(Math.max(0.0001, zoomRatio), 0.35), 0.45, 1.15);
}

function updateAnimatedEmojiScale() {
  const target = zoomEmojiScaleTarget();
  const current = Number.isFinite(state.emojiScaleAnimated) ? state.emojiScaleAnimated : target;
  const next = current + (target - current) * 0.22;
  const snapped = Math.abs(target - next) < 0.001 ? target : next;
  state.emojiScaleAnimated = snapped;
  return { value: snapped, target };
}

function mapEmojiScale() {
  return Number.isFinite(state.emojiScaleAnimated) ? state.emojiScaleAnimated : zoomEmojiScaleTarget();
}

function destinationPointMetres(latitude, longitude, bearingDegrees, metres) {
  const earthRadiusMetres = 6371008.8;
  const angularDistance = metres / earthRadiusMetres;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(latitude);
  const lon1 = toRadians(longitude);
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAngular = Math.sin(angularDistance);
  const cosAngular = Math.cos(angularDistance);

  const lat2 = Math.asin((sinLat1 * cosAngular) + (cosLat1 * sinAngular * Math.cos(bearing)));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * sinAngular * cosLat1,
    cosAngular - sinLat1 * Math.sin(lat2)
  );

  return {
    latitude: lat2 * 180 / Math.PI,
    longitude: lon2 * 180 / Math.PI,
  };
}

function radarRadiusForMetres(point, metres) {
  if (!state.userLocation || !Number.isFinite(state.compassHeading)) return 0;
  const destination = destinationPointMetres(
    state.userLocation.latitude,
    state.userLocation.longitude,
    normalizeDegrees(state.compassHeading),
    metres
  );
  const destinationScreen = worldToScreen(projectLonLat(destination.longitude, destination.latitude));
  return Math.hypot(destinationScreen.x - point.x, destinationScreen.y - point.y);
}

function drawUserRadar(ctx, point, dpr) {
  if (!Number.isFinite(state.compassHeading)) return;

  const headingRad = typeof headingUpActive === "function" && headingUpActive()
    ? toRadians(-90)
    : toRadians(normalizeDegrees(state.compassHeading) - 90);
  const spread = toRadians(26);
  const outerRadius = Math.max(0.5, radarRadiusForMetres(point, 60));
  const innerRadius = Math.max(0.2, outerRadius * 0.28);

  ctx.save();

  const radarGradient = ctx.createRadialGradient(point.x, point.y, innerRadius * 0.2, point.x, point.y, outerRadius);
  radarGradient.addColorStop(0, "rgba(31, 94, 255, 0.30)");
  radarGradient.addColorStop(1, "rgba(31, 94, 255, 0.02)");

  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.arc(point.x, point.y, outerRadius, headingRad - spread, headingRad + spread);
  ctx.closePath();
  ctx.fillStyle = radarGradient;
  ctx.fill();

  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = "rgba(31, 94, 255, 0.55)";
  for (const ratio of [0.4, 0.7, 1]) {
    const radius = outerRadius * ratio;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, headingRad - spread, headingRad + spread);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(point.x + Math.cos(headingRad) * outerRadius, point.y + Math.sin(headingRad) * outerRadius);
  ctx.lineWidth = 2.6 * dpr;
  ctx.strokeStyle = "rgba(31, 94, 255, 0.82)";
  ctx.stroke();

  ctx.restore();
}
