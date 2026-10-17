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
} = require("../scripts/generate-find-pages.js");

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

test("renderEventsPage lists real event titles/dates and links to the fuller /find/events/ listing", () => {
  const events = [{ title: "Autumn Fair", date: "2026-10-13" }, { title: "Recurring litter pick", date: null }];
  const html = renderEventsPage(APP_HTML, events);
  assert.match(html, /<title>2 Events in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/nearby\/events\/">/);
  assert.match(html, /Autumn Fair \(2026-10-13\)/);
  assert.match(html, /Recurring litter pick<\/li>/, "an event with no date still lists, just without a parenthetical");
  assert.match(html, /href="\/find\/events\/"/);
});

test("renderCowsPage has no fixed count (live-tracked data) but is a real, linkable page", () => {
  const html = renderCowsPage(APP_HTML);
  assert.match(html, /<title>Grazing Cattle in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/nearby\/cows\/">/);
  assert.match(html, /GPS collar/);
  assert.ok(!html.includes('"numberOfItems"'), "no fixed count to quote for live-tracked positions");
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
