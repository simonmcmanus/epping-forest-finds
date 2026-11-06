/**
 * Local development server (server.js) serves only files inside the site it runs in. It is started on a
 * scratch site with a sibling folder whose name begins the same way, the case a plain prefix check gets wrong.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");

async function startServer(cwd) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(root, "server.js")], { cwd, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 10_000);
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) { clearTimeout(timer); resolve(); } });
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  return { base: `http://localhost:${port}`, stop: () => child.kill() };
}

// <scratch>/site is the site being served; <scratch>/site-private is a neighbour that starts the same way.
function scratchLayout() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ff-dev-server-"));
  const site = path.join(scratch, "site");
  const neighbour = path.join(scratch, "site-private");
  fs.mkdirSync(site);
  fs.mkdirSync(neighbour);
  fs.writeFileSync(path.join(site, "index.html"), "<!doctype html><p>the site</p>");
  fs.writeFileSync(path.join(neighbour, "secret.txt"), "NEIGHBOUR SECRET");
  return { scratch, site };
}

test("the dev server serves a file from its own site", async () => {
  const { scratch, site } = scratchLayout();
  const server = await startServer(site);
  try {
    const response = await fetch(`${server.base}/index.html`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /the site/);
  } finally {
    server.stop();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("a request cannot reach a file in a neighbouring folder whose name starts the same way", async () => {
  const { scratch, site } = scratchLayout();
  const server = await startServer(site);
  try {
    const response = await fetch(`${server.base}/..%2Fsite-private%2Fsecret.txt`);
    assert.equal(response.status, 403);
    assert.ok(!(await response.text()).includes("NEIGHBOUR SECRET"));
  } finally {
    server.stop();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("a request cannot climb out of the site to an unrelated file", async () => {
  const { scratch, site } = scratchLayout();
  const server = await startServer(site);
  try {
    const response = await fetch(`${server.base}/..%2F..%2F..%2F..%2Fetc%2Fpasswd`);
    assert.equal(response.status, 403);
  } finally {
    server.stop();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
