const HAS_DIRECTIONAL_WORDING_REGEX = /bound|towards|via|\b(?:north|south|east|west|n|s|e|w)\b/i;
const INSPECTOR_MINIMIZE_TRANSITION_TIMEOUT_MS = 180 + 40; // Inspector transition + buffer

// --- Hit detection & map click ---

function handleMapClick(event) {
  if (!state.trees.length) return;
  const screen = canvasPoint(event);

  // In overview mode, tapping a multi-item cluster zooms in to separate the items.
  if (!state.selected) {
    const cluster = findClusterHit(screen);
    if (cluster) {
      const points = cluster.items.map(item => item.point).filter(Boolean);
      if (points.length) {
        state.clusterZoomed = true;
        fitToPoints(points, false, { animate: true, durationMs: 400, focusVisibleArea: true, assumeInspectorOpen: true });
        requestDraw();
        return;
      }
    }
  }

  state.clusterZoomed = false;
  setInspectorMinimized(false);
  const world = screenToWorld(screen.x, screen.y);
  const lonLat = unprojectPoint(world);
  const hit = findHit(screen, world, lonLat);

  if (hit.type === "tree") {
    state.selected = { type: "tree", item: hit.item };
    syncHashFromSelection();
    showTreeDetails(hit.item, distanceFromUser(hit.item), "Tree record");
    startCompassNavigation();
    zoomToSelection();
  } else if (hit.type === "cow") {
    state.selected = { type: "cow", item: hit.item };
    syncHashFromSelection();
    showCowDetails(hit.item, distanceFromUser(hit.item));
    startCompassNavigation();
    zoomToSelection();
  } else if (hit.type === "landmark") {
    state.selected = { type: "landmark", item: hit.item };
    syncHashFromSelection();
    showLandmarkDetails(hit.item, distanceFromUser(hit.item));
    startCompassNavigation();
    zoomToSelection();
  } else if (hit.type === "area") {
    state.selected = { type: "area", item: hit.item };
    syncHashFromSelection();
    showAreaDetails(hit.item);
    updateCompassOverlay();
  } else if (hit.type === "road") {
    state.selected = { type: "road", item: hit.item };
    syncHashFromSelection();
    const distance = distanceFromUserToRoad(hit.item);
    showRoadDetails(hit.item, distance);
    updateCompassOverlay();
  } else if (hit.type === "path") {
    state.selected = { type: "path", item: hit.item };
    syncHashFromSelection();
    const distance = distanceFromUserToPath(hit.item);
    showPathDetails(hit.item, distance);
    startCompassNavigation();
    zoomToSelection();
  } else if (hit.type === "railway") {
    state.selected = { type: "railway", item: hit.item };
    syncHashFromSelection();
    showRailwayDetails(hit.item);
    updateCompassOverlay();
  } else {
    if (!state.filterScreenOpen) goToInitialView();
    return;
  }
  if (hit.type && hit.item && typeof trackClick === "function") {
    trackSelectionClick(hit.type, hit.item, "map");
  }
  requestDraw();
}

function trackSelectionClick(itemType, item, source) {
  if (typeof trackClick !== "function") return;
  const uLat = state.userLocation?.latitude ?? null;
  const uLng = state.userLocation?.longitude ?? null;
  trackClick(itemType, item, uLat, uLng, source);
}

