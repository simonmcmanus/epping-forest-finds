#!/usr/bin/env node
"use strict";
// Builds native/www -- the files the Capacitor shell ships inside the app binary -- from the
// repository root. See spec/spec-native.md "Project layout" and "Data bundling".
//
// Files are chosen by an explicit allowlist over the files git knows about (ignored files never ship), never by copying the repository:
// the allowlist is a security boundary (no admin dashboard, no serverless functions, no source data
// in a public binary), not a size optimisation. app.html becomes www/index.html, the shell's entry
// point; the marketing homepage (index.html) is a website surface and is never shipped.
//
// Usage: node native/scripts/sync-www.js [--out <dir>]
// NATIVE_API_BASE=<origin> points the app's API calls at another deployment (a deploy preview,
// a dev tunnel). Unset, js/native.js uses the production origin.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const INCLUDE = [
  /^app\.html$/,
  /^terms\.html$/,
  /^cookie-consent\.js$/,
  /^manifest\.webmanifest$/,
  /^tree-icon\.svg$/,
  /^js\/[^/]+\.js$/,
  /^css\/[^/]+\.css$/,
  /^data\/.+\.(json|geojson|png|svg|jpg|webp)$/,
];

const EXCLUDE = [
  /^js\/admin\.js$/,
  /^css\/admin\.css$/,
  // Source artwork the generated map icons are cut from.
  /^data\/icons\/src\//,
  /^data\/tracking\//,
  /\.backup/,
];

// Never in a binary, whatever the allowlist above comes to match. Checked after selection so a
// widened pattern fails the sync loudly instead of shipping one of these.
const FORBIDDEN = [/^admin\.html$/, /admin\.js$/, /^netlify\//, /^server\.js$/, /^scripts\//, /^test\//, /^spec\//, /^index\.html$/];

// ~11cm. Far finer than a phone's GPS fix or anything this renderer can draw.
const COORDINATE_DECIMALS = 6;

function trackedFiles(root) {
  // Tracked plus new, not-ignored files, so a file added but not yet committed is not silently
  // missing from a local build.
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

function selectFiles(files) {
  const selected = files.filter((file) => INCLUDE.some((re) => re.test(file)) && !EXCLUDE.some((re) => re.test(file)));
  const forbidden = selected.filter((file) => FORBIDDEN.some((re) => re.test(file)));
  if (forbidden.length) throw new Error(`[sync-www] refusing to ship: ${forbidden.join(", ")}`);
  return selected;
}

function roundCoordinates(value) {
  if (typeof value === "number") return Number(value.toFixed(COORDINATE_DECIMALS));
  if (Array.isArray(value)) return value.map(roundCoordinates);
  return value;
}

// Whitespace stripped from every JSON file, and GeoJSON coordinates rounded. Property values are
// left exactly as they are: only geometry is ever rounded.
function compactJson(text, isGeoJson) {
  const data = JSON.parse(text);
  if (!isGeoJson) return JSON.stringify(data);
  return JSON.stringify(data, (key, value) => (key === "coordinates" ? roundCoordinates(value) : value));
}

function apiBaseScript(origin) {
  return `<script>window.__FOREST_FINDS_API_BASE__ = ${JSON.stringify(origin)};</script>\n  `;
}

function sync({ root = REPO_ROOT, out = path.join(REPO_ROOT, "native", "www"), apiBase = process.env.NATIVE_API_BASE || "" } = {}) {
  const files = selectFiles(trackedFiles(root));
  fs.rmSync(out, { recursive: true, force: true });
  let bytes = 0;
  for (const file of files) {
    const target = path.join(out, file === "app.html" ? "index.html" : file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const source = path.join(root, file);
    if (/\.(geo)?json$/.test(file)) {
      const compact = compactJson(fs.readFileSync(source, "utf8"), file.endsWith(".geojson"));
      fs.writeFileSync(target, compact);
      bytes += Buffer.byteLength(compact);
    } else if (file === "app.html" && apiBase) {
      const html = fs.readFileSync(source, "utf8");
      const first = html.indexOf("<script");
      const withBase = html.slice(0, first) + apiBaseScript(apiBase) + html.slice(first);
      fs.writeFileSync(target, withBase);
      bytes += Buffer.byteLength(withBase);
    } else {
      fs.copyFileSync(source, target);
      bytes += fs.statSync(target).size;
    }
  }
  return { files: files.length, bytes, out };
}

if (require.main === module) {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex > -1 ? path.resolve(process.argv[outIndex + 1]) : undefined;
  const result = sync(out ? { out } : {});
  console.log(`[sync-www] ${result.files} files, ${(result.bytes / 1024 / 1024).toFixed(1)} MB -> ${path.relative(process.cwd(), result.out) || "."}`);
}

module.exports = { sync, selectFiles, compactJson };
