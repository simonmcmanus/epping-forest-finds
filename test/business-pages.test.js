const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  listBusinessesForFilterKey,
  nearestBusinesses,
  haversineMetres,
  renderBusinessPage,
  renderEventsIndexPage,
  generate,
  listBusinessSlugs,
} = require("../scripts/generate-business-pages.js");
const { loadAppRules } = require("../scripts/report/map-inventory.js");

const REPO_ROOT = path.join(__dirname, "..");
const APP_HTML = fs.readFileSync(path.join(REPO_ROOT, "app.html"), "utf8");

const FAKE_INDEX = [
  { slug: "the-forresters", key: "pubs", groupKey: "food", name: "The Forresters", address: "1 High St, Loughton", phone: "01234", website: "https://example.com", lat: 51.65, lon: 0.05, distanceToForestBoundaryMetres: 120, openingHours: "Mo-Su 11:00-23:00", summary: "A folklore note about this pub.", verifiedAt: "2026-10-16", id: "node/1" },
  { slug: "the-oak-cafe", key: "cafes", groupKey: "food", name: "The Oak Café", address: null, phone: null, website: null, lat: 51.6501, lon: 0.0501, distanceToForestBoundaryMetres: 80, openingHours: null, summary: null, verifiedAt: null, id: "node/2" },
  { slug: "far-away-shop", key: "shops", groupKey: "food", name: "Far Away Shop", address: null, phone: null, website: null, lat: 52.0, lon: 1.0, distanceToForestBoundaryMetres: 5000, openingHours: null, summary: null, verifiedAt: null, id: "node/3" },
];

test("haversineMetres returns a small distance for nearby points and a large one for far ones", () => {
  assert.ok(haversineMetres(FAKE_INDEX[0], FAKE_INDEX[1]) < 100);
  assert.ok(haversineMetres(FAKE_INDEX[0], FAKE_INDEX[2]) > 10000);
});

test("nearestBusinesses excludes the entry itself and sorts by real distance", () => {
  const nearest = nearestBusinesses(FAKE_INDEX[0], FAKE_INDEX, 10);
  assert.equal(nearest.length, 2);
  assert.ok(!nearest.some((n) => n.slug === FAKE_INDEX[0].slug));
  assert.equal(nearest[0].slug, "the-oak-cafe", "the nearer place sorts first");
});

test("listBusinessesForFilterKey matches a subfilter key or its group, sorted by name", () => {
  const pubs = listBusinessesForFilterKey("pubs", FAKE_INDEX);
  assert.deepEqual(pubs.map((p) => p.slug), ["the-forresters"]);
  const food = listBusinessesForFilterKey("food", FAKE_INDEX);
  assert.deepEqual(food.map((p) => p.name), ["Far Away Shop", "The Forresters", "The Oak Café"]);
});

