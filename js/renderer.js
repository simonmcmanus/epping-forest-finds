const MAP_ICON_SCALE = 2;
const MAP_ICON_SCALE_UNSELECTED = 2.2;
const MAP_PNG_ICON_SIZE = 30;
// The 30 CSS-px clustering radius below was tuned against the original 16px icon size; scale
// it with MAP_PNG_ICON_SIZE so bigger pins merge into a count badge sooner instead of just
// overlapping each other when a lot of them fall close together.
const MAX_MAP_TREES = 60;
const SELECTED_OVERLAY_PULSE_PERIOD_MS = 380;  // Shared pulse period for smooth animation
const USER_RADAR_RADIUS_METRES = 80;

const mapImageCache = new Map();

// Animation state for smooth pulsing without Date.now() jitter
let _animationStartTime = null;

// Tracks the previous tilt state so drawOverlay can detect transitions and trigger
// a full canvas redraw when tilt activates/deactivates.
let _overlayWasTilted = false;

// The selected road/path overlay pulses (see drawSelectedRoadOverlay/drawSelectedPathOverlay)
// via a sine wave with a ~350-400ms period, so redrawing at full display refresh rate (up to
// 120Hz) wastes CPU/GPU for no visible benefit. Throttle re-draws to a fixed interval instead.
const SELECTED_PULSE_REDRAW_INTERVAL_MS = 50;
let _selectedPulseTimer = null;

// Navigation owns activation; IconMotion only draws the artwork. Redraw the small
// overlay rather than rebuilding the map, clustering or route for each frame.
const SELECTED_ICON_FRAME_MS = 1000 / 15;
let _selectedIconMotionTimer = null;
let _selectedIconMotionItem = null;
let _selectedIconMotionStartedAt = 0;
let _selectedIconMotionDrawn = false;
let _iconMotionPreference = null;
const _iconMotionSlugByPath = new Map(Object.entries(ICON_PATHS).map(([slug, src]) => [src, slug]));

// Canvas text is not a DOM element, so keep the visible label bounds alongside the frame that
// painted them. inspector.js uses these regions before falling back to line/pin hit testing.
let _mapLabelHitRegions = [];
let _waterLabelLookupSource = null;
let _waterLabelLookupLength = -1;
let _waterLabelById = new Map();
let _waterLabelByName = new Map();

function resetMapLabelHitRegions() {
  _mapLabelHitRegions = [];
}

function waterFeatureForLabel(feature) {
  const features = Array.isArray(state.waterFeatures) ? state.waterFeatures : [];
  if (_waterLabelLookupSource !== features || _waterLabelLookupLength !== features.length) {
    _waterLabelLookupSource = features;
    _waterLabelLookupLength = features.length;
    _waterLabelById = new Map();
    _waterLabelByName = new Map();
    for (const water of features) {
      if (water && water.id != null && !_waterLabelById.has(String(water.id))) {
        _waterLabelById.set(String(water.id), water);
      }
      if (water && water.name && !_waterLabelByName.has(water.name)) {
        _waterLabelByName.set(water.name, water);
      }
    }
  }
  const properties = feature && feature.properties;
  const id = properties && properties.id != null ? String(properties.id) : "";
  const name = properties && properties.name ? properties.name : "";
  return _waterLabelById.get(id) || _waterLabelByName.get(name) || null;
}

function registerMapLabelHit(type, item, point, text, ctx, padding = 10) {
  if (!point || !text || !ctx) return;
  const water = type === "water-label" ? waterFeatureForLabel(item) : null;
  if (type === "water-label" && !water) return;
  const width = ctx.measureText(String(text)).width;
  const fontSize = Number(ctx.font && String(ctx.font).match(/([0-9]+(?:\.[0-9]+)?)px/)?.[1]) || 10;
  _mapLabelHitRegions.push({
    type: type === "water-label" ? "water" : type,
    item: water || item,
    minX: point.x - width / 2 - padding,
    maxX: point.x + width / 2 + padding,
    minY: point.y - fontSize / 2 - padding,
    maxY: point.y + fontSize / 2 + padding,
  });
}

function findMapLabelHit(screen) {
  for (let i = _mapLabelHitRegions.length - 1; i >= 0; i -= 1) {
    const label = _mapLabelHitRegions[i];
    if (screen.x >= label.minX && screen.x <= label.maxX && screen.y >= label.minY && screen.y <= label.maxY) {
      return { type: label.type, item: label.item, distance: 0 };
    }
  }
  return null;
}

function stopSelectedIconMotion() {
  clearTimeout(_selectedIconMotionTimer);
  _selectedIconMotionTimer = null;
  _selectedIconMotionItem = null;
}

function initSelectedIconMotion() {
  _iconMotionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const refresh = () => { stopSelectedIconMotion(); drawOverlay(); };
  _iconMotionPreference.addEventListener("change", refresh);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pagehide", () => { stopSelectedIconMotion(); IconMotion.clear(); });
  window.addEventListener("pageshow", refresh);
}

function selectedIconMotionFrame() {
  if (!_iconMotionPreference || _iconMotionPreference.matches || document.visibilityState === "hidden") return null;
  const target = selectedCompassTarget();
  if (!target || target !== state.selected.item || !["tree", "landmark", "cow", "water", "path"].includes(state.selected.type)) return null;
  const now = performance.now();
  if (_selectedIconMotionItem !== target) {
    _selectedIconMotionItem = target;
    _selectedIconMotionStartedAt = now;
  }
  return { elapsed: (now - _selectedIconMotionStartedAt) / 1000 };
}

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

// The white pointer every map pin sits in: a rounded rectangular head with a wedge
// drawn down to the place's own point. Returns the head's centre and radius
// so the caller can put artwork or a glyph inside it.
//
// Artwork is drawn at 1.85x the head radius, so anything reaching past
// 1/1.85 of its own half-width pokes out of the pointer. The generator
// (scripts/generate-map-icons.js) holds new icons well inside that via
// FIT_LIMIT (scripts/lib/icon-fit.js), which is independent of this
// multiplier, so raising it here is safe without touching icon assets.
function roundedPinPath(ctx, x, y, left, top, width, height, radius, pointerHalfWidth) {
  const right = left + width, bottom = top + height;
  ctx.beginPath();
  ctx.moveTo(x + pointerHalfWidth, bottom);
  ctx.lineTo(right - radius, bottom);
  ctx.arc(right - radius, bottom - radius, radius, Math.PI / 2, 0, true);
  ctx.lineTo(right, top + radius);
  ctx.arc(right - radius, top + radius, radius, 0, -Math.PI / 2, true);
  ctx.lineTo(left + radius, top);
  ctx.arc(left + radius, top + radius, radius, -Math.PI / 2, -Math.PI, true);
  ctx.lineTo(left, bottom - radius);
  ctx.arc(left + radius, bottom - radius, radius, Math.PI, Math.PI / 2, true);
  ctx.lineTo(x - pointerHalfWidth, bottom);
  ctx.lineTo(x, y);
  ctx.closePath();
}

function drawMapPinShape(ctx, x, y, size) {
  const R = size * 0.32;
  const pH = R * 0.3;
  const cx = x;
  const cy = y - R - pH;
  roundedPinPath(ctx, x, y, x - R * 1.2, cy - R, R * 2.4, R * 2, R * 0.65, R * 0.3);
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.stroke();

  return { cx, cy, R };
}

function drawPngMapIcon(ctx, src, x, y, size, motion = null) {
  if (!src) return false;
  const img = getMapImage(src);
  if (!img.complete || !img.naturalWidth) return false;

  ctx.save();
  const { cx, cy, R } = drawMapPinShape(ctx, x, y, size);
  const iconSize = R * 1.85;
  let animated = false;
  if (motion) {
    // Moving artwork stays inside the head, leaving the geographic tip fixed.
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.96, 0, Math.PI * 2);
    ctx.clip();
    animated = IconMotion.draw(ctx, img, _iconMotionSlugByPath.get(src),
      cx - iconSize / 2, cy - iconSize / 2, iconSize, motion.elapsed);
    if (animated) _selectedIconMotionDrawn = true;
  }
  if (!animated) ctx.drawImage(img, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
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

  // A device-orientation event with a valid beta can arrive before a compass heading is
  // available (or on a browser that exposes pitch without north-referenced heading), so the
  // beta-smoothing loop must not be gated on compassHeading. draw() is also a useful recovery
  // nudge if an orientation frame arrived while the page was resuming.
  if (typeof startCompassSmoothing === "function"
      && Math.abs(state.tiltBetaTarget - state.tiltBetaSmoothed) > 0.05) {
    startCompassSmoothing();
  }
  if (typeof prepareCanvasForDraw === "function") prepareCanvasForDraw();
  if (typeof syncCanvasMotionResolution === "function") syncCanvasMotionResolution();
  resetMapLabelHitRegions();
  const ctx = els.canvas.getContext("2d");
  ctx.setTransform(state.canvasMotion.scale, 0, 0, state.canvasMotion.scale, 0, 0);
  const width = state.canvasLogicalWidth;
  const height = state.canvasLogicalHeight;
  const animatedEmojiScale = updateAnimatedEmojiScale();
  // During heading-up/tilt movement every pin is drawn through drawOverlay(), where it is
  // projected and depth-sorted against the live camera. Building the main-canvas markers as
  // well was pure duplicate work: on a populated forest map it was enough to make the sensor
  // loop visibly paint in steps, so the flat path only runs when the main canvas draws pins.
  const useOverlayForPins = (typeof nearbyHeadingUpActive === "function" && nearbyHeadingUpActive())
    || (typeof tiltActive === "function" && tiltActive());
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
  if (!useOverlayForPins) {
    const nearbyIconLookup = activeIconLookup();
    drawMapMarkers(ctx, buildMapMarkers(nearbyIconLookup, worldToScreen, markerMemoryKey()), worldToScreen);
  }
  drawSelectedRoadOverlay(ctx);
  drawSelectedPathOverlay(ctx);
  drawTiltDistanceFade(ctx, width, height);
  drawOverlay();

  if (filterPinTransitionActive()) requestDraw();

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
  clearTimeout(_selectedIconMotionTimer);
  _selectedIconMotionTimer = null;
  _selectedIconMotionDrawn = false;
  const canvas = els.overlayCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(state.canvasMotion.scale, 0, 0, state.canvasMotion.scale, 0, 0);
  ctx.clearRect(0, 0, state.canvasLogicalWidth, state.canvasLogicalHeight);
  if (!state.bounds) return;
  const isTilted = typeof tiltActive === "function" && tiltActive();
  const useOverlayForPins = (typeof nearbyHeadingUpActive === "function" && nearbyHeadingUpActive())
    || isTilted;
  // When tilt mode changes, the compass tick calls only drawOverlay (not draw()), so
  // force a full redraw to synchronise the terrain and overlay projections.
  if (isTilted !== _overlayWasTilted) {
    _overlayWasTilted = isTilted;
    if (typeof requestDraw === "function") requestDraw();
  }
  const toScreen = isTilted && typeof worldToScreenForOverlayTilted === "function"
    ? worldToScreenForOverlayTilted
    : (typeof worldToScreenForOverlay === "function" ? worldToScreenForOverlay : worldToScreen);
  if (isTilted) drawUserRadarOverlayTilted(ctx);
  else drawUserRadarOverlay(ctx, toScreen);
  if (useOverlayForPins) {
    drawMapMarkers(ctx, buildActiveMapMarkers(toScreen), toScreen, true);
  }
  drawFilterTransitionPins(ctx, toScreen);
  drawUser(ctx, toScreen, isTilted);
  drawNearbyAnchorMarker(ctx, toScreen);
  drawCommunityMarks(ctx, toScreen);
  drawSelectedOverlay(ctx, toScreen);
  if (drawInspectorIconMotion(selectedIconMotionFrame())) _selectedIconMotionDrawn = true;
  if (_selectedIconMotionDrawn) {
    _selectedIconMotionTimer = setTimeout(drawOverlay, SELECTED_ICON_FRAME_MS);
  } else {
    stopSelectedIconMotion();
  }
}

