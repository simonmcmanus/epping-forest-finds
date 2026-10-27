const test = require("node:test");
const assert = require("node:assert/strict");

const { _private } = require("../netlify/functions/transport-departures.js");

test("bus stop direction prefers explicit stop metadata", () => {
  const stopPoint = {
    additionalProperties: [
      { key: "Towards", value: "Towards Walthamstow Central" },
    ],
  };
  const rawArrivals = [
    { towards: "Chingford Station" },
    { towards: "Loughton" },
  ];

  assert.equal(_private.busStopDirection(stopPoint, rawArrivals), "Walthamstow Central");
});

test("bus stop direction falls back to unique live departure destinations", () => {
  const rawArrivals = [
    { towards: "Chingford Station" },
    { towards: "Chingford Station" },
    { destinationName: "Loughton Station" },
    { towards: "Woodford" },
  ];

  assert.equal(
    _private.busStopDirection({}, rawArrivals),
    "Chingford Station / Loughton Station + 1 more"
  );
});

test("bus stop direction ignores stop letters when no destination data exists", () => {
  assert.equal(_private.busStopDirection({ indicator: "Stop F" }, []), null);
});

test("bus stop direction keeps valid directional indicators", () => {
  assert.equal(_private.busStopDirection({ indicator: "Stop F northbound" }, []), "Stop F northbound");
  assert.equal(_private.busStopDirection({ indicator: "Stop G towards Chingford" }, []), "Stop G towards Chingford");
  assert.equal(_private.busStopDirection({ indicator: "Stop H via Woodford" }, []), "Stop H via Woodford");
});

test("bus stop direction ignores compass bearings", () => {
  assert.equal(_private.busStopDirection({ indicator: "N" }, []), null);
  assert.equal(_private.busStopDirection({ indicator: "SSW" }, []), null);
  assert.equal(_private.busStopDirection({ bearing: "225" }, []), null);
  assert.equal(
    _private.busStopDirection({ additionalProperties: [{ key: "CompassPoint", value: "NE" }] }, []),
    null
  );
  assert.equal(
    _private.busStopDirection({ additionalProperties: [{ key: "Direction", value: "north-east" }] }, []),
    null
  );
  assert.equal(_private.normalizeDirectionText("180°"), null);
});

test("bus stop direction keeps destinations that merely look compass-like", () => {
  assert.equal(
    _private.busStopDirection({ additionalProperties: [{ key: "Towards", value: "New Barnet" }] }, []),
    "New Barnet"
  );
  assert.equal(_private.normalizeDirectionText("Northumberland Park"), "Northumberland Park");
});

const transport = require("../netlify/functions/transport-departures.js");

function withTfl(respond, run) {
  const original = global.fetch;
  global.fetch = async (url) => respond(String(url));
  return Promise.resolve(run()).finally(() => { global.fetch = original; });
}

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("live departures for a stop are shared at the edge for 30 seconds", () => withTfl(
  (url) => (url.includes("/Arrivals")
    ? json([{ lineName: "20", towards: "Loughton", timeToStation: 120 }])
    : json({ stopPoints: [{ id: "490000001", commonName: "High Beach" }] })),
  async () => {
    const result = await transport.handler({ httpMethod: "GET", queryStringParameters: { lat: "51.65", lon: "0.03", type: "bus" } });
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).departures[0].line, "20");
    assert.match(result.headers["Netlify-CDN-Cache-Control"], /s-maxage=30/);
    assert.equal(result.headers["Netlify-Vary"], "query=lat|lon|type|name");
  },
));

test("a TfL failure answers 502 and is never cached", () => withTfl(
  () => new Response("rate limited", { status: 429 }),
  async () => {
    const result = await transport.handler({ httpMethod: "GET", queryStringParameters: { lat: "51.65", lon: "0.03", type: "train" } });
    assert.equal(result.statusCode, 502);
    assert.equal(result.headers["Netlify-CDN-Cache-Control"], undefined);
    assert.equal(result.headers["Cache-Control"], "no-store");
  },
));

test("a TfL call that hangs is given up after a few seconds with a 502", async () => {
  const { mock } = require("node:test");
  mock.timers.enable({ apis: ["setTimeout"] });
  const original = global.fetch;
  global.fetch = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  try {
    const pending = transport.handler({ httpMethod: "GET", queryStringParameters: { lat: "51.65", lon: "0.03", type: "bus" } });
    mock.timers.tick(4000);
    const result = await pending;
    assert.equal(result.statusCode, 502);
  } finally {
    global.fetch = original;
    mock.timers.reset();
  }
});

test("without TFL_APP_KEY the function says so in its log, once", async () => {
  delete require.cache[require.resolve("../netlify/functions/transport-departures.js")];
  const fresh = require("../netlify/functions/transport-departures.js");
  const key = process.env.TFL_APP_KEY;
  delete process.env.TFL_APP_KEY;
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    await withTfl(() => json({ stopPoints: [] }), async () => {
      await fresh.handler({ httpMethod: "GET", queryStringParameters: { lat: "51.65", lon: "0.03", type: "bus" } });
      await fresh.handler({ httpMethod: "GET", queryStringParameters: { lat: "51.65", lon: "0.03", type: "bus" } });
    });
    assert.equal(warnings.filter((w) => w.includes("TFL_APP_KEY")).length, 1);
  } finally {
    console.warn = warn;
    if (key !== undefined) process.env.TFL_APP_KEY = key;
  }
});

test("a failed bus arrivals lookup is an uncached error, never a cached 'no departures'", () => withTfl(
  (url) => (url.includes("/Arrivals")
    ? new Response("busy", { status: 503 })
    : json({ stopPoints: [{ id: "490000001", commonName: "High Beach" }] })),
  async () => {
    const result = await transport.handler({ httpMethod: "GET", queryStringParameters: { lat: "51.65", lon: "0.03", type: "bus" } });
    assert.equal(result.statusCode, 502);
    assert.equal(result.headers["Netlify-CDN-Cache-Control"], undefined);
  },
));
