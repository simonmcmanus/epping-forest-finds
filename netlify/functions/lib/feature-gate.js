// Feature gate helpers. There is no allow list: Community is for beta members only, decided per request from
// beta membership. What remains is the shared community store handle (beta codes, redeem, track and features all
// read the same store) and the list of gated features beta access grants.
const { openStore } = require("./community-store");

const FEATURES = ["community"];

// Tests hand in a store of their own so nothing touches disk or Blobs.
let storeOverride = null;
function setStore(store) { storeOverride = store; }
function storeFor(event) { return storeOverride || openStore(event); }

module.exports = { storeFor, setStore, FEATURES };
