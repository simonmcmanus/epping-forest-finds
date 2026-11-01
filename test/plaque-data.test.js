const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ projectLonLat: (x, y) => ({ x, y }) });
for (const file of ['categories', 'normalize']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file + '.js'), 'utf8'), ctx);

test('OSM plaque subtypes decide the pin and Plaques filter ahead of memorial', () => {
  for (const [tags, expected] of [
    [{ memorial: 'blue_plaque' }, 'blue-plaques'],
    [{ memorial: 'plaque', colour: 'blue' }, 'blue-plaques'],
    [{ 'memorial:type': 'plaque' }, 'plaques'],
    [{ memorial: 'plaque', colour: 'bronze' }, 'plaques'],
    [{ memorial: 'statue', colour: 'blue' }, 'landmark-memorial'],
  ]) {
    const place = { category: 'memorial', historic: 'memorial', ...tags };
    place.categoryTags = ctx.buildOsmCategoryTags(place);
    assert.equal(ctx.placeIconSlug(place), expected);
    assert.equal(ctx.matchesPlaceFilter(place, 'plaques'), expected !== 'landmark-memorial');
  }
});

test('explicitly linked plaques combine OSM location with curated history in either arrival order', () => {
  const folklore = ctx.normalizeFolkloreLocations({ locations: [{
    id: 'folklore-42', osm_id: 'node/42', name: 'Blue Plaque: A Writer', category: ['blue plaque'],
    coordinates: { latitude: 51.649, longitude: 0.0495 }, story: 'A writer lived here.',
  }] });
  folklore[0].findSlug = 'blue-plaque-a-writer';
  const osm = { findSlug: null, id: 'node/42', name: 'A Writer', category: 'memorial', latitude: 51.6487, longitude: 0.0522, point: { x: 1, y: 2 }, categoryTags: ['memorial'] };
  for (const records of [[...folklore, osm], [osm, ...folklore]]) {
    const merged = ctx.reconcileLinkedLandmarks(records);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'node/42');
    assert.equal(merged[0].findSlug, 'blue-plaque-a-writer');
    assert.equal(merged[0].latitude, 51.6487);
    assert.equal(merged[0].longitude, 0.0522);
    assert.equal(merged[0].folkloreSummary, 'A writer lived here.');
    assert.equal(merged[0].categoryLabel, 'Blue plaque');
    assert.equal(ctx.placeIconSlug(merged[0]), 'blue-plaques');
    assert.ok(merged[0].aliasIds.includes('folklore-42'));
    assert.equal(ctx.reconcileLinkedLandmarks([...merged, { id: 'node/99', name: 'A Writer' }]).length, 2);
  }
});

const { auditPlaques, loadData } = require('../scripts/audit-plaques');
test('the plaque audit flags an unlinked classification conflict without merging it', () => {
  const result = auditPlaques({
    features: [{ properties: { id: 'node/1', name: 'A Writer', category: 'memorial' }, geometry: { coordinates: [0.05, 51.65] } }],
    locations: [{ name: 'Blue Plaque: A Writer', category: ['blue plaque'], coordinates: { longitude: 0.05, latitude: 51.65, accuracy: 'street/area approximate' } }],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].osmId, 'node/1');
  assert.equal(result.summary.uncertainCoordinates, 1);
  assert.equal(result.summary.linkedPlaques, 0);
});
test('the plaque audit rejects an overwritten correction and a broken source link', () => {
  const result = auditPlaques({
    features: [{ properties: { id: 'node/1', category: 'memorial', categoryLabel: 'Memorial' }, geometry: { coordinates: [0.05, 51.65] } }],
    locations: [{ id: 'folklore-1', osm_id: 'node/99', name: 'Blue Plaque: A Writer', category: ['blue plaque'] }],
    corrections: { 'node/1': { properties: { memorial: 'blue_plaque' }, source: 'https://example.org', verifiedOn: '2026-10-31' } },
  });
  assert.ok(result.errors.some(e => e.includes('saved correction not applied')));
  assert.ok(result.errors.some(e => e.includes('linked OSM record missing')));
});
test('shipped plaque corrections and explicit source links agree', () => {
  assert.deepEqual(auditPlaques(loadData()).errors, []);
});

test('a linked plaque remains usable when either source is unavailable', () => {
  const curated = ctx.normalizeFolkloreLocations({ locations: [{ id: 'folklore-7', osm_id: 'node/7', name: 'Blue Plaque: A Writer', category: ['blue plaque'], coordinates: { latitude: 51.65, longitude: 0.05 } }] });
  const fallback = ctx.reconcileLinkedLandmarks(curated);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].id, 'node/7');
  assert.equal(fallback[0].latitude, 51.65);
  assert.ok(fallback[0].aliasIds.includes('folklore-7'));
  const osm = { id: 'node/7', category: 'memorial', memorial: 'blue_plaque', latitude: 51.65, longitude: 0.05 };
  const osmOnly = ctx.reconcileLinkedLandmarks([osm]);
  assert.equal(osmOnly.length, 1);
  assert.equal(ctx.placeIconSlug(osmOnly[0]), 'blue-plaques');
  assert.equal(ctx.reconcileLinkedLandmarks([{ id: 'node/1', name: 'A Writer' }, { id: 'folklore-1', name: 'A Writer' }]).length, 2);
});

test('the audit accepts an explicitly linked ordinary plaque with matching classification', () => {
  const result = auditPlaques({
    features: [{ properties: { id: 'node/3', aliasIds: ['folklore-3'], category: 'plaque', memorial: 'plaque' }, geometry: { coordinates: [0.05, 51.65] } }],
    locations: [{ id: 'folklore-3', osm_id: 'node/3', name: 'Plaque: A Writer', category: ['plaque'], coordinates: { latitude: 51.65, longitude: 0.05 } }],
  });
  assert.deepEqual(result.errors, []);
});

test('reviewed OSM data retains curated aliases when the curated download is unavailable', () => {
  const data = loadData();
  for (const curated of data.locations.filter(p => p.osm_id)) {
    const feature = data.features.find(f => f.properties.id === curated.osm_id);
    const available = ctx.reconcileLinkedLandmarks([feature.properties]);
    assert.ok(available[0].aliasIds?.includes(curated.id), curated.name);
  }
});
