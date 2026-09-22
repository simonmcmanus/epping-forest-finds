#!/usr/bin/env node
// Counts everything the app can show on the map, grouped by the same
// high-level filter groups the app's Filter screen uses.
//
// Why Node and not Python like the rest of the report pipeline: a place's
// group is decided by the app's own classification rules (js/categories.js),
// which are tag-driven rather than file-driven -- a church, a school and a
// campsite all live in the same data file, and a plaque can arrive from
// either the folklore data or the historic data. Re-implementing those rules
// in Python would guarantee the report's numbers drifted away from the app's.
// This script loads the real rules instead, so the report can only ever
// report what the app would actually draw.
//
// Usage: node scripts/report/map-inventory.js [--root <dir>] [--pretty]
// Writes the inventory as JSON to stdout. --root points the data lookups at
// a different copy of the data (the report's own tests render against a
// stand-in directory); the classification rules always come from this
// checkout's js/ regardless.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_ROOT = path.join(__dirname, "..", "..");

function dataRoot(argv) {
  const flag = argv.indexOf("--root");
  return flag === -1 ? APP_ROOT : path.resolve(argv[flag + 1]);
}

function loadAppRules() {
  // projectLonLat turns lon/lat into screen-space coordinates for drawing.
  // Counting never looks at the result, so a stub keeps this script free of
  // the whole camera/canvas layer.
  const context = { console, projectLonLat: () => null };
  vm.createContext(context);
  for (const file of ["js/categories.js", "js/normalize.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP_ROOT, file), "utf8"), context, { filename: file });
  }
  // `const` declarations inside a vm script stay in the context's lexical
  // scope rather than becoming properties of the context object, so the ones
  // this script needs are read back out with an expression.
  return vm.runInContext(
    "({ FILTER_GROUPS, placeLabelFilterKey, buildOsmCategoryTags, normalizeFolkloreLocations, extractWaterFeatures })",
    context
  );
}

function readJsonIfPresent(root, relativePath) {
  const full = path.join(root, relativePath);
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : null;
}

const LANDMARK_FILES = [
  "data/local-landmarks-food.geojson",
  "data/local-landmarks-transport.geojson",
  "data/local-landmarks-gates.geojson",
  "data/local-landmarks-facilities.geojson",
  "data/local-landmarks-historic.geojson",
  "data/local-landmarks-tourism.geojson",
  "data/local-landmarks-misc.geojson",
];

// Subfilters whose items are not places in the landmark/folklore sense, so
// they are counted from their own datasets rather than by classifying places.
const TREE_KEY = "trees";
const COW_KEY = "cows";
const WATER_KEY = "ponds_streams";

function loadPlaces(rules, root) {
  const osm = LANDMARK_FILES.flatMap((file) => {
    const data = readJsonIfPresent(root, file);
    return ((data && data.features) || [])
      .filter((feature) => feature.geometry && feature.geometry.type === "Point")
      .map((feature) => ({
        ...feature.properties,
        categoryTags: rules.buildOsmCategoryTags(feature.properties),
      }));
  });
  const folkloreData = readJsonIfPresent(root, "data/epping_forest_folklore_locations.json");
  const folklore = folkloreData ? rules.normalizeFolkloreLocations(folkloreData) : [];
  return [...osm, ...folklore];
}

function countTrees(root) {
  const index = readJsonIfPresent(root, "data/trees/index.json");
  if (index && Number.isFinite(index.recordCount)) return index.recordCount;
  const full = readJsonIfPresent(root, "Veteran_Tree_Register.json");
  return full && Array.isArray(full.trees) ? full.trees.length : 0;
}

function countWater(rules, root) {
  const environment = readJsonIfPresent(root, "data/local-environment.geojson");
  return environment ? rules.extractWaterFeatures(environment.features || []).length : 0;
}

function buildInventory(root = APP_ROOT) {
  const rules = loadAppRules();
  const places = loadPlaces(rules, root);
  const treeCount = countTrees(root);
  const waterCount = countWater(rules, root);

  const fixedCounts = { [TREE_KEY]: treeCount, [WATER_KEY]: waterCount };

  // A place can satisfy more than one subfilter (a historic pub is both), so
  // it is counted under the one filter chip the app lists it under. That keeps
  // the breakdown adding up to the total instead of double-counting. The app's
  // own placeLabelFilterKey decides, rather than a copy of its priority order:
  // that order has a fallback tier (historic, monuments) and a chipless key
  // (blue_plaques reads as Plaques), and a copy that missed them counted all
  // three as zero.
  const claimed = new Map();
  for (const place of places) {
    const key = rules.placeLabelFilterKey(place);
    if (!key) continue;
    claimed.set(key, (claimed.get(key) || 0) + 1);
  }
  const classifiedPlaces = Array.from(claimed.values()).reduce((sum, n) => sum + n, 0);

  // Array.from rather than .map: FILTER_GROUPS belongs to the sandbox the
  // app's rules were loaded into, and arrays derived from it with .map stay
  // sandbox-side, which trips up anything comparing them to ordinary arrays.
  const groups = Array.from(rules.FILTER_GROUPS, (group) => {
    const subfilters = Array.from(
      // Cattle are tracked live from the grazing collars rather than stored
      // with the map data, so there is no fixed number to report here.
      group.subfilters.filter((subfilter) => subfilter.key !== COW_KEY),
      (subfilter) => ({
        key: subfilter.key,
        label: subfilter.label,
        count: subfilter.key in fixedCounts ? fixedCounts[subfilter.key] : (claimed.get(subfilter.key) || 0),
      })
    );
    return {
      key: group.key,
      label: group.label,
      count: subfilters.reduce((sum, subfilter) => sum + subfilter.count, 0),
      subfilters,
    };
  });

  const groupedTotal = groups.reduce((sum, group) => sum + group.count, 0);

  // Gates, benches, bins, toilets and the like are always drawn -- they have
  // no filter of their own -- so they would silently vanish from a breakdown
  // built only from the filter groups. Counted separately so the total is
  // honest about everything on the map.
  const alwaysShown = places.length - classifiedPlaces;

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    total: groupedTotal + alwaysShown,
    groups,
    alwaysShown: { label: "Gates, benches & other facilities", count: alwaysShown },
  };
}

if (require.main === module) {
  const pretty = process.argv.includes("--pretty");
  const inventory = buildInventory(dataRoot(process.argv));
  process.stdout.write(JSON.stringify(inventory, null, pretty ? 2 : 0) + "\n");
}

module.exports = { buildInventory };
