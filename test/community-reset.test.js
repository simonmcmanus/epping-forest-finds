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

test("the reset endpoint requires admin auth, POST, and the exact destructive confirmation", async () => {
  const original = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "admin-secret-1";
  delete require.cache[require.resolve("../netlify/functions/community-reset")];
  const endpoint = require("../netlify/functions/community-reset");
  const admin = { authorization: "Bearer admin-secret-1" };
  try {
    assert.equal((await endpoint.handler({ httpMethod: "POST", headers: {}, body: "{}" })).statusCode, 401);
    assert.equal((await endpoint.handler({ httpMethod: "GET", headers: admin })).statusCode, 405);
    assert.equal((await endpoint.handler({ httpMethod: "POST", headers: admin, body: "{}" })).statusCode, 400);
    const wrong = await endpoint.handler({ httpMethod: "POST", headers: admin, body: JSON.stringify({ confirm: "reset" }) });
    assert.equal(wrong.statusCode, 400);
    assert.match(JSON.parse(wrong.body).error, new RegExp(RESET_CONFIRMATION));
  } finally {
    if (original === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = original;
    delete require.cache[require.resolve("../netlify/functions/community-reset")];
  }
});