function findHit(screen, world, lonLat) {
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  // drawPngMapIcon geometry: R = size*0.4, circle centre sits R*1.6 above the tip.
  // Unselected pins drive overview taps; use MAP_ICON_SCALE_UNSELECTED for accurate centering.
  const iconSize = MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE_UNSELECTED;
  const pinR = iconSize * 0.4 * 1.3;   // R * 1.3 — slightly larger than visual for easy tapping
  const pinYOffset = iconSize * 0.64;   // R * 1.6 = center of circle above tip

  function pinDistance(point) {
    return Math.hypot(point.x - screen.x, (point.y - pinYOffset) - screen.y);
  }

  let bestPlace = null;
  for (const place of state.landmarks) {
    const opacity = markerOpacityFor("landmark", place);
    if (opacity < 0.5) continue;
    const point = worldToScreen(place.point);
    const distance = pinDistance(point);
    if (distance < pinR && (!bestPlace || distance < bestPlace.distance)) {
      bestPlace = { type: "landmark", item: place, distance };
    }
  }
  if (bestPlace) return bestPlace;

  let bestCow = null;
  for (const cow of state.cows) {
    const opacity = markerOpacityFor("cow", cow);
    if (opacity < 0.5) continue;
    const point = worldToScreen(cow.point);
    const distance = pinDistance(point);
    if (distance < pinR && (!bestCow || distance < bestCow.distance)) {
      bestCow = { type: "cow", item: cow, distance };
    }
  }
  if (bestCow) return bestCow;

  let bestTree = null;
  for (const tree of state.trees) {
    const point = worldToScreen(tree.point);
    if (!isNearCanvas(point, 20 * dpr)) continue;
    const distance = pinDistance(point);
    if (distance < pinR && (!bestTree || distance < bestTree.distance)) {
      bestTree = { type: "tree", item: tree, distance };
    }
  }
  if (bestTree) return bestTree;

  let bestPath = null;
  const pathClickRadius = 12 * dpr;
  for (const path of state.paths) {
    if (!isWaymarkedTrail(path)) continue;
    if (path.bbox) {
      const margin = pathClickRadius * 2;
      const worldMargin = margin / state.viewport.scale;
      if (world.x < path.bbox.minX - worldMargin || world.x > path.bbox.maxX + worldMargin) continue;
      if (world.y < path.bbox.minY - worldMargin || world.y > path.bbox.maxY + worldMargin) continue;
    }

    for (const segment of path.segments) {
      for (let i = 1; i < segment.length; i += 1) {
        const p1 = worldToScreen(segment[i - 1]);
        const p2 = worldToScreen(segment[i]);
        const dist = distanceToSegment(screen.x, screen.y, p1.x, p1.y, p2.x, p2.y);
        if (dist < pathClickRadius && (!bestPath || dist < bestPath.distance)) {
          bestPath = { type: "path", item: path, distance: dist };
        }
      }
    }
  }
  if (bestPath) return bestPath;

  let bestRoad = null;
  const roadClickRadius = 12 * dpr;
  for (const road of state.roads) {
    if (road.bbox) {
      const margin = roadClickRadius * 2;
      const worldMargin = margin / state.viewport.scale;
      if (world.x < road.bbox.minX - worldMargin || world.x > road.bbox.maxX + worldMargin) continue;
      if (world.y < road.bbox.minY - worldMargin || world.y > road.bbox.maxY + worldMargin) continue;
    }

    for (const segment of road.segments) {
      for (let i = 1; i < segment.length; i++) {
        const p1 = worldToScreen(segment[i - 1]);
        const p2 = worldToScreen(segment[i]);
        const dist = distanceToSegment(screen.x, screen.y, p1.x, p1.y, p2.x, p2.y);
        if (dist < roadClickRadius && (!bestRoad || dist < bestRoad.distance)) {
          bestRoad = { type: "road", item: road, distance: dist };
        }
      }
    }
  }
  if (bestRoad) return bestRoad;

  let bestRailway = null;
  const railwayClickRadius = 15 * dpr;
  for (const envFeature of state.environmentFeatures) {
    const props = envFeature.properties || {};
    if (props.featureType !== "railway") continue;
    if (!envFeature.geometry || envFeature.geometry.type !== "LineString") continue;

    const coords = envFeature.geometry.coordinates || [];
    for (let i = 1; i < coords.length; i++) {
      const p1World = projectLonLat(coords[i - 1][0], coords[i - 1][1]);
      const p2World = projectLonLat(coords[i][0], coords[i][1]);
      const p1 = worldToScreen(p1World);
      const p2 = worldToScreen(p2World);
      const dist = distanceToSegment(screen.x, screen.y, p1.x, p1.y, p2.x, p2.y);
      if (dist < railwayClickRadius && (!bestRailway || dist < bestRailway.distance)) {
        bestRailway = { type: "railway", item: envFeature, distance: dist };
      }
    }
  }
  if (bestRailway) return bestRailway;

  for (const envFeature of state.environmentFeatures) {
    if (envFeature.geometry && envFeature.geometry.type && envFeature.geometry.type.includes("Polygon")) {
      const polygons = envFeature.geometry.type === "Polygon" ? [envFeature.geometry.coordinates] : envFeature.geometry.coordinates;
      for (const polygon of polygons) {
        if (pointInPolygon([lonLat.longitude, lonLat.latitude], polygon)) {
          return { type: "area", item: { source: "environment", feature: envFeature } };
        }
      }
    }
  }

  for (const layer of state.layers) {
    const feature = findContainingFeature(layer, lonLat);
    if (feature) return { type: "area", item: { source: "layer", layer, feature } };
  }
  return { type: "none" };
}

function findClusterHit(screen) {
  const dpr = pixelRatio();
  const mapScale = mapEmojiScale();
  // Matches drawPngMapIcon geometry (R = size*0.4, centre = R*1.6 above tip).
  const iconSize = MAP_PNG_ICON_SIZE * dpr * mapScale * MAP_ICON_SCALE_UNSELECTED;
  const pinR = iconSize * 0.4 * 1.3;
  const pinYOffset = iconSize * 0.64;
  const lookup = buildNearbyIconLookup();
  const allClusters = [
    ...buildTypeClusters(lookup.tree, worldToScreen),
    ...buildLandmarkClusters(lookup.landmark, worldToScreen),
    ...buildTypeClusters(lookup.cow, worldToScreen),
    ...buildTypeClusters(lookup.path, worldToScreen),
    ...buildTypeClusters(lookup.water, worldToScreen),
  ];
  for (const cluster of allClusters) {
    if (cluster.items.length <= 1) continue;
    if (Math.hypot(cluster.screenPt.x - screen.x, (cluster.screenPt.y - pinYOffset) - screen.y) < pinR) return cluster;
  }
  return null;
}

// --- Detail views ---

