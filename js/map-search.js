// Map search: finding places, trees, cows and routes by name, and drawing the search results. Moved here from
// app.js unchanged. Loaded before app.js, which boots the app.

// --- Map search -----------------------------------------------------------------------
//
// One search box over everything the map draws: trees (by species or tag), places (shops,
// pubs, cafés, stations, car parks, plaques...), roads, waymarked trails, water features,
// railway lines and the live cows. Results are rendered with the Nearby view's own
// .nearest-item markup and open the same detail screens a map tap does, so finding a place
// by name and finding it by walking past it end up in exactly the same place.

const SEARCH_RESULT_LIMIT = 30;
// How many of the top matches the map highlights and zooms out to fit, live as the user types.
// Matches the Nearby list's own "closest 10" framing rather than SEARCH_RESULT_LIMIT's fuller
// scrollable list, so the map isn't asked to frame a query that returns dozens of hits.
const SEARCH_HIGHLIGHT_LIMIT = 10;
const SEARCH_MIN_QUERY_LENGTH = 2;

// Match quality, best first. Distance breaks ties, so "Forest Road" two streets away beats
// "Forest Road" on the far side of the forest, but never beats an exact-name match.
const SEARCH_RANK_EXACT = 0;
const SEARCH_RANK_PREFIX = 1;
const SEARCH_RANK_WORD = 2;
const SEARCH_RANK_SUBSTRING = 3;
const SEARCH_RANK_TOKENS = 4;

// Punctuation, accents and case are all noise in a name a user is half-remembering: "St
// Mary's" has to be findable as "st marys", "Cafe" has to find "Café", and a tree tag has
// to answer to "EF 1234" or "ef-1234". Apostrophes are dropped rather than turned into a
// space, so "marys" stays one word; everything else becomes a word break.
function normalizeSearchText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchQueryTokens(needle) {
  return needle ? needle.split(" ").filter(Boolean) : [];
}

// How well one normalized field answers the whole query, or null for "it doesn't".
function searchFieldRank(field, needle) {
  if (!field || !needle) return null;
  if (field === needle) return SEARCH_RANK_EXACT;
  if (field.startsWith(needle)) return SEARCH_RANK_PREFIX;
  if (field.includes(` ${needle}`)) return SEARCH_RANK_WORD;
  if (field.includes(needle)) return SEARCH_RANK_SUBSTRING;
  return null;
}

