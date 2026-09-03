const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const QUERY_PATH = path.join(DATA_DIR, "local-paths.overpassql");
const OVERPASS_JSON_PATH = path.join(DATA_DIR, "local-paths.overpass.json");
const GEOJSON_PATH = path.join(DATA_DIR, "local-paths.geojson");
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

function postOverpass(queryText) {
  const tryEndpoint = (endpoint) => new Promise((resolve, reject) => {
    const req = https.request(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Length": Buffer.byteLength(queryText),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Overpass HTTP ${res.statusCode}: ${body.slice(0, 400)}`));
            return;
          }
          resolve(body);
        });
      }
    );

    req.on("error", reject);
    req.write(queryText);
    req.end();
  });

  return (async () => {
    let lastError = null;
    for (const endpoint of OVERPASS_URLS) {
      try {
        return await tryEndpoint(endpoint);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Failed to fetch Overpass data.");
  })();
}

function classifyPath(tags = {}) {
  const highway = tags.highway || null;
  const designation = String(tags.designation || "").toLowerCase();
  const foot = tags.foot || null;
  const horse = tags.horse || null;
  const access = tags.access || null;
  if (
    highway === "bridleway"
    || designation.includes("bridleway")
    || horse === "designated"
  ) {
    return "bridleway";
  }
  if (designation.includes("byway") || highway === "byway") return "byway";
  if (access === "permissive" || foot === "permissive" || horse === "permissive") return "permissive";
  if (tags["osmc:symbol"] || tags.trail_visibility) return "waymarked_trail";
  if (highway === "cycleway") return "cycleway";
  if (highway === "footway") return "footway";
  if (highway === "track") return "track";
  return "trail";
}

function toFeature(element) {
  if (element.type !== "way") return null;
  const tags = element.tags || {};
  const geometry = Array.isArray(element.geometry) ? element.geometry : null;
  if (!geometry || geometry.length < 2) return null;

  const coordinates = geometry
    .map((coord) => [Number(coord.lon), Number(coord.lat)])
    .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));

  if (coordinates.length < 2) return null;

  return {
    type: "Feature",
    id: `${element.type}/${element.id}`,
    geometry: {
      type: "LineString",
      coordinates,
    },
    properties: {
      id: `${element.type}/${element.id}`,
      osmType: element.type,
      osmId: element.id,
      name: tags.name || null,
      ref: tags.ref || null,
      highway: tags.highway || null,
      designation: tags.designation || null,
      foot: tags.foot || null,
      horse: tags.horse || null,
      bicycle: tags.bicycle || null,
      surface: tags.surface || null,
      osmcSymbol: tags["osmc:symbol"] || null,
      trailVisibility: tags.trail_visibility || null,
      pathType: classifyPath(tags),
    },
  };
}

// Converts one raw Overpass response into this app's paths GeoJSON. Deliberately keeps every
// walkable way regardless of whether it has a `name` tag -- most real footpaths (especially
// official Public Rights of Way, tagged designation=public_footpath + prow_ref rather than name)
// have no name at all, and js/routing.js routes across this same file, so dropping unnamed ways
// doesn't just declutter the map, it deletes real shortcuts from the walking router. (A one-off
// script, scripts/remove_unnamed_trails.py, did exactly that to data/local-paths.geojson on
// 2026-05-20 -- see git history and /routing-pedestrian-bias.md in project memory. That script
// is gone; don't recreate it. If unnamed trails ever need hiding for visual clarity, do it at
// render time in js/renderer.js, keyed on `pathType`/`name`, not by deleting them here.)
function buildGeoJson(raw) {
  const parsed = JSON.parse(raw);
  const deduped = new Map();
  for (const element of parsed.elements || []) {
    const feature = toFeature(element);
    if (!feature) continue;
    deduped.set(feature.properties.id, feature);
  }

  return {
    type: "FeatureCollection",
    name: "Epping Forest paths and bridleways",
    generatedAt: new Date().toISOString(),
    source: {
      name: "OpenStreetMap via Overpass API",
      license: "Open Data Commons Open Database License (ODbL)",
      queryFile: "data/local-paths.overpassql",
      bbox: [-0.035, 51.545, 0.145, 51.745],
    },
    features: Array.from(deduped.values()),
  };
}

async function main() {
  const fromCache = process.argv.includes("--from-cache");

  let raw;
  if (fromCache) {
    if (!fs.existsSync(OVERPASS_JSON_PATH)) {
      throw new Error(`${OVERPASS_JSON_PATH} does not exist -- run without --from-cache first.`);
    }
    raw = fs.readFileSync(OVERPASS_JSON_PATH, "utf8");
  } else {
    const queryText = fs.readFileSync(QUERY_PATH, "utf8");
    raw = await postOverpass(queryText);
    fs.writeFileSync(OVERPASS_JSON_PATH, raw);
  }

  const geojson = buildGeoJson(raw);
  fs.writeFileSync(GEOJSON_PATH, JSON.stringify(geojson, null, 2) + "\n");

  const counts = {};
  for (const feature of geojson.features) {
    const key = feature.properties.pathType || "trail";
    counts[key] = (counts[key] || 0) + 1;
  }
  const unnamed = geojson.features.filter((f) => !f.properties.name).length;

  console.log(`Wrote ${geojson.features.length} path features (${unnamed} unnamed) to ${path.relative(ROOT, GEOJSON_PATH)}`);
  console.log("Path type counts:");
  Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .forEach((key) => {
      console.log(`  ${key}: ${counts[key]}`);
    });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
