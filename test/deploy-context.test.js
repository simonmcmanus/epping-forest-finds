"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { communityStoreName, communityLocalDir } = require("../netlify/functions/lib/community-store");
const { photoStoreName } = require("../netlify/functions/lib/report-photo");
const { setDeployStamp } = require("../netlify/functions/lib/deploy-context");

const SCRIPT = path.join(__dirname, "..", "scripts", "generate-deploy-context.js");

function isolated(fn) {
  return async () => {
    const saved = { CONTEXT: process.env.CONTEXT, BRANCH: process.env.BRANCH };
    delete process.env.CONTEXT;
    delete process.env.BRANCH;
    try { await fn(); } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      setDeployStamp(null);
    }
  };
}

test("a production build stamp makes the live site use the production Community stores", isolated(() => {
  setDeployStamp({ production: true });
  assert.equal(communityStoreName(), "community");
  assert.equal(photoStoreName(), "report-photos");
  assert.ok(communityLocalDir().endsWith("production"));
}));

test("without a stamp, or with a false one, local and preview names stay branch scoped", isolated(() => {
  assert.equal(communityStoreName(), "community-dev");
  assert.equal(photoStoreName(), "report-photos-dev");
  setDeployStamp({ production: false });
  assert.equal(communityStoreName(), "community-dev");
  assert.equal(photoStoreName(), "report-photos-dev");
}));

test("a runtime production context still works without a stamp", isolated(() => {
  process.env.CONTEXT = "production";
  assert.equal(communityStoreName(), "community");
  assert.equal(photoStoreName(), "report-photos");
}));

test("an explicit preview environment never resolves to production because of the stamp", isolated(() => {
  setDeployStamp({ production: true });
  const env = { CONTEXT: "deploy-preview", BRANCH: "x" };
  assert.equal(communityStoreName(env), "community-x");
  assert.equal(photoStoreName(env), "report-photos-x");
  assert.ok(communityLocalDir(env).endsWith("x"));
}));

test("the build stamp reflects only the Netlify production context", () => {
  const { deployContextStamp } = require("../scripts/generate-deploy-context");
  assert.deepEqual(deployContextStamp({ CONTEXT: "production" }), { production: true });
  assert.deepEqual(deployContextStamp({ CONTEXT: "deploy-preview" }), { production: false });
  assert.deepEqual(deployContextStamp({}), { production: false });
});

test("the stamp script writes the flag file and prints one summary line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-context-"));
  const out = path.join(dir, "stamp.json");
  try {
    const run = (context) => {
      const env = { ...process.env };
      delete env.CONTEXT;
      if (context) env.CONTEXT = context;
      return spawnSync(process.execPath, [SCRIPT, "--out", out], { env, encoding: "utf8" });
    };
    let result = run("production");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Deploy context: production (production=true)\n");
    assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf8")), { production: true });
    result = run("");
    assert.equal(result.stdout, "Deploy context: none (production=false)\n");
    assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf8")), { production: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resetting a named branch targets preview stores even when the build says production", isolated(() => {
  setDeployStamp({ production: true });
  const { resolveTarget } = require("../scripts/reset-community");
  const target = resolveTarget({ branch: "x", production: false, dataDir: null });
  assert.equal(target.production, false);
  assert.equal(target.community, "community-x");
  assert.equal(target.photos, "report-photos-x");
}));
