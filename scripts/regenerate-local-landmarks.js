const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const QUERY_PATH = path.join(DATA_DIR, "local-landmarks.overpassql");
const OVERPASS_JSON_PATH = path.join(DATA_DIR, "local-landmarks.overpass.json");
const GEOJSON_PATH = path.join(DATA_DIR, "local-landmarks.geojson");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

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
    bus_station: "Bus Station",
    taxi: "Taxi",
    train_station: "Train Station",
    station: "Train Station",
    halt: "Rail Halt",
    tram_stop: "Tram Stop",
    attraction: "Attraction",
    viewpoint: "Viewpoint",
    museum: "Museum",
    picnic_site: "Picnic Site",
    historic: "Historic Site",
  };
  return labels[key] || String(key || "place").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function toFeature(element) {
  const tags = element.tags || {};
  const longitude = typeof element.lon === "number" ? element.lon : element.center && element.center.lon;
  const latitude = typeof element.lat === "number" ? element.lat : element.center && element.center.lat;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const category = tags.amenity || tags.railway || tags.tourism || (tags.historic ? "historic" : "place");
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
      website: tags.website || tags["contact:website"] || null,
      phone: tags.phone || tags["contact:phone"] || null,
      address,
    },
  };
}

async function main() {
  const queryText = fs.readFileSync(QUERY_PATH, "utf8");
  const raw = await postOverpass(queryText);
  fs.writeFileSync(OVERPASS_JSON_PATH, raw);

  const parsed = JSON.parse(raw);
  const features = (parsed.elements || []).map(toFeature).filter(Boolean);

  const geojson = {
    type: "FeatureCollection",
    name: "Local landmarks around Epping Forest",
    generatedAt: new Date().toISOString(),
    source: {
      name: "OpenStreetMap via Overpass API",
      license: "Open Data Commons Open Database License (ODbL)",
      queryFile: "data/local-landmarks.overpassql",
      bbox: [-0.035, 51.595, 0.145, 51.745],
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
