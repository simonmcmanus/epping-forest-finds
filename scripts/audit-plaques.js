#!/usr/bin/env node
// Cross-source conflicts are review candidates, never automatic identity matches.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { correctedProperties } = require('./landmark-corrections');
const ROOT = path.join(__dirname, '..');
const rules = vm.createContext({ projectLonLat: (x, y) => ({ x, y }) });
for (const file of ['categories', 'normalize']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), rules);
const nameKey = name => String(name || '').toLowerCase().replace(/^blue plaque:\s*/, '').replace(/\b(sir|dame|dr|revd)\.?\s+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function auditPlaques({ features, locations, corrections = {} }) {
  const errors = [], warnings = [], candidates = [];
  const byId = new Map(features.map(f => [f.properties.id, f]));
  const linked = new Set();
  const plaques = locations.filter(p => rules.classifyFolkloreCategory(p) === 'plaque');
  for (const [id, correction] of Object.entries(corrections)) {
    if (!correction.source || !/^\d{4}-\d{2}-\d{2}$/.test(correction.verifiedOn || '')) errors.push(`${id}: correction lacks source/date`);
    const feature = byId.get(id);
    if (!feature) { errors.push(`${id}: corrected OSM record missing`); continue; }
    const expected = correctedProperties(feature.properties, {}, corrections);
    for (const key of new Set([...Object.keys(correction.properties || {}), 'category', 'categoryLabel'])) {
      if (feature.properties[key] !== expected[key]) errors.push(`${id}: saved correction not applied to ${key}`);
    }
  }
  for (const plaque of plaques) {
    if (!plaque.osm_id) {
      if (/approximate|centroid/i.test(plaque.coordinates?.accuracy || '')) warnings.push(`${plaque.name}: approximate coordinates`);
      const keys = [plaque.name, plaque.plaque?.subject, ...(plaque.aliases || [])].map(nameKey).filter(Boolean);
      for (const feature of features) {
        const p = feature.properties;
        if (!['memorial', 'monument', 'plaque'].includes(p.category) || !keys.includes(nameKey(p.name))) continue;
        const coords = rules.parseFolkloreCoordinates(plaque.coordinates);
        if (!coords) continue;
        const [lon, lat] = feature.geometry.coordinates;
        const gap = rules.distanceMetres(lat, lon, coords.latitude, coords.longitude);
        if (gap <= 1000) candidates.push({ plaque: plaque.name, osmId: p.id, category: p.category, metresApart: Math.round(gap) });
      }
      continue;
    }
    if (!plaque.id) errors.push(`${plaque.name}: linked record needs a stable curated ID`);
    if (linked.has(plaque.osm_id)) errors.push(`${plaque.osm_id}: more than one curated plaque linked`);
    linked.add(plaque.osm_id);
    const feature = byId.get(plaque.osm_id);
    if (!feature) { errors.push(`${plaque.osm_id}: linked OSM record missing`); continue; }
    const place = { ...feature.properties, categoryTags: rules.buildOsmCategoryTags(feature.properties) };
    if (rules.placeIconSlug(place) !== 'blue-plaques') errors.push(`${plaque.osm_id}: blue plaque still displays with a different icon`);
    const coords = rules.parseFolkloreCoordinates(plaque.coordinates);
    if (!coords || coords.longitude !== feature.geometry.coordinates[0] || coords.latitude !== feature.geometry.coordinates[1]) errors.push(`${plaque.osm_id}: linked source coordinates disagree`);
  }
  return { summary: { curatedPlaques: plaques.length, linkedPlaques: linked.size, uncertainCoordinates: warnings.length, reviewCandidates: candidates.length }, errors, warnings, candidates };
}
function loadData(root = ROOT) {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8'));
  return {
    features: fs.readdirSync(path.join(root, 'data')).filter(file => /^local-landmarks-.*\.geojson$/.test(file)).flatMap(file => read(file).features),
    locations: read('epping_forest_folklore_locations.json').locations,
    corrections: read('landmark-corrections.json').corrections,
  };
}
if (require.main === module) {
  const result = auditPlaques(loadData());
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes('--check') && result.errors.length) process.exitCode = 1;
}
module.exports = { auditPlaques, loadData };
