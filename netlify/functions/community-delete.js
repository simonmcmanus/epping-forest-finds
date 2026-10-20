// POST /api/community/delete  (admin: Authorization: Bearer <ADMIN_PASSWORD>)
// Deletes what the Community features hold about one person, on their request (privacy policy, section 13).
// Body: { "deviceId": "<their recovery code>", "confirm": "delete", "includeAccount": false, "redactIssues": false }.
//  - includeAccount: also remove every other device on the same account, and its link records.
//  - redactIssues: edit and close the public GitHub issues filed from their place changes and feedback.
//    Only honoured on the production deploy (a preview must never edit the real repository); elsewhere, or
//    without it, the issue numbers are returned as `pending` for a person to handle.
// The procedure around it is in docs/community-data-deletion.md.
const { openStore } = require("./lib/community-store");
const { deleteCommunityData } = require("./lib/community-delete");
const { makeGithubIssueEditor } = require("./lib/community-fetch");

function respond(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  if (!adminPassword || auth !== `Bearer ${adminPassword}`) return respond(401, { error: "Unauthorized" });
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });
  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return respond(400, { error: "Invalid JSON" }); }
  if (input.confirm !== "delete") return respond(400, { error: 'Send "confirm": "delete" to confirm: this cannot be undone.' });
  const redact = input.redactIssues === true && process.env.CONTEXT === "production";
  try {
    const summary = await deleteCommunityData(openStore(event), {
      deviceId: input.deviceId,
      includeAccount: input.includeAccount === true,
      github: redact ? makeGithubIssueEditor() : null,
      redactIssues: redact,
    });
    return respond(200, { deleted: true, ...summary });
  } catch (error) {
    // A bad request is the caller's to fix; a storage failure is nobody's fault and is simply retried.
    return /device id/.test(String(error.message)) ? respond(400, { error: String(error.message) }) : respond(503, { error: "Storage unavailable: nothing was confirmed deleted. Try again." });
  }
};
