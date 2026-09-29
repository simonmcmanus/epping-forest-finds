const MAP_ICON_SCALE = 2;
const MAP_ICON_SCALE_UNSELECTED = 2.2;
const MAP_PNG_ICON_SIZE = 30;
// The 30 CSS-px clustering radius below was tuned against the original 16px icon size; scale
// it with MAP_PNG_ICON_SIZE so bigger pins merge into a count badge sooner instead of just
// overlapping each other when a lot of them fall close together.
const CLUSTER_RADIUS_ICON_SIZE_REF = 16;
const BEER_ICON_SCALE = 1.15;
const MAX_MAP_TREES = 60;
const SELECTED_OVERLAY_PULSE_PERIOD_MS = 380;  // Shared pulse period for smooth animation
const LANDMARK_CULL_MARGIN_PX = 24;  // Consistent culling margin for all landmark types

const mapImageCache = new Map();

// Animation state for smooth pulsing without Date.now() jitter
let _animationStartTime = null;

// Tracks the previous tilt state so drawOverlay can detect transitions and trigger
// a full canvas redraw when tilt activates/deactivates. Without this, the compass
// tick calls only drawOverlay (not draw()), leaving the main-canvas radar stale.
let _overlayWasTilted = false;

// The selected road/path overlay pulses (see drawSelectedRoadOverlay/drawSelectedPathOverlay)
// via a sine wave with a ~350-400ms period, so redrawing at full display refresh rate (up to
// 120Hz) wastes CPU/GPU for no visible benefit. Throttle re-draws to a fixed interval instead.
const SELECTED_PULSE_REDRAW_INTERVAL_MS = 50;
let _selectedPulseTimer = null;

function getMapImage(src) {
  if (!mapImageCache.has(src)) {
    const img = new Image();
    img.onload = () => { if (typeof requestDraw === "function") requestDraw(); };
    img.onerror = () => { mapImageCache.delete(src); if (typeof requestDraw === "function") requestDraw(); };
    img.src = src;
    mapImageCache.set(src, img);
  }
  return mapImageCache.get(src);
}

// The white pointer every map pin sits in: a circular head with a wedge
// drawn down to the place's own point. Returns the head's centre and radius
// so the caller can put artwork or a glyph inside it.
//
// Artwork is drawn at 1.85x the head radius, so anything reaching past
// 1/1.85 of its own half-width pokes out of the pointer. The generator
// (scripts/generate-map-icons.js) holds new icons well inside that via
// FIT_LIMIT (scripts/lib/icon-fit.js), which is independent of this
// multiplier, so raising it here is safe without touching icon assets.
function drawMapPinShape(ctx, x, y, size) {
  const R = size * 0.4;
  const pH = R * 0.6;
  const cx = x;
  const cy = y - R - pH;
  const halfAngle = Math.PI / 5;

  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI / 2 + halfAngle, Math.PI / 2 - halfAngle, false);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.stroke();

  return { cx, cy, R };
}