function showTreeDetails(tree, distance, label) {
  setInspectorSelectionChrome({ emoji: appIconHtml("tree", "app-icon title-icon"), showBack: true });
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = tree.commonName || "Unknown tree";
  els.inspectorType.textContent = "Veteran tree";
  const estimatedAge = estimateTreeAgeFromGirth(tree);
  const primaryRows = [
    ["Estimated age", estimatedAge],
    ["Common name", tree.commonName],
    ["Latin name", tree.latinName],
    ["Tree form", tree.treeForm],
    ["Girth", tree.girthMetres == null ? null : `${tree.girthMetres} m`],
    ["Status", tree.status],
    ["Comments", tree.comments],
  ];
  const technicalRows = [
    ["Tag number", tree.tagNumber],
    ["National tag", tree.nationalDatabaseTagNumber],
    ["GPS date", tree.dateGpsd],
    ["Compartment", tree.compartmentNumber],
    ["Easting", tree.location.britishNationalGrid.easting],
    ["Northing", tree.location.britishNationalGrid.northing],
    ["Record number", tree.recordNumber],
  ].filter(([, value]) => value != null && value !== "");
  const distancePill = distance != null ? `<span data-live-field="distance">${walkInfoExpandableHtml(distance)}</span>` : "";
  const mapsLink = openInMapsHtml(tree.latitude, tree.longitude, tree.commonName || "Veteran tree");
  const topRow = `<div class="detail-top-row">${distancePill}${mapsLink}${shareLocationHtml()}</div>`;
  const technicalHtml = technicalRows.length
    ? `<details class="technical-details"><summary>Technical data</summary>${detailsHtml(technicalRows)}</details>`
    : "";
  const namedTreeHtml = namedTreeDetailsHtml(tree);
  transitionInspectorBody(topRow + detailsHtml(primaryRows) + technicalHtml + namedTreeHtml, "forward");
}

function showLandmarkDetails(place, distance) {
  const emoji = landmarkEmoji(place);
  setInspectorSelectionChrome({ emoji, showBack: true });
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = place.name || "Local place";
  els.inspectorType.textContent = place.categoryLabel || "Local place";
  const description = place.folkloreSummary || place.description || place.summary || null;
  const rows = [
    ["Address", place.address],
    ["Type", place.type],
    ["Area", place.area],
    ["Confidence", place.confidence],
    ["Website", place.website],
    ["Phone", place.phone],
  ];
  const distancePill = distance != null ? `<span data-live-field="distance">${walkInfoExpandableHtml(distance)}</span>` : "";
  const mapsLink = place.latitude != null ? openInMapsHtml(place.latitude, place.longitude, place.name) : "";
  const shareBtn = shareLocationHtml();
  const topRow = (distancePill || mapsLink || shareBtn) ? `<div class="detail-top-row">${distancePill}${mapsLink}${shareBtn}</div>` : "";
  const descriptionHtml = description ? `<p class="details-description">${escapeHtml(description)}</p>` : "";
  const landmarkHtml = topRow + descriptionHtml + detailsHtml(rows) + (isFolklorePlace(place) ? folkloreNote(place, { includeSummary: false }) : "");
  transitionInspectorBody(landmarkHtml, "forward");
  if (navigator.onLine && (isBusCategory(place) || isTrainCategory(place))) {
    loadTransportDepartures(place);
  }
}

function showCowDetails(cow, distance) {
  setInspectorSelectionChrome({ emoji: appIconHtml("cow", "app-icon title-icon"), showBack: true });
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = `Cow ${displayValue(cow.serialNo)}`;
  els.inspectorType.textContent = "Grazing cow";
  const rows = [
    ["Serial", cow.serialNo],
    ["Type", cow.type],
    ["Direction", directionTextFor(cow)],
    ["Position updated", formatTimeAgo(state.cowLastUpdatedAt), "cow-updated"],
    ["Source", "Nofence open data"],
  ];
  const distancePill = distance != null ? `<span data-live-field="distance">${walkInfoExpandableHtml(distance)}</span>` : "";
  const mapsLink = openInMapsHtml(cow.latitude, cow.longitude, `Cow ${cow.serialNo}`);
  const topRow = `<div class="detail-top-row">${distancePill}${mapsLink}</div>`;
  transitionInspectorBody(topRow + detailsHtml(rows), "forward");

  if (state.cowDetailTimerId != null) clearInterval(state.cowDetailTimerId);
  state.cowDetailTimerId = setInterval(() => {
    if (!state.selected || state.selected.type !== "cow") {
      clearInterval(state.cowDetailTimerId);
      state.cowDetailTimerId = null;
      return;
    }
    updateCowTimeAgoField();
  }, 30000);
}

function showPathDetails(path, distance) {
  setInspectorSelectionChrome({ emoji: appIconHtml("waymarked", "app-icon title-icon"), showBack: true });
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = path.name || path.ref || "Waymarked trail";
  els.inspectorType.textContent = "Waymarked trail";
  const rows = [
    ["Name", path.name],
    ["Reference", path.ref],
    ["Type", path.pathType === "waymarked_trail" ? "Waymarked trail" : displayValue(path.pathType)],
    ["Highway tag", path.highway],
    ["Access", path.access],
    ["Foot", path.foot],
    ["Horse", path.horse],
    ["Approx length", path.totalLength ? formatDistance(path.totalLength) : null],
  ];
  const distancePill = distance != null ? `<span data-live-field="distance">${walkInfoExpandableHtml(distance)}</span>` : "";
  const topRow = distancePill ? `<div class="detail-top-row">${distancePill}</div>` : "";
  transitionInspectorBody(topRow + detailsHtml(rows), "forward");
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;

  return Math.hypot(px - nearestX, py - nearestY);
}

