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

/**
 * Reads a reports directory and returns metadata for every listable file.
 * Skips subdirectories, dotfiles, and the generated index itself so the
 * listing never links to itself or to stray folders.
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
    .map((entry) => {
      const stat = fs.statSync(path.join(reportsDir, entry.name));
      return { name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const precision = exponent === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[exponent]}`;
}

function formatDate(mtimeMs) {
  return new Date(mtimeMs).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function labelForFile(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "HTML";
  if (ext === ".md") return "Markdown";
  if (ext === ".pdf") return "PDF";
  if (ext === ".csv") return "CSV";
  if (ext === ".json") return "JSON";
  return ext ? ext.slice(1).toUpperCase() : "FILE";
}

function renderRow(file) {
  return `
      <li class="report-row">
        <a class="report-link" href="./${encodeURIComponent(file.name)}">
          <span class="report-name">${escapeHtml(file.name)}</span>
          <span class="report-meta">
            <span class="report-type">${escapeHtml(labelForFile(file.name))}</span>
            <span class="report-date">${escapeHtml(formatDate(file.mtimeMs))}</span>
            <span class="report-size">${escapeHtml(formatBytes(file.size))}</span>
          </span>
        </a>
      </li>`;
}

function buildIndexHtml(files) {
  const body = files.length
    ? `<ul class="report-list">${files.map(renderRow).join("\n")}\n    </ul>`
    : `<p class="empty-state">No reports have been published yet.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Reports · Forest Finds</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,340;0,9..144,480;0,9..144,600;0,9..144,720;1,9..144,480;1,9..144,600&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#f4f4ec;
    --surface:#ffffff;
    --ink:#181c11;
    --ink-soft:#52514e;
    --muted:#898781;
    --line:#ded9c6;
    --forest:#2e6b44;
    --forest-deep:#1d4a2f;
    --shadow: 0 1px 2px rgba(24,28,17,0.06), 0 8px 24px -12px rgba(24,28,17,0.18);
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --bg:#0e120b; --surface:#171b11; --ink:#edeee2; --ink-soft:#c3c2b3;
      --muted:#8f8d80; --line:#2c3121; --forest:#6fc98a; --forest-deep:#4fa96c;
      --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6);
    }
  }
  :root[data-theme="dark"]{
    --bg:#0e120b; --surface:#171b11; --ink:#edeee2; --ink-soft:#c3c2b3;
    --muted:#8f8d80; --line:#2c3121; --forest:#6fc98a; --forest-deep:#4fa96c;
    --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6);
  }
  *{box-sizing:border-box;}
  body{
    margin:0; min-height:100vh; background:var(--bg); color:var(--ink);
    font-family:"Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height:1.5;
  }
  main{ max-width:720px; margin:0 auto; padding:56px 24px 80px; }
  h1{ font-family:"Fraunces", Georgia, serif; font-weight:600; font-size:2rem; margin:0 0 8px; }
  .subtitle{ color:var(--ink-soft); margin:0 0 32px; }
  .report-list{
    list-style:none; margin:0; padding:0; border:1px solid var(--line);
    border-radius:12px; overflow:hidden; background:var(--surface); box-shadow:var(--shadow);
  }
  .report-row + .report-row{ border-top:1px solid var(--line); }
  .report-link{
    display:flex; align-items:center; justify-content:space-between; gap:16px;
    padding:16px 20px; text-decoration:none; color:inherit;
  }
  .report-link:hover, .report-link:focus-visible{ background:var(--bg); }
  .report-name{ font-weight:600; word-break:break-word; }
  .report-meta{
    display:flex; align-items:center; gap:12px; flex-shrink:0;
    font-family:"JetBrains Mono", ui-monospace, monospace; font-size:0.8rem; color:var(--muted);
  }
  .report-type{ color:var(--forest-deep); font-weight:600; }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) .report-type{ color:var(--forest); } }
  :root[data-theme="dark"] .report-type{ color:var(--forest); }
  .empty-state{ color:var(--muted); }
  footer{ margin-top:32px; color:var(--muted); font-size:0.85rem; }
</style>
</head>
<body>
<main>
  <h1>Reports</h1>
  <p class="subtitle">Generated ledgers and data reports published from this site.</p>
  ${body}
  <footer>Generated automatically at build time — do not edit this file by hand.</footer>
</main>
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
  buildIndexHtml,
  formatBytes,
  formatDate,
  labelForFile,
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