function drawPngMapIcon(ctx, src, x, y, size) {
  if (!src) return false;
  const img = getMapImage(src);
  if (!img.complete || !img.naturalWidth) return false;

  ctx.save();
  const { cx, cy, R } = drawMapPinShape(ctx, x, y, size);
  const iconSize = R * 1.85;
  ctx.drawImage(img, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
  ctx.restore();
  return true;
}

// The fallback for a place with no artwork of its own. It gets the same
// pointer with the emoji glyph where the icon would go, so every marker on
// the map reads as one pin family rather than a glyph floating on its own.
function drawEmojiMapPin(ctx, emoji, x, y, size) {
  // landmarkEmoji() returns an <img> for the categories that do have artwork;
  // those never reach here, but a glyph is the only thing that can be drawn.
  const glyph = typeof emoji === "string" && emoji && !emoji.startsWith("<") ? emoji : "📍";

  if (typeof visibleCanvasRect === "function") {
    const canvasRect = visibleCanvasRect();
    const margin = size + 10;
    if (x < canvasRect.x - margin || x > canvasRect.x + canvasRect.width + margin ||
        y < canvasRect.y - margin || y > canvasRect.y + canvasRect.height + margin) {
      return false;
    }
  }

  ctx.save();
  const { cx, cy, R } = drawMapPinShape(ctx, x, y, size);

  // The generic glyph is itself a map pin, and a pin inside a pin reads as a
  // mistake. A place the data says nothing about gets a plain dot instead.
  if (glyph === "📍") {
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = "#76702f";
    ctx.fill();
    ctx.restore();
    return true;
  }

  ctx.font = `${R * 1.2}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#111";
  try {
    ctx.fillText(glyph, cx, cy);
  } catch (e) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = "#ccc";
    ctx.fill();
  }
  ctx.restore();
  return true;
}

// Get smooth pulsing value for selected overlay animations (0-1, smooth sine wave)
// Uses elapsed time from animation start rather than Date.now() to avoid jitter
function getSelectedOverlayPulse() {
  if (_animationStartTime === null) _animationStartTime = performance.now();
  const elapsed = performance.now() - _animationStartTime;
  const cyclePosition = (elapsed % SELECTED_OVERLAY_PULSE_PERIOD_MS) / SELECTED_OVERLAY_PULSE_PERIOD_MS;
  return Math.sin(cyclePosition * Math.PI * 2) * 0.5 + 0.5;
}

function draw() {
  // Cancel any *other* frame already queued, rather than only clearing the flag. requestDraw's
  // guard (index.html) assumes a queued draw stays queued until it runs, but a direct draw()
  // call -- there are several, from boot, the location gate and the compass loop -- clears the
  // flag while an rAF draw is still pending, so the next requestDraw() queues a second one for
  // the same frame. Every draw ends by requesting the next (prepareCanvasForDraw does it for as
  // long as a browse-origin slide is running), so each duplicate re-queues itself and the map is
  // painted two, three, four times per frame from then on -- measured at four full repaints per
  // frame, around 100ms of redundant work, which ran the slide at roughly 6fps and made the
  // camera move in visible steps instead of gliding. Cancelling here collapses any pile-up back
  // to one paint per frame; a draw that is already running is repainting the current state
  // anyway, so whatever it displaces would have drawn exactly the same thing.
  if (state.animationFrame != null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(state.animationFrame);
  }
  state.animationFrame = null;
  // The frame asked for in requestDraw() has now run: stop the wedge watchdog counting
  // against it (see recoverWedgedAnimationFrames, js/app.js).
  state.animationFrameRequestedAt = null;
  // Initialize animation timing on first draw
  if (_animationStartTime === null) _animationStartTime = performance.now();

  // A device-orientation event with a valid beta but no valid heading updates
  // state.tiltBetaTarget without calling startCompassSmoothing (see onDeviceOrientation),
  // so the beta-smoothing loop can go idle out of sync with its target. draw() already runs
  // on most state changes, so nudge the loop back on here whenever that happens.
  if (Number.isFinite(state.compassHeading) && typeof startCompassSmoothing === "function"
      && Math.abs(state.tiltBetaTarget - state.tiltBetaSmoothed) > 0.05) {
    startCompassSmoothing();
  }
  if (typeof prepareCanvasForDraw === "function") prepareCanvasForDraw();
  const ctx = els.canvas.getContext("2d");
  const width = els.canvas.width;
  const height = els.canvas.height;
  const animatedEmojiScale = updateAnimatedEmojiScale();
  const nearbyIconLookup = activeIconLookup();
  const treeClusters = buildTypeClusters(nearbyIconLookup.tree, worldToScreen);
  const landmarkClusters = buildLandmarkClusters(nearbyIconLookup.landmark, worldToScreen);
  const cowClusters = buildTypeClusters(nearbyIconLookup.cow, worldToScreen);
  const pathClusters = buildTypeClusters(nearbyIconLookup.path, worldToScreen);
  const waterClusters = buildTypeClusters(nearbyIconLookup.water, worldToScreen);
  // Expanding a cluster narrows nearbyIconLookup (buildNearbyIconLookup, above) down to that
  // group's own items and nothing else -- but it deliberately does *not* force every one of them
  // into its own singleton pin any more. A tap that zoomed into, say, 100 items piled at one spot
  // used to unconditionally flatten all 100 into individual pins regardless of how much screen
  // space the zoom actually bought them, which was just as dense and just as hard to use as the
  // pile-up it replaced. Re-running the ordinary clustering passes on the narrowed set instead
  // lets it re-cluster naturally at the new zoom: items that spread apart on screen become
  // individual pins, items still close together become a smaller sub-cluster (mega or
  // same-category) the user can tap into again, one level deeper, the same way they got here.
  const megaGroups = buildSuperClusters([
    { itemType: "tree", clusters: treeClusters },
    { itemType: "landmark", clusters: landmarkClusters },
    { itemType: "cow", clusters: cowClusters },
    { itemType: "path", clusters: pathClusters },
    { itemType: "water", clusters: waterClusters },
  ]).filter(group => group.length >= megaClusterMinMembersFor(group));
  const megaClusterSet = new Set();
  for (const group of megaGroups) for (const member of group) megaClusterSet.add(member.cluster);
  const filteredTreeClusters = treeClusters.filter(c => !megaClusterSet.has(c));
  const filteredLandmarkClusters = landmarkClusters.filter(c => !megaClusterSet.has(c));
  const filteredCowClusters = cowClusters.filter(c => !megaClusterSet.has(c));
  const filteredPathClusters = pathClusters.filter(c => !megaClusterSet.has(c));
  const filteredWaterClusters = waterClusters.filter(c => !megaClusterSet.has(c));
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
  drawSelectedRoute(ctx);
  drawUserRadarMainCanvas(ctx);
  const useOverlayForPins = (typeof nearbyHeadingUpActive === "function" && nearbyHeadingUpActive())
    || (typeof tiltActive === "function" && tiltActive());
  if (!useOverlayForPins) {
    drawTrees(ctx, nearbyIconLookup, undefined, filteredTreeClusters);
    drawLandmarks(ctx, nearbyIconLookup, undefined, filteredLandmarkClusters);
    drawCows(ctx, nearbyIconLookup, undefined, filteredCowClusters);
    drawPathPins(ctx, nearbyIconLookup, undefined, filteredPathClusters);
    drawWaterPins(ctx, nearbyIconLookup, undefined, filteredWaterClusters);
    drawMegaClusters(ctx, megaGroups);
  }
  drawSelectedRoadOverlay(ctx);
  drawSelectedPathOverlay(ctx);
  drawTiltDistanceFade(ctx, width, height);
  drawOverlay();

  if (Math.abs(animatedEmojiScale.target - animatedEmojiScale.value) > 0.001) {
    requestDraw();
  }

  if (state.selected && ["road", "path"].includes(state.selected.type)) {
    clearTimeout(_selectedPulseTimer);
    _selectedPulseTimer = setTimeout(requestDraw, SELECTED_PULSE_REDRAW_INTERVAL_MS);
  }

  if (typeof postDraw === "function") postDraw();
}

function drawOverlay() {
  const canvas = els.overlayCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.bounds) return;
  const isTilted = typeof tiltActive === "function" && tiltActive();
  const useOverlayForPins = (typeof nearbyHeadingUpActive === "function" && nearbyHeadingUpActive())
    || isTilted;
  // When tilt mode changes, the compass tick calls only drawOverlay (not draw()), so
  // the main-canvas radar from the previous state is stale. Force a full redraw to
  // synchronise both canvases without introducing a radar gap.
  if (isTilted !== _overlayWasTilted) {
    _overlayWasTilted = isTilted;
    if (typeof requestDraw === "function") requestDraw();
  }
  const toScreen = isTilted && typeof worldToScreenForOverlayTilted === "function"
    ? worldToScreenForOverlayTilted
    : (typeof worldToScreenForOverlay === "function" ? worldToScreenForOverlay : worldToScreen);
  if (isTilted) drawUserRadarOverlayTilted(ctx);
  if (useOverlayForPins) {
    drawAllPinsSorted(ctx, activeIconLookup(), toScreen);
  }
  drawUser(ctx, toScreen, isTilted);
  drawNearbyAnchorMarker(ctx, toScreen);
  drawSelectedOverlay(ctx, toScreen);
}

// Marks state.nearbyAnchor (the Nearby view's browse point, set by tapping open ground -- see
// nearbyOrigin/focusNearbyOnMapPoint) distinctly from the real "You" dot drawn just above, so
// it's clear the radius/list have pivoted away from the user's actual GPS position without
// moving it.
function drawNearbyAnchorMarker(ctx, toScreen) {
  if (!state.nearbyAnchor) return;
  if (!toScreen) toScreen = worldToScreen;
  // Rides the slide with the circle it sits at the centre of, rather than jumping to the new
  // anchor a frame before the circle gets there.
  const point = toScreen(nearbyRenderOriginPoint() || state.nearbyAnchor.point);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const dpr = pixelRatio();
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 6 * dpr, 0, Math.PI * 2);
  ctx.strokeStyle = "#c9660c";
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = "#c9660c";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();
  ctx.restore();
}

// Flat-mode footprint/roof colour. 3D building extrusion (walls in tilt mode) was
// removed entirely for performance (see project notes) -- this constant remains
// because the always-on flat 2D footprint layer below still uses it.
const BUILDING_FILL_RGB = [152, 152, 152];
const BUILDING_FILL = `rgb(${BUILDING_FILL_RGB[0]}, ${BUILDING_FILL_RGB[1]}, ${BUILDING_FILL_RGB[2]})`;
// Building footprints never set an outline of their own, so for as long as the map has had them
// they were stroked with whatever style the last environment feature left on the context -- a
// garden's, since gardens come last in local-environment.geojson. That is the look every screenshot
// baseline records. Culling off-screen features changes which feature draws last, so the outline
// is now stated rather than inherited.
const BUILDING_OUTLINE = "rgba(90, 140, 70, 0.45)";
const BUILDING_OUTLINE_WIDTH = 1.2;

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

// Traces a polyline into the current path, skipping any points behind the user's heading
// in full 3D (tilt) mode — breaking into a fresh moveTo whenever the line re-enters the
// ahead half so a road/path that dips behind and back doesn't get an incorrect connecting
// stroke across the hidden gap. Returns false when nothing ahead was drawn (nothing to stroke).
function traceAheadOnlyPath(ctx, worldPoints) {
  let drawing = false;
  let any = false;
  for (let i = 0; i < worldPoints.length; i += 1) {
    const worldPoint = worldPoints[i];
    if (isBehindTiltHeading(worldPoint)) { drawing = false; continue; }
    const screenPoint = worldToScreen(worldPoint);
    if (!drawing) { ctx.moveTo(screenPoint.x, screenPoint.y); drawing = true; }
    else ctx.lineTo(screenPoint.x, screenPoint.y);
    any = true;
  }
  return any;
}

// Traces a polyline into the current path without tilt-based heading filtering.
// Used for roads and paths which should remain visible even when behind the user's
// heading direction in tilt mode (unlike terrain/sky which is culled). Returns false
// when no points were drawn (nothing to stroke).
function traceAllPath(ctx, worldPoints) {
  let any = false;
  for (let i = 0; i < worldPoints.length; i += 1) {
    const worldPoint = worldPoints[i];
    const screenPoint = worldToScreen(worldPoint);
    if (i === 0) ctx.moveTo(screenPoint.x, screenPoint.y);
    else ctx.lineTo(screenPoint.x, screenPoint.y);
    any = true;
  }
  return any;
}

function drawPaths(ctx) {
  if (!state.paths.length) return;

  const dpr = pixelRatio();
  const zoomLevel = Math.max(0, Math.log2(state.viewport.scale / state.fitScale));
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const baseWidth = clamp(1.35 + zoomLevel * 0.18, 1.35, isCoarsePointer ? 2.5 : 2.2) * dpr;
  const namedLabels = [];
  const w = els.canvas.width, h = els.canvas.height;
  const corners = [screenToWorld(0, 0), screenToWorld(w, 0), screenToWorld(0, h), screenToWorld(w, h)];
  const minWorldX = Math.min(...corners.map(c => c.x));
  const maxWorldX = Math.max(...corners.map(c => c.x));
  const minWorldY = Math.min(...corners.map(c => c.y));
  const maxWorldY = Math.max(...corners.map(c => c.y));
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
      if (!traceAllPath(ctx, segment)) continue;

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
      if (isBehindTiltHeading(item.anchor)) continue;
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

  const w = els.canvas.width, h = els.canvas.height;
  const corners = [screenToWorld(0, 0), screenToWorld(w, 0), screenToWorld(0, h), screenToWorld(w, h)];
  const minWorldX = Math.min(...corners.map(c => c.x));
  const maxWorldX = Math.max(...corners.map(c => c.x));
  const minWorldY = Math.min(...corners.map(c => c.y));
  const maxWorldY = Math.max(...corners.map(c => c.y));
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
      if (!traceAllPath(ctx, segment)) continue;

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
  const view = environmentViewWorldBounds();
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const feature of state.environmentFeatures) {
    const geometry = feature.geometry || {};
    const type = feature.properties && feature.properties.featureType;
    if (!environmentGeometryInView(geometry, view)) continue;

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
        fill: BUILDING_FILL,
        stroke: BUILDING_OUTLINE,
        width: BUILDING_OUTLINE_WIDTH * dpr,
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

    ctx.save();
    ctx.globalAlpha = fadeAlpha;
    for (const feature of state.buildingFeatures) {
      const geom = feature.geometry || {};
      // Whole-footprint bbox rather than the first vertex alone: never culls a building that
      // pokes into view, and reads a cached bbox instead of re-projecting ~20k vertices a frame.
      if (!environmentGeometryInView(geom, view)) continue;
      drawEnvironmentPolygon(ctx, geom, {
        fill: BUILDING_FILL,
        stroke: BUILDING_OUTLINE,
        width: BUILDING_OUTLINE_WIDTH * dpr,
      });
    }
    ctx.restore();

    if (fadeAlpha < 1) requestDraw();
  }

  ctx.restore();
}

// The environment layer is ~130k vertices (gardens, water, railways) plus ~130k more in
// buildings. It used to run projectLonLat -- a log and a tan -- on every one of them on every
// frame, and draw every feature whether or not it was on screen: around 70 ms a frame on a
// desktop CPU, several hundred on a phone, which is most of what a pan, zoom or compass tick
// cost. The lon/lat -> world projection never changes, so it is done once per geometry and
// kept alongside the geometry's world-space bbox; each frame then only runs worldToScreen for
// features whose bbox overlaps the view. Output is pixel-identical: the same world points go
// through the same worldToScreen, and a feature whose bbox misses the (5%-padded) view cannot
// put a pixel on the canvas.
const _projectedEnvironmentGeometry = new WeakMap();

function projectedEnvironmentGeometry(geometry) {
  let cached = _projectedEnvironmentGeometry.get(geometry);
  if (cached) return cached;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  // Flat [x0, y0, x1, y1, ...] typed arrays rather than {x, y} objects: a quarter of a million
  // points is several megabytes less heap this way, which matters on the phones this is for.
  const projectLine = (line) => {
    const coordinates = Array.isArray(line) ? line : [];
    const flat = new Float64Array(coordinates.length * 2);
    for (let i = 0; i < coordinates.length; i += 1) {
      const point = projectLonLat(Number(coordinates[i][0]), Number(coordinates[i][1]));
      flat[i * 2] = point.x;
      flat[i * 2 + 1] = point.y;
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    return flat;
  };
  cached = {
    polygons: polygonRingsFromGeometry(geometry).map((polygon) => (Array.isArray(polygon) ? polygon : []).map(projectLine)),
    segments: lineSegmentsFromGeometry(geometry).map(projectLine),
    minX, maxX, minY, maxY,
  };
  _projectedEnvironmentGeometry.set(geometry, cached);
  return cached;
}

// World-space bounds of the whole canvas bitmap (overscan included), padded 5% -- the same
// corner test drawPaths already culls with, including under tilt, where screenToWorld clamps to
// the far clip. Null when the corners do not unproject to finite points: then nothing is culled.
function environmentViewWorldBounds() {
  const w = els.canvas.width, h = els.canvas.height;
  const corners = [screenToWorld(0, 0), screenToWorld(w, 0), screenToWorld(0, h), screenToWorld(w, h)];
  if (!corners.every((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y))) return null;
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  const marginX = (maxX - minX) * 0.05;
  const marginY = (maxY - minY) * 0.05;
  return { minX: minX - marginX, maxX: maxX + marginX, minY: minY - marginY, maxY: maxY + marginY };
}

// worldToScreen reads x/y and never keeps its argument, so one scratch point serves every vertex.
const _environmentScratchPoint = { x: 0, y: 0 };
function environmentVertexToScreen(flat, index) {
  _environmentScratchPoint.x = flat[index * 2];
  _environmentScratchPoint.y = flat[index * 2 + 1];
  return worldToScreen(_environmentScratchPoint);
}

function environmentGeometryInView(geometry, view) {
  if (!view) return true;
  const g = projectedEnvironmentGeometry(geometry);
  return !(g.maxX < view.minX || g.minX > view.maxX || g.maxY < view.minY || g.minY > view.maxY);
}

function drawEnvironmentLines(ctx, geometry, style) {
  const segments = projectedEnvironmentGeometry(geometry).segments;
  for (const segment of segments) {
    const count = segment.length / 2;
    if (count < 2) continue;
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const point = environmentVertexToScreen(segment, i);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    if (style.stroke && style.width > 0) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.width;
      ctx.stroke();
    }
  }
}

function drawEnvironmentPolygon(ctx, geometry, style) {
  const polygons = projectedEnvironmentGeometry(geometry).polygons;
  for (const polygon of polygons) {
    if (!polygon.length) continue;
    ctx.beginPath();
    for (const ring of polygon) {
      const count = ring.length / 2;
      if (count < 3) continue;
      for (let i = 0; i < count; i += 1) {
        const point = environmentVertexToScreen(ring, i);
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
  const segments = projectedEnvironmentGeometry(geometry).segments;
  const railwayType = properties && properties.railway;

  for (const segment of segments) {
    const count = segment.length / 2;
    if (count < 2) continue;

    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const point = environmentVertexToScreen(segment, i);
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

// Traces a circle that lies on the ground plane, so it foreshortens with the terrain
// instead of staying a screen-space circle. ctx.arc() takes a single scalar radius and so
// can only ever draw a true circle; under tilt that reads as a ring standing up out of the
// map rather than painted on it, and it looks identical at every tilt angle. Sampling the
// circle flat and projecting each point is the same treatment the tilted radar cone gets.
function traceGroundCirclePath(ctx, centerFlat, radiusFlatPx) {
  // Enough segments that the polygon reads as a smooth curve at any radius, without
  // walking hundreds of points for a small ring.
  const steps = Math.max(48, Math.min(160, Math.round(radiusFlatPx / 4)));
  for (let i = 0; i <= steps; i += 1) {
    const angle = (Math.PI * 2 * i) / steps;
    const point = tiltProjectScreenPoint({
      x: centerFlat.x + radiusFlatPx * Math.cos(angle),
      y: centerFlat.y + radiusFlatPx * Math.sin(angle),
    });
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

// Three tiers of one wash, so the Nearby view reads as a single picture rather than a set of
// unrelated markers: the walkable circle is left completely clear, everything outside it is
// dimmed, and -- while the user is browsing a spot they are standing away from -- the cone
// between them and the circle sits between the two at a fraction of the dim. The circle's
// clearness is the point (a filled-in circle used to read as *less* important than the map
// around it), and giving the cone its own shade rather than clearing it too keeps the circle
// the brightest thing on screen while still tying the "You" dot to it.
const WALKING_RADIUS_DIM = "rgba(18, 28, 23, 0.4)";
const NEARBY_CONE_DIM = "rgba(18, 28, 23, 0.13)";

// Inside the radius stays completely untouched ("clear"). No separate boundary line is drawn
// (it read as broken against the soft flat-mode edge and didn't match the hard tilted-mode
// edge) -- flat and tilted share one implementation: fill everywhere except the radius shape
// and the cone (evenodd, using the same ground-projected polygon path under tilt that the rest
// of this file uses for the same reason -- a plain radial gradient can't represent that
// foreshortened ellipse), then blur the whole fill so the edge itself is the only soft
// transition, in both modes alike. featherPx is deliberately half the original flat-only
// gradient's feather size.
function drawWalkingRadiusDimming(ctx, center, radiusPx, tilted, dpr, cone) {
  const featherPx = Math.max(7 * dpr, radiusPx * 0.06);
  ctx.save();
  ctx.filter = `blur(${featherPx}px)`;

  // The cone first and on its own, so it carries its own lighter shade instead of the dim. It
  // never overlaps the circle (its far edge *is* the circle's near arc), so the two cutouts
  // below can't fight each other.
  if (cone) {
    ctx.beginPath();
    traceNearbyUserConePath(ctx, cone);
    ctx.fillStyle = NEARBY_CONE_DIM;
    ctx.fill();
  }

  ctx.beginPath();
  // The outer rect extends well past the canvas edges so the blur softens only the cutouts --
  // if it matched the canvas bounds exactly, the blur would also fade the wash out near the
  // screen edges instead of staying solidly dark there.
  const margin = featherPx * 3;
  ctx.rect(-margin, -margin, els.canvas.width + margin * 2, els.canvas.height + margin * 2);
  if (tilted) traceGroundCirclePath(ctx, center, radiusPx);
  else ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.closePath();
  if (cone) traceNearbyUserConePath(ctx, cone);
  ctx.fillStyle = WALKING_RADIUS_DIM;
  ctx.fill("evenodd");
  ctx.restore();
}

// A faint top-left-lit rim on the *inside* of the clear circle's edge -- same light direction as
// megaSphereGradient's badge shading, so a mega badge zooming in to become this circle
// (focusNearbyOnClusterGroup, js/nav.js) reads as the same lit dome growing, not a flat gold
// coin dissolving into a flat gap. Stroked, not filled: the circle's interior must stay fully
// clear so the map underneath is untouched, exactly as the surrounding comment on
// drawWalkingRadiusDimming requires.
const NEARBY_RIM_HIGHLIGHT = "rgba(255, 250, 235, 0.55)";
const NEARBY_RIM_SHADOW = "rgba(20, 30, 24, 0.16)";

function drawWalkingRadiusRimHighlight(ctx, center, radiusPx, tilted, dpr) {
  const lineWidth = Math.max(1.5 * dpr, radiusPx * 0.012);
  const inset = lineWidth * 1.2;
  ctx.save();
  ctx.beginPath();
  if (tilted) traceGroundCirclePath(ctx, center, radiusPx - inset);
  else ctx.arc(center.x, center.y, radiusPx - inset, 0, Math.PI * 2);
  const gradient = ctx.createLinearGradient(center.x - radiusPx, center.y - radiusPx, center.x + radiusPx, center.y + radiusPx);
  gradient.addColorStop(0, NEARBY_RIM_HIGHLIGHT);
  gradient.addColorStop(0.55, "rgba(255, 250, 235, 0)");
  gradient.addColorStop(1, NEARBY_RIM_SHADOW);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function drawWalkingRadius(ctx) {
  // The *rendered* origin, so the circle stays still on screen while a browse-origin slide moves
  // the map behind it (nearbyRenderOriginPoint, index.html).
  const originPoint = nearbyRenderOriginPoint();
  if (!originPoint) return;
  if (hasRealSelection()) return;

  const dpr = pixelRatio();
  // Centre and radius are measured on the flat (untilted) map, then projected as a whole —
  // measuring them post-projection would fold the perspective in twice.
  const center = worldToScreenFlat(originPoint);
  const edge = worldToScreenFlat({ x: originPoint.x + walkingRadiusWorldUnits(), y: originPoint.y });
  const radiusPx = Math.max(8, Math.hypot(edge.x - center.x, edge.y - center.y));
  const tilted = typeof tiltActive === "function" && tiltActive();

  drawWalkingRadiusDimming(ctx, center, radiusPx, tilted, dpr, nearbyUserCone(center, radiusPx, tilted));
  drawWalkingRadiusRimHighlight(ctx, center, radiusPx, tilted, dpr);
}

// Screen-space geometry for the wedge that ties the "You" dot to the walking-radius ring while
// the Nearby view is browsing an anchor (see setNearbyAnchor, js/nav.js) the user is standing
// away from. Its two edges are the tangents from the user to the ring, so the wedge opens out to
// land exactly on the circle: at a glance the shape says both which way the nearby circle lies
// and how far off it the user actually is, which two separate dots never did.
//
// Sampled on the flat map and projected point by point (same treatment as traceGroundCirclePath
// above) so it lies on the ground plane with the ring instead of floating over it under tilt.
// Returns null whenever there is no wedge to draw, which is what lets drawWalkingRadiusDimming
// take the result straight from here.
function nearbyUserCone(centerFlat, radiusPx, tilted) {
  if (!state.nearbyAnchor || !state.userLocation || !state.userInMapArea) return null;
  const userFlat = worldToScreenFlat(state.userLocation.point);
  if (!Number.isFinite(userFlat.x) || !Number.isFinite(userFlat.y)) return null;

  const dx = centerFlat.x - userFlat.x;
  const dy = centerFlat.y - userFlat.y;
  const distance = Math.hypot(dx, dy);
  // Inside the ring (or all but touching it) there is no wedge worth drawing -- the "You" dot is
  // already sitting in the circle, saying the same thing more directly. The margin keeps a user
  // hovering right on the edge from flickering a degenerate, near-180deg wedge on and off.
  if (distance <= radiusPx * 1.04) return null;

  // Tangent geometry: the tangent point subtends acos(r/d) at the centre from the centre->user
  // direction, so sweeping +/- that angle about it traces exactly the near face of the circle --
  // which is why the wedge and the circle share an edge instead of overlapping.
  const towardsUser = Math.atan2(-dy, -dx);
  const halfAngle = Math.acos(clamp(radiusPx / distance, 0, 1));
  const project = tilted ? tiltProjectScreenPoint : (point) => point;
  const STEPS = 28;

  const points = [project(userFlat)];
  for (let i = 0; i <= STEPS; i += 1) {
    const angle = towardsUser - halfAngle + (halfAngle * 2 * i) / STEPS;
    points.push(project({
      x: centerFlat.x + radiusPx * Math.cos(angle),
      y: centerFlat.y + radiusPx * Math.sin(angle),
    }));
  }
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  return points;
}

// Adds a nearbyUserCone() result to the current path. Used twice per frame on the same geometry
// -- once to lay down the cone's own shade, once as a cutout in the dimming laid over it -- so
// the two can never disagree about where the cone is.
function traceNearbyUserConePath(ctx, points) {
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

// Minimum ground movement (in real metres) before the selected route line is recomputed. GPS
// watchPosition fires roughly once a second and jitters by a few metres even standing still --
// re-running Dijkstra on every fix would be wasted work and would make the line visibly twitch.
// 20m is small enough that the drawn line still tracks a walking user reasonably promptly.
const SELECTED_ROUTE_RECOMPUTE_MIN_METRES = 20;

// Returns the world-space points to draw for the "walk to the selected target" line: the actual
// road/path route when the routing graph is ready and a route can be found, or a plain 2-point
// straight line otherwise (graph still building, or findRoutePoints couldn't find a sensible
// route -- see js/routing.js). Result is memoized on state.selectedRouteCache, keyed by the
// target's own object identity (stable across frames -- see the `state.selected = {..., item}`
// assignments in js/inspector.js) and invalidated after SELECTED_ROUTE_RECOMPUTE_MIN_METRES of
// user movement, so Dijkstra runs only when the destination or the user's position actually
// changes meaningfully, never once per animation frame.
//
// The selected destination is the only thing that gets a drawn route at all: the ambient dashed
// lines from the user to every nearby match were removed (they crowded the map with a fan of
// dotted lines that nobody had asked to walk), so a route line now always means "this is the
// place you chose".
function selectedRoutePoints(target) {
  const from = state.userLocation.point;
  const to = target.point;
  const straightLine = [from, to];

  ensureRoutingGraph();
  if (!state.routingGraphReady || !state.routingGraph) return straightLine;

  const cache = state.selectedRouteCache;
  const isSameTarget = cache && cache.target === target;
  const movedMetres = isSameTarget
    ? distanceMetres(cache.fromLatitude, cache.fromLongitude, state.userLocation.latitude, state.userLocation.longitude)
    : Infinity;
  // Only the *tail* of the route is memoized -- the junctions between here and the
  // destination. The head is always the live user position, re-read on every call, so the
  // line runs from where the walker is standing now rather than from wherever they were when
  // Dijkstra last ran. Caching the whole point list (as this used to) left the route starting
  // at the spot the journey began and trailing further behind the user with every step, which
  // is what "the route does not update as I walk" was.
  if (isSameTarget && movedMetres < SELECTED_ROUTE_RECOMPUTE_MIN_METRES) return [from, ...cache.tail];

  const routed = findRoutePoints(state.routingGraph, from, to, {
    toLatLon: unprojectPoint,
    distanceMetresFn: distanceMetres,
  });
  // routed already starts at `from`; drop it so the head stays live between recomputes.
  const tail = routed ? routed.slice(1) : [to];
  state.selectedRouteCache = {
    target,
    fromLatitude: state.userLocation.latitude,
    fromLongitude: state.userLocation.longitude,
    tail,
    routed: Boolean(routed),
  };
  return [from, ...tail];
}

// True when the line for `target` is the crows-flight fallback rather than a real road/path
// route -- either because the routing graph is not built yet, or because it was built and no
// walkable route could be found (destination off the network, or only reachable by a detour
// longer than findRoutePoints will accept).
function selectedRouteIsFallback(target) {
  if (!state.routingGraphReady || !state.routingGraph) return true;
  selectedRoutePoints(target);
  const cache = state.selectedRouteCache;
  return !(cache && cache.target === target && cache.routed);
}

// Returns the real path-following distance (metres) for the "walk to the selected target"
// line, matching whatever selectedRoutePoints would draw: the routed road/path length once the
// routing graph is ready and a route was found, or the plain straight-line distance otherwise
// (graph still building, or no route could be found -- see selectedRoutePoints' own fallback).
// Reuses selectedRoutePoints itself (not a separately-read cache) so the displayed distance/walk
// time chip can never disagree with the drawn line, and so it benefits from the same movement-
// threshold memoization -- calling this is not itself a source of extra Dijkstra runs.
function selectedRouteMetres(target) {
  if (!state.userLocation || !target || !target.point) return null;
  const points = selectedRoutePoints(target);
  if (!points || points.length < 2) return null;
  let metres = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = unprojectPoint(points[i - 1]);
    const b = unprojectPoint(points[i]);
    metres += distanceMetres(a.latitude, a.longitude, b.latitude, b.longitude);
  }
  return metres;
}

// The straight line is a fallback, not a placeholder. While the routing graph is still
// building there is no way to tell yet whether a real walking route exists, so nothing is
// drawn -- a crow-flies line that flicks over to a winding route a second later reads as the
// app changing its mind, and points the walker the wrong way in the meantime. Once the graph
// is ready the fallback is meaningful ("we looked, there is no route") and does get drawn.
function drawSelectedRoute(ctx) {
  const target = selectedCompassTarget();
  if (!state.userLocation || !target) return;
  if (!state.routingGraphReady) return;

  const dpr = pixelRatio();
  const points = selectedRoutePoints(target).map(worldToScreen);
  const routeLineWidth = 3 * dpr;
  const haloLineWidth = routeLineWidth + 3 * dpr;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.setLineDash([10 * dpr, 8 * dpr]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = haloLineWidth;
  ctx.stroke();
  ctx.strokeStyle = "rgba(179, 79, 49, 0.9)";
  ctx.lineWidth = routeLineWidth;
  ctx.stroke();
  ctx.restore();
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

// Atmospheric haze over the last stretch of ground before the horizon, plus a clean sky
// above it. This used to be a blanket erase of the top 38% of the canvas, masking the fact
// that a CSS-rotated bitmap ran out of pixels short of the horizon — it hid real map, and
// with an oversized canvas it erased a band that wasn't even on screen. The ground now
// reaches the true horizon, so the fade is anchored to that horizon and only ever softens
// genuinely distant ground.
function drawTiltDistanceFade(ctx, width, height) {
  if (typeof tiltActive !== "function" || !tiltActive()) return;
  const horizonY = typeof tiltHorizonCanvasY === "function" ? tiltHorizonCanvasY() : null;
  if (horizonY == null) return;

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";

  // Above the horizon is sky by definition — nothing belongs there.
  if (horizonY > 0) {
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    ctx.fillRect(0, 0, width, Math.min(horizonY, height));
  }

  const fadeTop = Math.max(0, horizonY);
  const fadeBottom = Math.min(height, horizonY + height * 0.28);
  if (fadeBottom > fadeTop) {
    const gradient = ctx.createLinearGradient(0, horizonY, 0, horizonY + height * 0.28);
    gradient.addColorStop(0,    "rgba(0, 0, 0, 1)");
    gradient.addColorStop(0.45, "rgba(0, 0, 0, 0.5)");
    gradient.addColorStop(1,    "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, fadeTop, width, fadeBottom - fadeTop);
  }

  ctx.restore();
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

  // Same cached projection as the environment layer (projectedEnvironmentGeometry): the forest
  // boundary is detailed enough that re-projecting it every frame was the single largest piece
  // of script time in a pan.
  const view = environmentViewWorldBounds();
  for (const feature of layer.data.features) {
    const geometry = feature.geometry;
    if (!geometry || !environmentGeometryInView(geometry, view)) continue;
    for (const polygon of projectedEnvironmentGeometry(geometry).polygons) {
      ctx.beginPath();
      for (const ring of polygon) {
        const count = ring.length / 2;
        for (let index = 0; index < count; index += 1) {
          const point = environmentVertexToScreen(ring, index);
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        }
      }
      ctx.fill("evenodd");
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Buckets points into cells the size of the clustering radius, so a neighbour search only has to
// look at the 3x3 block of cells around a point instead of every other point on the map. A cell
// edge equal to the radius guarantees that: two points within `radius` of each other can never be
// more than one cell apart on either axis, so the 3x3 block never misses a real neighbour. This is
// what turns clustering from an all-pairs O(n^2) scan into one bounded by how many points actually
// land near each other -- the difference that matters once a fully zoomed-out view puts every item
// in the forest on screen (and therefore "eligible") at once, redone on every animation frame of a
// pan or zoom.
function buildScreenPointGrid(points, cellSize, screenPointOf) {
  const grid = new Map();
  for (const point of points) {
    const { x, y } = screenPointOf(point);
    const key = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(point);
  }
  return grid;
}

function forEachNearbyGridPoint(grid, cellSize, screenPointOf, origin, visit) {
  const cx = Math.floor(origin.x / cellSize);
  const cy = Math.floor(origin.y / cellSize);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${cx + dx},${cy + dy}`);
      if (!bucket) continue;
      for (const point of bucket) visit(point);
    }
  }
}

