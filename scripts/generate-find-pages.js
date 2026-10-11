#!/usr/bin/env node
"use strict";

/**
 * Generates one static, crawlable category page per POI filter subfilter
 * (Proposal B: "Location Pages for SEO") -- e.g. find/pubs/index.html,
 * served at /find/pubs. A category's count here is exactly what the map
 * would show for it: this reuses the weekly report's own classification
 * (scripts/report/map-inventory.js, which loads js/categories.js's real
 * rules), rather than recomputing it separately and risking the two
 * drifting apart.
 *
 * Each page's "See them all" link goes to /app?show=<key>, which
 * js/app.js's boot sequence (applyShowFilterFromQuery) reads to land
 * already filtered to that one category.
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
const SOCIAL_IMAGE = `${SITE_ORIGIN}/assets/home/epping-longhorns-social.jpg`;
const FIND_DIR_NAME = "find";

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

function renderPage(page) {
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
    .map((s) => `<li><a href="/find/${escapeHtml(s.slug)}/">${escapeHtml(s.label)}</a></li>`)
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(titleTag)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta name="theme-color" content="#24382f">

  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(page.label)} in Epping Forest">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SOCIAL_IMAGE}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f7f8f4; color: #1c2a22; }
    main { max-width: 640px; margin: 0 auto; padding: 32px 20px 56px; }
    h1 { font-size: 1.75rem; margin: 0 0 12px; color: #1c2a22; }
    p { line-height: 1.5; }
    .cta { display: inline-block; margin: 20px 0; padding: 12px 20px; border-radius: 999px; background: #2f6f4e; color: #fff; text-decoration: none; font-weight: 600; }
    .cta:hover { background: #24382f; }
    h2 { font-size: 1.1rem; margin-top: 32px; }
    ul { padding-left: 20px; }
    a { color: #2f6f4e; }
    footer { margin-top: 40px; font-size: 0.85rem; color: #5a6a60; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(page.label)} in Epping Forest</h1>
    <p>${escapeHtml(description)}</p>
    <a class="cta" href="/app?show=${encodeURIComponent(page.key)}">See them all on the map</a>
    ${siblingLinks ? `<h2>More in ${escapeHtml(page.groupLabel)}</h2>\n    <ul>\n        ${siblingLinks}\n    </ul>` : ""}
    <footer>
      <p><a href="/">Epping Forest Finds</a> &mdash; the offline map of Epping Forest.</p>
    </footer>
  </main>
</body>
</html>
`;
}

function generate(siteRoot = path.join(__dirname, ".."), inventory = buildInventory(siteRoot)) {
  const rules = loadAppRules();
  const pages = collectPages(rules, inventory);
  const findDir = path.join(siteRoot, FIND_DIR_NAME);
  fs.mkdirSync(findDir, { recursive: true });
  for (const page of pages) {
    const pageDir = path.join(findDir, page.slug);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, "index.html"), renderPage(page), "utf8");
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

module.exports = { collectPages, renderPage, generate, listFindSlugs, slugFor, buildTitleIndex, FIND_DIR_NAME };

if (require.main === module) {
  const pages = generate();
  console.log(`[generate-find-pages] wrote ${pages.length} category page(s) under find/.`);
}