function showRoadDetails(road, distance) {
  const roadEmoji = road.roadType === "motorway" ? "🛣️"
    : road.roadType === "trunk" || road.roadType === "primary" ? "🛤️"
    : "🚙";

  setInspectorSelectionChrome({ emoji: roadEmoji, showBack: true });
  els.inspectorTools.hidden = true;

  const roadTypeLabel = road.roadType === "motorway" ? "Motorway"
    : road.roadType === "trunk" ? "Trunk Road"
    : road.roadType === "primary" ? "Primary Road"
    : road.roadType === "secondary" ? "Secondary Road"
    : road.roadType === "tertiary" ? "Tertiary Road"
    : road.roadType === "residential" ? "Residential Road"
    : road.roadType === "service" ? "Service Road"
    : "Road";

  const displayName = road.name || road.ref || "Unnamed road";
  els.inspectorTitle.textContent = displayName;
  els.inspectorType.textContent = roadTypeLabel;

  const rows = [
    ["Road type", roadTypeLabel],
    ["Name", road.name],
    ["Reference", road.ref],
    ["Highway tag", road.highway],
  ].filter(([key, value]) => value != null && value !== "");

  transitionInspectorBody(detailsHtml(rows), "forward");
}

function showRailwayDetails(railway) {
  const props = railway.properties || {};
  const railwayType = props.railway;

  const railwayEmoji = railwayType === "subway" ? "🚇"
    : railwayType === "tram" ? "🚊"
    : railwayType === "light_rail" ? "🚈"
    : "🚂";

  setInspectorSelectionChrome({ emoji: railwayEmoji, showBack: true });
  els.inspectorTools.hidden = true;

  const railwayTypeLabel = railwayType === "rail" ? "Railway Line"
    : railwayType === "subway" ? "Underground/Subway Line"
    : railwayType === "light_rail" ? "Light Rail"
    : railwayType === "tram" ? "Tram Line"
    : "Rail Track";

  const displayName = props.name || "Unnamed railway line";
  els.inspectorTitle.textContent = displayName;
  els.inspectorType.textContent = railwayTypeLabel;

  const primaryRows = [
    ["Type", railwayTypeLabel],
    ["Name", props.name],
    ["Operator", props.operator],
    ["Service", props.service],
  ].filter(([, value]) => value != null && value !== "");

  const technicalRows = [
    ["Gauge", props.gauge ? `${props.gauge} mm` : null],
    ["Electrified", props.electrified === "yes" ? "Yes" : props.electrified === "no" ? "No" : props.electrified],
    ["Voltage", props.voltage ? `${props.voltage} V` : null],
    ["Frequency", props.frequency ? `${props.frequency} Hz` : null],
    ["Usage", props.usage],
  ].filter(([, value]) => value != null && value !== "");

  const technicalHtml = technicalRows.length
    ? `<details class="technical-details"><summary>Technical data</summary>${detailsHtml(technicalRows)}</details>`
    : "";

  transitionInspectorBody(detailsHtml(primaryRows) + technicalHtml, "forward");
}

function showWaterDetails(water, distance) {
  const isArea = water.featureType === "hydrology_area";
  const typeLabel = isArea
    ? "Pond / lake"
    : (water.waterway ? water.waterway.charAt(0).toUpperCase() + water.waterway.slice(1) : "Stream / waterway");
  setInspectorSelectionChrome({ emoji: appIconHtml("ponds", "app-icon title-icon"), showBack: true });
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = water.name;
  els.inspectorType.textContent = typeLabel;
  const rows = [
    ["Type", typeLabel],
    ["Source", water.id ? `OpenStreetMap ${water.id}` : "OpenStreetMap"],
  ];
  transitionInspectorBody(detailsHtml(rows), "forward");
}

