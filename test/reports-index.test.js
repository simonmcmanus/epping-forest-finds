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
  formatBytes,
  labelForFile,
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

test("formatBytes renders human-readable sizes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("formatBytes handles invalid input without throwing", () => {
  assert.equal(formatBytes(NaN), "—");
  assert.equal(formatBytes(-5), "—");
});

test("labelForFile maps known extensions and falls back sensibly", () => {
  assert.equal(labelForFile("ledger.html"), "HTML");
  assert.equal(labelForFile("data-report.md"), "Markdown");
  assert.equal(labelForFile("summary.pdf"), "PDF");
  assert.equal(labelForFile("no-extension"), "FILE");
});

test("escapeHtml neutralizes markup so a report filename can never inject HTML", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror=alert(1)>&"'`),
    "&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;"
  );
});

test("buildIndexHtml renders a link, type, and name for every file", () => {
  const html = buildIndexHtml([
    { name: "epping-forest-ledger-2026-09-03.html", size: 2048, mtimeMs: Date.parse("2026-09-03") },
  ]);
  assert.match(html, /href="\.\/epping-forest-ledger-2026-09-03\.html"/);
  assert.match(html, /epping-forest-ledger-2026-09-03\.html/);
  assert.match(html, />HTML</);
  assert.doesNotMatch(html, /<ul class="report-list"><\/ul>/);
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
  writeFile(dir, "report-two.md");

  const first = generate(dir);
  assert.equal(first.files.length, 2);
  assert.ok(fs.existsSync(path.join(dir, INDEX_FILE_NAME)));

  // Regenerating must not pick up the index.html it just wrote as a "report".
  const second = generate(dir);
  assert.equal(second.files.length, 2);
  assert.deepEqual(
    second.files.map((f) => f.name).sort(),
    ["report-one.html", "report-two.md"]
  );
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
  assert.match(html, /<title>Reports/);
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
  assert.match(withoutSlash.body, /<title>Reports/);

  const withSlash = await get(port, "/reports/");
  assert.equal(withSlash.statusCode, 200);
  assert.match(withSlash.body, /<title>Reports/);

  const missingDir = await get(port, "/this-directory-does-not-exist");
  assert.equal(missingDir.statusCode, 404);
});
