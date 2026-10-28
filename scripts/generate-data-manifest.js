#!/usr/bin/env node
"use strict";
// Writes data/manifest.json for the website build (see scripts/lib/data-manifest.js). Build output:
// gitignored, regenerated on every deploy.
const fs = require("fs");
const path = require("path");
const { MANIFEST_PATH, buildManifest } = require("./lib/data-manifest.js");

const root = path.join(__dirname, "..");
const manifest = buildManifest(root);
fs.writeFileSync(path.join(root, MANIFEST_PATH), JSON.stringify(manifest));
console.log(`[data-manifest] ${Object.keys(manifest.files).length} files, ${manifest.dataVersion} -> ${MANIFEST_PATH}`);
