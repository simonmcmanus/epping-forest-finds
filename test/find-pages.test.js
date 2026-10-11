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
  rootRelativizeAssetPaths,
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
  assert.equal(pages.length, 2);

  const pubs = pages.find((p) => p.key === "pubs");
  assert.equal(pubs.slug, "pubs");
  assert.equal(pubs.count, 42);
  assert.equal(pubs.title, "pubs and bars");
  assert.equal(pubs.groupLabel, "Food");
  assert.deepEqual(pubs.siblings.map((s) => s.key), ["cafes"], "a page lists its siblings, never itself");
});

test("rootRelativizeAssetPaths roots every relative href/src, leaving absolute ones alone", () => {
  const html = rootRelativizeAssetPaths(
    '<link href="css/base.css"><script src="js/app.js"></script>' +
      '<script src="/cookie-consent.js"></script><a href="https://example.com/x">x</a>' +
      '<a href="#top">top</a>'
  );
  assert.ok(html.includes('href="/css/base.css"'));
  assert.ok(html.includes('src="/js/app.js"'));
  assert.ok(html.includes('src="/cookie-consent.js"'), "already-rooted paths are untouched");
  assert.ok(html.includes('href="https://example.com/x"'), "absolute URLs are untouched");
  assert.ok(html.includes('href="#top"'), "fragment links are untouched");
});

test("renderPage produces the real app shell -- same scripts and canvas -- not a separate marketing page", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);

  assert.match(html, /id="mapCanvas"/, "the real interactive map canvas is present");
  assert.match(html, /<script src="\/js\/app\.js"><\/script>/, "the real app script boots this page");
  assert.match(html, /<script src="\/js\/categories\.js"><\/script>/);
});

test("renderPage swaps in the category's own title, canonical, OG and JSON-LD, never the generic /app ones", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);

  assert.match(html, /<title>Pubs &amp; bars in Epping Forest \| Epping Forest Finds<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/find\/pubs\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.eppingforestfinds\.uk\/find\/pubs\/">/);
  assert.match(html, /"numberOfItems":42/);
  assert.ok(!html.includes("offline map of Epping Forest</title>"), "the generic /app title is gone");
  assert.ok(!html.includes('href="https://www.eppingforestfinds.uk/app">'), "the generic /app canonical is gone");
});

test("renderPage replaces the app's initial empty-state message with real, crawlable category content and sibling links", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);

  assert.ok(!html.includes("All veteran trees are shown"), "the generic placeholder text is gone");
  assert.match(html, /Find all 42 pubs and bars in Epping Forest/);
  assert.match(html, /href="\/find\/cafes\/"/, "a sibling cross-link uses the trailing slash Netlify serves directly");
});

test("renderPage roots every CSS/JS/icon reference so the page works one directory level deeper than /app", () => {
  const [pubs] = collectPages(FAKE_RULES, FAKE_INVENTORY);
  const html = renderPage(pubs, APP_HTML);

  assert.ok(!/href="css\//.test(html), "no relative css/ reference survives");
  assert.ok(!/src="js\//.test(html), "no relative js/ reference survives");
  assert.match(html, /href="\/css\/base\.css"/);
  assert.match(html, /src="\/js\/app\.js"/);
});

test("generate writes one index.html per page under find/<slug>/, and listFindSlugs finds them back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-pages-test-"));
  fs.copyFileSync(path.join(REPO_ROOT, "app.html"), path.join(dir, "app.html"));
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
