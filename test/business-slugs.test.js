/**
 * data/business-slugs.json is committed (not build-time output -- see its own header comment
 * and .gitignore) because the live app, the Ledger renderer and the page generator all read it
 * directly. That means it can go stale the same way the homepage's counts can: a landmark regen
 * or a weekly business-watch merge changes the underlying data but nobody remembers to also run
 * `npm run regen:business-slugs`. This test holds the committed file to a fresh rebuild of it,
 * the same drift-detection pattern as test/home-counts.test.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildIndex, slugify, dedupeSlugs, outwardPostcode, OUTPUT_PATH } = require("../scripts/regenerate-business-slugs.js");

test("the committed data/business-slugs.json matches a fresh rebuild from the current data", () => {
  const committed = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  const fresh = buildIndex();
  assert.deepEqual(
    committed.entries,
    fresh.entries,
    "data/business-slugs.json is stale -- run `npm run regen:business-slugs` and commit the result"
  );
});

test("slugify lowercases, hyphenates and strips punctuation", () => {
  assert.equal(slugify("The Forresters"), "the-forresters");
  assert.equal(slugify("A&S Grocers"), "a-and-s-grocers");
  assert.equal(slugify("Caffè Nero"), "caff-nero");
});

test("outwardPostcode reads the outward code from a UK address", () => {
  assert.equal(outwardPostcode("45-47 Station Road, London E4 7BJ"), "E4");
  assert.equal(outwardPostcode("275 High Street, Epping CM16 4DA"), "CM16");
  assert.equal(outwardPostcode(null), null);
  assert.equal(outwardPostcode("High Street, Epping"), null);
});

test("dedupeSlugs gives distinct items their plain slug", () => {
  const result = dedupeSlugs([{ name: "The Forresters", address: null, id: "node/1" }]);
  assert.equal(result[0].slug, "the-forresters");
});

test("dedupeSlugs disambiguates a name collision by postcode when that's unique per branch", () => {
  const result = dedupeSlugs([
    { name: "Costa", address: "1 High St, London E4 1AA", id: "node/1" },
    { name: "Costa", address: "2 High St, London E11 2BB", id: "node/2" },
  ]);
  assert.deepEqual(result.map((r) => r.slug).sort(), ["costa-e11", "costa-e4"]);
});

test("dedupeSlugs falls back to a numeric suffix when nothing else disambiguates", () => {
  const result = dedupeSlugs([
    { name: "Boots", address: "Boots, Leytonstone, London, E11 1HQ", id: "manual/boots" },
    { name: "Boots", address: "Boots, Wanstead, London, E11 2AE", id: "manual/boots" },
  ]);
  const slugs = result.map((r) => r.slug).sort();
  assert.deepEqual(slugs, ["boots", "boots-2"]);
});

test("no two entries in the real index ever share a slug", () => {
  const { entries } = buildIndex();
  const seen = new Set();
  for (const entry of entries) {
    assert.ok(!seen.has(entry.slug), `duplicate slug "${entry.slug}"`);
    seen.add(entry.slug);
  }
});

test("every entry belongs to the confirmed /find/ scope (food + locations), never trees/transport/history/stories", () => {
  const { entries } = buildIndex();
  const allowedGroups = new Set(["food", "locations"]);
  for (const entry of entries) {
    assert.ok(allowedGroups.has(entry.groupKey), `"${entry.name}" (${entry.key}) is in group "${entry.groupKey}", outside scope`);
  }
});

test("no entry is unnamed -- a place with no name is skipped rather than given an empty slug", () => {
  const { entries } = buildIndex();
  for (const entry of entries) {
    assert.ok(entry.name && entry.name.trim().length > 0);
  }
});
