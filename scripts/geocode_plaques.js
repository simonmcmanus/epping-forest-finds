#!/usr/bin/env node
// Geocodes blue plaque coordinates using:
//  1. Hardcoded OpenPlaques GPS-precise coordinates (authoritative)
//  2. Nominatim fallback for the rest
// Removes entries that cannot be verified to a location within the expected area.

const fs = require('fs');
const https = require('https');

const DATA_PATH = '/Users/simonmcmanus/node/trees/data/epping_forest_folklore_locations_v14_external_links.json';

// Entries to remove entirely — confirmed wrong location or not verifiable
const REMOVE_NAMES = new Set([
  'Blue Plaque: William Morris birthplace site',  // Walthamstow E17, coord 12km off
  'Blue Plaque: Old Watch House or Cage',          // No address, wrong coord
  'Blue Plaque: Buckhurst Hill Heritage Locations', // Vague summary, not a single plaque
]);

// Authoritative GPS coordinates from OpenPlaques (physically GPS-tagged)
// Format: name → [lat, lon, source_url]
const OPENPLAQUES_COORDS = {
  'Blue Plaque: Ken Campbell':                             [51.65946, 0.06252,  'openplaques.org/plaques/55723'],
  'Blue Plaque: José Collins':                             [51.6426,  0.0497,   'openplaques.org/plaques/1915'],
  'Blue Plaque: John Strevens':                            [51.6425,  0.05058,  'openplaques.org/plaques/1920'],
  'Blue Plaque: Capt Richard Stannard VC':                 [51.64894, 0.08741,  'openplaques.org/plaques/1923'],
  'Blue Plaque: Rev William Dawson':                       [51.64552, 0.05417,  'openplaques.org/plaques/53205'],
  'Blue Plaque: Donald W Gillingham':                      [51.64136, 0.05833,  'openplaques.org/plaques/55696'],
  'Blue Plaque: Everard Richard Calthrop':                 [51.6613,  0.06768,  'openplaques.org/plaques/1936'],
  'Blue Plaque: Rudyard Kipling, Alice Kipling and Stanley Baldwin': [51.66187, 0.0676, 'openplaques.org/plaques/55721'],
  'Blue Plaque: Winston Churchill':                        [51.69986, 0.1122,   'openplaques.org/plaques/40977'],
  'Blue Plaque: Dr Joseph Clegg':                          [51.6962,  0.10648,  'openplaques.org/plaques/53439'],
  'Blue Plaque: Gladys Mills':                             [51.6416,  0.06514,  'openplaques.org/plaques/1937'],
  'Blue Plaque: Ron Greenwood':                            [51.6472,  0.05744,  'openplaques.org/plaques/1935'],
  'Blue Plaque: Sir Hugh Cairns':                          [51.65995, 0.06392,  'openplaques.org/plaques/8811'],
  'Blue Plaque: Arthur Morrison':                          [51.6437,  0.05086,  'openplaques.org/plaques/1924'],
  'Blue Plaque: Pte Sidney Godley VC':                     [51.64894, 0.08741,  'openplaques.org/plaques/1923'],
};

// Bounding box for the Epping Forest area (generous)
const AREA_BOUNDS = { minLat: 51.54, maxLat: 51.78, minLon: -0.05, maxLon: 0.20 };

function inArea(lat, lon) {
  return lat >= AREA_BOUNDS.minLat && lat <= AREA_BOUNDS.maxLat &&
         lon >= AREA_BOUNDS.minLon && lon <= AREA_BOUNDS.maxLon;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function nominatimGeocode(address) {
  return new Promise((resolve) => {
    const query = encodeURIComponent(address + ', Essex, UK');
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=gb`;
    const options = {
      headers: { 'User-Agent': 'EppingForestFindsApp/1.0 (mcmanus.simon@gmail.com)' }
    };
    https.get(url, options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const results = JSON.parse(body);
          if (results && results.length > 0) {
            resolve({ lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon), display: results[0].display_name });
          } else {
            resolve(null);
          }
        } catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function main() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  const items = data.locations;

  const plaques = items.filter(i => i.name && i.name.startsWith('Blue Plaque'));
  const nonPlaques = items.filter(i => !i.name || !i.name.startsWith('Blue Plaque'));

  console.log(`Total blue plaques: ${plaques.length}`);
  console.log(`Removing ${REMOVE_NAMES.size} entries upfront.\n`);

  const kept = [];
  const removed = [];
  const updated = [];
  const failed = [];

  for (const plaque of plaques) {
    const name = plaque.name;

    // Step 1: Remove confirmed-bad entries
    if (REMOVE_NAMES.has(name)) {
      removed.push({ name, reason: 'confirmed wrong location or unverifiable' });
      continue;
    }

    // Step 2: Apply OpenPlaques authoritative coords
    if (OPENPLAQUES_COORDS[name]) {
      const [lat, lon, src] = OPENPLAQUES_COORDS[name];
      plaque.coordinates = {
        latitude: lat,
        longitude: lon,
        accuracy: 'gps_precise',
        source: src
      };
      plaque.location_precision = 'gps_precise';
      kept.push(plaque);
      updated.push({ name, lat, lon, method: 'openplaques' });
      continue;
    }

    // Step 3: Geocode via Nominatim using the address
    const addr = plaque.address || plaque.location_description || '';
    if (!addr || addr.toLowerCase() === 'epping' || addr.toLowerCase() === 'loughton' || addr.toLowerCase() === 'waltham forest') {
      // Too vague to geocode
      if (!addr) {
        removed.push({ name, reason: 'no address to geocode' });
        continue;
      }
      // Keep with existing approximate coord but log
      kept.push(plaque);
      failed.push({ name, reason: 'address too vague: ' + addr });
      continue;
    }

    await sleep(1100); // Nominatim rate limit: 1 req/sec
    const geo = await nominatimGeocode(addr);

    if (geo && inArea(geo.lat, geo.lon)) {
      plaque.coordinates = {
        latitude: Math.round(geo.lat * 1e6) / 1e6,
        longitude: Math.round(geo.lon * 1e6) / 1e6,
        accuracy: 'geocoded_address',
        source: 'nominatim.openstreetmap.org'
      };
      plaque.location_precision = 'geocoded_address';
      kept.push(plaque);
      updated.push({ name, lat: geo.lat, lon: geo.lon, method: 'nominatim', addr });
    } else if (geo && !inArea(geo.lat, geo.lon)) {
      removed.push({ name, reason: `geocoded outside area: ${geo.lat},${geo.lon} (${geo.display})` });
    } else {
      // Nominatim returned nothing — keep with existing coords but flag
      kept.push(plaque);
      failed.push({ name, reason: 'nominatim returned no result for: ' + addr });
    }
  }

  // Rebuild locations array: non-plaques first (unchanged), then verified plaques
  data.locations = [...nonPlaques, ...kept];

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  console.log('\n=== RESULTS ===');
  console.log(`\nKept and updated (${updated.length}):`);
  updated.forEach(u => console.log(`  ✓ ${u.name} → ${u.lat},${u.lon} [${u.method}]`));

  console.log(`\nKept but could not geocode (${failed.length}) — retained existing approx coords:`);
  failed.forEach(f => console.log(`  ~ ${f.name}: ${f.reason}`));

  console.log(`\nRemoved (${removed.length}):`);
  removed.forEach(r => console.log(`  ✗ ${r.name}: ${r.reason}`));

  console.log(`\nFinal: ${kept.length} blue plaques, ${removed.length} removed`);
}

main().catch(console.error);
