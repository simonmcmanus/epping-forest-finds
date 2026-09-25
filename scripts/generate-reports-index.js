#!/usr/bin/env node
"use strict";

/**
 * Generates reports/index.html: a static directory listing of every report
 * file in reports/. Netlify serves index.html for a directory path
 * automatically, so this makes /reports/ list its contents with zero
 * runtime cost (no function, no client-side JS) -- the listing is baked in
 * at build time by `npm run build`.
 *
 * Run directly: node scripts/generate-reports-index.js
 * Also exported for tests (see test/reports-index.test.js).
 */

const fs = require("node:fs");
const path = require("node:path");

const REPORTS_DIR_NAME = "reports";
const INDEX_FILE_NAME = "index.html";
const SITE_ORIGIN = "https://www.eppingforestfinds.uk";

/**
 * Only these extensions are published. Reports are written as finished web
 * pages; a Markdown working file that happens to be sitting in the folder is
 * raw notes, not something to put in front of a reader (or a search engine),
 * so the listing never links to one.
 */
const PUBLISHABLE_EXTENSIONS = new Set([".html", ".htm"]);

const INDEX_DESCRIPTION =
  "A weekly round-up of what has changed in and around Epping Forest: shops, pubs " +
  "and cafés opening and closing, road closures, events, and where the forest's " +
  "grazing cattle have moved to — across Loughton, Chingford, Buckhurst Hill, " +
  "Chigwell, Theydon Bois, Epping, Woodford Green and Waltham Abbey.";

