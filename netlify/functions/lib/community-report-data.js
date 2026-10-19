// The report of discrepancies between the Veteran Tree Register and what walkers found on the
// ground, built from the daily community snapshot (community-computed.js). Written to be handed to
// the City of London: plain tables, no device ids, and CSV / GeoJSON so it can be loaded into
// their own tools. Pure functions only (rendering, shaping, tree lookup via an injected fetcher).

const FINDING_TEXT = {
  NOT_HERE: "No tree found at the listed location",
  DIFFERENT_TREE: "A different tree stands at the listed location",
  NO_TAG_UNSURE: "No tag found, and reporters doubt it is the listed tree",
  NO_TAG_LIKELY_SAME: "No tag found, but it looks like the listed tree",
  MOVED: "Tag found at a different position from the listed one",
};

const isoDay = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "");
const recordOf = (target) => String(target || "").replace(/^tree:/, "");

// Shapes the snapshot into report sections. `lookup` maps record number -> register record fields
// (tagNumber, commonName, latinName, girthMetres), when they could be fetched.
function buildReportData(computed, lookup = {}, origin = "") {
  const link = (rn) => (origin ? `${origin.replace(/\/$/, "")}/nearby#tree=r${rn}` : "");
  const entries = Object.entries(computed.overlay || {});
  const treeRow = (target, extra) => {
    const rn = recordOf(target);
    const record = lookup[rn] || {};
    return {
      recordNumber: rn,
      tagNumber: record.tagNumber == null ? "" : String(record.tagNumber),
      commonName: record.commonName || "",
      latinName: record.latinName || "",
      girthMetres: record.girthMetres == null ? "" : record.girthMetres,
      mapUrl: link(rn),
      ...extra,
    };
  };
  const questioned = entries
    .filter(([key, e]) => key.startsWith("tree:") && e.s === "questioned")
    .map(([key, e]) => treeRow(key, {
      finding: FINDING_TEXT[e.st] || e.st,
      status: e.st,
      reporters: e.n,
      lastReported: isoDay(e.t),
      listedLat: e.tlat ?? "",
      listedLon: e.tlon ?? "",
      reportedLat: e.st === "MOVED" ? e.lat ?? "" : "",
      reportedLon: e.st === "MOVED" ? e.lon ?? "" : "",
    }))
    .sort((a, b) => b.reporters - a.reporters || a.recordNumber.localeCompare(b.recordNumber, "en", { numeric: true }));
  const newTrees = entries
    .filter(([key, e]) => key.startsWith("new:tree") && (e.s === "new" || e.s === "new-confirmed"))
    .map(([, e]) => ({
      tagNumber: e.tag || "",
      lat: e.lat,
      lon: e.lon,
      reporters: e.n,
      confirmed: e.s === "new-confirmed",
      lastReported: isoDay(e.t),
    }))
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || String(a.tagNumber).localeCompare(String(b.tagNumber), "en", { numeric: true }));
  const conflicts = (computed.conflictDetails || []).map((c) => treeRow(c.target, {
    counts: c.counts,
    lastReported: isoDay(c.t),
    listedLat: c.tlat ?? "",
    listedLon: c.tlon ?? "",
  }));
  const verified = entries.filter(([key, e]) => key.startsWith("tree:") && (e.s === "verified" || e.s === "confirmed")).length;
  return {
    generatedAt: computed.generatedAt,
    generatedDay: isoDay(computed.generatedAt),
    reportCount: computed.reportCount || 0,
    verifiedTrees: verified,
    questioned,
    newTrees,
    conflicts,
  };
}

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const CSV_HEADER = ["section", "record_number", "tag_number", "common_name", "latin_name", "finding", "independent_reporters", "last_reported", "listed_lat", "listed_lon", "reported_lat", "reported_lon", "map_link"];