function buildTypeClusters(itemSet, toScreen) {
  const dpr = pixelRatio();
  const clusterRadius = 30 * dpr * (MAP_PNG_ICON_SIZE / CLUSTER_RADIUS_ICON_SIZE_REF);
  const assigned = new Set();
  const clusters = [];

  const eligible = [];
  for (const item of (itemSet || [])) {
    if (!item.point) continue;
    eligible.push({ item, sp: toScreen(item.point), idx: eligible.length });
  }
  if (!eligible.length) return clusters;

  const grid = buildScreenPointGrid(eligible, clusterRadius, (p) => p.sp);

  for (const first of eligible) {
    if (assigned.has(first.item)) continue;
    const members = [];
    forEachNearbyGridPoint(grid, clusterRadius, (p) => p.sp, first.sp, (other) => {
      if (assigned.has(other.item)) return;
      if (Math.hypot(first.sp.x - other.sp.x, first.sp.y - other.sp.y) < clusterRadius) {
        members.push(other);
      }
    });
    // The grid visits its 9 cells in a fixed order, not the original eligible-array order that
    // the old all-pairs scan produced (and that cluster.items[0] consumers -- see
    // megaClusterMemberIconSrc/megaClusterDisplayKey -- rely on for a stable representative
    // item). Restoring that order is one cheap sort over a small member list.
    members.sort((a, b) => a.idx - b.idx);
    for (const m of members) assigned.add(m.item);
    const sx = members.reduce((s, m) => s + m.sp.x, 0) / members.length;
    const sy = members.reduce((s, m) => s + m.sp.y, 0) / members.length;
    const wx = members.reduce((s, m) => s + m.item.point.x, 0) / members.length;
    const wy = members.reduce((s, m) => s + m.item.point.y, 0) / members.length;
    clusters.push({ items: members.map(m => m.item), screenPt: { x: sx, y: sy }, worldPt: { x: wx, y: wy } });
  }

  return clusters;
}

