/**
 * Local development (`node server.js`) runs the same tracking function as Netlify, falling back to
 * NDJSON files when there is no Blobs context, so the admin dashboard reads the same packed format
 * locally as it does in production.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tracking = require("../netlify/functions/lib/tracking-store.js");

const root = path.join(__dirname, "..");

async function startServer(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, ...env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 10_000);
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) { clearTimeout(timer); resolve(); } });
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  return { base: `http://localhost:${port}`, stop: () => child.kill() };
}

test("locally, a posted batch is written to NDJSON files and read back through the admin endpoint", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-tracking-"));
  const server = await startServer({ TRACKING_DIR: dir, ADMIN_PASSWORD: "local-pw", NETLIFY: "", AWS_LAMBDA_FUNCTION_NAME: "" });
  try {
    const ts = new Date().toISOString();
    const posted = await fetch(`${server.base}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [{ type: "location", uid: "local-u1", ts, lat: 51.65, lng: 0.04, heading: 10 }] }),
    });
    assert.equal(posted.status, 200);
    assert.equal((await posted.json()).storage, "file-fallback");
    assert.ok(fs.readFileSync(path.join(dir, "location.ndjson"), "utf8").includes("local-u1"));

    assert.equal((await fetch(`${server.base}/api/admin/tracks`)).status, 401);
    const read = await fetch(`${server.base}/api/admin/tracks?days=1`, { headers: { Authorization: "Bearer local-pw" } });
    assert.equal(read.status, 200);
    const body = await read.json();
    assert.deepEqual(tracking.unpackEvents(body.locations).map((e) => [e.uid, e.lat, e.lng]), [["local-u1", 51.65, 0.04]]);
  } finally {
    server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
