#!/usr/bin/env node
// Pass 2: geocode the remaining approximate-coord blue plaques using:
//  1. postcodes.io (precise UK postcode centroids)
//  2. Nominatim with simplified address forms

const fs = require('fs');
const https = require('https');

const DATA_PATH = '/Users/simonmcmanus/node/trees/data/epping_forest_folklore_locations_v14_external_links.json';

// Plaques that still have approximate coords — provide specific postcode or simplified address
// postcodes.io centroid accuracy is typically within 100m for unit postcodes
const MANUAL_GEOCODE = [
  { name: 'Blue Plaque: Sir Jacob Epstein',              postcode: 'IG10 1SF', houseNo: 50, road: 'Baldwins Hill' },
  { name: 'Blue Plaque: Lopping Hall',                   postcode: 'IG10 4LF', road: 'High Road' },
  { name: 'Blue Plaque: Roding Valley High School / Winifred Darch', postcode: 'IG10 3JA' },
  { name: 'Blue Plaque: William Chapman Waller',         postcode: 'IG10 1SP', houseNo: 11, road: 'Wallers Hoppett' },
  { name: 'Blue Plaque: Thomas Willingale',              postcode: 'IG10 1RZ', road: 'Church Lane' },
  { name: 'Blue Plaque: James Cubitt',                   postcode: 'IG10 1AH', road: 'High Road' },
  { name: 'Blue Plaque: Millais Culpin',                 postcode: 'IG10 1QP', houseNo: 77, road: 'Church Hill' },
  { name: 'Blue Plaque: Doctor Fred Stoker',             postcode: 'IG10 1SN', houseNo: 83, road: 'Baldwins Hill' },
  { name: 'Blue Plaque: Mary Anne Clarke',               postcode: 'IG10 1HX', road: 'Steeds Way' },
  { name: 'Blue Plaque: Sir Rowland Hill and Francis Worrall Stevens', postcode: 'IG10 4RA', houseNo: 11, road: 'Albion Hill' },
  { name: 'Blue Plaque: William Brown Macdougall and Margaret Armour', postcode: 'IG10 2NY', road: 'Debden Road' },
  { name: 'Blue Plaque: Margaret Walker and Joan Littlewood', postcode: 'IG10 3RY', road: 'Rectory Lane' },
  { name: 'Blue Plaque: Former Loughton Bus Garage',     postcode: 'IG10 1LJ', road: 'Church Hill' },
  { name: 'Blue Plaque: Muriel Lester and Doris Lester', postcode: 'IG10 1SF', road: 'Baldwins Hill' },
  { name: 'Blue Plaque: George Pearson',                 postcode: 'IG10 1HR', road: 'Staples Road' },
  { name: 'Blue Plaque: Sir Leonard Hill and Austin Bradford Hill', postcode: 'IG10 1UB', road: 'Nafferton Rise' },
  { name: 'Blue Plaque: Millican Dalton',                postcode: 'IG10 1SJ', houseNo: 18, road: 'Stony Path' },
  { name: 'Blue Plaque: Sir William Addison',            nominatim: 'Old Court House, Hemnall Street, Epping, Essex' },
  { name: 'Blue Plaque: Jill Barklem',                   nominatim: 'Church Hill, Epping, Essex' },
  { name: 'Blue Plaque: Epping Charter Market',          nominatim: 'Aves Opticians, High Street, Epping, Essex' },
  { name: 'Blue Plaque: Ernest Wythes',                  nominatim: 'Hemnall Street, Epping, Essex' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getJson(url, extraHeaders) {
  return new Promise((resolve) => {
    const options = { headers: { 'User-Agent': 'EppingForestFindsApp/1.0 (mcmanus.simon@gmail.com)', ...(extraHeaders||{}) } };
    https.get(url, options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function postcodeLatLon(postcode) {
  const clean = postcode.replace(/\s+/g, '').toUpperCase();
  const data = await getJson(`https://api.postcodes.io/postcodes/${clean}`);
  if (data && data.status === 200 && data.result) {
    return { lat: data.result.latitude, lon: data.result.longitude };
  }
  return null;
}

async function nominatimGeocode(address) {
  await sleep(1100);
  const q = encodeURIComponent(address);
  const data = await getJson(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=gb`);
  if (data && data.length > 0) {
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display: data[0].display_name };
  }
  return null;
}

async function main() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  const items = data.locations;

  const updated = [];
  const failed = [];

  for (const spec of MANUAL_GEOCODE) {
    const plaque = items.find(i => i.name === spec.name);
    if (!plaque) { console.log(`NOT FOUND: ${spec.name}`); continue; }

    // Skip if already precisely geocoded
    if (plaque.location_precision === 'gps_precise' || plaque.location_precision === 'geocoded_address') {
      console.log(`SKIP (already geocoded): ${spec.name}`);
      continue;
    }

    let result = null;

    if (spec.nominatim) {
      result = await nominatimGeocode(spec.nominatim);
      if (result) {
        plaque.coordinates = {
          latitude: Math.round(result.lat * 1e6) / 1e6,
          longitude: Math.round(result.lon * 1e6) / 1e6,
          accuracy: 'geocoded_address',
          source: 'nominatim.openstreetmap.org'
        };
        plaque.location_precision = 'geocoded_address';
        updated.push({ name: spec.name, lat: result.lat, lon: result.lon, method: 'nominatim' });
        continue;
      }
    }

    if (spec.postcode) {
      // Try houseNo + road + postcode with Nominatim first
      if (spec.houseNo && spec.road) {
        const addr = `${spec.houseNo} ${spec.road}, Loughton ${spec.postcode}`;
        result = await nominatimGeocode(addr);
      }

      // Fallback to postcode centroid
      if (!result) {
        result = await postcodeLatLon(spec.postcode);
        if (result) result.method = 'postcode_centroid';
      }

      if (result) {
        plaque.coordinates = {
          latitude: Math.round(result.lat * 1e6) / 1e6,
          longitude: Math.round(result.lon * 1e6) / 1e6,
          accuracy: result.method === 'postcode_centroid' ? 'postcode_centroid' : 'geocoded_address',
          source: result.method === 'postcode_centroid' ? 'postcodes.io' : 'nominatim.openstreetmap.org'
        };
        plaque.location_precision = result.method === 'postcode_centroid' ? 'postcode_centroid' : 'geocoded_address';
        updated.push({ name: spec.name, lat: result.lat, lon: result.lon, method: result.method || 'nominatim' });
      } else {
        failed.push({ name: spec.name, reason: 'all methods failed' });
      }
    }
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  console.log(`\n=== PASS 2 RESULTS ===`);
  console.log(`\nUpdated (${updated.length}):`);
  updated.forEach(u => console.log(`  ✓ ${u.name} → ${u.lat},${u.lon} [${u.method}]`));
  console.log(`\nFailed (${failed.length}):`);
  failed.forEach(f => console.log(`  ✗ ${f.name}: ${f.reason}`));
}

main().catch(console.error);
