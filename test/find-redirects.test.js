// Places merged as duplicates or renamed keep their old /find/<slug>/ addresses as 301s.
// Invariants across files: every redirect lands on a page that exists, the page is the same place
// as the one the old address showed, and no redirect hides a page that is still live.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
const entries = JSON.parse(fs.readFileSync(path.join(root, "data/business-slugs.json"), "utf8")).entries;
const bySlug = new Map(entries.map((e) => [e.slug, e]));

function metresBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Each redirect block is preceded by "# was <record id> at <lat>,<lon>" naming the removed place.
const findRedirects = [];
const blocks = toml.split("[[redirects]]").slice(1);
const headers = toml.split("[[redirects]]").slice(0, -1).map((chunk) => chunk.split("\n").filter((l) => l.startsWith("# was ")).pop());
blocks.forEach((block, i) => {
  const from = /from\s*=\s*"\/find\/([^"]+)\/"/.exec(block);
  const to = /to\s*=\s*"\/find\/([^"]+)\/"/.exec(block);
  const was = /^# was (\S+) at (-?[\d.]+),(-?[\d.]+)$/.exec(headers[i] || "");
  if (from && to) findRedirects.push({ from: from[1], to: to[1], was: was && { id: was[1], lat: Number(was[2]), lon: Number(was[3]) } });
});

test("every /find/ redirect for a merged or renamed place lands on a live place page", () => {
  assert.ok(findRedirects.length > 0, "the merge left redirects behind");
  for (const { from, to } of findRedirects) {
    assert.ok(bySlug.has(to), `${from} redirects to ${to}, which has no page`);
  }
});

test("every /find/ redirect lands on the same place the old address showed, within 100 metres", () => {
  for (const { from, to, was } of findRedirects) {
    assert.ok(was, `${from} has no record of the place it replaced`);
    const target = bySlug.get(to);
    assert.ok(metresBetween(was, target) < 100, `${from} (${was.id}) redirects to ${to}, which is ${Math.round(metresBetween(was, target))}m away`);
  }
});

test("no /find/ redirect hides a place page that is still live", () => {
  for (const { from } of findRedirects) {
    assert.ok(!bySlug.has(from), `${from} is redirected but still has its own page`);
  }
});
