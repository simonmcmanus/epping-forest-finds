const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  collectPages,
  renderPage,
  renderEventsPage,
  renderCowsPage,
  generate,
  listFindSlugs,
  slugFor,
  loadWaterFeatures,
  nearestWithinWalkingRadius,
} = require("../scripts/generate-find-pages.js");
const { loadAppRules } = require("../scripts/report/map-inventory.js");

const REPO_ROOT = path.join(__dirname, "..");
const APP_HTML = fs.readFileSync(path.join(REPO_ROOT, "app.html"), "utf8");

const FAKE_RULES = {
  FILTER_GROUPS: [
    {
      key: "food",
      label: "Food",
      subfilters: [
        { key: "pubs", label: "Pubs & bars", title: "pubs and bars" },
        { key: "cafes", label: "Cafés", title: "cafés" },
      ],
    },
  ],
};

const FAKE_INVENTORY = {
  groups: [
    {
      key: "food",
      label: "Food",
      subfilters: [
        { key: "pubs", label: "Pubs & bars", count: 42 },
        { key: "cafes", label: "Cafés", count: 7 },
      ],
    },
  ],
};

test("slugFor turns an underscored filter key into a URL-friendly slug", () => {
  assert.equal(slugFor("national_rail"), "national-rail");
  assert.equal(slugFor("pubs"), "pubs");
});

test("collectPages produces one page per subfilter, each carrying its siblings but not itself", () => {
  const pages = collectPages(FAKE_RULES, FAKE_INVENTORY);
  assert.equal(pages.length, 3, "two subfilter pages plus one group page for \"food\"");

  const pubs = pages.find((p) => p.key === "pubs");
  assert.equal(pubs.slug, "pubs");
  assert.equal(pubs.count, 42);
  assert.equal(pubs.title, "pubs and bars");
  assert.equal(pubs.groupLabel, "Food");
  assert.equal(pubs.groupSlug, "food", "a subfilter page can link back up to its own group page");
  assert.deepEqual(pubs.siblings.map((s) => s.key), ["cafes"], "a page lists its siblings, never itself");
});

test("collectPages also produces one page per top-level group, summing its members' counts", () => {
  const pages = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const food = pages.find((p) => p.key === "food");
  assert.ok(food, "the \"food\" group gets a page of its own");
  assert.equal(food.isGroup, true);
  assert.equal(food.slug, "food");
  assert.equal(food.label, "Food");
  assert.equal(food.count, 49, "42 pubs + 7 cafes");
  assert.deepEqual(food.members.map((m) => m.key), ["pubs", "cafes"], "every subfilter in the group, not just some");
});

test("a group with no entry in GROUP_TITLES gets no page of its own", () => {
  const rules = { FILTER_GROUPS: [{ key: "events", label: "Events", subfilters: [{ key: "events", label: "Events", title: "events" }] }] };
  const inventory = { groups: [{ key: "events", label: "Events", subfilters: [{ key: "events", label: "Events", count: 3 }] }] };
  const pages = collectPages(rules, inventory);
  assert.equal(pages.length, 1, "just the subfilter page -- no group page for a group GROUP_TITLES has no phrase for");
  assert.equal(pages[0].isGroup, undefined);
});

test("renderPage inserts <base href=\"/\"> right after <meta charset>, before any relative URL on the page", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);

  const charsetIndex = html.indexOf('<meta charset="utf-8">');
  const baseIndex = html.indexOf('<base href="/">');
  assert.ok(charsetIndex !== -1 && baseIndex !== -1);
  assert.ok(baseIndex > charsetIndex, "<base> comes after <meta charset> but before everything else");

  // app.html's own relative references are left completely untouched -- <base> is what makes
  // them resolve correctly from /nearby/<slug>/, not a rewrite of the references themselves.
  assert.match(html, /href="css\/base\.css"/);
  assert.match(html, /src="js\/app\.js"/);
});

