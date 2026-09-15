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
