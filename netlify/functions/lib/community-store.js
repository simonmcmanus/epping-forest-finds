// Report ledger storage: Netlify Blobs when deployed, NDJSON-ish files under data/tracking/
// when running locally (same split as track.js). Store names are branch-scoped so preview
// deploys never mix with production.
const fs = require("fs");
const path = require("path");
const { connectLambda, getStore } = require("@netlify/blobs");
const { isProductionDeploy } = require("./deploy-context");

const LOCAL_ROOT = path.join(__dirname, "..", "..", "..", "data", "tracking", "community");

function branchName(env = process.env) {
  return (env.BRANCH || "dev").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 48) || "dev";
}

function communityStoreName(env = process.env) {
  if (isProductionDeploy(env)) return "community";
  return `community-${branchName(env)}`;
}

function communityLocalDir(env = process.env) {
  // Keep local development on the same branch boundary as deploy previews. In particular, do not
  // let a feature branch reuse the old shared `data/tracking/community` directory.
  const scope = isProductionDeploy(env) ? "production" : branchName(env);
  return path.join(LOCAL_ROOT, scope);
}

function useBlobs(event) {
  if (event && event.blobs) {
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    connectLambda({ ...event, headers });
    return true;
  }
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
}

function openStore(event) {
  if (useBlobs(event)) {
    const store = getStore(communityStoreName());
    return {
      async get(key) { return store.get(key, { type: "json" }).catch(() => null); },
      // Unlike get, a storage failure throws instead of reading as "nothing there" (used by data deletion).
      async getStrict(key) { return store.get(key, { type: "json" }); },
      async put(key, value) { await store.setJSON(key, value); },
      async delete(key) { await store.delete(key); },
      async list(prefix) {
        const keys = [];
        let cursor;
        do {
          const page = await store.list({ prefix, ...(cursor ? { cursor } : {}) });
          keys.push(...page.blobs.map((b) => b.key));
          cursor = page.cursor;
        } while (cursor);
        return keys;
      },
    };
  }
  const localDir = communityLocalDir();
  const file = (key) => path.join(localDir, key.replace(/[^A-Za-z0-9._-]/g, "_") + ".json");
  return {
    async get(key) {
      try { return JSON.parse(fs.readFileSync(file(key), "utf8")); } catch { return null; }
    },
    // A missing file is "nothing there"; an unreadable or corrupt one is a failure (used by data deletion).
    async getStrict(key) {
      try { return JSON.parse(fs.readFileSync(file(key), "utf8")); } catch (error) {
        if (error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    async put(key, value) {
      fs.mkdirSync(localDir, { recursive: true });
      fs.writeFileSync(file(key), JSON.stringify(value));
    },
    async delete(key) {
      try { fs.unlinkSync(file(key)); } catch { /* already gone */ }
    },
    async list(prefix) {
      const p = prefix.replace(/[^A-Za-z0-9._-]/g, "_");
      let names;
      try { names = fs.readdirSync(localDir); } catch (error) {
        if (error && error.code === "ENOENT") return []; // nothing written yet
        throw error;
      }
      return names.filter((n) => n.startsWith(p)).map((n) => n.replace(/\.json$/, ""));
    },
  };
}

// How many of a device's own reports `mine/<deviceId>` keeps for "My reports". Scores are counted from
// the ledger, not from this log, so the cap only limits how far back the list goes. Every report rewrites
// the whole log, so it stays bounded (about 250 KB at the cap).
const MINE_LOG_MAX = 1000;

module.exports = { openStore, MINE_LOG_MAX, branchName, communityStoreName, communityLocalDir };