function showAreaDetails(area) {
  els.inspectorTools.hidden = true;

  if (area.source === "environment") {
    const props = area.feature.properties || {};
    const featureType = props.featureType || "unknown";
    const name = props.name || "Unnamed area";

    let emoji = "🗺️";
    let typeLabel = "Area";

    if (featureType === "hydrology_line" || featureType === "hydrology_area") {
      emoji = "💧";
      typeLabel = featureType === "hydrology_line" ? "Waterway" : "Water body";
    } else if (featureType === "nature_designation") {
      emoji = "🌳";
      typeLabel = "Nature designation";
    }

    setInspectorSelectionChrome({ emoji, showBack: true });
    els.inspectorTitle.textContent = name;
    els.inspectorType.textContent = typeLabel;

    const rows = [
      ["Feature type", featureType],
      ["Designation", props.designation],
      ["Waterway", props.waterway],
      ["Natural", props.natural],
      ["Water", props.water],
      ["Landuse", props.landuse],
      ["Leisure", props.leisure],
      ["Boundary", props.boundary],
      ["OSM ID", props.id],
    ].filter(([key, value]) => value != null && value !== "");

    const bodyHtml = rows.length
      ? detailsHtml(rows)
      : `<p class="empty">No additional details recorded for this area. Tap a tree, cow, or landmark on the map to explore.</p>`;
    transitionInspectorBody(bodyHtml, "forward");
  } else {
    const emoji = area.layer.key === "forest" ? "🌲" : "🟢";
    setInspectorSelectionChrome({ emoji, showBack: true });
    els.inspectorTitle.textContent = area.layer.label;
    els.inspectorType.textContent = "Forest boundary";

    const props = area.feature.properties || {};
    const rows = [
      ["Area", props["SHAPE.AREA"] ? `${props["SHAPE.AREA"].toFixed(2)} sq m` : null],
      ["Object ID", props.OBJECTID],
      ["Global ID", props.GLOBALID],
    ].filter(([key, value]) => value != null);

    const bodyHtml = rows.length
      ? detailsHtml(rows)
      : `<p class="empty">No additional details recorded for this boundary. Tap a tree, cow, or landmark on the map to explore.</p>`;
    transitionInspectorBody(bodyHtml, "forward");
  }
}

// --- Overview screen ---

let _overviewListKey;

function selectOverview(animate = false) {
  if (state.filterScreenOpen) return;
  [els.filterToggle, els.settingsToggle, els.reportToggle].forEach((el) => {
    if (el) el.classList.remove("screen-active", "active");
  });
  const previousNearestPositions = captureNearestItemPositions();
  setInspectorSelectionChrome({ emoji: appIconHtml("nearby", "app-icon title-icon"), showBack: false, captureSnapshot: animate });
  if (els.nearbyToggle) els.nearbyToggle.classList.add("screen-active");
  els.inspectorTools.hidden = false;
  els.inspectorTitle.textContent = "Nearby";
  els.inspectorType.textContent = "";
  const nearestSummary = overviewNearestHtml();
  const listKey = nearestSummary.replace(/<span class="walk-time">[^<]*<\/span>/, "");

  if (!animate && listKey === _overviewListKey && els.inspectorBody?.querySelector(".walk-time")) {
    const walkTimeEl = els.inspectorBody.querySelector(".walk-time");
    walkTimeEl.textContent = nearestSummary.match(/<span class="walk-time">([^<]*)<\/span>/)?.[1] ?? "";
    return;
  }

  _overviewListKey = listKey;
  transitionInspectorBody(nearestSummary, animate ? "back" : null, () => {
    updateOverviewDirectionArrows();
    hydrateOverviewBusStopDirections();
    animateNearestItemReorder(previousNearestPositions);
  });
  syncHashFromSelection();
}

function nearestItemDomKey(node) {
  if (!node) return "";
  const type = node.dataset.overviewType || "";
  const key = node.dataset.overviewKey || "";
  if (!type || !key) return "";
  return `${type}:${key}`;
}

function captureNearestItemPositions() {
  if (!els.inspectorBody) return new Map();
  const positions = new Map();
  const items = els.inspectorBody.querySelectorAll(".nearest-item[data-overview-type][data-overview-key]");
  for (const item of items) {
    const key = nearestItemDomKey(item);
    if (!key) continue;
    const rect = item.getBoundingClientRect();
    positions.set(key, { top: rect.top, left: rect.left });
  }
  return positions;
}

function animateNearestItemReorder(previousPositions) {
  if (!els.inspectorBody || !(previousPositions instanceof Map) || previousPositions.size === 0) return;
  const items = els.inspectorBody.querySelectorAll(".nearest-item[data-overview-type][data-overview-key]");
  if (!items.length) return;

  for (const item of items) {
    item.style.transition = "none";
    item.style.transform = "";
    item.style.opacity = "";
  }

  for (const item of items) {
    const key = nearestItemDomKey(item);
    if (!key) continue;
    const nextRect = item.getBoundingClientRect();
    const previous = previousPositions.get(key);

    if (previous) {
      const deltaY = previous.top - nextRect.top;
      if (Math.abs(deltaY) > 0.5) {
        item.style.transform = `translateY(${deltaY}px)`;
      }
      continue;
    }

    item.style.opacity = "0.74";
    item.style.transform = "translateY(4px)";
  }

  requestAnimationFrame(() => {
    for (const item of items) {
      item.style.transition = "transform 150ms ease-out, opacity 150ms ease-out";
      item.style.transform = "";
      item.style.opacity = "";
    }
  });
}

function isOverviewScreenActive() {
  return !state.selected && !state.filterScreenOpen;
}

// --- Screen transition ---

let _transitionSnapshot = null;
let _transitionAnimation = null;

function _cleanupTransition() {
  const scroll = els.inspector && els.inspector.querySelector(".inspector-scroll");
  const screen = scroll && scroll.querySelector(".inspector-screen");
  const ghost  = scroll && scroll.querySelector(".inspector-screen-ghost");
  if (ghost)  ghost.remove();
  if (screen) { screen.style.willChange = ""; screen.getAnimations().forEach(a => a.cancel()); }
  if (scroll) { scroll.style.overflow = ""; scroll.style.height = ""; }
}

