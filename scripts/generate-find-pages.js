#!/usr/bin/env node
"use strict";

/**
 * Generates one crawlable category page per POI filter subfilter -- e.g.
 * nearby/pubs/index.html, served at /nearby/pubs/ -- plus one per top-level
 * group (nearby/food/, nearby/transport/, ...), pre-filtering Nearby to every
 * subfilter in it at once. Both kinds live under /nearby/ rather than /find/
 * because that is the UI they land on -- the Nearby screen, pre-filtered --
 * and /find/ is reserved for individual businesses and points of interest,
 * not categories. Both kinds template off the real app.html rather than
 * writing a separate static page. The result IS the app: same DOM,
 * same <script src> list, same CSS. Only the <head>'s SEO tags and the
 * inspector's initial (pre-boot) content are swapped in, so a crawler or a
 * visitor arriving before JS has booted sees real, specific content, and
 * js/app.js's filterKeysFromFindPath() then reads the category (or, for a
 * group page, every category in it) straight out of the URL path once it
 * does boot, pre-filtering Nearby to it -- no separate marketing page, no
 * redirect through /nearby.
 *
 * A category's count is exactly what the map would show for it: this
 * reuses the weekly report's own classification
 * (scripts/report/map-inventory.js, which loads js/categories.js's real
 * rules), rather than recomputing it separately and risking the two
 * drifting apart.
 *
 * Run directly: node scripts/generate-find-pages.js
 * Also exported for tests (see test/find-pages.test.js).
 * Wired into `npm run build` alongside generate-sitemap.js.
 */

const fs = require("node:fs");
const path = require("node:path");

const { buildInventory, loadAppRules } = require("./report/map-inventory.js");
const { escapeHtml, replaceOnce, customizeConsentBannerText } = require("./lib/html-template.js");
const { listBusinessesForFilterKey, loadEvents, haversineMetres } = require("./generate-business-pages.js");

const SITE_ORIGIN = "https://www.eppingforestfinds.uk";
const SITE_NAME = "Epping Forest Finds";

// The same stand-in origin and radius revealNoRealLocation()/applyDefaultLocation() (js/app.js)
// use live whenever a visitor hasn't shared their own location -- the common case for a reader
// landing on one of these pages cold. Without this, the static list showed every matching place
// in the whole forest (dataset order), while the live Nearby list a reader saw moments later,
// once JS booted, showed only the ~handful within a 30-minute walk of High Beach, nearest first
// -- a reader (or a crawler) saw what looked like two different, disagreeing lists for the same
// page. DEFAULT_LOCATION/LANDING_PAGE_WALKING_DISTANCE_MINUTES are duplicated here (not
// imported: js/app.js can't be loaded into loadAppRules()'s vm sandbox the way js/categories.js/
// js/normalize.js are -- it references `document` at module-evaluation time) rather than
// recomputed differently, so a future change to either constant needs updating in both places.
const DEFAULT_LOCATION = { latitude: 51.667591, longitude: 0.037454 };
// haversineMetres (scripts/generate-business-pages.js) reads .lat/.lon, not .latitude/.longitude
// -- DEFAULT_LOCATION keeps js/app.js's own naming above since it's a direct copy of that
// constant, so this is the one spot that bridges the two.
const DEFAULT_LOCATION_LAT_LON = { lat: DEFAULT_LOCATION.latitude, lon: DEFAULT_LOCATION.longitude };
const LANDING_PAGE_WALKING_RADIUS_METRES = 30 * (5000 / 60); // walkingDistanceToMetres(30), js/app.js
// Category pages live under /nearby/ (the screen they pre-filter), never /find/ (reserved for
// individual businesses and points of interest, not yet built).
const CATEGORY_DIR_NAME = "nearby";
const APP_HTML_NAME = "app.html";
// A category slug can never equal one of these: both are real app screens at /nearby/filter
// and /nearby/search, exact-matched ahead of any static file (netlify.toml, server.js) -- a
// subfilter or group key that collided with either would silently never get its own page.
const RESERVED_SLUGS = new Set(["filter", "search"]);

// The exact strings in app.html this generator swaps per page. Matched literally (not by a
// template placeholder app.html doesn't otherwise need) so a future edit to app.html that
// removes one of these breaks the build loudly here, rather than silently generating a page
// that still carries the generic /app meta tags.
const APP_TITLE = "<title>Nearby in Epping Forest | Epping Forest Finds</title>";
const APP_DESCRIPTION_META =
  '<meta name="description" content="A free offline map of Epping Forest. Find veteran trees, pubs, cafés, car parks, toilets, paths and stations near you, see where the forest\'s grazing cattle are, and keep working with no phone signal.">';
const APP_CANONICAL = '<link rel="canonical" href="https://www.eppingforestfinds.uk/nearby">';
const APP_OG_TITLE = '<meta property="og:title" content="Epping Forest Finds — offline map of Epping Forest">';
const APP_OG_DESCRIPTION =
  '<meta property="og:description" content="A free offline map of Epping Forest: veteran trees, pubs and cafés, paths, car parks and the forest\'s grazing cattle — working with no phone signal.">';
const APP_OG_URL = '<meta property="og:url" content="https://www.eppingforestfinds.uk/nearby">';
const APP_EMPTY_STATE =
  '<p class="empty">All veteran trees are shown. Use your location to mark yourself on the map and select the nearest tree, cow, or place.</p>';
const APP_INSPECTOR_TITLE_EMOJI_HIDDEN =
  '<span id="inspectorTitleEmoji" class="inspector-title-emoji" aria-hidden="true" hidden></span>';
const APP_INSPECTOR_TITLE = '<h2 id="inspectorTitle">Epping Forest Finds</h2>';
const APP_INSPECTOR_TYPE = '<p id="inspectorType" class="type"></p>';

function slugFor(key) {
  return key.replace(/_/g, "-");
}

