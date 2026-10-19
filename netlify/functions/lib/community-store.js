// Report ledger storage: Netlify Blobs when deployed, NDJSON-ish files under data/tracking/
// when running locally (same split as track.js). Store names are branch-scoped so preview
// deploys never mix with production.
const fs = require("fs");
const path = require("path");
const { connectLambda, getStore } = require("@netlify/blobs");

const LOCAL_DIR = path.join(__dirname, "..", "..", "..", "data", "tracking", "community");

function storeName() {
  if (process.env.CONTEXT === "production") return "community";
  const branch = (process.env.BRANCH || "dev").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 48);
  return `community-${branch}`;
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
    const store = getStore(storeName());
    return {
      async get(key) { return store.get(key, { type: "json" }).catch(() => null); },
      async put(key, value) { await store.setJSON(key, value); },
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
  const file = (key) => path.join(LOCAL_DIR, key.replace(/[^A-Za-z0-9._-]/g, "_") + ".json");
  return {
    async get(key) {
      try { return JSON.parse(fs.readFileSync(file(key), "utf8")); } catch { return null; }
    },
    async put(key, value) {
      fs.mkdirSync(LOCAL_DIR, { recursive: true });
      fs.writeFileSync(file(key), JSON.stringify(value));
    },
    async list(prefix) {
      try {
        const p = prefix.replace(/[^A-Za-z0-9._-]/g, "_");
        return fs.readdirSync(LOCAL_DIR).filter((n) => n.startsWith(p)).map((n) => n.replace(/\.json$/, ""));
      } catch { return []; }
    },
  };
}

module.exports = { openStore };
