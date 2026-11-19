#!/usr/bin/env node
"use strict";
// One-off, owner-run reset of Community data. Not an HTTP endpoint: nothing deployed can call it.
// Removes every Community record and report photo in ONE explicitly chosen store. GitHub issues are untouched.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execFileSync } = require("child_process");
const { communityStoreName, communityLocalDir, branchName } = require("../netlify/functions/lib/community-store");
const { photoStoreName } = require("../netlify/functions/lib/report-photo");
const { resetCommunityData, RESET_CONFIRMATION } = require("../netlify/functions/lib/community-reset");

const USAGE = `Usage: node scripts/reset-community.js [options]

Deletes every Community record and report photo from one store. GitHub issues are not touched.

Targets (default is the local dev store of the current git branch):
  (no flags)          data/tracking/community/<current git branch>
  --branch <name>     the deploy-preview stores for that branch (community-<name>, report-photos-<name>);
                      needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in the environment
  --production        the PRODUCTION stores "community" and "report-photos"; needs an interactive terminal

Other options:
  --data-dir <dir>    local target only: clear this directory instead (used by tests)
  --help              show this text

Every run prints the stores it will clear, then requires you to type: ${RESET_CONFIRMATION}
`;

function parseArgs(argv) {
  const opts = { branch: null, production: false, dataDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--production") opts.production = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--branch" || arg === "--data-dir") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--branch") opts.branch = value; else opts.dataDir = value;
    } else throw new Error(`Unknown option ${arg}`);
  }
  return opts;
}

function currentGitBranch() {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: path.join(__dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "dev";
  } catch { return "dev"; }
}

// Pure: decide which store to clear. Never reads credentials values, only reports whether they exist.
function resolveTarget(opts, env = process.env, gitBranch = currentGitBranch) {
  if (opts.production && (opts.branch || opts.dataDir)) throw new Error("--production cannot be combined with --branch or --data-dir");
  if (opts.production) return { kind: "blobs", production: true, community: "community", photos: "report-photos" };
  if (opts.branch) {
    if (opts.dataDir) throw new Error("--data-dir only applies to a local target");
    const scoped = { CONTEXT: "deploy-preview", BRANCH: opts.branch };
    const community = communityStoreName(scoped);
    if (community === "community") throw new Error("Refusing: that resolves to the production store. Use --production.");
    return { kind: "blobs", production: false, community, photos: photoStoreName(scoped), branch: branchName(scoped) };
  }
  const dir = opts.dataDir ? path.resolve(opts.dataDir) : communityLocalDir({ CONTEXT: "local", BRANCH: gitBranch() });
  return { kind: "local", production: false, dir };
}

function localStore(dir) {
  const file = (key) => path.join(dir, key.replace(/[^A-Za-z0-9._-]/g, "_") + ".json");
  return {
    async list(prefix) {
      const p = prefix.replace(/[^A-Za-z0-9._-]/g, "_");
      let names;
      try { names = fs.readdirSync(dir); } catch (error) {
        if (error && error.code === "ENOENT") return [];
        throw error;
      }
      return names.filter((n) => n.startsWith(p)).map((n) => n.replace(/\.json$/, ""));
    },
    async delete(key) { try { fs.unlinkSync(file(key)); } catch { /* already gone */ } },
  };
}

function blobStores(target, env) {
  const siteID = env.NETLIFY_SITE_ID;
  const token = env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN to reach Netlify Blobs.");
  const { getStore } = require("@netlify/blobs");
  const community = getStore({ name: target.community, siteID, token });
  const photos = getStore({ name: target.photos, siteID, token });
  return {
    store: {
      async list(prefix) {
        const keys = [];
        let cursor;
        do {
          const page = await community.list({ prefix, ...(cursor ? { cursor } : {}) });
          keys.push(...(page.blobs || []).map((b) => b.key));
          cursor = page.cursor;
        } while (cursor);
        return keys;
      },
      async delete(key) { await community.delete(key); },
    },
    photos, // raw Blobs store: resetCommunityData pages its list itself
  };
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    let answered = false;
    rl.question(question, (answer) => { answered = true; rl.close(); resolve(answer); });
    rl.on("close", () => { if (!answered) resolve(""); });
  });
}

async function main(argv, env = process.env) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(USAGE); return 0; }
  const target = resolveTarget(opts, env);
  if (target.production && !(process.stdin.isTTY && process.stdout.isTTY)) {
    throw new Error("Refusing to reset production without an interactive terminal.");
  }
  let handles;
  if (target.kind === "blobs") handles = blobStores(target, env); // fails early, before any prompt, if credentials are missing
  else handles = { store: localStore(target.dir), photos: null };

  if (target.kind === "local") console.log(`Will clear the LOCAL store directory: ${target.dir}`);
  else console.log(`Will clear ${target.production ? "PRODUCTION " : ""}Netlify Blobs stores: "${target.community}" and "${target.photos}"`);
  const answer = (await ask(`Type ${RESET_CONFIRMATION} to continue: `)).trim();
  if (answer !== RESET_CONFIRMATION) throw new Error("Confirmation phrase did not match. Nothing was deleted.");

  const summary = await resetCommunityData(handles.store, { photos: handles.photos });
  console.log(JSON.stringify(summary));
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`\nreset-community failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, resolveTarget };