// The Community screen highlights everything the user has marked: a coloured ring with a check
// (verified), a cross (reported wrong) or a plus (a tree they added), over a soft halo so it reads
// against any pin or footpath underneath. communityMapMarks() (js/community.js) says what and where.
function drawCommunityMarks(ctx, toScreen) {
  if (typeof communityMapMarks !== "function") return;
  const onCommunityScreen = Boolean(state.selected) && state.selected.type === "community";
  if (!onCommunityScreen) return;
  const marks = communityMapMarks();
  if (!marks.length) return;
  if (!toScreen) toScreen = worldToScreen;
  const dpr = pixelRatio();
  const w = state.canvasLogicalWidth;
  const h = state.canvasLogicalHeight;
  for (const mark of marks) {
    const p = toScreen(projectLonLat(mark.lon, mark.lat));
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < -30 * dpr || p.y < -30 * dpr || p.x > w + 30 * dpr || p.y > h + 30 * dpr) continue;
    const style = COMMUNITY_MARK_STYLE[mark.kind];
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 18 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = style.halo;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10.5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.lineWidth = 2 * dpr;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (mark.kind === "verified") {
      ctx.moveTo(p.x - 4.2 * dpr, p.y + 0.4 * dpr);
      ctx.lineTo(p.x - 1.2 * dpr, p.y + 3.4 * dpr);
      ctx.lineTo(p.x + 4.4 * dpr, p.y - 3 * dpr);
    } else if (mark.kind === "added") {
      ctx.moveTo(p.x - 4 * dpr, p.y);
      ctx.lineTo(p.x + 4 * dpr, p.y);
      ctx.moveTo(p.x, p.y - 4 * dpr);
      ctx.lineTo(p.x, p.y + 4 * dpr);
    } else {
      ctx.moveTo(p.x - 3.6 * dpr, p.y - 3.6 * dpr);
      ctx.lineTo(p.x + 3.6 * dpr, p.y + 3.6 * dpr);
      ctx.moveTo(p.x + 3.6 * dpr, p.y - 3.6 * dpr);
      ctx.lineTo(p.x - 3.6 * dpr, p.y + 3.6 * dpr);
    }
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.restore();
  }
}

// Marks state.nearbyAnchor (the Nearby view's browse point, set by tapping open ground -- see
// nearbyOrigin/focusNearbyOnMapPoint) distinctly from the real "You" dot drawn just above, so
// it's clear the radius/list have pivoted away from the user's actual GPS position without
// moving it.
function drawNearbyAnchorMarker(ctx, toScreen) {
  const transitionOrigin = state.selectionTransition.mapHeld && state.selectionMapTransitionOriginPoint;
  if (!state.nearbyAnchor && !transitionOrigin) return;
  if (!toScreen) toScreen = worldToScreen;
  // Rides the slide with the circle it sits at the centre of, rather than jumping to the new
  // anchor a frame before the circle gets there.
  const point = toScreen(transitionOrigin || nearbyRenderOriginPoint() || state.nearbyAnchor.point);
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
// Traces a polyline into the current path without tilt-based heading filtering.
// Used for roads and paths which should remain visible even when behind the user's
// heading direction in tilt mode (unlike terrain/sky which is culled). Returns false
// when no points were drawn (nothing to stroke).
// Items carrying a world-space `bbox` ({minX,maxX,minY,maxY}), filtered to those overlapping `view`
// without touching each item every frame: boxes live in one flat typed array built once per array
// (rebuilt if its length changes). An item with no bbox is never culled. Order is preserved.
const _bboxItemIndex = new WeakMap();
function itemsOverlappingView(items, view) {
  if (!view) return items;
  let index = _bboxItemIndex.get(items);
  if (!index || index.length !== items.length) {
    const boxes = new Float64Array(items.length * 4);
    for (let i = 0; i < items.length; i += 1) {
      const b = items[i] && items[i].bbox;
      boxes[i * 4] = b ? b.minX : -Infinity;
      boxes[i * 4 + 1] = b ? b.maxX : Infinity;
      boxes[i * 4 + 2] = b ? b.minY : -Infinity;
      boxes[i * 4 + 3] = b ? b.maxY : Infinity;
    }
    index = { length: items.length, boxes };
    _bboxItemIndex.set(items, index);
  }
  const { boxes } = index;
  const visible = [];
  for (let i = 0; i < items.length; i += 1) {
    const o = i * 4;
    if (boxes[o + 1] < view.minX || boxes[o] > view.maxX || boxes[o + 3] < view.minY || boxes[o + 2] > view.maxY) continue;
    visible.push(items[i]);
  }
  return visible;
}

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
  const w = state.canvasLogicalWidth, h = state.canvasLogicalHeight;
  const corners = [screenToWorld(0, 0), screenToWorld(w, 0), screenToWorld(0, h), screenToWorld(w, h)];
  const minWorldX = Math.min(...corners.map(c => c.x));
  const maxWorldX = Math.max(...corners.map(c => c.x));
  const minWorldY = Math.min(...corners.map(c => c.y));
  const maxWorldY = Math.max(...corners.map(c => c.y));
  const margin = (maxWorldX - minWorldX) * 0.05;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const view = { minX: minWorldX - margin, maxX: maxWorldX + margin, minY: minWorldY - margin, maxY: maxWorldY + margin };
  for (const path of itemsOverlappingView(state.paths, view)) {

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
      registerMapLabelHit("path", item.path, point, item.path.name, ctx, 12 * dpr);
    }
  }

  ctx.restore();
}

