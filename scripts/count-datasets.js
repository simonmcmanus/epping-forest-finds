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
const vm = require("node:vm");

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

/** Generate small, independent homepage lists using the map's own classifier.
 * App scripts are read only by this Node generator, never loaded by the homepage.
 * Keep every record (including unnamed places) so lists match the inventory.
 */
function readCategoryItems(root) {
  const context = vm.createContext({ projectLonLat: () => null });
  for (const file of ["js/categories.js", "js/normalize.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  }
  const rules = vm.runInContext(
    "({ FILTER_GROUPS, placeLabelFilterKey, buildOsmCategoryTags, normalizeFolkloreLocations, extractWaterFeatures })", context
  );
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const categories = Object.fromEntries(Array.from(rules.FILTER_GROUPS).flatMap(group =>
    Array.from(group.subfilters).filter(item => item.key !== "cows").map(item => [item.key, []])
  ));
  const places = ["food", "transport", "gates", "facilities", "historic", "tourism", "misc"].flatMap(name =>
    read(`data/local-landmarks-${name}.geojson`).features
      .filter(feature => feature.geometry && feature.geometry.type === "Point")
      .map(feature => ({ ...feature.properties, categoryTags: rules.buildOsmCategoryTags(feature.properties) }))
  );
  places.push(...rules.normalizeFolkloreLocations(read("data/epping_forest_folklore_locations.json")));
  for (const place of places) {
    const key = rules.placeLabelFilterKey(place);
    if (!categories[key]) continue;
    categories[key].push({
      name: place.name || `Unnamed ${(place.categoryLabel || "place").toLowerCase()}`,
      detail: place.address || place.area || (!place.name && place.id ? `Map record ${place.id}` : ""),
    });
  }
  categories.ponds_streams = Array.from(rules.extractWaterFeatures(read("data/local-environment.geojson").features),
    place => ({ name: place.name, detail: "" }));
  categories.trees = read(TREE_INDEX).chunks.flatMap(chunk => read(chunk.url).trees.map(tree => ({
    name: tree.commonName || tree.latinName || "Tree",
    detail: Number(tree.tagNumber) > 0 ? `Tag ${tree.tagNumber}` : `Untagged · record ${tree.recordNumber}`,
  })));
  for (const items of Object.values(categories)) {
    items.sort((a, b) => a.name.localeCompare(b.name, "en-GB") || a.detail.localeCompare(b.detail, "en-GB", { numeric: true }));
  }
  return categories;
}

module.exports = { readCounts, readCategoryItems, formatCount, FEATURE_FILES, TREE_INDEX };

if (require.main === module) {
  const counts = readCounts(path.join(__dirname, ".."));
  for (const [name, value] of Object.entries(counts)) {
    console.log(`${name.padEnd(12)} ${formatCount(value)}`);
  }
}
