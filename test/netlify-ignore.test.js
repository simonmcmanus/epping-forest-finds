/**
 * Netlify build decision (netlify/ignore-draft-pr.js): exit 0 skips the build, exit 1 builds.
 * Draft pull requests must still publish a deploy preview.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const SCRIPT = process.env.NETLIFY_IGNORE_SCRIPT || path.join(__dirname, "..", "netlify", "ignore-draft-pr.js");
const STUB = path.join(__dirname, "fixtures", "netlify-ignore-fetch-stub.cjs");

function decide(env, cwd = path.join(__dirname, "..")) {
  const clean = { PATH: process.env.PATH };
  const res = spawnSync(process.execPath, ["--require", STUB, SCRIPT], { env: { ...clean, ...env }, cwd, encoding: "utf8" });
  return res.status;
}

const prEnv = {
  CONTEXT: "deploy-preview",
  PULL_REQUEST: "true",
  REVIEW_ID: "123",
  REPOSITORY_URL: "https://github.com/example/example",
  GITHUB_TOKEN: "token",
};

// A throwaway repository with a parent commit and a commit that changes app code. Built per test so
// the result never depends on the history of the checkout (CI uses a shallow clone).
function repoWithAppCodeChange() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netlify-ignore-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  fs.mkdirSync(path.join(dir, "js"));
  fs.writeFileSync(path.join(dir, "js", "app.js"), "1\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  fs.writeFileSync(path.join(dir, "js", "app.js"), "2\n");
  git("commit", "-q", "-am", "change app code");
  return { dir, ref: git("rev-parse", "HEAD"), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("a draft pull request still builds a deploy preview", () => {
  assert.equal(decide(prEnv), 1);
});

test("a pull request ready for review builds a deploy preview", () => {
  assert.equal(decide({ ...prEnv, GITHUB_TOKEN: "" }), 1);
});

test("a production merge that changes app code is left to the cache-version workflow", () => {
  const repo = repoWithAppCodeChange();
  try {
    assert.equal(decide({ CONTEXT: "production", COMMIT_REF: repo.ref }, repo.dir), 0);
  } finally {
    repo.cleanup();
  }
});