test("renderPage produces the real app shell -- same scripts and canvas -- not a separate marketing page", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);

  assert.match(html, /id="mapCanvas"/, "the real interactive map canvas is present");
  assert.match(html, /<script src="js\/app\.js"><\/script>/, "the real app script boots this page");
  assert.match(html, /<script src="js\/categories\.js"><\/script>/);
});

test("renderPage swaps in the category's own title, canonical, OG and JSON-LD, never the generic /nearby ones", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);

  assert.match(html, /<title>42 Pubs &amp; bars in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/nearby\/pubs\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.eppingforestfinds\.uk\/nearby\/pubs\/">/);
  assert.match(html, /"numberOfItems":42/);
  assert.ok(!html.includes("offline map of Epping Forest</title>"), "the generic /nearby title is gone");
  assert.ok(!html.includes('href="https://www.eppingforestfinds.uk/nearby">'), "the generic /nearby canonical is gone");
});

test("renderPage replaces the app's initial empty-state message with real, crawlable category content and sibling links", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);

  assert.ok(!html.includes("All veteran trees are shown"), "the generic placeholder text is gone");
  assert.match(html, /Browse nearby categories/);
  assert.match(html, /<h3 id="nearbyResultsHeading">Pubs &amp; bars nearby<\/h3>/);
  assert.match(html, /Find all 42 pubs and bars in Epping Forest/);
  assert.match(html, /href="\/nearby\/cafes\/"/, "a sibling cross-link uses the trailing slash Netlify serves directly");
  assert.match(html, /More in <a href="\/nearby\/food\/">Food<\/a>/, "and links back up to its own group page");
});

test("renderPage renders a group page's own title, count and member pills, promoted to the top chip row", () => {
  const food = collectPages(FAKE_RULES, FAKE_INVENTORY).find((p) => p.isGroup);
  const html = renderPage(food, APP_HTML);

  assert.match(html, /<title>Food in Epping Forest — 49 places \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/nearby\/food\/">/);
  assert.match(html, /"numberOfItems":49/, "the group's count is its members' counts summed");
  assert.match(html, /Find all 49 places to eat, drink and shop in Epping Forest/);
  // "Browse by type" used to be a bottom paragraph of plain links -- now a pill per member, in
  // the same top chip row as the breadcrumb (categoryLandingLinksHtml's own live equivalent,
  // js/app.js), so it survives selectOverview() replacing the rest of the body the instant JS
  // boots instead of vanishing with it.
  const topRow = /<div class="detail-top-row related-chips">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.match(topRow, /<a class="detail-map-link nearby-link" href="\/nearby\/pubs\/">[\s\S]*?Pubs &amp; bars[\s\S]*?<\/a>/, "a pill per member, not a comma-separated sentence");
  assert.match(topRow, /Cafés/);
});

test("renderPage links out to veteran trees and grazing cattle as pills in the top chip row, the same up-link every /find/<slug>/ business page carries", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);
  const topRow = /<div class="detail-top-row related-chips">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.match(topRow, /<a class="detail-map-link nearby-link" href="\/nearby\/trees\/">[\s\S]*?Trees<\/a>/);
  assert.match(topRow, /<a class="detail-map-link nearby-link" href="\/nearby\/cows\/">[\s\S]*?Cows<\/a>/);
});

test("renderPage's own trees pill marks the current page and never doubles up with the nature group's own type pill", () => {
  const treesPage = { key: "trees", slug: "trees", label: "Trees", title: "trees", count: 24906, groupLabel: "Nature", groupSlug: "nature", siblings: [] };
  const html = renderPage(treesPage, APP_HTML);
  assert.match(html, /nearby-link--current[^>]*href="\/nearby\/trees\/"|href="\/nearby\/trees\/"[^>]*nearby-link--current/, "the trees page marks itself as current");
  assert.match(html, /<a class="detail-map-link nearby-link" href="\/nearby\/cows\/">[\s\S]*?Cows<\/a>/);

  const naturePage = { key: "nature", slug: "nature", label: "Nature", title: "trees and water features", count: 25017, isGroup: true, members: [{ key: "trees", slug: "trees", label: "Trees" }, { key: "ponds_streams", slug: "ponds-streams", label: "Ponds & streams" }] };
  const natureHtml = renderPage(naturePage, APP_HTML);
  const topRow = /<div class="detail-top-row related-chips">([\s\S]*?)<\/div>/.exec(natureHtml)[1];
  assert.equal((topRow.match(/href="\/nearby\/trees\/"/g) || []).length, 1, "the nature group's own \"Trees\" type pill is the only trees link -- the see-also row doesn't repeat it");
  assert.match(topRow, /href="\/nearby\/cows\/"/);
});

