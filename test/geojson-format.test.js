// scripts/geojson-format.js: the one-feature-per-line format the large generated datasets are written in.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { stringifyFeatureLines } = require("../scripts/geojson-format");

const collection = {
  type: "FeatureCollection",
  name: "Épping test",
  features: [
    { type: "Feature", id: "way/1", geometry: { type: "Point", coordinates: [0.0123456, 51.654321] }, properties: { name: "Oak" } },
    { type: "Feature", id: "way/2", geometry: { type: "LineString", coordinates: [[0, 51], [0.1, 51.1]] }, properties: {} },
  ],
};

test("a dataset written one feature per line reads back as the same collection", () => {
  assert.deepEqual(JSON.parse(stringifyFeatureLines(collection)), collection);
});

test("each feature sits on its own line, so a regenerated dataset diffs per feature", () => {
  const lines = stringifyFeatureLines(collection).trimEnd().split("\n");
  assert.equal(lines.length, 2 + collection.features.length);
  assert.deepEqual(JSON.parse(lines[1].replace(/,$/, "")), collection.features[0]);
});

test("the format is much smaller than pretty-printed JSON", () => {
  assert.ok(stringifyFeatureLines(collection).length < JSON.stringify(collection, null, 2).length * 0.7);
});

// A property of the shipped data, not of any code: the six large datasets every first visit downloads
// stay in the compact format, so a regeneration that slips back to pretty-printing is caught here.
test("the large shipped map datasets are stored one feature per line", () => {
  const fs = require("fs");
  const path = require("path");
  for (const name of ["local-environment", "local-roads", "local-paths", "local-environment-buildings", "epping-forest-land", "epping-buffer-land"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", "data", `${name}.geojson`), "utf8");
    const lines = text.trimEnd().split("\n");
    const { features } = JSON.parse(text);
    assert.equal(lines.length, features.length + 2, `${name}.geojson has one line per feature`);
  }
});
