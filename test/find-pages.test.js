const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  collectPages,
  renderPage,
  generate,
  listFindSlugs,
  slugFor,
} = require("../scripts/generate-find-pages.js");

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
  assert.equal(pages.length, 2);

  const pubs = pages.find((p) => p.key === "pubs");
  assert.equal(pubs.slug, "pubs");
  assert.equal(pubs.count, 42);
  assert.equal(pubs.title, "pubs and bars");
  assert.equal(pubs.groupLabel, "Food");
  assert.deepEqual(pubs.siblings.map((s) => s.key), ["cafes"], "a page lists its siblings, never itself");
});

test("renderPage emits a self-consistent, crawlable page: title, canonical, OG, JSON-LD and a pre-filtered map link", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs);

  assert.match(html, /<title>Pubs &amp; bars in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/find\/pubs">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.eppingforestfinds\.uk\/find\/pubs">/);
  assert.match(html, /"numberOfItems":42/);
  assert.match(html, /href="\/app\?show=pubs"/, "the CTA links into the app's pre-filter query param");
  assert.match(html, /href="\/find\/cafes"/, "a sibling cross-link is present");
  assert.ok(!html.includes("undefined"), "no template placeholder was left unfilled");
});

test("generate writes one index.html per page under find/<slug>/, and listFindSlugs finds them back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-pages-test-"));
  const pages = generate(dir, FAKE_INVENTORY);
  assert.equal(pages.length, 2);

  assert.ok(fs.existsSync(path.join(dir, "find", "pubs", "index.html")));
  assert.ok(fs.existsSync(path.join(dir, "find", "cafes", "index.html")));

  assert.deepEqual(listFindSlugs(dir), ["cafes", "pubs"]);
});

test("listFindSlugs returns nothing for a site that has not generated any category pages yet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-pages-empty-"));
  assert.deepEqual(listFindSlugs(dir), []);
});
