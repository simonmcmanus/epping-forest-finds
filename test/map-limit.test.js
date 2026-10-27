// netlify/functions/lib/map-limit.js: the bounded fan-out every bulk blob read now goes through.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mapLimit } = require("../netlify/functions/lib/map-limit");

test("never runs more than the limit at once, however many items there are", async () => {
  let inFlight = 0;
  let most = 0;
  await mapLimit(Array.from({ length: 500 }, (_, i) => i), 7, async () => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
  });
  assert.equal(most, 7);
});

test("results come back in input order even when later items finish first", async () => {
  const results = await mapLimit([30, 1, 20, 2], 4, (ms) => new Promise((resolve) => setTimeout(() => resolve(ms * 10), ms)));
  assert.deepEqual(results, [300, 10, 200, 20]);
});

test("an empty list resolves to an empty list", async () => {
  assert.deepEqual(await mapLimit([], 5, async () => { throw new Error("never called"); }), []);
});

test("a failure is passed to the caller rather than swallowed", async () => {
  await assert.rejects(mapLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("read failed"); return n; }), /read failed/);
});
