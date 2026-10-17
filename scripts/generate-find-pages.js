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
const { listBusinessesForFilterKey } = require("./generate-business-pages.js");

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

function renderPage(page, appHtml) {
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
  const businessListHtml = businesses.length
    ? `<ul class="category-listing">${businesses
        .map((b) => `<li><a href="/find/${escapeHtml(b.slug)}/">${escapeHtml(b.name)}</a></li>`)
        .join("")}</ul>`
    : "";

  const seoContent = `<p>Find all ${page.count} ${escapeHtml(page.title)} in Epping Forest, mapped and ready to walk to. Enable location to see how far each one is and get walking directions.</p>` +
    businessListHtml +
    (page.isGroup
      ? (crossLinks ? `<p>Browse by type: ${crossLinks}.</p>` : "")
      : (crossLinks ? `<p>More in <a href="/nearby/${escapeHtml(page.groupSlug)}/">${escapeHtml(page.groupLabel)}</a>: ${crossLinks}.</p>` : ""));

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

function generate(siteRoot = path.join(__dirname, ".."), inventory = buildInventory(siteRoot)) {
  const rules = loadAppRules();
  const pages = collectPages(rules, inventory);
  const appHtml = fs.readFileSync(path.join(siteRoot, APP_HTML_NAME), "utf8");
  const categoryDir = path.join(siteRoot, CATEGORY_DIR_NAME);
  fs.mkdirSync(categoryDir, { recursive: true });
  for (const page of pages) {
    const pageDir = path.join(categoryDir, page.slug);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, "index.html"), renderPage(page, appHtml), "utf8");
  }
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
  generate,
  listFindSlugs,
  slugFor,
  buildTitleIndex,
  CATEGORY_DIR_NAME,
};

if (require.main === module) {
  const pages = generate();
  console.log(`[generate-find-pages] wrote ${pages.length} category page(s) under nearby/.`);
}
