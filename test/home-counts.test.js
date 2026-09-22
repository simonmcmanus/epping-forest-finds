/**
 * The homepage quotes dataset sizes as marketing copy. Those numbers drift
 * every time a regeneration script runs -- spec.md's own figures were stale by
 * hundreds before this test existed -- and a public page cannot afford to be
 * caught out by that.
 *
 * So the counts live in the committed index.html (the page works with no build
 * step, which is the point of it) and this test holds them to the real data.
 * When a dataset grows, this fails and the copy gets corrected in the same
 * change. Run `node scripts/count-datasets.js` to see the current values.
 *
 * See spec/spec-marketing.md section 4.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { readCounts, formatCount } = require("../scripts/count-datasets.js");

const ROOT = path.join(__dirname, "..");

function readHomepage() {
  return fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
}

/**
 * Strip the markup when checking headline marketing claims; the structured
 * inventory assertions below inspect its group and subfilter markup directly.
 */
function readHomepageText() {
  return readHomepage()
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

test("every dataset the homepage quotes can still be read", () => {
  const counts = readCounts(ROOT);
  for (const [name, value] of Object.entries(counts)) {
    assert.ok(
      Number.isInteger(value) && value > 0,
      `count for ${name} should be a positive integer, got ${value}`
    );
  }
});

test("the homepage's veteran-tree headline matches the dataset it describes", () => {
  const html = readHomepageText();
  const counts = readCounts(ROOT);
  assert.ok(html.includes(`${formatCount(counts.trees)} veteran trees`));
});

test("the grouped homepage inventory matches the app's map inventory", () => {
  const html = readHomepage();
  const inventory = require("../scripts/report/map-inventory.js").buildInventory(ROOT);
  assert.match(html, new RegExp(`inventory-total[\\s\\S]*?<strong>${formatCount(inventory.total)}</strong>`));
  for (const group of inventory.groups) {
    const block = html.match(new RegExp(`data-inventory-group="${group.key}"([\\s\\S]*?)</section>`));
    assert.ok(block, `the homepage should show the ${group.label} group`);
    assert.ok(block[1].includes(`<strong>${formatCount(group.count)}</strong>`));
    for (const subfilter of group.subfilters) {
      const label = subfilter.label.replace(/&/g, "&amp;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(block[1], new RegExp(`<dt><img[^>]*>${label}</dt><dd>${formatCount(subfilter.count)}</dd>`));
    }
  }
  assert.match(html, new RegExp(`data-inventory-always[\\s\\S]*?<strong>${formatCount(inventory.alwaysShown.count)}</strong>`));
});

/**
 * The test above says when the page is wrong. It took a person reading the
 * failure and editing the copy to make it right again -- which the weekly
 * data run, which changes the food count unattended, could not do. Every data
 * change it proposed therefore arrived with this suite already red.
 * scripts/sync-homepage-counts.js closes that loop, so it has to actually
 * correct a stale page rather than merely notice one.
 */
test("the count sync corrects a homepage that has drifted", () => {
  const { updateHomepage } = require("../scripts/sync-homepage-counts.js");
  const counts = readCounts(ROOT);
  const inventory = require("../scripts/report/map-inventory.js").buildInventory(ROOT);
  const stale = readHomepage().replace(
    /(<dt><img[^>]*>Shops<\/dt><dd>)[\d,]+(<\/dd>)/,
    "$1123$2"
  );

  assert.notStrictEqual(stale, readHomepage(), "the fixture should actually be stale");
  const fixed = updateHomepage(stale, counts, inventory);
  const shops = inventory.groups.find(group => group.key === "food").subfilters.find(item => item.key === "shops");
  assert.ok(
    new RegExp(`<dt><img[^>]*>Shops</dt><dd>${formatCount(shops.count)}</dd>`).test(fixed),
    "sync-homepage-counts.js should put the real shop count back"
  );
  assert.ok(!fixed.includes(">123<"), "the stale number should be gone");
});

test("the count sync corrects the headline total beside its map-pin icon", () => {
  const { updateHomepage } = require("../scripts/sync-homepage-counts.js");
  const counts = readCounts(ROOT);
  const inventory = require("../scripts/report/map-inventory.js").buildInventory(ROOT);
  const stale = readHomepage().replace(
    /(class="inventory-total"><img[^>]*><strong>)[\d,]+(<\/strong>)/,
    "$1123$2"
  );

  assert.notStrictEqual(stale, readHomepage(), "the fixture should actually be stale");
  assert.match(
    updateHomepage(stale, counts, inventory),
    new RegExp(`class="inventory-total"><img[^>]*><strong>${formatCount(inventory.total)}</strong>`)
  );
});

test("the count sync corrects the marketing spec too", () => {
  const { updateMarketingSpec } = require("../scripts/sync-homepage-counts.js");
  const counts = readCounts(ROOT);
  const specPath = path.join(ROOT, "spec", "spec-marketing.md");
  const stale = fs.readFileSync(specPath, "utf8").replace(/[\d,]+( pubs, cafés and shops)/, "123$1");

  const fixed = updateMarketingSpec(stale, counts);
  assert.ok(
    fixed.includes(`${formatCount(counts.food)} pubs, cafés and shops`),
    "spec-marketing.md §3.4 should be brought back in line with the data"
  );
});

test("every quoted count already matches -- sync is a no-op on a clean tree", () => {
  // If this fails, either the committed copy has drifted (run
  // `node scripts/sync-homepage-counts.js`) or the sync script's anchors no
  // longer find the numbers, which would make it silently stop working.
  const { sync } = require("../scripts/sync-homepage-counts.js");
  const { stale } = sync({ check: true });
  assert.deepStrictEqual(stale, [], `these files quote a stale count: ${stale.join(", ")}`);
});

test("the homepage does not quote a stale tree count", () => {
  const html = readHomepageText();
  const { trees } = readCounts(ROOT);
  const quoted = html.match(/([\d,]+)\s+veteran trees/);

  assert.ok(quoted, "index.html should state a veteran tree count");
  assert.strictEqual(
    quoted[1],
    formatCount(trees),
    "the veteran tree count in index.html has drifted from data/trees/index.json"
  );
});
