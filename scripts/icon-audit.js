#!/usr/bin/env node
"use strict";

/**
 * Finds every place the map draws with something other than one of the app's
 * own pin icons.
 *
 * The map has a designed icon set (see spec/spec-icons.md), and a fallback:
 * when nothing in the icon rules matches a place, the renderer draws a plain
 * emoji glyph in a badge instead. That fallback is invisible in code review --
 * nothing errors, a pin appears -- but on the map it is the difference between
 * the product's own artwork and whatever glyph the device happens to ship.
 * This script names every place that falls through, so "which icons are not
 * the standard ones" is a number rather than an impression.
 *
 * It also reports three ways the icon set and the rules can drift apart:
 * filter keys the classifier can never return true for (so their icon is
 * unreachable), icon slugs with no file behind them, and icon files nothing
 * refers to.
 *
 * Usage:
 *   node scripts/icon-audit.js            # human-readable report
 *   node scripts/icon-audit.js --json     # the same as JSON
 *   node scripts/icon-audit.js --root <dir>
 *
 * Like scripts/report/map-inventory.js, it loads the app's real rules from
 * js/categories.js rather than restating them, so it can only ever report
 * what the app would actually draw.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_ROOT = path.join(__dirname, "..");

const LANDMARK_FILES = [
  "data/local-landmarks-food.geojson",
  "data/local-landmarks-transport.geojson",
  "data/local-landmarks-gates.geojson",
  "data/local-landmarks-facilities.geojson",
  "data/local-landmarks-historic.geojson",
  "data/local-landmarks-tourism.geojson",
  "data/local-landmarks-misc.geojson",
];

const FOLKLORE_FILE = "data/epping_forest_folklore_locations.json";
const ICON_DIR = "data/icons";

function loadAppRules() {
  const context = { console, projectLonLat: () => null };
  vm.createContext(context);
  for (const file of ["js/categories.js", "js/normalize.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP_ROOT, file), "utf8"), context, { filename: file });
  }
  return vm.runInContext(
    "({ ICON_PATHS, PLACE_FILTER_PRIORITY, FILTER_GROUPS, iconPath, filterKindIconSlug, landmarkIconSlug," +
    " matchesPlaceFilter, buildOsmCategoryTags, normalizeFolkloreLocations, isPubCategory, isCafeCategory," +
    " isShopCategory, isTransportCategory, getTransportType })",
    context
  );
}

function readJsonIfPresent(root, relativePath) {
  const full = path.join(root, relativePath);
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : null;
}

function loadPlaces(rules, root) {
  const places = [];
  for (const file of LANDMARK_FILES) {
    const data = readJsonIfPresent(root, file);
    for (const feature of (data && data.features) || []) {
      if (!feature.geometry || feature.geometry.type !== "Point") continue;
      places.push({
        source: path.basename(file, ".geojson").replace("local-landmarks-", ""),
        place: { ...feature.properties, categoryTags: rules.buildOsmCategoryTags(feature.properties) },
      });
    }
  }
  const folklore = readJsonIfPresent(root, FOLKLORE_FILE);
  for (const place of folklore ? rules.normalizeFolkloreLocations(folklore) : []) {
    places.push({ source: "folklore", place });
  }
  return places;
}

/**
 * The renderer's own order for choosing a pin, from js/renderer.js's
 * drawLandmarks(): the food and transport special cases first, then the
 * filter-priority sweep, then the landmark tag rules, then the emoji
 * fallback. It is restated here rather than called because drawLandmarks()
 * wants a canvas and the app's live state; if that order ever changes, this
 * has to change with it or the audit stops describing the real map.
 */
function resolveIcon(rules, place) {
  if (rules.isPubCategory(place)) return { kind: "png", slug: "beer" };
  if (rules.isCafeCategory(place)) return { kind: "png", slug: "cafe" };
  if (rules.isShopCategory(place)) return { kind: "png", slug: "shop" };
  if (rules.isTransportCategory(place)) {
    const type = rules.getTransportType(place);
    if (type === "underground") return { kind: "vector", slug: "underground-roundel" };
    if (type === "national_rail") return { kind: "vector", slug: "national-rail-logo" };
    if (type === "parking") return { kind: "png", slug: "landmark-parking" };
    return { kind: "png", slug: "bus" };
  }
  let slug = null;
  for (const filterKey of rules.PLACE_FILTER_PRIORITY) {
    if (rules.matchesPlaceFilter(place, filterKey)) {
      slug = rules.filterKindIconSlug(filterKey);
      break;
    }
  }
  if (!slug) slug = rules.landmarkIconSlug(place);
  if (slug && rules.iconPath(slug)) return { kind: "png", slug };
  return { kind: "emoji", slug: null };
}

