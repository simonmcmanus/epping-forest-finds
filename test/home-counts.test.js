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
 * The counts are marked up (`<strong>24,906</strong> veteran trees`, or a
 * number span beside a label span), so the assertions read the page as a
 * visitor sees it rather than as markup.
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

test("the homepage's headline counts match the datasets they describe", () => {
  const html = readHomepageText();
  const counts = readCounts(ROOT);

  for (const [name, value] of Object.entries(counts)) {
    const formatted = formatCount(value);
    assert.ok(
      html.includes(formatted),
      `index.html should quote ${formatted} for ${name} but does not. ` +
        `The dataset has changed size -- update the homepage copy (and spec-marketing.md section 4) to match.`
    );
  }
});

test("the detailed map key counts match the features behind the app legend", () => {
  const html = readHomepage();
  const inventory = require("../scripts/report/map-inventory.js").buildInventory(ROOT);
  const environment = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "local-environment.geojson"), "utf8")
  );
  const environmentCounts = environment.features.reduce((counts, feature) => {
    const key = feature.properties && feature.properties.featureType;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const subfilters = Object.fromEntries(
    inventory.groups.flatMap(group => group.subfilters.map(item => [item.key, item.count]))
  );
  const groups = Object.fromEntries(inventory.groups.map(group => [group.key, group.count]));
  const expected = {
    trees: subfilters.trees,
    hydrology: (environmentCounts.hydrology_line || 0) + (environmentCounts.hydrology_area || 0),
    "nature-designations": environmentCounts.nature_designation || 0,
    "gardens-parks": environmentCounts.garden || 0,
    paths: readCounts(ROOT).paths,
    pubs: subfilters.pubs,
    restaurants: subfilters.restaurants,
    cafes: subfilters.cafes,
    trains: subfilters.underground + subfilters.national_rail,
    buses: subfilters.bus,
    parking: subfilters.parking,
    locations: groups.locations,
    plaques: subfilters.plaques,
    history: groups.history,
    legends: subfilters.legends,
  };

  for (const [key, count] of Object.entries(expected)) {
    const item = html.match(new RegExp(`data-map-key="${key}"[\\s\\S]*?<strong>([\\d,]+)</strong>`));
    assert.ok(item, `the homepage should show a count for ${key}`);
    assert.strictEqual(item[1], formatCount(count), `${key} should match the map dataset`);
  }
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
  const stale = readHomepage().replace(
    /(<span class="count-n">)[\d,]+(<\/span><span class="count-l">pubs)/,
    "$1123$2"
  );

  assert.notStrictEqual(stale, readHomepage(), "the fixture should actually be stale");
  const fixed = updateHomepage(stale, counts);
  assert.ok(
    fixed.includes(`<span class="count-n">${formatCount(counts.food)}</span><span class="count-l">pubs`),
    "sync-homepage-counts.js should put the real food count back"
  );
  assert.ok(!fixed.includes(">123<"), "the stale number should be gone");
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
