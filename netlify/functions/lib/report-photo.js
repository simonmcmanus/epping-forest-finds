// Photos sent with a report: validated once and kept in the Netlify Blobs store `report-photos`.
// Shared by the public issue filer (report-missing-data) and the tree report endpoint (community-report),
// so both accept and store the same formats and sizes.
const { randomUUID } = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

const REPORT_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const REPORT_PHOTO_STORE = "report-photos";

function configureBlobContext(event) {
  if (!event?.blobs) return false;
  try {
    const headers = Object.fromEntries(
      Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    connectLambda({ ...event, headers });
    return true;
  } catch {
    return false;
  }
}

function parsePhoto(photo) {
  if (photo == null) return null;
  if (!photo || typeof photo !== "object") throw new Error("Photo must be an image file");
  const contentType = String(photo.contentType || "").toLowerCase();
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  if (!extensions[contentType]) throw new Error("Please use a JPEG, PNG, or WebP photo");
  const match = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(String(photo.dataUrl || ""));
  if (!match || match[1].toLowerCase() !== contentType) throw new Error("Photo data is invalid");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > REPORT_PHOTO_MAX_BYTES) throw new Error("Photo is too large");
  return { contentType, extension: extensions[contentType], bytes };
}

// Stores a parsed photo and returns its id. Throws when storage is unavailable, so the caller can refuse
// the report (the outbox retries a 5xx) rather than file it without the photo.
async function savePhoto(event, photo) {
  if (!configureBlobContext(event)) throw new Error("Photo storage is unavailable");
  const photoId = `${randomUUID()}.${photo.extension}`;
  await getStore(REPORT_PHOTO_STORE).set(`photos/${photoId}`, photo.bytes, { metadata: { contentType: photo.contentType } });
  return photoId;
}

module.exports = { REPORT_PHOTO_MAX_BYTES, REPORT_PHOTO_STORE, configureBlobContext, parsePhoto, savePhoto };