// Fields are ranked individually rather than as one blob so a tree's tag can match exactly
// ("1234" is the whole of that field) without its species name diluting it. A multi-word
// query that no single field answers falls back to "every word appears somewhere", which is
// what makes "oak 1234" find tree 1234 and "epping station" find the station.
function searchEntryRank(entry, needle, tokens) {
  let best = null;
  for (const field of entry.fields) {
    const rank = searchFieldRank(field, needle);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  if (best !== null) return best;
  if (tokens.length < 2) return null;
  for (const token of tokens) {
    if (!entry.blob.includes(token)) return null;
  }
  return SEARCH_RANK_TOKENS;
}

// The searchable index is built once and kept, because normalising ~40k names on every
// keystroke is not something a phone should be asked to do. Anything with no name to match
// is left out entirely, which drops most of the 27k road ways and keeps the index to the
// named features a person could actually be looking for. Cows are deliberately absent: their
// positions refresh on a timer, so they are scanned live in searchMapFeatures instead.
let _searchIndex = null;
let _searchIndexSources = null;

// The index is rebuilt when any source array is replaced or has grown -- which is what a
// chunked load, a data refresh and a test fixture all look like. Both the array identity and
// its length are compared, so neither swapping an array for a different one of the same size
// nor pushing into the one already indexed can leave a stale index behind.
function searchIndexSources() {
  return [
    state.trees,
    state.landmarks,
    state.paths,
    state.roads,
    state.waterFeatures,
    state.environmentFeatures,
  ];
}

function searchIndexSourcesChanged(sources) {
  if (!_searchIndexSources || _searchIndexSources.length !== sources.length) return true;
  return sources.some((source, index) => {
    const previous = _searchIndexSources[index];
    return previous.array !== source || previous.length !== source.length;
  });
}

function searchIndexEntry(type, item, rawFields) {
  const fields = [];
  for (const raw of rawFields) {
    const field = normalizeSearchText(raw);
    if (field && !fields.includes(field)) fields.push(field);
  }
  if (!fields.length) return null;
  return { type, item, fields, blob: fields.join(" ") };
}

// Search is also a way to browse the map, so index the human-readable taxonomy as well as
// names. The source values cover OSM's precise classifications (such as `amenity=cafe`),
// while the filter metadata supplies the broader category and its subcategory labels.
// Deliberately exclude contact details and URLs: neither helps someone find a place on the map.
function searchLandmarkFields(place) {
  const fields = [
    place.name,
    place.transportStopName,
    place.category,
    place.categoryLabel,
    ...(place.categoryTags || []),
    place.amenity,
    place.shop,
    place.tourism,
    place.historic,
    place.railway,
    place.highway,
    place.barrier,
    place.entrance,
    place.heritage,
    place.address,
    place.folkloreCategory,
    ...(place.folkloreTopics || []),
    place.type,
    place.area,
    place.description,
  ];

  for (const filterKey of PLACE_FILTER_KEYS) {
    if (!matchesPlaceFilter(place, filterKey)) continue;
    const meta = filterMeta(filterKey);
    if (meta) fields.push(meta.label, meta.title, meta.groupLabel);
  }
  return fields;
}

function buildSearchIndex() {
  const entries = [];
  const push = (type, item, rawFields) => {
    const entry = searchIndexEntry(type, item, rawFields);
    if (entry) entries.push(entry);
  };

  for (const tree of state.trees) {
    push("tree", tree, ["tree", "trees", tree.commonName, tree.latinName, tree.tagNumber, tree.nationalDatabaseTagNumber, tree.recordNumber]);
  }
  for (const place of state.landmarks) {
    push("landmark", place, searchLandmarkFields(place));
  }
  for (const path of state.paths) {
    push("path", path, [path.name, path.ref, path.pathType, path.highway, path.foot, path.horse, path.access]);
  }
  for (const road of state.roads) {
    push("road", road, [road.name, road.ref, road.roadType, road.highway, road.service]);
  }
  for (const water of state.waterFeatures) {
    push("water", water, [water.name, water.featureType, water.waterway]);
  }
  for (const feature of state.environmentFeatures) {
    const props = feature && feature.properties;
    if (!props || props.featureType !== "railway") continue;
    push("railway", feature, [props.name, props.ref, props.railway, props.service]);
  }
  return entries;
}

function ensureSearchIndex() {
  const sources = searchIndexSources();
  if (_searchIndex && !searchIndexSourcesChanged(sources)) return _searchIndex;
  _searchIndex = buildSearchIndex();
  _searchIndexSources = sources.map((array) => ({ array, length: array.length }));
  return _searchIndex;
}

// Roads carry segments but no single coordinate (js/normalize.js): they are drawn as lines
// and were only ever selected by tapping one. Search has to sort them by distance and frame
// them on the map, so the same halfway-along-the-longest-segment anchor paths already use is
// derived here, once per road, the first time that road turns up in a result.
function ensureRoadAnchor(road) {
  if (!road || road.point) return road && road.point ? road.point : null;
  if (!Array.isArray(road.segments)) return null;
  const anchor = pathLabelAnchor(road);
  if (!anchor) return null;
  const lonLat = unprojectPoint(anchor);
  road.point = anchor;
  road.latitude = lonLat.latitude;
  road.longitude = lonLat.longitude;
  return anchor;
}

function searchResultPoint(type, item) {
  if (!item) return null;
  if (type === "road") ensureRoadAnchor(item);
  if (item.point) return item.point;
  if (Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) {
    return projectLonLat(item.longitude, item.latitude);
  }
  const props = item.properties;
  if (props && Number.isFinite(props.latitude) && Number.isFinite(props.longitude)) {
    return projectLonLat(props.longitude, props.latitude);
  }
  return null;
}

function searchResultLatLon(type, item) {
  if (type === "road") ensureRoadAnchor(item);
  if (item && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) {
    return { latitude: item.latitude, longitude: item.longitude };
  }
  const props = item && item.properties;
  if (props && Number.isFinite(props.latitude) && Number.isFinite(props.longitude)) {
    return { latitude: props.latitude, longitude: props.longitude };
  }
  return null;
}

function searchResultDistance(type, item) {
  const origin = nearbyOrigin();
  if (!origin) return null;
  const position = searchResultLatLon(type, item);
  if (!position) return null;
  return distanceMetres(origin.latitude, origin.longitude, position.latitude, position.longitude);
}

function searchResultKey(type, item) {
  switch (type) {
    case "tree": return treeHashKey(item);
    case "landmark": return placeHashKey(item);
    case "cow": return cowKey(item);
    case "path": return pathHashKey(item);
    case "road": return roadHashKey(item);
    case "water": return waterHashKey(item);
    case "railway": return railwayHashKey(item);
    default: return "";
  }
}

function searchResultName(type, item) {
  switch (type) {
    case "tree": return treeDisplayName(item);
    case "landmark": return placeTitle(item);
    case "cow": return `Cow ${displayValue(item.serialNo)}`;
    case "path": return displayValue(item.name || item.ref || "Waymarked trail");
    case "road": return displayValue(item.name || item.ref || "Unnamed road");
    case "water": return displayValue(item.name);
    case "railway": return displayValue((item.properties && (item.properties.name || item.properties.ref)) || "Railway");
    default: return "";
  }
}

function searchResultTypeLabel(type, item) {
  switch (type) {
    case "tree": return "Tree";
    case "landmark":
      if (isEventCategory(item)) return formatEventWhen(item) || "Event";
      return filterMeta(placeLabelFilterKey(item))?.label || item.categoryLabel || "Place";
    case "cow": return "Cow";
    case "path": return filterMeta("waymarked_trails")?.label || "Trail";
    case "road": return roadTypeLabel(item);
    case "water": return item.featureType === "hydrology_area" ? "Pond / lake" : "Stream / waterway";
    case "railway": return "Railway";
    default: return "";
  }
}

function searchResultIconHtml(type, item) {
  switch (type) {
    case "tree": return treeSpeciesIconHtml(item.commonName, item.latinName) || appIconHtml("tree");
    case "landmark": return landmarkEmoji(item);
    case "cow": return appIconHtml("cow");
    case "path": return appIconHtml("waymarked");
    case "road": return roadIconHtml();
    case "water": return appIconHtml("ponds");
    case "railway": return appIconHtml("railway");
    default: return appIconHtml("pin");
  }
}

// Lines share a name across many OSM ways -- "Epping New Road" is dozens of them -- so one
// road is one result, the nearest piece of it. Points are not collapsed that hard: two cafés
// with the same name really are two cafés, and eight bus stops called "Forest Road" really
// are eight stops -- but listing all eight buries the street itself below the fold, so a
// repeated name is allowed a few rows and no more.
const SEARCH_LINE_TYPES = new Set(["road", "path", "water", "railway"]);
const SEARCH_SAME_NAME_LIMIT = 3;

// Breaks a tie that rank and distance leave open -- which is every tie at all when there is
// no location fix. Without it the order fell out of the order the datasets happen to load in.
const SEARCH_TYPE_ORDER = ["landmark", "tree", "road", "path", "water", "railway", "cow"];

function searchTypeOrder(type) {
  const index = SEARCH_TYPE_ORDER.indexOf(type);
  return index === -1 ? SEARCH_TYPE_ORDER.length : index;
}

function searchMapFeatures(query) {
  const needle = normalizeSearchText(query);
  if (needle.length < SEARCH_MIN_QUERY_LENGTH) return [];
  const tokens = searchQueryTokens(needle);

  const matches = [];
  const consider = (type, item, rank) => {
    if (rank === null) return;
    const key = searchResultKey(type, item);
    if (!key) return;
    matches.push({ type, item, key, rank, metres: searchResultDistance(type, item) });
  };

  for (const entry of ensureSearchIndex()) {
    consider(entry.type, entry.item, searchEntryRank(entry, needle, tokens));
  }
  for (const cow of state.cows || []) {
    const entry = searchIndexEntry("cow", cow, ["cow", cow.serialNo]);
    if (entry) consider("cow", cow, searchEntryRank(entry, needle, tokens));
  }

  // Unknown distance (no location fix, or a feature with no coordinate) sorts last within
  // its rank rather than jumping to the front as NaN comparisons would.
  const distance = (entry) => (Number.isFinite(entry.metres) ? entry.metres : Number.POSITIVE_INFINITY);
  matches.sort((a, b) => (
    (a.rank - b.rank)
    || (distance(a) - distance(b))
    || (searchTypeOrder(a.type) - searchTypeOrder(b.type))
  ));

  const results = [];
  const seenCounts = new Map();
  for (const match of matches) {
    const name = normalizeSearchText(searchResultName(match.type, match.item));
    if (name) {
      const nameKey = `${match.type}|${name}`;
      const shown = seenCounts.get(nameKey) || 0;
      if (shown >= (SEARCH_LINE_TYPES.has(match.type) ? 1 : SEARCH_SAME_NAME_LIMIT)) continue;
      seenCounts.set(nameKey, shown + 1);
    }
    results.push(match);
    if (results.length >= SEARCH_RESULT_LIMIT) break;
  }
  return results;
}

// Rings the top SEARCH_HIGHLIGHT_LIMIT matches on the map (drawSearchHighlights, js/renderer.js)
// and zooms out just enough to fit all of them, so typing a broad query immediately shows where
// every top match sits rather than only the closest one. Called on every results recompute --
// searchResultsHtml, on open and on each debounced keystroke (renderSearchResults) -- so the
// highlight and framing track the query live rather than only on selecting a result.
// Frames the user's own position alongside the highlighted matches -- nearbyOrigin() is the same
// point searchResultDistance measures every match's walk chip from, so "nearest first" stays
// legible against where you actually are, rather than zooming out to a view that only shows the
// matches themselves.
function updateSearchHighlight(results) {
  // Highlights only. The camera never moves for a search: matches that lie outside the
  // current view are still listed in Search and Nearby, marked as off the map.
  state.searchHighlightResults = results.slice(0, SEARCH_HIGHLIGHT_LIMIT);
  requestDraw();
}

// True when a search match lies outside the visible map area (the camera is not moved to show it).
function searchResultOffMap(result) {
  const point = searchResultPoint(result.type, result.item);
  if (!point) return false;
  const rect = visibleCanvasRect();
  const screen = worldToScreen(point);
  return screen.x < rect.x || screen.x > rect.x + rect.width
    || screen.y < rect.y || screen.y > rect.y + rect.height;
}

function searchResultsHtml(query) {
  const needle = normalizeSearchText(query);
  if (!needle) {
    updateSearchHighlight([]);
    return `<p class="empty">Search for a tree tag or species, a shop, pub or café, a road, a trail, or anywhere else on the map.</p>`;
  }
  if (needle.length < SEARCH_MIN_QUERY_LENGTH) {
    updateSearchHighlight([]);
    return `<p class="empty">Keep typing — search needs at least ${SEARCH_MIN_QUERY_LENGTH} characters.</p>`;
  }

  const results = searchMapFeatures(query);
  updateSearchHighlight(results);
  if (!results.length) {
    return `<p class="empty">Nothing on the map matches “${escapeHtml(query.trim())}”.</p>`;
  }

  const itemsHtml = results.map((result) => {
    const position = searchResultLatLon(result.type, result.item);
    const walkChip = walkInfoHtml(result.metres);
    const typeLabel = searchResultTypeLabel(result.type, result.item);
    const treeTag = result.type === "tree" ? treeTagLabel(result.item) : null;
    const treeTagChip = treeTag ? ` · #${escapeHtml(treeTag)}` : "";
    return `<li><button class="nearest-item" type="button" data-search-type="${escapeHtml(result.type)}" data-search-key="${escapeHtml(result.key)}">
      <span class="nearest-icon" aria-hidden="true">${searchResultIconHtml(result.type, result.item)}</span>
      <div class="nearest-content">
        <div class="nearest-header">
          <span class="nearest-name">${escapeHtml(searchResultName(result.type, result.item))}</span>
        </div>
        <div class="nearest-footer">
          <span class="nearest-meta">${searchResultOffMap(result) ? "Off the map · " : ""}${walkChip ? `${walkChip} · ` : ""}${escapeHtml(typeLabel)}${treeTagChip}</span>
          <span class="nearest-arrow" data-item-lat="${position ? position.latitude : ""}" data-item-lon="${position ? position.longitude : ""}" aria-hidden="true"${isFarFromForest() ? " hidden" : ""}>↑</span>
        </div>
      </div>
    </button></li>`;
  }).join("");

  const countLabel = results.length >= SEARCH_RESULT_LIMIT
    ? `Closest ${SEARCH_RESULT_LIMIT} matches`
    : `${results.length} match${results.length === 1 ? "" : "es"}`;
  return `<div class="nearby-heading"><strong>${escapeHtml(countLabel)}</strong></div><ul class="nearest-list">${itemsHtml}</ul>`;
}

// The nav button's magnifier again, at title size. There is no search PNG in the icon
// registry (js/categories.js) and the inspector's back arrow sets the precedent for a UI
// glyph drawn inline; app.html carries its own copy because that file holds no logic.
function searchIconHtml(className = "app-icon title-icon") {
  return `<svg class="${className}" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><line x1="15" y1="15" x2="20" y2="20"/></svg>`;
}

function searchScreenHtml() {
  return `<div class="search-screen">
    <div class="search-field">
      <svg class="search-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg>
      <input id="mapSearchInput" class="search-number" type="search" inputmode="search" autocomplete="off"
        autocapitalize="off" spellcheck="false" enterkeyhint="search"
        placeholder="Search trees, places, roads…" aria-label="Search the map"
        value="${escapeHtml(state.searchQuery)}">
      <button id="mapSearchClear" class="search-clear" type="button" aria-label="Clear search"${state.searchQuery ? "" : " hidden"}>✕</button>
    </div>
    <div id="mapSearchResults" class="search-results" role="region" aria-live="polite" aria-label="Search results">${searchResultsHtml(state.searchQuery)}</div>
  </div>`;
}

// Re-renders only #mapSearchResults, never the field above it: replacing the whole body on
// every keystroke would take the focus and the caret with it.
function renderSearchResults() {
  const container = document.getElementById("mapSearchResults");
  if (!container) return;
  container.innerHTML = searchResultsHtml(state.searchQuery);
  const clearButton = document.getElementById("mapSearchClear");
  if (clearButton) clearButton.hidden = !state.searchQuery;
  updateOverviewDirectionArrows();
}

function openSearchScreen() {
  if (typeof dismissOnboarding === "function") dismissOnboarding();
  if (typeof trackGaScreenView === "function") trackGaScreenView("Search");
  // See the matching comment in openFiltersScreen.
  exitClusterExpansion();
  state.filterScreenOpen = false;
  state.selected = null;
  // Building the index here rather than on the first keystroke keeps the hitch off the
  // moment the user is typing into the field.
  ensureSearchIndex();
  setInspectorSelectionChrome({ emoji: searchIconHtml(), showBack: false, preserveNavHighlight: true });
  state.searchScreenOpen = true;
  if (els.nearbyToggle) els.nearbyToggle.hidden = false;
  setNavScreenActive(els.searchToggle);
  // Hides the inline filter toggle next to the Nearby/Filters heading -- Filters is reached
  // from Nearby, not from Search, which deliberately ignores the active filters regardless.
  updateFilterUi();
  els.inspectorTools.hidden = true;
  els.inspectorTitle.textContent = "Search";
  els.inspectorType.textContent = "Find anything on the map";
  // Not auto-focused: opening the screen from the nav bar should show the field and the map
  // behind it, not summon the keyboard immediately. The field is focused when the user taps it.
  transitionInspectorBody(searchScreenHtml(), "forward", updateOverviewDirectionArrows);
  setInspectorMinimized(false);
  syncHashFromSelection();
  requestDraw();
}

// One render per frame: scanning the index is fast but not free, and a fast typist would
// otherwise pay for several scans whose results are replaced before they are ever read.
let _searchRenderFrame = null;

function setSearchQuery(value) {
  const next = String(value ?? "");
  if (state.searchQuery === next) return;
  state.searchQuery = next;
  syncLiveQueryStringForScreen();
  if (_searchRenderFrame != null) cancelAnimationFrame(_searchRenderFrame);
  _searchRenderFrame = requestAnimationFrame(() => {
    _searchRenderFrame = null;
    renderSearchResults();
  });
}

// A search result opens exactly the screen a deep link or a map tap would, through the same
// SELECTION_ROUTES table -- which is also what lets roads and railway lines, neither of which
// the Nearby list can offer, be navigated to from here.
function openSearchResult(type, key) {
  const route = SELECTION_ROUTES.find((entry) => entry.type === type);
  if (!route) return;
  const item = route.find(key);
  if (!item) {
    setStatus("That result is no longer on the map.");
    return;
  }
  state.clusterZoomed = false;
  exitClusterExpansion();
  state.searchScreenOpen = false;
  // A real selection replaces the Nearby view entirely, so any custom browse point -- and its
  // map dot (drawNearbyAnchorMarker, js/renderer.js) -- goes back to the user's own location
  // rather than lingering for whenever Nearby is next shown.
  // Before state.selected changes below -- see startCameraOriginTransition.
  startCameraOriginTransition();
  state.nearbyAnchor = null;
  state.selected = { type, item };
  // Update the URL before rendering, so the selected place and browser history stay in sync.
  syncHashFromSelection();
  route.show(item);
  // The panel stays open, as for a list selection (focusOverviewItem): minimising here was undone by the
  // panel's own tap handler on the same tap, after re-centring the camera at the old scale.
  startCompassNavigation();
  if (state.userLocation) {
    zoomToSelection();
  } else {
    const point = searchResultPoint(type, item);
    if (point) fitToPoints([point], false, { animate: true, focusVisibleArea: true });
  }
  trackSelectionClick(type, item, "search");
  requestDraw();
}