function landmarkClusterKey(place) {
  if (isPubCategory(place)) return "pub";
  if (isCafeCategory(place)) return "cafe";
  if (isShopCategory(place)) return "shop";
  if (isTransportCategory(place)) return `transport_${getTransportType(place) || "bus"}`;
  // Cluster by the pin a place would draw, so two things that look the same
  // group together and two that do not never share one pin.
  return placeIconSlug(place) || "pin";
}

function buildLandmarkClusters(landmarkSet, toScreen) {
  const byKey = new Map();
  for (const lm of (landmarkSet || [])) {
    if (!lm.point) continue;
    const key = landmarkClusterKey(lm);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(lm);
  }
  const clusters = [];
  for (const group of byKey.values()) {
    clusters.push(...buildTypeClusters(group, toScreen));
  }
  return clusters;
}

// Individual per-type clustering (buildTypeClusters/buildLandmarkClusters) only merges pins of
// the same kind, so at a low zoom level -- lots of different categories sharing one patch of
// forest -- their badges still pile on top of each other: a dozen overlapping white teardrops
// with no way to tell what's underneath. This second pass runs across every category's
// already-built clusters and merges any that are still screen-close into one cross-category
// "mega cluster", drawn as a single badge (see drawMegaClusters) instead of N overlapping pins.
// Reuses the same radius buildTypeClusters uses, since that's the distance already tuned to
// avoid icon overlap -- anything still closer than that once every category is on the table is
// exactly the overlap this exists to fix.
// Deliberately tighter than buildTypeClusters' own 30 CSS-px radius: that spacing already keeps
// same-category badges from overlapping, so two *different* categories placed that far apart
// are just neighbours, not the pile-up mega clustering exists to fix. Merging them there anyway
// made mega badges appear far more readily than the density actually warranted; going too far
// the other way (16px, tried briefly) left it barely merging anything, back to overlapping
// individual pins with no group affordance to tap. 22px sits between the two.
const MEGA_CLUSTER_MERGE_RADIUS_CSS_PX = 22;

// A mega badge replaces genuinely crowded ground, not just two neighbours sharing a spot -- but
// requiring three (tried briefly) left plenty of two-category overlaps as bare stacked pins with
// no way to tap "both of these", which is exactly the confusing case mega clustering exists to
// fix. Two is the right floor away from the user: buildSuperClusters' merge result is left as
// individual pins only below that.
const MEGA_CLUSTER_MIN_MEMBERS = 2;

// Close to the user -- inside the distance a 5-minute walk covers -- is exactly where the extra
// tap a mega badge costs matters most: it's the ground being actively navigated, where seeing
// each pin without opening anything is the point. A merge that would happily declutter the far
// side of the walking radius reads as unhelpful right next to "You", collapsing detail the
// walker is standing in. Requiring more piled-up categories there means a badge only replaces
// individual pins nearby when it's genuinely necessary, not merely possible.
const MEGA_CLUSTER_MIN_MEMBERS_NEAR_USER = 4;

// Picks MEGA_CLUSTER_MIN_MEMBERS or the stricter *_NEAR_USER floor for one candidate group,
// based on how far its own spot is from nearbyOrigin() (GPS fix or browse anchor, matching the
// walking-radius ring itself). Falls back to the ordinary floor with no origin to measure from.
function megaClusterMinMembersFor(group) {
  const origin = typeof nearbyOrigin === "function" ? nearbyOrigin() : null;
  if (!origin) return MEGA_CLUSTER_MIN_MEMBERS;
  const repr = group[0].cluster;
  const lonLat = unprojectPoint(repr.worldPt);
  const metres = distanceMetres(origin.latitude, origin.longitude, lonLat.latitude, lonLat.longitude);
  return metres <= walkingDistanceToMetres(5) ? MEGA_CLUSTER_MIN_MEMBERS_NEAR_USER : MEGA_CLUSTER_MIN_MEMBERS;
}

function buildSuperClusters(taggedGroups) {
  const dpr = pixelRatio();
  const radius = MEGA_CLUSTER_MERGE_RADIUS_CSS_PX * dpr * (MAP_PNG_ICON_SIZE / CLUSTER_RADIUS_ICON_SIZE_REF);
  const nodes = [];
  for (const { itemType, clusters } of taggedGroups) {
    for (const cluster of clusters) nodes.push({ itemType, cluster, idx: nodes.length });
  }
  if (!nodes.length) return [];
  const grid = buildScreenPointGrid(nodes, radius, (n) => n.cluster.screenPt);
  const assigned = new Set();
  const superClusters = [];
  for (const first of nodes) {
    if (assigned.has(first)) continue;
    const members = [first];
    assigned.add(first);
    // BFS so a chain of nearby clusters (A close to B, B close to C) merges into one region
    // even when A and C themselves are too far apart to merge directly.
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const found = [];
      forEachNearbyGridPoint(grid, radius, (n) => n.cluster.screenPt, m.cluster.screenPt, (other) => {
        if (assigned.has(other)) return;
        if (Math.hypot(m.cluster.screenPt.x - other.cluster.screenPt.x, m.cluster.screenPt.y - other.cluster.screenPt.y) < radius) {
          found.push(other);
        }
      });
      // Same order restoration as buildTypeClusters -- a grid scan of the 9 nearby cells doesn't
      // come out in the original nodes-array order that consumers keying off first-occurrence
      // (the byTypeIconSrc/byDisplayKey maps in drawMegaClusters) depend on.
      found.sort((a, b) => a.idx - b.idx);
      for (const other of found) {
        members.push(other);
        assigned.add(other);
      }
    }
    superClusters.push(members);
  }
  return superClusters;
}

// Smaller than the badge's real on-screen reach (megaClusterOuterRadius) on purpose: this is
// just the solid centre circle holding the count, with the outer disc and the chip ring around
// it (see drawMegaBadge) doing the rest of the footprint.
function megaClusterRadius(totalItems, dpr) {
  return clamp(12 * dpr + Math.sqrt(totalItems) * 2 * dpr, 15 * dpr, 26 * dpr);
}

// The icon chip radius drawMegaBadge places around the rim -- pulled out so the hit-test in
// findClusterHit (js/inspector.js) and the off-screen cull below can agree on the badge's true
// on-screen extent, chips included, rather than just its centre circle. Bigger, and a higher
// floor, than the inner circle's own ratio would suggest: with R shrunk down to make room for
// the outer disc, a chip sized purely off R read as squashed -- too little room for the icon
// inside it to read clearly -- so this is sized mostly off its own floor rather than scaling
// all the way down with R.
function megaClusterChipRadius(R, dpr) {
  return Math.max(11.5 * dpr, R * 0.52);
}

// The badge caps at this many chips (largest group first) -- past this the ring reads as noise
// rather than a tally of what's here.
const MEGA_CLUSTER_MAX_CHIPS = 5;

// The angle between adjacent chips, not the arc's total width -- so the gap (and so the amount
// of overlap) between any two neighbouring chips stays the same small amount regardless of how
// many chips there are, rather than shrinking (and the overlap growing) as more get packed into
// a fixed-width arc. Tuned against megaClusterChipRadius so two adjacent chips overlap by
// roughly 15-20% of their own width -- enough to read as "these belong together" without one
// covering the other's icon.
const MEGA_CLUSTER_CHIP_ANGLE_STEP_RADIANS = 0.95;

// Extra angle added on top of the bare "just touching" angle between two neighbouring chips
// (see noOverlapStep below), so chips read as separate items with a bit of breathing room
// rather than sitting edge-to-edge.
const MEGA_CLUSTER_CHIP_GAP_RADIANS = 0.22;

// The ring (distance from the badge's centre) chips sit on -- shared by drawMegaBadge's layout
// and megaClusterOuterRadius below so neither can drift out of sync with the other. Chips belong
// in the outer disc's own band, not straddling into the inner circle: at R + half a chip's width
// (tried first) a chip's inner edge landed *inside* R, so the icon visibly crossed from the outer
// disc into the inner circle instead of sitting inside the outer one. Pushing the ring out to
// R + a whole chip's width keeps a chip's inner edge right at the inner circle's own rim --
// touching it, not overlapping it -- so the whole chip sits in the outer disc's band.
function megaClusterChipRingRadius(R, chipR) {
  return R + chipR;
}

// Extra room the outer disc gives the chips beyond their own exact reach (ringR + chipR) --
// without it, a chip sat exactly tangent to the disc's edge, which at a glance read as "bursting
// out of" the disc rather than sitting inside it. This margin is part of the badge's real
// on-screen reach (used below by both the drawn disc and the hit-test/cull radius), not a purely
// cosmetic overdraw, so tapping the badge's outer edge and the badge's visual edge always agree.
const MEGA_CLUSTER_OUTER_DISC_PADDING = 1.06;

// The full on-screen reach of a mega badge, centre circle plus the chip ring around its rim (and
// the padding above) -- i.e. how far out a tap or an off-screen check needs to look, not just
// the centre circle's R.
function megaClusterOuterRadius(totalItems, dpr) {
  const R = megaClusterRadius(totalItems, dpr);
  const chipR = megaClusterChipRadius(R, dpr);
  return (megaClusterChipRingRadius(R, chipR) + chipR) * MEGA_CLUSTER_OUTER_DISC_PADDING;
}

// The same icon each category's own draw function would put in its pin -- picked from the
// cluster's first item exactly the way drawTrees/drawLandmarks/drawPathPins/drawWaterPins/
// drawCows do -- so a mega badge's ring shows the *actual* glyph for what's inside, not just a
// colour standing in for it. Anything with no PNG of its own (the underground/rail SVG marks)
// falls back to the generic pin icon.
function megaClusterMemberIconSrc(itemType, cluster) {
  const repr = cluster.items[0];
  switch (itemType) {
    case "tree":
      return (typeof treeSpeciesIconPath === "function" && treeSpeciesIconPath(repr.commonName, repr.latinName)) || iconPath("tree");
    case "cow":
      return iconPath("cow");
    case "path":
      return iconPath("waymarked");
    case "water":
      return iconPath("ponds");
    case "landmark": {
      if (isPubCategory(repr)) return iconPath("beer");
      if (isCafeCategory(repr)) return iconPath("cafe");
      if (isShopCategory(repr)) return iconPath("shop");
      if (isTransportCategory(repr)) {
        const transportType = getTransportType(repr);
        if (transportType === "parking") return iconPath("landmark-parking");
        if (transportType === "underground" || transportType === "national_rail") return iconPath("pin");
        return iconPath("bus");
      }
      const slug = placeIconSlug(repr);
      return (slug && iconPath(slug)) || iconPath("pin");
    }
    default:
      return iconPath("pin");
  }
}

// Landmarks are one itemType ("landmark") covering many visually distinct pins -- pub, cafe,
// shop, a dozen monument/history sub-kinds -- already told apart by landmarkClusterKey when
// buildLandmarkClusters groups them in the first place. Bucketing a mega badge's chips by the
// coarse itemType alone collapsed every one of those sub-kinds into a single "landmark" bucket,
// showing only whichever cluster happened to be processed first -- a badge piled with a pub, a
// bench and a monument read as holding just one thing. This is the finer key the chip grouping
// actually needs; every other type is already homogeneous enough that itemType alone is fine.
function megaClusterDisplayKey(itemType, cluster) {
  if (itemType !== "landmark") return itemType;
  return `landmark:${landmarkClusterKey(cluster.items[0])}`;
}

// One category's icon, cropped to a circle, sitting directly on the badge underneath it -- no
// white disc of its own any more. Each map icon already carries its own coloured circular
// background baked into the artwork (the same icon appModule/appIconHtml use everywhere else),
// so a white backing behind it here was a second, redundant background rather than something
// the icon needed to read clearly -- just one more layer in an already layered badge. The
// circular clip stays: it is what keeps a square icon image from spilling past chipR at its
// corners, not what gives it a background. Draws nothing (leans on getMapImage's own redraw
// once loaded) if the icon image hasn't finished loading yet.
function drawMegaClusterIconChip(ctx, x, y, src, chipR) {
  const img = src ? getMapImage(src) : null;
  if (!(img && img.complete && img.naturalWidth)) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, chipR * 0.9, 0, Math.PI * 2);
  ctx.clip();
  const iconSize = chipR * 2.15;
  ctx.drawImage(img, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
  ctx.restore();
}

// Drawn as one badge with the total count in the middle and a small ring of icon chips around
// the rim -- one per distinct category present, largest group first, capped at 6 -- so tapping
// isn't the only way to tell *what* is grouped here, only *how many* of each.
// The gold the app's own home-screen icon (assets/home/favicon.png) uses behind its oak leaf --
// reused here instead of a flat colour so the inner count circle/pin reads as "part of this
// app's identity", not an unrelated warning-style marker.
//
// Brighter and darker ends of the same gold, used only as radial-gradient stops (see
// megaSphereGradient) -- never as a flat fill on its own, so the inner circle/pin still reads
// as "the brand gold" at a glance, just domed instead of flat. Kept close either side of the
// brand gold -- a first pass ranged much further apart (a near-white highlight, a near-brown
// shadow) and read as a different, duller colour rather than the same brand gold with shading
// on it; a later, deeper bronze pass with edge strokes and a drop shadow was also tried and
// reverted -- it read as less polished, not more.
const MEGA_CLUSTER_INNER_HIGHLIGHT = "#f8d989";
const MEGA_CLUSTER_INNER_SHADOW = "#dba63f";

