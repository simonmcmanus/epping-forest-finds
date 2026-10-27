// Who owns each linked device. Kept apart from community-account.js so the snapshot builder
// (community-computed.js) can read it without a circular require.
const { mapLimit } = require("./map-limit");

// deviceId -> account key for every linked device, so consensus can treat one account as one voice.
async function loadDeviceOwners(store) {
  const owners = Object.create(null);
  try {
    const keys = await store.list("devicelink/");
    const records = await mapLimit(keys, 25, (key) => store.get(key));
    keys.forEach((key, i) => {
      if (records[i] && records[i].account) owners[key.slice("devicelink/".length)] = records[i].account;
    });
  } catch {
    // Without the links every device counts alone (how it worked before accounts existed). That only
    // loosens the one-account-one-voice rule until the next rebuild, so it must not stop the rebuild.
  }
  return owners;
}

module.exports = { loadDeviceOwners };
