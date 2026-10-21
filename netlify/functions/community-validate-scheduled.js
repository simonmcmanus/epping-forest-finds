// Daily: the same reward check as community-validate.js, with no caller to authenticate.
// Schedule is declared in netlify.toml ([functions."community-validate-scheduled"]).
const { openStore } = require("./lib/community-store");
const { runValidation } = require("./lib/community-validation");
const { makeFetchJson, makeGithub } = require("./lib/community-fetch");

exports.handler = async (event) => {
  const summary = await runValidation({ store: openStore(event), fetchJson: makeFetchJson(event), github: makeGithub() });
  console.log("community-validate", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};