// Templates the same "Nearby <heading>" + type-line pair selectOverview()/overviewHeadingText()
// (js/inspector.js, js/app.js) render live into #inspectorTitleEmoji/#inspectorTitle/#inspectorType
// -- app.html's own default there is the generic "Epping Forest Finds" placeholder with no icon
// and no type line, which a no-JS visitor (or a crawler) saw until JS replaced it a moment later.
// `heading` is the page-specific half of the title ("Nature", "Pubs & bars") -- null for the
// plain, unfiltered screen, which this generator never builds a page for, so always passed here.
// `typeLine` mirrors overviewHeadingText()'s own default-location phrasing (DEFAULT_LOCATION is
// always the origin at build time), already folding in the "measuring from High Beach, not you"
// fact that used to be its own separate sentence further down the page.
function inspectorHeadingHtml(html, rules, heading, typeLine) {
  html = replaceOnce(
    html,
    APP_INSPECTOR_TITLE_EMOJI_HIDDEN,
    APP_INSPECTOR_TITLE_EMOJI_HIDDEN.replace(" hidden></span>", `>${rules.appIconHtml("nearby", "app-icon title-icon")}</span>`),
    "inspector title icon default-hidden state"
  );
  // An empty heading is the plain bare-/nearby case, whose live title is just "Nearby" (selectOverview, js/inspector.js).
  html = replaceOnce(html, APP_INSPECTOR_TITLE, `<h2 id="inspectorTitle">${heading ? `Nearby ${escapeHtml(heading)}` : "Nearby"}</h2>`, "inspector title placeholder");
  html = replaceOnce(html, APP_INSPECTOR_TYPE, `<p id="inspectorType" class="type">${escapeHtml(typeLine)}</p>`, "inspector type placeholder");
  return html;
}