// The outer disc's own fill -- a translucent white wash rather than a gold gradient, so it
// reads as a ground-area highlight (the same language the walking-radius ring's clear interior
// already uses) instead of competing with the inner gold circle/pin for "the badge's colour".
const MEGA_CLUSTER_OUTER_DISC_FILL = "rgba(255, 255, 255, 0.4)";

// A top-left-lit radial gradient standing in for each disc's former flat fill, so the badge
// reads as a raised sphere rather than a flat coin -- the same top-lit shading language the
// walking-radius circle's own rim highlight (drawWalkingRadiusRimHighlight, below) uses, so a
// mega badge growing into the walking radius during focusNearbyOnClusterGroup's zoom (js/nav.js)
// looks like one lit surface expanding rather than a flat badge fading into a flat circle.
function megaSphereGradient(ctx, cx, cy, r, highlight, shadow) {
  const lightX = cx - r * 0.32;
  const lightY = cy - r * 0.38;
  const gradient = ctx.createRadialGradient(lightX, lightY, r * 0.05, cx, cy, r * 1.05);
  gradient.addColorStop(0, highlight);
  gradient.addColorStop(1, shadow);
  return gradient;
}

// The count circle drawn as an upright teardrop pin (same construction as drawMapPinShape,
// just gold-filled and holding a number instead of white with an icon) rather than another flat
// disc under tilt. A flat number lying on the foreshortened ground the way the disc does is
// unreadable at any real tilt angle -- exactly what every *other* pin on the map already avoids
// by standing upright off the ground it points at. tipX/tipY is the ground point the pin points
// down at (the badge's own projected centre), matching how a normal pin's pointer lands exactly
// on the spot it marks.
function drawMegaBadgeCountPin(ctx, tipX, tipY, R, totalItems, dpr) {
  const pH = R * 0.6;
  const headY = tipY - R - pH;
  const halfAngle = Math.PI / 5;
  ctx.beginPath();
  ctx.arc(tipX, headY, R, Math.PI / 2 + halfAngle, Math.PI / 2 - halfAngle, false);
  ctx.lineTo(tipX, tipY);
  ctx.closePath();
  ctx.fillStyle = megaSphereGradient(ctx, tipX, headY, R, MEGA_CLUSTER_INNER_HIGHLIGHT, MEGA_CLUSTER_INNER_SHADOW);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = Math.max(1, R * 0.08);
  ctx.stroke();

  const fontSize = Math.round(Math.max(12 * dpr, R * 0.62));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fontSize}px system-ui`;
  ctx.fillStyle = "#3a2c10";
  ctx.fillText(totalItems > 99 ? "99+" : String(totalItems), tipX, headY);
}

// groundCenterFlat is the badge's centre in *flat* (untilted) screen space -- callers already
// have it from worldToScreenFlat(worldPt) -- and is null on the non-tilted flat-map draw path.
// Under tilt (groundCenterFlat set) only the outer disc is ground-painted, traced with
// traceGroundCirclePath -- the same flat-sample-then-`tiltProjectScreenPoint` per-point
// resampling the walking-radius ring and the radar cone already use, rather than a cheaper local
// approximation: the disc sits well off the screen centre for most badges, where an approximation
// derived at just one point drifted visibly out of step with the true ground ellipse as the view
// rotated. The count is drawn afterwards, upright and camera-facing, as its own pointer pin
// (drawMegaBadgeCountPin) anchored at the plain projected `cx`/`cy` -- a flat number lying on the
// foreshortened ground the way the disc does is unreadable at any real tilt angle. The icon chips
// stay camera-facing too but are fanned around that same `cx`/`cy` ground point, sitting on the
// disc, rather than around the pin's own (much higher) head: fanning them around the head instead
// was tried first, on the theory that they should stay visually attached to the one circle you
// can actually read, but that left them floating well clear of the disc they are meant to mark
// the top of -- looking adrift from the badge rather than part of it.
// Outside tilt the whole badge -- both discs, the count, and the chips -- draws exactly as
// before: plain circles and text at cx/cy, no transform, no pointer.
//
// pinScale (default 1) applies only to the upright count pin drawn under tilt, never to the
// disc or the chips: `dpr` alone drives every geometry size below (R, chipR, ringR, outerR),
// matching the plain `pixelRatio()` findClusterHit (js/inspector.js) already hit-tests and
// culls against, so the disc's size depends only on the badge's item count, never on where it
// sits relative to the user's heading. The pointer is the one part of the badge allowed to
// shrink as it swings behind the user (tiltPinScale, the same near-heading collapse every other
// pin already gets) so it stops obscuring pins ahead of it -- the disc itself is an area
// indicator ("this cluster covers roughly this much ground") and has no business changing size
// just because the badge happens to be behind you at the moment.
function drawMegaBadge(ctx, cx, cy, totalItems, byType, byTypeIconSrc, dpr, groundCenterFlat, pinScale = 1) {
  const R = megaClusterRadius(totalItems, dpr);
  const chipR = megaClusterChipRadius(R, dpr);
  const ringR = megaClusterChipRingRadius(R, chipR);
  // MEGA_CLUSTER_OUTER_DISC_PADDING beyond the chips' own exact reach (ringR + chipR) -- without
  // it a chip sat exactly tangent to the disc's edge, which read as bursting out of it rather
  // than sitting inside it. Matches megaClusterOuterRadius exactly, so the hit-test/cull region
  // and the drawn disc never disagree about where the badge's edge actually is.
  const outerR = (ringR + chipR) * MEGA_CLUSTER_OUTER_DISC_PADDING;

  // Translucent white outer disc sized to actually contain the chip ring (outerR, the same
  // reach megaClusterOuterRadius already uses for hit-testing and culling) -- a flat wash
  // rather than the inner circle's gold sphere gradient, so it reads as a ground-area
  // highlight (like the walking-radius ring's own clear interior) rather than a second,
  // competing "raised" surface.
  ctx.beginPath();
  if (groundCenterFlat) traceGroundCirclePath(ctx, groundCenterFlat, outerR);
  else ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fillStyle = MEGA_CLUSTER_OUTER_DISC_FILL;
  ctx.fill();

  // Outside tilt the count still sits as a flat inner circle on top of the outer disc, exactly
  // as before -- only under tilt does it move out to the upright pin drawn below.
  if (!groundCenterFlat) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = megaSphereGradient(ctx, cx, cy, R, MEGA_CLUSTER_INNER_HIGHLIGHT, MEGA_CLUSTER_INNER_SHADOW);
    ctx.fill();

    const fontSize = Math.round(Math.max(12 * dpr, R * 0.62));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fontSize}px system-ui`;
    ctx.fillStyle = "#3a2c10";
    ctx.fillText(totalItems > 99 ? "99+" : String(totalItems), cx, cy);
  } else {
    drawMegaBadgeCountPin(ctx, cx, cy, R * pinScale, totalItems, dpr * pinScale);
  }

  // Icon chips are small artwork, not text -- unlike the count they read fine lying flat on the
  // outer disc when it is ground-projected under tilt -- but the request was for them to stand
  // up and face the camera. They're fanned around `cx`/`cy` -- the disc's own ground anchor, the
  // point the pin's own pointer touches down on -- rather than around the pin's head: an earlier
  // pass tried the head instead, on the theory that chips should stay visually attached to the
  // one circle you can actually read, but that put them floating up near the pin, well clear of
  // the disc they're meant to sit on top of. Anchoring on the ground point instead keeps them
  // sitting on the disc, exactly where the bus/plate/cart icons in a screenshot showed them
  // adrift from it.
  //
  // Chips sit mostly outside the (now much smaller) inner circle, centred on ringR rather than
  // R itself, and reach exactly to outerR, so they land inside the pale outer disc above rather
  // than floating past it.
  const types = Array.from(byType.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, MEGA_CLUSTER_MAX_CHIPS);
  const n = types.length;
  // Position every chip first, then draw largest-group-first last (so it paints on top of its
  // overlapping neighbours) -- the layout is still ordered largest-to-smallest left to right.
  // Centred straight down (PI/2, since y grows downward on canvas), spreading out symmetrically
  // by a fixed angle per chip rather than a fixed total arc -- so the gap between any two
  // neighbours (and so the slight overlap between them) stays the same regardless of how many
  // chips there are, instead of tightening as more get packed into one span.
  //
  // That fixed step is a deliberate *overlap* though -- the right choice once there genuinely
  // isn't room to avoid it, but not when there is: two or three chips on a badge this size have
  // easily enough of the ring to go all the way round without touching. noOverlapStep is the
  // angle at which two neighbouring chips' discs just touch (chord between centres == 2*chipR,
  // solved via the chord/radius/angle relationship); if fitting every chip at that angle still
  // stays within a full turn of the ring, that's used instead of the tighter overlapping step --
  // more chips fan further round from the bottom, with no overlap, rather than crowding closer
  // together. Only once a full turn genuinely isn't enough room does it fall back to the
  // original fixed, intentionally-overlapping step.
  // touchStep alone lands chips exactly tangent to each other -- zero gap, which at a glance
  // read as crowded/overlapping even though no two chips actually overlapped. Adding a fixed
  // angular margin here gives every pair of neighbouring chips visible daylight between them
  // whenever there's room on the ring for it, without touching the tighter fallback step below
  // (still used once a badge has so many chips that even the bare touching angle would run past
  // a full turn).
  const touchStep = ringR > 0 ? 2 * Math.asin(Math.min(1, chipR / ringR)) : MEGA_CLUSTER_CHIP_ANGLE_STEP_RADIANS;
  const noOverlapStep = touchStep + MEGA_CLUSTER_CHIP_GAP_RADIANS;
  const step = noOverlapStep * (n - 1) <= Math.PI * 2 ? noOverlapStep : MEGA_CLUSTER_CHIP_ANGLE_STEP_RADIANS;
  const arcSpan = step * (n - 1);
  // Under tilt, a chip's position (never its own artwork -- that stays a plain undistorted
  // icon) is worked out on the *ground* plane, at the same ringR distance from
  // groundCenterFlat the disc's own points are, and only then projected with
  // tiltProjectScreenPoint -- exactly how the disc's boundary itself is built
  // (traceGroundCirclePath). Offsetting the already-projected `cx`/`cy` by `ringR` in plain
  // screen space (the flat-map approach, reused here first) instead traces a circle in screen
  // space while the disc under it is a foreshortened ellipse, so a chip positioned that way
  // could land outside the ellipse's actual edge even though the same `ringR` comfortably fits
  // inside the disc on the flat map -- exactly the "not sitting on the circle" gap a screenshot
  // showed under real tilt.
  // Under tilt, chips sit noticeably closer in than ringR -- tighter around the disc's own
  // centre rather than out near its rim -- so the whole badge reads as one compact group instead
  // of chips scattered toward the edge of a foreshortened ellipse. The disc itself (outerR) is
  // untouched, so it stays exactly as large as the badge's item count says it should.
  const tiltRingR = ringR * 0.62;
  const positioned = types.map(([key, info], i) => {
    const angle = (Math.PI / 2 - arcSpan / 2) + i * step;
    if (groundCenterFlat) {
      const p = tiltProjectScreenPoint({
        x: groundCenterFlat.x + Math.cos(angle) * tiltRingR,
        y: groundCenterFlat.y + Math.sin(angle) * tiltRingR,
      });
      return { key, info, x: p.x, y: p.y };
    }
    return { key, info, x: cx + Math.cos(angle) * ringR, y: cy + Math.sin(angle) * ringR };
  });
  for (let i = positioned.length - 1; i >= 0; i--) {
    const { key, x, y } = positioned[i];
    drawMegaClusterIconChip(ctx, x, y, byTypeIconSrc.get(key), chipR);
  }
}

