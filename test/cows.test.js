/**
 * The /api/cows proxy (netlify/functions/cows.js). Every open app polls it for the same fixed
 * centre point, so a good answer must be shareable at Netlify's edge, and a bad one must not be.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cows = require("../netlify/functions/cows.js");

function withUpstream(respond, run) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => { calls.push(url); return respond(url, options); };
  return Promise.resolve(run(calls)).finally(() => { global.fetch = original; });
}

const get = (center = "0.06,51.65") => cows.handler({ httpMethod: "GET", queryStringParameters: { center } });

test("a good cow answer is shared at the edge for a minute, keyed on the centre point", () => withUpstream(
  () => new Response(JSON.stringify({ collars: [] }), { status: 200, headers: { "content-type": "application/json" } }),
  async (calls) => {
    const result = await get();
    assert.equal(result.statusCode, 200);
    assert.match(result.headers["Netlify-CDN-Cache-Control"], /s-maxage=60/);
    assert.equal(result.headers["Netlify-Vary"], "query=center");
    // Fresh for a minute plus at most 30 s served stale while refreshing: no visitor sees a position over ~90 s old.
    const [, fresh, stale] = /s-maxage=(\d+), stale-while-revalidate=(\d+)/.exec(result.headers["Netlify-CDN-Cache-Control"]);
    assert.ok(Number(fresh) + Number(stale) <= 90);
    assert.equal(calls.length, 1);
  },
));

test("an upstream error is passed on and never cached", () => withUpstream(
  () => new Response("busy", { status: 503 }),
  async () => {
    const result = await get();
    assert.equal(result.statusCode, 503);
    assert.equal(result.headers["Netlify-CDN-Cache-Control"], undefined);
    assert.equal(result.headers["Cache-Control"], "no-store");
  },
));

test("an unreachable upstream answers 502 without caching", () => withUpstream(
  () => Promise.reject(new TypeError("network down")),
  async () => {
    const result = await get();
    assert.equal(result.statusCode, 502);
    assert.equal(result.headers["Netlify-CDN-Cache-Control"], undefined);
  },
));

test("a request with no centre point is refused before calling Nofence", () => withUpstream(
  () => { throw new Error("should not be called"); },
  async (calls) => {
    const result = await cows.handler({ httpMethod: "GET", queryStringParameters: {} });
    assert.equal(result.statusCode, 400);
    assert.equal(calls.length, 0);
  },
));

test("a Nofence call that hangs is given up after a few seconds with a 502", async () => {
  const { mock } = require("node:test");
  mock.timers.enable({ apis: ["setTimeout"] });
  const original = global.fetch;
  global.fetch = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  try {
    const pending = get();
    mock.timers.tick(6000);
    const result = await pending;
    assert.equal(result.statusCode, 502);
    assert.equal(result.headers["Netlify-CDN-Cache-Control"], undefined);
  } finally {
    global.fetch = original;
    mock.timers.reset();
  }
});
