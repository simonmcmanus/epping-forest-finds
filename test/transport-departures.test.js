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
