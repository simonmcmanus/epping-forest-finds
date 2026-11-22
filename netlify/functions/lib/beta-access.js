// Beta access: an admin makes a short code, one signed-in person redeems it, and that account then has every
// gated feature. Kept in the community store:
//   beta-code/<code> = { note, createdAt, claimedBy?, claimedAt?, revokedAt? }
//   beta-user/<account key> = { code, at }   (its existence is the access)
// Beta never touches the Tester ID list (features-allowlist), so it can never switch the gate on for others.
const crypto = require("crypto");

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no i, l, o, 0, 1: easy to read aloud
const CODE_RE = /^[abcdefghjkmnpqrstuvwxyz2-9]{5}$/;
const CODE_PREFIX = "beta-code/";
const USER_PREFIX = "beta-user/";
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

const statusOf = (record) => (record.revokedAt ? "revoked" : record.claimedBy ? "claimed" : "open");

async function createCode(store, note) {
  const record = { note: String(note || "").trim().slice(0, NOTE_MAX), createdAt: Date.now() };
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
    const item = { code, note: record.note || "", createdAt: record.createdAt || 0, status: statusOf(record) };
    if (record.claimedAt) item.claimedAt = record.claimedAt;
    out.push(item);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

// Keeps the record and withdraws the code. Whoever had claimed it loses access.
async function revokeCode(store, value) {
  const code = normalizeCode(value);
  const record = code && (await store.getStrict(`${CODE_PREFIX}${code}`));
  if (!record) return { ok: false, status: 404 };
  if (!record.revokedAt) await store.put(`${CODE_PREFIX}${code}`, { ...record, revokedAt: Date.now() });
  if (record.claimedBy) await store.delete(`${USER_PREFIX}${record.claimedBy}`);
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
  if (record.revokedAt) return { ok: false, status: 410, error: "That beta link has been withdrawn." };
  const used = { ok: false, status: 409, error: "That beta link has already been used." };
  if (record.claimedBy && record.claimedBy !== account) return used;
  if (!record.claimedBy) {
    await store.put(`${CODE_PREFIX}${code}`, { ...record, claimedBy: account, claimedAt: Date.now() });
    const held = await store.getStrict(`${CODE_PREFIX}${code}`);
    if (!held || held.claimedBy !== account) return used;
    if (held.revokedAt) return { ok: false, status: 410, error: "That beta link has been withdrawn." };
  }
  await store.put(`${USER_PREFIX}${account}`, { code, at: Date.now() });
  return { ok: true };
}

// Does this signed-in account have beta access? A store that cannot be read never grants.
async function betaMember(store, session) {
  if (!session || !session.sub) return false;
  try {
    const { accountOf } = require("./community-account");
    return Boolean(await store.getStrict(`${USER_PREFIX}${await accountOf(store, session)}`));
  } catch {
    return false;
  }
}

module.exports = { ALPHABET, CODE_RE, normalizeCode, generateCode, createCode, listCodes, revokeCode, redeem, betaMember };
