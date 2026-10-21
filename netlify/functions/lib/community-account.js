// Community accounts: one account can own several anonymous device ids (phone, laptop), so scores
// and the log add up across them. The device id stays the ledger key; an account is only a list of
// device ids, so no reports are moved or rewritten when someone signs in.
const crypto = require("crypto");
const { EMPTY_SCORE } = require("./community-computed");
const { loadDeviceOwners } = require("./community-links");

const MAX_DEVICES_PER_ACCOUNT = 20;

// The provider's subject id is never stored in the clear: the account key is its hash.
function accountKey(sub) {
  return crypto.createHash("sha256").update(String(sub)).digest("hex").slice(0, 32);
}

// Who owns a device is one record per device: `devicelink/<deviceId>` = { account }. That is the only
// thing trusted. An account's membership is a set of independent marker records,
// `accountdevices/<account>/<deviceId>`, written one per device, so two links never read-modify-write
// a shared list and nothing can be lost to a concurrent update. Every read still checks the owner record
// (devicesForRequest), so a stray or half-written marker can never expose another account's device.
//
// The store has no atomic compare-and-set, so linking claims the owner record first, then re-reads it to
// see whether a concurrent link won the write, and only then writes the marker. A failure between the two
// leaves the device owned but not yet a member, which linking the same pair again completes.
const markerPrefix = (account) => `accountdevices/${account}/`;

async function linkDevice(store, account, deviceId) {
  const owner = await store.get(`devicelink/${deviceId}`);
  if (owner && owner.account !== account) return { ok: false, status: 409, error: "This device is already linked to another account." };
  if (!owner) {
    // A soft cap: concurrent first links can overshoot it by a few, which is harmless.
    if ((await store.list(markerPrefix(account))).length >= MAX_DEVICES_PER_ACCOUNT) {
      return { ok: false, status: 409, error: "This account already has the most devices it can link." };
    }
    await store.put(`devicelink/${deviceId}`, { account });
    const claimed = await store.get(`devicelink/${deviceId}`);
    if (!claimed || claimed.account !== account) return { ok: false, status: 409, error: "This device is already linked to another account." };
  }
  await store.put(`${markerPrefix(account)}${deviceId}`, { at: Date.now() });
  return { ok: true };
}

// Merging two sign-ins leaves an alias behind: a login that was merged away still works, but as the account it
// was merged into. Followed a few hops so a chain of merges resolves, with a cap so a cycle cannot loop.
const ALIAS_PREFIX = "accountalias/";

async function canonicalAccount(store, key) {
  let current = key;
  for (let hop = 0; hop < 5; hop += 1) {
    const alias = await store.get(`${ALIAS_PREFIX}${current}`);
    if (!alias || !alias.to || alias.to === current) return current;
    current = alias.to;
  }
  return current;
}

// The account a signed-in session acts for, after any merges.
const accountOf = (store, session) => canonicalAccount(store, accountKey(session.sub));

// Brings every device of one account under another, and aliases the first to the second. The caller is
// responsible for having proved control of both logins. Order matters: devices are re-pointed and the alias
// written before the old markers go, so a failure part-way never leaves a device without an owner.
async function mergeAccounts(store, fromKey, intoKey) {
  const from = await canonicalAccount(store, fromKey);
  const into = await canonicalAccount(store, intoKey);
  if (from === into) return { ok: true, same: true, moved: 0 };
  const prefix = markerPrefix(from);
  const devices = [];
  for (const key of await store.list(prefix)) {
    const device = key.slice(prefix.length);
    const owner = await store.get(`devicelink/${device}`);
    if (owner && owner.account === from) devices.push(device);
  }
  const existing = (await store.list(markerPrefix(into))).length;
  if (existing + devices.length > MAX_DEVICES_PER_ACCOUNT) {
    return { ok: false, status: 409, error: "Together these sign-ins would have more devices than one account can hold." };
  }
  for (const device of devices) {
    await store.put(`devicelink/${device}`, { account: into });
    await store.put(`${markerPrefix(into)}${device}`, { at: Date.now() });
  }
  await store.put(`${ALIAS_PREFIX}${from}`, { to: into, at: Date.now() });
  for (const device of devices) await store.delete(`${prefix}${device}`);
  return { ok: true, same: false, moved: devices.length };
}

// The devices that really belong to the signed-in account: each marker is checked against the authoritative
// owner record, so a stray or stale marker never counts.
async function devicesOfAccount(store, session) {
  if (!session || !session.sub) return [];
  const account = await accountOf(store, session);
  const prefix = markerPrefix(account);
  const owned = [];
  for (const key of await store.list(prefix)) {
    const device = key.slice(prefix.length);
    const owner = await store.get(`devicelink/${device}`);
    if (owner && owner.account === account) owned.push(device);
  }
  return owned;
}

// The device ids a request may read as one person.
//  - Anonymous (no session): the requested device alone, as before.
//  - Signed in, and the device is one of the account's: all of the account's devices that it still owns
//    (checked against each device's owner record).
//  - Signed in, and the device belongs to a different account: never that device. This account is shown
//    only its own devices, so a second person on someone else's browser sees none of their data.
//  - Signed in, and the device has no owner yet: the device alone (it is about to be linked).
async function devicesForRequest(store, deviceId, session) {
  if (!session || !session.sub) return [deviceId];
  const account = await accountOf(store, session);
  const owned = await devicesOfAccount(store, session);
  if (owned.includes(deviceId)) return owned;
  const owner = await store.get(`devicelink/${deviceId}`);
  if (owner && owner.account !== account) return owned;
  return [deviceId];
}

// Sums per-device scores. Each field is a count or points, so adding them is the account's total.
function mergeScores(scores) {
  const merged = { ...EMPTY_SCORE, generatedAt: 0 };
  for (const score of scores) {
    for (const key of Object.keys(EMPTY_SCORE)) merged[key] += Number(score[key]) || 0;
    merged.generatedAt = Math.max(merged.generatedAt, Number(score.generatedAt) || 0);
  }
  return merged;
}

module.exports = { accountKey, canonicalAccount, accountOf, mergeAccounts, linkDevice, devicesOfAccount, devicesForRequest, loadDeviceOwners, mergeScores, MAX_DEVICES_PER_ACCOUNT };
