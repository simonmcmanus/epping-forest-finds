const TFL_BASE = "https://api.tfl.gov.uk";

const STOP_TYPES_FOR = {
  bus: "NaptanBusCoachTimetabledStop,NaptanPublicBusCoachTram",
  train: "NaptanRailStation,NaptanMetroStation",
};

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const p = event.queryStringParameters || {};
  const { lat, lon, type } = p;

  if (!lat || !lon || !type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing lat, lon or type" }) };
  }

  const stopTypes = STOP_TYPES_FOR[type];
  if (!stopTypes) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid type, must be bus or train" }) };
  }

  const appKey = process.env.TFL_APP_KEY;
  const keyQs = appKey ? `&app_key=${appKey}` : "";

  try {
    // Step 1: find the nearest stop at this location
    const stopRes = await fetch(
      `${TFL_BASE}/StopPoint?lat=${lat}&lon=${lon}&stopTypes=${stopTypes}&radius=150${keyQs}`
    );
    if (!stopRes.ok) throw new Error(`TfL StopPoint HTTP ${stopRes.status}`);
    const stopData = await stopRes.json();
    const stops = Array.isArray(stopData.stopPoints) ? stopData.stopPoints : [];

    if (!stops.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ departures: [], stopName: null }) };
    }

    // Closest stop is first (TfL sorts by distance)
    const stop = stops[0];

    // Step 2: get live arrivals for this stop
    const arrivalsRes = await fetch(
      `${TFL_BASE}/StopPoint/${stop.id}/Arrivals${appKey ? `?app_key=${appKey}` : ""}`
    );
    if (!arrivalsRes.ok) throw new Error(`TfL Arrivals HTTP ${arrivalsRes.status}`);
    const arrivals = await arrivalsRes.json();

    const departures = (Array.isArray(arrivals) ? arrivals : [])
      .sort((a, b) => a.timeToStation - b.timeToStation)
      .slice(0, 10)
      .map((a) => ({
        line: a.lineName || a.lineId || "–",
        direction: a.towards || a.destinationName || "",
        minutesAway: Math.max(0, Math.round(a.timeToStation / 60)),
        due: a.timeToStation <= 30,
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ departures, stopName: stop.commonName, stopId: stop.id }),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: String(error.message || "Transport lookup failed") }),
    };
  }
};
