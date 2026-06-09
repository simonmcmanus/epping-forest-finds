const TFL_BASE = "https://api.tfl.gov.uk";

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
  const { lat, lon, type, name } = p;

  if (!lat || !lon || !type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing lat, lon or type" }) };
  }

  if (type !== "bus" && type !== "train") {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid type, must be bus or train" }) };
  }

  const appKey = process.env.TFL_APP_KEY;
  const keyQs = appKey ? `&app_key=${appKey}` : "";
  const arrivalsUrl = (id) => `${TFL_BASE}/StopPoint/${id}/Arrivals${appKey ? `?app_key=${appKey}` : ""}`;

  try {
    let rawArrivals = [];
    let stopName = null;

    if (type === "bus") {
      const stopRes = await fetch(
        `${TFL_BASE}/StopPoint?lat=${lat}&lon=${lon}&stopTypes=NaptanPublicBusCoachTram&radius=200${keyQs}`
      );
      if (!stopRes.ok) throw new Error(`TfL StopPoint HTTP ${stopRes.status}`);
      const stopData = await stopRes.json();
      const stops = Array.isArray(stopData.stopPoints) ? stopData.stopPoints : [];
      if (!stops.length) {
        return { statusCode: 200, headers, body: JSON.stringify({ departures: [], stopName: null }) };
      }
      // Use only the single closest stop so we show departures from the tapped
      // stop only — not buses from the opposite-direction stop across the road.
      const nearestStop = stops[0];
      stopName = nearestStop.commonName;

      const res = await fetch(arrivalsUrl(nearestStop.id));
      rawArrivals = res.ok ? (await res.json()) : [];
    } else {
      // Train/underground: try lat/lon first, fall back to name search
      const stopRes = await fetch(
        `${TFL_BASE}/StopPoint?lat=${lat}&lon=${lon}&stopTypes=NaptanMetroStation,NaptanRailStation&radius=500${keyQs}`
      );
      if (!stopRes.ok) throw new Error(`TfL StopPoint HTTP ${stopRes.status}`);
      const stopData = await stopRes.json();
      const stops = Array.isArray(stopData.stopPoints) ? stopData.stopPoints : [];

      let stopId;
      if (stops.length) {
        stopId = stops[0].id;
        stopName = stops[0].commonName;
      } else if (name) {
        const searchRes = await fetch(
          `${TFL_BASE}/StopPoint/Search/${encodeURIComponent(name)}?modes=tube,overground,elizabeth-line,national-rail&maxResults=5${keyQs}`
        );
        if (!searchRes.ok) throw new Error(`TfL Search HTTP ${searchRes.status}`);
        const searchData = await searchRes.json();
        const matches = Array.isArray(searchData.matches) ? searchData.matches : [];
        if (!matches.length) {
          return { statusCode: 200, headers, body: JSON.stringify({ departures: [], stopName: null }) };
        }
        stopId = matches[0].id;
        stopName = matches[0].name;
      } else {
        return { statusCode: 200, headers, body: JSON.stringify({ departures: [], stopName: null }) };
      }

      const arrivalsRes = await fetch(arrivalsUrl(stopId));
      if (!arrivalsRes.ok) throw new Error(`TfL Arrivals HTTP ${arrivalsRes.status}`);
      rawArrivals = await arrivalsRes.json();
    }

    const departures = (Array.isArray(rawArrivals) ? rawArrivals : [])
      .sort((a, b) => a.timeToStation - b.timeToStation)
      .map((a) => ({
        line: a.lineName || a.lineId || "–",
        direction: a.towards || a.destinationName || "",
        minutesAway: Math.max(0, Math.round(a.timeToStation / 60)),
        due: a.timeToStation <= 30,
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ departures, stopName }),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: String(error.message || "Transport lookup failed") }),
    };
  }
};