function drawRoads(ctx) {
  if (!state.roads.length) return;

  const dpr = pixelRatio();
  const zoomLevel = Math.max(0, Math.log2(state.viewport.scale / state.fitScale));

  if (zoomLevel < -0.5) return;

  const w = state.canvasLogicalWidth, h = state.canvasLogicalHeight;
  const corners = [screenToWorld(0, 0), screenToWorld(w, 0), screenToWorld(0, h), screenToWorld(w, h)];
  const minWorldX = Math.min(...corners.map(c => c.x));
  const maxWorldX = Math.max(...corners.map(c => c.x));
  const minWorldY = Math.min(...corners.map(c => c.y));
  const maxWorldY = Math.max(...corners.map(c => c.y));
  const margin = (maxWorldX - minWorldX) * 0.05;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const view = { minX: minWorldX - margin, maxX: maxWorldX + margin, minY: minWorldY - margin, maxY: maxWorldY + margin };
  for (const road of itemsOverlappingView(state.roads, view)) {

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
  const greenSpaceLabels = [];
  const namedLocalityLabels = [];
  const namedWaterLabels = [];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const feature of environmentFeaturesInView(state.environmentFeatures, view)) {
    const geometry = feature.geometry || {};
    const type = feature.properties && feature.properties.featureType;

    if (type === "hydrology_area") {
      drawEnvironmentPolygon(ctx, geometry, {
        fill: "rgba(88, 151, 212, 0.22)",
        stroke: "rgba(47, 114, 178, 0.62)",
        width: 1.1 * dpr,
      });
      const name = feature.properties && feature.properties.name;
      if (name && name.trim()) namedWaterLabels.push({ feature, geometry, name });
      continue;
    }

    if (type === "nature_designation") {
      drawEnvironmentPolygon(ctx, geometry, {
        fill: "rgba(105, 163, 94, 0.12)",
        stroke: "rgba(72, 130, 65, 0.46)",
        width: 1.1 * dpr,
      });
      const name = feature.properties && feature.properties.name;
      if (name && name.trim()) greenSpaceLabels.push({ feature, geometry, name });
      continue;
    }

    if (type === "open_land") {
      drawEnvironmentPolygon(ctx, geometry, {
        fill: "rgba(142, 178, 98, 0.16)",
        stroke: "rgba(104, 138, 62, 0.4)",
        width: 1 * dpr,
      });
      const name = feature.properties && feature.properties.name;
      if (name && name.trim()) greenSpaceLabels.push({ feature, geometry, name });
      continue;
    }

    if (type === "named_locality") {
      const name = feature.properties && feature.properties.name;
      if (name && name.trim()) namedLocalityLabels.push({ feature, geometry, name });
      continue;
    }

    if (type === "hydrology_line") {
      drawEnvironmentLines(ctx, geometry, {
        stroke: "rgba(47, 114, 178, 0.72)",
        width: 1.5 * dpr,
      });
      const name = feature.properties && feature.properties.name;
      if (name && name.trim()) namedWaterLabels.push({ feature, geometry, name });
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

  if (greenSpaceLabels.length) drawGreenSpaceLabels(ctx, greenSpaceLabels, dpr);
  if (namedLocalityLabels.length) drawNamedLocalityLabels(ctx, namedLocalityLabels, dpr, zoomLevel);
  if (namedWaterLabels.length) drawWaterFeatureLabels(ctx, namedWaterLabels, dpr, zoomLevel);

  loadBuildingsIfNeeded();
  if (state.buildingFeatures.length) {
    const BUILDINGS_FADE_MS = 1200;
    const fadeAlpha = state.buildingsRevealStartTime
      ? Math.min(1, (performance.now() - state.buildingsRevealStartTime) / BUILDINGS_FADE_MS)
      : 1;

    ctx.save();
    ctx.globalAlpha = fadeAlpha;
    // Whole-footprint bbox rather than the first vertex alone: never culls a building that
    // pokes into view, and reads a cached bbox instead of re-projecting ~20k vertices a frame.
    for (const feature of environmentFeaturesInView(state.buildingFeatures, view)) {
      const geom = feature.geometry || {};
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
  if (geometry && geometry.type === "Point") {
    const coordinates = geometry.coordinates || [0, 0];
    const point = projectLonLat(Number(coordinates[0]), Number(coordinates[1]));
    cached = { polygons: [], segments: [], point, minX: point.x, maxX: point.x, minY: point.y, maxY: point.y };
    _projectedEnvironmentGeometry.set(geometry, cached);
    return cached;
  }
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

// World-space bounds of the whole logical stage (the visible map at full resolution, with no overscan),
// padded 5% -- the same corner test drawPaths already culls with, including under tilt, where screenToWorld
// clamps to the far clip. Null when the corners do not unproject to finite points: then nothing is culled.
function environmentViewWorldBounds() {
  const w = state.canvasLogicalWidth, h = state.canvasLogicalHeight;
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

// Flat [minX, maxX, minY, maxY, ...] boxes for a feature array, built once per array (rebuilt if
// its length changes). Scanning ~28k features a frame through a WeakMap lookup each was the
// largest single cost of a pan at default zoom, where only a couple of hundred are on screen.
const _environmentBoundsIndex = new WeakMap();

function environmentFeaturesInView(features, view) {
  if (!view) return features;
  let index = _environmentBoundsIndex.get(features);
  if (!index || index.length !== features.length) {
    const boxes = new Float64Array(features.length * 4);
    for (let i = 0; i < features.length; i += 1) {
      const g = projectedEnvironmentGeometry((features[i] && features[i].geometry) || {});
      boxes[i * 4] = g.minX;
      boxes[i * 4 + 1] = g.maxX;
      boxes[i * 4 + 2] = g.minY;
      boxes[i * 4 + 3] = g.maxY;
    }
    index = { length: features.length, boxes };
    _environmentBoundsIndex.set(features, index);
  }
  const { boxes } = index;
  const visible = [];
  for (let i = 0; i < features.length; i += 1) {
    const o = i * 4;
    if (boxes[o + 1] < view.minX || boxes[o] > view.maxX || boxes[o + 3] < view.minY || boxes[o + 2] > view.maxY) continue;
    visible.push(features[i]);
  }
  return visible;
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

// Labels a nature-designation polygon with its name, but only when the polygon's own
// on-screen footprint is roomy enough for the text to sit inside it -- small reserves
// stay unlabeled rather than spilling text past their own outline. The "fits" check uses
// the polygon's cached world bbox (projectedEnvironmentGeometry) projected to a screen-space
// AABB, which stays correct under heading-up rotation and tilt since every corner goes
// through the same worldToScreen as the polygon fill itself.
function drawGreenSpaceLabels(ctx, labels, dpr) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = Math.max(10, Math.round(11 * dpr));
  ctx.font = `600 ${fontSize}px system-ui`;
  const padding = 20 * dpr;

  for (const { feature, geometry, name } of labels) {
    const bounds = projectedEnvironmentGeometry(geometry);
    const worldCenter = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    if (isBehindTiltHeading(worldCenter)) continue;

    const corners = [
      { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
      { x: bounds.minX, y: bounds.maxY }, { x: bounds.maxX, y: bounds.maxY },
    ].map(worldToScreen);
    const screenMinX = Math.min(...corners.map((c) => c.x));
    const screenMaxX = Math.max(...corners.map((c) => c.x));
    const screenMinY = Math.min(...corners.map((c) => c.y));
    const screenMaxY = Math.max(...corners.map((c) => c.y));
    const point = { x: (screenMinX + screenMaxX) / 2, y: (screenMinY + screenMaxY) / 2 };
    if (!isNearCanvas(point, 0)) continue;

    const textWidth = ctx.measureText(name).width;
    if (textWidth + padding > screenMaxX - screenMinX) continue;
    if (fontSize + padding > screenMaxY - screenMinY) continue;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 3 * dpr;
    ctx.strokeText(name, point.x, point.y);
    ctx.fillStyle = "rgba(42, 74, 44, 0.95)";
    ctx.fillText(name, point.x, point.y);
    registerMapLabelHit("environment", feature, point, name, ctx, 12 * dpr);
  }
  ctx.restore();
}

// Labels a named, boundary-less open-ground point (OSM place=locality -- e.g. a forest "plain"
// like Deershelter Plain that was never mapped as a polygon). There is no footprint to measure
// a "does it fit" check against the way drawGreenSpaceLabels has for a polygon, so this instead
// mirrors drawPaths' named-label gate: wait until zoomed in enough that a scattering of these
// points would not overwhelm the whole-forest view, same font/halo treatment as path names.
function drawNamedLocalityLabels(ctx, labels, dpr, zoomLevel) {
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  if (zoomLevel < (isCoarsePointer ? 1.45 : 1.15)) return;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(isCoarsePointer ? 9 : 10, Math.round((isCoarsePointer ? 9 : 10) * dpr))}px system-ui`;
  for (const { feature, geometry, name } of labels) {
    const worldPoint = projectedEnvironmentGeometry(geometry).point;
    if (!worldPoint || isBehindTiltHeading(worldPoint)) continue;
    const point = worldToScreen(worldPoint);
    if (!isNearCanvas(point, 28 * dpr)) continue;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 3 * dpr;
    ctx.strokeText(name, point.x, point.y);
    ctx.fillStyle = "rgba(45, 59, 52, 0.95)";
    ctx.fillText(name, point.x, point.y);
    registerMapLabelHit("environment", feature, point, name, ctx, 12 * dpr);
  }
  ctx.restore();
}

// Named water is both a visible map label and a searchable water record. Areas use the same
// fit-to-footprint rule as green spaces; named streams use a zoom gate like localities.
function drawWaterFeatureLabels(ctx, labels, dpr, zoomLevel) {
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(isCoarsePointer ? 9 : 10, Math.round((isCoarsePointer ? 9 : 10) * dpr))}px system-ui`;
  for (const { feature, geometry, name } of labels) {
    const bounds = projectedEnvironmentGeometry(geometry);
    const isArea = geometry.type === "Polygon";
    const worldPoint = isArea
      ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
      : bounds.point;
    if (!worldPoint || isBehindTiltHeading(worldPoint)) continue;
    const point = worldToScreen(worldPoint);
    if (!isNearCanvas(point, 28 * dpr)) continue;
    if (!isArea && zoomLevel < (isCoarsePointer ? 1.45 : 1.15)) continue;
    if (isArea) {
      const corners = [
        { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
        { x: bounds.minX, y: bounds.maxY }, { x: bounds.maxX, y: bounds.maxY },
      ].map(worldToScreen);
      const screenWidth = Math.max(...corners.map((corner) => corner.x)) - Math.min(...corners.map((corner) => corner.x));
      const screenHeight = Math.max(...corners.map((corner) => corner.y)) - Math.min(...corners.map((corner) => corner.y));
      if (ctx.measureText(name).width + 20 * dpr > screenWidth || ctx.font.match(/([0-9]+(?:\.[0-9]+)?)px/)?.[1] * 1 + 20 * dpr > screenHeight) continue;
    }
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 3 * dpr;
    ctx.strokeText(name, point.x, point.y);
    ctx.fillStyle = "rgba(35, 92, 133, 0.95)";
    ctx.fillText(name, point.x, point.y);
    registerMapLabelHit("water-label", feature, point, name, ctx, 12 * dpr);
  }
  ctx.restore();
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

// Inside the radius stays completely untouched ("clear"). Flat and tilted maps share one
// crisp implementation: fill everywhere except the radius shape and cone (evenodd, using the
// same ground-projected polygon path under tilt that the rest of this file uses for the same
// reason -- a plain radial gradient can't represent that foreshortened ellipse). Canvas blur
// produces visibly different feather widths in Chrome and Safari, so the boundary is kept hard
// in every browser.
function drawWalkingRadiusDimming(ctx, center, radiusPx, tilted, cone) {
  ctx.save();

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
  ctx.rect(0, 0, state.canvasLogicalWidth, state.canvasLogicalHeight);
  if (tilted) traceGroundCirclePath(ctx, center, radiusPx);
  else ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.closePath();
  if (cone) traceNearbyUserConePath(ctx, cone);
  ctx.fillStyle = WALKING_RADIUS_DIM;
  ctx.fill("evenodd");
  ctx.restore();
}

// A faint top-left-lit rim on the *inside* of the clear circle's edge -- same light direction as
// the app's top-lit shading, so a cluster zooming in to become this circle
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
  const originPoint = state.selectionTransition.mapHeld && state.selectionMapTransitionOriginPoint
    ? state.selectionMapTransitionOriginPoint
    : nearbyRenderOriginPoint();
  if (!originPoint) return;
  if (hasRealSelection() && !state.selectionTransition.mapHeld) return;

  const dpr = pixelRatio();
  // Centre and radius are measured on the flat (untilted) map, then projected as a whole —
  // measuring them post-projection would fold the perspective in twice.
  // During the cinematic fallback -> GPS handoff the camera is travelling between two world
  // positions while `state.userLocation` already names the destination. Projecting that live
  // destination through the in-flight viewport puts the ring away from the camera focus for
  // most of the tween. Hold its screen centre at the handoff focus instead; once the tween
  // lands, stopViewportAnimation clears the flag and normal world projection resumes.
  const holdingRevealFocus = state.locationRevealAnimationActive
    && state.viewportAnimationTo != null
    && state.locationRevealFocusPoint
    && Number.isFinite(state.locationRevealFocusPoint.x)
    && Number.isFinite(state.locationRevealFocusPoint.y);
  const projectedOrigin = worldToScreenFlat(originPoint);
  const center = holdingRevealFocus
    ? state.locationRevealFocusPoint
    : projectedOrigin;
  const edge = worldToScreenFlat({ x: originPoint.x + walkingRadiusWorldUnits(), y: originPoint.y });
  const radiusPx = Math.max(8, Math.hypot(edge.x - projectedOrigin.x, edge.y - projectedOrigin.y));
  const tilted = typeof tiltActive === "function" && tiltActive();

  drawWalkingRadiusDimming(ctx, center, radiusPx, tilted, nearbyUserCone(center, radiusPx, tilted));
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
  if (!canGuideToPlaces() || !target || !target.point) return null;
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
  // No shared location means no route: the stand-in origin is not where the reader is.
  if (!canGuideToPlaces() || !target) return;
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

// Every marker on the map -- a lone pin or a group -- is built by this one pass, so what is drawn
// is exactly what is tappable (findClusterHit, js/inspector.js) in the flat and the tilted view.
//
// Order of the categories: the tie-break for equal density, and the order a marker lists its
// items in.
const MARKER_TYPES = ["tree", "landmark", "cow", "path", "water"];
// Breathing room added around every marker's collision box.
const MARKER_COLLISION_GAP_CSS_PX = 4;
// Past this many items in a seed's 3x3 cell block, occupancy replaces the exact overlap count.
const MARKER_DENSITY_EXACT_LIMIT = 32;

// Grouping remembers the last build (see buildMapMarkers) so a pinch or wheel zoom does not make
// items hop between neighbouring groups or a group split and re-merge frame to frame. An item
// stays with the seed it had last time until it leaves this larger "split" box (this multiple of
// the normal collision box on each axis).
const MARKER_SPLIT_BOX_FACTOR = 1.25;
// Memory per lookup context (see markerMemoryKey): { seeds, count }, seeds a Map of seed item -> the
// items it held, in seed order, count the size of the item set it was built from. Replaced wholesale by every build in its context, so it never outlives the items.
const _markerMemory = new Map();

// A clean slate for grouping: the next build forms its groups from scratch. Called when the Nearby
// filter set changes; builds in a context whose lookup was empty also start clean.
function resetMarkerGroupMemory() {
  _markerMemory.clear();
}

// Memory belongs to one kind of lookup, so a narrowed one (an expanded cluster's members, search
// results, a held transition) never overwrites the main map's.
function markerMemoryKey() {
  if (state.selectionTransition && state.selectionTransition.mapHeld) return "held";
  if (state.searchScreenOpen && state.searchHighlightResults.length) return "search";
  if (state.clusterExpanded) return "expanded";
  return "main";
}

// The markers of what the map shows now: the one pass draw(), drawOverlay() and findClusterHit share.
function buildActiveMapMarkers(toScreen) {
  return buildMapMarkers(activeIconLookup(), toScreen, markerMemoryKey());
}

// The rectangle a compact cluster face covers with its tail and its count chip, relative to the
// anchor point. Worst case on the chip (a "99+" label), at scale 1: one uniform box for every
// marker, deliberately ignoring zoom and tilt shrink so the no-overlap guarantee is conservative.
function markerCollisionBox(dpr) {
  const rect = clusterMarkerRect(0, 0, 100, dpr, 1);
  const gap = MARKER_COLLISION_GAP_CSS_PX * dpr;
  return { width: rect.right - rect.left + gap, height: rect.bottom - rect.top + gap };
}

// Seed-anchored, single pass, deliberately not transitive (chaining A-near-B-near-C walked across
// whole dense views and merged the lot into one badge):
//  - seeds that were seeds on the previous build and are still present go first, in their previous
//    order; the other candidates follow densest first (most other items inside their own box),
//    ties broken by category then original order;
//  - a seed claims every still-unclaimed item, of any category, whose box overlaps its own, and
//    also keeps any item that was its member last time while it is inside the 1.25x split box
//    (so a kept member can sit up to that far from its seed);
//  - the marker is anchored at the seed item's own point, not at an average.
// An item that no earlier seed claimed is outside every earlier seed's box by construction, so no
// two markers can overlap (a remembered seed inside an earlier seed's box is simply absorbed).
// Building twice on the same input gives the same markers, and a pure pan never regroups.
// Grid-bounded: this runs every animation frame.
//
// Returns [{ items, itemsByType, itemType, screenPt, worldPt }]. `itemType` is the one category of
// the group, or "_mega" when the group mixes categories. A group that claimed nothing is an
// ordinary single-item pin.
function buildMapMarkers(lookup, toScreen, memoryKey = "main") {
  let memory = _markerMemory.get(memoryKey);
  const box = markerCollisionBox(pixelRatio());
  const boxW = box.width, boxH = box.height;
  const splitW = boxW * MARKER_SPLIT_BOX_FACTOR, splitH = boxH * MARKER_SPLIT_BOX_FACTOR;
  const cell = Math.max(boxW, boxH);
  const nodes = [];
  const nodeOfItem = new Map();
  for (const type of MARKER_TYPES) {
    const set = lookup && lookup[type];
    if (!set) continue;
    for (const item of set) {
      if (!item.point) continue;
      const sp = toScreen(item.point);
      if (!Number.isFinite(sp.x) || !Number.isFinite(sp.y)) continue;
      const node = { item, type, sp, order: nodes.length, density: 0, claimed: false, isSeed: false, cx: Math.floor(sp.x / cell), cy: Math.floor(sp.y / cell) };
      nodes.push(node);
      nodeOfItem.set(item, node);
    }
  }
  if (!nodes.length) {
    _markerMemory.delete(memoryKey);
    return [];
  }
  // Memory only describes the item set it was built from: when items have arrived or left (data
  // loading in, a radius or filter change) the layout starts fresh rather than inheriting an
  // order formed against a different set.
  if (memory) {
    let known = memory.count === nodes.length;
    if (known) for (const seedItem of memory.seeds.keys()) if (!nodeOfItem.has(seedItem)) { known = false; break; }
    memory = known ? memory.seeds : undefined;
  }
  // Numeric cell keys (a collision between two far-apart cells only adds candidates the exact
  // box test below rejects). A cell edge equal to the box's longer side guarantees an overlapping
  // item is never more than one cell away on either axis, so a 3x3 block never misses one.
  const cellKey = (cx, cy) => cx * 4194304 + cy;
  const grid = new Map();
  for (const node of nodes) {
    const key = cellKey(node.cx, node.cy);
    const bucket = grid.get(key);
    if (bucket) bucket.push(node);
    else grid.set(key, [node]);
  }
  // Seed priority is the number of other items inside the item's own box. In a crowded block
  // that exact count would be quadratic, so past DENSITY_EXACT_LIMIT the block's occupancy stands
  // in for it (always ranked above any exact count), keeping this linear in the item count.
  for (const node of nodes) {
    let occupancy = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(cellKey(node.cx + dx, node.cy + dy));
        if (bucket) occupancy += bucket.length;
      }
    }
    if (occupancy > MARKER_DENSITY_EXACT_LIMIT) {
      node.density = occupancy;
      continue;
    }
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(cellKey(node.cx + dx, node.cy + dy));
        if (!bucket) continue;
        for (const other of bucket) {
          if (other !== node && Math.abs(other.sp.x - node.sp.x) < boxW && Math.abs(other.sp.y - node.sp.y) < boxH) count++;
        }
      }
    }
    node.density = count;
  }
  // Last build's seeds that are still present keep their previous order and go first; the rest
  // follow densest first.
  const seeds = [];
  if (memory) {
    for (const prevItem of memory.keys()) {
      const node = nodeOfItem.get(prevItem);
      if (node && !node.isSeed) { node.isSeed = true; seeds.push(node); }
    }
  }
  const fresh = nodes.filter(node => !node.isSeed).sort((a, b) => b.density - a.density || a.order - b.order);
  for (const node of fresh) seeds.push(node);
  const markers = [];
  const nextMemory = new Map();
  for (const seed of seeds) {
    if (seed.claimed) continue;
    seed.claimed = true;
    const members = [seed];
    // New members need the normal box; members this seed held last time are kept up to the split
    // box (looked up directly, not through the grid). Both are measured from this seed, so anchors
    // stay a full box apart.
    if (seed.density) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(cellKey(seed.cx + dx, seed.cy + dy));
          if (!bucket) continue;
          for (const other of bucket) {
            if (other.claimed || Math.abs(other.sp.x - seed.sp.x) >= boxW || Math.abs(other.sp.y - seed.sp.y) >= boxH) continue;
            other.claimed = true;
            members.push(other);
          }
        }
      }
    }
    const held = memory && memory.get(seed.item);
    if (held) {
      for (const heldItem of held) {
        const other = nodeOfItem.get(heldItem);
        if (!other || other.claimed || Math.abs(other.sp.x - seed.sp.x) >= splitW || Math.abs(other.sp.y - seed.sp.y) >= splitH) continue;
        other.claimed = true;
        members.push(other);
      }
    }
    if (members.length > 1) members.sort((a, b) => a.order - b.order);
    const itemsByType = {};
    const items = new Array(members.length);
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      items[i] = member.item;
      (itemsByType[member.type] || (itemsByType[member.type] = [])).push(member.item);
    }
    nextMemory.set(seed.item, items);
    const types = Object.keys(itemsByType);
    markers.push({
      items,
      itemsByType,
      itemType: types.length > 1 ? "_mega" : types[0],
      screenPt: seed.sp,
      worldPt: seed.item.point,
    });
  }
  _markerMemory.set(memoryKey, { seeds: nextMemory, count: nodes.length });
  return markers;
}

