// Epping Forest Finds — URL routing: the screen routes, the hash and history entries, and the query-string arrivals that set filters, search and radius.
//
// A classic script loaded before js/app.js (see app.html). It holds function declarations only,
// so it runs no code at load time; every value these functions read is declared in app.js or an
// earlier script, and they are first called once boot() has begun.

function routerBootFinished() {
  routerBooting = false;
}

// Normalises the landing entry so navDepth() has something to count from. history.state
// survives a reload, so an entry pushed before the reload keeps the depth it had.
//
// A fresh load reached by a link from another page of this site (a /nearby/<slug>/ page opened
// from a sibling page, say) has no state of its own, but the browser's back button does return
// to that page -- so the arrow must offer it too. Only a same-origin referrer in a tab that has
// history counts: a link opened in a new tab, or one from elsewhere, has nothing to go back to.
function initRouter() {
  if (navDepthOf(history.state) !== null) return;
  const cameFromThisSite = Boolean(document.referrer)
    && new URL(document.referrer).origin === window.location.origin
    && history.length > 1;
  history.replaceState(
    { [NAV_DEPTH_KEY]: cameFromThisSite ? 1 : 0, [NEARBY_ANCHOR_KEY]: nearbyAnchorSnapshot() },
    "",
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  );
}

function navDepthOf(entry) {
  const depth = entry && entry[NAV_DEPTH_KEY];
  return Number.isFinite(depth) ? depth : null;
}

function navDepth() {
  return navDepthOf(history.state) ?? 0;
}

// True when there is a screen of this app's own behind the current one. False after a deep
// link or a fresh load, where going back would leave the site entirely.
function canGoBackInApp() {
  return navDepth() > 0;
}

// The inspector's back arrow. It retraces the trail rather than always jumping to Nearby, so
// it and the device back button agree; the Nearby nav button is still the one-tap way home.
function navigateBack() {
  if (canGoBackInApp()) {
    history.back();
    return;
  }
  goToInitialView();
}

// "tree=r17338" -> "tree". Lets "report" and "report=<text>" be recognised as one screen.
// The canonical route for whatever is on screen right now -- unchanged by the four screens
// having real paths now (ROUTE_PATHS): this still speaks the same bare vocabulary
// ("filters"/"search"/"settings"/"report"/"tree=<key>"/"near=<lat>,<lon>"/"") it always has.
// Serialising that to the real URL, and reading it back, is
// urlPartsForRouteValue/routeValueFromLocation below -- everything in between (this function,
// applyRouteToScreen, SELECTION_ROUTES) never needs to know paths exist at all.
function currentScreenRoute() {
  if (state.searchScreenOpen) return ROUTE_SEARCH;
  if (state.filterScreenOpen) return ROUTE_FILTERS;
  const selection = state.selected;
  if (!selection || !selection.type) {
    // A browse anchor is the plain Nearby screen's own lens, not a selection -- see
    // NEARBY_ANCHOR_PARAM above.
    return state.nearbyAnchor ? nearbyAnchorRouteValue(state.nearbyAnchor) : "";
  }
  if (selection.type === "settings") return ROUTE_SETTINGS;
  if (selection.type === "report") return ROUTE_REPORT;
  if (selection.type === "community") return ROUTE_COMMUNITY;
  if (!selection.item) return "";
  const route = SELECTION_ROUTES.find((entry) => entry.type === selection.type);
  if (!route) return "";
  const key = route.toKey(selection.item);
  return key ? routeParam(route.param, key) : "";
}

function urlMatchesCurrentScreen(raw) {
  // An expanded cluster is a group of pins at one spot on the map, not something a link can
  // re-derive, so it has no URL of its own and never counts as matching one. That is what
  // makes any route arriving from the URL apply -- and so closes the group on back.
  if (state.clusterExpanded) return false;
  const current = currentScreenRoute();
  if (raw === current) return true;
  // #report=<text> is the Report screen carrying a pre-fill, not a different screen.
  return current === ROUTE_REPORT && routeName(raw) === ROUTE_REPORT;
}