function drawMegaClusters(ctx, megaGroups) {
  if (!megaGroups || !megaGroups.length) return;
  const dpr = pixelRatio();
  const reveal = nearbyRevealOpacity();
  ctx.save();
  ctx.globalAlpha = reveal;
  for (const group of megaGroups) {
    let totalItems = 0, sx = 0, sy = 0;
    const byType = new Map();
    const byTypeIconSrc = new Map();
    let allItems = [];
    for (const { itemType, cluster } of group) {
      const n = cluster.items.length;
      totalItems += n;
      sx += cluster.screenPt.x * n;
      sy += cluster.screenPt.y * n;
      allItems = allItems.concat(cluster.items);
      const key = megaClusterDisplayKey(itemType, cluster);
      const existing = byType.get(key);
      byType.set(key, { count: (existing ? existing.count : 0) + n, itemType });
      if (!byTypeIconSrc.has(key)) byTypeIconSrc.set(key, megaClusterMemberIconSrc(itemType, cluster));
    }
    const cx = sx / totalItems;
    const cy = sy / totalItems;
    if (!isNearCanvas({ x: cx, y: cy }, megaClusterOuterRadius(totalItems, dpr) * 2)) continue;
    // The badge's count (and, following from it, its size) reflects what a tap here will
    // actually show in the Nearby list -- clusterFocusTarget/clusterVisibleItemCount (js/nav.js)
    // replicate focusNearbyOnClusterGroup's own centre+radius math exactly, so the two can never
    // disagree. Often larger than totalItems (the raw count buildSuperClusters merged into this
    // one badge): the tap's eventual walking radius commonly reaches past this group's own
    // members into neighbouring ground.
    // Memoized per group (megaBadgeVisibleCount, js/nav.js): six full-dataset scans per badge
    // per frame is what stalled the UI once mega clustering shipped.
    drawMegaBadge(ctx, cx, cy, megaBadgeVisibleCount(allItems), byType, byTypeIconSrc, dpr);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawClusterBadge(ctx, x, y, count, pinSize, dpr) {
  const R = pinSize * 0.4;
  const badgeX = x + R * 0.65;
  const badgeY = y - 2.1 * R;
  const badgeR = Math.max(8 * dpr, R * 0.56);
  const fontSize = Math.round(Math.max(10 * dpr, badgeR * 1.3));

  // Check if badge is within visible canvas bounds
  if (typeof visibleCanvasRect === "function") {
    const canvasRect = visibleCanvasRect();
    if (badgeX - badgeR < canvasRect.x || badgeX + badgeR > canvasRect.x + canvasRect.width ||
        badgeY - badgeR < canvasRect.y || badgeY + badgeR > canvasRect.y + canvasRect.height) {
      return;  // Badge partially off-screen, skip rendering
    }
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = "#2f5a42";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fontSize}px system-ui`;
  ctx.fillStyle = "#fff";
  ctx.fillText(count > 9 ? "9+" : String(count), badgeX, badgeY);
}

function drawTrees(ctx, nearbyIconLookup, toScreen, treeClusters) {
  if (state.selected && ["tree", "landmark", "cow", "path", "water"].includes(state.selected.type)) return;
  const resolvedToScreen = toScreen || worldToScreen;
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const iconSize = MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE_UNSELECTED;
  const clusters = treeClusters || buildTypeClusters(nearbyIconLookup.tree, resolvedToScreen);
  // Sorted ascending by screen Y (painter's algorithm) so a pin lower on
  // screen -- closer to the viewer in this top-down layout -- always paints
  // over one further up, instead of drawing in whatever order clusters
  // happened to be built in.
  const sortedClusters = clusters.slice().sort((a, b) => a.screenPt.y - b.screenPt.y);

  const reveal = nearbyRevealOpacity();
  ctx.save();
  for (const cluster of sortedClusters) {
    const { screenPt, items } = cluster;
    if (!isNearCanvas(screenPt, iconSize * 2)) continue;

    ctx.globalAlpha = reveal;

    const repr = items[0];
    const src = (typeof treeSpeciesIconPath === "function" && treeSpeciesIconPath(repr.commonName, repr.latinName)) || iconPath("tree");
    const drawn = drawPngMapIcon(ctx, src, screenPt.x, screenPt.y, iconSize);
    if (drawn && items.length > 1) drawClusterBadge(ctx, screenPt.x, screenPt.y, items.length, iconSize, dpr);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawTreeMarker(ctx, tree, color, radius, showBorder = false) {
  const point = worldToScreen(tree.point);
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (showBorder) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3 * pixelRatio();
    ctx.stroke();
  }
  ctx.restore();
}

function getMarkerPulseOpacity(minOpacity = 0.3, maxOpacity = 0.8) {
  if (_animationStartTime === null) _animationStartTime = performance.now();
  const elapsed = performance.now() - _animationStartTime;
  const cyclePosition = (elapsed % 2000) / 2000;
  const pulse = Math.sin(cyclePosition * Math.PI * 2) * 0.5 + 0.5;
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

function selectedIconScale(minScale = 1.05, maxScale = 1.17, cycleMs = 1200) {
  if (_animationStartTime === null) _animationStartTime = performance.now();
  const elapsed = performance.now() - _animationStartTime;
  const cyclePosition = (elapsed % cycleMs) / cycleMs;
  const pulse = Math.sin(cyclePosition * Math.PI * 2) * 0.5 + 0.5;
  const baseScale = minScale + (maxScale - minScale) * pulse;
  const zoomScale = mapEmojiScale();
  const zoomFactor = 0.7 + (zoomScale * 0.3);
  return baseScale * zoomFactor;
}

// draw() calls buildNearbyIconLookup() twice per animation frame (once directly, once again
// inside drawUser()). overviewItemsForActiveFilter() now returns every match within the radius
// rather than a truncated handful (see its comment), so re-walking that full list into these
// Sets on every single frame -- even though each pass itself is cheap -- is wasted work the
// moment the radius/origin/filters haven't actually changed since the last frame. Memoized the
// same way, on the same inputs.
let _nearbyIconLookupCache = null;

function nearbyIconLookupCacheKey(reachesPastRing) {
  const origin = typeof nearbyOrigin === "function" ? nearbyOrigin() : state.userLocation;
  if (!origin) return "none";
  // The radius is part of the key on every screen now, Filters/Settings/Report included: their
  // highlighted set is the in-radius one, so a ring resized from any of them has to invalidate
  // this. The old filter-screen key named neither the radius nor the active filters, which is
  // exactly why resizing the ring from those screens left the same pins on the map.
  const scope = reachesPastRing ? "reach" : "ring";
  return `${scope}|${origin.latitude}|${origin.longitude}|${state.walkingDistanceMinutes}|${state.overviewFilters.join(",")}|${state.showAllOutsideRadius}|${state.cowLastUpdatedAt}`;
}

// Mirrors overviewItemsDatasetsUnchanged in index.html: a key built from primitives alone
// can't see state.trees/etc. being reassigned to fresh arrays (only ever happens once, at
// load, in the real app -- but the unit test harness reassigns them between test cases while
// reusing this same running module, so a module-level cache like this one needs the extra
// check too).
function nearbyIconLookupDatasetsUnchanged(cache) {
  return cache.trees === state.trees
    && cache.cows === state.cows
    && cache.landmarks === state.landmarks
    && cache.paths === state.paths
    && cache.waterFeatures === state.waterFeatures;
}

// Picks up to `max` entries evenly spread across a distance-sorted list, by stride, instead
// of just taking the first N. Tree density is high enough that "nearest N" always resolves
// to the same tight cluster around the user regardless of how far the walking radius reaches
// -- widening the radius grew the candidate list but never changed what got drawn. Striding
// across the full sorted range keeps representation from near to far, so a bigger radius
// actually surfaces farther trees instead of only ever the closest cluster.
function sampleSpread(list, max) {
  if (list.length <= max) return list;
  const step = list.length / max;
  const result = [];
  for (let i = 0; i < max; i++) result.push(list[Math.floor(i * step)]);
  return result;
}

// While a group is expanded (state.clusterExpanded, set by tapping a multi-item cluster) the
// map shows that group and nothing else: every other highlighted location from the view the
// user came from is hidden, so it is unambiguous which items the group's list refers to.
// Memoized on the expanded group's own object identity plus the full lookup it narrows, so the
// extra pass costs nothing per frame; findHit (js/inspector.js) applies the same restriction so
// a hidden pin can't still be tapped.
let _groupIconLookupCache = null;

// While Search is open with an active query, the map shows only the top matches
// (state.searchHighlightResults, kept live by updateSearchHighlight in js/app.js) drawn with
// their normal species/place icons -- no separate highlight styling, no radius or filter
// gating (see markerOpacityFor's search bypass, js/inspector.js). Roads and railways are lines,
// not entries in this lookup, so a road/railway search match stays visible the way every line
// already is; only the point types (tree/landmark/cow/path/water) need narrowing here.
let _searchIconLookupCache = null;

function buildSearchIconLookup() {
  const results = state.searchHighlightResults;
  if (_searchIconLookupCache && _searchIconLookupCache.results === results) {
    return _searchIconLookupCache.result;
  }
  const result = {
    tree: new Set(), landmark: new Set(), cow: new Set(), path: new Set(), water: new Set(),
    outOfRadius: new Set(),
  };
  for (const entry of results) {
    const set = result[entry.type];
    if (set) set.add(entry.item);
  }
  _searchIconLookupCache = { results, result };
  return result;
}

// The one lookup every pin-drawing pass and hit-test should use: Search's own restricted set
// while it has matches to show, the ordinary Nearby/Filter/Settings/Report set otherwise (an
// open Search screen with no query yet, or too short a query, falls back to this too -- see
// searchResultsHtml/updateSearchHighlight, js/app.js).
function activeIconLookup() {
  if (state.searchScreenOpen && state.searchHighlightResults.length) return buildSearchIconLookup();
  return buildNearbyIconLookup();
}

function buildNearbyIconLookup() {
  const full = buildFullNearbyIconLookup();
  const group = state.clusterExpanded;
  if (!group) return full;
  if (_groupIconLookupCache && _groupIconLookupCache.group === group && _groupIconLookupCache.full === full) {
    return _groupIconLookupCache.result;
  }
  const result = {
    tree: new Set(),
    landmark: new Set(),
    cow: new Set(),
    path: new Set(),
    water: new Set(),
    outOfRadius: full.outOfRadius,
  };
  // A mega cluster's items span several real types (see buildSuperClusters/findClusterHit) --
  // its own itemType is the synthetic "_mega", which isn't one of the Sets above, so it carries
  // an itemsByType breakdown instead and every real type gets its own slice restored. Without
  // this, indexing result["_mega"] silently missed and left every set empty: expanding a mega
  // cluster narrowed the map down to nothing rather than to its own items.
  if (group.itemType === "_mega" && group.itemsByType) {
    for (const [itemType, items] of Object.entries(group.itemsByType)) {
      if (result[itemType]) result[itemType] = new Set(items);
    }
  } else if (result[group.itemType]) {
    result[group.itemType] = new Set(group.items);
  }
  _groupIconLookupCache = { group, full, result };
  return result;
}

// The Filter/Settings/Report camera reaches past the ring for the nearest match of each
// selected filter (nearestSelectedFilterPoints, js/app.js), so those screens highlight the same
// items -- otherwise the zoom-out framed a match the map drew nothing for. Only the ones
// genuinely outside the ring are added here: anything inside it is the in-radius pass's to draw
// (and to leave out, where the tree budget already dropped it).
function addNearestSelectedFilterReach(lookup) {
  // With the radius filter toggled off there is no ring to reach past: the in-radius pass has
  // already drawn the unlimited set, so every nearest match is on the map already.
  if (state.showAllOutsideRadius) return;
  const radiusMetres = walkingDistanceToMetres(state.walkingDistanceMinutes);
  for (const entry of nearestSelectedFilterEntries()) {
    if (!(entry.metres > radiusMetres)) continue;
    const set = lookup[entry.type];
    if (!set || set.has(entry.item)) continue;
    if ((entry.type === "path" || entry.type === "water") && !entry.item.point) continue;
    set.add(entry.item);
    lookup.outOfRadius.add(entry.item);
  }
}

function buildFullNearbyIconLookup() {
  // Every screen highlights the same thing: the matches inside the walking radius, scanned from
  // nearbyOrigin(). Filters/Settings/Report used to build their own unlimited, radius-blind set
  // instead, so resizing the ring from any of them (their pinch/wheel/slider all do) changed the
  // circle on the map and nothing inside it. They now differ only in reaching past the ring for
  // the nearest match of each selected filter, which is what their camera fit frames.
  const reachesPastRing = Boolean(secondaryScreenActive() && state.userLocation);
  const cacheKey = nearbyIconLookupCacheKey(reachesPastRing);
  if (_nearbyIconLookupCache && _nearbyIconLookupCache.key === cacheKey && nearbyIconLookupDatasetsUnchanged(_nearbyIconLookupCache)) {
    return _nearbyIconLookupCache.result;
  }

  const landmark = new Set();
  const cow = new Set();
  const path = new Set();
  const water = new Set();
  // Which of the highlighted items sit outside the walking radius. Nothing in the draw path
  // reads this any more: out-of-radius pins used to be drawn at 0.4 opacity, and the dim is
  // gone -- the walking-radius wash already darkens everything beyond the ring, so a pin out
  // there is visibly outside it without being faded as well, and fading the pin only made the
  // one thing the user is trying to read the hardest thing on that part of the map. Kept as
  // the lookup's record of the distinction, which the specs assert against.
  const outOfRadius = new Set();
  const treeCandidates = [];
  for (const entry of overviewItemsForActiveFilter()) {
    if (!entry || !entry.item) continue;
    if (entry.outOfRadius) {
      outOfRadius.add(entry.item);
      if (!state.showAllOutsideRadius) continue;
    }
    if (entry.type === "tree") treeCandidates.push(entry.item);
    else if (entry.type === "landmark") landmark.add(entry.item);
    else if (entry.type === "cow") cow.add(entry.item);
    else if (entry.type === "path" && entry.item.point) path.add(entry.item);
    else if (entry.type === "water" && entry.item.point) water.add(entry.item);
  }
  const tree = new Set(sampleSpread(treeCandidates, MAX_MAP_TREES));
  const result = { tree, landmark, cow, path, water, outOfRadius };
  if (reachesPastRing) addNearestSelectedFilterReach(result);
  _nearbyIconLookupCache = {
    key: cacheKey,
    result,
    trees: state.trees,
    cows: state.cows,
    landmarks: state.landmarks,
    paths: state.paths,
    waterFeatures: state.waterFeatures,
  };
  return result;
}

function shouldDrawMapIcon(type, item, nearbyIconLookup) {
  if (state.selected && ["tree", "landmark", "cow", "path", "water"].includes(state.selected.type)) return false;
  const typeSet = nearbyIconLookup && nearbyIconLookup[type];
  return Boolean(typeSet && typeSet.has(item));
}

function drawLandmarks(ctx, nearbyIconLookup, toScreen, landmarkClusters) {
  if (state.selected && ["tree", "landmark", "cow", "path", "water"].includes(state.selected.type)) return;
  const resolvedToScreen = toScreen || worldToScreen;
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const uScale = MAP_ICON_SCALE_UNSELECTED;
  const iconSize = MAP_PNG_ICON_SIZE * dpr * mapScale * uScale;
  const clusters = landmarkClusters || buildLandmarkClusters(nearbyIconLookup.landmark, resolvedToScreen);
  // Painter's algorithm -- see the matching comment in drawTrees.
  const sortedClusters = clusters.slice().sort((a, b) => a.screenPt.y - b.screenPt.y);

  const reveal = nearbyRevealOpacity();
  ctx.save();
  for (const cluster of sortedClusters) {
    const { screenPt, items } = cluster;
    if (!isNearCanvas(screenPt, LANDMARK_CULL_MARGIN_PX * dpr)) continue;

    const place = items[0];
    const baseOpacity = markerOpacityFor("landmark", place);
    ctx.globalAlpha = baseOpacity * reveal;

    const isPub = isPubCategory(place);
    const isCafe = isCafeCategory(place);
    const isTransport = isTransportCategory(place);
    let drawnAsPng = false;

    if (isPub) {
      drawnAsPng = drawPngMapIcon(ctx, iconPath("beer"), screenPt.x, screenPt.y, iconSize * BEER_ICON_SCALE);
    } else if (isCafe) {
      drawnAsPng = drawPngMapIcon(ctx, iconPath("cafe"), screenPt.x, screenPt.y, iconSize);
    } else if (isShopCategory(place)) {
      drawnAsPng = drawPngMapIcon(ctx, iconPath("shop"), screenPt.x, screenPt.y, iconSize);
    } else if (isTransport) {
      const transportType = getTransportType(place);
      if (transportType === "underground") {
        drawUndergroundRoundel(ctx, screenPt.x, screenPt.y, 8 * dpr * mapScale * uScale);
      } else if (transportType === "national_rail") {
        drawNationalRailLogo(ctx, screenPt.x, screenPt.y, 8 * dpr * mapScale * uScale);
      } else if (transportType === "parking") {
        drawnAsPng = drawPngMapIcon(ctx, iconPath("landmark-parking"), screenPt.x, screenPt.y, iconSize);
      } else {
        drawnAsPng = drawPngMapIcon(ctx, iconPath("bus"), screenPt.x, screenPt.y, iconSize);
      }
    } else {
      const iconSlug = placeIconSlug(place);
      if (iconSlug) {
        drawnAsPng = drawPngMapIcon(ctx, iconPath(iconSlug), screenPt.x, screenPt.y, iconSize);
      } else {
        drawnAsPng = drawEmojiMapPin(ctx, landmarkEmoji(place), screenPt.x, screenPt.y, iconSize);
      }
    }

    if (drawnAsPng && items.length > 1) drawClusterBadge(ctx, screenPt.x, screenPt.y, items.length, iconSize, dpr);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawPathPins(ctx, nearbyIconLookup, toScreen, pathClusters) {
  if (state.selected && ["tree", "landmark", "cow", "path", "water"].includes(state.selected.type)) return;
  const resolvedToScreen = toScreen || worldToScreen;
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const iconSize = MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE_UNSELECTED;
  const clusters = pathClusters || buildTypeClusters(nearbyIconLookup.path, resolvedToScreen);
  if (!clusters.length) return;
  // Painter's algorithm -- see the matching comment in drawTrees.
  const sortedClusters = clusters.slice().sort((a, b) => a.screenPt.y - b.screenPt.y);

  const reveal = nearbyRevealOpacity();
  ctx.save();
  for (const cluster of sortedClusters) {
    const { screenPt, items } = cluster;
    if (!isNearCanvas(screenPt, iconSize * 2)) continue;
    ctx.globalAlpha = reveal;
    const drawn = drawPngMapIcon(ctx, iconPath("waymarked"), screenPt.x, screenPt.y, iconSize);
    if (drawn && items.length > 1) drawClusterBadge(ctx, screenPt.x, screenPt.y, items.length, iconSize, dpr);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawWaterPins(ctx, nearbyIconLookup, toScreen, waterClusters) {
  if (state.selected && ["tree", "landmark", "cow", "path", "water"].includes(state.selected.type)) return;
  const resolvedToScreen = toScreen || worldToScreen;
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const iconSize = MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE_UNSELECTED;
  const clusters = waterClusters || buildTypeClusters(nearbyIconLookup.water, resolvedToScreen);
  if (!clusters.length) return;
  // Painter's algorithm -- see the matching comment in drawTrees.
  const sortedClusters = clusters.slice().sort((a, b) => a.screenPt.y - b.screenPt.y);

  const reveal = nearbyRevealOpacity();
  ctx.save();
  for (const cluster of sortedClusters) {
    const { screenPt, items } = cluster;
    if (!isNearCanvas(screenPt, iconSize * 2)) continue;
    ctx.globalAlpha = reveal;
    const drawn = drawPngMapIcon(ctx, iconPath("ponds"), screenPt.x, screenPt.y, iconSize);
    if (drawn && items.length > 1) drawClusterBadge(ctx, screenPt.x, screenPt.y, items.length, iconSize, dpr);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawCows(ctx, nearbyIconLookup, toScreen, cowClusters) {
  if (!state.cows.length) return;
  if (state.selected && ["tree", "landmark", "cow", "path", "water"].includes(state.selected.type)) return;
  const resolvedToScreen = toScreen || worldToScreen;
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const iconSize = MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE_UNSELECTED;
  const clusters = cowClusters || buildTypeClusters(nearbyIconLookup.cow, resolvedToScreen);
  // Painter's algorithm -- see the matching comment in drawTrees.
  const sortedClusters = clusters.slice().sort((a, b) => a.screenPt.y - b.screenPt.y);

  const reveal = nearbyRevealOpacity();
  ctx.save();
  for (const cluster of sortedClusters) {
    const { screenPt, items } = cluster;
    if (!isNearCanvas(screenPt, iconSize * 2)) continue;
    const baseOpacity = markerOpacityFor("cow", items[0]);
    ctx.globalAlpha = baseOpacity * reveal;
    const drawn = drawPngMapIcon(ctx, iconPath("cow"), screenPt.x, screenPt.y, iconSize);
    if (drawn && items.length > 1) drawClusterBadge(ctx, screenPt.x, screenPt.y, items.length, iconSize, dpr);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Draws the radar cone on the main canvas so CSS perspective+rotation places it in the
// 3D ground plane alongside the route lines. Always points in the direction the user is
// facing (forward in heading-up mode, or the compass heading in flat mode) — the dotted
// route line, not the radar cone, is what shows the bearing to a selected target.
function drawUserRadarMainCanvas(ctx) {
  if (!state.userLocation || !state.userInMapArea) return;
  if (!Number.isFinite(state.compassHeading)) return;
  if (typeof tiltActive === "function" && tiltActive()) return;
  const dpr = pixelRatio();
  const point = worldToScreen(state.userLocation.point);
  const outerRadius = Math.max(0.5, radarRadiusForMetres(point, 60));
  const innerRadius = Math.max(0.2, outerRadius * 0.28);
  const spread = toRadians(26);

  const isHeadingUp = typeof headingUpActive === "function" && headingUpActive();
  const headingRad = isHeadingUp
    ? toRadians(-90)
    : toRadians(normalizeDegrees(state.compassHeading) - 90);

  ctx.save();
  const fill = ctx.createRadialGradient(point.x, point.y, innerRadius * 0.2, point.x, point.y, outerRadius);
  fill.addColorStop(0, "rgba(31, 94, 255, 0.30)");
  fill.addColorStop(1, "rgba(31, 94, 255, 0.02)");
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.arc(point.x, point.y, outerRadius, headingRad - spread, headingRad + spread);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = "rgba(31, 94, 255, 0.55)";
  for (const ratio of [0.4, 0.7, 1]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, outerRadius * ratio, headingRad - spread, headingRad + spread);
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

// Draws the radar cone on the overlay canvas using explicit perspective projection so it
// appears to lie flat on the tilted ground plane. Each arc point is projected through
// projectCanvasPoint (same math the pins use) rather than relying on CSS rotateX, which
// produces a visually ambiguous fin shape for simple geometric arcs.
function drawUserRadarOverlayTilted(ctx) {
  if (!state.userLocation || !state.userInMapArea) return;
  if (typeof tiltActive !== "function" || !tiltActive()) return;
  if (typeof projectCanvasPoint !== "function") return;

  const dpr = pixelRatio();
  // The user's *rotated* pre-tilt position, not the raw one. Those were the same thing while
  // the heading rotation always pivoted on the user, but it now pivots on the camera origin
  // (cameraOriginPoint, index.html), which is the browse anchor while browsing -- so reading
  // the raw position detached the radar cone from the "You" dot it belongs to. The cone's own
  // direction is unaffected: a rotation is uniform, so ahead is still straight up on screen.
  const U = typeof worldToScreenFlat === "function"
    ? worldToScreenFlat(state.userLocation.point)
    : worldToScreen(state.userLocation.point);

  const outerRadius = Math.max(0.5, radarRadiusForMetres(U, 60, worldToScreenFlat));
  const innerRadius = Math.max(0.2, outerRadius * 0.28);
  const spread = toRadians(26);

  // Heading direction in overlay canvas space: the heading rotation puts ahead at the top of
  // the screen everywhere (it is a rigid rotation, whatever it pivots about), and this mode is
  // only active while heading-up is active, so "up" = -y = ahead.
  const headingRad = toRadians(-90); // up = forward in heading-up overlay

  const startAngle = headingRad - spread;
  const endAngle = headingRad + spread;
  const STEPS = 24;

  // Project a canvas-pixel point through the tilt perspective into the flat overlay plane.
  function proj(px, py) {
    const r = projectCanvasPoint(px, py);
    return { x: r.x, y: r.y };
  }

  const apex = proj(U.x, U.y);

  // Validate projection produced valid coordinates
  if (!Number.isFinite(apex.x) || !Number.isFinite(apex.y)) return;

  ctx.save();

  const fill = ctx.createRadialGradient(apex.x, apex.y, innerRadius * 0.2, apex.x, apex.y, outerRadius);
  fill.addColorStop(0, "rgba(31, 94, 255, 0.30)");
  fill.addColorStop(1, "rgba(31, 94, 255, 0.02)");

  // Filled cone
  ctx.beginPath();
  ctx.moveTo(apex.x, apex.y);
  for (let i = 0; i <= STEPS; i++) {
    const a = startAngle + (endAngle - startAngle) * i / STEPS;
    const p = proj(U.x + outerRadius * Math.cos(a), U.y + outerRadius * Math.sin(a));
    // Skip invalid projections at extreme angles
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // Concentric rings at 40 %, 70 %, 100 %
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = "rgba(31, 94, 255, 0.55)";
  for (const ratio of [0.4, 0.7, 1]) {
    ctx.beginPath();
    let first = true;
    for (let i = 0; i <= STEPS; i++) {
      const a = startAngle + (endAngle - startAngle) * i / STEPS;
      const p = proj(U.x + outerRadius * ratio * Math.cos(a), U.y + outerRadius * ratio * Math.sin(a));
      // Skip invalid projections at extreme angles
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (first) { ctx.moveTo(p.x, p.y); first = false; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // Centre direction line
  const lineEnd = proj(U.x + outerRadius * Math.cos(headingRad), U.y + outerRadius * Math.sin(headingRad));
  // Only draw centre line if projection is valid
  if (Number.isFinite(lineEnd.x) && Number.isFinite(lineEnd.y)) {
  ctx.beginPath();
  ctx.moveTo(apex.x, apex.y);
  ctx.lineTo(lineEnd.x, lineEnd.y);
  ctx.lineWidth = 2.6 * dpr;
  ctx.strokeStyle = "rgba(31, 94, 255, 0.82)";
  ctx.stroke();
  }

  ctx.restore();
}

// Collects all pin clusters across every type, sorts them by screen Y so items closer
// to the user (higher Y in heading-up mode) paint over distant ones (painter's algorithm),
// then draws them in a single pass. Selected item is still drawn last via drawSelectedOverlay.
function drawAllPinsSorted(ctx, nearbyIconLookup, toScreen) {
  if (state.selected && ["tree", "landmark", "cow", "path", "water"].includes(state.selected.type)) return;
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const uScale = MAP_ICON_SCALE_UNSELECTED;
  const iconSize = MAP_PNG_ICON_SIZE * dpr * mapScale * uScale;

  const reveal = nearbyRevealOpacity();
  const calls = [];

  const treeClustersAll = buildTypeClusters(nearbyIconLookup.tree, toScreen);
  const landmarkClustersAll = buildLandmarkClusters(nearbyIconLookup.landmark, toScreen);
  const cowClustersAll = buildTypeClusters(nearbyIconLookup.cow, toScreen);
  const pathClustersAll = buildTypeClusters(nearbyIconLookup.path, toScreen);
  const waterClustersAll = buildTypeClusters(nearbyIconLookup.water, toScreen);

  // Heading-up/tilt draws every pin type through this one sorted-by-depth pass instead of the
  // five separate drawTrees/drawLandmarks/... calls draw() uses, but it still built its clusters
  // per type only -- the same cross-category pile-up buildSuperClusters exists to fix on the flat
  // map (see its own comment) was never applied here, so a phone with a compass (heading-up is
  // the default there) never saw mega clusters at all. Same merge pass, same exclusion of the
  // clusters it absorbs from their own type's pins. Also, like the flat path, still runs while a
  // cluster is expanded -- a still-dense expanded view should offer a next, smaller level of
  // clustering to tap into, not force every absorbed item into its own singleton pin regardless
  // of how much screen space the zoom actually bought them.
  const megaGroups = buildSuperClusters([
    { itemType: "tree", clusters: treeClustersAll },
    { itemType: "landmark", clusters: landmarkClustersAll },
    { itemType: "cow", clusters: cowClustersAll },
    { itemType: "path", clusters: pathClustersAll },
    { itemType: "water", clusters: waterClustersAll },
  ]).filter(group => group.length >= megaClusterMinMembersFor(group));
  const megaClusterSet = new Set();
  for (const group of megaGroups) for (const member of group) megaClusterSet.add(member.cluster);

  const treeClusters = treeClustersAll.filter(c => !megaClusterSet.has(c));
  const landmarkClusters = landmarkClustersAll.filter(c => !megaClusterSet.has(c));
  const cowClusters = cowClustersAll.filter(c => !megaClusterSet.has(c));
  const pathClusters = pathClustersAll.filter(c => !megaClusterSet.has(c));
  const waterClusters = waterClustersAll.filter(c => !megaClusterSet.has(c));

  for (const group of megaGroups) {
    let totalItems = 0, sx = 0, sy = 0, swx = 0, swy = 0;
    const byType = new Map();
    const byTypeIconSrc = new Map();
    let allItems = [];
    for (const { itemType, cluster } of group) {
      const n = cluster.items.length;
      totalItems += n;
      sx += cluster.screenPt.x * n;
      sy += cluster.screenPt.y * n;
      swx += cluster.worldPt.x * n;
      swy += cluster.worldPt.y * n;
      allItems = allItems.concat(cluster.items);
      const key = megaClusterDisplayKey(itemType, cluster);
      const existing = byType.get(key);
      byType.set(key, { count: (existing ? existing.count : 0) + n, itemType });
      if (!byTypeIconSrc.has(key)) byTypeIconSrc.set(key, megaClusterMemberIconSrc(itemType, cluster));
    }
    const cx = sx / totalItems;
    const cy = sy / totalItems;
    const worldPt = { x: swx / totalItems, y: swy / totalItems };
    if (!isNearCanvas({ x: cx, y: cy }, megaClusterOuterRadius(totalItems, dpr) * 2)) continue;
    const pinScale = tiltPinScale(worldPt);
    // See the flat-path drawMegaClusters (above) for why this differs from the raw merged count.
    const badgeCount = megaBadgeVisibleCount(allItems);
    // Ground-space centre for the outer disc's tilt-projected footprint (drawMegaBadge) --
    // null outside active tilt, where the badge stays a plain camera-facing circle. Also null
    // when the badge's own centre falls in tiltProjectScreenPoint's near-camera clip band
    // (its `clipped` flag) -- a badge sitting almost on top of the camera pivot has its ground
    // ellipse pinned against that clip, and as the badge (or the user) moves the clip regime can
    // flip within a frame or two, which read as the disc suddenly jumping and detaching from the
    // terrain under it. Falling back to the plain camera-facing circle in that narrow band avoids
    // the instability; it only affects a badge essentially on top of the user, where the walking
    // radius ring dominates the screen anyway.
    const groundCenterFlatRaw = tiltActive() ? worldToScreenFlat(worldPt) : null;
    const groundCenterFlat = groundCenterFlatRaw && !tiltProjectScreenPoint(groundCenterFlatRaw).clipped
      ? groundCenterFlatRaw
      : null;
    calls.push({ y: cy, fn(c) {
      c.globalAlpha = reveal;
      drawMegaBadge(c, cx, cy, badgeCount, byType, byTypeIconSrc, dpr, groundCenterFlat, pinScale);
    }});
  }

  for (const cluster of treeClusters) {
    const { screenPt, items, worldPt } = cluster;
    if (!isNearCanvas(screenPt, iconSize * 2)) continue;
    const pinScale = tiltPinScale(worldPt);
    const repr = items[0];
    const src = (typeof treeSpeciesIconPath === "function" && treeSpeciesIconPath(repr.commonName, repr.latinName)) || iconPath("tree");
    calls.push({ y: screenPt.y, fn(c) {
      c.globalAlpha = reveal;
      const drawn = drawPngMapIcon(c, src, screenPt.x, screenPt.y, iconSize * pinScale);
      if (drawn && items.length > 1) drawClusterBadge(c, screenPt.x, screenPt.y, items.length, iconSize * pinScale, dpr);
    }});
  }

  for (const cluster of landmarkClusters) {
    const { screenPt, items, worldPt } = cluster;
    if (!isNearCanvas(screenPt, 16 * dpr * uScale)) continue;
    const pinScale = tiltPinScale(worldPt);
    const place = items[0];
    const baseOpacity = markerOpacityFor("landmark", place);
    const isPub = isPubCategory(place);
    const isCafe = isCafeCategory(place);
    const isShop = isShopCategory(place);
    const isTransport = isTransportCategory(place);
    const transportType = isTransport ? getTransportType(place) : null;
    const iconSlug = (!isPub && !isCafe && !isShop && !isTransport) ? placeIconSlug(place) : null;
    calls.push({ y: screenPt.y, fn(c) {
      c.globalAlpha = reveal * baseOpacity;
      let drawnAsPng = false;
      const scaledIconSize = iconSize * pinScale;
      if (isPub) {
        drawnAsPng = drawPngMapIcon(c, iconPath("beer"), screenPt.x, screenPt.y, scaledIconSize * BEER_ICON_SCALE);
      } else if (isCafe) {
        drawnAsPng = drawPngMapIcon(c, iconPath("cafe"), screenPt.x, screenPt.y, scaledIconSize);
      } else if (isShop) {
        drawnAsPng = drawPngMapIcon(c, iconPath("shop"), screenPt.x, screenPt.y, scaledIconSize);
      } else if (isTransport) {
        if (transportType === "underground") {
          drawUndergroundRoundel(c, screenPt.x, screenPt.y, 8 * dpr * mapScale * uScale * pinScale);
        } else if (transportType === "national_rail") {
          drawNationalRailLogo(c, screenPt.x, screenPt.y, 8 * dpr * mapScale * uScale * pinScale);
        } else if (transportType === "parking") {
          drawnAsPng = drawPngMapIcon(c, iconPath("landmark-parking"), screenPt.x, screenPt.y, scaledIconSize);
        } else {
          drawnAsPng = drawPngMapIcon(c, iconPath("bus"), screenPt.x, screenPt.y, scaledIconSize);
        }
      } else if (iconSlug) {
        drawnAsPng = drawPngMapIcon(c, iconPath(iconSlug), screenPt.x, screenPt.y, scaledIconSize);
      } else {
        drawnAsPng = drawEmojiMapPin(c, landmarkEmoji(place), screenPt.x, screenPt.y, scaledIconSize);
      }
      if (drawnAsPng && items.length > 1) drawClusterBadge(c, screenPt.x, screenPt.y, items.length, scaledIconSize, dpr);
    }});
  }

  for (const cluster of cowClusters) {
    const { screenPt, items, worldPt } = cluster;
    if (!isNearCanvas(screenPt, iconSize * 2)) continue;
    const pinScale = tiltPinScale(worldPt);
    const baseOpacity = markerOpacityFor("cow", items[0]);
    calls.push({ y: screenPt.y, fn(c) {
      c.globalAlpha = reveal * baseOpacity;
      const drawn = drawPngMapIcon(c, iconPath("cow"), screenPt.x, screenPt.y, iconSize * pinScale);
      if (drawn && items.length > 1) drawClusterBadge(c, screenPt.x, screenPt.y, items.length, iconSize * pinScale, dpr);
    }});
  }

  for (const cluster of pathClusters) {
    const { screenPt, items, worldPt } = cluster;
    if (!isNearCanvas(screenPt, iconSize * 2)) continue;
    const pinScale = tiltPinScale(worldPt);
    calls.push({ y: screenPt.y, fn(c) {
      c.globalAlpha = reveal;
      const drawn = drawPngMapIcon(c, iconPath("waymarked"), screenPt.x, screenPt.y, iconSize * pinScale);
      if (drawn && items.length > 1) drawClusterBadge(c, screenPt.x, screenPt.y, items.length, iconSize * pinScale, dpr);
    }});
  }

  for (const cluster of waterClusters) {
    const { screenPt, items, worldPt } = cluster;
    if (!isNearCanvas(screenPt, iconSize * 2)) continue;
    const pinScale = tiltPinScale(worldPt);
    calls.push({ y: screenPt.y, fn(c) {
      c.globalAlpha = reveal;
      const drawn = drawPngMapIcon(c, iconPath("ponds"), screenPt.x, screenPt.y, iconSize * pinScale);
      if (drawn && items.length > 1) drawClusterBadge(c, screenPt.x, screenPt.y, items.length, iconSize * pinScale, dpr);
    }});
  }

  // Ascending by Y: distant items (small Y = top of screen in heading-up) drawn first.
  calls.sort((a, b) => a.y - b.y);
  ctx.save();
  for (const { fn } of calls) {
    fn(ctx);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawUser(ctx, toScreen, isTilted) {
  if (!state.userLocation || !state.userInMapArea) return;
  const dpr = pixelRatio();
  // Use provided toScreen function (handles tilt projection), fallback to worldToScreen
  if (!toScreen) toScreen = worldToScreen;

  const point = toScreen(state.userLocation.point);

  // Validate projection produced valid coordinates
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

  ctx.globalAlpha = 1;
  
  // In tilt mode, apply tiltPinScale if available.
  // Note: unlike landmarks/pins, the user location marker should always be visible
  // (no isNearCanvas culling) since it's critical UI that must show the user's position.
  let pinScale = 1;
  if (isTilted && typeof tiltPinScale === "function") {
    // Apply tilt-based scale if available, but ensure it's positive and finite
    const scale = tiltPinScale(state.userLocation.point);
    // Clamp scale to valid range; avoid zero, negative, or NaN scales
    pinScale = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 5) : 1;
  }

  // Scale proportionally with actual zoom (not mapEmojiScale which has a high floor).
  // Use baseFitScale if set, otherwise fitScale, with a minimum of 1
  const baseScale = state.baseFitScale > 0 ? state.baseFitScale : (state.fitScale > 0 ? state.fitScale : 1);
  const dotScale = clamp(state.viewport.scale / baseScale, 0.1, 1.5) * pinScale;
  const radius = Math.max(2 * dpr, 4 * dpr * dotScale);
  
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#1f5eff";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2 * dpr * dotScale;
  ctx.stroke();
  ctx.fillStyle = "#14211d";
  ctx.font = `800 ${11 * dpr * dotScale}px system-ui`;
  ctx.fillText("You", point.x + radius + 3 * dpr, point.y + 4 * dpr * dotScale);
  ctx.globalAlpha = 1;  // Reset opacity for subsequent drawing
  ctx.restore();
}

function drawSelectedOverlay(ctx, toScreen) {
  if (!state.selected || !state.selected.item) return;
  if (!toScreen) toScreen = worldToScreen;

  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const selectedScale = selectedIconScale();

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
  } else if (state.selected.type === "water") {
    drawPngMapIcon(ctx, iconPath("ponds"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
  } else if (state.selected.type === "landmark") {
    const selectedPlace = state.selected.item;

    const iconSlug = placeIconSlug(selectedPlace);

    if (iconSlug) {
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
        drawUndergroundRoundel(ctx, point.x, point.y, 8 * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
      } else if (transportType === "national_rail") {
        drawNationalRailLogo(ctx, point.x, point.y, 26 * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
      } else if (transportType === "parking") {
        drawPngMapIcon(ctx, iconPath("landmark-parking"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
      } else {
        drawPngMapIcon(ctx, iconPath("bus"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
      }
    } else {
      // No artwork for this one: the same pointer, with the glyph inside it.
      drawEmojiMapPin(ctx, landmarkEmoji(selectedPlace), point.x, point.y,
        MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
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
    const count = segment.length / 2;
    if (count < 2) continue;

    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const point = environmentVertexToScreen(segment, i);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }

    const pulse = getSelectedOverlayPulse();
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
    const count = segment.length / 2;
    if (count < 2) continue;

    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const point = environmentVertexToScreen(segment, i);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }

    const pulse = getSelectedOverlayPulse();
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
  return clamp(Math.pow(Math.max(0.0001, zoomRatio), 0.35), 0.3, 1.15);
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

// `point` and the returned radius are both in whatever space `toScreen` maps into, and the two
// must match: the tilted radar builds its arcs in flat (pre-perspective) space and projects each
// point itself, so measuring its radius through the full projection mixed the two and inflated
// the cone -- badly so once the tilt pivot moved off the user for browsing, where the user sits
// far enough off-pivot for the perspective divide to magnify the projected distance.
function radarRadiusForMetres(point, metres, toScreen = worldToScreen) {
  if (!state.userLocation || !Number.isFinite(state.compassHeading)) return 0;
  const destination = destinationPointMetres(
    state.userLocation.latitude,
    state.userLocation.longitude,
    normalizeDegrees(state.compassHeading),
    metres
  );
  const destinationScreen = toScreen(projectLonLat(destination.longitude, destination.latitude));
  return Math.hypot(destinationScreen.x - point.x, destinationScreen.y - point.y);
}