// The items of a tapped group by category: every marker carries this, and a hand-built
// single-category group ({ itemType, items }) reads the same way.
function clusterItemsByType(group) {
  if (group.itemsByType) return group.itemsByType;
  return group.itemType ? { [group.itemType]: group.items || [] } : {};
}

// Every draw() call rebuilds the markers from scratch (buildMapMarkers above), so there's no
// persistent cluster identity to animate between frames -- only the underlying items (the same
// tree/place/cow objects every frame, drawn fresh each time) have one. This tracks, per item,
// the cluster size it was drawn in last frame; when that jumps from a lone pin (1) to a group
// (>1) it's a genuine merge, and rather than just vanishing there, the item's own pin shrinks
// away to nothing while the cluster's pin grows in. Deliberately a size change, not a slide to
// the centroid (tried first, then dropped): a slide has to interpolate a screen *position*
// across frames, and the ordinary way a merge actually happens is mid pan/zoom, where the
// camera transform itself changes every frame -- a slide either has to fight that motion from a
// position frozen at join start, or constantly re-derive it, and either way reads as nothing at
// all or a glitch right when the zoom that caused the merge is what you're looking at. A pure
// size change has no such problem: every pin, shrinking or not, is always drawn at wherever
// *this* frame's camera already puts it -- only how big it's drawn changes. A cooldown after
// each animation finishes stops an item sitting right on the clustering radius boundary from
// restarting the shrink every time a pan/zoom nudges it in and out of range.
const CLUSTER_JOIN_ANIMATION_MS = 260;
const CLUSTER_JOIN_COOLDOWN_MS = 400;
// A pin scaled to exactly 0 hits drawImage's zero-size edge case in some engines and is
// pointless to attempt anyway (nothing would be visible); this floor keeps it a real, if tiny,
// draw for the first frame of a shrink or grow.
const CLUSTER_JOIN_MIN_SCALE = 0.05;
const _prevClusterSizeByItem = new Map();
const _clusterJoinAnimations = new Map();
const _clusterJoinCooldownUntil = new Map();

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Filter changes are rendered on canvas, so a CSS transition cannot animate the pins without
// also scaling the whole map bitmap. Keep the motion at the marker level instead: new pins fade
// in at their normal size, while pins removed by a filter fade first and only shrink during the
// final part of their exit. The short duration keeps this perceptual polish from making a filter
// feel slow, and the artwork itself is still drawn through the normal high-resolution icon paths.
const FILTER_PIN_ANIMATION_MS = 340;
const FILTER_PIN_ENTER_POP_SCALE = 1.05;
const FILTER_PIN_ENTER_POP_PEAK = 0.2;
const FILTER_PIN_ENTER_POP_END = 0.58;
const FILTER_PIN_EXIT_SCALE = 0.06;
const FILTER_PIN_EXIT_SHRINK_START = 0.64;
const _filterPinAnimations = new Map();