// Every named water feature (ponds, streams, lakes), alphabetical -- the same classification
// extractWaterFeatures (js/normalize.js, via loadAppRules) already gives the live app and the
// weekly report's own count, so this list is never a second, separately-computed guess. Named
// water features are few (~100) and individually distinct the way a business is, unlike trees
// below, so they get a real itemized list rather than a breakdown.
function loadWaterFeatures(rules, siteRoot) {
  const envPath = path.join(siteRoot, "data", "local-environment.geojson");
  if (!fs.existsSync(envPath)) return [];
  const data = JSON.parse(fs.readFileSync(envPath, "utf8"));
  // extractWaterFeatures runs inside loadAppRules()'s vm sandbox, so it hands back an array
  // built from that context's own Array constructor -- a different realm's Array than this
  // file's. The spread here copies it into a plain array of this realm before anything chains
  // off it, so the result behaves like an ordinary array everywhere downstream (a cross-realm
  // one looks and prints identically but fails a strict structural comparison, e.g. in tests).
  return [...rules.extractWaterFeatures(data.features || [])]
    .map((water) => ({ name: water.name, key: rules.waterHashKey(water), latitude: water.latitude, longitude: water.longitude }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Every veteran tree with a real position, in the same shape js/loader.js normalizes
// state.trees into (tree.location.wgs84.{latitude,longitude} flattened onto the record, the
// (0,0)-placeholder rows dropped) -- read directly from the on-disk chunked dataset rather than
// through that normalization step, which lives in a file that can't load into loadAppRules()'s
// vm sandbox (it references `document` at module-evaluation time).
function loadTrees(siteRoot) {
  const indexPath = path.join(siteRoot, "data", "trees", "index.json");
  if (!fs.existsSync(indexPath)) return [];
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const trees = [];
  for (const chunk of index.chunks || []) {
    const chunkPath = path.join(siteRoot, chunk.url);
    if (!fs.existsSync(chunkPath)) continue;
    const chunkData = JSON.parse(fs.readFileSync(chunkPath, "utf8"));
    for (const tree of chunkData.trees || []) {
      if (!tree.location || !tree.location.wgs84) continue;
      const latitude = Number(tree.location.wgs84.latitude);
      const longitude = Number(tree.location.wgs84.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      if (latitude === 0 && longitude === 0) continue;
      trees.push({ ...tree, latitude, longitude });
    }
  }
  return trees;
}

// treeHashKey/treeDisplayName/treeTagLabel/normalizeTreeNumber (js/app.js), reproduced rather
// than imported for the same reason DEFAULT_LOCATION above is. Formulas must stay in sync by
// hand.
function normalizeTreeNumber(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
const TREE_RECORD_KEY_PREFIX = "r";
function treeHashKey(tree) {
  if (!tree) return "";
  const recordNumber = tree.recordNumber;
  if (recordNumber !== null && recordNumber !== undefined && recordNumber !== "") {
    return TREE_RECORD_KEY_PREFIX + normalizeTreeNumber(recordNumber);
  }
  if (Number.isFinite(tree.latitude) && Number.isFinite(tree.longitude)) {
    const axis = (value) => (value < 0 ? "n" : "p") + Math.round(Math.abs(value) * 1e6);
    return `ll${axis(tree.latitude)}${axis(tree.longitude)}`;
  }
  return normalizeTreeNumber(tree.id ?? tree.tagNumber ?? "");
}
function treeTagLabel(tree) {
  const tag = tree && (tree.tagNumber ?? tree.nationalDatabaseTagNumber);
  if (tag === null || tag === undefined) return null;
  const text = String(tag).trim();
  if (!text || Number(text) === 0) return null;
  return text;
}
function treeDisplayName(tree) {
  if (!tree) return "Unknown tree";
  return tree.commonName || treeTagLabel(tree) || "Veteran tree";
}

// formatDistance (js/app.js) and the walk-time half of walkInfoHtml (js/inspector.js),
// reproduced rather than imported for the same reason DEFAULT_LOCATION above is: those files
// can't be loaded into loadAppRules()'s vm sandbox. Formulas must stay in sync by hand.
function formatDistanceLabel(metres) {
  if (!Number.isFinite(metres)) return "";
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  const kmStr = km.toFixed(km < 10 ? 1 : 0).replace(/\.0$/, "");
  return `${kmStr} km`;
}

// bearingDegrees (js/app.js), from the no-fix origin the live list measures from. The live arrow
// spins from this same bearing (updateOverviewDirectionArrows with no compass heading), so the
// static arrow starts pointing exactly where the live one will.
function bearingFromDefaultLocation(lat, lon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const phi1 = toRad(DEFAULT_LOCATION.latitude);
  const phi2 = toRad(lat);
  const lambda1 = toRad(DEFAULT_LOCATION.longitude);
  const lambda2 = toRad(lon);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return Math.round((((Math.atan2(y, x) * 180) / Math.PI + 360) % 360) * 10) / 10;
}

function walkTimeLabel(metres) {
  const minutes = metres / (5000 / 60);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

// Every matching item, filtered to LANDING_PAGE_WALKING_RADIUS_METRES of DEFAULT_LOCATION and
// sorted nearest-first -- the same set and order the live Nearby list shows a reader who hasn't
// shared their own location (overviewItemsForActiveFilter, js/app.js). A category with nothing
// that close (a rare subfilter, or a tight radius) falls back to the nearest 3 overall instead of
// an empty list, matching that same live function's own per-filter fallback.
function nearestWithinWalkingRadius(items, getLatLon) {
  const withDistance = items
    .map((item) => {
      const { latitude, longitude } = getLatLon(item);
      return { item, metres: haversineMetres(DEFAULT_LOCATION_LAT_LON, { lat: latitude, lon: longitude }) };
    })
    .filter(({ metres }) => Number.isFinite(metres))
    .sort((a, b) => a.metres - b.metres);
  const withinRadius = withDistance.filter(({ metres }) => metres <= LANDING_PAGE_WALKING_RADIUS_METRES);
  return withinRadius.length ? withinRadius : withDistance.slice(0, 3);
}

// The same card the live Nearby list renders for every place (.nearest-item/.nearest-icon/
// .nearest-content/.nearest-header/.nearest-name/.nearest-footer/.nearest-meta, css/map-ui.css
// -- .nearest-item itself already reused for a plain <a> by relatedCategoryLinksHtml in
// js/inspector.js), not a bare <ul> styled only by the browser's own defaults. Without this, a
// reader -- or a crawler -- saw a plain blue-link list that then visibly reflowed into cards the
// instant JS replaced it with the live Nearby list; now the static page already looks like the
// screen it's showing. metres is optional -- omitted entirely (no footer) rather than shown as
// 0/blank when a caller has no distance to give.
// Footer matches renderNearestItemsHtml (js/app.js) part for part -- walk chip with its walking
// icon, then the type and tree tag, then the direction arrow JS rotates once it knows the bearing
// -- so the live list replaces these cards without any of them changing shape.
function nearestItemCardHtml(href, iconHtml, name, metres, { rules, typeLabel = "", tag = null, latitude = null, longitude = null } = {}) {
  const walkingIcon = rules ? rules.appIconHtml("walking", "app-icon walk-icon") : "";
  const parts = [
    Number.isFinite(metres) ? `<span class="walk-chip">${formatDistanceLabel(metres)} · ${walkTimeLabel(metres)}${walkingIcon ? ` ${walkingIcon}` : ""}</span>` : "",
    escapeHtml(typeLabel),
    tag ? `#${escapeHtml(tag)}` : "",
  ].filter(Boolean);
  const hasPosition = Number.isFinite(latitude) && Number.isFinite(longitude);
  const bearing = hasPosition ? bearingFromDefaultLocation(latitude, longitude) : null;
  const arrow = hasPosition
    ? `<span class="nearest-arrow" data-item-lat="${latitude}" data-item-lon="${longitude}" data-current-angle="${bearing}" style="transform: rotate(${bearing}deg)" aria-hidden="true">↑</span>`
    : "";
  const footer = parts.length || arrow
    ? `<div class="nearest-footer"><span class="nearest-meta">${parts.join(" · ")}</span>${arrow}</div>`
    : "";
  return `<a class="nearest-item" href="${escapeHtml(href)}"><span class="nearest-icon">${iconHtml || ""}</span><div class="nearest-content"><div class="nearest-header"><span class="nearest-name">${escapeHtml(name)}</span></div>${footer}</div></a>`;
}

function nearestListHtml(cards) {
  return cards.length ? `<ul class="nearest-list">${cards.map((card) => `<li>${card}</li>`).join("")}</ul>` : "";
}

// Live's own Nearby list, once a reader lands on a /nearby/trees/, /nearby/ponds-streams/ or
// /nearby/nature/ page, isn't a business list or a species breakdown -- it's
// overviewItemsForActiveFilter() (js/app.js) computing each active filter's own nearest matches
// *independently* (nearestWithinWalkingRadius per type below mirrors that function's own
// per-filter "within radius, or the nearest 3 if none are" fallback), concatenating them, sorting
// the combined set by real distance, and capping the display to state.nearestItemsCount (10).
// Trees vastly outnumber the ~100 named water features within any given radius, so on
// /nearby/nature/ that merged, capped list reads as "mostly trees" live -- showing a water-only
// list (or a tree species breakdown) here instead would disagree with what JS actually shows a
// moment later rather than match it, which is exactly the mismatch this function closes.
const NEAREST_ITEMS_COUNT = 10; // state.nearestItemsCount, js/app.js

function natureEntriesForFilterKey(filterKey, enrichment) {
  if (filterKey === "trees") {
    return nearestWithinWalkingRadius(enrichment.trees, (t) => t).map(({ item, metres }) => ({ type: "tree", item, metres }));
  }
  if (filterKey === "ponds_streams") {
    return nearestWithinWalkingRadius(enrichment.waterFeatures, (w) => w).map(({ item, metres }) => ({ type: "water", item, metres }));
  }
  return [];
}

function natureNearestListHtml(filterKeys, enrichment, rules) {
  const entries = filterKeys.flatMap((key) => natureEntriesForFilterKey(key, enrichment));
  if (!entries.length) return "";
  entries.sort((a, b) => a.metres - b.metres);
  const cards = entries.slice(0, NEAREST_ITEMS_COUNT).map(({ type, item, metres }) => {
    if (type === "tree") {
      const icon = rules.treeSpeciesIconHtml(item.commonName, item.latinName) || rules.filterKindEmoji("trees");
      return nearestItemCardHtml(`/nearby/trees/#tree=${encodeURIComponent(treeHashKey(item))}`, icon, treeDisplayName(item), metres, {
        rules, typeLabel: "Tree", tag: treeTagLabel(item), latitude: item.latitude, longitude: item.longitude,
      });
    }
    const icon = rules.filterKindEmoji("ponds_streams");
    return nearestItemCardHtml(`/nearby/ponds-streams/#water=${encodeURIComponent(item.key)}`, icon, item.name, metres, {
      rules, typeLabel: subfilterByKey(rules, "ponds_streams")?.label || "Water", latitude: item.latitude, longitude: item.longitude,
    });
  });
  return nearestListHtml(cards);
}

// The exact category navigation categoryLandingLinksHtml() (js/app.js) renders live at the top
// of the Nearby list on a real /nearby/<slug>/ landing -- the current category, a chip up to the
// category's own group, a way back to the full, unfiltered list, plus (for a group page) a
// down-link to each member subfilter ("Browse by type") and the same "see also veteran
// trees/grazing cattle" up-links every /find/<slug>/ business page already carries
// (scripts/generate-business-pages.js). It stays labelled and grouped above the actual results
// so a no-JS visitor sees the same hierarchy as the live app. Same classes and icons either side.
function subfilterByKey(rules, key) {
  for (const group of rules.FILTER_GROUPS) {
    const found = group.subfilters.find((s) => s.key === key);
    if (found) return found;
  }
  return null;
}

// The same class and markup categoryLandingLinksHtml (js/app.js) gives every chip live, so the
// forest-green "navigate into the map" styling (css/inspector.css, .detail-map-link.nearby-link)
// shows on the static page too, not only after JS boots.
function chipHtml(rules, href, icon, label, { current = false } = {}) {
  return `<a class="detail-map-link nearby-link${current ? " nearby-link--current" : ""}" href="${href}"${current ? ' aria-current="page"' : ""}>${rules.appIconHtml(icon)}${escapeHtml(label)}</a>`;
}

function breadcrumbChipsHtml(rules, group, currentKey) {
  const currentSubfilter = currentKey ? subfilterByKey(rules, currentKey) : null;
  const currentGroup = currentSubfilter
    ? null
    : rules.FILTER_GROUPS.find((candidate) => candidate.key === currentKey) || null;
  const current = currentSubfilter || currentGroup;
  const currentChip = current
    ? chipHtml(rules, `/nearby/${slugFor(current.key)}/`, current.icon, current.label, { current: true })
    : "";
  const groupChip = group ? chipHtml(rules, `/nearby/${slugFor(group.key)}/`, group.icon, group.label) : "";
  return currentChip + groupChip + chipHtml(rules, "/nearby?filters=false", "nearby", "All nearby");
}

// A group page's own members ("Browse by type") -- cows is excluded the same way collectPages'
// own page.members already is (live-tracked, no fixed count, no page built through the ordinary
// inventory-driven path -- COW_KEY, scripts/report/map-inventory.js), so this never shows a 4th
// pill the group's own generated page set doesn't actually have.
function typeChipsHtml(members, rules) {
  return members
    .filter((m) => m.key !== "cows")
    .map((m) => chipHtml(rules, `/nearby/${m.slug}/`, subfilterByKey(rules, m.key)?.icon, m.label))
    .join("");
}

// omitTrees/omitCows avoid a duplicate of a pill the page already shows elsewhere (the nature
// group page's own "Trees" type-chip above, alongside its current category chip).
function seeAlsoChipsHtml(rules, { omitTrees = false, omitCows = false } = {}) {
  const trees = subfilterByKey(rules, "trees");
  const cows = subfilterByKey(rules, "cows");
  const treesChip = omitTrees || !trees ? "" : chipHtml(rules, "/nearby/trees/", trees.icon, trees.label);
  const cowsChip = omitCows || !cows ? "" : chipHtml(rules, "/nearby/cows/", cows.icon, cows.label);
  return treesChip + cowsChip;
}

// Assembles every navigation chip a page gets in the live version's own order, wrapped in the
// same labelled navigation region as categoryLandingLinksHtml() rather than looking like the
// first few result cards.
function topChipsHtml(rules, { currentKey = null, group = null, members = null, omitTrees = false, omitCows = false } = {}) {
  const breadcrumb = breadcrumbChipsHtml(rules, group, currentKey);
  const typeChips = members ? typeChipsHtml(members, rules) : "";
  const seeAlso = seeAlsoChipsHtml(rules, { omitTrees, omitCows });
  return `<nav class="nearby-category-nav" aria-label="Browse nearby categories"><p class="nearby-category-nav-title">Browse nearby categories</p><div class="detail-top-row related-chips">${breadcrumb}${typeChips}${seeAlso}</div></nav>`;
}

function categoryResultsHtml(label, content) {
  return `<section class="nearby-category-results" aria-labelledby="nearbyResultsHeading"><h3 id="nearbyResultsHeading">${escapeHtml(label)} nearby</h3>${content}</section>`;
}

// Same lookup live code's FILTER_SUBFILTERS_BY_KEY does (js/categories.js), rebuilt here since
// loadAppRules() exposes FILTER_GROUPS, not that derived map -- the group containing a given
// subfilter key, for the two pages (cows, events) that don't go through collectPages/renderPage
// and so have no page.groupSlug of their own to read.
function groupContainingSubfilter(rules, subfilterKey) {
  return rules.FILTER_GROUPS.find((g) => g.subfilters.some((s) => s.key === subfilterKey)) || null;
}

// A compact, generic phrase for each top-level group's own page (e.g. /nearby/food/) -- group
// labels alone ("Food", "Transport") don't read as a sentence fragment the way each subfilter's
// hand-picked title does ("pubs and bars"), so these are the group-level equivalent. "events" is
// excluded from inventory.groups already (time-bound, not a map fact -- see map-inventory.js)
// and never reaches this map; a group with no entry here gets no page of its own (see
// collectPages) rather than falling back to its bare label.
const GROUP_TITLES = {
  nature: "trees and water features",
  food: "places to eat, drink and shop",
  transport: "bus stops, stations and car parks",
  history: "historic sites, plaques and memorials",
  locations: "churches, schools, clinics and campsites",
  stories: "local legends, literature, film and art",
};

/** subfilter key -> descriptive phrase ("pubs and bars"), from js/categories.js's own data. */
function buildTitleIndex(rules) {
  const titles = new Map();
  for (const group of rules.FILTER_GROUPS) {
    for (const subfilter of group.subfilters) titles.set(subfilter.key, subfilter.title);
  }
  return titles;
}

// app.html's CSS/JS/icon references are relative ("css/base.css"), which resolves one level
// too deep from a nested path like /nearby/<slug>/ (or /nearby/filter) unless something fixes
// what they resolve against. app.html now carries its own <base href="/"> for exactly this
// reason (see its head), which this generator inherits for free by templating off that file --
// nothing to insert here.

/**
 * Builds the flat list of pages to generate: one per subfilter already in
 * the inventory (which itself excludes "cows", live-tracked with no fixed
 * count, and the whole "events" group, time-bound rather than a map fact),
 * each carrying its sibling subfilters for "See also" cross-links -- plus
 * one page per top-level group (e.g. /nearby/food/), pre-filtering Nearby to
 * every subfilter in it at once. A broader entry point than any single
 * subfilter, and real search volume of its own ("things to do in Epping
 * Forest" reads at this level, not "pubs in Epping Forest"). A group with
 * no phrase in GROUP_TITLES (only "events" today, already excluded from
 * inventory.groups) gets no page of its own. Neither a group's nor a
 * subfilter's slug is ever allowed to collide with /nearby/filter or
 * /nearby/search (RESERVED_SLUGS above).
 */
function collectPages(rules, inventory) {
  const titles = buildTitleIndex(rules);
  const pages = [];
  for (const group of inventory.groups) {
    const groupSlug = slugFor(group.key);
    if (RESERVED_SLUGS.has(groupSlug)) {
      throw new Error(`[generate-find-pages] group slug "${groupSlug}" collides with a /nearby/ app screen`);
    }
    const members = group.subfilters.map((s) => ({ key: s.key, slug: slugFor(s.key), label: s.label }));
    for (const subfilter of group.subfilters) {
      if (RESERVED_SLUGS.has(slugFor(subfilter.key))) {
        throw new Error(`[generate-find-pages] subfilter slug "${slugFor(subfilter.key)}" collides with a /nearby/ app screen`);
      }
      pages.push({
        key: subfilter.key,
        slug: slugFor(subfilter.key),
        label: subfilter.label,
        title: titles.get(subfilter.key) || subfilter.label.toLowerCase(),
        count: subfilter.count,
        groupLabel: group.label,
        groupSlug,
        siblings: members.filter((s) => s.key !== subfilter.key),
      });
    }
    const groupTitle = GROUP_TITLES[group.key];
    if (groupTitle && members.length) {
      pages.push({
        key: group.key,
        slug: groupSlug,
        label: group.label,
        title: groupTitle,
        count: group.subfilters.reduce((sum, s) => sum + s.count, 0),
        isGroup: true,
        members,
      });
    }
  }
  return pages;
}

const NATURE_FILTER_KEYS = new Set(["trees", "ponds_streams"]);

function renderPage(page, appHtml, enrichment = {}) {
  const { waterFeatures = [], trees = [], rules = loadAppRules() } = enrichment;
  // Trailing slash: Netlify's static hosting serves nearby/<slug>/index.html directly only at
  // /nearby/<slug>/, 301-redirecting the bare path to it (the same convention /reports/ already
  // uses, STATIC_PAGES in generate-sitemap.js) -- the canonical/OG/JSON-LD url must be the one
  // actually served, not the one that redirects to it.
  const canonical = `${SITE_ORIGIN}/nearby/${page.slug}/`;
  // The count leads a subfilter's title ("129 Pubs & Bars...") -- a plural noun reads naturally
  // with a number in front, and it's the most concrete, searched-for fact the page has to offer.
  // A group label ("Food", "History") isn't grammatically a plural noun, so its count sits after
  // instead ("Food in Epping Forest -- 1,359 places"). Either way the title states the page's own
  // real content rather than a generic phrase repeated across every category page.
  const titleTag = page.isGroup
    ? `${page.label} in Epping Forest — ${page.count.toLocaleString("en-GB")} places | ${SITE_NAME}`
    : `${page.count.toLocaleString("en-GB")} ${page.label} in Epping Forest | ${SITE_NAME}`;
  const description = `Find all ${page.count} ${page.title} in Epping Forest, mapped and ready to walk to.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${page.label} in Epping Forest`,
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
    mainEntity: { "@type": "ItemList", numberOfItems: page.count },
  };

  // A subfilter page cross-links sideways to its siblings and up to its own group page -- a
  // group page's own down-links to its members are part of the top pill row instead (typeChipsHtml,
  // via topChipsHtml below).
  const siblingLinks = page.isGroup
    ? ""
    : page.siblings.map((s) => `<a href="/nearby/${escapeHtml(s.slug)}/">${escapeHtml(s.label)}</a>`).join(", ");

  // What a crawler, or a visitor, sees before js/app.js boots and replaces #inspectorBody with
  // the live Nearby list (transitionInspectorBody, js/inspector.js) -- real, specific, crawlable
  // text and links, in the exact spot the app's own "nothing selected yet" message lives today.
  // Every individual business/location in this category within a 30-minute walk of High Beach,
  // nearest first -- the same set and order the live Nearby list shows (nearestWithinWalkingRadius
  // above), not every matching business in the whole forest in dataset order: a reader (or a
  // crawler) comparing the static page against the live one a moment later, once JS boots, must
  // see the same list, not two disagreeing ones. Subfilters outside the confirmed /find/ scope
  // (transport, history, nature, stories) have no entries in the business index, so this is
  // naturally empty for them and the page falls back to the plain summary sentence it always had.
  const businesses = listBusinessesForFilterKey(page.key);
  const nearestBusinesses = nearestWithinWalkingRadius(businesses, (b) => ({ latitude: b.lat, longitude: b.lon }));
  const businessListHtml = businesses.length
    ? nearestListHtml(nearestBusinesses.slice(0, NEAREST_ITEMS_COUNT).map(({ item: b, metres }) =>
        nearestItemCardHtml(`/find/${b.slug}/`, rules.filterKindEmoji(b.key), b.name, metres, {
          rules, typeLabel: page.label, latitude: b.lat, longitude: b.lon,
        })
      ))
    : "";

  // Trees and named water features are outside the /find/ business scope above, but get the
  // same real nearest-list treatment -- natureNearestListHtml() replicates
  // overviewItemsForActiveFilter()'s own per-filter radius-or-nearest-3 computation (js/app.js),
  // so a /nearby/trees/, /nearby/ponds-streams/ or /nearby/nature/ landing shows exactly the
  // items, order and (on the nature group page) tree-dominated mix the live Nearby list shows a
  // moment later, not a second, disagreeing guess.
  const natureFilterKeys = page.isGroup
    ? page.members.filter((m) => NATURE_FILTER_KEYS.has(m.key)).map((m) => m.key)
    : (NATURE_FILTER_KEYS.has(page.key) ? [page.key] : []);
  const enrichedListHtml = natureFilterKeys.length
    ? natureNearestListHtml(natureFilterKeys, { trees, waterFeatures }, rules)
    : "";

  const group = page.isGroup
    ? null
    : rules.FILTER_GROUPS.find((g) => g.key === page.groupSlug.replace(/-/g, "_"));
  // The nature group's own "Trees" type-chip already covers trees -- the see-also row's own
  // trees pill would otherwise repeat it right next to it in the same row.
  const chips = topChipsHtml(rules, {
    currentKey: page.key,
    group,
    members: page.isGroup ? page.members : null,
    omitTrees: page.key === "trees" || (page.isGroup && page.members.some((m) => m.key === "trees")),
  });

  // A generic "Find all N <title> in Epping Forest, mapped and ready to walk to" lead sentence
  // read as boilerplate filler once a real list (business, tree or water) already sat right
  // below it -- dropped there; kept only for the categories with neither (transport, history,
  // locations, stories), which would otherwise show nothing but pills and a sibling-links
  // paragraph. "Enable location..." moves out entirely: customizeConsentBannerText below folds
  // it into #consentBanner's own copy instead of repeating it as a second, separate ask.
  const hasItemizedList = Boolean(businessListHtml || enrichedListHtml);
  const summarySentence = hasItemizedList
    ? ""
    : `<p>Find all ${page.count} ${escapeHtml(page.title)} in Epping Forest, mapped and ready to walk to.</p>`;

  // "N <Title> within 30 min walk of High Beach" mirrors overviewHeadingText()'s own
  // single-filter phrasing exactly (js/app.js) -- the count is how many are actually within the
  // walking radius, not page.count's whole-forest total, so it only exists where a real
  // within-radius computation already ran above (businesses, or a single nature filter). A group
  // page never names a count here, matching that function's own multi-filter branch; a subfilter
  // page outside both scopes (transport, history, stories -- same carve-out as the itemized list
  // above) falls back to the no-count phrasing rather than a number this build has no way to
  // compute correctly.
  const withinRadiusCount = page.isGroup
    ? null
    : businesses.length
      ? nearestBusinesses.length
      : (natureFilterKeys.length === 1 ? natureEntriesForFilterKey(natureFilterKeys[0], { trees, waterFeatures }).length : null);
  const RADIUS_LABEL = "30 min walk"; // formatWalkingRadius(LANDING_PAGE_WALKING_DISTANCE_MINUTES) + " walk", js/nav.js + js/app.js
  const capitalizedTitle = page.title.charAt(0).toUpperCase() + page.title.slice(1);
  const typeLine = page.isGroup
    ? `Nearest selected filters within ${RADIUS_LABEL} of High Beach`
    : (withinRadiusCount != null
        ? `${withinRadiusCount} ${capitalizedTitle} within ${RADIUS_LABEL} of High Beach`
        : `Nearest ${capitalizedTitle} around High Beach`);

  const seoContent = chips + categoryResultsHtml(page.label,
    summarySentence +
    businessListHtml +
    enrichedListHtml +
    (page.isGroup
      ? ""
      : (siblingLinks ? `<p>More in <a href="/nearby/${escapeHtml(page.groupSlug)}/">${escapeHtml(page.groupLabel)}</a>: ${siblingLinks}.</p>` : "")));

  let html = appHtml;
  html = replaceOnce(html, APP_TITLE, `<title>${escapeHtml(titleTag)}</title>`, "title");
  html = replaceOnce(
    html,
    APP_DESCRIPTION_META,
    `<meta name="description" content="${escapeHtml(description)}">`,
    "meta description"
  );
  html = replaceOnce(html, APP_CANONICAL, `<link rel="canonical" href="${canonical}">`, "canonical link");
  html = replaceOnce(
    html,
    APP_OG_TITLE,
    `<meta property="og:title" content="${escapeHtml(page.label)} in Epping Forest">`,
    "og:title"
  );
  html = replaceOnce(
    html,
    APP_OG_DESCRIPTION,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    "og:description"
  );
  html = replaceOnce(html, APP_OG_URL, `<meta property="og:url" content="${canonical}">`, "og:url");
  // app.html's own og:image (a brand icon) is left as-is rather than duplicated here -- two
  // og:image tags would conflict, and most consumers only read the first one anyway.
  html = replaceOnce(
    html,
    "</head>",
    `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`,
    "</head>"
  );
  html = replaceOnce(html, APP_EMPTY_STATE, seoContent, "initial inspector empty-state paragraph");
  html = inspectorHeadingHtml(html, rules, page.label, typeLine);
  html = customizeConsentBannerText(html, `Enable location to get walking directions and see what's near ${escapeHtml(page.title)}`);
  return html;
}

/**
 * /nearby/events/ -- the one category page map-inventory.js's buildInventory() deliberately
 * excludes from `inventory.groups` (time-bound, not a static map fact; see that file's own
 * comment), so it can't flow through collectPages/renderPage like every other category: there is
 * no "count that's a fact about the forest" the way "130 pubs" is. It still belongs under
 * /nearby/ rather than only at /find/events/ (scripts/generate-business-pages.js) though --
 * "events" is a real filter key (ALL_OVERVIEW_FILTER_KEYS, js/categories.js) and
 * filterKeysFromFindPath (js/app.js) already resolves /nearby/events to it like any other
 * subfilter slug, pre-filtering the live map the same way /nearby/pubs does; the only missing
 * piece was this static page ever existing on disk.
 *
 * Content is deliberately brief and distinct from /find/events/'s fuller listing (title/date only
 * here, full description and source link there) rather than a second copy of the same text --
 * this page's job is the live, pre-filtered map; /find/events/ is the crawlable reference.
 */
function renderEventsPage(appHtml, events, rules = loadAppRules()) {
  const canonical = `${SITE_ORIGIN}/nearby/events/`;
  const titleTag = `${events.length} Events in Epping Forest | ${SITE_NAME}`;
  const description = `${events.length} upcoming and recent events in and around Epping Forest, shown live on the map.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Events in Epping Forest",
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
    mainEntity: { "@type": "ItemList", numberOfItems: events.length },
  };

  const eventListHtml = events.length
    ? `<ul>${events
        .map((e) => `<li>${escapeHtml(e.title)}${e.date ? ` (${escapeHtml(e.date)})` : ""}</li>`)
        .join("")}</ul>`
    : "";

  const seoContent =
    topChipsHtml(rules, { currentKey: "events", group: groupContainingSubfilter(rules, "events") }) +
    categoryResultsHtml("Events", `<p>${escapeHtml(description)}</p>` +
      eventListHtml +
      `<p>See the <a href="/find/events/">full events list</a> with descriptions and source links.</p>`);

  let html = appHtml;
  html = replaceOnce(html, APP_TITLE, `<title>${escapeHtml(titleTag)}</title>`, "title");
  html = replaceOnce(html, APP_DESCRIPTION_META, `<meta name="description" content="${escapeHtml(description)}">`, "meta description");
  html = replaceOnce(html, APP_CANONICAL, `<link rel="canonical" href="${canonical}">`, "canonical link");
  html = replaceOnce(html, APP_OG_TITLE, `<meta property="og:title" content="Events in Epping Forest">`, "og:title");
  html = replaceOnce(html, APP_OG_DESCRIPTION, `<meta property="og:description" content="${escapeHtml(description)}">`, "og:description");
  html = replaceOnce(html, APP_OG_URL, `<meta property="og:url" content="${canonical}">`, "og:url");
  html = replaceOnce(html, "</head>", `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`, "</head>");
  html = replaceOnce(html, APP_EMPTY_STATE, seoContent, "initial inspector empty-state paragraph");
  html = inspectorHeadingHtml(html, rules, "Events", "Nearest Events around High Beach");
  html = customizeConsentBannerText(html, "Enable location to get walking directions and see what's near you");
  return html;
}

/**
 * /nearby/cows/ -- the other category excluded from inventory.groups (COW_KEY, map-inventory.js):
 * live-tracked from GPS collars via the Nofence API, not a fixed dataset, so there is no count to
 * quote and no list to build at build time the way events' own dates can be. "cows" is still a
 * real filter key (ALL_OVERVIEW_FILTER_KEYS) that filterKeysFromFindPath already resolves like
 * any other subfilter slug, so -- same reasoning as /nearby/events/ above -- the only missing
 * piece was this page ever existing. Exists mainly so other pages (a selected business's own
 * "X min walk to the cows" link, js/inspector.js) have a real destination rather than a 404; its
 * own content is honest about having nothing to enumerate, not padded to look like it does.
 */
function renderCowsPage(appHtml, rules = loadAppRules()) {
  const canonical = `${SITE_ORIGIN}/nearby/cows/`;
  const titleTag = `Grazing Cattle in Epping Forest | ${SITE_NAME}`;
  const description = "Epping Forest's conservation-grazing cattle, tracked live by GPS collar and shown on the map wherever they currently are.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Grazing Cattle in Epping Forest",
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
  };

  const seoContent =
    topChipsHtml(rules, { currentKey: "cows", group: groupContainingSubfilter(rules, "cows"), omitCows: true }) +
    categoryResultsHtml("Cows", `<p>${escapeHtml(description)} Positions refresh periodically while online; offline, the map shows the last saved positions, which may be out of date.</p>`);

  let html = appHtml;
  html = replaceOnce(html, APP_TITLE, `<title>${escapeHtml(titleTag)}</title>`, "title");
  html = replaceOnce(html, APP_DESCRIPTION_META, `<meta name="description" content="${escapeHtml(description)}">`, "meta description");
  html = replaceOnce(html, APP_CANONICAL, `<link rel="canonical" href="${canonical}">`, "canonical link");
  html = replaceOnce(html, APP_OG_TITLE, `<meta property="og:title" content="Grazing Cattle in Epping Forest">`, "og:title");
  html = replaceOnce(html, APP_OG_DESCRIPTION, `<meta property="og:description" content="${escapeHtml(description)}">`, "og:description");
  html = replaceOnce(html, APP_OG_URL, `<meta property="og:url" content="${canonical}">`, "og:url");
  html = replaceOnce(html, "</head>", `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`, "</head>");
  html = replaceOnce(html, APP_EMPTY_STATE, seoContent, "initial inspector empty-state paragraph");
  html = inspectorHeadingHtml(html, rules, "Cows", "Nearest Cows around High Beach");
  html = customizeConsentBannerText(html, "Enable location to get walking directions and see what's near you");
  return html;
}

/**
 * Bare /nearby -- the plain Nearby screen, DEFAULT_FILTERS (js/app.js: trees, cows, events) for a
 * first-time visitor. Written to its own root file rather than nearby/index.html so Netlify's
 * clean-URL resolution cannot 301 /nearby to /nearby/ and serve this file directly, which would
 * bypass the alpha-gate edge function on /nearby (netlify.toml). Routed to it by /nearby alone.
 *
 * Only the trees part of the default list is static. Cows are live-only (GPS collars via the
 * Nofence API, no build-time source), and the live fallback adds the nearest cows whenever none
 * sit within the radius, so the live list always reflows once JS boots. Events are filtered
 * against the current time (normalizeEventLocations, js/normalize.js), so a build-time list would
 * go stale between deploys; /nearby/events/ covers them. The list is measured from DEFAULT_LOCATION
 * (High Beach), the no-fix origin, so it matches a visitor who has not shared a location. A visitor
 * with a real fix or saved filters sees a live list that differs from this one.
 *
 * The page also carries the live screen's consent banner (un-hidden, same as a landing page's, so
 * a visitor sees the location and cookie ask before JS runs), the Filters button with its live
 * count, and data-server-rendered-nearby on #inspectorBody. That marker is what makes boot keep
 * this list on screen until a real location fix -- js/inspector.js, serverRenderedNearbyListStillValid
 * -- so no-JS and JS both show the same list and nothing repaints on load.
 */
const NEARBY_INDEX_FILE_NAME = "nearby-index.html";
// DEFAULT_FILTERS (js/app.js): the filter set a first-time visitor's Nearby list is built from.
const NEARBY_INDEX_FILTERS = ["trees", "cows", "events"];

function renderNearbyIndexPage(appHtml, enrichment) {
  const { trees = [], rules = loadAppRules() } = enrichment;
  const canonical = `${SITE_ORIGIN}/nearby`;
  const titleTag = `Nearby in Epping Forest | ${SITE_NAME}`;
  const description = "Veteran trees within a 30-minute walk of High Beach in Epping Forest, mapped offline. Enable location to measure from where you are.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Nearby in Epping Forest",
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
  };
  // Same list the live Nearby screen shows for trees, with the same radius-or-nearest-3 fallback
  // and 10-item cap (natureNearestListHtml, shared with the category pages).
  const listHtml = natureNearestListHtml(["trees"], { trees, waterFeatures: [] }, rules);
  // Matches overviewHeadingText()'s multi-filter branch for the default origin (js/app.js).
  const typeLine = "Nearest selected filters within 30 min walk of High Beach";

  let html = appHtml;
  html = replaceOnce(html, APP_TITLE, `<title>${escapeHtml(titleTag)}</title>`, "title");
  html = replaceOnce(html, APP_DESCRIPTION_META, `<meta name="description" content="${escapeHtml(description)}">`, "meta description");
  html = replaceOnce(html, APP_CANONICAL, `<link rel="canonical" href="${canonical}">`, "canonical link");
  html = replaceOnce(html, APP_OG_TITLE, `<meta property="og:title" content="Nearby in Epping Forest">`, "og:title");
  html = replaceOnce(html, APP_OG_DESCRIPTION, `<meta property="og:description" content="${escapeHtml(description)}">`, "og:description");
  html = replaceOnce(html, APP_OG_URL, `<meta property="og:url" content="${canonical}">`, "og:url");
  html = replaceOnce(html, "</head>", `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`, "</head>");
  html = replaceOnce(html, APP_EMPTY_STATE, listHtml, "initial inspector empty-state paragraph");
  html = inspectorHeadingHtml(html, rules, null, typeLine);
  html = replaceOnce(html, '<div id="inspectorBody" class="inspector-body">', '<div id="inspectorBody" class="inspector-body" data-server-rendered-nearby>', "inspector body marker");
  html = replaceOnce(html, '<div id="consentBanner" class="consent-banner" role="group" aria-label="Location and cookies" hidden>', '<div id="consentBanner" class="consent-banner" role="group" aria-label="Location and cookies">', "consent banner shown");
  // Same count the live Filters button shows: groups with at least one subfilter in the default set.
  const defaultGroupCount = rules.FILTER_GROUPS.filter((group) => group.subfilters.some((sub) => NEARBY_INDEX_FILTERS.includes(sub.key))).length;
  html = replaceOnce(html, '<button id="filterToggle" class="filter-toggle inspector-filter-toggle" type="button" aria-label="Filters" aria-pressed="false" hidden>', `<button id="filterToggle" class="filter-toggle inspector-filter-toggle active" type="button" aria-label="Filters: ${defaultGroupCount} top-level filters selected" aria-pressed="true">`, "filter toggle shown");
  html = replaceOnce(html, '<span id="filterCount" class="filter-count" aria-hidden="true" hidden>0</span>', `<span id="filterCount" class="filter-count" aria-hidden="true">${defaultGroupCount}</span>`, "filter count");
  return html;
}

function generate(siteRoot = path.join(__dirname, ".."), inventory = buildInventory(siteRoot)) {
  const rules = loadAppRules();
  const pages = collectPages(rules, inventory);
  const appHtml = fs.readFileSync(path.join(siteRoot, APP_HTML_NAME), "utf8");
  const categoryDir = path.join(siteRoot, CATEGORY_DIR_NAME);
  fs.mkdirSync(categoryDir, { recursive: true });
  // Loaded once up front, not per page: both read a dataset no other part of this generator
  // touches (the tree chunks in particular are the largest files in the whole build, and only
  // change if the source register does -- deterministic from DEFAULT_LOCATION otherwise, so this
  // cost is paid once per build, not per request), and only the trees/ponds_streams/nature pages
  // (renderPage's own natureFilterKeys) ever use either.
  const enrichment = { waterFeatures: loadWaterFeatures(rules, siteRoot), trees: loadTrees(siteRoot), rules };
  for (const page of pages) {
    const pageDir = path.join(categoryDir, page.slug);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, "index.html"), renderPage(page, appHtml, enrichment), "utf8");
  }

  const eventsDir = path.join(categoryDir, "events");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(path.join(eventsDir, "index.html"), renderEventsPage(appHtml, loadEvents(siteRoot), rules), "utf8");

  const cowsDir = path.join(categoryDir, "cows");
  fs.mkdirSync(cowsDir, { recursive: true });
  fs.writeFileSync(path.join(cowsDir, "index.html"), renderCowsPage(appHtml, rules), "utf8");

  fs.writeFileSync(path.join(siteRoot, NEARBY_INDEX_FILE_NAME), renderNearbyIndexPage(appHtml, enrichment), "utf8");

  return pages;
}

/** Slugs of already-generated category pages, for generate-sitemap.js to list -- mirrors
 * generate-reports-index.js's listReportFiles rather than re-deriving the page set. */
function listFindSlugs(siteRoot) {
  const categoryDir = path.join(siteRoot, CATEGORY_DIR_NAME);
  if (!fs.existsSync(categoryDir)) return [];
  return fs
    .readdirSync(categoryDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(categoryDir, entry.name, "index.html")))
    .map((entry) => entry.name)
    .sort();
}

module.exports = {
  collectPages,
  renderPage,
  renderEventsPage,
  renderCowsPage,
  renderNearbyIndexPage,
  generate,
  listFindSlugs,
  slugFor,
  buildTitleIndex,
  loadWaterFeatures,
  loadTrees,
  natureNearestListHtml,
  nearestWithinWalkingRadius,
  CATEGORY_DIR_NAME,
};

if (require.main === module) {
  const pages = generate();
  console.log(`[generate-find-pages] wrote ${pages.length} category page(s) under nearby/.`);
}
