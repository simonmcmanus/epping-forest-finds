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
const { escapeHtml, replaceOnce, showConsentBannerByDefault, customizeConsentBannerText } = require("./lib/html-template.js");

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

const APP_INSPECTOR_TITLE = '<h2 id="inspectorTitle">Epping Forest Finds</h2>';
const APP_INSPECTOR_TYPE = '<p id="inspectorType" class="type"></p>';
const APP_INSPECTOR_EMOJI = '<span id="inspectorTitleEmoji" class="inspector-title-emoji" aria-hidden="true" hidden></span>';

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

  const singularLabel = singular.charAt(0).toUpperCase() + singular.slice(1);
  const rulesSubfilter = (key) => {
    for (const g of rules.FILTER_GROUPS) {
      const found = g.subfilters.find((s) => s.key === key);
      if (found) return found;
    }
    return null;
  };
  const iconFor = (name) => rules.appIconHtml(name);

  // The same rows the live inspector's detailsHtml() renders for a place (js/inspector.js): a
  // website shows its hostname, a phone number is a tel: link.
  const websiteLabel = (value) => {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch (_) {
      return value;
    }
  };
  const detailValue = (label, value) => {
    if (label === "Website") return `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(websiteLabel(value))}</a>`;
    if (label === "Phone") return `<a href="tel:${escapeHtml(value)}">${escapeHtml(value)}</a>`;
    return escapeHtml(value);
  };
  const detailRowsHtml = [
    ["Address", entry.address],
    ["Website", entry.website],
    ["Phone", entry.phone],
    ["Opening hours", entry.openingHours],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${detailValue(label, value)}</dd></div>`)
    .join("");

  // A folklore-sourced record's own narrative -- genuinely unique text, not computed from the
  // same name/address/category fields every other page already shows. Only ~1% of entries have
  // one, so this is additive, never a gap on the other 99%.
  const summaryHtml = entry.summary ? `<p class="details-description">${escapeHtml(entry.summary)}</p>` : "";

  // Walk times are not computed here (the reader's position is unknown without JS, and cattle move),
  // so these cards name each category without a distance. Once JS boots, the live inspector swaps
  // them for its own walk-time cards (nearbySectionsHtml, js/inspector.js) -- same .nearest-item card
  // shape and section headings. Each link carries this place's own position through the target
  // page's existing "near=<lat>,<lon>" anchor route (nearbyAnchorRouteValue, js/app.js -- same format,
  // reproduced here since this runs in Node, not the browser).
  const anchorHash = entry.lat != null && entry.lon != null
    ? `#near=${entry.lat.toFixed(6)}%2C${entry.lon.toFixed(6)}`
    : "";
  const cardHtml = (href, icon, name, copy) =>
    `<li><a class="nearest-item nearby-link" href="${escapeHtml(href)}">` +
    `<span class="nearest-icon" aria-hidden="true">${icon}</span>` +
    `<div class="nearest-content"><div class="nearest-header"><span class="nearest-name">${escapeHtml(name)}</span></div>` +
    (copy ? `<div class="nearest-footer"><span class="nearest-meta">${escapeHtml(copy)}</span></div>` : "") +
    `</div></a></li>`;

  // Names only, as the live cards read once they are walk-timed: the static page has no walk time or
  // count to add, so no footer sentence either.
  const treesSub = rulesSubfilter("trees");
  const cowsSub = rulesSubfilter("cows");
  const nearestHtml =
    `<h3 class="detail-section-heading">Nearby</h3><ul class="nearest-list related-cards">` +
    (treesSub ? cardHtml(`/nearby/trees/${anchorHash}`, iconFor(treesSub.icon), "Nearest veteran tree", "") : "") +
    (cowsSub ? cardHtml(`/nearby/cows/${anchorHash}`, iconFor(cowsSub.icon), "The grazing cattle", "") : "") +
    cardHtml(`/nearby/${anchorHash}`, iconFor("walking"), "Everything nearby", "") +
    `</ul>`;

  const relatedHtml = subfilter && group
    ? `<h3 class="detail-section-heading">Related</h3><ul class="nearest-list related-cards">` +
      cardHtml(`/nearby/${subfilterSlug}/`, iconFor(subfilter.icon), subfilter.label, "") +
      cardHtml(`/nearby/${groupSlug}/`, iconFor(group.icon), group.label, "") +
      `</ul>`
    : "";

  const nearby = nearestBusinesses(entry, index).filter((n) => n.metres <= 1000);
  const nearbyHtml = nearby.length
    ? `<h3 class="detail-section-heading">Places close by</h3><ul class="nearest-list related-cards">${nearby
        .map((n) => {
          const sub = rulesSubfilter(n.key);
          return cardHtml(`/find/${n.slug}/`, sub ? iconFor(sub.icon) : "", n.name, `${formatMetres(n.metres)} away`);
        })
        .join("")}</ul>`
    : "";

  const mapsHtml = entry.lat != null && entry.lon != null
    ? `<a class="detail-map-link" href="https://maps.google.com/?q=${entry.lat.toFixed(6)},${entry.lon.toFixed(6)}" target="_blank" rel="noreferrer">Open in Maps</a>`
    : "";

  // The live panel shows no intro paragraph: the description sits in the page's meta tags, and the
  // visible body is the place's own details and its sections.
  const seoContent =
    (mapsHtml ? `<div class="detail-top-row">${mapsHtml}</div>` : "") +
    summaryHtml +
    (detailRowsHtml ? `<dl>${detailRowsHtml}</dl>` : "") +
    nearestHtml +
    relatedHtml +
    nearbyHtml;
  const headerIconHtml = subfilter ? iconFor(subfilter.icon) : "";

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
  // The header the live page sets through setInspectorSelectionChrome() and detail views: the
  // business's own name, its category, and its category icon -- not the app's generic title.
  html = replaceOnce(html, APP_INSPECTOR_TITLE, `<h2 id="inspectorTitle">${escapeHtml(entry.name)}</h2>`, "inspector title");
  html = replaceOnce(html, APP_INSPECTOR_TYPE, `<p id="inspectorType" class="type">${escapeHtml(singularLabel)}</p>`, "inspector type");
  if (headerIconHtml) {
    html = replaceOnce(html, APP_INSPECTOR_EMOJI, `<span id="inspectorTitleEmoji" class="inspector-title-emoji" aria-hidden="true">${headerIconHtml}</span>`, "inspector title emoji");
  }
  html = replaceOnce(html, APP_EMPTY_STATE, seoContent, "initial inspector empty-state paragraph");
  // Unlike every other /find/<slug>/ page, /find/events/ itself is excluded from
  // isLandingPageArrival() (js/app.js -- "events" is the one /find/ path that isn't a business
  // of its own), so it never shows the combined consent banner live and must keep app.html's own
  // hidden default, not get this treatment.
  html = customizeConsentBannerText(html, `Enable location to get walking directions and see how far you are from ${escapeHtml(entry.name)}`);
  return showConsentBannerByDefault(html);
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
