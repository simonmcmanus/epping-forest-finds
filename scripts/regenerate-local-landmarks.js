const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const QUERY_PATH = path.join(DATA_DIR, "local-landmarks.overpassql");
const OVERPASS_JSON_PATH = path.join(DATA_DIR, "local-landmarks.overpass.json");
const GEOJSON_PATH = path.join(DATA_DIR, "local-landmarks.geojson");
const FOREST_BOUNDARY_PATH = path.join(DATA_DIR, "epping-forest-land.geojson");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const WALKING_SPEED_M_PER_MIN = 3500 / 60;
const MAX_WALK_MINUTES_FROM_BOUNDARY = 8;
const MAX_DISTANCE_FROM_BOUNDARY_METRES = WALKING_SPEED_M_PER_MIN * MAX_WALK_MINUTES_FROM_BOUNDARY;

function postOverpass(queryText) {
  return new Promise((resolve, reject) => {
    const requestBody = `data=${encodeURIComponent(queryText)}`;
    const req = https.request(
      OVERPASS_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          "Content-Length": Buffer.byteLength(requestBody),
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
    req.write(requestBody);
    req.end();
  });
}

function categoryLabel(key) {
  const labels = {
    pub: "Pub",
    bar: "Bar",
    cafe: "Café",
    tea: "Tea Hut",
    parking: "Car Park",
    toilets: "Toilets",
    bicycle_parking: "Cycle Parking",
    bench: "Bench",
    drinking_water: "Drinking Water",
    bus_station: "Bus Station",
    bus_stop: "Bus Stop",
    taxi: "Taxi",
    train_station: "Train Station",
    station: "Train Station",
    halt: "Rail Halt",
    tram_stop: "Tram Stop",
    gate: "Gate",
    stile: "Stile",
    kissing_gate: "Kissing Gate",
    cattle_grid: "Cattle Grid",
    lift_gate: "Lift Gate",
    swing_gate: "Swing Gate",
    cycle_barrier: "Cycle Barrier",
    entrance: "Entrance",
    attraction: "Attraction",
    viewpoint: "Viewpoint",
    museum: "Museum",
    picnic_site: "Picnic Site",
    information: "Information",
    camp_site: "Camp Site",
    caravan_site: "Caravan Site",
    historic: "Historic Site",
    monument: "Monument",
    archaeological_site: "Archaeological Site",
    memorial: "Memorial",
    ruins: "Ruins",
    castle: "Castle",
  };
  return labels[key] || String(key || "place").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function polygonRings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") {
    const rings = [];
    for (const polygon of geometry.coordinates) {
      if (Array.isArray(polygon)) rings.push(...polygon);
    }
    return rings;
  }
  return [];
}

function loadBoundarySegments() {
  const data = JSON.parse(fs.readFileSync(FOREST_BOUNDARY_PATH, "utf8"));
  const features = Array.isArray(data && data.features) ? data.features : [];
  const segments = [];
  for (const feature of features) {
    const rings = polygonRings(feature && feature.geometry);
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      for (let i = 1; i < ring.length; i += 1) {
        const a = ring[i - 1];
        const b = ring[i];
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;
        segments.push([Number(a[0]), Number(a[1]), Number(b[0]), Number(b[1])]);
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (Array.isArray(first) && Array.isArray(last) && first.length >= 2 && last.length >= 2) {
        if (first[0] !== last[0] || first[1] !== last[1]) {
          segments.push([Number(last[0]), Number(last[1]), Number(first[0]), Number(first[1])]);
        }
      }
    }
  }
  return segments;
}

function toLocalXY(lon, lat, refLatRad) {
  return {
    x: lon * 111320 * Math.cos(refLatRad),
    y: lat * 110574,
  };
}

function pointToSegmentDistanceMetres(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq <= 1e-12) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * abx + (py - ay) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

