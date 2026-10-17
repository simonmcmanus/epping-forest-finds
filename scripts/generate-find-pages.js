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
const { escapeHtml, replaceOnce } = require("./lib/html-template.js");
const { listBusinessesForFilterKey, loadEvents } = require("./generate-business-pages.js");

const SITE_ORIGIN = "https://www.eppingforestfinds.uk";
const SITE_NAME = "Epping Forest Finds";
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
const APP_TITLE = "<title>Epping Forest Finds — offline map of Epping Forest</title>";
const APP_DESCRIPTION_META =
  '<meta name="description" content="A free offline map of Epping Forest. Find veteran trees, pubs, cafés, car parks, toilets, paths and stations near you, see where the forest\'s grazing cattle are, and keep working with no phone signal.">';
const APP_CANONICAL = '<link rel="canonical" href="https://www.eppingforestfinds.uk/nearby">';
const APP_OG_TITLE = '<meta property="og:title" content="Epping Forest Finds — offline map of Epping Forest">';
const APP_OG_DESCRIPTION =
  '<meta property="og:description" content="A free offline map of Epping Forest: veteran trees, pubs and cafés, paths, car parks and the forest\'s grazing cattle — working with no phone signal.">';
const APP_OG_URL = '<meta property="og:url" content="https://www.eppingforestfinds.uk/nearby">';
const APP_EMPTY_STATE =
  '<p class="empty">All veteran trees are shown. Use your location to mark yourself on the map and select the nearest tree, cow, or place.</p>';

