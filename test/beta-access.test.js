/**
 * Beta access (netlify/functions/beta-codes.js, beta-redeem.js, lib/beta-access.js): an admin makes a code, a
 * signed-in person redeems it once, and that account then has every gated feature. Revoking takes it away.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../netlify/functions/lib/auth-session.js");
const features = require("../netlify/functions/features.js");
const codes = require("../netlify/functions/beta-codes.js");
const redeem = require("../netlify/functions/beta-redeem.js");
const beta = require("../netlify/functions/lib/beta-access.js");

const ADMIN = "beta-admin-pw";
const KEY = "k".repeat(40);
const ENV = { AUTH0_DOMAIN: "tenant.example.auth0.test", AUTH0_CLIENT_ID: "id", AUTH0_CLIENT_SECRET: "s", AUTH_SECRET: KEY, ADMIN_PASSWORD: ADMIN };
const OTHER_ID = "9876543210";

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) { return data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null; },
    async getStrict(key) { return this.get(key); },
    async put(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async delete(key) { data.delete(key); },
    async list(prefix) { return [...data.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

async function withStore(store, run) {
  const saved = {};
  for (const k of Object.keys(ENV)) saved[k] = process.env[k];
  Object.assign(process.env, ENV);
  for (const m of [features, codes, redeem]) m.setStore(store);
  try { return await run(); } finally {
    for (const m of [features, codes, redeem]) m.setStore(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const cookieFor = (sub) => `ff_session=${encodeURIComponent(auth.sign({ sub, name: "Sam", exp: Date.now() + 60000 }, KEY))}`;
const adminHeaders = { authorization: `Bearer ${ADMIN}` };
const adminPost = (body) => codes.handler({ httpMethod: "POST", headers: adminHeaders, body: JSON.stringify(body) });
const adminList = async () => JSON.parse((await codes.handler({ httpMethod: "GET", headers: adminHeaders })).body).codes;
const redeemAs = (sub, code) => redeem.handler({ httpMethod: "POST", headers: sub ? { cookie: cookieFor(sub) } : {}, body: JSON.stringify({ code }) });
const communityFor = async (sub) => JSON.parse((await features.handler({ httpMethod: "GET", queryStringParameters: { id: OTHER_ID }, headers: sub ? { cookie: cookieFor(sub) } : {} })).body).community;
const create = async (note = "Sam") => JSON.parse((await adminPost({ action: "create", note })).body);
const gated = () => memoryStore({ "features-allowlist": { community: [{ id: "0123456789", note: "" }] } });

test("an admin creates a five-character beta code that is easy to read aloud", async () => {
  await withStore(memoryStore(), async () => {
    const response = await adminPost({ action: "create", note: "Sam" });
    assert.equal(response.statusCode, 200);
    const made = JSON.parse(response.body);
    assert.match(made.code, /^[abcdefghjkmnpqrstuvwxyz2-9]{5}$/);
    assert.equal(made.status, "open");
    assert.equal(made.note, "Sam");
  });
});

test("beta codes cannot be made or listed without the admin password", async () => {
  const store = memoryStore();
  await withStore(store, async () => {
    for (const headers of [{}, { authorization: "Bearer wrong" }]) {
      const post = await codes.handler({ httpMethod: "POST", headers, body: JSON.stringify({ action: "create" }) });
      assert.equal(post.statusCode, 401);
      assert.equal((await codes.handler({ httpMethod: "GET", headers })).statusCode, 401);
    }
    assert.deepEqual(await adminList(), [], "nothing was created");
  });
});

test("an unrecognised admin request is a 400", async () => {
  await withStore(memoryStore(), async () => {
    assert.equal((await adminPost({ action: "explode" })).statusCode, 400);
    assert.equal((await codes.handler({ httpMethod: "POST", headers: adminHeaders, body: "{nope" })).statusCode, 400);
  });
});

test("the admin list shows open, claimed and revoked codes and never an account", async () => {
  await withStore(memoryStore(), async () => {
    const open = await create("open one");
    const claimed = await create("claimed one");
    const revoked = await create("revoked one");
    assert.equal((await redeemAs("auth0|a", claimed.code)).statusCode, 200);
    assert.equal((await adminPost({ action: "revoke", code: revoked.code })).statusCode, 200);
    const response = await codes.handler({ httpMethod: "GET", headers: adminHeaders });
    const list = JSON.parse(response.body).codes;
    const status = Object.fromEntries(list.map((c) => [c.code, c.status]));
    assert.deepEqual(status, { [open.code]: "open", [claimed.code]: "claimed", [revoked.code]: "revoked" });
    assert.ok(list.find((c) => c.code === claimed.code).claimedAt);
    assert.ok(!/claimedBy|account/i.test(response.body), "no account value is returned");
  });
});

test("redeeming an open code gives that account Community even when the tester list names someone else", async () => {
  await withStore(gated(), async () => {
    const { code } = await create();
    assert.equal(await communityFor("auth0|a"), false);
    assert.equal((await redeemAs("auth0|a", code.toUpperCase())).statusCode, 200);
    assert.equal(await communityFor("auth0|a"), true);
    assert.equal(await communityFor(null), false, "anonymous readers are unchanged");
    assert.equal(await communityFor("auth0|b"), false, "other accounts are unchanged");
  });
});

test("beta access does not switch the gate on for others when the tester list is empty", async () => {
  await withStore(memoryStore(), async () => {
    const { code } = await create();
    await redeemAs("auth0|a", code);
    assert.equal(await communityFor(null), true, "an empty list still means everyone");
    const stored = await features.handler({ httpMethod: "GET", queryStringParameters: { admin: "1" }, headers: adminHeaders });
    assert.deepEqual(JSON.parse(stored.body), { community: [] });
  });
});

test("an unknown code is 404 and a revoked code is 410", async () => {
  await withStore(memoryStore(), async () => {
    assert.equal((await redeemAs("auth0|a", "zzzzz")).statusCode, 404);
    const { code } = await create();
    await adminPost({ action: "revoke", code });
    const gone = await redeemAs("auth0|a", code);
    assert.equal(gone.statusCode, 410);
    assert.equal(JSON.parse(gone.body).error, "That beta link has been withdrawn.");
    assert.equal((await adminPost({ action: "revoke", code: "zzzzz" })).statusCode, 404);
  });
});

test("a badly formed code or body is 400", async () => {
  await withStore(memoryStore(), async () => {
    for (const code of ["", "abc", "a234el", "a2340", "ab-de", null]) {
      const response = await redeemAs("auth0|a", code);
      assert.equal(response.statusCode, 400, String(code));
      assert.equal(JSON.parse(response.body).error, "That beta link isn't valid.");
    }
    const bad = await redeem.handler({ httpMethod: "POST", headers: { cookie: cookieFor("auth0|a") }, body: "{nope" });
    assert.equal(bad.statusCode, 400);
  });
});

test("a used code cannot be redeemed again, even by the account that claimed it, and that account keeps its access", async () => {
  await withStore(gated(), async () => {
    const { code } = await create();
    assert.equal((await redeemAs("auth0|a", code)).statusCode, 200);
    const again = await redeemAs("auth0|a", code);
    assert.equal(again.statusCode, 409);
    assert.equal(JSON.parse(again.body).error, "That beta link has already been used.");
    assert.equal(await communityFor("auth0|a"), true);
  });
});

test("the claimant's second redeem is 409 marked member, and nothing changes", async () => {
  await withStore(gated(), async () => {
    const { code } = await create();
    await redeemAs("auth0|a", code);
    const again = await redeemAs("auth0|a", code);
    assert.equal(again.statusCode, 409);
    assert.equal(JSON.parse(again.body).member, true);
    assert.equal(JSON.parse(again.body).error, "That beta link has already been used.");
    assert.equal(await communityFor("auth0|a"), true);
    const other = await redeemAs("auth0|b", code);
    assert.equal(other.statusCode, 409);
    assert.notEqual(JSON.parse(other.body).member, true);
    assert.equal(await communityFor("auth0|b"), false);
    assert.equal(await communityFor("auth0|a"), true);
  });
});

test("a code belongs to one person: another account gets 409 and has no access", async () => {
  await withStore(gated(), async () => {
    const { code } = await create();
    assert.equal((await redeemAs("auth0|a", code)).statusCode, 200);
    const second = await redeemAs("auth0|b", code);
    assert.equal(second.statusCode, 409);
    assert.equal(JSON.parse(second.body).error, "That beta link has already been used.");
    assert.equal(await communityFor("auth0|b"), false);
    assert.equal(await communityFor("auth0|a"), true);
  });
});

test("revoking a claimed code removes that person's Community access", async () => {
  await withStore(gated(), async () => {
    const { code } = await create();
    await redeemAs("auth0|a", code);
    assert.equal(await communityFor("auth0|a"), true);
    assert.deepEqual(JSON.parse((await adminPost({ action: "revoke", code })).body), { ok: true });
    assert.equal(await communityFor("auth0|a"), false);
    assert.equal((await adminList())[0].status, "revoked", "the record is kept");
  });
});

test("a signed-out redeem is 401 and reveals nothing about the code", async () => {
  await withStore(memoryStore(), async () => {
    const { code } = await create();
    for (const tried of [code, "zzzzz", "bad"]) {
      const response = await redeemAs(null, tried);
      assert.equal(response.statusCode, 401);
      assert.deepEqual(JSON.parse(response.body), { error: "Sign in first." });
    }
  });
});

test("when the beta record cannot be read, nobody is given access", async () => {
  const inner = gated();
  const store = { ...inner, get: async (key) => { if (key.startsWith("beta-user/")) throw new Error("down"); return inner.get(key); },
    getStrict: async (key) => { if (key.startsWith("beta-user/")) throw new Error("down"); return inner.getStrict(key); } };
  await withStore(store, async () => {
    const response = await features.handler({ httpMethod: "GET", queryStringParameters: { id: OTHER_ID }, headers: { cookie: cookieFor("auth0|a") } });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).community, false);
  });
});

test("an admin change that cannot reach storage is a 503", async () => {
  const fail = async () => { throw new Error("down"); };
  await withStore({ get: fail, getStrict: fail, put: fail, delete: fail, list: fail }, async () => {
    const response = await adminPost({ action: "create", note: "Sam" });
    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).error, "Storage unavailable: nothing was saved. Try again.");
  });
});

test("when two accounts race for one code, only the one that holds the claim is let in", async () => {
  const inner = memoryStore();
  await withStore(inner, async () => {
    const { code } = await create();
    // The rival's claim lands between our write and our re-read.
    let rival = false;
    const racing = { ...inner, async put(key, value) {
      await inner.put(key, value);
      if (key === `beta-code/${code}` && !rival) { rival = true; await inner.put(key, { ...value, claimedBy: "someone-else" }); }
    } };
    const result = await beta.redeem(racing, { sub: "auth0|a" }, code);
    assert.equal(result.status, 409);
    assert.equal(await inner.get(`beta-user/${require("../netlify/functions/lib/community-account").accountKey("auth0|a")}`), null);
  });
});

test("an account whose code was revoked has no Community access even if its beta record was left behind", async () => {
  const inner = gated();
  await withStore(inner, async () => {
    const { code } = await create();
    await redeemAs("auth0|a", code);
    assert.equal(await communityFor("auth0|a"), true);
    // A revoke that landed after the claim, with no clean-up of the account's record.
    await inner.put(`beta-code/${code}`, { ...(await inner.get(`beta-code/${code}`)), revokedAt: Date.now() });
    assert.equal(await communityFor("auth0|a"), false);
  });
});

test("an account whose beta record names a code it does not hold has no Community access", async () => {
  const inner = gated();
  await withStore(inner, async () => {
    const { code } = await create();
    await redeemAs("auth0|a", code);
    await inner.put(`beta-code/${code}`, { ...(await inner.get(`beta-code/${code}`)), claimedBy: "someone-else" });
    assert.equal(await communityFor("auth0|a"), false);
  });
});

test("a code revoked while it is being redeemed is 410 and leaves the account without access", async () => {
  const inner = gated();
  await withStore(inner, async () => {
    const { code } = await create();
    const revokingMidWay = { ...inner, async put(key, value) {
      await inner.put(key, value);
      if (key.startsWith("beta-user/")) await inner.put(`beta-code/${code}`, { ...(await inner.get(`beta-code/${code}`)), revokedAt: Date.now() });
    } };
    const result = await beta.redeem(revokingMidWay, { sub: "auth0|a" }, code);
    assert.equal(result.status, 410);
    assert.equal(result.error, "That beta link has been withdrawn.");
    assert.equal(await communityFor("auth0|a"), false);
    assert.equal(await inner.get(`beta-user/${require("../netlify/functions/lib/community-account").accountKey("auth0|a")}`), null);
  });
});

test("a claimant whose grant failed to write retries the same link and is let in, once", async () => {
  const inner = gated();
  await withStore(inner, async () => {
    const { code } = await create();
    let failed = false;
    const flaky = { ...inner, async put(key, value) {
      if (key.startsWith("beta-user/") && !failed) { failed = true; throw new Error("transient"); }
      return inner.put(key, value);
    } };
    await assert.rejects(beta.redeem(flaky, { sub: "auth0|a" }, code));
    assert.equal(await communityFor("auth0|a"), false);
    assert.equal((await redeemAs("auth0|b", code)).statusCode, 409);
    assert.equal(await communityFor("auth0|b"), false);
    assert.equal((await redeemAs("auth0|a", code)).statusCode, 200);
    assert.equal(await communityFor("auth0|a"), true);
    const again = await redeemAs("auth0|a", code);
    assert.equal(again.statusCode, 409);
    assert.equal(JSON.parse(again.body).member, true);
  });
});

test("creating a code without a note is refused and writes nothing", async () => {
  for (const note of [undefined, "", "   \t "]) {
    const store = memoryStore();
    await withStore(store, async () => {
      const response = await adminPost({ action: "create", note });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(JSON.parse(response.body), { error: "Add a name for the person this code is for." });
      assert.deepEqual(await store.list("beta-code/"), [], "no beta-code record was written");
    });
  }
});

test("creating a code with a note still works and trims the note", async () => {
  await withStore(memoryStore(), async () => {
    const response = await adminPost({ action: "create", note: "  Sam from the club  " });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).note, "Sam from the club");
  });
});

test("the admin list gives the revoked date of a revoked code and never an account", async () => {
  await withStore(memoryStore(), async () => {
    const claimed = await create("claimed then revoked");
    const open = await create("still open");
    assert.equal((await redeemAs("auth0|a", claimed.code)).statusCode, 200);
    assert.equal((await adminPost({ action: "revoke", code: claimed.code })).statusCode, 200);
    const response = await codes.handler({ httpMethod: "GET", headers: adminHeaders });
    const list = JSON.parse(response.body).codes;
    assert.equal(typeof list.find((c) => c.code === claimed.code).revokedAt, "number");
    assert.equal("revokedAt" in list.find((c) => c.code === open.code), false);
    assert.ok(!/claimedBy|account/i.test(response.body), "no account value is returned");
  });
});

const accountKeyOf = (sub) => require("../netlify/functions/lib/community-account").accountKey(sub);

test("a revoke that runs in full while a claim is being written still ends as 410 with no access", async () => {
  const inner = gated();
  await withStore(inner, async () => {
    const { code } = await create();
    let revoked = false;
    const interleaved = { ...inner, async put(key, value) {
      if (key === `beta-code/${code}` && value.claimedBy && !revoked) { revoked = true; await beta.revokeCode(inner, code); }
      await inner.put(key, value);
    } };
    const result = await beta.redeem(interleaved, { sub: "auth0|a" }, code);
    assert.equal(result.status, 410);
    assert.equal(result.error, "That beta link has been withdrawn.");
    assert.equal(await communityFor("auth0|a"), false);
    assert.equal(await inner.get(`beta-user/${accountKeyOf("auth0|a")}`), null);
    assert.equal((await adminList())[0].status, "revoked");
  });
});

test("a revoke that lands after the claim and before the access is written is 410 with no access", async () => {
  const inner = gated();
  await withStore(inner, async () => {
    const { code } = await create();
    let revoked = false;
    const interleaved = { ...inner, async put(key, value) {
      if (key.startsWith("beta-user/") && !revoked) { revoked = true; await beta.revokeCode(inner, code); }
      await inner.put(key, value);
    } };
    const result = await beta.redeem(interleaved, { sub: "auth0|a" }, code);
    assert.equal(result.status, 410);
    assert.equal(await communityFor("auth0|a"), false);
    assert.equal(await inner.get(`beta-user/${accountKeyOf("auth0|a")}`), null);
  });
});

test("revoking removes an existing claimant's access record as well as refusing the code", async () => {
  const inner = gated();
  await withStore(inner, async () => {
    const { code } = await create();
    await redeemAs("auth0|a", code);
    assert.ok(await inner.get(`beta-user/${accountKeyOf("auth0|a")}`));
    await adminPost({ action: "revoke", code });
    assert.equal(await inner.get(`beta-user/${accountKeyOf("auth0|a")}`), null);
    assert.equal(await communityFor("auth0|a"), false);
    assert.equal((await redeemAs("auth0|a", code)).statusCode, 410);
    assert.equal(await communityFor("auth0|a"), false);
  });
});

test("a code revoked before revocation had its own record is still refused and gives no access", async () => {
  const inner = gated();
  await withStore(inner, async () => {
    await inner.put("beta-code/abcde", { note: "old", createdAt: 5, revokedAt: 1234 });
    assert.equal((await redeemAs("auth0|a", "abcde")).statusCode, 410);
    assert.equal(await communityFor("auth0|a"), false);
    assert.equal(await inner.get(`beta-user/${accountKeyOf("auth0|a")}`), null);
    const [row] = await adminList();
    assert.equal(row.status, "revoked");
    assert.equal(row.revokedAt, 1234);
    // And an old claimed-then-revoked code with a left-over access record grants nothing.
    await inner.put("beta-code/fghjk", { note: "old2", createdAt: 6, claimedBy: accountKeyOf("auth0|b"), claimedAt: 7, revokedAt: 9 });
    await inner.put(`beta-user/${accountKeyOf("auth0|b")}`, { code: "fghjk", at: 7 });
    assert.equal(await communityFor("auth0|b"), false);
  });
});

test("the list shows a revoked claimed code as revoked with a numeric revoked date and no account", async () => {
  await withStore(memoryStore(), async () => {
    const { code } = await create("Sam");
    await redeemAs("auth0|a", code);
    await adminPost({ action: "revoke", code });
    const response = await codes.handler({ httpMethod: "GET", headers: adminHeaders });
    const row = JSON.parse(response.body).codes.find((c) => c.code === code);
    assert.equal(row.status, "revoked");
    assert.equal(typeof row.revokedAt, "number");
    assert.ok(!/claimedBy|account/i.test(response.body));
  });
});

test("revoking an earlier code does not take away access an account got from a later code", async () => {
  await withStore(gated(), async () => {
    const first = await create("first");
    const second = await create("second");
    await redeemAs("auth0|x", first.code);
    await redeemAs("auth0|x", second.code);
    assert.equal(await communityFor("auth0|x"), true);
    assert.equal((await adminPost({ action: "revoke", code: first.code })).statusCode, 200);
    assert.equal(await communityFor("auth0|x"), true, "the account keeps the access its other code gives");
  });
});

test("when a rival's claim overwrites ours before the access is written, the loser is 409 and has no access", async () => {
  const inner = memoryStore();
  await withStore(inner, async () => {
    const { code } = await create();
    const { accountKey } = require("../netlify/functions/lib/community-account");
    // The rival's claim lands after our claim was verified, just before our access is written.
    let rival = false;
    const racing = { ...inner, async put(key, value) {
      if (key.startsWith("beta-user/") && !rival) { rival = true; await inner.put(`beta-code/${code}`, { ...(await inner.get(`beta-code/${code}`)), claimedBy: "someone-else" }); }
      await inner.put(key, value);
    } };
    const result = await beta.redeem(racing, { sub: "auth0|a" }, code);
    assert.equal(result.status, 409);
    assert.equal(result.error, "That beta link has already been used.");
    assert.equal(await inner.get(`beta-user/${accountKey("auth0|a")}`), null);
  });
});
