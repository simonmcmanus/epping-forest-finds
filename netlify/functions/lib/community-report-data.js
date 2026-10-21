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
  const treeLink = (t) => (t.mapUrl ? `<a href="${esc(t.mapUrl)}">${treeName(t)}</a>` : treeName(t));
  // Cells carry data-label so home.css can lay each row out as a card on a phone.
  const cell = (label, value, cls = "") => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}>${value}</td>`;
  const table = (head, rows, empty) => rows.length
    ? `<div class="report-card"><div class="report-scroll"><table class="report-table"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`
    : `<div class="note-card"><p>${empty}</p></div>`;
  const questioned = table(["Tree", "Record no.", "Finding", "People", "Last reported", "Listed position", "Reported position"], report.questioned.map((t) =>
    `<tr>${cell("Tree", treeLink(t))}${cell("Record no.", esc(t.recordNumber), "mono")}${cell("Finding", esc(t.finding))}${cell("People", esc(t.reporters), "mono")}${cell("Last reported", esc(t.lastReported), "mono")}${cell("Listed position", place(t.listedLat, t.listedLon), "mono")}${cell("Reported position", place(t.reportedLat, t.reportedLon), "mono")}</tr>`),
    "No trees have been questioned by two or more people yet.");
  const added = table(["Tag number", "Position", "People", "Status", "Last reported"], report.newTrees.map((t) =>
    `<tr>${cell("Tag number", esc(t.tagNumber), "mono")}${cell("Position", place(t.lat, t.lon), "mono")}${cell("People", esc(t.reporters), "mono")}${cell("Status", t.confirmed ? "Found by two or more people" : "Found by one person, awaiting a second")}${cell("Last reported", esc(t.lastReported), "mono")}</tr>`),
    "No missing trees have been reported yet.");
  const conflicting = table(["Tree", "Record no.", "Reports", "Last reported", "Listed position"], report.conflicts.map((t) =>
    `<tr>${cell("Tree", treeLink(t))}${cell("Record no.", esc(t.recordNumber), "mono")}${cell("Reports", esc(Object.entries(t.counts || {}).map(([s, n]) => `${s}: ${n}`).join("; ")))}${cell("Last reported", esc(t.lastReported), "mono")}${cell("Listed position", place(t.listedLat, t.listedLon), "mono")}</tr>`),
    "No conflicting reports.");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-M9NL06G2JB"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('consent', 'default', { analytics_storage: 'denied' });
    gtag('js', new Date());
    gtag('config', 'G-M9NL06G2JB');
  </script>
  <script src="/cookie-consent.js" defer></script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#24382f">
  <meta name="robots" content="noindex">
  <title>Community-reported tree discrepancies | Epping Forest Finds</title>
  <link rel="icon" href="/assets/home/favicon.png" type="image/png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/home/home.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-head">
    <a class="brand" href="/">
      <img class="brand-mark" src="/assets/home/map-icons/oak.png" alt="" width="44" height="44">
      <span>Epping Forest Finds</span>
    </a>
    <a class="head-link" href="/contribute">How community checks work</a>
  </header>
  <main id="main" tabindex="-1">
    <section class="hero page-hero">
      <div class="hero-copy">
        <h1>Community-reported tree discrepancies</h1>
        <p class="page-lede">Differences between the City of London’s Veteran Tree Register and what walkers have found on the ground. Generated ${esc(report.generatedDay)} from ${esc(report.reportCount)} reports.</p>
        <ul class="hero-stats">
          <li><strong>${report.questioned.length}</strong>trees questioned</li>
          <li><strong>${report.newTrees.length}</strong>possible new trees</li>
          <li><strong>${report.conflicts.length}</strong>conflicting reports</li>
          <li><strong>${report.verifiedTrees}</strong>trees verified</li>
        </ul>
        <div class="hero-actions">
          <a class="cta-btn" href="${esc(csvUrl)}">Download CSV</a>
          <a class="cta-btn cta-ghost" href="${esc(geoJsonUrl)}">Download GeoJSON</a>
          <a class="cta-btn cta-ghost" href="javascript:window.print()">Print</a>
        </div>
      </div>
    </section>
    <section aria-labelledby="how-heading">
      <h2 id="how-heading">How to read this</h2>
      <div class="note-card"><p>Each report comes from someone standing at the tree. A tree appears below as <em>questioned</em> only when at least two different people report the same problem, and reports made from more than 10 metres from the tree are ignored. Nothing here has been checked by us on site, and none of it changes the register: it is a list of places worth a second look. Positions are WGS84 latitude and longitude.</p></div>
    </section>
    <section aria-labelledby="questioned-heading">
      <h2 id="questioned-heading">Questioned trees</h2>
      ${questioned}
    </section>
    <section aria-labelledby="new-heading">
      <h2 id="new-heading">Possible new trees</h2>
      <p class="section-lede">Reported with their tag number from a GPS fix accurate to 30 metres or better.</p>
      ${added}
    </section>
    <section aria-labelledby="conflict-heading">
      <h2 id="conflict-heading">Conflicting reports</h2>
      <p class="section-lede">Some people confirmed these trees and others questioned them, so no finding is shown. They need a look on site.</p>
      ${conflicting}
    </section>
  </main>
  <footer class="site-foot">
    <p>Created and curated by AI with oversight from <a href="https://simonmcmanus.com">Simon McManus</a>. AI can make mistakes, please <a href="https://github.com/simonmcmanus/epping-forest-finds/issues">report them here</a>.</p>
    <p><a href="/terms.html">Privacy &amp; terms</a></p>
  </footer>
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