function slugFor(key) {
  return key.replace(/_/g, "-");
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
    .map((water) => ({ name: water.name, key: rules.waterHashKey(water) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Trees are the opposite case: ~24,900 individually anonymous records (no name, no page of
// their own -- see spec-marketing.md §6.7's scope carve-out), so an itemized list would be
// thousands of near-identical lines ("Common Beech", "Common Beech", ...), which is worse
// thin/duplicate content than the summary sentence this replaces, not better. A species
// breakdown is the genuinely useful, genuinely distinct fact instead: real counts, computed
// from the same chunked dataset js/loader.js streams into the live map, not a second guess.
// commonName is matched case-insensitively (the source register has a handful of inconsistently
// cased duplicates, e.g. "English oak" alongside "English Oak") and anything whose own name
// looks like a stray data artifact rather than a species (contains "=", seen on a few
// single-occurrence rows -- e.g. "beech = 13,*") is dropped rather than hand-excluded by name.
function loadTreeSpeciesBreakdown(siteRoot, minCount = 5) {
  const indexPath = path.join(siteRoot, "data", "trees", "index.json");
  if (!fs.existsSync(indexPath)) return { notable: [], otherCount: 0 };
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const groups = new Map(); // lowercased name -> { total, variants: Map<rawName, count> }
  for (const chunk of index.chunks || []) {
    const chunkPath = path.join(siteRoot, chunk.url);
    if (!fs.existsSync(chunkPath)) continue;
    const chunkData = JSON.parse(fs.readFileSync(chunkPath, "utf8"));
    for (const tree of chunkData.trees || []) {
      const raw = tree.commonName && String(tree.commonName).trim();
      if (!raw || raw.includes("=")) continue;
      const key = raw.toLowerCase();
      const group = groups.get(key) || { total: 0, variants: new Map() };
      group.total += 1;
      group.variants.set(raw, (group.variants.get(raw) || 0) + 1);
      groups.set(key, group);
    }
  }
  const entries = [...groups.values()]
    .map((group) => ({
      // The most common casing of this species' name wins the display label, rather than
      // whichever one happened to be seen first.
      name: [...group.variants.entries()].sort((a, b) => b[1] - a[1])[0][0],
      count: group.total,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    notable: entries.filter((e) => e.count >= minCount),
    otherCount: entries.filter((e) => e.count < minCount).reduce((sum, e) => sum + e.count, 0),
  };
}

// The same card the live Nearby list renders for every place (.nearest-item/.nearest-icon/
// .nearest-content/.nearest-header/.nearest-name, css/map-ui.css -- already reused for a plain
// <a> by relatedCategoryLinksHtml in js/inspector.js), not a bare <ul> styled only by the
// browser's own defaults. Without this, a reader -- or a crawler -- saw a plain blue-link list
// that then visibly reflowed into cards the instant JS replaced it with the live Nearby list;
// now the static page already looks like the screen it's showing. No distance/walk-time footer:
// there is no origin to measure one from at build time.
function nearestItemCardHtml(href, iconHtml, name) {
  return `<a class="nearest-item" href="${escapeHtml(href)}"><span class="nearest-icon">${iconHtml || ""}</span><div class="nearest-content"><div class="nearest-header"><span class="nearest-name">${escapeHtml(name)}</span></div></div></a>`;
}

function nearestListHtml(cards) {
  return cards.length ? `<div class="nearest-list">${cards.join("")}</div>` : "";
}

function waterListHtml(waterFeatures, rules) {
  if (!waterFeatures.length) return "";
  const icon = rules.filterKindEmoji("ponds_streams");
  return `<p>Named ponds, lakes and streams:</p>${nearestListHtml(waterFeatures.map((w) =>
    nearestItemCardHtml(`/nearby/ponds-streams/#water=${encodeURIComponent(w.key)}`, icon, w.name)
  ))}`;
}

function treeSpeciesHtml(treeSpecies) {
  if (!treeSpecies || !treeSpecies.notable.length) return "";
  const rows = treeSpecies.notable
    .map((s) => `<li>${escapeHtml(s.name)} — ${s.count.toLocaleString("en-GB")}</li>`)
    .join("");
  const otherRow = treeSpecies.otherCount > 0
    ? `<li>Other species — ${treeSpecies.otherCount.toLocaleString("en-GB")}</li>`
    : "";
  return `<p>By species:</p><ul class="category-listing">${rows}${otherRow}</ul>`;
}

// The same "See also veteran trees and grazing cattle near Epping Forest" up-link every
// /find/<slug>/ business page already carries (scripts/generate-business-pages.js), so a
// category/subcategory page gives a crawler or a visitor the same onward path -- these pages
// previously cross-linked only sideways (siblings) and up (group), never out to trees/cows,
// which sit outside every group but "nature" and so never appeared as a sibling anywhere else.
// Self-link avoided only for /nearby/trees/ itself; every other page (including the "nature"
// group page, whose own crossLinks cover trees but never cows -- cows has no fixed count and is
// excluded from map-inventory.js's inventory.groups) gets both links.
function natureSeeAlsoHtml(omitTreesLink = false) {
  const treesLink = omitTreesLink ? "" : `<a href="/nearby/trees/">veteran trees</a> and `;
  return `<p>See also ${treesLink}<a href="/nearby/cows/">grazing cattle</a> near Epping Forest.</p>`;
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

function renderPage(page, appHtml, enrichment = {}) {
  const { waterFeatures = [], treeSpecies = null, rules = loadAppRules() } = enrichment;
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

  // A group page (e.g. /nearby/food/) cross-links down into its own member subfilters; a
  // subfilter page cross-links sideways to its siblings and up to its own group page.
  const crossLinks = (page.isGroup ? page.members : page.siblings)
    .map((s) => `<a href="/nearby/${escapeHtml(s.slug)}/">${escapeHtml(s.label)}</a>`)
    .join(", ");

  // What a crawler, or a visitor, sees before js/app.js boots and replaces #inspectorBody with
  // the live Nearby list (transitionInspectorBody, js/inspector.js) -- real, specific, crawlable
  // text and links, in the exact spot the app's own "nothing selected yet" message lives today.
  // Every individual business/location in this category, listed and linked to its own
  // /find/<slug>/ page -- real, crawlable without JS, not just a count. Subfilters outside the
  // confirmed /find/ scope (transport, history, nature, stories) have no entries in the business
  // index, so this is naturally empty for them and the page falls back to the plain summary
  // sentence it always had.
  const businesses = listBusinessesForFilterKey(page.key);
  const businessListHtml = nearestListHtml(businesses.map((b) =>
    nearestItemCardHtml(`/find/${b.slug}/`, rules.filterKindEmoji(b.key), b.name)
  ));

  // trees/ponds_streams/nature are outside the /find/ business scope above (listBusinessesForFilterKey
  // returns nothing for them) but aren't left with just the summary sentence either -- a named
  // water feature is as real and distinct as a business, and a tree species breakdown is the
  // genuinely useful fact in place of ~24,900 anonymous, near-identical list rows. See
  // loadWaterFeatures/loadTreeSpeciesBreakdown above for why each gets a different shape.
  const showWater = page.key === "ponds_streams" || page.key === "nature";
  const showTrees = page.key === "trees" || page.key === "nature";
  const enrichedListHtml = (showTrees ? treeSpeciesHtml(treeSpecies) : "") + (showWater ? waterListHtml(waterFeatures, rules) : "");

  const seoContent = `<p>Find all ${page.count} ${escapeHtml(page.title)} in Epping Forest, mapped and ready to walk to. Enable location to see how far each one is and get walking directions.</p>` +
    businessListHtml +
    enrichedListHtml +
    (page.isGroup
      ? (crossLinks ? `<p>Browse by type: ${crossLinks}.</p>` : "")
      : (crossLinks ? `<p>More in <a href="/nearby/${escapeHtml(page.groupSlug)}/">${escapeHtml(page.groupLabel)}</a>: ${crossLinks}.</p>` : "")) +
    natureSeeAlsoHtml(page.key === "trees");

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
function renderEventsPage(appHtml, events) {
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
    `<p>${escapeHtml(description)} Enable location to see how far away each one is and get walking directions.</p>` +
    eventListHtml +
    `<p>See the <a href="/find/events/">full events list</a> with descriptions and source links.</p>` +
    natureSeeAlsoHtml();

  let html = appHtml;
  html = replaceOnce(html, APP_TITLE, `<title>${escapeHtml(titleTag)}</title>`, "title");
  html = replaceOnce(html, APP_DESCRIPTION_META, `<meta name="description" content="${escapeHtml(description)}">`, "meta description");
  html = replaceOnce(html, APP_CANONICAL, `<link rel="canonical" href="${canonical}">`, "canonical link");
  html = replaceOnce(html, APP_OG_TITLE, `<meta property="og:title" content="Events in Epping Forest">`, "og:title");
  html = replaceOnce(html, APP_OG_DESCRIPTION, `<meta property="og:description" content="${escapeHtml(description)}">`, "og:description");
  html = replaceOnce(html, APP_OG_URL, `<meta property="og:url" content="${canonical}">`, "og:url");
  html = replaceOnce(html, "</head>", `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`, "</head>");
  html = replaceOnce(html, APP_EMPTY_STATE, seoContent, "initial inspector empty-state paragraph");
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
function renderCowsPage(appHtml) {
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
    `<p>${escapeHtml(description)} Positions refresh periodically while online; offline, the map shows the last saved positions, which may be out of date.</p>` +
    `<p>See also <a href="/nearby/trees/">veteran trees</a> near Epping Forest.</p>`;

  let html = appHtml;
  html = replaceOnce(html, APP_TITLE, `<title>${escapeHtml(titleTag)}</title>`, "title");
  html = replaceOnce(html, APP_DESCRIPTION_META, `<meta name="description" content="${escapeHtml(description)}">`, "meta description");
  html = replaceOnce(html, APP_CANONICAL, `<link rel="canonical" href="${canonical}">`, "canonical link");
  html = replaceOnce(html, APP_OG_TITLE, `<meta property="og:title" content="Grazing Cattle in Epping Forest">`, "og:title");
  html = replaceOnce(html, APP_OG_DESCRIPTION, `<meta property="og:description" content="${escapeHtml(description)}">`, "og:description");
  html = replaceOnce(html, APP_OG_URL, `<meta property="og:url" content="${canonical}">`, "og:url");
  html = replaceOnce(html, "</head>", `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`, "</head>");
  html = replaceOnce(html, APP_EMPTY_STATE, seoContent, "initial inspector empty-state paragraph");
  return html;
}

function generate(siteRoot = path.join(__dirname, ".."), inventory = buildInventory(siteRoot)) {
  const rules = loadAppRules();
  const pages = collectPages(rules, inventory);
  const appHtml = fs.readFileSync(path.join(siteRoot, APP_HTML_NAME), "utf8");
  const categoryDir = path.join(siteRoot, CATEGORY_DIR_NAME);
  fs.mkdirSync(categoryDir, { recursive: true });
  // Loaded once up front, not per page: both read a dataset no other part of this generator
  // touches (the tree chunks in particular are the largest files in the whole build), and only
  // the trees/ponds_streams/nature pages (renderPage's showTrees/showWater) ever use them.
  const enrichment = { waterFeatures: loadWaterFeatures(rules, siteRoot), treeSpecies: loadTreeSpeciesBreakdown(siteRoot), rules };
  for (const page of pages) {
    const pageDir = path.join(categoryDir, page.slug);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, "index.html"), renderPage(page, appHtml, enrichment), "utf8");
  }

  const eventsDir = path.join(categoryDir, "events");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(path.join(eventsDir, "index.html"), renderEventsPage(appHtml, loadEvents(siteRoot)), "utf8");

  const cowsDir = path.join(categoryDir, "cows");
  fs.mkdirSync(cowsDir, { recursive: true });
  fs.writeFileSync(path.join(cowsDir, "index.html"), renderCowsPage(appHtml), "utf8");

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
  generate,
  listFindSlugs,
  slugFor,
  buildTitleIndex,
  loadWaterFeatures,
  loadTreeSpeciesBreakdown,
  CATEGORY_DIR_NAME,
};

if (require.main === module) {
  const pages = generate();
  console.log(`[generate-find-pages] wrote ${pages.length} category page(s) under nearby/.`);
}
