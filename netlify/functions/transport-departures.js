const TFL_BASE = "https://api.tfl.gov.uk";

function normalizeDirectionText(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (/^stop\s+[a-z0-9]+$/i.test(cleaned)) return null;
  return cleaned.replace(/^towards\s+/i, "");
}

function uniqueDirections(values) {
  const seen = new Set();
  const directions = [];
  for (const value of values) {
    const normalized = normalizeDirectionText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    directions.push(normalized);
  }
  return directions;
}

function summarizeDirections(directions) {
  if (!directions.length) return null;
  if (directions.length === 1) return directions[0];
  if (directions.length === 2) return `${directions[0]} / ${directions[1]}`;
  return `${directions[0]} / ${directions[1]} + ${directions.length - 2} more`;
}

function stopMetadataDirection(stopPoint) {
  if (!stopPoint || typeof stopPoint !== "object") return null;

  const additionalProperties = Array.isArray(stopPoint.additionalProperties) ? stopPoint.additionalProperties : [];
  for (const property of additionalProperties) {
    const descriptor = [
      property && property.category,
      property && property.key,
      property && property.sourceSystemKey,
      property && property.description,
    ].filter(Boolean).join(" ");
    // TfL stop metadata is inconsistent, so match any property whose label looks
    // direction-related and then normalize the associated value.
    if (!/towards|destination|direction|bearing|compass/i.test(descriptor)) continue;
    const direction = normalizeDirectionText(property && (property.value || property.description));
    if (direction) return direction;
  }

  const indicator = normalizeDirectionText(stopPoint.indicator);
  if (indicator && /bound|towards|via|\b(?:north|south|east|west|n|s|e|w)\b/i.test(indicator)) {
    return indicator;
  }

  const bearing = normalizeDirectionText(stopPoint.bearing);
  if (bearing) return bearing;

  return null;
}

function busStopDirection(stopPoint, rawArrivals) {
  const metadataDirection = stopMetadataDirection(stopPoint);
  if (metadataDirection) return metadataDirection;
  const directions = arrivalDirections(rawArrivals);
  return summarizeDirections(directions);
}

function arrivalDirections(rawArrivals) {
  const directions = Array.isArray(rawArrivals) ? rawArrivals : [];
  return uniqueDirections(directions.map((arrival) => arrival && (arrival.towards || arrival.destinationName)));
}

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
    let stopDirection = null;

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
      stopDirection = busStopDirection(nearestStop, rawArrivals);
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
      body: JSON.stringify({ departures, stopName, stopDirection }),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: String(error.message || "Transport lookup failed") }),
    };
  }
};

exports._private = {
  normalizeDirectionText,
  summarizeDirections,
  busStopDirection,
};
