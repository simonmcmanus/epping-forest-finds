const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  collectUrls,
  buildSitemapXml,
  buildRobotsTxt,
  generate,
  SITE_ORIGIN,
  SITEMAP_FILE_NAME,
  ROBOTS_FILE_NAME,
} = require("../scripts/generate-sitemap.js");

function makeSite({ reports = [], terms = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-test-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
  if (terms) fs.writeFileSync(path.join(dir, "terms.html"), "<html></html>");
  fs.mkdirSync(path.join(dir, "reports"));
  for (const name of reports) {
    fs.writeFileSync(path.join(dir, "reports", name), `report ${name}`);
  }
  return dir;
}

test("the sitemap lists the map, the report index and every published report", () => {
  const dir = makeSite({ reports: ["epping-forest-ledger-2026-09-14.html"] });
  const locs = collectUrls(dir).map((url) => url.loc);
  assert.deepEqual(locs, [
    "/",
    "/reports/",
    "/terms.html",
    "/reports/epping-forest-ledger-2026-09-14.html",
  ]);
});

test("the sitemap never lists a working file that is not a published page", () => {
  const dir = makeSite({
    reports: ["epping-forest-ledger-2026-09-14.html", "epping-forest-data-report-2026-09-03.md"],
  });
  const locs = collectUrls(dir).map((url) => url.loc);
  assert.ok(!locs.some((loc) => loc.endsWith(".md")));
});

test("the sitemap skips pages this checkout does not have", () => {
  const dir = makeSite({ terms: false });
  const locs = collectUrls(dir).map((url) => url.loc);
  assert.ok(!locs.includes("/terms.html"));
});

test("every address in the sitemap is absolute and on the official domain", () => {
  const dir = makeSite({ reports: ["epping-forest-ledger-2026-09-14.html"] });
  const xml = buildSitemapXml(collectUrls(dir));
  for (const loc of xml.match(/<loc>([^<]+)<\/loc>/g) || []) {
    assert.ok(loc.includes(`<loc>${SITE_ORIGIN}/`), `${loc} is not on ${SITE_ORIGIN}`);
  }
  assert.ok(!xml.includes("netlify.app"));
});

test("the sitemap is well-formed enough for a crawler to read", () => {
  const dir = makeSite({ reports: ["epping-forest-ledger-2026-09-14.html"] });
  const xml = buildSitemapXml(collectUrls(dir));
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
});

test("robots.txt points crawlers at the sitemap and keeps them out of the dashboard", () => {
  const robots = buildRobotsTxt();
  assert.ok(robots.includes(`Sitemap: ${SITE_ORIGIN}/${SITEMAP_FILE_NAME}`));
  assert.ok(robots.includes("Disallow: /admin.html"));
  assert.ok(robots.includes("Disallow: /api/"));
  assert.ok(robots.includes("Allow: /"));
});

test("generate writes both files into the site root", () => {
  const dir = makeSite({ reports: ["epping-forest-ledger-2026-09-14.html"] });
  generate(dir);
  assert.ok(fs.existsSync(path.join(dir, SITEMAP_FILE_NAME)));
  assert.ok(fs.existsSync(path.join(dir, ROBOTS_FILE_NAME)));
});

test("a generated /nearby/<group>/<slug> category page is listed in the sitemap, unlike the gated app", () => {
  const dir = makeSite();
  fs.mkdirSync(path.join(dir, "nearby", "food", "pubs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "nearby", "food", "pubs", "index.html"), "<!doctype html>");
  const locs = collectUrls(dir).map((url) => url.loc);
  assert.ok(
    locs.includes("/nearby/food/pubs/"),
    "a generated category page is advertised to crawlers at the trailing-slash URL Netlify actually serves it at",
  );
});

test("the gated app screens are kept out of the sitemap and disallowed to crawlers", () => {
  // Each screen answers a crawler with a redirect to the homepage while the alpha is
  // closed, which is a soft-404 signal with nothing to gain -- and the app has
  // no indexable content in any case. See spec/spec-alpha-access.md section 6.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-app-"));
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(root, "terms.html"), "<!doctype html>");

  generate(root);

  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");

  for (const screen of ["/nearby", "/nearby/search", "/nearby/filter", "/settings", "/feedback"]) {
    assert.ok(!sitemap.includes(`<loc>https://www.eppingforestfinds.uk${screen}<`), `sitemap.xml must not advertise ${screen}`);
    // "$" anchors the end of the path (robots.txt's own end-of-url syntax) so this disallows
    // exactly the screen, not every /nearby/<group>/<slug>/ category page nested under the same prefix.
    assert.match(robots, new RegExp(`^Disallow: ${screen.replace(/\//g, "\\/")}\\$$`, "m"), `robots.txt must disallow ${screen} (and only exactly that path)`);
  }
  // /app itself carries no entry of its own: it is a bare redirect, not a page with content.
  assert.ok(!robots.includes("Disallow: /app\n"), "/app is a redirect, not a gated page -- it needs no disallow entry");
});

test("robots.txt's /nearby disallow never swallows a /nearby/<group>/<slug> category page", () => {
  // Disallow: /nearby (no end anchor) would prefix-match /nearby/food/pubs/ too and make every
  // category page invisible to crawlers -- the whole point of generating them. The "$" anchor
  // in DISALLOWED_PATHS is what keeps the gated screen and the public category pages apart.
  const robots = buildRobotsTxt();
  assert.ok(!/^Disallow: \/nearby$/m.test(robots), "the /nearby disallow line must be end-anchored");
});
