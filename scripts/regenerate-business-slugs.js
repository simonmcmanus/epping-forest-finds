#!/usr/bin/env node
"use strict";

/**
 * Regenerates data/business-slugs.json -- the single, checked-in index of
 * every food/locations place that gets its own /find/<slug>/ page. This file
 * is committed (unlike nearby/, find/, sitemap.xml -- those are build-time
 * output), because three independent consumers need the same slugs without
 * running a build: the live app (js/loader.js links a map pin to its page),
 * the Python weekly Ledger renderer (links a business mention to its page),
 * and scripts/generate-business-pages.js (builds the actual pages from it).
 * Recomputing slugs separately in any of those would let them drift apart.
 *
 * Run after any change to the underlying place data (a landmark regen, a
 * weekly business-watch merge): `node scripts/regenerate-business-slugs.js`.
 * test/business-slugs.test.js fails the build if the committed file goes
 * stale, the same pattern sync-homepage-counts.js/home-counts.test.js use.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_ROOT = path.join(__dirname, "..");
const OUTPUT_PATH = path.join(APP_ROOT, "data", "business-slugs.json");

// Only these subfilters get an individual page -- confirmed scope is
// "businesses" (food) plus the non-commercial but individually-searched
// Locations group (churches, education, medicine, campsites). Never trees,
// cows, transport, history or stories: thin content at a much larger scale
// for places with no individual identity beyond a pin.
const BUSINESS_SUBFILTER_KEYS = ["pubs", "restaurants", "cafes", "shops", "churches", "education", "medicine", "campsites"];

const LANDMARK_FILES = [
  "data/local-landmarks-food.geojson",
  "data/local-landmarks-transport.geojson",
  "data/local-landmarks-gates.geojson",
  "data/local-landmarks-facilities.geojson",
  "data/local-landmarks-historic.geojson",
  "data/local-landmarks-tourism.geojson",
  "data/local-landmarks-misc.geojson",
];

function loadAppRules(root) {
  const context = { console, projectLonLat: () => null };
  vm.createContext(context);
  for (const file of ["js/categories.js", "js/normalize.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  return vm.runInContext(
    "({ FILTER_GROUPS, buildOsmCategoryTags, normalizeFolkloreLocations, matchesPlaceFilter })",
    context
  );
}

function readJsonIfPresent(root, relativePath) {
  const full = path.join(root, relativePath);
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : null;
}

function loadPlaces(rules, root) {
  const osm = LANDMARK_FILES.flatMap((file) => {
    const data = readJsonIfPresent(root, file);
    return ((data && data.features) || [])
      .filter((feature) => feature.geometry && feature.geometry.type === "Point")
      .map((feature) => ({
        ...feature.properties,
        categoryTags: rules.buildOsmCategoryTags(feature.properties),
        lon: feature.geometry.coordinates[0],
        lat: feature.geometry.coordinates[1],
      }));
  });
  const folkloreData = readJsonIfPresent(root, "data/epping_forest_folklore_locations.json");
  const folklore = folkloreData ? rules.normalizeFolkloreLocations(folkloreData) : [];
  return [...osm, ...folklore];
}

/** subfilter key -> top-level group key ("pubs" -> "food"), read off the app's own
 * FILTER_GROUPS rather than hand-duplicated, so the two can never disagree. */
