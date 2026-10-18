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
  loadTreeSpeciesBreakdown,
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
  assert.match(html, /Find all 42 pubs and bars in Epping Forest/);
  assert.match(html, /href="\/nearby\/cafes\/"/, "a sibling cross-link uses the trailing slash Netlify serves directly");
  assert.match(html, /More in <a href="\/nearby\/food\/">Food<\/a>/, "and links back up to its own group page");
});

test("renderPage renders a group page's own title, count and member cross-links", () => {
  const food = collectPages(FAKE_RULES, FAKE_INVENTORY).find((p) => p.isGroup);
  const html = renderPage(food, APP_HTML);

  assert.match(html, /<title>Food in Epping Forest — 49 places \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/nearby\/food\/">/);
  assert.match(html, /"numberOfItems":49/, "the group's count is its members' counts summed");
  assert.match(html, /Find all 49 places to eat, drink and shop in Epping Forest/);
  assert.match(html, /Browse by type: <a href="\/nearby\/pubs\/">Pubs &amp; bars<\/a>, <a href="\/nearby\/cafes\/">Cafés<\/a>/);
});

test("renderPage links out to veteran trees and grazing cattle, the same up-link every /find/<slug>/ business page carries", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);
  assert.match(html, /See also <a href="\/nearby\/trees\/">veteran trees<\/a> and <a href="\/nearby\/cows\/">grazing cattle<\/a> near Epping Forest\./);
});

test("renderPage's own See-also link omits a self-link when the page itself is /nearby/trees/", () => {
  const treesPage = { key: "trees", slug: "trees", label: "Trees", title: "trees", count: 24906, groupLabel: "Nature", groupSlug: "nature", siblings: [] };
  const html = renderPage(treesPage, APP_HTML);
  assert.ok(!html.includes('href="/nearby/trees/">veteran trees</a>'), "the trees page never links to itself");
  assert.match(html, /See also <a href="\/nearby\/cows\/">grazing cattle<\/a> near Epping Forest\./);
});

test("renderEventsPage lists real event titles/dates and links to the fuller /find/events/ listing", () => {
  const events = [{ title: "Autumn Fair", date: "2026-10-13" }, { title: "Recurring litter pick", date: null }];
  const html = renderEventsPage(APP_HTML, events);
  assert.match(html, /<title>2 Events in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/nearby\/events\/">/);
  assert.match(html, /Autumn Fair \(2026-10-13\)/);
  assert.match(html, /Recurring litter pick<\/li>/, "an event with no date still lists, just without a parenthetical");
  assert.match(html, /href="\/find\/events\/"/);
  assert.match(html, /See also <a href="\/nearby\/trees\/">veteran trees<\/a> and <a href="\/nearby\/cows\/">grazing cattle<\/a> near Epping Forest\./);
});

test("renderCowsPage has no fixed count (live-tracked data) but is a real, linkable page", () => {
  const html = renderCowsPage(APP_HTML);
  assert.match(html, /<title>Grazing Cattle in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/nearby\/cows\/">/);
  assert.match(html, /GPS collar/);
  assert.ok(!html.includes('"numberOfItems"'), "no fixed count to quote for live-tracked positions");
  assert.match(html, /See also <a href="\/nearby\/trees\/">veteran trees<\/a> near Epping Forest\./, "links onward to trees, but not to itself");
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

test("loadTreeSpeciesBreakdown groups case-insensitively, drops artifact rows, and folds rare species into otherCount", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-pages-trees-"));
  writeJson(path.join(dir, "data", "trees", "index.json"), {
    chunks: [{ key: "a", url: "data/trees/chunk-a.json" }, { key: "b", url: "data/trees/chunk-b.json" }],
  });
  const oaks = Array.from({ length: 6 }, () => ({ commonName: "English Oak" }));
  writeJson(path.join(dir, "data", "trees", "chunk-a.json"), {
    trees: [
      ...oaks,
      { commonName: "English oak" }, // a differently-cased duplicate of the majority spelling above
      { commonName: "Holly" }, // below the cap (minCount 5 in the test below) -- folds into "other"
      { commonName: "Oak = 7,794" }, // a stray data artifact, not a real species -- dropped entirely
      { commonName: "" }, // no species recorded at all -- dropped, not counted as "Other"
    ],
  });
  writeJson(path.join(dir, "data", "trees", "chunk-b.json"), { trees: [{ commonName: "english Oak" }] });

  const result = loadTreeSpeciesBreakdown(loadAppRules(), dir, 5);
  assert.deepEqual(result.notable, [{ name: "English Oak", count: 8 }], "6 + 1 + 1 case-insensitive duplicates, majority casing wins the label");
  assert.equal(result.otherCount, 1, "just the single Holly -- the artifact row and the nameless tree are excluded entirely, not counted as other");
});

test("loadTreeSpeciesBreakdown returns an empty breakdown when there is no tree index to read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-pages-trees-empty-"));
  assert.deepEqual(loadTreeSpeciesBreakdown(loadAppRules(), dir), { notable: [], otherCount: 0 });
});

