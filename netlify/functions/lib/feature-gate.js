// Feature gate: which testers see the Community features, kept as a list in the same store as the
// community ledger so it can be edited from the admin page without a deploy. While the list is empty the
// gate is off and everyone has the feature.
//
// A tester is named by a short hash (the "Tester ID" the Settings screen shows), never by the device
// id itself, because the device id is also the recovery code for someone's points. A person is let in
// when either their device's hash or their signed-in account's hash is on the list.
const crypto = require("crypto");
const { openStore } = require("./community-store");

const LIST_KEY = "features-allowlist";
const FEATURES = ["community"];
const ID_RE = /^[a-f0-9]{10}$/;

function testerHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 10);
}

// The list as stored: { community: [{ id, note }] }. Anything malformed reads as an empty list.
function normalizeList(raw) {
  const out = {};
  for (const feature of FEATURES) {
    const seen = new Set();
    out[feature] = [];
    for (const entry of Array.isArray(raw && raw[feature]) ? raw[feature] : []) {
      const id = String((entry && entry.id) || "").trim().toLowerCase();
      if (!ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      out[feature].push({ id, note: String((entry && entry.note) || "").slice(0, 80) });
    }
  }
  return out;
}

async function readList(event) {
  return normalizeList(await openStore(event).get(LIST_KEY));
}

async function writeList(event, list) {
  const clean = normalizeList(list);
  await openStore(event).put(LIST_KEY, clean);
  return clean;
}

// Every Tester ID this request can vouch for: the device's own, and, when signed in, the account's and that of
// each device linked to the account. A person is named once (by any one of their devices or by the account)
// and keeps access on every device they sign in on.
async function vouchedIds(store, deviceHash, session) {
  const ids = [String(deviceHash || "").toLowerCase()];
  if (session && session.sub) {
    const { accountKey, devicesOfAccount } = require("./community-account");
    ids.push(testerHash(accountKey(session.sub)));
    for (const device of await devicesOfAccount(store, session)) ids.push(testerHash(device));
  }
  return ids;
}

// `ids` are the hashes this request can vouch for (the device's own, and the signed-in account's).
// An empty list means the gate is off: with nobody named, everyone has the feature.
function enabledFor(list, ids) {
  const wanted = new Set(ids.filter((id) => ID_RE.test(String(id || ""))));
  const result = {};
  for (const feature of FEATURES) result[feature] = list[feature].length === 0 || list[feature].some((entry) => wanted.has(entry.id));
  return result;
}

module.exports = { testerHash, normalizeList, readList, writeList, enabledFor, vouchedIds, FEATURES, ID_RE };