test("renderBusinessPage swaps in a unique title, canonical, OG and LocalBusiness JSON-LD", () => {
  const rules = loadAppRules();
  const html = renderBusinessPage(FAKE_INDEX[0], APP_HTML, rules, FAKE_INDEX);

  assert.match(html, /<title>The Forresters – pub in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/find\/the-forresters\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.eppingforestfinds\.uk\/find\/the-forresters\/">/);
  assert.match(html, /"@type":"BarOrPub"/);
  assert.match(html, /"name":"The Forresters"/);
  assert.ok(!html.includes("offline map of Epping Forest</title>"), "the generic /nearby title is gone");
});

test("renderBusinessPage's visible content includes address, phone, website and distance without any JS", () => {
  const rules = loadAppRules();
  const html = renderBusinessPage(FAKE_INDEX[0], APP_HTML, rules, FAKE_INDEX);

  assert.match(html, /120m from the forest boundary/);
  assert.match(html, /1 High St, Loughton/);
  assert.match(html, /href="tel:01234"/);
  assert.match(html, /href="https:\/\/example\.com"/);
});

test("renderBusinessPage lists real nearby businesses by distance, linking to their own /find/ pages", () => {
  const rules = loadAppRules();
  const html = renderBusinessPage(FAKE_INDEX[0], APP_HTML, rules, FAKE_INDEX);

  assert.match(html, /href="\/find\/the-oak-cafe\/"/);
  assert.ok(!html.includes('href="/find/far-away-shop/"'), "a 5km-away place is outside the nearby radius");
});

test("renderBusinessPage links up to its subfilter and group category pages, and to /nearby/trees/ and /nearby/cows/", () => {
  const rules = loadAppRules();
  const html = renderBusinessPage(FAKE_INDEX[0], APP_HTML, rules, FAKE_INDEX);

  assert.match(html, /href="\/nearby\/pubs\/"/);
  assert.match(html, /href="\/nearby\/food\/"/);
  assert.match(html, /href="\/nearby\/trees\/"/);
  // Carries this business's own position via /nearby/cows/'s existing "near=<lat>,<lon>" anchor
  // route, so landing there re-centres on the business rather than the reader's own GPS fix.
  assert.match(html, /href="\/nearby\/cows\/#near=51\.650000%2C0\.050000"/);
});

test("renderBusinessPage's cows link falls back to a plain /nearby/cows/ when the entry has no coordinates", () => {
  const rules = loadAppRules();
  const noCoords = { ...FAKE_INDEX[0], lat: null, lon: null };
  const html = renderBusinessPage(noCoords, APP_HTML, rules, FAKE_INDEX);
  assert.match(html, /href="\/nearby\/cows\/"/);
  assert.ok(!html.includes("/nearby/cows/#near="));
});

test("renderBusinessPage shows opening hours and a folklore summary when present, and omits them when absent", () => {
  const rules = loadAppRules();
  const withExtras = renderBusinessPage(FAKE_INDEX[0], APP_HTML, rules, FAKE_INDEX);
  assert.match(withExtras, /Opening hours: Mo-Su 11:00-23:00/);
  assert.match(withExtras, /A folklore note about this pub\./);
  // Distances (the Nearby list, the trees/cows links) are computed from the site's own data, not
  // fetched from OpenStreetMap, so nothing on the page credits it as a source for them.
  assert.ok(!withExtras.includes("OpenStreetMap"));

  const withoutExtras = renderBusinessPage(FAKE_INDEX[1], APP_HTML, rules, FAKE_INDEX);
  assert.ok(!withoutExtras.includes("Opening hours:"));
});

test("renderEventsIndexPage lists every event with its date and source link", () => {
  const events = [{ title: "Autumn Fair", date: "2026-10-13", place: "Visitor Centre", body: "Stalls and crafts.", sourceUrl: "https://example.com/fair" }];
  const html = renderEventsIndexPage(APP_HTML, events);
  assert.match(html, /<title>Events near Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /Autumn Fair/);
  assert.match(html, /href="https:\/\/example\.com\/fair"/);
});

test("renderEventsIndexPage handles an empty event list without crashing", () => {
  const html = renderEventsIndexPage(APP_HTML, []);
  assert.match(html, /No events are currently listed/);
});

test("generate writes one page per business under find/<slug>/, plus find/events/, and listBusinessSlugs finds them back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "business-pages-test-"));
  fs.copyFileSync(path.join(REPO_ROOT, "app.html"), path.join(dir, "app.html"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "forest-events.json"), JSON.stringify({ entries: [] }));

  const pages = generate(dir, FAKE_INDEX);
  assert.equal(pages.length, FAKE_INDEX.length + 1, "one page per business plus the events index");

  for (const entry of FAKE_INDEX) {
    assert.ok(fs.existsSync(path.join(dir, "find", entry.slug, "index.html")));
  }
  assert.ok(fs.existsSync(path.join(dir, "find", "events", "index.html")));
  assert.deepEqual(listBusinessSlugs(dir), ["events", "far-away-shop", "the-forresters", "the-oak-cafe"]);
});

test("no real business slug collides with the reserved /find/events/ index", () => {
  const { loadBusinessIndex } = require("../scripts/generate-business-pages.js");
  const index = loadBusinessIndex();
  assert.ok(!index.some((entry) => entry.slug === "events"));
});

test("listBusinessSlugs returns nothing for a site that has not generated any business pages yet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "business-pages-empty-"));
  assert.deepEqual(listBusinessSlugs(dir), []);
});