function nearestBoundaryDistanceMetres(lon, lat, segments, refLatRad) {
  const point = toLocalXY(lon, lat, refLatRad);
  let best = Infinity;
  for (const [lon1, lat1, lon2, lat2] of segments) {
    const a = toLocalXY(lon1, lat1, refLatRad);
    const b = toLocalXY(lon2, lat2, refLatRad);
    const distance = pointToSegmentDistanceMetres(point.x, point.y, a.x, a.y, b.x, b.y);
    if (distance < best) best = distance;
  }
  return best;
}

function toFeature(element, boundarySegments, refLatRad) {
  const tags = element.tags || {};
  const longitude = typeof element.lon === "number" ? element.lon : element.center && element.center.lon;
  const latitude = typeof element.lat === "number" ? element.lat : element.center && element.center.lat;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const boundaryDistanceMetres = nearestBoundaryDistanceMetres(longitude, latitude, boundarySegments, refLatRad);
  if (boundaryDistanceMetres > MAX_DISTANCE_FROM_BOUNDARY_METRES) return null;

  const category = tags.amenity
    || tags.barrier
    || (tags.entrance ? "entrance" : null)
    || tags.railway
    || tags.highway
    || tags.tourism
    || tags.historic
    || (tags.heritage ? "historic" : null)
    || "place";
  const address = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    [tags["addr:city"], tags["addr:postcode"]].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ") || null;

  return {
    type: "Feature",
    id: `${element.type}/${element.id}`,
    geometry: {
      type: "Point",
      coordinates: [longitude, latitude],
    },
    properties: {
      id: `${element.type}/${element.id}`,
      osmType: element.type,
      osmId: element.id,
      name: tags.name || null,
      category,
      categoryLabel: categoryLabel(category),
      amenity: tags.amenity || null,
      tourism: tags.tourism || null,
      historic: tags.historic || null,
      railway: tags.railway || null,
      barrier: tags.barrier || null,
      entrance: tags.entrance || null,
      heritage: tags.heritage || null,
      website: tags.website || tags["contact:website"] || null,
      phone: tags.phone || tags["contact:phone"] || null,
      address,
      distanceToForestBoundaryMetres: Math.round(boundaryDistanceMetres * 10) / 10,
    },
  };
}

async function main() {
  const queryText = fs.readFileSync(QUERY_PATH, "utf8");
  const raw = await postOverpass(queryText);
  fs.writeFileSync(OVERPASS_JSON_PATH, raw);

  const parsed = JSON.parse(raw);
  const boundarySegments = loadBoundarySegments();
  if (!boundarySegments.length) {
    throw new Error(`No usable boundary segments in ${FOREST_BOUNDARY_PATH}`);
  }
  const latValues = boundarySegments.flatMap((segment) => [segment[1], segment[3]]).filter(Number.isFinite);
  const refLat = latValues.reduce((sum, value) => sum + value, 0) / Math.max(1, latValues.length);
  const refLatRad = (refLat * Math.PI) / 180;

  const features = (parsed.elements || []).map((element) => toFeature(element, boundarySegments, refLatRad)).filter(Boolean);

  const geojson = {
    type: "FeatureCollection",
    name: "Local landmarks around Epping Forest",
    generatedAt: new Date().toISOString(),
    source: {
      name: "OpenStreetMap via Overpass API",
      license: "Open Data Commons Open Database License (ODbL)",
      queryFile: "data/local-landmarks.overpassql",
      bbox: [-0.035, 51.595, 0.145, 51.745],
      distanceFilter: {
        maxMinutesFromForestBoundary: MAX_WALK_MINUTES_FROM_BOUNDARY,
        walkingSpeedMPerMin: WALKING_SPEED_M_PER_MIN,
        maxDistanceMetres: Math.round(MAX_DISTANCE_FROM_BOUNDARY_METRES * 10) / 10,
        boundaryFile: "data/epping-forest-land.geojson",
      },
    },
    features,
  };

  fs.writeFileSync(GEOJSON_PATH, JSON.stringify(geojson, null, 2) + "\n");

  const counts = {};
  for (const feature of features) {
    const key = feature.properties.category || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }

  console.log(`Wrote ${features.length} features to ${path.relative(ROOT, GEOJSON_PATH)}`);
  console.log("Category counts:");
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
