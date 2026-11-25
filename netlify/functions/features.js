// GET /api/features   which gated features this person has: { community: boolean }
// Community is for beta members only: a signed-in account that redeemed an open beta code. Everyone else gets
// community:false and the Feedback page. There is no allow list and nothing to write: POST and ?admin=1 are
// answered exactly like GET and change nothing. Fail closed: any session or storage error answers false, so a
// broken store can never switch Community on.
const auth = require("./lib/auth-session");
const gate = require("./lib/feature-gate");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function reply(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

exports.setStore = gate.setStore;

exports.handler = async (event) => {
  const result = Object.fromEntries(gate.FEATURES.map((f) => [f, false]));
  try {
    const session = auth.sessionFrom(event);
    if (await require("./lib/beta-access").betaMember(gate.storeFor(event), session)) {
      for (const f of gate.FEATURES) result[f] = true;
    }
  } catch {}
  return reply(200, result);
};
