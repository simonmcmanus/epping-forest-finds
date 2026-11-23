/**
 * An app POST /api/track with no sign-in cookie (every anonymous and native request) must stay on the
 * plain path: no session lookup, the beta modules are never loaded and the community store is never
 * opened, and the events are stored untagged. This file runs in its own process so the module cache starts clean.
 */

"use strict";

process.env.ADMIN_PASSWORD = "no-cookie-admin";

const test = require("node:test");
const assert = require("node:assert/strict");

const loaded = (name) => Object.keys(require.cache).some((k) => k.replace(/\\/g, "/").endsWith(`/netlify/functions/lib/${name}.js`));

test("a POST with no sign-in cookie never loads the beta modules or opens the community store, and stores its events untagged", async () => {
  const auth = require("../netlify/functions/lib/auth-session.js");
  let sessionLookups = 0;
  const realSessionFrom = auth.sessionFrom;
  auth.sessionFrom = (...args) => { sessionLookups += 1; return realSessionFrom(...args); };
  const track = require("../netlify/functions/track.js");
  const tracking = require("../netlify/functions/lib/tracking-store.js");
  const blobs = new Map();
  track.setStore({
    async getJSON(key) { return blobs.has(key) ? JSON.parse(blobs.get(key)) : null; },
    async setJSON(key, value) { blobs.set(key, JSON.stringify(value)); },
    async delete(key) { blobs.delete(key); },
    async listKeys(prefix) { return [...blobs.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    async firstPageKeys(prefix) { return [...blobs.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  });
  const ts = new Date().toISOString();
  const res = await track.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": "10.7.0.1" },
    body: JSON.stringify({ events: [{ type: "location", uid: "anon", ts, lat: 51.65, lng: 0.04, heading: 90, navTarget: null }] }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).stored, 1);

  for (const name of ["beta-access", "feature-gate"]) assert.equal(loaded(name), false, `${name} was loaded`);
  assert.equal(sessionLookups, 0, "the request was checked for a session");

  const read = await track.handler({ httpMethod: "GET", headers: { authorization: "Bearer no-cookie-admin" }, queryStringParameters: { days: "2" } });
  const events = tracking.unpackEvents(JSON.parse(read.body).locations);
  assert.equal(events.length, 1);
  assert.equal(events[0].beta, undefined);
});
