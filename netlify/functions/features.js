// GET /api/features   which gated features this person has: { community: boolean }
// Community is on for everyone, so the answer is always community:true. The endpoint stays as a minimal,
// read-only answer (there is no allow list and nothing to write). Beta access is additive: a signed-in beta
// member also gets every feature in FEATURES, and if beta cannot be read the answer is still community:true.
const auth = require("./lib/auth-session");
const gate = require("./lib/feature-gate");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function reply(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

exports.setStore = gate.setStore;

exports.handler = async (event) => {
  const result = { community: true };
  try {
    const session = auth.sessionFrom(event);
    if (session && await require("./lib/beta-access").betaMember(gate.storeFor(event), session)) {
      for (const f of gate.FEATURES) result[f] = true;
    }
  } catch {}
  return reply(200, result);
};
