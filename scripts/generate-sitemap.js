#!/usr/bin/env node
"use strict";

/**
 * Generates sitemap.xml and robots.txt at the site root.
 *
 * The weekly reports are the main way someone who has never heard of this app
 * is going to find it -- they are real, dated, local news pages about Epping
 * Forest. A sitemap is what tells a search engine those pages exist and when
 * each one last changed, without adding a single word of filler to the site
 * itself.
 *
 * Run directly: node scripts/generate-sitemap.js
 * Also exported for tests (see test/sitemap.test.js).
 * Wired into `npm run build` alongside generate-reports-index.js.
 */

const fs = require("node:fs");
const path = require("node:path");

const { listReportFiles } = require("./generate-reports-index.js");
const { listFindPaths } = require("./generate-find-pages.js");

const SITE_ORIGIN = "https://www.eppingforestfinds.uk";
const SITEMAP_FILE_NAME = "sitemap.xml";
const ROBOTS_FILE_NAME = "robots.txt";

/**
 * Pages that always exist, in the order we want them crawled. The map itself
 * matters most; the report index is the hub every weekly report hangs off.
 *
 * `admin.html` is deliberately absent -- it is a password-protected dashboard
 * with nothing in it for a reader, so it is disallowed in robots.txt below
 * rather than listed here.
 */
const STATIC_PAGES = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/reports/", changefreq: "weekly", priority: "0.8" },
  { loc: "/terms.html", changefreq: "yearly", priority: "0.2" },
];

// The map application's five screen paths are gated during the closed alpha and answer
// crawlers with a redirect to the homepage, which is a soft-404 signal with nothing to
// gain -- and the app has no indexable content in any case. The homepage at / is the page
// that should rank. /app itself needs no entry here: it is a bare redirect to /nearby with
// no content of its own, so there is nothing for a crawler to index there either way.
// See spec/spec-alpha-access.md.
//
// The three /nearby... entries carry a trailing "$" (robots.txt's end-of-path anchor) rather
// than the bare path a plain Disallow would otherwise prefix-match: /nearby/<slug>/ category
// pages (scripts/generate-find-pages.js) live under that same /nearby/ prefix and must stay
// crawlable, so "Disallow: /nearby" alone would silently swallow every one of them too.
// /admin.html, /api/ and /.netlify/ have no such children to protect, so they stay bare.
const DISALLOWED_PATHS = ["/admin.html", "/nearby$", "/nearby/search$", "/nearby/filter$", "/settings$", "/feedback$", "/api/", "/.netlify/"];

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds the list of URLs to publish: the fixed pages that exist in the
 * checkout, then every published report newest first.
 *
 * @param {string} siteRoot absolute path to the site root
 * @param {number} [now] timestamp used as the lastmod for the static pages
 */
function collectUrls(siteRoot, now = Date.now()) {
  const reports = listReportFiles(path.join(siteRoot, "reports"));
  const newestReport = reports.length ? reports[0].mtimeMs : now;

  const urls = STATIC_PAGES.filter((page) => {
    if (page.loc === "/") return fs.existsSync(path.join(siteRoot, "index.html"));
    if (page.loc.endsWith("/")) return fs.existsSync(path.join(siteRoot, page.loc.slice(1)));
    return fs.existsSync(path.join(siteRoot, page.loc.slice(1)));
  }).map((page) => ({
    // The home page and the report index both change whenever a new report
    // lands, so they share the newest report's date rather than "today" --
    // a lastmod that moves every build teaches a crawler to ignore it.
    ...page,
    lastmod: isoDate(page.loc === "/terms.html" ? now : newestReport),
  }));

  for (const report of reports) {
    urls.push({
      loc: `/reports/${report.name}`,
      lastmod: isoDate(report.mtimeMs),
      changefreq: "yearly", // a published report never changes again
      priority: "0.6",
    });
  }

  // Category pages (scripts/generate-find-pages.js), run earlier in `npm run build` so their
  // output already exists on disk here. Their count changes with the data, same as the
  // static pages above, so they share "now" as a build-time lastmod rather than a per-page one.
  for (const findPath of listFindPaths(siteRoot)) {
    urls.push({ loc: `/nearby/${findPath}/`, lastmod: isoDate(now), changefreq: "weekly", priority: "0.5" });
  }

  return urls;
}

function buildSitemapXml(urls) {
  const entries = urls
    .map((url) =>
      [
        "  <url>",
        `    <loc>${escapeXml(SITE_ORIGIN + url.loc)}</loc>`,
        `    <lastmod>${url.lastmod}</lastmod>`,
        `    <changefreq>${url.changefreq}</changefreq>`,
        `    <priority>${url.priority}</priority>`,
        "  </url>",
      ].join("\n")
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

function buildRobotsTxt() {
  return `# Epping Forest Finds
User-agent: *
${DISALLOWED_PATHS.map((p) => `Disallow: ${p}`).join("\n")}
Allow: /

Sitemap: ${SITE_ORIGIN}/${SITEMAP_FILE_NAME}
`;
}

function generate(siteRoot, now = Date.now()) {
  const urls = collectUrls(siteRoot, now);
  const sitemap = buildSitemapXml(urls);
  const robots = buildRobotsTxt();
  fs.writeFileSync(path.join(siteRoot, SITEMAP_FILE_NAME), sitemap, "utf8");
  fs.writeFileSync(path.join(siteRoot, ROBOTS_FILE_NAME), robots, "utf8");
  return { urls, sitemap, robots };
}

module.exports = {
  collectUrls,
  buildSitemapXml,
  buildRobotsTxt,
  generate,
  escapeXml,
  SITE_ORIGIN,
  SITEMAP_FILE_NAME,
  ROBOTS_FILE_NAME,
  STATIC_PAGES,
};

if (require.main === module) {
  const siteRoot = path.join(__dirname, "..");
  const { urls } = generate(siteRoot);
  console.log(`[generate-sitemap] wrote sitemap.xml (${urls.length} URL(s)) and robots.txt.`);
}
