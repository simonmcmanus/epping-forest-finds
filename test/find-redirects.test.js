// Places merged as duplicates keep their old /find/<slug>/ addresses as 301s.
// Two invariants across files: every redirect lands on a page that exists, and
// no redirect hides a page that is still live.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
const slugs = new Set(JSON.parse(fs.readFileSync(path.join(root, "data/business-slugs.json"), "utf8")).entries.map((e) => e.slug));

const findRedirects = [];
for (const block of toml.split("[[redirects]]").slice(1)) {
  const from = /from\s*=\s*"\/find\/([^"]+)\/"/.exec(block);
  const to = /to\s*=\s*"\/find\/([^"]+)\/"/.exec(block);
  if (from && to) findRedirects.push({ from: from[1], to: to[1] });
}

test("every /find/ redirect for a merged place lands on a live place page", () => {
  assert.ok(findRedirects.length > 0, "the merge left redirects behind");
  for (const { from, to } of findRedirects) {
    assert.ok(slugs.has(to), `${from} redirects to ${to}, which has no page`);
  }
});

test("no /find/ redirect hides a place page that is still live", () => {
  for (const { from } of findRedirects) {
    assert.ok(!slugs.has(from), `${from} is redirected but still has its own page`);
  }
});