function reportToCsv(report) {
  const rows = [CSV_HEADER];
  for (const t of report.questioned) {
    rows.push(["questioned", t.recordNumber, t.tagNumber, t.commonName, t.latinName, t.finding, t.reporters, t.lastReported, t.listedLat, t.listedLon, t.reportedLat, t.reportedLon, t.mapUrl]);
  }
  for (const t of report.newTrees) {
    rows.push(["new_tree", "", t.tagNumber, "", "", t.confirmed ? "Found by two or more people" : "Found by one person", t.reporters, t.lastReported, "", "", t.lat, t.lon, ""]);
  }
  for (const t of report.conflicts) {
    const mixed = Object.entries(t.counts || {}).map(([status, n]) => `${status}: ${n}`).join("; ");
    rows.push(["conflicting", t.recordNumber, t.tagNumber, t.commonName, t.latinName, `Reports disagree (${mixed})`, "", t.lastReported, t.listedLat, t.listedLon, "", "", t.mapUrl]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function reportToGeoJson(report) {
  const features = [];
  const point = (lon, lat) => ({ type: "Point", coordinates: [Number(lon), Number(lat)] });
  for (const t of report.questioned) {
    if (t.listedLat === "" || t.listedLon === "") continue;
    features.push({ type: "Feature", geometry: point(t.listedLon, t.listedLat), properties: { section: "questioned", recordNumber: t.recordNumber, tagNumber: t.tagNumber, commonName: t.commonName, finding: t.finding, reporters: t.reporters, lastReported: t.lastReported, reportedLat: t.reportedLat, reportedLon: t.reportedLon } });
  }
  for (const t of report.newTrees) {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
    features.push({ type: "Feature", geometry: point(t.lon, t.lat), properties: { section: "new_tree", tagNumber: t.tagNumber, reporters: t.reporters, confirmed: t.confirmed, lastReported: t.lastReported } });
  }
  return { type: "FeatureCollection", features };
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const place = (lat, lon) => (lat === "" || lon === "" || lat == null || lon == null ? "" : `<a href="https://maps.google.com/?q=${esc(lat)},${esc(lon)}">${esc(Number(lat).toFixed(5))}, ${esc(Number(lon).toFixed(5))}</a>`);

function renderReportHtml(report, { csvUrl = "?format=csv", geoJsonUrl = "?format=geojson" } = {}) {
  const treeName = (t) => [t.tagNumber && `Tag ${esc(t.tagNumber)}`, esc(t.commonName)].filter(Boolean).join(" · ") || `Record ${esc(t.recordNumber)}`;
  const table = (head, rows, empty) => rows.length
    ? `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="empty">${empty}</p>`;
  const questioned = table(["Tree", "Record no.", "Finding", "People", "Last reported", "Listed position", "Reported position"], report.questioned.map((t) =>
    `<tr><td>${t.mapUrl ? `<a href="${esc(t.mapUrl)}">${treeName(t)}</a>` : treeName(t)}</td><td>${esc(t.recordNumber)}</td><td>${esc(t.finding)}</td><td>${esc(t.reporters)}</td><td>${esc(t.lastReported)}</td><td>${place(t.listedLat, t.listedLon)}</td><td>${place(t.reportedLat, t.reportedLon)}</td></tr>`),
    "No trees have been questioned by two or more people yet.");
  const added = table(["Tag number", "Position", "People", "Status", "Last reported"], report.newTrees.map((t) =>
    `<tr><td>${esc(t.tagNumber)}</td><td>${place(t.lat, t.lon)}</td><td>${esc(t.reporters)}</td><td>${t.confirmed ? "Found by two or more people" : "Found by one person, awaiting a second"}</td><td>${esc(t.lastReported)}</td></tr>`),
    "No missing trees have been reported yet.");
  const conflicting = table(["Tree", "Record no.", "Reports", "Last reported", "Listed position"], report.conflicts.map((t) =>
    `<tr><td>${t.mapUrl ? `<a href="${esc(t.mapUrl)}">${treeName(t)}</a>` : treeName(t)}</td><td>${esc(t.recordNumber)}</td><td>${esc(Object.entries(t.counts || {}).map(([s, n]) => `${s}: ${n}`).join("; "))}</td><td>${esc(t.lastReported)}</td><td>${place(t.listedLat, t.listedLon)}</td></tr>`),
    "No conflicting reports.");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Community-reported tree discrepancies — Epping Forest Finds</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<style>
  :root { --bg:#fbfaf6; --fg:#1f2a1f; --muted:#5b665b; --line:#d9ddd0; --accent:#2f6b3a; --card:#fff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif; }
  main { max-width:1000px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:1.7rem; line-height:1.2; margin:.2em 0; }
  h2 { font-size:1.2rem; margin:2em 0 .4em; border-bottom:1px solid var(--line); padding-bottom:.2em; }
  a { color:var(--accent); }
  .scroll { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; background:var(--card); font-size:.92rem; }
  th, td { text-align:left; padding:7px 9px; border:1px solid var(--line); vertical-align:top; }
  th { background:#f1f4ec; }
  .empty { color:var(--muted); }
  .stats { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0; padding:0; list-style:none; }
  .stats li { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:8px 14px; }
  .stats strong { display:block; font-size:1.4rem; }
  .actions a { margin-right:14px; }
  @media print { .actions, nav { display:none; } body { background:#fff; } }
</style>
</head>
<body>
<main>
  <nav><a href="/">Home</a> · <a href="/contribute">How community checks work</a></nav>
  <h1>Community-reported tree discrepancies</h1>
  <p>Differences between the City of London’s Veteran Tree Register and what walkers have found on the ground, collected through Epping Forest Finds. Generated ${esc(report.generatedDay)} from ${esc(report.reportCount)} reports.</p>
  <ul class="stats">
    <li><strong>${report.questioned.length}</strong>trees questioned</li>
    <li><strong>${report.newTrees.length}</strong>possible new trees</li>
    <li><strong>${report.conflicts.length}</strong>conflicting reports</li>
    <li><strong>${report.verifiedTrees}</strong>trees verified</li>
  </ul>
  <p class="actions"><a href="${esc(csvUrl)}">Download CSV</a><a href="${esc(geoJsonUrl)}">Download GeoJSON</a><a href="javascript:window.print()">Print</a></p>
  <h2>How to read this</h2>
  <p>Each report comes from someone standing at the tree. A tree appears below as <em>questioned</em> only when at least two different people report the same problem, and reports made from more than 60 metres away are ignored. Nothing here has been checked by us on site, and none of it changes the register: it is a list of places worth a second look. Positions are WGS84 latitude and longitude.</p>
  <h2>Questioned trees</h2>
  ${questioned}
  <h2>Possible new trees</h2>
  <p>Reported with their tag number from a GPS fix accurate to 30 metres or better.</p>
  ${added}
  <h2>Conflicting reports</h2>
  <p>Some people confirmed these trees and others questioned them, so no finding is shown. They need a look on site.</p>
  ${conflicting}
</main>
</body>
</html>
`;
}

// Looks up register records for the trees a report mentions, using the same public tree chunks the
// app loads. `fetchJson(path)` is injected so this stays testable; it resolves to parsed JSON or
// rejects. Missing data just leaves a row without its tag and species: the report still stands.
async function lookupRegisterRecords(rows, fetchJson) {
  const wanted = rows.filter((r) => Number.isFinite(Number(r.tlat)) && Number.isFinite(Number(r.tlon)));
  if (!wanted.length) return {};
  let index;
  try { index = await fetchJson("data/trees/index.json"); } catch { return {}; }
  const chunks = (index && index.chunks) || [];
  const byChunk = new Map();
  for (const w of wanted) {
    const lat = Number(w.tlat);
    const lon = Number(w.tlon);
    const chunk = chunks.find((c) => c.bounds && lat >= c.bounds.minLat && lat <= c.bounds.maxLat && lon >= c.bounds.minLon && lon <= c.bounds.maxLon);
    if (!chunk) continue;
    if (!byChunk.has(chunk.url)) byChunk.set(chunk.url, new Set());
    byChunk.get(chunk.url).add(String(w.recordNumber));
  }
  const lookup = {};
  await Promise.all([...byChunk.entries()].map(async ([url, numbers]) => {
    try {
      const chunk = await fetchJson(url);
      for (const tree of chunk.trees || []) {
        const rn = String(tree.recordNumber);
        if (numbers.has(rn)) lookup[rn] = { tagNumber: tree.tagNumber, commonName: tree.commonName, latinName: tree.latinName, girthMetres: tree.girthMetres };
      }
    } catch {}
  }));
  return lookup;
}

module.exports = { FINDING_TEXT, buildReportData, reportToCsv, reportToGeoJson, renderReportHtml, lookupRegisterRecords };
