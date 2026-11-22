#!/usr/bin/env node
"use strict";
// Stamps whether this build is the Netlify production deploy into
// netlify/functions/lib/deploy-context.json (git-ignored build output). The live site does not
// reliably see CONTEXT at function runtime, but the build always does.
const fs = require("fs");
const path = require("path");

const DEFAULT_OUT = path.join(__dirname, "..", "netlify", "functions", "lib", "deploy-context.json");

function deployContextStamp(env = process.env) {
  return { production: env.CONTEXT === "production" };
}

function main(argv, env = process.env) {
  const i = argv.indexOf("--out");
  const out = i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : DEFAULT_OUT;
  const stamp = deployContextStamp(env);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(stamp));
  console.log(`Deploy context: ${env.CONTEXT || "none"} (production=${stamp.production})`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { deployContextStamp };
