const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SOURCE_PATH = path.join(ROOT, "Veteran_Tree_Register.json");
const OUT_DIR = path.join(ROOT, "data", "trees");
const INDEX_PATH = path.join(OUT_DIR, "index.json");
const TILE_SIZE_DEGREES = 0.01;

function tileKey(latitude, longitude) {
  const latTile = Math.floor(latitude / TILE_SIZE_DEGREES);
  const lonTile = Math.floor(longitude / TILE_SIZE_DEGREES);
  return `lat${latTile}_lon${lonTile}`;
}

function emptyBounds() {
  return {
    minLat: Infinity,
    maxLat: -Infinity,
    minLon: Infinity,
    maxLon: -Infinity,
  };
}

function expandBounds(bounds, latitude, longitude) {
  bounds.minLat = Math.min(bounds.minLat, latitude);
  bounds.maxLat = Math.max(bounds.maxLat, latitude);
  bounds.minLon = Math.min(bounds.minLon, longitude);
  bounds.maxLon = Math.max(bounds.maxLon, longitude);
}

function roundedBounds(bounds) {
  return {
    minLat: Number(bounds.minLat.toFixed(7)),
    maxLat: Number(bounds.maxLat.toFixed(7)),
    minLon: Number(bounds.minLon.toFixed(7)),
    maxLon: Number(bounds.maxLon.toFixed(7)),
  };
}

function treeCoordinates(tree) {
  const wgs84 = tree && tree.location && tree.location.wgs84;
  const latitude = Number(wgs84 && wgs84.latitude);
  const longitude = Number(wgs84 && wgs84.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function main() {
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
  const buckets = new Map();
  const globalBounds = emptyBounds();

  for (const tree of source.trees || []) {
    const coords = treeCoordinates(tree);
    if (!coords) continue;
    const key = tileKey(coords.latitude, coords.longitude);
    if (!buckets.has(key)) {
      buckets.set(key, { key, trees: [], bounds: emptyBounds() });
    }
    const bucket = buckets.get(key);
    bucket.trees.push(tree);
    expandBounds(bucket.bounds, coords.latitude, coords.longitude);
    expandBounds(globalBounds, coords.latitude, coords.longitude);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const fileName of fs.readdirSync(OUT_DIR)) {
    if (/^(chunk-|index\.json)/.test(fileName)) {
      fs.unlinkSync(path.join(OUT_DIR, fileName));
    }
  }

  const chunks = Array.from(buckets.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => {
      const fileName = `chunk-${bucket.key}.json`;
      const chunk = {
        dataset: source.dataset,
        chunkKey: bucket.key,
        count: bucket.trees.length,
        bounds: roundedBounds(bucket.bounds),
        trees: bucket.trees,
      };
      fs.writeFileSync(path.join(OUT_DIR, fileName), `${JSON.stringify(chunk)}\n`);
      return {
        key: bucket.key,
        url: `data/trees/${fileName}`,
        count: bucket.trees.length,
        bounds: chunk.bounds,
      };
    });

  const index = {
    dataset: source.dataset,
    sourceFiles: source.sourceFiles,
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: source.generatedAt,
    recordCount: chunks.reduce((sum, chunk) => sum + chunk.count, 0),
    encoding: source.encoding,
    coordinateReferenceSystem: source.coordinateReferenceSystem,
    fields: source.fields,
    tileSizeDegrees: TILE_SIZE_DEGREES,
    bounds: roundedBounds(globalBounds),
    chunks,
  };

  fs.writeFileSync(INDEX_PATH, `${JSON.stringify(index)}\n`);
  console.log(`Wrote ${chunks.length} tree chunks for ${index.recordCount.toLocaleString()} records.`);
}

main();