function filterPinAnimationFor(item, now = performance.now()) {
  const animation = _filterPinAnimations.get(item);
  if (!animation) return null;
  const progress = clamp((now - animation.startedAt) / FILTER_PIN_ANIMATION_MS, 0, 1);
  if (progress >= 1) return null;
  const alphaProgress = easeOutCubic(progress);
  const enterPopProgress = animation.direction === "enter"
    ? progress <= FILTER_PIN_ENTER_POP_PEAK
      ? easeOutCubic(progress / FILTER_PIN_ENTER_POP_PEAK)
      : 1 - Math.pow(
        clamp((progress - FILTER_PIN_ENTER_POP_PEAK) /
          (FILTER_PIN_ENTER_POP_END - FILTER_PIN_ENTER_POP_PEAK), 0, 1),
        3,
      )
    : 0;
  const shrinkProgress = animation.direction === "exit"
    ? clamp((progress - FILTER_PIN_EXIT_SHRINK_START) / (1 - FILTER_PIN_EXIT_SHRINK_START), 0, 1)
    : 0;
  const scaleProgress = easeOutCubic(shrinkProgress);
  return {
    scale: animation.direction === "enter"
      ? animation.fromScale + (FILTER_PIN_ENTER_POP_SCALE - animation.fromScale) * enterPopProgress
      : animation.fromScale + (animation.toScale - animation.fromScale) * scaleProgress,
    alpha: animation.fromAlpha + (animation.toAlpha - animation.fromAlpha) * alphaProgress,
  };
}

function filterPinClusterScale(cluster, now = performance.now()) {
  let scale = 1;
  for (const item of cluster.items || []) {
    const animation = filterPinAnimationFor(item, now);
    if (animation) scale = Math.min(scale, animation.scale);
  }
  return scale;
}

function filterPinTransitionActive(now = performance.now()) {
  let active = false;
  for (const [item, animation] of _filterPinAnimations) {
    if (now - animation.startedAt >= FILTER_PIN_ANIMATION_MS) {
      _filterPinAnimations.delete(item);
    } else {
      active = true;
    }
  }
  return active;
}

// Called immediately after state.overviewFilters changes, while `previousLookup` still holds
// the pins from the previous filter set. The next lookup is built from the new state and the
// two sets are compared by object identity, which matches the renderer's existing dataset
// model and avoids introducing a synthetic marker key for every feature type.
function beginOverviewFilterPinTransition(previousLookup) {
  resetMarkerGroupMemory();
  if (!previousLookup || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    _filterPinAnimations.clear();
    return;
  }
  const nextLookup = buildNearbyIconLookup();
  const now = performance.now();
  _filterPinAnimations.clear();
  for (const type of ["tree", "landmark", "cow", "path", "water"]) {
    const before = previousLookup[type] || new Set();
    const after = nextLookup[type] || new Set();
    for (const item of after) {
      if (!before.has(item)) {
        _filterPinAnimations.set(item, {
          startedAt: now,
          fromScale: 1,
          toScale: 1,
          fromAlpha: 0,
          toAlpha: 1,
          direction: "enter",
          type,
        });
      }
    }
    for (const item of before) {
      if (!after.has(item)) {
        _filterPinAnimations.set(item, {
          startedAt: now,
          fromScale: 1,
          toScale: FILTER_PIN_EXIT_SCALE,
          fromAlpha: 1,
          toAlpha: 0,
          direction: "exit",
          type,
        });
      }
    }
  }
  if (_filterPinAnimations.size && typeof requestDraw === "function") requestDraw();
}

// Removed pins are no longer part of the active lookup, so draw them briefly on the overlay
// while they shrink. This keeps the normal clustered renderer authoritative for visible pins,
// and means the outgoing marker never has to be resurrected in the hit-test lookup.
function drawFilterTransitionPins(ctx, toScreen) {
  _drawnTransitionSpecs = [];
  if (!filterPinTransitionActive()) return;
  const dpr = pixelRatio();
  const iconSize = MAP_PNG_ICON_SIZE * dpr * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
  const reveal = nearbyRevealOpacity();
  for (const [item, animation] of _filterPinAnimations) {
    if (animation.direction !== "exit") continue;
    const stateAtFrame = filterPinAnimationFor(item);
    if (!stateAtFrame || !item.point) continue;
    const point = toScreen(item.point);
    const tiltScale = typeof tiltPinScale === "function" ? tiltPinScale(item.point) : 1;
    const scale = stateAtFrame.scale * tiltScale;
    if (!isNearCanvas(point, iconSize * 2)) continue;
    _drawnTransitionSpecs.push({ worldPt: item.point, count: 1, scale: iconSize * scale / (MAP_PNG_ICON_SIZE * MAP_ICON_SCALE_UNSELECTED * dpr) });
    ctx.save();
    ctx.globalAlpha = reveal * stateAtFrame.alpha;
    drawItemPin(ctx, animation.type, item, point.x, point.y, iconSize * scale);
    ctx.restore();
  }
}

// Resolves every in-flight cluster-join animation to its settled end state immediately, with
// no further frames of shrinking/growing. stopViewportAnimation() (js/app.js) calls this: that
// function already means "abruptly snap to now, no animation in flight" for the *camera*, and a
// pin-level animation left running past that point is the same kind of staleness -- the camera
// has stopped changing, so a merge that was genuinely still converging a moment ago has nothing
// left to converge *toward* that isn't already on screen. Without this, an animation that
// started during whatever camera motion just got interrupted keeps running for up to
// CLUSTER_JOIN_ANIMATION_MS afterwards against an unmoving view, which is exactly what made the
// "settle the camera, draw once, screenshot" pattern several e2e specs use flaky: the settled
// frame could still catch pins mid-shrink depending on exactly when the interruption landed.
function settleClusterJoinAnimations() {
  _clusterJoinAnimations.clear();
  // Also forget which size each item was last drawn in: a lone-to-group jump is what starts a
  // join, so without this the very next draw after a camera change would start one again.
  _prevClusterSizeByItem.clear();
}

