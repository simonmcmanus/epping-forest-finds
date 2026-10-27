#!/usr/bin/env node
// Compact GeoJSON writing for the large generated map datasets: every top-level member on the first
// line, then one feature per line. Pretty-printing more than doubled these files (half of the 44 MB
// local-environment.geojson was whitespace), which every first visit downloads, parses and caches;
// one feature per line is nearly as small as minified JSON and keeps git diffs per feature.
// scripts/geojson_format.py is the same format for the Python writers.
//
// As a command, rewrites the named files in this format without changing their content:
//   node scripts/geojson-format.js data/local-roads.geojson ...
const fs = require("fs");

function stringifyFeatureLines(geojson) {
  const { features = [], ...head } = geojson;
  const headJson = JSON.stringify(head);
  const opening = headJson.slice(0, -1) + (Object.keys(head).length ? "," : "");
  return `${opening}"features":[\n${features.map((feature) => JSON.stringify(feature)).join(",\n")}\n]}\n`;
}

function writeFeatureLines(file, geojson) {
  fs.writeFileSync(file, stringifyFeatureLines(geojson));
}

if (require.main === module) {
  for (const file of process.argv.slice(2)) {
    const before = fs.statSync(file).size;
    writeFeatureLines(file, JSON.parse(fs.readFileSync(file, "utf8")));
    console.log(`${file}: ${(before / 1e6).toFixed(1)} MB -> ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
  }
}

module.exports = { stringifyFeatureLines, writeFeatureLines };
