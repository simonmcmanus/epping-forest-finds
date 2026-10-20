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

// The device ids a request may read as one person: the signed-in account's devices that it still owns
// (checked against each device's owner record) when the requested device is one of them, otherwise just
// the requested device.
async function devicesForRequest(store, deviceId, session) {
  if (!session || !session.sub) return [deviceId];
  const account = accountKey(session.sub);
  const prefix = markerPrefix(account);
  const owned = [];
  for (const key of await store.list(prefix)) {
    const device = key.slice(prefix.length);
    const owner = await store.get(`devicelink/${device}`);
    if (owner && owner.account === account) owned.push(device);
  }
  return owned.includes(deviceId) ? owned : [deviceId];
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

module.exports = { accountKey, linkDevice, devicesForRequest, loadDeviceOwners, mergeScores, MAX_DEVICES_PER_ACCOUNT };