function applyScreenTransition(direction, onDone) {
  const scroll    = els.inspector && els.inspector.querySelector(".inspector-scroll");
  const screen    = scroll && scroll.querySelector(".inspector-screen");
  const snapshot  = _transitionSnapshot;
  _transitionSnapshot = null;

  if (!direction || !snapshot || !screen || !scroll || prefersReducedMotion()) {
    if (onDone) onDone();
    return;
  }

  // Reset scroll position for incoming screen
  scroll.scrollTop = 0;

  // Build ghost (outgoing overlay) from pre-captured snapshot
  const ghost = snapshot;
  ghost.classList.add("inspector-screen-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.cssText = "position:absolute;top:0;left:0;right:0;pointer-events:none;z-index:1;background:var(--panel);backdrop-filter:blur(12px);";

  // Lock height so the panel doesn't jump as content height changes
  scroll.style.height = scroll.offsetHeight + "px";
  scroll.style.overflow = "hidden";
  scroll.appendChild(ghost);

  const dur    = 310;
  const ease   = "cubic-bezier(0.4, 0, 0.2, 1)";
  const outX   = direction === "forward" ? "-62%" : "62%";
  const inX    = direction === "forward" ?  "62%" : "-62%";

  screen.style.willChange = "transform, opacity";

  ghost.animate([
    { transform: "translateX(0)",   opacity: 1 },
    { transform: `translateX(${outX})`, opacity: 0 },
  ], { duration: dur, easing: ease });

  const inAnim = screen.animate([
    { transform: `translateX(${inX})`, opacity: 0 },
    { transform: "translateX(0)",      opacity: 1 },
  ], { duration: dur, easing: ease, fill: "backwards" });

  _transitionAnimation = inAnim;

  inAnim.finished.then(() => {
    _transitionAnimation = null;
    _cleanupTransition();
    if (onDone) onDone();
  }).catch(() => { /* cancelled by next transition */ });
}

function transitionInspectorBody(newHtml, direction, onDone) {
  els.inspectorBody.innerHTML = newHtml;
  applyScreenTransition(direction, onDone);
}

function setInspectorSelectionChrome({ emoji, showBack, captureSnapshot = true }) {
  // Cancel any in-flight transition and capture a fresh snapshot before DOM changes
  if (_transitionAnimation) {
    _transitionAnimation.cancel();
    _transitionAnimation = null;
    _cleanupTransition();
  }
  if (captureSnapshot) {
    const scroll = els.inspector && els.inspector.querySelector(".inspector-scroll");
    const screen = scroll && scroll.querySelector(".inspector-screen");
    _transitionSnapshot = screen ? screen.cloneNode(true) : null;
  } else {
    _transitionSnapshot = null;
  }

  // Apply chrome updates
  els.inspectorBack.hidden = !showBack;
  if (els.inspectorHeader) els.inspectorHeader.classList.toggle("has-back", Boolean(showBack));
  els.inspectorTitleEmoji.hidden = !emoji;
  if (emoji && emoji.includes("<")) {
    els.inspectorTitleEmoji.innerHTML = emoji;
  } else {
    els.inspectorTitleEmoji.textContent = emoji || "";
  }
  if (els.nearbyToggle) els.nearbyToggle.classList.remove("screen-active");
  if (showBack) {
    state.filterScreenOpen = false;
    if (els.filterToggle) els.filterToggle.classList.remove("screen-active");
  }
  if (els.reportToggle) els.reportToggle.classList.remove("active");
  if (els.settingsToggle) els.settingsToggle.classList.remove("active");
}

function markerOpacityFor(kind, item) {
  if (kind === "tree") return 1;
  const locationSelected = state.selected && ["tree", "landmark", "cow", "path"].includes(state.selected.type);
  if (locationSelected) {
    if (state.selected.type === kind && state.selected.item === item) return 1;
    return 0.5;
  }

  if (!state.overviewFilters.length) {
    return 1;
  }

  if (kind === "cow") {
    return isSubfilterActive("cows") ? 1 : 0.5;
  }

  const activePlaceFilters = getActivePlaceFilterKeys();
  if (!activePlaceFilters.length) return 0.3;
  if (activePlaceFilters.some((filterKey) => matchesPlaceFilter(item, filterKey))) return 1;
  return 0.3;
}

// --- Focus from overview ---

function focusOverviewItem(type, key) {
  if (!state.userLocation) {
    setStatus("Use my location first.");
    return;
  }

  if (type === "tree") {
    const tree = findTreeByHashKey(key);
    if (!tree) return;
    const metres = distanceFromUser(tree);
    state.selected = { type: "tree", item: tree };
    syncHashFromSelection();
    showTreeDetails(tree, metres, "Nearest tree");
    setInspectorMinimized(true);
    startCompassNavigation();
    zoomToSelection();
    trackSelectionClick("tree", tree, "overview");
    requestDraw();
    return;
  }

  if (type === "landmark") {
    const place = findPlaceByHashKey(key);
    if (!place) return;
    const metres = distanceFromUser(place);
    state.selected = { type: "landmark", item: place };
    syncHashFromSelection();
    showLandmarkDetails(place, metres);
    setInspectorMinimized(true);
    startCompassNavigation();
    zoomToSelection();
    trackSelectionClick("landmark", place, "overview");
    requestDraw();
    return;
  }

  if (type === "cow") {
    const cow = findCowByKey(key);
    if (!cow) return;
    const metres = distanceFromUser(cow);
    state.selected = { type: "cow", item: cow };
    syncHashFromSelection();
    showCowDetails(cow, metres);
    setInspectorMinimized(true);
    startCompassNavigation();
    zoomToSelection();
    trackSelectionClick("cow", cow, "overview");
    requestDraw();
    return;
  }

  if (type === "path") {
    const path = findPathByHashKey(key);
    if (!path) return;
    const metres = distanceFromUserToPath(path);
    state.selected = { type: "path", item: path };
    syncHashFromSelection();
    showPathDetails(path, metres);
    setInspectorMinimized(true);
    startCompassNavigation();
    zoomToSelection();
    trackSelectionClick("path", path, "overview");
    requestDraw();
    return;
  }

  if (type === "water") {
    const water = findWaterByHashKey(key);
    if (!water) return;
    const metres = distanceFromUser(water);
    state.selected = { type: "water", item: water };
    showWaterDetails(water, metres);
    setInspectorMinimized(true);
    startCompassNavigation();
    zoomToSelection();
    trackSelectionClick("water", water, "overview");
    requestDraw();
  }
}

// Defers the selection camera zoom until after the inspector's max-height CSS
// transition completes, so getBoundingClientRect() returns the correct
// minimized height when bestVisibleCanvasRect() measures the focus rect.
function zoomToSelection() {
  const doZoom = () => {
    state.selectionViewportTransitionPending = false;
    if (typeof animateToHeadingUpNavigationViewport === "function" && selectedNavigationHeadingUpActive()) {
      animateToHeadingUpNavigationViewport(500);
    } else {
      ensureUserAndSelectionVisible({ animate: true, force: true, durationMs: 500 });
    }
  };

  if (!els.inspector.classList.contains("minimized")) {
    doZoom();
    return;
  }
  state.selectionViewportTransitionPending = true;
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    doZoom();
  };
  els.inspector.addEventListener("transitionend", fire, { once: true });
  // Mirrors the 180ms `.inspector` max-height transition in css/inspector.css
  // plus a ~40ms buffer so the camera measures after the minimized layout settles.
  setTimeout(fire, INSPECTOR_MINIMIZE_TRANSITION_TIMEOUT_MS);
}

