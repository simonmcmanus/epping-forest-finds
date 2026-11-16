/**
 * Netlify build decision (netlify/ignore-draft-pr.js): exit 0 skips the build, exit 1 builds.
 * Draft pull requests must still publish a deploy preview.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = process.env.NETLIFY_IGNORE_SCRIPT || path.join(__dirname, "..", "netlify", "ignore-draft-pr.js");
const STUB = path.join(__dirname, "fixtures", "netlify-ignore-fetch-stub.cjs");

function decide(env) {
  const clean = { PATH: process.env.PATH };
  const res = spawnSync(process.execPath, ["--require", STUB, SCRIPT], { env: { ...clean, ...env }, cwd: path.join(__dirname, ".."), encoding: "utf8" });
  return res.status;
}

const prEnv = {
  CONTEXT: "deploy-preview",
  PULL_REQUEST: "true",
  REVIEW_ID: "123",
  REPOSITORY_URL: "https://github.com/example/example",
  GITHUB_TOKEN: "token",
};

test("a draft pull request still builds a deploy preview", () => {
  assert.equal(decide(prEnv), 1);
});

test("a pull request ready for review builds a deploy preview", () => {
  assert.equal(decide({ ...prEnv, GITHUB_TOKEN: "" }), 1);
});

test("a production merge that changes app code is left to the cache-version workflow", () => {
  const ref = spawnSync("git", ["log", "-1", "--format=%H", "--no-merges", "--", "js/"], { encoding: "utf8" }).stdout.trim();
  assert.ok(ref, "repository history has a commit touching js/");
  assert.equal(decide({ CONTEXT: "production", COMMIT_REF: ref }), 0);
});
