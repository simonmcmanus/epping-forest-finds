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

const ROOT = path.join(__dirname, "..");
const HOMEPAGE = path.join(ROOT, "index.html");
const MARKETING_SPEC = path.join(ROOT, "spec", "spec-marketing.md");

/**
 * Where each figure appears, in the words around it rather than by line
 * number, so the copy can be rewritten without breaking this.
 *
 * - `label`: the homepage's own label beside the number, in its count grid.
 * - `prose`: the noun phrase following the number in spec-marketing.md §3.4.
 * - `source`: the dataset path, which anchors the §4 source table row.
 */
const FIGURES = {
  trees: { label: "veteran trees", prose: "veteran trees", source: TREE_INDEX },
  paths: { label: "paths &amp; bridleways", prose: "paths and bridleways", source: FEATURE_FILES.paths },
  facilities: {
    label: "car parks, toilets, benches &amp; gates",
    prose: "car parks,\n> benches, toilets and gates",
    source: FEATURE_FILES.facilities,
  },
  transport: { label: "bus stops &amp; stations", prose: "bus stops and stations", source: FEATURE_FILES.transport },
  food: { label: "pubs, cafés &amp; shops", prose: "pubs, cafés and shops", source: FEATURE_FILES.food },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The number currently sitting beside a label in the homepage's count grid. */
function quotedOnHomepage(html, label) {
  const match = html.match(
    new RegExp(`<span class="count-n">([\\d,]+)</span><span class="count-l">${escapeRegExp(label)}</span>`)
  );
  return match ? match[1] : null;
}

function updateHomepage(html, counts) {
  let out = html;
  for (const [name, figure] of Object.entries(FIGURES)) {
    const wanted = formatCount(counts[name]);
    const current = quotedOnHomepage(out, figure.label);
    out = out.replace(
      new RegExp(`(<span class="count-n">)[\\d,]+(</span><span class="count-l">${escapeRegExp(figure.label)}</span>)`),
      `$1${wanted}$2`
    );
    // The tree count is also quoted in the page description and the hero copy,
    // where it reads as a sentence rather than a grid cell. Those say the same
    // thing about the same dataset, so they move together.
    if (name === "trees" && current && current !== wanted) {
      out = out.split(current).join(wanted);
    }
  }
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
  const files = [
    { path: root === ROOT ? HOMEPAGE : path.join(root, "index.html"), update: updateHomepage },
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
