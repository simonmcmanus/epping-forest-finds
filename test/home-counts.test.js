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
