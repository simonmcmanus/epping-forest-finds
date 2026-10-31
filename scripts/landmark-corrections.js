// Use the app's classification rules when generating its offline data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { osmPlaqueProperties } = vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../js/categories.js'), 'utf8') + '\n;({ osmPlaqueProperties });'
);
function loadCorrections(dataDir) {
  const file = path.join(dataDir, 'landmark-corrections.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).corrections : {};
}
function correctedProperties(properties, tags, corrections) {
  const result = { ...properties };
  for (const key of ['memorial', 'memorial:type', 'colour']) if (tags[key] != null) result[key] = tags[key];
  Object.assign(result, corrections[properties.id]?.properties || {});
  return { ...result, ...osmPlaqueProperties(result) };
}
module.exports = { loadCorrections, correctedProperties };
