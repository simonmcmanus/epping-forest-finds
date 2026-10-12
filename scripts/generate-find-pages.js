#!/usr/bin/env node
"use strict";

/**
 * Generates one crawlable category page per POI filter subfilter -- e.g.
 * find/pubs/index.html, served at /find/pubs/ -- by templating off the real
 * app.html rather than writing a separate static page. The result IS the
 * app: same DOM, same <script src> list, same CSS. Only the <head>'s SEO
 * tags and the inspector's initial (pre-boot) content are swapped in, so a
 * crawler or a visitor arriving before JS has booted sees real, specific
 * content, and js/app.js's filterKeyFromFindPath() then reads the category
 * straight out of the URL path once it does boot, pre-filtering Nearby to
 * it -- no separate marketing page, no redirect through /nearby.
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

const SITE_ORIGIN = "https://www.eppingforestfinds.uk";
const SITE_NAME = "Epping Forest Finds";
const FIND_DIR_NAME = "find";
const APP_HTML_NAME = "app.html";

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

/** subfilter key -> descriptive phrase ("pubs and bars"), from js/categories.js's own data. */
function buildTitleIndex(rules) {
  const titles = new Map();
  for (const group of rules.FILTER_GROUPS) {
    for (const subfilter of group.subfilters) titles.set(subfilter.key, subfilter.title);
  }
  return titles;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replaces the one occurrence of `needle` in `html`, throwing if app.html no longer has it. */
function replaceOnce(html, needle, replacement, label) {
  const count = html.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(
      `[generate-find-pages] expected exactly one "${label}" in app.html, found ${count} -- ` +
        "app.html changed in a way this generator's template no longer matches."
    );
  }
  return html.replace(needle, replacement);
}

// app.html's CSS/JS/icon references are relative ("css/base.css"), which resolves correctly
// from /app (one path segment, no trailing slash) but not from /find/<slug>/ (nested one level
// deeper, with a trailing slash) -- the browser would look for /find/<slug>/css/base.css and
// 404. Rewriting every href/src in the markup isn't enough on its own: js/app.js and js/nav.js
// also build relative paths at runtime (FOLKLORE_URL = "data/...", navigator.serviceWorker
// .register("sw.js")), and those broke exactly the same way -- found by the sw.js registration
// itself 404ing on a live page. A single <base href="/"> fixes both at once: it changes what
// *every* relative URL on the page resolves against, HTML attributes and script-constructed
// ones alike, without touching any of app.html's or the JS files' existing relative-path code.
const BASE_HREF_TAG = '<base href="/">';
const HEAD_CHARSET = '<meta charset="utf-8">';

/**
 * Builds the flat list of pages to generate: one per subfilter already in
 * the inventory (which itself excludes "cows", live-tracked with no fixed
 * count, and the whole "events" group, time-bound rather than a map fact),
 * each carrying its sibling subfilters for "See also" cross-links.
 */
function collectPages(rules, inventory) {
  const titles = buildTitleIndex(rules);
  const pages = [];
  for (const group of inventory.groups) {
    const siblings = group.subfilters.map((s) => ({ key: s.key, slug: slugFor(s.key), label: s.label }));
    for (const subfilter of group.subfilters) {
      pages.push({
        key: subfilter.key,
        slug: slugFor(subfilter.key),
        label: subfilter.label,
        title: titles.get(subfilter.key) || subfilter.label.toLowerCase(),
        count: subfilter.count,
        groupLabel: group.label,
        siblings: siblings.filter((s) => s.key !== subfilter.key),
      });
    }
  }
  return pages;
}

function renderPage(page, appHtml) {
  // Trailing slash: Netlify's static hosting serves find/<slug>/index.html directly only at
  // /find/<slug>/, 301-redirecting the bare path to it (the same convention /reports/ already
  // uses, STATIC_PAGES in generate-sitemap.js) -- the canonical/OG/JSON-LD url must be the one
  // actually served, not the one that redirects to it.
  const canonical = `${SITE_ORIGIN}/find/${page.slug}/`;
  const titleTag = `${page.label} in Epping Forest | ${SITE_NAME}`;
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

  const siblingLinks = page.siblings
    .map((s) => `<a href="/find/${escapeHtml(s.slug)}/">${escapeHtml(s.label)}</a>`)
    .join(", ");

  // What a crawler, or a visitor, sees before js/app.js boots and replaces #inspectorBody with
  // the live Nearby list (transitionInspectorBody, js/inspector.js) -- real, specific, crawlable
  // text and links, in the exact spot the app's own "nothing selected yet" message lives today.
  const seoContent = `<p>Find all ${page.count} ${escapeHtml(page.title)} in Epping Forest, mapped and ready to walk to. Enable location to see how far each one is and get walking directions.</p>` +
    (siblingLinks ? `<p>More in ${escapeHtml(page.groupLabel)}: ${siblingLinks}.</p>` : "");

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
  // Right after <meta charset>, before anything else references a relative URL -- <base> only
  // affects resolution for elements that come after it in the document.
  html = replaceOnce(html, HEAD_CHARSET, `${HEAD_CHARSET}\n  ${BASE_HREF_TAG}`, "meta charset");
  return html;
}

function generate(siteRoot = path.join(__dirname, ".."), inventory = buildInventory(siteRoot)) {
  const rules = loadAppRules();
  const pages = collectPages(rules, inventory);
  const appHtml = fs.readFileSync(path.join(siteRoot, APP_HTML_NAME), "utf8");
  const findDir = path.join(siteRoot, FIND_DIR_NAME);
  fs.mkdirSync(findDir, { recursive: true });
  for (const page of pages) {
    const pageDir = path.join(findDir, page.slug);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, "index.html"), renderPage(page, appHtml), "utf8");
  }
  return pages;
}

/** Slugs of already-generated category pages, for generate-sitemap.js to list -- mirrors
 * generate-reports-index.js's listReportFiles rather than re-deriving the page set. */
function listFindSlugs(siteRoot) {
  const findDir = path.join(siteRoot, FIND_DIR_NAME);
  if (!fs.existsSync(findDir)) return [];
  return fs
    .readdirSync(findDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(findDir, entry.name, "index.html")))
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
  FIND_DIR_NAME,
};

if (require.main === module) {
  const pages = generate();
  console.log(`[generate-find-pages] wrote ${pages.length} category page(s) under find/.`);
}
