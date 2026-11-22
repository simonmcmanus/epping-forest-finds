"use strict";
// Production recognition for Community records and report photos. Netlify's runtime CONTEXT is not
// reliable on the live site, so `npm run build` stamps a flag (scripts/generate-deploy-context.js)
// that esbuild inlines into the function bundle. A missing file (local dev, tests, CI) means no stamp.

let stamp = null;
try {
  stamp = require("./deploy-context.json");
} catch (error) {
  stamp = null;
}

// The stamp only applies to the real process environment. An explicit env object (the reset script,
// tests) is judged on its own CONTEXT, so a preview scope can never become production.
function isProductionDeploy(env = process.env) {
  if (env.CONTEXT === "production") return true;
  return env === process.env && Boolean(stamp && stamp.production === true);
}

// Test seam: set or clear (null) the stamp.
function setDeployStamp(value) {
  stamp = value || null;
}

module.exports = { isProductionDeploy, setDeployStamp };
