#!/usr/bin/env node
"use strict";

/**
 * Generates one crawlable page per individual business/location --
 * find/the-forresters/index.html, served at /find/the-forresters/ -- plus
 * one events index page (find/events/). Templates off the real app.html,
 * exactly like generate-find-pages.js's category pages: same DOM, same
 * <script src> list, same CSS, so a crawler sees real content and js/app.js
 * then boots the real interactive map underneath it.
 *
 * Reads data/business-slugs.json (committed, built by
 * scripts/regenerate-business-slugs.js) rather than reclassifying places
 * itself -- the live app and the Ledger renderer link to these same slugs,
 * so the page generator must never compute a different one.
 *
 * Run directly: node scripts/generate-business-pages.js
 * Wired into `npm run build` alongside generate-find-pages.js.
 */

const fs = require("node:fs");
const path = require("node:path");

const { loadAppRules } = require("./report/map-inventory.js");
const { escapeHtml, replaceOnce } = require("./lib/html-template.js");

const SITE_ORIGIN = "https://www.eppingforestfinds.uk";
const SITE_NAME = "Epping Forest Finds";
const BUSINESS_DIR_NAME = "find";
const APP_HTML_NAME = "app.html";
const BUSINESS_SLUGS_PATH = path.join(__dirname, "..", "data", "business-slugs.json");
const FOREST_EVENTS_PATH = path.join(__dirname, "..", "data", "forest-events.json");
const SAMPLE_EVENTS_PATH = path.join(__dirname, "..", "data", "events.json");

// "events" is reserved for the events index below -- a business can never
// slug to it (regenerate-business-slugs.js's slugify would have to produce
// exactly "events" from a name, astronomically unlikely, but checked at
// build time anyway per the same discipline generate-find-pages.js uses for
// RESERVED_SLUGS).
const RESERVED_SLUGS = new Set(["events"]);

const APP_TITLE = "<title>Epping Forest Finds — offline map of Epping Forest</title>";
const APP_DESCRIPTION_META =
  '<meta name="description" content="A free offline map of Epping Forest. Find veteran trees, pubs, cafés, car parks, toilets, paths and stations near you, see where the forest\'s grazing cattle are, and keep working with no phone signal.">';
const APP_CANONICAL = '<link rel="canonical" href="https://www.eppingforestfinds.uk/nearby">';
const APP_OG_TITLE = '<meta property="og:title" content="Epping Forest Finds — offline map of Epping Forest">';
const APP_OG_DESCRIPTION =
  '<meta property="og:description" content="A free offline map of Epping Forest: veteran trees, pubs and cafés, paths, car parks and the forest\'s grazing cattle — working with no phone signal.">';
const APP_OG_URL = '<meta property="og:url" content="https://www.eppingforestfinds.uk/nearby">';
const APP_EMPTY_STATE =
  '<p class="empty">All veteran trees are shown. Use your location to mark yourself on the map and select the nearest tree, cow, or place.</p>';

// Singular, natural-language label per subfilter -- "X is a pub", not "X is a pubs".
const SINGULAR_LABEL = {
  pubs: "pub",
  restaurants: "restaurant",
  cafes: "café",
  shops: "shop",
  churches: "church",
  education: "educational institution",
  medicine: "medical site",
  campsites: "campsite",
};

// schema.org type per subfilter, for the per-page LocalBusiness JSON-LD.
const SCHEMA_TYPE = {
  pubs: "BarOrPub",
  restaurants: "Restaurant",
  cafes: "CafeOrCoffeeShop",
  shops: "Store",
  churches: "Church",
  education: "School",
  medicine: "MedicalClinic",
  campsites: "Campground",
};

function loadBusinessIndex() {
  if (!fs.existsSync(BUSINESS_SLUGS_PATH)) return [];
  return JSON.parse(fs.readFileSync(BUSINESS_SLUGS_PATH, "utf8")).entries;
}

function slugForFilterKey(key) {
  return key.replace(/_/g, "-");
}

