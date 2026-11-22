// Reset every record held by the Community feature for the active deploy context.
// This intentionally does not call GitHub: external issues are not Community storage and may contain
// reports from more than one person.
const { mapLimit } = require("./map-limit");

const DELETE_CONCURRENCY = 25;
const RESET_CONFIRMATION = "RESET ALL COMMUNITY DATA";
const PHOTO_PREFIXES = ["photos/", "tree-photos/"];

async function deleteKeys(store, keys) {
  await mapLimit(keys, DELETE_CONCURRENCY, (key) => store.delete(key));
  return keys.length;
}

// The community store adapter exposes list(prefix) as an array. Photo stores are raw Netlify Blob stores,
// whose list API is paginated, so keep the two contracts explicit at this boundary.
async function listKeys(store, prefix = "", rawBlobStore = false) {
  if (!rawBlobStore) return store.list(prefix);
  const keys = [];
  let cursor;
  do {
    const page = await store.list({ prefix, ...(cursor ? { cursor } : {}) });
    keys.push(...(page.blobs || []).map((blob) => blob.key));
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

async function resetCommunityData(store, { photos = null } = {}) {
  if (!store || typeof store.list !== "function" || typeof store.delete !== "function") {
    throw new Error("Community storage is unavailable");
  }
  let photoCount = 0;
  // Remove photos first. If photo storage is unavailable, no Community records have been removed yet and
  // the caller can retry without leaving a reset that reported success while retaining uploads.
  if (photos) {
    for (const prefix of PHOTO_PREFIXES) photoCount += await deleteKeys(photos, await listKeys(photos, prefix, true));
  }
  const records = await deleteKeys(store, await listKeys(store));
  return { records, photos: photoCount };
}

module.exports = { resetCommunityData, RESET_CONFIRMATION, PHOTO_PREFIXES };