// Well within LANDING_PAGE_WALKING_RADIUS_METRES (2500m) of DEFAULT_LOCATION (51.667591, 0.037454).
const NEAR_DEFAULT_LOCATION = { latitude: 51.668, longitude: 0.038 };

test("renderPage prints a species breakdown on /nearby/trees/ and a linked water list on /nearby/ponds-streams/ and /nearby/nature/, but neither on an ordinary business-scope page", () => {
  const enrichment = {
    treeSpecies: { notable: [{ name: "Common Beech", count: 13122 }], otherCount: 4 },
    waterFeatures: [{ name: "Aldersbrook", key: "way/1", ...NEAR_DEFAULT_LOCATION }],
  };
  const treesPage = { key: "trees", slug: "trees", label: "Trees", title: "trees", count: 24906, groupLabel: "Nature", groupSlug: "nature", siblings: [] };
  const treesHtml = renderPage(treesPage, APP_HTML, enrichment);
  assert.match(treesHtml, /By species:<\/p><ul class="category-listing"><li>Common Beech — 13,122<\/li><li>Other species — 4<\/li><\/ul>/);
  assert.ok(!treesHtml.includes("Named ponds"), "the trees page gets no water list of its own");

  const waterPage = { key: "ponds_streams", slug: "ponds-streams", label: "Ponds & streams", title: "ponds and streams", count: 111, groupLabel: "Nature", groupSlug: "nature", siblings: [] };
  const waterHtml = renderPage(waterPage, APP_HTML, enrichment);
  // The same .nearest-item card the live Nearby list renders (css/map-ui.css), not a bare <ul> --
  // see nearestItemCardHtml's own comment for why -- including its distance/walk-time footer,
  // since a water page's single fixture item is well within the walking radius.
  assert.match(waterHtml, /class="nearest-item" href="\/nearby\/ponds-streams\/#water=way%2F1"/);
  assert.match(waterHtml, /<span class="nearest-name">Aldersbrook<\/span>/);
  assert.match(waterHtml, /<span class="walk-chip">\d+ m · < 1 min<\/span>/);
  assert.ok(!waterHtml.includes("By species:"), "the water page gets no species breakdown of its own");

  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const pubsHtml = renderPage(pubs, APP_HTML, enrichment);
  assert.ok(!pubsHtml.includes("By species:") && !pubsHtml.includes("Named ponds"), "an ordinary business-scope page never gets either, even when enrichment data is passed in");
});

test("renderPage's nature group page carries both the tree species breakdown and the water list", () => {
  const enrichment = {
    treeSpecies: { notable: [{ name: "Common Beech", count: 13122 }], otherCount: 0 },
    waterFeatures: [{ name: "Aldersbrook", key: "way/1", ...NEAR_DEFAULT_LOCATION }],
  };
  const naturePage = { key: "nature", slug: "nature", label: "Nature", title: "trees and water features", count: 25017, isGroup: true, members: [] };
  const html = renderPage(naturePage, APP_HTML, enrichment);
  assert.match(html, /By species:/);
  assert.match(html, /Named ponds/);
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