function isPublishable(name) {
  return PUBLISHABLE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/**
 * Reads a reports directory and returns metadata for every listable file.
 * Skips subdirectories, dotfiles, anything that isn't a published web page,
 * and the generated index itself so the listing never links to itself or to
 * stray folders.
 *
 * @param {string} reportsDir absolute path to the reports directory
 * @returns {{name: string, size: number, mtimeMs: number}[]} newest first
 */
function listReportFiles(reportsDir) {
  if (!fs.existsSync(reportsDir)) return [];

  const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name !== INDEX_FILE_NAME)
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => isPublishable(entry.name))
    .map((entry) => {
      const stat = fs.statSync(path.join(reportsDir, entry.name));
      return { name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
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
 * A readable title for a report file. A weekly ledger is named by the week it
 * covers, so the listing can say "Epping Forest Ledger — 14 September 2026"
 * instead of showing a reader (or a search result) a raw file name.
 */
function titleForFile(name) {
  const match = /^epping-forest-ledger-(\d{4})-(\d{2})-(\d{2})\.html?$/i.exec(name);
  if (!match) return name;
  const [, year, month, day] = match;
  const when = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(when.getTime())) return name;
  return `Epping Forest Ledger — ${when.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

/** The week a ledger covers, from its file name; null for anything else. */
function ledgerWeek(name) {
  const match = /^epping-forest-ledger-(\d{4})-(\d{2})-(\d{2})\.html?$/i.exec(name);
  if (!match) return null;
  const when = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(when) ? null : when;
}

/**
 * Newest edition first. A fresh checkout gives every file the same mtime, so
 * a ledger is ordered by the week in its name; anything else falls back to
 * its mtime.
 */
function sortForListing(files) {
  const key = (file) => ledgerWeek(file.name) ?? file.mtimeMs;
  return [...files].sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
}

function renderRow(file, index) {
  const week = ledgerWeek(file.name);
  const title = week === null
    ? escapeHtml(titleForFile(file.name))
    : escapeHtml(new Date(week).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    }));
  const label = week === null ? "Report" : "Epping Forest Ledger";
  const latest = index === 0 ? `<span class="report-latest">Latest</span>` : "";
  return `
      <li class="report-row">
        <a class="report-link" href="./${encodeURIComponent(file.name)}" aria-label="${escapeHtml(titleForFile(file.name))}">
          <span class="report-text">
            <span class="report-label">${label}${latest}</span>
            <span class="report-name">${title}</span>
          </span>
          <span class="report-arrow" aria-hidden="true">→</span>
        </a>
      </li>`;
}

function buildIndexHtml(files) {
  const body = files.length
    ? `<ul class="report-list">${sortForListing(files).map(renderRow).join("\n")}\n    </ul>`
    : `<p class="empty-state">No reports have been published yet.</p>`;

  // Styled to match the homepage (assets/home/home.css): same palette, type,
  // cards and header, inlined so this page loads nothing from the homepage or
  // the app except two small brand images.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Epping Forest Ledger — weekly Epping Forest news</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#24382f">
<meta name="description" content="${escapeHtml(INDEX_DESCRIPTION)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${SITE_ORIGIN}/reports/">
<link rel="icon" href="${SITE_ORIGIN}/data/icons/favicon.png" type="image/png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Epping Forest Finds">
<meta property="og:title" content="Epping Forest Ledger — weekly Epping Forest news">
<meta property="og:description" content="${escapeHtml(INDEX_DESCRIPTION)}">
<meta property="og:url" content="${SITE_ORIGIN}/reports/">
<meta property="og:image" content="${SITE_ORIGIN}/data/icons/icon-512.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #181c11; --muted: #52514e; --line: #ded9c6; --line-strong: #c9c3ac;
    --paper: #f4f4ec; --surface: #fff; --surface-alt: #eaeedd;
    --tree: #2e6b44; --tree-deep: #1d4a2f;
    --shadow: 0 1px 2px rgba(24, 28, 17, .06), 0 16px 36px -20px rgba(24, 28, 17, .35);
    font-family: "Public Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); line-height: 1.6; -webkit-text-size-adjust: 100%; }
  a { color: var(--tree-deep); }
  a:focus-visible { outline: 3px solid rgba(46, 107, 68, .45); outline-offset: 3px; }
  main, .site-head, .site-foot { max-width: 1040px; margin: 0 auto; padding-right: 24px; padding-left: 24px; }
  .site-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 22px; padding-bottom: 22px; }
  .brand { display: inline-flex; align-items: center; gap: 12px; color: var(--ink); font-weight: 700; text-decoration: none; }
  .brand img { width: 44px; height: 44px; }
  .brand span, .head-link { white-space: nowrap; }
  .brand span { font-size: 1.08rem; }
  .head-link { font-size: .92rem; font-weight: 700; text-decoration: none; }
  .head-link:hover { text-decoration: underline; }
  h1, h2 { font-family: "Fraunces", Georgia, serif; font-weight: 600; letter-spacing: -.028em; line-height: 1.1; text-wrap: balance; }
  .hero { overflow: hidden; padding: clamp(30px, 5vw, 48px) clamp(22px, 5vw, 42px); border-radius: 18px; background: var(--tree-deep); color: var(--paper); box-shadow: var(--shadow); }
  .eyebrow { display: flex; gap: 12px; align-items: center; margin: 0 0 14px; color: #c9dfc9; font-family: "Fraunces", Georgia, serif; font-size: .98rem; font-style: italic; font-weight: 500; letter-spacing: .05em; }
  .eyebrow img { flex: 0 0 34px; width: 34px; height: 34px; padding: 6px; border-radius: 50%; background: var(--paper); }
  h1 { margin: 0 0 14px; font-size: clamp(2.2rem, 7vw, 3.4rem); letter-spacing: -.04em; line-height: 1.02; }
  .subtitle { max-width: 40em; margin: 0; color: #dfe8dc; font-size: 1.02rem; }
  .editions { padding: 44px 0 8px; }
  h2 { margin: 0 0 16px; font-size: clamp(1.55rem, 4vw, 2.15rem); }
  .report-list { margin: 0; padding: 0; overflow: hidden; list-style: none; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow); }
  .report-row + .report-row { border-top: 1px solid var(--line); }
  .report-link { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; color: inherit; text-decoration: none; transition: background-color .2s ease; }
  .report-link:hover, .report-link:focus-visible { background: var(--surface-alt); }
  .report-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .report-label { display: flex; gap: 10px; align-items: center; color: var(--tree); font-family: "Fraunces", Georgia, serif; font-size: .9rem; font-style: italic; }
  .report-latest { padding: 1px 9px; border-radius: 999px; background: var(--tree-deep); color: #fff; font-family: "Public Sans", sans-serif; font-size: .72rem; font-style: normal; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .report-name { font-family: "Fraunces", Georgia, serif; font-size: 1.3rem; font-weight: 600; letter-spacing: -.02em; line-height: 1.25; word-break: break-word; }
  .report-arrow { flex: 0 0 auto; color: var(--tree); font-size: 1.3rem; font-weight: 700; transition: transform .2s ease; }
  .report-link:hover .report-arrow { transform: translateX(4px); }
  .empty-state { padding: 20px 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--muted); }
  .note { display: flex; flex-wrap: wrap; gap: 16px 24px; align-items: center; justify-content: space-between; margin: 28px 0 52px; padding: clamp(22px, 4vw, 32px); border: 1px solid var(--line-strong); border-left: 5px solid var(--tree); border-radius: 14px; background: var(--surface-alt); }
  .note p { max-width: 42em; margin: 0; color: var(--muted); font-size: .94rem; }
  .app-cta { display: inline-block; padding: 13px 22px; border-radius: 9px; background: var(--tree); color: #fff; font-weight: 700; text-decoration: none; transition: background-color .2s ease, transform .2s ease; }
  .app-cta:hover { background: var(--tree-deep); transform: translateY(-1px); }
  .site-foot { border-top: 1px solid var(--line-strong); padding-top: 28px; padding-bottom: 56px; color: var(--muted); font-size: .86rem; }
  .site-foot p { margin: 0 0 8px; }
  @media (max-width: 420px) {
    main, .site-head, .site-foot { padding-right: 18px; padding-left: 18px; }
    .brand img { width: 36px; height: 36px; }.brand span { font-size: 1rem; }
    .report-link { padding: 18px; }.report-name { font-size: 1.15rem; }
    .app-cta { width: 100%; padding: 13px 16px; font-size: .92rem; text-align: center; white-space: nowrap; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<header class="site-head">
  <a class="brand" href="/">
    <img src="/assets/home/map-icons/oak.png" alt="" width="44" height="44">
    <span>Epping Forest Finds</span>
  </a>
  <a class="head-link" href="/#signup">Get updates</a>
</header>
<main>
  <section class="hero">
    <p class="eyebrow"><img src="/assets/home/ledger.svg" alt="" width="34" height="34">Field notes · Published weekly</p>
    <h1>Epping Forest Ledger</h1>
    <p class="subtitle">${escapeHtml(INDEX_DESCRIPTION)}</p>
  </section>
  <section class="editions" aria-labelledby="editions-heading">
    <h2 id="editions-heading">Every edition</h2>
    ${body}
  </section>
  <aside class="note">
    <p>Written automatically each week — it can get things wrong, so please check
    anything important. Every report has a link for telling us about a mistake.</p>
    <a class="app-cta" href="${SITE_ORIGIN}/">Open the Epping Forest map →</a>
  </aside>
</main>
<footer class="site-foot">
  <p>Created and curated by AI with oversight from
  <a href="https://simonmcmanus.com">Simon McManus</a>. AI can make mistakes,
  please <a href="https://github.com/simonmcmanus/epping-forest-finds/issues">report them here</a>.</p>
  <p><a href="/terms.html">Privacy &amp; terms</a></p>
</footer>
</body>
</html>
`;
}

function generate(reportsDir) {
  const files = listReportFiles(reportsDir);
  const html = buildIndexHtml(files);
  fs.writeFileSync(path.join(reportsDir, INDEX_FILE_NAME), html, "utf8");
  return { files, html };
}

module.exports = {
  listReportFiles,
  titleForFile,
  ledgerWeek,
  sortForListing,
  isPublishable,
  buildIndexHtml,
  escapeHtml,
  generate,
  REPORTS_DIR_NAME,
  INDEX_FILE_NAME,
};

if (require.main === module) {
  const reportsDir = path.join(__dirname, "..", REPORTS_DIR_NAME);
  if (!fs.existsSync(reportsDir)) {
    console.log(`[generate-reports-index] no ${REPORTS_DIR_NAME}/ directory found -- skipping.`);
    process.exit(0);
  }
  const { files } = generate(reportsDir);
  console.log(`[generate-reports-index] wrote reports/index.html listing ${files.length} file(s).`);
}
