const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const http = require("node:http");

const {
  listReportFiles,
  buildIndexHtml,
  titleForFile,
  escapeHtml,
  generate,
  INDEX_FILE_NAME,
} = require("../scripts/generate-reports-index.js");

function get(port, requestPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: requestPath }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ statusCode: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

function makeTempReportsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reports-index-test-"));
  return dir;
}

function writeFile(dir, name, { mtime } = {}) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `content of ${name}`);
  if (mtime) fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

test("listReportFiles returns an empty array when the directory does not exist", () => {
  const missingDir = path.join(os.tmpdir(), "reports-index-test-does-not-exist");
  assert.deepEqual(listReportFiles(missingDir), []);
});

test("listReportFiles returns an empty array for an empty directory", () => {
  const dir = makeTempReportsDir();
  assert.deepEqual(listReportFiles(dir), []);
});

test("listReportFiles excludes index.html, dotfiles, and subdirectories", () => {
  const dir = makeTempReportsDir();
  writeFile(dir, "index.html");
  writeFile(dir, ".hidden-file");
  fs.mkdirSync(path.join(dir, "a-subdirectory"));
  writeFile(dir, "real-report.html");

  const files = listReportFiles(dir);
  assert.deepEqual(files.map((f) => f.name), ["real-report.html"]);
});

test("listReportFiles sorts newest-first by modification time", () => {
  const dir = makeTempReportsDir();
  const older = new Date("2026-01-01T00:00:00Z");
  const newer = new Date("2026-06-01T00:00:00Z");
  writeFile(dir, "old-report.html", { mtime: older });
  writeFile(dir, "new-report.html", { mtime: newer });

  const files = listReportFiles(dir);
  assert.deepEqual(files.map((f) => f.name), ["new-report.html", "old-report.html"]);
});

test("listReportFiles breaks ties on identical mtimes by filename so ordering is deterministic", () => {
  const dir = makeTempReportsDir();
  const sameTime = new Date("2026-01-01T00:00:00Z");
  writeFile(dir, "b-report.html", { mtime: sameTime });
  writeFile(dir, "a-report.html", { mtime: sameTime });

  const files = listReportFiles(dir);
  assert.deepEqual(files.map((f) => f.name), ["a-report.html", "b-report.html"]);
});

test("escapeHtml neutralizes markup so a report filename can never inject HTML", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror=alert(1)>&"'`),
    "&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;"
  );
});

test("buildIndexHtml renders a link and the week it covers for every file", () => {
  const html = buildIndexHtml([
    { name: "epping-forest-ledger-2026-09-03.html", size: 2048, mtimeMs: Date.parse("2026-09-03") },
  ]);
  assert.match(html, /href="\.\/epping-forest-ledger-2026-09-03\.html"/);
  assert.match(html, /class="report-name">3 September 2026</);
  assert.doesNotMatch(html, /<ul class="report-list"><\/ul>/);
});