test("renderEventsPage lists real event titles/dates, links to the fuller /find/events/ listing, and carries the same see-also pills", () => {
  const events = [{ title: "Autumn Fair", date: "2026-10-13" }, { title: "Recurring litter pick", date: null }];
  const html = renderEventsPage(APP_HTML, events);
  assert.match(html, /<title>2 Events in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/nearby\/events\/">/);
  assert.match(html, /Autumn Fair \(2026-10-13\)/);
  assert.match(html, /Recurring litter pick<\/li>/, "an event with no date still lists, just without a parenthetical");
  assert.match(html, /href="\/find\/events\/"/);
  assert.match(html, /<a class="detail-map-link nearby-link" href="\/nearby\/trees\/">[\s\S]*?Trees<\/a>/);
  assert.match(html, /<a class="detail-map-link nearby-link" href="\/nearby\/cows\/">[\s\S]*?Cows<\/a>/);
});

test("renderCowsPage has no fixed count (live-tracked data) but is a real, linkable page", () => {
  const html = renderCowsPage(APP_HTML);
  assert.match(html, /<title>Grazing Cattle in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/nearby\/cows\/">/);
  assert.match(html, /GPS collar/);
  assert.ok(!html.includes('"numberOfItems"'), "no fixed count to quote for live-tracked positions");
  assert.match(html, /<a class="detail-map-link nearby-link" href="\/nearby\/trees\/">[\s\S]*?Trees<\/a>/, "links onward to trees");
  assert.match(html, /nearby-link--current[^>]*href="\/nearby\/cows\/"|href="\/nearby\/cows\/"[^>]*nearby-link--current/, "the cows page marks itself as current");
});

test("generate writes one index.html per page under nearby/<slug>/, and listFindSlugs finds them back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-pages-test-"));
  fs.copyFileSync(path.join(REPO_ROOT, "app.html"), path.join(dir, "app.html"));
  const pages = generate(dir, FAKE_INVENTORY);
  assert.equal(pages.length, 3);

  assert.ok(fs.existsSync(path.join(dir, "nearby", "pubs", "index.html")));
  assert.ok(fs.existsSync(path.join(dir, "nearby", "cafes", "index.html")));
  assert.ok(fs.existsSync(path.join(dir, "nearby", "food", "index.html")), "the group page too");
  assert.ok(fs.existsSync(path.join(dir, "nearby", "events", "index.html")), "events always gets its own page too, even outside collectPages");
  assert.ok(fs.existsSync(path.join(dir, "nearby", "cows", "index.html")), "cows too, same reasoning");

  assert.deepEqual(listFindSlugs(dir), ["cafes", "cows", "events", "food", "pubs"]);
});

test("no generated category slug ever collides with the /nearby/filter or /nearby/search screens", () => {
  const { loadAppRules, buildInventory } = require("../scripts/report/map-inventory.js");
  const pages = collectPages(loadAppRules(), buildInventory(REPO_ROOT));
  for (const page of pages) {
    assert.ok(!["filter", "search"].includes(page.slug), `"${page.slug}" would collide with a /nearby/ app screen`);
  }
});

test("listFindSlugs returns nothing for a site that has not generated any category pages yet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-pages-empty-"));
  assert.deepEqual(listFindSlugs(dir), []);
});

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
}