// value -> the real URL it lives at. The four screens each have their own path and (bar
// Report's prefill, below) no hash of their own; everything else -- Nearby itself, or a
// selection -- stays on NEARBY_PATH, with the value (if any) carried as the hash fragment,
// exactly as it was universally before paths existed.
function urlPartsForRouteValue(value) {
  const name = routeName(value);
  const path = ROUTE_PATHS[name];
  if (path) {
    // report=<text> (a prefill) is the one screen value that still carries a hash alongside
    // its own path -- everywhere else, reaching a screen's path is the whole story.
    const hash = name === ROUTE_REPORT && value !== name ? `#${value}` : "";
    return { pathname: path, hash };
  }
  // A selected place that has its own crawlable /find/<slug>/ page (findSlug, attached at load
  // time from data/business-slugs.json -- the food/locations groups only) gets that real page as
  // its address-bar URL instead of #place=<hashKey> on /nearby -- the same URL a search result
  // would land on, so copying the address bar, sharing it, or search-engine indexing are all one
  // and the same link. Anything else selectable (a tree, a cow, a bus stop, a historic site) has
  // no such page and keeps the existing hash-on-/nearby form unchanged.
  if (name === "place") {
    const item = findPlaceByHashKey(new URLSearchParams(value).get("place"));
    if (item && item.findSlug) return { pathname: `/find/${item.findSlug}/`, hash: "" };
  }
  return { pathname: NEARBY_PATH, hash: value ? `#${value}` : "" };
}