// --- HTML helpers ---

function walkTimeStr(distance) {
  const minutes = distance / (5000 / 60);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `~${hours}h ${mins}min` : `~${hours}h`;
}

function walkInfoHtml(distance) {
  if (distance == null || !Number.isFinite(distance)) return "";
  return `<span class="walk-chip">${appIconHtml("walking", "app-icon walk-icon")} ${walkTimeStr(distance)}</span>`;
}

function walkInfoExpandableHtml(distance) {
  if (distance == null || !Number.isFinite(distance)) return "";
  const timeStr = walkTimeStr(distance);
  const distStr = formatDistance(distance);
  return `<button class="walk-chip walk-chip-btn" type="button" aria-expanded="false">${appIconHtml("walking", "app-icon walk-icon")}<span data-walk-short="${timeStr}" data-walk-full="${timeStr} · 📏 ${distStr}">${timeStr}</span></button>`;
}

function detailTypeLabel(distance) {
  if (distance == null || !Number.isFinite(distance)) return "";
  return `🚶 ${walkTimeStr(distance)} · ${formatDistance(distance)}`;
}

function openInMapsHtml(lat, lon, name) {
  if (lat == null || lon == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return "";
  const url = `https://maps.google.com/?q=${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
  return `<a class="detail-map-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open in Maps</a>`;
}

function shareLocationHtml() {
  if (typeof navigator === "undefined") return "";
  if (!("share" in navigator) && !("clipboard" in navigator)) return "";
  return `<button class="detail-map-link" type="button" data-action="share-location">Share link</button>`;
}

async function shareCurrentLocation() {
  const url = window.location.href;
  if (navigator.share) {
    try { await navigator.share({ url }); return; } catch (_) {}
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(url);
      const btn = els.inspectorBody && els.inspectorBody.querySelector("[data-action='share-location']");
      if (btn) {
        const original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { if (btn.isConnected) btn.textContent = original; }, 1600);
      }
    } catch (_) {}
  }
}

function detailsHtml(rows) {
  const visibleRows = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  return `<dl>${visibleRows.map(([label, value, liveKey]) => {
    const shown = displayValue(value);
    const liveAttr = liveKey ? ` data-live-field="${escapeHtml(liveKey)}"` : "";
    let ddContent;
    if (typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"))) {
      let display;
      try { display = new URL(value).hostname.replace(/^www\./, ""); } catch (_) { display = value; }
      ddContent = `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(display)}</a>`;
    } else {
      ddContent = escapeHtml(shown);
    }
    return `<div class="row"><dt>${escapeHtml(label)}</dt><dd${liveAttr}>${ddContent}</dd></div>`;
  }).join("")}</dl>`;
}

