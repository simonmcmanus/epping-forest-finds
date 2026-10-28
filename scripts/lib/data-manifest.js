"use strict";
// The data manifest: every dataset the app loads, with its size and SHA-256. Published by the
// website build at /data/manifest.json and bundled into the native app by native/scripts/sync-www.js,
// so the app can tell which of its bundled files the website has since replaced and fetch only
// those (spec/spec-native.md "Delta updates"). One implementation for both, so the two can never
// hash differently.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const MANIFEST_PATH = "data/manifest.json";
const DATA_FILE = /^data\/.+\.(json|geojson)$/;
const NOT_DATA = [/^data\/tracking\//, /\.backup/, /^data\/manifest\.json$/];

function isDataFile(file) {
  return DATA_FILE.test(file) && !NOT_DATA.some((re) => re.test(file));
}

// Files under data/ that are deliberately not part of the site (gitignored sources and working
// copies), for when git cannot be asked: see knownFiles.
const UNPUBLISHED = [/\.overpass\.json$/, /^data\/local-landmarks(-access)?\.geojson$/];

function walk(root, dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(root, rel) : [rel];
  });
}

// Tracked plus new, not-ignored files: the same set git would hand the website build. Where git
// cannot answer (no .git in the build, or a CI container whose checkout git refuses as owned by
// another user) the data directory is walked instead, skipping what git would have ignored.
function knownFiles(root) {
  try {
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter(Boolean);
  } catch {
    return walk(root, "data").filter((file) => !UNPUBLISHED.some((re) => re.test(file)));
  }
}

// The data release marker (js/data-cache-version.js), which only the post-merge workflow moves.
function dataVersion(root) {
  const source = fs.readFileSync(path.join(root, "js", "data-cache-version.js"), "utf8");
  const context = { globalThis: {} };
  vm.createContext(context);
  return vm.runInContext(`${source}\nDATA_CACHE_VERSION`, context);
}

function buildManifest(root, files = knownFiles(root)) {
  const entries = {};
  for (const file of files.filter(isDataFile).sort()) {
    const bytes = fs.readFileSync(path.join(root, file));
    entries[file] = { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  }
  return { dataVersion: dataVersion(root), generatedAt: new Date().toISOString(), files: entries };
}

module.exports = { MANIFEST_PATH, isDataFile, buildManifest };