test("loadWaterFeatures lists only named hydrology features, alphabetically, each with a real #water= hash key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-pages-water-"));
  writeJson(path.join(dir, "data", "local-environment.geojson"), {
    features: [
      { properties: { id: "way/2", name: "Baldwins Pond", featureType: "hydrology_area" }, geometry: { type: "Polygon", coordinates: [[[0, 51], [0.001, 51], [0.001, 51.001], [0, 51]]] } },
      { properties: { id: "way/1", name: "Aldersbrook", featureType: "hydrology_line" }, geometry: { type: "LineString", coordinates: [[0, 51], [0.001, 51.001]] } },
      // No name at all -- the live app's own extractWaterFeatures skips these, so this list must too.
      { properties: { id: "way/3", featureType: "hydrology_area" }, geometry: { type: "Polygon", coordinates: [[[0, 51], [0.001, 51], [0.001, 51.001], [0, 51]]] } },
      // Not a water feature -- a building, say -- must never leak into this list.
      { properties: { id: "way/4", name: "Not water", featureType: "building" }, geometry: { type: "Polygon", coordinates: [[[0, 51], [0.001, 51], [0.001, 51.001], [0, 51]]] } },
    ],
  });
  const result = loadWaterFeatures(loadAppRules(), dir);
  assert.deepEqual(result.map((w) => w.name), ["Aldersbrook", "Baldwins Pond"], "alphabetical, unnamed/non-water features excluded");
  assert.deepEqual(result.map((w) => w.key), ["way/1", "way/2"], "the same key waterHashKey/findWaterByHashKey (js/app.js) use for the live #water= deep link");
});

test("loadWaterFeatures returns nothing when there is no environment data to read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-pages-water-empty-"));
  assert.deepEqual(loadWaterFeatures(loadAppRules(), dir), []);
});

// Well within LANDING_PAGE_WALKING_RADIUS_METRES (2500m) of DEFAULT_LOCATION (51.667591, 0.037454).
const NEAR_DEFAULT_LOCATION = { latitude: 51.668, longitude: 0.038 };

// A tree fixture with just enough fields for treeHashKey/treeDisplayName (scripts/generate-find-pages.js,
// reproduced from js/app.js) to resolve.
function treeFixture({ recordNumber, commonName, ...point }) {
  return { recordNumber, commonName, ...NEAR_DEFAULT_LOCATION, ...point };
}

test("renderPage's trees/ponds-streams/nature pages show a real nearest-item list matching the live Nearby list's own per-filter radius-or-nearest-3 computation, not a species breakdown or a water-only guess", () => {
  const enrichment = {
    waterFeatures: [{ name: "Aldersbrook", key: "way/1", ...NEAR_DEFAULT_LOCATION }],
    trees: [treeFixture({ recordNumber: 1, commonName: "English Oak" })],
  };

  const treesPage = { key: "trees", slug: "trees", label: "Trees", title: "trees", count: 24906, groupLabel: "Nature", groupSlug: "nature", siblings: [] };
  const treesHtml = renderPage(treesPage, APP_HTML, enrichment);
  assert.ok(!treesHtml.includes("By species"), "no species breakdown -- dropped entirely");
  assert.match(treesHtml, /class="nearest-item" href="\/nearby\/trees\/#tree=r1"/, "a real #tree= deep link, not a dead-end button");
  assert.match(treesHtml, /<span class="nearest-name">English Oak<\/span>/);

  const waterPage = { key: "ponds_streams", slug: "ponds-streams", label: "Ponds & streams", title: "ponds and streams", count: 111, groupLabel: "Nature", groupSlug: "nature", siblings: [] };
  const waterHtml = renderPage(waterPage, APP_HTML, enrichment);
  assert.match(waterHtml, /class="nearest-item" href="\/nearby\/ponds-streams\/#water=way%2F1"/);
  assert.match(waterHtml, /<span class="nearest-name">Aldersbrook<\/span>/);
  assert.match(waterHtml, /<span class="walk-chip">\d+ m · < 1 min <img class="app-icon walk-icon"[^>]*><\/span>/, "the live walk chip, walking icon included");
  assert.match(waterHtml, /<span class="nearest-meta">.*Ponds &amp; streams/, "the footer names the place's type, as the live row does");
  assert.ok(!waterHtml.includes("/nearby/trees/#tree="), "the water-only page never pulls in trees");

  // The nature GROUP page mixes trees and water together, exactly like overviewItemsForActiveFilter
  // (js/app.js) does live: both fixtures are within the walking radius here, so both appear,
  // sorted by real distance rather than split into a tree-only and a water-only section.
  const naturePage = { key: "nature", slug: "nature", label: "Nature", title: "trees and water features", count: 25017, isGroup: true, members: [{ key: "trees", slug: "trees", label: "Trees" }, { key: "ponds_streams", slug: "ponds-streams", label: "Ponds & streams" }] };
  const natureHtml = renderPage(naturePage, APP_HTML, enrichment);
  assert.match(natureHtml, /class="nearest-item" href="\/nearby\/trees\/#tree=r1"/);
  assert.match(natureHtml, /class="nearest-item" href="\/nearby\/ponds-streams\/#water=way%2F1"/);
  assert.ok(!natureHtml.includes("By species"));

  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const pubsHtml = renderPage(pubs, APP_HTML, enrichment);
  assert.ok(
    !pubsHtml.includes("By species:") && !pubsHtml.includes("/nearby/trees/#tree=") && !pubsHtml.includes("/nearby/ponds-streams/#water="),
    "an ordinary business-scope page never gets any of this, even when enrichment data is passed in"
  );
});