/** Every business belonging to a subfilter key ("pubs") or a group key
 * ("food") -- used both to render a category page's real listing
 * (generate-find-pages.js) and, here, a business's own up-links. */
function listBusinessesForFilterKey(key, index = loadBusinessIndex()) {
  return index
    .filter((entry) => entry.key === key || entry.groupKey === key)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const EARTH_RADIUS_METRES = 6371000;
function haversineMetres(a, b) {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The nearest `limit` other businesses by real distance -- genuinely unique
 * per page (see spec-marketing.md discussion in PR), never a copy-pasted list. */
function nearestBusinesses(entry, index, limit = 6) {
  return index
    .filter((other) => other.slug !== entry.slug)
    .map((other) => ({ other, metres: haversineMetres(entry, other) }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit)
    .map(({ other, metres }) => ({ ...other, metres: Math.round(metres) }));
}

function formatMetres(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)}km` : `${metres}m`;
}

function renderBusinessPage(entry, appHtml, rules, index) {
  const canonical = `${SITE_ORIGIN}/find/${entry.slug}/`;
  const singular = SINGULAR_LABEL[entry.key] || "place";
  const titleTag = `${entry.name} – ${singular} in Epping Forest | ${SITE_NAME}`;
  const distancePhrase =
    entry.distanceToForestBoundaryMetres != null
      ? `${formatMetres(Math.round(entry.distanceToForestBoundaryMetres))} from the forest boundary`
      : "near Epping Forest";
  const description = `${entry.name} is a ${singular} ${distancePhrase}${entry.address ? `, at ${entry.address}` : ""}. Find it on the free offline Epping Forest Finds map, with walking directions and what else is nearby.`;

  const group = rules.FILTER_GROUPS.find((g) => g.key === entry.groupKey);
  const subfilter = group && group.subfilters.find((s) => s.key === entry.key);
  const subfilterSlug = slugForFilterKey(entry.key);
  const groupSlug = slugForFilterKey(entry.groupKey);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPE[entry.key] || "LocalBusiness",
    name: entry.name,
    url: canonical,
    ...(entry.address ? { address: { "@type": "PostalAddress", streetAddress: entry.address } } : {}),
    ...(entry.lat != null && entry.lon != null ? { geo: { "@type": "GeoCoordinates", latitude: entry.lat, longitude: entry.lon } } : {}),
    ...(entry.phone ? { telephone: entry.phone } : {}),
    ...(entry.website ? { sameAs: entry.website } : {}),
    ...(entry.openingHours ? { openingHours: entry.openingHours } : {}),
  };

  const detailRows = [
    entry.address ? `<li>${escapeHtml(entry.address)}</li>` : "",
    entry.phone ? `<li><a href="tel:${escapeHtml(entry.phone)}">${escapeHtml(entry.phone)}</a></li>` : "",
    entry.website ? `<li><a href="${escapeHtml(entry.website)}" rel="noopener">${escapeHtml(entry.website)}</a></li>` : "",
    entry.openingHours ? `<li>Opening hours: ${escapeHtml(entry.openingHours)}</li>` : "",
  ]
    .filter(Boolean)
    .join("");

  // A folklore-sourced record's own narrative -- genuinely unique text, not computed from the
  // same name/address/category fields every other page already shows. Only ~1% of entries have
  // one, so this is additive, never a gap on the other 99%.
  const summaryHtml = entry.summary ? `<p>${escapeHtml(entry.summary)}</p>` : "";

  const nearby = nearestBusinesses(entry, index).filter((n) => n.metres <= 1000);
  const nearbyHtml = nearby.length
    ? `<p>Nearby:</p><ul>${nearby
        .map((n) => `<li><a href="/find/${escapeHtml(n.slug)}/">${escapeHtml(n.name)}</a> (${formatMetres(n.metres)})</li>`)
        .join("")}</ul>`
    : "";

  // No walk-time here -- cattle move (and even a tree's isn't worth computing build-time, since
  // the live page recomputes it anyway), so this is the honest no-JS version of the link. The
  // live page (js/inspector.js's relatedCategoryLinksHtml) upgrades both links with a real,
  // freshly-computed walk time once JS boots. Both links still carry this place's own position via
  // the target page's existing "near=<lat>,<lon>" anchor route (nearbyAnchorRouteValue, js/app.js
  // -- same format, reproduced here since this runs in Node, not the browser) -- once JS boots on
  // whichever page a link lands on, it anchors that view to this business's own spot rather than
  // the reader's GPS fix.
  const anchorHash = entry.lat != null && entry.lon != null
    ? `#near=${entry.lat.toFixed(6)}%2C${entry.lon.toFixed(6)}`
    : "";
  const treesHref = `/nearby/trees/${anchorHash}`;
  const cowsHref = `/nearby/cows/${anchorHash}`;
  const seeAlso = `See also <a href="${treesHref}">veteran trees</a> and <a href="${cowsHref}">grazing cattle</a> near Epping Forest.`;
  const upLinks = subfilter && group
    ? `<p>Part of <a href="/nearby/${escapeHtml(subfilterSlug)}/">${escapeHtml(subfilter.label)}</a> in <a href="/nearby/${escapeHtml(groupSlug)}/">${escapeHtml(group.label)}</a>. ${seeAlso}</p>`
    : `<p>${seeAlso}</p>`;

  const seoContent =
    `<p>${escapeHtml(description)}</p>` +
    summaryHtml +
    (detailRows ? `<ul>${detailRows}</ul>` : "") +
    nearbyHtml +
    upLinks;

  let html = appHtml;
  html = replaceOnce(html, APP_TITLE, `<title>${escapeHtml(titleTag)}</title>`, "title");
  html = replaceOnce(html, APP_DESCRIPTION_META, `<meta name="description" content="${escapeHtml(description)}">`, "meta description");
  html = replaceOnce(html, APP_CANONICAL, `<link rel="canonical" href="${canonical}">`, "canonical link");
  html = replaceOnce(html, APP_OG_TITLE, `<meta property="og:title" content="${escapeHtml(entry.name)} in Epping Forest">`, "og:title");
  html = replaceOnce(html, APP_OG_DESCRIPTION, `<meta property="og:description" content="${escapeHtml(description)}">`, "og:description");
  html = replaceOnce(html, APP_OG_URL, `<meta property="og:url" content="${canonical}">`, "og:url");
  // No separate inline origin script: landing on this page's own URL already selects this exact
  // business through the ordinary deep-link boot path (applySelectionFromHash ->
  // routeValueFromLocation's /find/<slug>/ case, js/app.js) -- a second, build-time-only
  // "anchor near here" mechanism would only ever get immediately overwritten by that selection
  // (showRoutedSelection clears state.nearbyAnchor), so it was dead weight.
  html = replaceOnce(
    html,
    "</head>",
    `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`,
    "</head>"
  );
  html = replaceOnce(html, APP_EMPTY_STATE, seoContent, "initial inspector empty-state paragraph");
  return html;
}

function renderEventsIndexPage(appHtml, events) {
  const canonical = `${SITE_ORIGIN}/find/events/`;
  const titleTag = `Events near Epping Forest | ${SITE_NAME}`;
  const description = `${events.length} upcoming and recent events in and around Epping Forest, from guided walks to litter picks and local fairs.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Events near Epping Forest",
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
  };
  const itemsHtml = events.length
    ? `<ul>${events
        .map((e) => {
          const when = e.date || (e.recurring ? "Recurring" : "Date to be confirmed");
          const place = e.place ? ` — ${escapeHtml(e.place)}` : "";
          const link = e.sourceUrl ? ` <a href="${escapeHtml(e.sourceUrl)}" rel="noopener">More info</a>` : "";
          return `<li><strong>${escapeHtml(e.title)}</strong> (${escapeHtml(when)})${place}: ${escapeHtml(e.body || "")}${link}</li>`;
        })
        .join("")}</ul>`
    : `<p>No events are currently listed.</p>`;
  const seoContent = `<p>${escapeHtml(description)}</p>${itemsHtml}`;

  let html = appHtml;
  html = replaceOnce(html, APP_TITLE, `<title>${escapeHtml(titleTag)}</title>`, "title");
  html = replaceOnce(html, APP_DESCRIPTION_META, `<meta name="description" content="${escapeHtml(description)}">`, "meta description");
  html = replaceOnce(html, APP_CANONICAL, `<link rel="canonical" href="${canonical}">`, "canonical link");
  html = replaceOnce(html, APP_OG_TITLE, `<meta property="og:title" content="${escapeHtml(titleTag)}">`, "og:title");
  html = replaceOnce(html, APP_OG_DESCRIPTION, `<meta property="og:description" content="${escapeHtml(description)}">`, "og:description");
  html = replaceOnce(html, APP_OG_URL, `<meta property="og:url" content="${canonical}">`, "og:url");
  html = replaceOnce(html, "</head>", `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`, "</head>");
  html = replaceOnce(html, APP_EMPTY_STATE, seoContent, "initial inspector empty-state paragraph");
  return html;
}

function loadEvents(root) {
  const events = [];
  const forestEventsPath = path.join(root, "data", "forest-events.json");
  if (fs.existsSync(forestEventsPath)) {
    const data = JSON.parse(fs.readFileSync(forestEventsPath, "utf8"));
    for (const e of data.entries || []) events.push({ title: e.title, date: e.date, place: e.place, body: e.body, recurring: e.recurring, sourceUrl: e.sources && e.sources[0] && e.sources[0].url });
  }
  const sampleEventsPath = path.join(root, "data", "events.json");
  if (fs.existsSync(sampleEventsPath)) {
    const data = JSON.parse(fs.readFileSync(sampleEventsPath, "utf8"));
    for (const e of data.events || []) events.push({ title: e.name, date: e.startsAt && e.startsAt.slice(0, 10), place: null, body: e.description, sourceUrl: e.sourceUrl });
  }
  return events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function generate(siteRoot = path.join(__dirname, ".."), index = loadBusinessIndex()) {
  const rules = loadAppRules();
  const appHtml = fs.readFileSync(path.join(siteRoot, APP_HTML_NAME), "utf8");
  const businessDir = path.join(siteRoot, BUSINESS_DIR_NAME);
  fs.mkdirSync(businessDir, { recursive: true });

  const pages = [];
  for (const entry of index) {
    if (RESERVED_SLUGS.has(entry.slug)) {
      throw new Error(`[generate-business-pages] slug "${entry.slug}" collides with a reserved /find/ page`);
    }
    const pageDir = path.join(businessDir, entry.slug);
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, "index.html"), renderBusinessPage(entry, appHtml, rules, index), "utf8");
    pages.push(entry.slug);
  }

  const events = loadEvents(siteRoot);
  const eventsDir = path.join(businessDir, "events");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(path.join(eventsDir, "index.html"), renderEventsIndexPage(appHtml, events), "utf8");
  pages.push("events");

  return pages;
}

function listBusinessSlugs(siteRoot) {
  const businessDir = path.join(siteRoot, BUSINESS_DIR_NAME);
  if (!fs.existsSync(businessDir)) return [];
  return fs
    .readdirSync(businessDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(businessDir, entry.name, "index.html")))
    .map((entry) => entry.name)
    .sort();
}

module.exports = {
  loadBusinessIndex,
  listBusinessesForFilterKey,
  nearestBusinesses,
  haversineMetres,
  renderBusinessPage,
  renderEventsIndexPage,
  loadEvents,
  generate,
  listBusinessSlugs,
  BUSINESS_DIR_NAME,
  RESERVED_SLUGS,
};

if (require.main === module) {
  const pages = generate();
  console.log(`[generate-business-pages] wrote ${pages.length} page(s) under find/.`);
}
