"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { branchName, communityStoreName, communityLocalDir } = require("../netlify/functions/lib/community-store");
const { photoStoreName } = require("../netlify/functions/lib/report-photo");
const { resetCommunityData, RESET_CONFIRMATION } = require("../netlify/functions/lib/community-reset");

function communityMemory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async list(prefix) { return [...data.keys()].filter((key) => key.startsWith(prefix)); },
    async delete(key) { data.delete(key); },
  };
}

function blobMemory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async list({ prefix = "", cursor } = {}) {
      const keys = [...data.keys()].filter((key) => key.startsWith(prefix));
      const offset = cursor ? Number(cursor) : 0;
      const page = keys.slice(offset, offset + 2);
      const next = offset + page.length < keys.length ? String(offset + page.length) : undefined;
      return { blobs: page.map((key) => ({ key })), ...(next ? { cursor: next } : {}) };
    },
    async delete(key) { data.delete(key); },
  };
}

test("local and deployed Community storage names are isolated by branch", () => {
  const preview = { CONTEXT: "deploy-preview", BRANCH: "feature/community-test" };
  const dev = { CONTEXT: "local", BRANCH: "main" };
  assert.equal(branchName(preview), "feature-community-test");
  assert.equal(communityStoreName(preview), "community-feature-community-test");
  assert.equal(photoStoreName(preview), "report-photos-feature-community-test");
  assert.notEqual(communityLocalDir(preview), communityLocalDir(dev));
  assert.equal(communityStoreName({ CONTEXT: "production", BRANCH: "main" }), "community");
  assert.equal(photoStoreName({ CONTEXT: "production", BRANCH: "main" }), "report-photos");
});
test("reset removes every Community record and both report-photo namespaces in the active context", async () => {
  const store = communityMemory({
    "reports/report-1": { deviceId: "device-a" },
    "computed": { overlay: {} },
    "features-allowlist": { community: [] },
    "community-report-rate/123": { n: 1 },
  });
  const photos = blobMemory({
    "photos/public.jpg": "public",
    "tree-photos/private.jpg": "private",
    "other/keep.txt": "not Community report data",
  });

  const summary = await resetCommunityData(store, { photos });

  assert.deepEqual(summary, { records: 4, photos: 2 });
  assert.deepEqual([...store.data.keys()], []);
  assert.deepEqual([...photos.data.keys()], ["other/keep.txt"]);
});
test("reset does not remove Community records when photo storage cannot be listed", async () => {
  const store = communityMemory({ "reports/report-1": { deviceId: "device-a" } });
  const photos = { async list() { throw new Error("photo store down"); }, async delete() {} };

  await assert.rejects(resetCommunityData(store, { photos }), /photo store down/);
  assert.deepEqual([...store.data.keys()], ["reports/report-1"]);
});

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "..", "scripts", "reset-community.js");
function runScript(args, input, env = {}) {
  const clean = { ...process.env };
  delete clean.CONTEXT; delete clean.NETLIFY_SITE_ID; delete clean.NETLIFY_AUTH_TOKEN;
  return spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8", env: { ...clean, ...env } });
}
function tempStore(files = ["reports_r1.json", "computed.json"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-reset-"));
  for (const f of files) fs.writeFileSync(path.join(dir, f), "{}");
  return dir;
}

test("the reset script targets the local branch directory by default, never the production store", () => {
  const dir = tempStore();
  const out = runScript([], "no\n");
  fs.rmSync(dir, { recursive: true, force: true });
  assert.notEqual(out.status, 0);
  assert.match(out.stdout, /data[\\/]tracking[\\/]community[\\/]/);
  assert.doesNotMatch(out.stdout, /"community"|"report-photos"/);
});

test("the default reset clears the local Community store the running app writes to (BRANCH env, not git branch)", async () => {
  const { openStore, communityLocalDir } = require("../netlify/functions/lib/community-store");
  const branch = `reset-test-${process.pid}-${Date.now()}`;
  const dir = communityLocalDir({ BRANCH: branch });
  const saved = process.env.BRANCH;
  try {
    process.env.BRANCH = branch;
    await openStore({}).put("reports/r1", { deviceId: "device-a" });
    assert.equal(fs.readdirSync(dir).length, 1);
    const out = runScript([], `${RESET_CONFIRMATION}\n`, { BRANCH: branch });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.match(out.stdout, /"records":\s*1/);
  } finally {
    if (saved === undefined) delete process.env.BRANCH; else process.env.BRANCH = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the reset script refuses a production run without a terminal, before asking or deleting anything", () => {
  const out = runScript(["--production"], `${RESET_CONFIRMATION}\n`, { NETLIFY_SITE_ID: "x", NETLIFY_AUTH_TOKEN: "y" });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /interactive terminal/);
  assert.doesNotMatch(out.stdout, /Type RESET/);
});

test("the reset script deletes nothing when the typed phrase is wrong", () => {
  const dir = tempStore();
  const out = runScript(["--data-dir", dir], "reset\n");
  const left = fs.readdirSync(dir).length;
  fs.rmSync(dir, { recursive: true, force: true });
  assert.notEqual(out.status, 0);
  assert.equal(left, 2);
});

test("the reset script clears a local store when the exact phrase is typed", () => {
  const dir = tempStore();
  const out = runScript(["--data-dir", dir], `${RESET_CONFIRMATION}\n`);
  const left = fs.readdirSync(dir).length;
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(left, 0);
  assert.match(out.stdout, /"records":\s*2/);
});

test("the reset script needs Netlify credentials for a deploy-preview branch", () => {
  const out = runScript(["--branch", "feature/x"], `${RESET_CONFIRMATION}\n`);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /NETLIFY_SITE_ID/);
});