function buildGroupKeyIndex(rules) {
  const index = new Map();
  for (const group of rules.FILTER_GROUPS) {
    for (const subfilter of group.subfilters) index.set(subfilter.key, group.key);
  }
  return index;
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function outwardPostcode(address) {
  if (!address) return null;
  const m = String(address).match(/([A-Za-z]{1,2}\d{1,2}[A-Za-z]?)\s*\d[A-Za-z]{2}\s*$/);
  return m ? m[1].toUpperCase() : null;
}

/** Assigns a URL-unique slug per item, preferring a readable postcode-outward
 * suffix for a name collision (e.g. two "Costa"s) and falling back to an id
 * fragment only when that still doesn't disambiguate (no usable address, or
 * two locations sharing one outward code). */
function dedupeSlugs(items) {
  const byBaseSlug = new Map();
  for (const item of items) {
    const base = slugify(item.name);
    if (!byBaseSlug.has(base)) byBaseSlug.set(base, []);
    byBaseSlug.get(base).push(item);
  }
  const result = [];
  for (const [base, group] of byBaseSlug) {
    if (group.length === 1) {
      result.push({ ...group[0], slug: base });
      continue;
    }
    const outwardCounts = new Map();
    for (const item of group) {
      const outward = outwardPostcode(item.address);
      if (outward) outwardCounts.set(outward, (outwardCounts.get(outward) || 0) + 1);
    }
    const provisional = group.map((item) => {
      const outward = outwardPostcode(item.address);
      if (outward && outwardCounts.get(outward) === 1) return { ...item, slug: `${base}-${outward.toLowerCase()}` };
      const idTail = String(item.id || "").replace(/\D/g, "").slice(-6);
      return { ...item, slug: idTail ? `${base}-${idTail}` : base };
    });
    // Last-resort guarantee: anything still sharing a slug after postcode and
    // id-digit disambiguation (manually-entered chain branches commonly share
    // one non-numeric id like "manual/boots") gets a stable numeric suffix,
    // ordered by address so re-runs produce the same assignment.
    const stillColliding = new Map();
    for (const item of provisional) {
      if (!stillColliding.has(item.slug)) stillColliding.set(item.slug, []);
      stillColliding.get(item.slug).push(item);
    }
    for (const [slug, colliders] of stillColliding) {
      if (colliders.length === 1) {
        result.push(colliders[0]);
        continue;
      }
      colliders
        .sort((a, b) => String(a.address).localeCompare(String(b.address)))
        .forEach((item, index) => result.push({ ...item, slug: index === 0 ? slug : `${slug}-${index + 1}` }));
    }
  }
  return result;
}

function buildIndex(root = APP_ROOT) {
  const rules = loadAppRules(root);
  const groupKeyOf = buildGroupKeyIndex(rules);
  const places = loadPlaces(rules, root);

  const classified = [];
  for (const place of places) {
    if (!place.name || !String(place.name).trim()) continue;
    for (const key of BUSINESS_SUBFILTER_KEYS) {
      if (rules.matchesPlaceFilter(place, key)) {
        classified.push({
          id: place.id || null,
          key,
          groupKey: groupKeyOf.get(key) || null,
          name: String(place.name).trim(),
          address: place.address || null,
          phone: place.phone || null,
          website: place.website || null,
          lat: Number.isFinite(place.lat) ? place.lat : null,
          lon: Number.isFinite(place.lon) ? place.lon : null,
          distanceToForestBoundaryMetres: Number.isFinite(place.distanceToForestBoundaryMetres)
            ? place.distanceToForestBoundaryMetres
            : null,
        });
        break; // same first-match-wins rule as the app's own classification priority
      }
    }
  }

  const withSlugs = dedupeSlugs(classified)
    .map(({ key, groupKey, slug, name, address, phone, website, lat, lon, distanceToForestBoundaryMetres, id }) => ({
      slug,
      key,
      groupKey,
      name,
      address,
      phone,
      website,
      lat,
      lon,
      distanceToForestBoundaryMetres,
      id,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    entries: withSlugs,
  };
}

function write(root = APP_ROOT) {
  const index = buildIndex(root);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

module.exports = { buildIndex, slugify, dedupeSlugs, outwardPostcode, BUSINESS_SUBFILTER_KEYS, OUTPUT_PATH };

if (require.main === module) {
  const index = write();
  console.log(`[regenerate-business-slugs] wrote ${index.entries.length} entries to data/business-slugs.json`);
}
