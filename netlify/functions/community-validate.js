// GET|POST /api/community/validate  (admin: Authorization: Bearer <ADMIN_PASSWORD>)
// Runs the reward check now: compares the report ledger with the current City of London register and
// credits reporters whose issues were closed as completed. The same pass runs daily from
// community-validate-scheduled.js. Idempotent: running it twice never pays twice.
const { openStore } = require("./lib/community-store");
const { runValidation } = require("./lib/community-validation");
const { makeFetchJson, makeGithub } = require("./lib/community-fetch");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

exports.handler = async (event) => {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  if (!ADMIN_PASSWORD || auth !== `Bearer ${ADMIN_PASSWORD}`) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  const summary = await runValidation({ store: openStore(event), fetchJson: makeFetchJson(event), github: makeGithub() });
  return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(summary) };
};