function namedTreeDetailsHtml(tree) {
  const matches = Array.isArray(tree.namedTreeMatches) ? tree.namedTreeMatches : [];
  if (!matches.length) return "";

  const sections = matches.map((match) => {
    const storyName = match.historicalNamedTreeEnrichmentName || match.name;
    const story = storyName ? state.namedTreeStoriesByName.get(normalizeStoryName(storyName)) : null;
    const folklore = Array.isArray(story && story.historicalSignificance)
      ? story.historicalSignificance
      : [];
    const sources = Array.isArray(story && story.sources)
      ? story.sources
      : [];
    const aliases = Array.isArray(story && story.alternateNames)
      ? story.alternateNames
      : [];

    const detailRows = [
      ["Named tree", match.name || storyName],
      ["Match status", match.matchStatus],
      ["Confidence", match.confidence],
      ["Distance to source", match.distanceFromSourceCoordinateMetres == null ? null : formatDistance(match.distanceFromSourceCoordinateMetres)],
      ["Matched by", Array.isArray(match.matchedBy) ? match.matchedBy.join(", ") : match.matchedBy],
      ["Verification", story && story.verificationStatus],
      ["Also known as", aliases.length ? aliases.join(", ") : null],
    ];

    const folkloreHtml = folklore.length
      ? `<p class="source-note"><strong>Folklore & history</strong></p><ul class="story-list">${folklore.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "";

    const sourcesHtml = sources.length
      ? `<p class="source-note"><strong>Sources</strong></p><ul class="story-list">${sources.map((source) => {
        const title = source && source.title ? String(source.title) : "Source";
        const url = source && source.url ? String(source.url) : "";
        if (!url) return `<li>${escapeHtml(title)}</li>`;
        return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></li>`;
      }).join("")}</ul>`
      : "";

    return `<section class="named-tree">${detailsHtml(detailRows)}${folkloreHtml}${sourcesHtml}</section>`;
  });

  return `<h3 class="detail-section-heading">Named tree &amp; folklore</h3>${sections.join("")}`;
}

function buildNamedTreeStoryIndex(historicalNamedTreeEnrichment) {
  const index = new Map();
  if (!historicalNamedTreeEnrichment) return index;
  const stories = Array.isArray(historicalNamedTreeEnrichment.namedTreeStories)
    ? historicalNamedTreeEnrichment.namedTreeStories
    : [];
  for (const story of stories) {
    if (!story || !story.name) continue;
    index.set(normalizeStoryName(story.name), story);
  }
  return index;
}

function normalizeStoryName(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function placeTitle(place) {
  const busCacheKey = isBusCategory(place) && typeof transportCacheKey === "function"
    ? transportCacheKey(place, "bus")
    : null;
  const cachedTransport = busCacheKey && state.transportLookupCache
    ? state.transportLookupCache.get(busCacheKey)
    : null;
  const baseName = cachedTransport?.stopName || place.transportStopName || place.name || place.categoryLabel || "Local place";
  const rawDirection = cachedTransport?.stopDirection || place.stopDirection;
  if (!isBusCategory(place) || !rawDirection) return baseName;
  const direction = String(rawDirection).replace(/\s+/g, " ").trim();
  if (!direction) return baseName;
  const directionLabel = HAS_DIRECTIONAL_WORDING_REGEX.test(direction)
    ? direction
    : `towards ${direction}`;
  if (baseName.toLowerCase().includes(directionLabel.toLowerCase())) return baseName;
  return `${baseName} — ${directionLabel}`;
}

function osmNote() {
  return `<p class="source-note">Local places use © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.</p>`;
}

function folkloreNote(place, options = {}) {
  const includeSummary = options.includeSummary !== false;
  const summary = includeSummary && place.folkloreSummary ? `<p class="source-note">${escapeHtml(place.folkloreSummary)}</p>` : "";
  const sourceLinks = Array.isArray(place.sourceLinks) ? place.sourceLinks : [];
  const externalLinks = Array.isArray(place.externalLinks) ? place.externalLinks : [];

  const sourceList = sourceLinks.length
    ? `<p class="source-note"><strong>Sources</strong></p><ul class="story-list">${sourceLinks.map((url) => `<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></li>`).join("")}</ul>`
    : "";

  const externalList = externalLinks.length
    ? `<p class="source-note"><strong>External links</strong></p><ul class="story-list">${externalLinks.map((link) => {
      if (!link || typeof link !== "object") return "";
      const url = link.url ? String(link.url) : "";
      const title = link.title ? String(link.title) : url;
      if (!url) return "";
      return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></li>`;
    }).join("")}</ul>`
    : "";

  return `${summary}${sourceList}${externalList}`;
}

function isFolklorePlace(place) {
  if (!place || typeof place !== "object") return false;
  return place.dataSource === "folklore" || String(place.source || "").toLowerCase().includes("folklore");
}

function isOpenStreetMapPlace(place) {
  if (!place || typeof place !== "object") return false;
  if (isFolklorePlace(place)) return false;
  if (place.id !== null && place.id !== undefined && place.id !== "") return true;
  const source = String(place.source || "").toLowerCase();
  return source.includes("openstreetmap") || source.includes("osm");
}
