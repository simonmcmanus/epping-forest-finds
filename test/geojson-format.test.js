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
