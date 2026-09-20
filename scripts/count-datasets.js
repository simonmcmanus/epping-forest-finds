#!/usr/bin/env node
"use strict";

/**
 * Reads the real size of each dataset the marketing homepage quotes.
 *
 * The homepage's numbers are committed rather than injected at build time --
 * the page has to work from a plain checkout with no build step, same as the
 * rest of this project. test/home-counts.test.js holds the committed copy to
 * these values, so a dataset that grows fails the suite instead of quietly
 * making the homepage wrong.
 *
 * Run directly to print the current numbers:
 *   node scripts/count-datasets.js
 *
 * See spec/spec-marketing.md section 4.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * GeoJSON feature counts, taken by counting `"type":"Feature"` rather than
 * parsing: these files run to tens of megabytes and the homepage only needs a
 * number. The closing quote is what keeps "FeatureCollection" from matching.
 */
const FEATURE_FILES = {
  paths: "data/local-paths.geojson",
  facilities: "data/local-landmarks-facilities.geojson",
  transport: "data/local-landmarks-transport.geojson",
  food: "data/local-landmarks-food.geojson",
};

const TREE_INDEX = "data/trees/index.json";

function countFeatures(filePath) {
  const contents = fs.readFileSync(filePath, "utf8");
  const matches = contents.match(/"Feature"/g);
  return matches ? matches.length : 0;
}

function countTrees(filePath) {
  const index = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const count = Number(index.recordCount);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`${filePath}: recordCount is missing or not a positive integer`);
  }
  return count;
}

/**
 * @param {string} root absolute path to the site root
 * @returns {{trees:number, paths:number, facilities:number, transport:number, food:number}}
 */
function readCounts(root) {
  const counts = { trees: countTrees(path.join(root, TREE_INDEX)) };

  for (const [name, relative] of Object.entries(FEATURE_FILES)) {
    const filePath = path.join(root, relative);
    if (!fs.existsSync(filePath)) {
      throw new Error(`${relative} is missing -- cannot verify the homepage's ${name} count`);
    }
    counts[name] = countFeatures(filePath);
  }

  return counts;
}

/** Thousands separators, as the homepage renders them. */
function formatCount(value) {
  return Number(value).toLocaleString("en-GB");
}

module.exports = { readCounts, formatCount, FEATURE_FILES, TREE_INDEX };

if (require.main === module) {
  const counts = readCounts(path.join(__dirname, ".."));
  for (const [name, value] of Object.entries(counts)) {
    console.log(`${name.padEnd(12)} ${formatCount(value)}`);
  }
}
