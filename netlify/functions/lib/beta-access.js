// Beta access: an admin makes a short code, one signed-in person redeems it, and that account then has every
// gated feature. Kept in the community store:
//   beta-code/<code> = { note, createdAt, claimedBy?, claimedAt? }
//   beta-revoked/<code> = { at }   (its own record, so a claim writing the code record can never erase a revoke)
//   beta-user/<account key> = { code, at }   (its existence is the access)
// Codes revoked before beta-revoked existed carry revokedAt on the code record; that still counts as revoked.
// Beta never touches the Tester ID list (features-allowlist), so it can never switch the gate on for others.
const crypto = require("crypto");

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no i, l, o, 0, 1: easy to read aloud
const CODE_RE = /^[abcdefghjkmnpqrstuvwxyz2-9]{5}$/;
const CODE_PREFIX = "beta-code/";
const USER_PREFIX = "beta-user/";
const REVOKED_PREFIX = "beta-revoked/";
const NOTE_MAX = 80;

// Lowercase input is accepted; anything that is not a valid code comes back as null.
function normalizeCode(value) {
  const code = String(value == null ? "" : value).trim().toLowerCase();
  return CODE_RE.test(code) ? code : null;
}

function generateCode() {
  let code = "";
  for (let i = 0; i < 5; i += 1) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

// When was this code revoked (ms), or 0 if it was not. Reads the revoke record, then the old in-record field.
async function revokedAtOf(store, code, record) {
  const revoked = await store.getStrict(`${REVOKED_PREFIX}${code}`);
  if (revoked) return Number(revoked.at) || 1;
  return (record && record.revokedAt) || 0;
}

const WITHDRAWN = { ok: false, status: 410, error: "That beta link has been withdrawn." };

// A note saying who the code is for is required: a blank one returns null and nothing is written.
async function createCode(store, note) {
  const text = String(note || "").trim().slice(0, NOTE_MAX).trim();
  if (!text) return null;
  const record = { note: text, createdAt: Date.now() };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateCode();
    if (await store.getStrict(`${CODE_PREFIX}${code}`)) continue;
    await store.put(`${CODE_PREFIX}${code}`, record);
    return { code, note: record.note, createdAt: record.createdAt, status: "open" };
  }
  throw new Error("Could not find a free beta code");
}

// Newest first. Never carries an account value.
async function listCodes(store) {
  const out = [];
  for (const key of await store.list(CODE_PREFIX)) {
    // The local store flattens "/" in keys, so read the code from the end of the key.
    const code = normalizeCode(String(key).slice(-5));
    const record = code && (await store.getStrict(`${CODE_PREFIX}${code}`));
    if (!record) continue;
    const revokedAt = await revokedAtOf(store, code, record);
    const item = { code, note: record.note || "", createdAt: record.createdAt || 0,
      status: revokedAt ? "revoked" : record.claimedBy ? "claimed" : "open" };
    if (record.claimedAt) item.claimedAt = record.claimedAt;
    if (revokedAt) item.revokedAt = revokedAt;
    out.push(item);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

// Keeps the record and withdraws the code. The revoke is its own record, which a claim never writes, so it cannot be
// lost to a claim in flight. Whoever had claimed it loses access.
async function revokeCode(store, value) {
  const code = normalizeCode(value);
  const first = code && (await store.getStrict(`${CODE_PREFIX}${code}`));
  if (!first) return { ok: false, status: 404 };
  if (!(await store.getStrict(`${REVOKED_PREFIX}${code}`))) await store.put(`${REVOKED_PREFIX}${code}`, { at: Date.now() });
  // Read the claimant fresh, after the revoke is in place: a claim that lands later sees the revoke and backs out.
  const record = (await store.getStrict(`${CODE_PREFIX}${code}`)) || first;
  if (record.claimedBy) {
    // Only the grant for this code: the account may since have redeemed another code, which stays valid.
    const grant = await store.getStrict(`${USER_PREFIX}${record.claimedBy}`);
    if (grant && grant.code === code) await store.delete(`${USER_PREFIX}${record.claimedBy}`);
  }
  return { ok: true };
}

const INVALID = "That beta link isn't valid.";

// The first account to redeem a code claims it. Two accounts can race, so claim, then re-read and check
// that the claim is ours before granting (the same claim-then-verify as linkDevice).
async function redeem(store, session, value) {
  const code = normalizeCode(value);
  if (!code) return { ok: false, status: 400, error: INVALID };
  const { accountOf } = require("./community-account");
  const account = await accountOf(store, session);
  const record = await store.getStrict(`${CODE_PREFIX}${code}`);
  if (!record) return { ok: false, status: 404, error: INVALID };
  if (await revokedAtOf(store, code, record)) return WITHDRAWN;
  const used = { ok: false, status: 409, error: "That beta link has already been used." };
  // A used code is used for everyone, including the account that claimed it; its access is left as it is.
  // Only the holder, who still has a valid grant, is told so (member: true), so the page can send them on. Grants nothing.
  if (record.claimedBy && (record.claimedBy !== account || (await betaMember(store, session)))) {
    return record.claimedBy === account ? { ...used, member: true } : used;
  }
  // The claimant whose grant never finished writing (a store error after the claim) retries the same link and is granted.
  if (record.claimedBy) return grant(store, account, code, used);
  await store.put(`${CODE_PREFIX}${code}`, { ...record, claimedBy: account, claimedAt: Date.now() });
  const held = await store.getStrict(`${CODE_PREFIX}${code}`);
  if (await revokedAtOf(store, code, held)) return WITHDRAWN;
  if (!held || held.claimedBy !== account) return used;
  if (await revokedAtOf(store, code, record)) return WITHDRAWN;
  return grant(store, account, code, used);
}

// Writes the grant, then re-reads the code: a revoke or a rival claim that landed meanwhile takes the access back.
async function grant(store, account, code, used) {
  await store.put(`${USER_PREFIX}${account}`, { code, at: Date.now() });
  // A revoke may have landed since: take the access straight back.
  const after = await store.getStrict(`${CODE_PREFIX}${code}`);
  if (!after || (await revokedAtOf(store, code, after))) {
    await store.delete(`${USER_PREFIX}${account}`);
    return WITHDRAWN;
  }
  // A rival claim may have overwritten ours since: the last claim wins, so take the access back and refuse.
  if (after.claimedBy !== account) {
    await store.delete(`${USER_PREFIX}${account}`);
    return used;
  }
  return { ok: true };
}

// Does this signed-in account have beta access? A store that cannot be read never grants.
async function betaMember(store, session) {
  if (!session || !session.sub) return false;
  try {
    const { accountOf } = require("./community-account");
    const account = await accountOf(store, session);
    const member = await store.getStrict(`${USER_PREFIX}${account}`);
    if (!member) return false;
    // The code is the authority: a revoked or re-claimed code ends access even if clean-up never ran.
    const record = await store.getStrict(`${CODE_PREFIX}${member.code}`);
    return Boolean(record && record.claimedBy === account && !(await revokedAtOf(store, member.code, record)));
  } catch {
    return false;
  }
}

module.exports = { ALPHABET, CODE_RE, normalizeCode, generateCode, createCode, listCodes, revokeCode, redeem, betaMember };