// The live, shareable description of exactly what's showing, as the query string for
// whichever of Nearby's own paths (NEARBY_PATH itself, or its /filter and /search sub-paths)
// window.location.pathname names. "radius" (walking minutes) travels on all three, since it
// describes the Nearby view underneath every one of them, not a particular screen; "show" (the
// active filter set, comma-joined) is /filter's own, and "q" (the typed text) is /search's --
// built by hand rather than with URLSearchParams so a multi-value "show" keeps its plain commas
// instead of being percent-encoded. Every other path never carries any of this.
function searchStringForPath(pathname) {
  const onNearbyFamily = pathname === NEARBY_PATH
    || pathname === ROUTE_PATHS[ROUTE_FILTERS]
    || pathname === ROUTE_PATHS[ROUTE_SEARCH];
  const parts = [];
  // While a cluster tap has borrowed the radius to cover the group (focusNearbyOnClusterGroup),
  // state.walkingDistanceMinutes is that borrowed value, not the reader's real one -- the same
  // reasoning exitClusterExpansion already restores on the way out. Reading past it to
  // preClusterWalkingDistanceMinutes here keeps that borrowed ring out of the address bar, so a
  // history entry written while a group is expanded never bakes it in as if it were chosen.
  const realRadius = state.clusterExpanded && state.preClusterWalkingDistanceMinutes != null
    ? state.preClusterWalkingDistanceMinutes
    : state.walkingDistanceMinutes;
  // A first-landing radius (applyFirstLandingRadius) was chosen for this visit, not by the reader, so it is not
  // written out; only a radius the reader then changes is.
  if (onNearbyFamily && realRadius !== DEFAULT_WALKING_DISTANCE_MINUTES && realRadius !== state.firstLandingRadiusMinutes) {
    parts.push(`radius=${realRadius}`);
  }
  // A shared /nearby?show= link is an ephemeral landing lens just like /nearby/<slug>.
  // Keep its query visible while that lens is active; otherwise the first selectOverview() during
  // a cold/nuke refresh rewrites the URL to bare /nearby before the caller can verify the refresh.
  // Every category on is the show-everything override, written as the "All nearby" link's own
  // ?filters=false rather than a list of every key.
  if (pathname === NEARBY_PATH && state.overviewFiltersEphemeral && railSelection().length === 0) {
    parts.push("filters=false");
  } else if ((pathname === ROUTE_PATHS[ROUTE_FILTERS]
    || (pathname === NEARBY_PATH && state.overviewFiltersEphemeral)) && state.overviewFilters.length) {
    parts.push(`show=${state.overviewFilters.join(",")}`);
  }
  if (pathname === ROUTE_PATHS[ROUTE_SEARCH] && state.searchQuery) {
    parts.push(`q=${encodeURIComponent(state.searchQuery)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// The business a /find/<slug>/ landing names, or null for any other path ("events" is not a place).
function findLandingSlug() {
  const match = /^\/find\/([a-z0-9-]+)\/?$/.exec(window.location.pathname);
  return match && match[1] !== "events" ? match[1] : null;
}

// True while a /find/<slug>/ landing has not yet shown its place: the place is selected only once it
// is in the loaded landmarks, and the boot reveal and cow data both reach selectOverview() before
// that. Until then the Nearby list must not paint over the server-rendered panel. Once the data has
// loaded without the place, the landing has nothing to wait for and falls back to the Nearby list.
function findLandingAwaitingPlace() {
  const slug = findLandingSlug();
  return Boolean(slug) && !state.selected && (!state.dataLoaded || Boolean(findPlaceByFindSlug(slug)));
}

// The reverse of urlPartsForRouteValue: reconstructs the bare route value currentScreenRoute()
// and applyRouteToScreen() already speak, from the real URL on screen right now.
function routeValueFromLocation() {
  const pathname = window.location.pathname;
  const screenName = Object.keys(ROUTE_PATHS).find((name) => ROUTE_PATHS[name] === pathname);
  if (screenName) {
    const hash = window.location.hash.replace(/^#/, "").trim();
    return screenName === ROUTE_REPORT && hash ? hash : screenName;
  }
  // The reverse of urlPartsForRouteValue's own /find/<slug>/ case above: a popstate landing back
  // on one of these (reached only via that pushState -- a hard page load of the real static file
  // never runs this, since boot() hasn't happened yet) re-selects the same place through the
  // ordinary "landmark" SELECTION_ROUTES entry, exactly as if #place=<hashKey> had named it.
  // "events" is the one /find/ path that isn't a place (scripts/generate-business-pages.js's own
  // RESERVED_SLUGS) and never reaches findPlaceByFindSlug.
  const findMatch = /^\/find\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (findMatch && findMatch[1] !== "events") {
    const item = findPlaceByFindSlug(findMatch[1]);
    if (item) return routeParam("place", placeHashKey(item));
  }
  return window.location.hash.replace(/^#/, "").trim();
}

function syncHashFromSelection(options) {
  setHashFromSelection(currentScreenRoute(), options);
}

// Writes `value` into the URL as a new history entry. `force` pushes even when the URL is
// unchanged, for the cluster group screen, which has no URL of its own but is still a screen
// the back button has to be able to leave.
function setHashFromSelection(value, { force = false } = {}) {
  if (routeApplyDepth > 0 || routerBooting) return;
  const { pathname, hash } = urlPartsForRouteValue(value);
  const nextUrl = `${pathname}${searchStringForPath(pathname)}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (!force && currentUrl === nextUrl) return;
  history.pushState(
    { [NAV_DEPTH_KEY]: navDepth() + 1, [NEARBY_ANCHOR_KEY]: nearbyAnchorSnapshot() },
    "",
    nextUrl
  );
}

// Called after every Nearby browse move (a cluster tap, a tap on open ground, or clearing the
// anchor) to record it in history -- named for that purpose rather than left as a bare
// syncHashFromSelection() call so each call site still reads as "record this anchor move".
// Safe to call even when selectOverview()'s own trailing syncHashFromSelection() (via
// refreshNearbyRadiusView) already pushed the very same URL moments earlier: now that
// currentScreenRoute() carries state.nearbyAnchor itself (nearbyAnchorRouteValue), a second call
// here is just setHashFromSelection's own "URL unchanged" no-op rather than a duplicate entry --
// unlike before this existed, when the anchor had no hash of its own and every move needed a
// forced push to get a back-button step at all.
function pushNearbyAnchorHistory() {
  syncHashFromSelection();
}

// Corrects the current entry's URL without adding one, keeping the entry's depth.
function replaceHashInPlace(value) {
  const { pathname, hash } = urlPartsForRouteValue(value);
  const url = `${pathname}${searchStringForPath(pathname)}${hash}`;
  history.replaceState(history.state, "", url);
}

// While the compatibility /nearby/filter route is open, every change to state.overviewFilters
// corrects its query string in place -- replaces rather than pushes, or every staged choice would
// add its own back-button step. Arriving at the route already gets the right query string for free
// (setHashFromSelection/replaceHashInPlace above both run searchStringForPath on push); this is
// only for a change that happens without a screen transition alongside it.
// Shared by setOverviewFilters (while on /filter) and setSearchQuery (while on /search) --
// searchStringForPath already returns "" for a path with nothing live to carry, so this is a
// no-op on every other screen without needing to ask which one called it.
function syncLiveQueryStringForScreen() {
  if (routeApplyDepth > 0 || routerBooting) return;
  const search = searchStringForPath(window.location.pathname);
  if (window.location.search === search) return;
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  history.replaceState(history.state, "", url);
}

// The back/forward buttons, the device back gesture, and a hash the user edited by hand.
// Both events reach here: pushState fires neither, a traversal fires popstate (and hashchange
// too, when the fragment differs), and a hand-edited fragment fires hashchange alone.
// Re-applying a route the app is already on is the same as doing nothing, so the shared
// entry point simply checks first.
function applyRouteFromUrl() {
  // A ?show= on whichever path was just navigated to (back/forward, or a hand-typed URL) is
  // applied before the route itself, the same way boot() applies it once up front -- so e.g.
  // routing to /nearby?show=pubs,cafes or /filter?show=pubs lands with the right filters on.
  // Guarded the same way applyRoute() guards its own screen change: the compatibility route's
  // staged filters are applied before the modal opens, so the current Nearby view remains the
  // source of truth while the route is being resolved.
  routeApplyDepth += 1;
  let raw;
  try {
    // A real route change should derive the rail level from its new path. A rail tap uses
    // replaceState only, so it never comes through here and can retain its displayed level.
    state.nearbyRailGroupKey = undefined;
    applyShowFilterFromQuery();
    applySearchQueryFromQuery();
    applyRadiusFromQuery();
    raw = routeValueFromLocation();
    if (urlMatchesCurrentScreen(raw)) return true;
  } finally {
    routeApplyDepth -= 1;
  }
  return applyRoute(raw, false);
}

// A click on a plain <a href="/..."> generated into the inspector (nearbySectionsHtml's
// category/group chips and nearest-tree/cow cards) used to fall straight
// through to the browser's own navigation -- a full page reload that re-downloads and re-boots
// the whole app shell for content already sitting in memory, rather than the instant SPA
// transition every other in-app move (a map tap, a search result, a Nearby-list item) already
// gets. This is the click-handler counterpart to setHashFromSelection: push the target URL as a
// new history entry in the same shape, then run it through applyRouteFromUrl -- the same entry
// point the back/forward buttons and a hand-edited hash already use -- so an intercepted link
// behaves exactly like landing on that URL any other way.
function navigateInApp(href) {
  // Every href this reaches is already a root-relative internal path (every generator above
  // builds one, never a full URL), so this is plain string splitting -- same approach
  // searchStringForPath/urlPartsForRouteValue already use -- rather than the URL class.
  const raw = String(href || "");
  const hashIndex = raw.indexOf("#");
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : "";
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const searchIndex = beforeHash.indexOf("?");
  const search = searchIndex >= 0 ? beforeHash.slice(searchIndex) : "";
  const pathname = searchIndex >= 0 ? beforeHash.slice(0, searchIndex) : beforeHash;
  const targetUrl = `${pathname}${search}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (targetUrl === currentUrl) return;
  history.pushState(
    { [NAV_DEPTH_KEY]: navDepth() + 1, [NEARBY_ANCHOR_KEY]: nearbyAnchorSnapshot() },
    "",
    targetUrl
  );
  applyRouteFromUrl();
}

// Applies the route named in the URL at load time. Unlike applyRouteFromUrl this leaves an
// empty hash alone: at boot the Nearby screen has already been built behind the loading
// overlay, and there is nothing to navigate away from.
function applySelectionFromHash(announceMissing = true) {
  const raw = routeValueFromLocation();
  if (!raw) return false;
  return applyRoute(raw, announceMissing);
}

// Puts the app on the screen `raw` names. Nothing in here writes the URL -- the URL is where
// `raw` came from.
function applyRoute(raw, announceMissing = false) {
  routeApplyDepth += 1;
  try {
    return applyRouteToScreen(raw, announceMissing);
  } finally {
    routeApplyDepth -= 1;
  }
}

function applyRouteToScreen(raw, announceMissing) {
  const value = String(raw || "").replace(/^#/, "").trim();

  // The setup route owns the modal. A browser Back/Forward traversal to any other route must
  // dismiss it before that destination renders, otherwise the old dialog can remain over a new
  // screen while its filter state still claims the compatibility route is active.
  if (value !== ROUTE_FILTERS && mapSetupModalActive()) {
    dismissOnboarding();
  }

  // Whatever the route turns out to be, arriving at one is navigating away from an expanded
  // map group -- the one screen with no URL of its own (see urlMatchesCurrentScreen).
  state.clusterZoomed = false;
  exitClusterExpansion();

  if (!value) {
    goToInitialView(false);
    return true;
  }
  if (value === ROUTE_FILTERS) {
    openFiltersScreen();
    return true;
  }
  if (value === ROUTE_SEARCH) {
    openSearchScreen();
    return true;
  }
  if (value === ROUTE_SETTINGS) {
    openSettings();
    return true;
  }
  if (value === ROUTE_COMMUNITY) {
    openCommunityOrFeedback();
    return true;
  }

  const params = new URLSearchParams(value);

  // #report opens the report-a-problem form. The weekly reports link here so a reader who
  // spots a mistake lands straight on the form, and #report=<text> pre-fills it with which
  // report they were reading.
  if (params.has(ROUTE_REPORT)) {
    openReportModal();
    const prefill = params.get(ROUTE_REPORT);
    const detailsInput = document.getElementById("reportDetails");
    if (prefill && detailsInput && !detailsInput.value) {
      detailsInput.value = `${prefill}: `;
    }
    return true;
  }

  for (const route of SELECTION_ROUTES) {
    if (!params.has(route.param)) continue;
    const item = route.find(params.get(route.param));
    if (item) {
      showRoutedSelection(route, item);
      return true;
    }
    break;
  }

  // "near=<lat>,<lon>" -- a shared or hand-edited browse-anchor link, not a selection (see
  // NEARBY_ANCHOR_PARAM). A popstate normally never reaches this: restoreNearbyAnchorFromHistory
  // (js/nav.js) already applied the target entry's anchor before applyRouteFromUrl ran, so
  // urlMatchesCurrentScreen short-circuits above. This is what actually resolves it for a fresh
  // load and for a hashchange with no matching history traversal (a hand-edited fragment, or a
  // future in-page link straight to a "near=" hash).
  if (params.has(NEARBY_ANCHOR_PARAM)) {
    const anchor = parseNearbyAnchorParam(params.get(NEARBY_ANCHOR_PARAM));
    if (anchor) {
      applyNearbyAnchorFromRoute({ ...anchor, label: params.get(NEARBY_ANCHOR_LABEL_PARAM) || null });
      return true;
    }
  }

  if (announceMissing) setStatus("Linked location was not found in this dataset.");
  // The URL names something this dataset has no answer for (a stale share link, an item
  // dropped by a data update). Leaving it in the address bar would leave the app on a screen
  // its URL does not describe -- and so make the next back press unpredictable -- so fall
  // back to Nearby and correct the entry in place rather than pushing another one.
  goToInitialView(false);
  replaceHashInPlace("");
  return false;
}

function showRoutedSelection(route, item) {
  // A real selection replaces the Nearby view entirely, so any custom browse point -- and its
  // map dot (drawNearbyAnchorMarker, js/renderer.js) -- goes back to the user's own location
  // rather than lingering for whenever Nearby is next shown.
  // Capture the currently drawn browse pivot before clearing it; otherwise entering a linked
  // selection from an anchored Nearby view makes the 3D/heading-up camera jump to the GPS fix
  // before the selection's own camera animation can take over.
  startCameraOriginTransition();
  state.nearbyAnchor = null;
  state.selected = { type: route.type, item };
  route.show(item);
  // The direction arrow for the new selection: it spins while a first fix is still out.
  updateCompassOverlay();
  // Deep-linked selections behave like a map-tap selection: the inspector opens expanded
  // immediately on both mobile and desktop (spec.md "Inspector modes"). Force it open (not
  // just skip minimizing) so arriving at a new linked location while the inspector was
  // already minimized doesn't stay collapsed.
  setInspectorMinimized(false);
  startCompassNavigation();
  if (state.userLocation) {
    // The same choice zoomToSelection makes: while heading-up navigation is on, the camera frames the
    // place the way the heading-up follow will keep it. The flat fit used here before landed about
    // twice as far in, so the next compass or GPS update pulled the camera back out after the move.
    if (selectedNavigationHeadingUpActive()) {
      animateToHeadingUpNavigationViewport(HEADING_UP_NAV_ANIMATION_MS, { assumeInspectorOpen: true });
    } else {
      ensureUserAndSelectionVisible({ animate: true, force: true, assumeInspectorOpen: true });
    }
  } else if (item.point) {
    // A deep-linked selection can arrive before a location fix exists. The inspector has already
    // been opened above, so the first fit must use the map area that remains visible beside/above
    // that panel; fitting against the full canvas leaves the destination underneath it until a
    // later resize or camera correction happens.
    fitToPoints([item.point], false, { animate: true, focusVisibleArea: true, assumeInspectorOpen: true });
  }
  // Hold the selection's map state until this camera move lands, as zoomToSelection does. Without it
  // the renderer hid the Nearby pins and ring for the whole move, so a #tree= link blanked the map.
  holdSelectionMapUntilCameraSettles();
  requestDraw();
}

// --- Router ---------------------------------------------------------------------------
//
// Every screen the app can be on has a URL, and the URL is what puts it there. A screen
// change pushes a history entry, so the browser's back button, the phone's back gesture and
// the inspector's own back arrow all retrace the same trail -- Nearby -> Filters -> a tree
// comes back out a step at a time. Until this existed the app wrote the hash with
// replaceState only, so back left the site from wherever the user had got to, Settings and
// Report had no URL at all, and selecting anything that was not a tree or a place (a cow, a
// street, a trail) quietly rewrote the address bar to the Nearby screen's URL.
//
// One canonical string -- the hash payload, without the "#" -- names a screen:
//
//   ""                 Nearby (the app's home screen)
//   "filters"          Filters      "settings"  Settings      "report"  Feedback/Report
//   "tree=<key>"       a selected tree; likewise place, cow, path, water, road, railway
//
// currentScreenRoute() writes it from state, applyRoute() reads it back into state, and the
// two must agree: urlMatchesCurrentScreen() is what decides that an arriving URL is already
// on screen and needs no work.
//
// This file loads before app.js, so everything the router reads is in place by the time boot()
// runs: boot()'s first statement is initRouter().

// Each of the four screens above now has a real path of its own (netlify.toml, server.js --
// all rewrite these to app.html, same as /app used to). Nearby (no screen name, "" in the
// route vocabulary below) is the one with no entry here: it is NEARBY_PATH, the app's new
// place-agnostic entry point, replacing /app (now a bare redirect to it). Filter and Search
// nest under /nearby/ -- both only ever change what Nearby itself is showing (a filtered set,
// a typed query), never a destination of their own -- while Settings and Report stay top-level,
// general app screens with nothing to do with the Nearby view underneath them.
// How deep inside the app's own history the current entry sits, carried in history.state.
// 0 means "this is where the user arrived", so there is nothing behind it to go back to and
// the in-app back arrow must return to Nearby itself rather than leaving the site.
// Carries the Nearby browse anchor (state.nearbyAnchor) on every history entry, so moving
// between clusters -- which has no URL of its own, unlike a selection -- still retraces on the
// browser back button and the inspector's own back arrow. Every entry snapshots the anchor in
// effect *when that entry was created*, so landing back on it (in either direction) restores
// exactly that anchor. Absent (older entries, or the initial boot entry before this existed)
// reads as "no anchor" via nearbyAnchorSnapshot's own null default.
function nearbyAnchorSnapshot() {
  const anchor = state.nearbyAnchor;
  return anchor ? { latitude: anchor.latitude, longitude: anchor.longitude } : null;
}

// A /nearby/<slug> category page IS the app (scripts/generate-find-pages.js templates it off
// this same app.html), so the path itself names the category to land already filtered to --
// slugFor() in that script turns an underscore into a hyphen, this is the reverse. ?show=
// stays as a fallback entry point for any older link still using the query-param form.
// /nearby/<slug> is either one subfilter's own page or a whole top-level group's page
// (collectPages in scripts/generate-find-pages.js generates both) -- this is the reverse of
// either: the filter keys to apply, one for a subfilter slug, every member key for a group
// slug (e.g. /nearby/food resolves to ["pubs", "restaurants", "cafes", "shops"]). "filter" and
// "search" never match a real category (RESERVED_SLUGS in that script keeps it that way), so
// this falls through to [] for /nearby/filter and /nearby/search exactly as it should --
// those two are screens in their own right, not categories.
function filterKeysFromFindPath(pathname) {
  const match = /^\/nearby\/([a-z0-9-]+)\/?$/.exec(String(pathname || ""));
  if (!match) return [];
  const key = match[1].replace(/-/g, "_");
  if (ALL_OVERVIEW_FILTER_KEYS.has(key)) return [key];
  const group = FILTER_GROUPS_BY_KEY.get(key);
  if (!group) return [];
  return group.subfilters.map((s) => s.key).filter((k) => ALL_OVERVIEW_FILTER_KEYS.has(k));
}

// ?show=pubs,cafes -- /filter's own live query string (searchStringForPath) writes exactly
// this comma-joined form, and this is its reverse: every key /filter or a shared link named,
// filtered to ones ALL_OVERVIEW_FILTER_KEYS actually recognises so a typo or a stale key drops
// silently rather than breaking the parse.
function filterKeysFromQuery(search) {
  const raw = new URLSearchParams(search).get("show");
  if (!raw) return [];
  return raw.split(",").map((key) => key.trim()).filter((key) => ALL_OVERVIEW_FILTER_KEYS.has(key));
}

// ?filters=false -- "All nearby" links (the Nearby category-navigation chip, and the walk-radius card
// in a place's inspector). Means "ignore my saved filters and show every category", so it is read
// here as its own override rather than a ?show= list: applyShowFilterFromQuery applies every key
// ephemerally (persist:false), and the reader's own filters come back on the next plain visit.
function showsEverythingFromQuery(search) {
  return new URLSearchParams(search).get("filters") === "false";
}

// True on a /nearby/<slug>/ category page (a subfilter's own, or a whole group's) -- the landing
// whose Nearby list generate-find-pages.js server-renders, and so the one that keeps it on screen
// until the reader's own location resolves (_serverRenderedNearbyList, js/inspector.js).
function isNearbyCategoryLandingPath() {
  return filterKeysFromFindPath(window.location.pathname).length > 0;
}

// True when this load's own URL already names a landing-page pre-filter -- a /nearby/<slug>
// page's own path, a first-touch ?show= link, or a /find/<slug>/ business page's own path --
// read straight off the URL rather than off state.overviewFilters/overviewFiltersEphemeral
// (what activeFiltersShowFullListWithoutLocation() checks): boot() needs this answer before
// applyShowFilterFromQuery() has run, at the point where it decides whether to show onboarding
// at all. A reader arriving this way already has their own category -- or, for /find/, their
// own exact business -- picked for them; the first-run setup wizard (pick what to see, enable
// location) doesn't fit that arrival and is saved for a first visit to the plain Nearby screen.
// "events" is the one /find/ path that isn't a business of its own (same carve-out
// routeValueFromLocation's own findMatch makes) and falls through to the ordinary first-run check.
function isLandingPageArrival() {
  const findMatch = /^\/find\/([a-z0-9-]+)\/?$/.exec(window.location.pathname);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hasSelectionHash = SELECTION_ROUTES.some((route) => hashParams.has(route.param));
  return filterKeysFromFindPath(window.location.pathname).length > 0
    || filterKeysFromQuery(window.location.search).length > 0
    || hasSelectionHash
    || (findMatch != null && findMatch[1] !== "events");
}

// True once this load is a dedicated app launch rather than an ordinary browser tab -- an
// installed home-screen PWA (display-mode: standalone, or iOS's older navigator.standalone) or
// a Capacitor native wrapper (spec-native.md; js/native.js doesn't exist yet, so this checks
// window.Capacitor directly rather than depending on it). Only this context gets the full-screen
// #loadingOverlay boot() has always shown: a deliberate app open, usually served from the service
// worker's own caches, where a branded step-by-step wait reads as a splash screen rather than
// something hiding content the visitor already has. Every ordinary browser tab -- including
// every /nearby/<slug> and /find/<slug> SEO landing page -- never shows it: #loadingOverlay
// starts `hidden` in app.html, so a no-JS visitor or a crawler sees the server-rendered content
// immediately (spec-marketing.md §6.6/6.7), and boot() below only ever shows a thin, non-blocking
// top progress bar (the same element, styled via the "inline" class in css/loading.css) while
// the same data loads behind the map and static content, which stay visible and interactive the
// whole time.
function applyShowFilterFromQuery({ render = true } = {}) {
  if (showsEverythingFromQuery(window.location.search)) {
    setOverviewFilters(Array.from(ALL_OVERVIEW_FILTER_KEYS), { persist: false, render });
    return;
  }
  const fromPath = filterKeysFromFindPath(window.location.pathname);
  if (fromPath.length) {
    setOverviewFilters(fromPath, { persist: false, render });
    return;
  }
  // /nearby/filter's own ?show= (searchStringForPath) is a live mirror of whatever is already
  // active, not an external pre-filter -- real only when it is how the reader first arrived
  // (routeApplyDepth is still 0: boot(), or a shared /nearby/filter?show= link read fresh).
  // Retracing a history entry on /nearby/filter itself (back/forward, routeApplyDepth > 0 inside
  // applyRouteFromUrl) reads the exact value this same reader's own earlier action wrote, so
  // reapplying it would wrongly flag already-active filters -- the ordinary 1-3 filter default
  // state included -- as a page's own ephemeral lens, handing them the no-location full-list/fit
  // treatment meant only for an actual single-category or group-page arrival (for the default
  // filters, that means trying to list and fit every tree in the forest). Nothing has changed on
  // this path, so there is nothing to (re)apply.
  if (window.location.pathname === ROUTE_PATHS[ROUTE_FILTERS] && routeApplyDepth > 0) return;
  const fromQuery = filterKeysFromQuery(window.location.search);
  if (fromQuery.length) {
    setOverviewFilters(fromQuery, { persist: false, render });
    return;
  }
  // Landing on the bare Nearby path with nothing selected (no hash -- a tree/cow/landmark
  // selection without its own /find/ page also lands on NEARBY_PATH, but always carries one,
  // see urlPartsForRouteValue) while still showing a /nearby/<slug> page's own ephemeral category
  // is the reader explicitly leaving that lens -- the "All nearby" category-navigation chip, or any
  // other link/back-nav straight to the plain Nearby screen -- so put their own filters back.
  // goToInitialView() (js/nav.js) already does this same restore for the *selection* half of
  // "leaving" (the Nearby nav button, the inspector back arrow), but can't cover this case: the
  // route value is "" both before and after ("nothing selected" either way), so
  // urlMatchesCurrentScreen() reads it as no change and applyRouteFromUrl() returns before
  // applyRoute()/goToInitialView() ever run.
  if (window.location.pathname === NEARBY_PATH && !window.location.hash && state.overviewFiltersEphemeral) {
    setOverviewFilters(loadStoredOverviewFilters(), { render });
  }
}

// ?q=<text> -- /search's own live query string (searchStringForPath), reversed: whatever a
// shared link named, set directly rather than through setSearchQuery so a query arriving before
// the Search screen itself has opened (a fresh /search?q=... load, or back/forward onto it)
// needs no element on the page yet -- openSearchScreen's own render picks up state.searchQuery
// the same way it already does for a query restored within the same session (see its comment).
function applySearchQueryFromQuery() {
  const query = new URLSearchParams(window.location.search).get("q");
  if (query) state.searchQuery = query;
}

// ?radius=<minutes> -- searchStringForPath's reverse, on any of Nearby's own paths (see its
// comment). Clamped to the slider's own bounds (js/nav.js) rather than trusted outright: a
// shared link is as editable as any URL, and the dynamic per-origin floor corrects a value
// that's merely too tight for the actual nearest match on the next fix, the same way the
// Settings slider and the pinch gesture already self-correct (see "radius widens itself back
// out as you walk" in spec.md).
function applyRadiusFromQuery() {
  // Number(null) is 0, not NaN -- read the raw param first so a missing ?radius= is left alone
  // instead of silently clamping every other navigation's radius down to the 1-minute floor.
  const param = new URLSearchParams(window.location.search).get("radius");
  if (param == null) {
    // A /nearby/<slug> landing page gets the wider default unless the link itself already named
    // a radius above -- the same "arrival sets the lens" treatment applyShowFilterFromQuery
    // already gives that page's filters, so it applies every time this path is landed on, boot
    // or popstate alike, consistently with how the filters themselves are re-applied there too.
    if (filterKeysFromFindPath(window.location.pathname).length) {
      state.walkingDistanceMinutes = LANDING_PAGE_WALKING_DISTANCE_MINUTES;
    }
    return;
  }
  const raw = Number(param);
  if (!Number.isFinite(raw)) return;
  state.walkingDistanceMinutes = clamp(raw, WALKING_RADIUS_MIN_MINUTES, WALKING_RADIUS_MAX_MINUTES);
}
