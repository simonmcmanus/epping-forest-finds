// Community accounts: one account can own several anonymous device ids (phone, laptop), so scores
// and the log add up across them. The device id stays the ledger key; an account is only a list of
// device ids, so no reports are moved or rewritten when someone signs in.
const crypto = require("crypto");
const { EMPTY_SCORE } = require("./community-computed");

const MAX_DEVICES_PER_ACCOUNT = 20;

// The provider's subject id is never stored in the clear: the account key is its hash.
function accountKey(sub) {
  return crypto.createHash("sha256").update(String(sub)).digest("hex").slice(0, 32);
}

// A device belongs to at most one account. Re-linking the same pair is a no-op.
async function linkDevice(store, account, deviceId) {
  const owner = await store.get(`devicelink/${deviceId}`);
  if (owner && owner.account !== account) return { ok: false, status: 409, error: "This device is already linked to another account." };
  const record = (await store.get(`accounts/${account}`)) || { devices: [] };
  if (!record.devices.includes(deviceId)) {
    if (record.devices.length >= MAX_DEVICES_PER_ACCOUNT) return { ok: false, status: 409, error: "This account already has the most devices it can link." };
    record.devices.push(deviceId);
    await store.put(`accounts/${account}`, record);
  }
  if (!owner) await store.put(`devicelink/${deviceId}`, { account });
  return { ok: true };
}

// The device ids a request may read as one person: all of the signed-in account's devices when the
// requested device is one of them, otherwise just the requested device.
async function devicesForRequest(store, deviceId, session) {
  if (!session || !session.sub) return [deviceId];
  const record = (await store.get(`accounts/${accountKey(session.sub)}`)) || { devices: [] };
  return record.devices.includes(deviceId) ? record.devices : [deviceId];
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

module.exports = { accountKey, linkDevice, devicesForRequest, mergeScores, MAX_DEVICES_PER_ACCOUNT };
