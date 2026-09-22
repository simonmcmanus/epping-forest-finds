#!/usr/bin/env node
"use strict";

/**
 * Rewrites the dataset sizes quoted on the marketing homepage (and in
 * spec-marketing.md, which quotes the same figures) from the real data.
 *
 * scripts/count-datasets.js reads the numbers and test/home-counts.test.js
 * fails when the page has drifted from them. Between the two there was
 * nothing that would actually correct the page -- a person had to notice the
 * failure and edit the copy by hand.
 *
 * That gap is why this exists. The weekly ledger run adds and removes food
 * places unattended, which changes data/local-landmarks-food.geojson's size
 * every time it finds anything; with no way to update the copy, every data
 * change it proposed arrived with a red test on it. An automated pull request
 * that is always failing is one nobody merges, so the map stayed as it was
 * while the high street moved on. spec-marketing.md §4 has always said these
 * counts are generated rather than written; this is the generator.
 *
 * Usage:
 *   node scripts/sync-homepage-counts.js          # rewrite the files
 *   node scripts/sync-homepage-counts.js --check   # report drift, change nothing
 *
 * Exits non-zero under --check when something is out of date, so it can guard
 * a change as well as make one.
 */

const fs = require("node:fs");
const path = require("node:path");

const { readCounts, formatCount, FEATURE_FILES, TREE_INDEX } = require("./count-datasets.js");
const { buildInventory } = require("./report/map-inventory.js");

const ROOT = path.join(__dirname, "..");
const HOMEPAGE = path.join(ROOT, "index.html");
const MARKETING_SPEC = path.join(ROOT, "spec", "spec-marketing.md");

/**
 * Where each figure appears, in the words around it rather than by line
 * number, so the copy can be rewritten without breaking this.
 *
 * - `prose`: the noun phrase following the number in spec-marketing.md §3.4.
 * - `source`: the dataset path, which anchors the §4 source table row.
 */
const FIGURES = {
  trees: { prose: "veteran trees", source: TREE_INDEX },
  paths: { prose: "paths and bridleways", source: FEATURE_FILES.paths },
  facilities: {
    prose: "car parks,\n> benches, toilets and gates",
    source: FEATURE_FILES.facilities,
  },
  transport: { prose: "bus stops and stations", source: FEATURE_FILES.transport },
  food: { prose: "pubs, cafés and shops", source: FEATURE_FILES.food },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateHomepage(html, counts, inventory = buildInventory(ROOT)) {
  let out = html;
  out = out.replace(
    /(class="inventory-total">(?:<img[^>]*>)?<strong>)[\d,]+(<\/strong>)/,
    `$1${formatCount(inventory.total)}$2`
  );
  for (const group of inventory.groups) {
    const groupPattern = new RegExp(`(data-inventory-group="${group.key}"[\\s\\S]*?<h3>[\\s\\S]*?<strong>)[\\d,]+(</strong>)`);
    out = out.replace(groupPattern, `$1${formatCount(group.count)}$2`);
    for (const subfilter of group.subfilters) {
      const label = escapeRegExp(subfilter.label).replace(/&/, "&amp;");
      out = out.replace(
        new RegExp(`(<dt>(?:<img[^>]*>)?${label}</dt><dd>)[\\d,]+(</dd>)`),
        `$1${formatCount(subfilter.count)}$2`
      );
    }
  }
  out = out.replace(
    /(data-inventory-always[\s\S]*?<strong>)[\d,]+(<\/strong>)/,
    `$1${formatCount(inventory.alwaysShown.count)}$2`
  );
  const treeCount = inventory.groups.find(group => group.key === "nature")
    ?.subfilters.find(subfilter => subfilter.key === "trees")?.count || counts.trees;
  out = out.replace(/[\d,]+(?= veteran trees)/g, formatCount(treeCount));
  return out;
}

function updateMarketingSpec(markdown, counts) {
  let out = markdown;
  for (const [name, figure] of Object.entries(FIGURES)) {
    const wanted = formatCount(counts[name]);
    out = out.replace(
      new RegExp(`[\\d,]+(\\s+${escapeRegExp(figure.prose)})`),
      `${wanted}$1`
    );
    out = out.replace(
      new RegExp(`^\\| [\\d,]+( .*\`${escapeRegExp(figure.source)}\`)`, "m"),
      `| ${wanted}$1`
    );
  }
  return out;
}

function sync({ check = false, root = ROOT } = {}) {
  const counts = readCounts(root);
  const inventory = buildInventory(root);
  const files = [
    { path: root === ROOT ? HOMEPAGE : path.join(root, "index.html"), update: (text) => updateHomepage(text, counts, inventory) },
    { path: root === ROOT ? MARKETING_SPEC : path.join(root, "spec", "spec-marketing.md"), update: updateMarketingSpec },
  ];

  const stale = [];
  for (const file of files) {
    if (!fs.existsSync(file.path)) continue;
    const before = fs.readFileSync(file.path, "utf8");
    const after = file.update(before, counts);
    if (before === after) continue;
    stale.push(path.relative(root, file.path));
    if (!check) fs.writeFileSync(file.path, after);
  }
  return { counts, stale };
}

module.exports = { sync, updateHomepage, updateMarketingSpec, FIGURES };

if (require.main === module) {
  const check = process.argv.includes("--check");
  const { counts, stale } = sync({ check });
  for (const [name, value] of Object.entries(counts)) {
    console.log(`${name.padEnd(12)} ${formatCount(value)}`);
  }
  if (!stale.length) {
    console.log("\nEvery quoted count already matches the data.");
  } else if (check) {
    console.error(`\nOut of date: ${stale.join(", ")}. Run: node scripts/sync-homepage-counts.js`);
    process.exit(1);
  } else {
    console.log(`\nUpdated: ${stale.join(", ")}`);
  }
}
