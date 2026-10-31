// Filter-state rules shared by the app's initial state and Map setup.
// Rendering and event handlers remain in js/app.js; this boundary owns validation,
// persistence, and the derived filter sets used by both those consumers.

// The first-run map should feel interesting without becoming visually dense. Keep this
// list shared by the boot defaults and the onboarding dialog so a skipped setup and a
// completed setup produce the same initial map.
const DEFAULT_OVERVIEW_FILTER_KEYS = ["trees", "cows", "events", "pubs", "churches", "campsites"];

function sanitizeOverviewFilters(filters) {
  return Array.from(new Set((Array.isArray(filters) ? filters : []).filter((key) => ALL_OVERVIEW_FILTER_KEYS.has(key))));
}

function sanitizeExpandedGroups(groups) {
  return Array.from(new Set((Array.isArray(groups) ? groups : []).filter((key) => FILTER_GROUPS_BY_KEY.has(key))));
}

function activeOverviewFilterSet() {
  return new Set(sanitizeOverviewFilters(state.overviewFilters));
}

function activeOverviewExpandedSet() {
  return new Set(sanitizeExpandedGroups(state.overviewExpandedGroups));
}

function getActiveSubfiltersForGroup(groupKey, currentSet = activeOverviewFilterSet()) {
  const group = FILTER_GROUPS_BY_KEY.get(groupKey);
  if (!group) return [];
  return group.subfilters.map((subfilter) => subfilter.key).filter((key) => currentSet.has(key));
}

function isGroupActive(groupKey, currentSet = activeOverviewFilterSet()) {
  return getActiveSubfiltersForGroup(groupKey, currentSet).length > 0;
}

function isSubfilterActive(filterKey, currentSet = activeOverviewFilterSet()) {
  return currentSet.has(filterKey);
}

function getActiveGroupKeys(currentSet = activeOverviewFilterSet()) {
  return FILTER_GROUPS.filter((group) => isGroupActive(group.key, currentSet)).map((group) => group.key);
}

function getActivePlaceFilterKeys(currentSet = activeOverviewFilterSet()) {
  return Array.from(currentSet).filter((key) => PLACE_FILTER_KEYS.has(key));
}

function getActivePointFilterKeys(currentSet = activeOverviewFilterSet()) {
  return Array.from(currentSet).filter((key) => !LAYER_FILTER_KEYS.has(key));
}

function pointFilterKeysForNearestFallback() {
  const activePointFilters = getActivePointFilterKeys();
  if (state.overviewFilters.length > 0) return activePointFilters;
  return FILTER_SUBFILTERS
    .map((subfilter) => subfilter.key)
    .filter((key) => !LAYER_FILTER_KEYS.has(key));
}

function saveFilterState() {
  try {
    localStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
      filters: state.overviewFilters,
      expandedGroups: state.overviewExpandedGroups,
    }));
  } catch {}
}

// The reader's own real filters -- read once for the initial state object below, and again by
// goToInitialView to put them back after a /nearby/<slug> page's own ephemeral single category.
function loadStoredOverviewFilters() {
  try {
    const d = JSON.parse(localStorage.getItem(FILTER_STATE_KEY) || "null");
    if (d && Array.isArray(d.filters)) return sanitizeOverviewFilters(d.filters);
  } catch {}
  return DEFAULT_OVERVIEW_FILTER_KEYS.slice();
}