// Returns null when a cluster's items should draw exactly as they always have (a lone pin, or
// a group with no merge in flight). Otherwise returns { shrinking, badgeScale }: shrinking is
// one { item, scale } per item still shrinking away at its own pin position, for the caller to
// draw with that item's own icon at `iconSize * scale` in place of (or alongside) the merged
// pin; badgeScale is how large to draw the merged pin/count-badge -- full size unless every
// member is newly joining (a brand-new cluster forming from scratch), in which case the badge
// grows in with the same motion so it doesn't just pop in at full size the instant the last pin
// arrives.
function clusterJoinAnimationState(cluster, now = performance.now()) {
  const items = cluster.items;
  if (items.length <= 1) {
    const only = items[0];
    if (only) {
      _clusterJoinAnimations.delete(only);
      _prevClusterSizeByItem.set(only, 1);
    }
    return null;
  }

  const shrinking = [];
  let maxEased = 0;
  // A cluster is "forming from scratch" -- and so gets its badge growing in alongside the
  // shrinking pins -- only while every single member is still mid-join. The moment any member
  // has no active join (it was already a settled part of a bigger cluster, or its join just
  // finished), the badge itself already exists at full size: only wasLone, captured once when
  // each item's own animation was created, decides this, never a fresh per-frame lookup -- by
  // the second frame _prevClusterSizeByItem already reads the merged size for every member,
  // which would otherwise make a long-settled cluster look "new" again.
  let allStillJoiningFromScratch = true;
  for (const item of items) {
    let anim = _clusterJoinAnimations.get(item);
    if (!anim) {
      // Strictly "was drawn alone last frame", not merely "never tracked" -- the latter is also
      // true the first time an item is ever seen at all (page load, entering the nearby set),
      // when it was never actually visible as a separate pin for this animation to shrink away
      // from.
      const wasLone = _prevClusterSizeByItem.get(item) === 1;
      if (wasLone && !(_clusterJoinCooldownUntil.get(item) > now)) {
        anim = { startedAt: now, wasLone };
        _clusterJoinAnimations.set(item, anim);
      }
    }
    if (anim) {
      const t = Math.min(1, (now - anim.startedAt) / CLUSTER_JOIN_ANIMATION_MS);
      if (t >= 1) {
        _clusterJoinAnimations.delete(item);
        _clusterJoinCooldownUntil.set(item, now + CLUSTER_JOIN_COOLDOWN_MS);
        allStillJoiningFromScratch = false;
      } else {
        if (!anim.wasLone) allStillJoiningFromScratch = false;
        const eased = easeOutCubic(t);
        maxEased = Math.max(maxEased, eased);
        shrinking.push({ item, scale: Math.max(CLUSTER_JOIN_MIN_SCALE, 1 - eased) });
      }
    } else {
      allStillJoiningFromScratch = false;
    }
    _prevClusterSizeByItem.set(item, items.length);
  }

  if (!shrinking.length) return null;
  if (typeof requestDraw === "function") requestDraw();
  const badgeScale = allStillJoiningFromScratch ? Math.max(CLUSTER_JOIN_MIN_SCALE, maxEased) : 1;
  return { shrinking, badgeScale };
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

// A tree's own pin artwork: its species icon, or the generic tree icon when the species has none.
// Only draws a species icon when every given tree would independently draw that exact icon; any
// disagreement falls back to the generic tree icon, so a mixed set never claims one species.
function clusterTreeIconSrc(items) {
  const iconFor = (item) => (typeof treeSpeciesIconPath === "function" && treeSpeciesIconPath(item.commonName, item.latinName)) || iconPath("tree");
  const first = iconFor(items[0]);
  for (let i = 1; i < items.length; i++) {
    if (iconFor(items[i]) !== first) return iconPath("tree");
  }
  return first;
}

// The icon a single item draws in its pin, so a group's face shows the *actual* glyph for what is
// inside it. Station items keep their vector transport glyphs.
function markerItemIconSrc(type, item) {
  switch (type) {
    case "tree":
      return clusterTreeIconSrc([item]);
    case "cow":
      return iconPath("cow");
    case "path":
      return iconPath("waymarked");
    case "water":
      return iconPath("ponds");
    case "landmark": {
      if (isPubCategory(item)) return iconPath("beer");
      if (isCafeCategory(item)) return iconPath("cafe");
      if (isShopCategory(item)) return iconPath("shop");
      if (isTransportCategory(item)) {
        const transportType = getTransportType(item);
        if (transportType === "parking") return iconPath("landmark-parking");
        if (transportType === "underground" || transportType === "national_rail") return `vector:${transportType}`;
        return iconPath("bus");
      }
      const slug = placeIconSlug(item);
      return (slug && iconPath(slug)) || iconPath("pin");
    }
    default:
      return iconPath("pin");
  }
}

// The chips a group's face shows (at most two). Kinds are what artwork tells apart: tree species
// sharing an icon share a slot, landmarks split by the pin they draw (pub, cafe, shop, station,
// ...), and cows, paths and water are one kind each. A group of several categories shows one chip
// per category first -- the categories with most items first, ties in category order, each as its
// most common kind -- so no category is hidden behind another's species; only a single-category
// group shows its second most common kind as the second chip.
function clusterPreviewEntries(marker, byCategory = clusterKindsByCategory(marker)) {
  if (byCategory.length === 1) return byCategory[0].kinds.slice(0, 2);
  return byCategory.slice(0, 2).map(category => category.kinds[0]);
}

function clusterKindsByCategory(marker) {
  const byCategory = [];
  for (const type of MARKER_TYPES) {
    const items = marker.itemsByType[type];
    if (!items || !items.length) continue;
    const byKey = new Map();
    for (const item of items) {
      const src = markerItemIconSrc(type, item);
      const key = type === "tree" ? `tree:${src}` : type === "landmark" ? `landmark:${landmarkClusterKey(item)}` : type;
      const entry = byKey.get(key);
      if (entry) entry.count++;
      else byKey.set(key, { key, src, count: 1, itemType: type });
    }
    byCategory.push({ total: items.length, kinds: Array.from(byKey.values()).sort((a, b) => b.count - a.count) });
  }
  byCategory.sort((a, b) => b.total - a.total);
  return byCategory;
}

// The face previews at most two visual kinds. The remaining kinds feed the small stack behind
// those preview chips; matching by key keeps the visible/hidden split aligned with the preview
// ordering for both a single category and a mixed-category group.
function clusterOverflowEntries(marker, byCategory = clusterKindsByCategory(marker)) {
  const visible = new Set(clusterPreviewEntries(marker, byCategory).map(entry => entry.key));
  return byCategory.flatMap(category => category.kinds).filter(entry => !visible.has(entry.key));
}

// One category's icon, cropped to a circle, sitting directly on the badge underneath it -- no
// white disc of its own any more. Each map icon already carries its own coloured circular
// background baked into the artwork (the same icon appModule/appIconHtml use everywhere else),
// so a white backing behind it here was a second, redundant background rather than something
// the icon needed to read clearly -- just one more layer in an already layered badge. The
// circular clip stays: it is what keeps a square icon image from spilling past chipR at its
// corners, not what gives it a background. Draws nothing (leans on getMapImage's own redraw
// once loaded) if the icon image hasn't finished loading yet.
function drawClusterIconChip(ctx, x, y, src, chipR) {
  if (src === "vector:underground" || src === "vector:national_rail") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, chipR, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    const drawGlyph = src === "vector:underground" ? drawUndergroundGlyph : drawNationalRailGlyph;
    drawGlyph(ctx, x, y, chipR * 1.65);
    ctx.restore();
    return;
  }
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

// A group's marker is the compact pin-sized face: its tail is the group's anchor, the artwork sits
// in the head, and the count chip protrudes at the top right. Shared geometry keeps the whole face
// tappable and measurable in flat and tilted views; `scale` shrinks it (tilt, merge animation).
function clusterBadgeGeometry(x, y, count, dpr, scale = 1) {
  const unit = dpr * scale;
  const label = count > 99 ? "99+" : String(count);
  const size = MAP_PNG_ICON_SIZE * MAP_ICON_SCALE_UNSELECTED * unit;
  const R = size * 0.32;
  const width = R * 2.4, height = R * 2, bottom = y - R * 0.3;
  const top = bottom - height;
  const countWidth = (label.length > 2 ? 28 : 22) * unit;
  return { left: x - width / 2, top, bottom, width, height, unit, label, size,
    countX: x + width / 2 - 4 * unit, countY: top + 3 * unit, countWidth, countHeight: 18 * unit };
}

// Everything a marker paints: face, tail and the protruding count chip.
function clusterMarkerRect(x, y, count, dpr, scale = 1) {
  const b = clusterBadgeGeometry(x, y, count, dpr, scale);
  return {
    left: b.left,
    right: Math.max(b.left + b.width, b.countX + b.countWidth / 2),
    top: Math.min(b.top, b.countY - b.countHeight / 2),
    bottom: y,
  };
}

// What a marker actually paints, as rectangles: the face, the count chip (groups only, at its real
// label width) and the narrow pointer down to the anchor. Unlike clusterMarkerRect's bounding box
// this leaves out the empty corners beside the pointer, so the "You" label can sit there.
function markerPaintedRects(x, y, count, dpr, scale = 1) {
  const b = clusterBadgeGeometry(x, y, count, dpr, scale);
  const R = b.size * 0.32;
  const rects = [
    { left: b.left, right: b.left + b.width, top: b.top, bottom: b.bottom },
    { left: x - R * 0.3, right: x + R * 0.3, top: b.bottom, bottom: y },
  ];
  if (count > 1) {
    rects.push({ left: b.countX - b.countWidth / 2, right: b.countX + b.countWidth / 2,
      top: b.countY - b.countHeight / 2, bottom: b.countY + b.countHeight / 2 });
  }
  return rects;
}

function clusterBadgeContains(screen, x, y, count, dpr, scale = 1) {
  const b = clusterBadgeGeometry(x, y, count, dpr, scale);
  const pad = 3 * dpr;
  if (Math.abs(screen.x - b.countX) <= b.countWidth / 2 + pad
    && Math.abs(screen.y - b.countY) <= b.countHeight / 2 + pad) return true;
  return screen.x >= b.left - pad && screen.x <= b.left + b.width + pad
    && screen.y >= b.top - pad && screen.y <= y + pad;
}

// The overflow chips form a distinct lower layer beneath the two preview chips. Keeping at most two
// larger peek icons inside the white head makes the affordance legible on a phone; the plus covers
// the rest without giving the group another pointer or changing its collision/hit geometry.
function clusterStackChipGeometry(x, y, count, dpr, scale = 1, index = 0, total = 1) {
  const b = clusterBadgeGeometry(x, y, count, dpr, scale);
  const R = b.size * 0.32;
  const chipR = total <= 2 ? R * 0.3 : R * 0.26;
  const offsets = total === 1
    ? [-0.24]
    : total === 2
      ? [-0.38, 0.38]
      : [-0.45, 0, 0.45];
  const xOffset = offsets[Math.min(index, offsets.length - 1)] * R;
  const yOffset = total === 1 ? 0.5 : 0.52;
  return { cx: x + xOffset, cy: b.top + b.height * 0.5 + yOffset * R, radius: chipR };
}

// The plus sits in front of the hidden artwork, making the stack read as an affordance rather
// than a second row of equally-weighted pins. It is deliberately a small disc with no number:
// the group's existing count remains the only text and the visible artwork stays legible around it.
function clusterMorePlusGeometry(x, y, count, dpr, scale = 1, total = 1) {
  const b = clusterBadgeGeometry(x, y, count, dpr, scale);
  const R = b.size * 0.32;
  return {
    cx: x + (total === 1 ? 0.24 : 0) * R,
    cy: b.top + b.height * 0.5 + 0.52 * R,
    radius: R * 0.31,
    unit: b.unit,
  };
}

function drawClusterMorePlus(ctx, geometry) {
  const { cx, cy, radius, unit } = geometry;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#233d30";
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1.25 * unit;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.43, cy);
  ctx.lineTo(cx + radius * 0.43, cy);
  ctx.moveTo(cx, cy - radius * 0.43);
  ctx.lineTo(cx, cy + radius * 0.43);
  ctx.lineCap = "round";
  ctx.lineWidth = 1.5 * unit;
  ctx.stroke();
}

