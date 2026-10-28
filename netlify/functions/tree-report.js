// GET /reports/tree-report                 — printable report of community-reported tree discrepancies,
//                                    for the City of London.
// GET /reports/tree-report?format=csv|geojson|json — the same findings as data.
//
// Built from the same hourly snapshot as the public overlay (community-computed.js), so it never
// shows anything the app does not. No device ids are ever included.
const { openStore } = require("./lib/community-store");
const { loadComputed } = require("./lib/community-computed");
const { makeFetchJson } = require("./lib/community-fetch");
const { originOf } = require("./lib/community-fetch");
const { buildReportData, reportToCsv, reportToGeoJson, renderReportHtml, lookupRegisterRecords } = require("./lib/community-report-data");

function queryParam(event, name) {
  return event.queryStringParameters?.[name] || new URLSearchParams(event.rawQuery || "").get(name);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "GET only" };
  const origin = originOf(event);
  const computed = await loadComputed(openStore(event));

  const rows = [
    ...Object.entries(computed.overlay || {}).filter(([k, e]) => k.startsWith("tree:") && e.s === "questioned").map(([k, e]) => ({ recordNumber: k.slice(5), tlat: e.tlat, tlon: e.tlon })),
    ...(computed.conflictDetails || []).map((c) => ({ recordNumber: String(c.target).replace(/^tree:/, ""), tlat: c.tlat, tlon: c.tlon })),
  ];
  const fetchJson = makeFetchJson(event);
  const lookup = await lookupRegisterRecords(rows, fetchJson);
  const report = buildReportData(computed, lookup, origin);

  const format = queryParam(event, "format");
  const day = report.generatedDay || "report";
  const headers = { "Cache-Control": "public, max-age=3600" };
  if (format === "csv") {
    return { statusCode: 200, headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="epping-forest-tree-discrepancies-${day}.csv"` }, body: reportToCsv(report) };
  }
  if (format === "geojson") {
    return { statusCode: 200, headers: { ...headers, "Content-Type": "application/geo+json; charset=utf-8", "Content-Disposition": `attachment; filename="epping-forest-tree-discrepancies-${day}.geojson"` }, body: JSON.stringify(reportToGeoJson(report)) };
  }
  if (format === "json") {
    return { statusCode: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(report) };
  }
  return { statusCode: 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" }, body: renderReportHtml(report) };
};