test("natureNearestListHtml caps the combined, distance-sorted list to the live Nearby list's own display cap (10)", () => {
  const { natureNearestListHtml } = require("../scripts/generate-find-pages.js");
  const trees = Array.from({ length: 12 }, (_, i) => treeFixture({ recordNumber: i, commonName: `Tree ${i}`, latitude: 51.667591 + i * 0.0001, longitude: 0.037454 }));
  const html = natureNearestListHtml(["trees"], { trees, waterFeatures: [] }, loadAppRules());
  const count = (html.match(/class="nearest-item"/g) || []).length;
  assert.equal(count, 10, "state.nearestItemsCount (js/app.js) caps the live list to 10 -- the static one must match");
});

test("a nearest card's footer names its type and carries a direction arrow pointing at the place, from the same bearing the live arrow starts at", () => {
  const { natureNearestListHtml } = require("../scripts/generate-find-pages.js");
  const tree = treeFixture({ recordNumber: 1, commonName: "English Oak", tagNumber: "42", latitude: 51.67, longitude: 0.04 });
  const html = natureNearestListHtml(["trees"], { trees: [tree], waterFeatures: [] }, loadAppRules());
  assert.match(html, /<span class="nearest-meta"><span class="walk-chip">[^<]+ · [^<]+ <img class="app-icon walk-icon"[^>]*><\/span> · Tree · #42<\/span>/, "walk chip with its walking icon, then the type label and tag");
  assert.match(html, /<span class="nearest-arrow" data-item-lat="51\.67" data-item-lon="0\.04" data-current-angle="-?[\d.]+" style="transform: rotate\(-?[\d.]+deg\)" aria-hidden="true">↑<\/span>/);
});

test("nearestWithinWalkingRadius keeps only items within the walking radius, nearest first, and falls back to the nearest 3 overall when none are within it", () => {
  const items = [
    { name: "Near", ...NEAR_DEFAULT_LOCATION },
    { name: "Mid", latitude: 51.69, longitude: 0.06 }, // a few km out -- outside the radius
    { name: "Far", latitude: 52.0, longitude: 0.5 }, // tens of km out -- outside the radius
  ];
  const within = nearestWithinWalkingRadius(items, (i) => i);
  assert.deepEqual(within.map((r) => r.item.name), ["Near"], "only the one fixture inside the walking radius");

  const allFar = items.slice(1);
  const fallback = nearestWithinWalkingRadius(allFar, (i) => i);
  assert.deepEqual(fallback.map((r) => r.item.name), ["Mid", "Far"], "nothing within radius -- falls back to nearest overall, not an empty list");
});