// One artwork fills the head; two (the two most common kinds) sit side by side in it.
function drawClusterMarker(ctx, x, y, count, iconSources, dpr, scale = 1, overflowSources = []) {
  const sources = iconSources.slice(0, 2);
  const b = clusterBadgeGeometry(x, y, count, dpr, scale);
  const u = b.unit;
  ctx.save();
  const { cx, cy, R } = drawMapPinShape(ctx, x, y, b.size);
  const stackSources = overflowSources.slice(0, 2);
  stackSources.forEach((src, i) => {
    const chip = clusterStackChipGeometry(x, y, count, dpr, scale, i, stackSources.length);
    drawClusterIconChip(ctx, chip.cx, chip.cy, src, chip.radius);
  });
  if (stackSources.length) {
    drawClusterMorePlus(ctx, clusterMorePlusGeometry(x, y, count, dpr, scale, stackSources.length));
  }
  const previewCy = stackSources.length ? cy - R * 0.22 : cy;
  const previewRadius = stackSources.length ? R * 0.43 : R * 0.52;
  if (sources.length === 1) {
    drawClusterIconChip(ctx, cx, stackSources.length ? cy - R * 0.18 : cy, sources[0], stackSources.length ? R * 0.72 : R * 0.86);
  } else {
    sources.forEach((src, i) => drawClusterIconChip(ctx, cx + (i ? 1 : -1) * R * 0.48, previewCy, src, previewRadius));
  }
  ctx.beginPath();
  ctx.roundRect(b.countX - b.countWidth / 2, b.countY - b.countHeight / 2, b.countWidth, b.countHeight, 9 * u);
  ctx.fillStyle = "#233d30";
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${11 * u}px system-ui`;
  ctx.fillText(b.label, b.countX, b.countY);
  ctx.restore();
}

// What a lone pin draws for one item, at `size`.
function drawItemPin(ctx, type, item, x, y, size) {
  if (type === "tree") return drawPngMapIcon(ctx, clusterTreeIconSrc([item]), x, y, size);
  if (type === "landmark") return drawLandmarkIcon(ctx, item, x, y, size);
  if (type === "cow") return drawPngMapIcon(ctx, iconPath("cow"), x, y, size);
  if (type === "path") return drawPngMapIcon(ctx, iconPath("waymarked"), x, y, size);
  if (type === "water") return drawPngMapIcon(ctx, iconPath("ponds"), x, y, size);
  return false;
}

function markerItemType(marker, item) {
  for (const type of MARKER_TYPES) {
    const items = marker.itemsByType[type];
    if (items && items.includes(item)) return type;
  }
  return null;
}

// Only landmarks and cows dim with the active filter/selection; the other pins never did.
function lonePinOpacity(type, item) {
  return type === "landmark" || type === "cow" ? markerOpacityFor(type, item) : 1;
}

// A group is as strong as its strongest member, so a group of dimmed pins dims like its neighbours.
function groupOpacity(marker) {
  let best = 0;
  for (const type of MARKER_TYPES) {
    const items = marker.itemsByType[type];
    if (!items) continue;
    for (const item of items) {
      best = Math.max(best, lonePinOpacity(type, item));
      if (best >= 1) return 1;
    }
  }
  return best;
}

// While a location is selected the Nearby pins give way to the selected destination.
function pinsHiddenBySelection(tilted) {
  if (state.selectionTransition.mapHeld) return false;
  if (tilted) return selectedNavigationMapModeActive();
  return Boolean(state.selected && MARKER_TYPES.includes(state.selected.type));
}

// What the last drawMapMarkers call (and drawFilterTransitionPins) painted -- world point, item
// count and drawn scale -- so drawUser can derive each marker's rectangle in its own coordinates
// and steer the "You" label clear of them.
let _drawnMarkerSpecs = [];
let _drawnTransitionSpecs = [];

// Draws every marker in one pass, flat (main canvas) or tilted/heading-up (overlay). Painted in
// ascending screen Y so a marker lower on screen -- closer to the viewer -- paints over one further
// up, across all categories; faces cannot overlap, so this only orders tails, chips and labels.
function drawMapMarkers(ctx, markers, toScreen, tilted = false) {
  _drawnMarkerSpecs = [];
  if (!markers.length || pinsHiddenBySelection(tilted)) return;
  const dpr = pixelRatio();
  const loneSize = MAP_PNG_ICON_SIZE * dpr * mapEmojiScale() * MAP_ICON_SCALE_UNSELECTED;
  const reveal = nearbyRevealOpacity();
  const visible = markers.filter(m => isNearCanvas(m.screenPt, m.items.length > 1 ? 84 * dpr : loneSize * 2));
  visible.sort((a, b) => a.screenPt.y - b.screenPt.y);
  ctx.save();
  for (const marker of visible) {
    const { screenPt, items, worldPt } = marker;
    const tiltScale = tilted ? tiltPinScale(worldPt) : 1;
    const joinState = clusterJoinAnimationState(marker);
    const joinScale = joinState ? joinState.badgeScale : 1;
    if (items.length > 1) {
      ctx.globalAlpha = reveal * groupOpacity(marker);
      const groupScale = Math.max(0.65, tiltScale) * joinScale * filterPinClusterScale(marker);
      _drawnMarkerSpecs.push({ worldPt, count: items.length, scale: groupScale });
      const kinds = clusterKindsByCategory(marker);
      const overflow = clusterOverflowEntries(marker, kinds);
      drawClusterMarker(ctx, screenPt.x, screenPt.y, items.length,
        clusterPreviewEntries(marker, kinds).map(entry => entry.src), dpr, groupScale, overflow.map(entry => entry.src));
    } else {
      const type = marker.itemType;
      const animation = filterPinAnimationFor(items[0]);
      ctx.globalAlpha = reveal * lonePinOpacity(type, items[0]) * (animation ? animation.alpha : 1);
      const pinSize = loneSize * tiltScale * joinScale * (animation ? animation.scale : 1);
      _drawnMarkerSpecs.push({ worldPt, count: 1, scale: pinSize / (MAP_PNG_ICON_SIZE * MAP_ICON_SCALE_UNSELECTED * dpr) });
      drawItemPin(ctx, type, items[0], screenPt.x, screenPt.y, pinSize);
    }
    if (joinState) {
      for (const shrinking of joinState.shrinking) {
        const p = toScreen(shrinking.item.point);
        const type = markerItemType(marker, shrinking.item);
        ctx.globalAlpha = reveal * lonePinOpacity(type, shrinking.item);
        drawItemPin(ctx, type, shrinking.item, p.x, p.y, loneSize * shrinking.scale);
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// Draws just the operator's glyph, centred at (cx, cy) and sized sizePx wide/tall -- the shared
// white teardrop pointer these sit inside (see below) already supplies the circular backing every
// other map icon has, so National Rail's own white disc (this used to draw one) would only be a
// redundant second background on top of the pin's own head.
function drawUndergroundGlyph(ctx, cx, cy, sizePx) {
  const scale = sizePx / 24;
  ctx.save();
  ctx.translate(cx - 12 * scale, cy - 12 * scale);
  ctx.scale(scale, scale);

  ctx.fillStyle = "#C9181E";
  const path = new Path2D("M12 2.25a9.73 9.73 0 0 0-9.49 7.5H0v4.5h2.51a9.73 9.73 0 0 0 9.49 7.5c4.62 0 8.48-3.2 9.49-7.5H24v-4.5h-2.51A9.73 9.73 0 0 0 12 2.25zM12 6c2.5 0 4.66 1.56 5.56 3.75H6.44A6.02 6.02 0 0 1 12 6zm-5.56 8.25h11.12A6.02 6.02 0 0 1 12 18a6.02 6.02 0 0 1-5.56-3.75Z");
  ctx.fill(path);

  ctx.restore();
}

function drawNationalRailGlyph(ctx, cx, cy, sizePx) {
  const scale = sizePx / 24;
  ctx.save();
  ctx.translate(cx - 12 * scale, cy - 12 * scale);
  ctx.scale(scale, scale);

  ctx.fillStyle = "#C9181E";
  const path = new Path2D("M0 12C0 5.373 5.372 0 12 0c6.627 0 11.999 5.373 11.999 12 0 6.628-5.372 12-11.999 12-6.628 0-12-5.372-12-12Zm6.195-5.842 6.076 2.794H2.835v1.884h9.499l-4.616 2.246H2.835v1.868h4.883l5.778 2.795h4.333l-6.092-2.795h9.469v-1.868h-9.453l4.616-2.246h4.837V8.952h-4.868l-5.777-2.794H6.195");
  ctx.fill(path);

  ctx.restore();
}

// These two used to draw their glyph bare, at a fixed 8px (or, for the selected rail logo, a
// mismatched 26px), with no pointer behind it -- a quarter the size of every other pin and the
// only markers on the map without the white teardrop every other one sits in. `size` is now the
// same full pin size every drawPngMapIcon call already receives, so a station reads as the same
// kind of marker as its neighbours: same pointer, same standard/selected size tier, just its own
// glyph instead of a PNG inside the head.
const _stationMotionArt = new Map();

function drawStationMapIcon(ctx, x, y, size, slug, drawGlyph, motion) {
  ctx.save();
  const { cx, cy, R } = drawMapPinShape(ctx, x, y, size);
  const iconSize = R * 1.85;
  if (motion) {
    if (!_stationMotionArt.has(slug)) {
      const artwork = document.createElement("canvas");
      artwork.width = artwork.height = 256;
      drawGlyph(artwork.getContext("2d"), 128, 128, 256);
      _stationMotionArt.set(slug, artwork);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.96, 0, Math.PI * 2);
    ctx.clip();
    if (IconMotion.draw(ctx, _stationMotionArt.get(slug), slug,
      cx - iconSize / 2, cy - iconSize / 2, iconSize, motion.elapsed)) {
      _selectedIconMotionDrawn = true;
    }
  } else {
    drawGlyph(ctx, cx, cy, iconSize);
  }
  ctx.restore();
}

function drawUndergroundRoundel(ctx, x, y, size, motion = null) {
  drawStationMapIcon(ctx, x, y, size, "underground-roundel", drawUndergroundGlyph, motion);
}

function drawNationalRailLogo(ctx, x, y, size, motion = null) {
  drawStationMapIcon(ctx, x, y, size, "national-rail-logo", drawNationalRailGlyph, motion);
}

function selectedIconScale(minScale = 1.05, maxScale = 1.17) {
  // Character motion belongs inside the artwork, never in the pin's geometry.
  const baseScale = (minScale + maxScale) / 2;
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
  if (!origin) {
    // No origin to scan from -- but on a /nearby/<slug> arrival (subfilter or group page alike)
    // buildFullNearbyIconLookup's fallback below still shows every match for the active
    // filter(s), so the key must still tell different filter sets apart rather than every
    // no-location state colliding on one constant "none".
    return `none|${state.overviewFilters.join(",")}`;
  }
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
// On the Community screen the map shows only what the user has marked (drawCommunityMarks), so no
// ordinary pins are drawn or tappable underneath.
const COMMUNITY_EMPTY_ICON_LOOKUP = Object.freeze({
  tree: new Set(), landmark: new Set(), cow: new Set(), path: new Set(), water: new Set(), outOfRadius: new Set(),
});
const SELECTED_NAVIGATION_EMPTY_ICON_LOOKUP = Object.freeze({
  tree: new Set(), landmark: new Set(), cow: new Set(), path: new Set(), water: new Set(), outOfRadius: new Set(),
});

// Once a real location is selected for navigation, the map is a two-point view: the walker's
// position and the chosen destination. Nearby pins are useful while browsing, but leaving them
// underneath a selected route makes it unclear which marker the route is leading to. Use the
// shared target resolver so this also covers road navigation, whose selected type is not one of
// the point-pin categories.
function selectedNavigationMapModeActive() {
  return Boolean(
    state.selected?.item
    && typeof selectedCompassTarget === "function"
    && selectedCompassTarget(),
  );
}

function activeIconLookup() {
  if (state.selected && state.selected.type === "community") return COMMUNITY_EMPTY_ICON_LOOKUP;
  // Keep the outgoing Nearby pins under the selected destination while the inspector and camera
  // handoff is in flight. The selected route/icon may not be drawable on the first frame (the
  // routing graph and map artwork can both still be loading), and clearing the Nearby lookup at
  // that exact moment leaves a blank map between the two states.
  if (state.selectionTransition.mapHeld && state.selectionMapTransitionIconLookup) {
    return state.selectionMapTransitionIconLookup;
  }
  if (state.selectionTransition.mapHeld) return buildNearbyIconLookup();
  if (selectedNavigationMapModeActive()) return SELECTED_NAVIGATION_EMPTY_ICON_LOOKUP;
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
  // A mixed group's own itemType is the synthetic "_mega", not one of the Sets above, so the
  // restore goes by the group's per-category breakdown.
  for (const [itemType, items] of Object.entries(clusterItemsByType(group))) {
    if (result[itemType]) result[itemType] = new Set(items);
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
  // Mirrors overviewNearestHtml's own no-location fallback (js/app.js): without an origin,
  // overviewItemsForActiveFilter() always returns nothing to scan from, which used to mean the
  // map drew no pins at all for a /nearby/<slug> page -- the list showed every match, the map
  // showed none of them. Gated the same way that fallback is -- see
  // activeFiltersShowFullListWithoutLocation's comment (js/app.js).
  const sourceEntries = (!state.userLocation && activeFiltersShowFullListWithoutLocation())
    ? allEntriesForActiveFilters()
    : overviewItemsForActiveFilter();
  for (const entry of sourceEntries) {
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
  if (state.selected && !state.selectionTransition.mapHeld
      && ["tree", "landmark", "cow", "path", "water"].includes(state.selected.type)) return false;
  const typeSet = nearbyIconLookup && nearbyIconLookup[type];
  return Boolean(typeSet && typeSet.has(item));
}

// The pub/cafe/shop/transport/icon-slug/emoji chain a landmark pin picks its artwork from,
// factored out so a shrinking pin mid-merge (drawMapMarkers) can draw the same artwork
// for its own place at its own size, not just the cluster's representative item.
function drawLandmarkIcon(ctx, place, x, y, iconSize) {
  if (isPubCategory(place)) {
    return drawPngMapIcon(ctx, iconPath("beer"), x, y, iconSize);
  }
  if (isCafeCategory(place)) {
    return drawPngMapIcon(ctx, iconPath("cafe"), x, y, iconSize);
  }
  if (isShopCategory(place)) {
    return drawPngMapIcon(ctx, iconPath("shop"), x, y, iconSize);
  }
  if (isTransportCategory(place)) {
    const transportType = getTransportType(place);
    if (transportType === "underground") {
      drawUndergroundRoundel(ctx, x, y, iconSize);
      return false;
    }
    if (transportType === "national_rail") {
      drawNationalRailLogo(ctx, x, y, iconSize);
      return false;
    }
    if (transportType === "parking") {
      return drawPngMapIcon(ctx, iconPath("landmark-parking"), x, y, iconSize);
    }
    return drawPngMapIcon(ctx, iconPath("bus"), x, y, iconSize);
  }
  const iconSlug = placeIconSlug(place);
  if (iconSlug) {
    return drawPngMapIcon(ctx, iconPath(iconSlug), x, y, iconSize);
  }
  return drawEmojiMapPin(ctx, landmarkEmoji(place), x, y, iconSize);
}

// Draws the flat radar cone on the overlay canvas so it gets the same per-frame compass
// redraw as the live user marker. Always points in the direction the user is facing (forward
// in heading-up mode, or the compass heading in flat mode) — the dotted route line, not the
// radar cone, is what shows the bearing to a selected target.
function drawUserRadarOverlay(ctx, toScreen = worldToScreenForOverlay) {
  // isDefault: see drawUser's own comment -- the device's real heading pointing out of a
  // High Beach stand-in the reader isn't actually standing at would be its own false signal,
  // not just a mislabelled dot.
  if (!state.userLocation || state.userLocation.isDefault || !state.userInMapArea) return;
  if (!Number.isFinite(state.compassHeading)) return;
  if (typeof tiltActive === "function" && tiltActive()) return;
  const dpr = pixelRatio();
  const point = toScreen(state.userLocation.point);
  const outerRadius = Math.max(0.5, radarRadiusForMetres(point, USER_RADAR_RADIUS_METRES, toScreen));
  const innerRadius = Math.max(0.2, outerRadius * 0.28);
  const spread = toRadians(26);

  const isHeadingUp = typeof headingUpActive === "function" && headingUpActive();
  const headingRad = isHeadingUp
    ? toRadians(-90)
    : toRadians(normalizeDegrees(state.compassHeading) - 90);

  ctx.save();
  const fill = ctx.createRadialGradient(point.x, point.y, innerRadius * 0.2, point.x, point.y, outerRadius);
  fill.addColorStop(0, "rgba(31, 94, 255, 0.34)");
  fill.addColorStop(1, "rgba(31, 94, 255, 0.03)");
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.arc(point.x, point.y, outerRadius, headingRad - spread, headingRad + spread);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = "rgba(31, 94, 255, 0.64)";
  for (const ratio of [0.4, 0.7, 1]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, outerRadius * ratio, headingRad - spread, headingRad + spread);
    ctx.stroke();
  }

  ctx.restore();
}

// Draws the radar cone on the overlay canvas using explicit perspective projection so it
// appears to lie flat on the tilted ground plane. Each arc point is projected through
// projectCanvasPoint (same math the pins use) rather than relying on CSS rotateX, which
// produces a visually ambiguous fin shape for simple geometric arcs.
function drawUserRadarOverlayTilted(ctx) {
  if (!state.userLocation || state.userLocation.isDefault || !state.userInMapArea) return;
  if (typeof tiltActive !== "function" || !tiltActive()) return;
  if (typeof projectCanvasPoint !== "function") return;

  const dpr = pixelRatio();
  // Use the same live, screen-space position as the You dot. The main canvas may be waiting
  // for its next terrain redraw while compass smoothing is running, but the overlay follows
  // every heading frame, so using the current overlay projection keeps the cone attached.
  const U = typeof worldToScreenForOverlay === "function"
    ? worldToScreenForOverlay(state.userLocation.point)
    : worldToScreenFlat(state.userLocation.point);

  const outerRadius = Math.max(0.5, radarRadiusForMetres(U, USER_RADAR_RADIUS_METRES, worldToScreenForOverlay));
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
  fill.addColorStop(0, "rgba(31, 94, 255, 0.34)");
  fill.addColorStop(1, "rgba(31, 94, 255, 0.03)");

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
  ctx.strokeStyle = "rgba(31, 94, 255, 0.64)";
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

  ctx.restore();
}

// Where the "You" label goes, adjacent to the dot only: right, else left, below, above -- the first
// whose text box meets no marker rectangle. The side used last frame is kept while it is still
// free, so the label does not flip while the map pans or zooms. Returns null when all four are
// covered: the label is then not drawn and the dot alone marks the user. Otherwise
// { side, x, baseline, box }, x/baseline being the fillText origin.
const USER_LABEL_SIDES = ["right", "left", "below", "above"];
let _userLabelSide = "right";
function placeUserLabel(dot, radius, textWidth, fontSize, gap, rightBaselineDrop, rects, lastSide, ascent = fontSize * 0.8, descent = fontSize * 0.2) {
  const at = (side) => {
    let x, baseline;
    if (side === "right") { x = dot.x + radius + gap; baseline = dot.y + rightBaselineDrop; }
    else if (side === "left") { x = dot.x - radius - gap - textWidth; baseline = dot.y + rightBaselineDrop; }
    else if (side === "below") { x = dot.x - textWidth / 2; baseline = dot.y + radius + gap + ascent; }
    else { x = dot.x - textWidth / 2; baseline = dot.y - radius - gap - descent; }
    return { side, x, baseline, box: { left: x, right: x + textWidth, top: baseline - ascent, bottom: baseline + descent } };
  };
  const free = (c) => !rects.some(r => c.box.left < r.right && r.left < c.box.right && c.box.top < r.bottom && r.top < c.box.bottom);
  if (USER_LABEL_SIDES.includes(lastSide)) {
    const kept = at(lastSide);
    if (free(kept)) return kept;
  }
  for (const side of USER_LABEL_SIDES) {
    const candidate = at(side);
    if (free(candidate)) return candidate;
  }
  return null;
}

function drawUser(ctx, toScreen, isTilted) {
  // isDefault (applyDefaultLocation, js/app.js): DEFAULT_LOCATION's High Beach stand-in, not a
  // real fix -- drawing "You" there would tell the reader they've been located somewhere they
  // are not actually standing.
  if (!state.userLocation || state.userLocation.isDefault || !state.userInMapArea) return;
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
  const fontSize = 11 * dpr * dotScale;
  ctx.font = `800 ${fontSize}px system-ui`;
  // The glyphs' real extent (cap height, no descender in "You"), not the font box around them.
  const metrics = typeof ctx.measureText === "function" ? ctx.measureText("You") : null;
  const textWidth = metrics ? metrics.width : fontSize * 1.8;
  const ascent = metrics && metrics.actualBoundingBoxAscent > 0 ? metrics.actualBoundingBoxAscent : fontSize * 0.8;
  const descent = metrics && metrics.actualBoundingBoxDescent >= 0 ? metrics.actualBoundingBoxDescent : fontSize * 0.2;
  const rects = [];
  for (const spec of _drawnMarkerSpecs.concat(_drawnTransitionSpecs)) {
    const p = toScreen(spec.worldPt);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    // A 1 CSS px margin around what is painted (2 px left the default Nearby view's right-hand
    // side blocked by a gap of under a pixel).
    for (const r of markerPaintedRects(p.x, p.y, spec.count, dpr, spec.scale)) {
      rects.push({ left: r.left - dpr, right: r.right + dpr, top: r.top - dpr, bottom: r.bottom + dpr });
    }
  }
  const label = placeUserLabel(point, radius, textWidth, fontSize, 3 * dpr, 4 * dpr * dotScale, rects, _userLabelSide, ascent, descent);
  if (label) {
    _userLabelSide = label.side;
    ctx.fillText("You", label.x, label.baseline);
  }
  ctx.globalAlpha = 1;  // Reset opacity for subsequent drawing
  ctx.restore();
}

function drawSelectedOverlay(ctx, toScreen) {
  if (!state.selected || !state.selected.item) return;
  if (!toScreen) toScreen = worldToScreen;

  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  const selectedScale = selectedIconScale();
  const motion = selectedIconMotionFrame();
  const drawDestinationIcon = (context, src, x, y, size) => drawPngMapIcon(context, src, x, y, size, motion);

  if (state.selected.type === "tree") {
    const point = toScreen(state.selected.item.point);
    if (isNearCanvas(point, 24 * dpr * MAP_ICON_SCALE)) {
      const selectedTree = state.selected.item;
      const selectedTreeSrc = treeSpeciesIconPath(selectedTree.commonName, selectedTree.latinName) || iconPath("tree");
      drawDestinationIcon(ctx, selectedTreeSrc, point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
    }
    return;
  }

  const point = toScreen(state.selected.item.point);
  if (!isNearCanvas(point, 24 * dpr * MAP_ICON_SCALE)) return;

  if (state.selected.type === "cow") {
    drawDestinationIcon(ctx, iconPath("cow"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
  } else if (state.selected.type === "water") {
    drawDestinationIcon(ctx, iconPath("ponds"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
  } else if (state.selected.type === "landmark") {
    const selectedPlace = state.selected.item;

    const iconSlug = placeIconSlug(selectedPlace);

    if (iconSlug) {
      // Generic landmark with PNG icon
      drawDestinationIcon(ctx, iconPath(iconSlug), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
    } else if (isPubCategory(selectedPlace)) {
      drawDestinationIcon(ctx, iconPath("beer"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
    } else if (isCafeCategory(selectedPlace)) {
      drawDestinationIcon(ctx, iconPath("cafe"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
    } else if (isShopCategory(selectedPlace)) {
      drawDestinationIcon(ctx, iconPath("shop"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
    } else if (isTransportCategory(selectedPlace)) {
      const transportType = getTransportType(selectedPlace);
      if (transportType === "underground") {
        drawUndergroundRoundel(ctx, point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale, motion);
      } else if (transportType === "national_rail") {
        drawNationalRailLogo(ctx, point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale, motion);
      } else if (transportType === "parking") {
        drawDestinationIcon(ctx, iconPath("landmark-parking"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
      } else {
        drawDestinationIcon(ctx, iconPath("bus"), point.x, point.y, MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE * selectedScale);
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
  return clamp(Math.pow(Math.max(0.0001, zoomRatio), 0.35), 0.3, 1);
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