test("the newest edition is listed first, by the week in its name rather than its file time", () => {
  // A fresh checkout stamps every file with the same mtime.
  const sameTime = Date.parse("2026-09-22T10:00:00Z");
  const html = buildIndexHtml([
    { name: "epping-forest-ledger-2026-09-03.html", size: 1, mtimeMs: sameTime },
    { name: "epping-forest-ledger-2026-09-21.html", size: 1, mtimeMs: sameTime },
    { name: "epping-forest-ledger-2026-09-14.html", size: 1, mtimeMs: sameTime },
  ]);
  const order = [...html.matchAll(/class="report-name">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(order, ["21 September 2026", "14 September 2026", "3 September 2026"]);
  assert.equal((html.match(/class="report-latest"/g) || []).length, 1);
  assert.ok(html.indexOf("report-latest") < html.indexOf("14 September 2026"));
});

test("the listing wears the homepage's look: brand header, green hero and card list", () => {
  const html = buildIndexHtml([{ name: "epping-forest-ledger-2026-09-14.html", size: 1, mtimeMs: 0 }]);
  assert.match(html, /<a class="brand" href="\/">/);
  assert.match(html, /src="\/assets\/home\/map-icons\/oak\.png"/);
  assert.match(html, /src="\/assets\/home\/ledger\.svg"/);
  assert.match(html, /--tree-deep: #1d4a2f/);
  assert.doesNotMatch(html, /\/(js|css)\//, "never loads the app's code or styles");
  assert.match(html, /href="\/#signup"/);
});

test("buildIndexHtml escapes filenames so an untrusted/odd name cannot break the page", () => {
  const html = buildIndexHtml([{ name: `weird<script>.html`, size: 10, mtimeMs: Date.now() }]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /weird&lt;script&gt;\.html/);
});

test("buildIndexHtml shows an empty state with no report files", () => {
  const html = buildIndexHtml([]);
  assert.match(html, /No reports have been published yet\./);
  assert.doesNotMatch(html, /<ul class="report-list">/);
});

test("buildIndexHtml URL-encodes filenames containing spaces or special characters", () => {
  const html = buildIndexHtml([{ name: "weekly report (draft).html", size: 10, mtimeMs: Date.now() }]);
  assert.match(html, /href="\.\/weekly%20report%20\(draft\)\.html"/);
});

test("generate() writes reports/index.html to disk and is idempotent (re-running never lists itself)", () => {
  const dir = makeTempReportsDir();
  writeFile(dir, "report-one.html");
  writeFile(dir, "report-two.html");

  const first = generate(dir);
  assert.equal(first.files.length, 2);
  assert.ok(fs.existsSync(path.join(dir, INDEX_FILE_NAME)));

  // Regenerating must not pick up the index.html it just wrote as a "report".
  const second = generate(dir);
  assert.equal(second.files.length, 2);
  assert.deepEqual(
    second.files.map((f) => f.name).sort(),
    ["report-one.html", "report-two.html"]
  );
});

test("only finished web pages are published — working notes are never listed", () => {
  const dir = makeTempReportsDir();
  writeFile(dir, "epping-forest-ledger-2026-09-14.html");
  writeFile(dir, "epping-forest-data-report-2026-09-03.md");
  writeFile(dir, "notes.txt");

  const { files, html } = generate(dir);
  assert.deepEqual(files.map((f) => f.name), ["epping-forest-ledger-2026-09-14.html"]);
  assert.ok(!html.includes(".md"));
  assert.ok(!html.includes("notes.txt"));
});

test("a report is listed by the week it covers, not by its file name", () => {
  const html = buildIndexHtml([
    { name: "epping-forest-ledger-2026-09-14.html", size: 10, mtimeMs: Date.now() },
  ]);
  assert.match(html, /Epping Forest Ledger — 14 September 2026/);
});

test("titleForFile falls back to the file name for anything it does not recognise", () => {
  assert.equal(titleForFile("something-else.html"), "something-else.html");
});

test("the report index invites search engines in and points at the app", () => {
  const html = buildIndexHtml([]);
  assert.ok(!html.includes('content="noindex"'));
  assert.match(html, /<meta name="description"/);
  assert.match(html, /rel="canonical" href="https:\/\/www\.eppingforestfinds\.uk\/reports\/"/);
  assert.match(html, /href="https:\/\/www\.eppingforestfinds\.uk\/"/);
});

test("generate() produces valid, non-empty HTML for a directory with no reports yet", () => {
  const dir = makeTempReportsDir();
  const { files, html } = generate(dir);
  assert.deepEqual(files, []);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /No reports have been published yet\./);
});

test("smoke test: running the real CLI script against the project's actual reports/ directory succeeds and produces a well-formed index", () => {
  const repoRoot = path.join(__dirname, "..");
  const scriptPath = path.join(repoRoot, "scripts", "generate-reports-index.js");
  const reportsDir = path.join(repoRoot, "reports");

  const output = execFileSync(process.execPath, [scriptPath], { cwd: repoRoot, encoding: "utf8" });
  assert.match(output, /wrote reports\/index\.html listing \d+ file\(s\)\./);

  const indexPath = path.join(reportsDir, INDEX_FILE_NAME);
  assert.ok(fs.existsSync(indexPath), "reports/index.html should exist after running the script");

  const html = fs.readFileSync(indexPath, "utf8");
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Epping Forest Ledger/);
  // The index must never link to itself.
  assert.doesNotMatch(html, /href="\.\/index\.html"/);
});


test("local dev server (server.js) serves reports/index.html for both /reports and /reports/, matching Netlify's directory-index behaviour in production", async (t) => {
  const repoRoot = path.join(__dirname, "..");
  // Make sure reports/index.html actually exists regardless of test ordering --
  // this test must not depend on another test file having generated it first.
  generate(path.join(repoRoot, "reports"));

  const { server } = require("../server.js");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const withoutSlash = await get(port, "/reports");
  assert.equal(withoutSlash.statusCode, 200);
  assert.match(withoutSlash.body, /<title>Epping Forest Ledger/);

  const withSlash = await get(port, "/reports/");
  assert.equal(withSlash.statusCode, 200);
  assert.match(withSlash.body, /<title>Epping Forest Ledger/);

  const missingDir = await get(port, "/this-directory-does-not-exist");
  assert.equal(missingDir.statusCode, 404);
});
