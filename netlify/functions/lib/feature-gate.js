// Feature gate helpers. Community is on for everyone, so there is no allow list any more; what remains is the
// shared community store handle (beta codes, beta redeem, track and features all read the same store) and the
// list of gated features that beta access grants.
const { openStore } = require("./community-store");

const FEATURES = ["community"];

// Tests hand in a store of their own so nothing touches disk or Blobs.
let storeOverride = null;
function setStore(store) { storeOverride = store; }
function storeFor(event) { return storeOverride || openStore(event); }

module.exports = { storeFor, setStore, FEATURES };
