// POST /api/community/reset  (admin: Authorization: Bearer <ADMIN_PASSWORD>)
// Removes every Community record and report photo in the active deploy context. The exact confirmation
// phrase is deliberately required because this is a whole-dataset destructive operation.
const { openStore } = require("./lib/community-store");
const { isAdminRequest } = require("./lib/admin-auth");
const { photoStoreFor } = require("./lib/report-photo");
const { resetCommunityData, RESET_CONFIRMATION } = require("./lib/community-reset");

function respond(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (!isAdminRequest(event, process.env.ADMIN_PASSWORD || "")) return respond(401, { error: "Unauthorized" });
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });
  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return respond(400, { error: "Invalid JSON" }); }
  if (!input || input.confirm !== RESET_CONFIRMATION) {
    return respond(400, { error: `Send {"confirm":"${RESET_CONFIRMATION}"} to confirm: this cannot be undone.` });
  }
  try {
    const needsBlobPhotos = Boolean(event && event.blobs) || Boolean(process.env.NETLIFY) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
    const photos = photoStoreFor(event);
    if (needsBlobPhotos && !photos) throw new Error("Report-photo storage is unavailable");
    const summary = await resetCommunityData(openStore(event), { photos });
    return respond(200, { reset: true, ...summary });
  } catch (error) {
    console.error("community-reset failed", error);
    return respond(503, { error: "Storage unavailable. The reset may be incomplete; try again." });
  }
};