function placeCategory(place) {
  return place.category || place.amenity || place.shop || place.tourism || place.historic || "(none)";
}

function listIconFiles(root, dir = ICON_DIR) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listIconFiles(root, path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  );
}

function audit(root = APP_ROOT) {
  const rules = loadAppRules();
  const places = loadPlaces(rules, root);

  const totals = { png: 0, vector: 0, emoji: 0 };
  const fallbacks = new Map();

  for (const { source, place } of places) {
    const icon = resolveIcon(rules, place);
    totals[icon.kind] += 1;
    if (icon.kind !== "emoji") continue;
    const key = placeCategory(place);
    const bucket = fallbacks.get(key) || { category: key, count: 0, sources: new Set(), examples: [] };
    bucket.count += 1;
    bucket.sources.add(source);
    if (place.name && bucket.examples.length < 3) bucket.examples.push(place.name);
    fallbacks.set(key, bucket);
  }

  // A filter key the classifier never matches is a filter that shows nothing
  // and an icon nothing can reach -- the places it was meant to cover fall
  // through to the emoji fallback instead.
  const unreachableFilters = rules.PLACE_FILTER_PRIORITY
    .filter((key) => !places.some(({ place }) => rules.matchesPlaceFilter(place, key)))
    .map((key) => ({ key, icon: rules.filterKindIconSlug(key) }));

  const iconPaths = Object.entries(rules.ICON_PATHS);
  const missingFiles = iconPaths
    .filter(([, file]) => !fs.existsSync(path.join(root, file)))
    .map(([slug, file]) => ({ slug, file }));

  const referenced = new Set(iconPaths.map(([, file]) => file));
  const unreferencedFiles = listIconFiles(root).filter((file) => !referenced.has(file));

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    placeCount: places.length,
    totals,
    fallbacks: Array.from(fallbacks.values())
      .map((bucket) => ({ ...bucket, sources: Array.from(bucket.sources).sort() }))
      .sort((a, b) => b.count - a.count),
    unreachableFilters,
    missingFiles,
    unreferencedFiles,
  };
}

function report(result) {
  const lines = [];
  const { png, vector, emoji } = result.totals;
  lines.push(`${result.placeCount} places on the map: ${png} drawn with an app icon, ${vector} drawn as a logo, ${emoji} falling back to an emoji.`);

  lines.push("", `Drawn as an emoji rather than an app icon (${emoji}):`);
  for (const bucket of result.fallbacks) {
    lines.push(
      `  ${String(bucket.count).padStart(5)}  ${bucket.category.padEnd(20)} ` +
      `${bucket.sources.join(", ").padEnd(24)} e.g. ${bucket.examples.join("; ") || "(unnamed)"}`
    );
  }

  lines.push("", "Filters that match nothing, so their icon is never drawn:");
  lines.push(...(result.unreachableFilters.length
    ? result.unreachableFilters.map((f) => `  ${f.key} (icon: ${f.icon || "none defined"})`)
    : ["  none"]));

  lines.push("", "Icons named in the registry with no file behind them:");
  lines.push(...(result.missingFiles.length ? result.missingFiles.map((f) => `  ${f.slug} -> ${f.file}`) : ["  none"]));

  lines.push("", "Icon files nothing in the registry refers to:");
  lines.push(...(result.unreferencedFiles.length ? result.unreferencedFiles.map((f) => `  ${f}`) : ["  none"]));

  return lines.join("\n");
}

function rootFrom(argv) {
  const flag = argv.indexOf("--root");
  return flag === -1 ? APP_ROOT : path.resolve(argv[flag + 1]);
}

if (require.main === module) {
  const result = audit(rootFrom(process.argv));
  process.stdout.write(
    (process.argv.includes("--json") ? JSON.stringify(result, null, 2) : report(result)) + "\n"
  );
}

module.exports = { audit, resolveIcon, loadAppRules };
