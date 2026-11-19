// Netlify `[build] ignore` command (see netlify.toml).
// Exit 0 skips the build, exit 1 lets it proceed.
//
// Pull request builds always run, draft or not: draft PRs build previews on
// purpose so a change can be tried early. Draft status only holds back the CI
// review jobs (the ci.yml draft gates) and the Claude specialist run, not the
// preview.
//
// Production app/data merges are intentionally skipped here. The matching
// cache-version workflow commits the release marker and then explicitly calls
// Netlify's build hook, so production deploys contain both the feature and its
// cache invalidation without a redundant, earlier Git-triggered build.
if (process.env.CONTEXT === "production") {
  skipProductionCacheMergeBuild();
} else {
  // Pull request builds and other branch deploys always build.
  process.exitCode = 1;
}

function skipProductionCacheMergeBuild() {
  const { execFileSync } = require("node:child_process");
  const ref = process.env.COMMIT_REF;
  if (!ref) {
    console.warn("netlify/ignore-draft-pr.js: missing COMMIT_REF — building production deploy");
    process.exitCode = 1;
    return;
  }

  try {
    // -m compares a merge commit to each parent, so a conventional GitHub
    // merge cannot hide its PR's changed paths from this guard.
    const changed = execFileSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", ref],
      { encoding: "utf8" }
    );
    if (/^(app\.html|manifest\.webmanifest|tree-icon\.svg|css\/|js\/|sw\.js|data\/)/m.test(changed)) {
      console.log("netlify/ignore-draft-pr.js: cache-version workflow will release this production change — skipping Git build");
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
    }
  } catch (err) {
    console.warn(`netlify/ignore-draft-pr.js: ${err.message} — building production deploy`);
    process.exitCode = 1;
  }
}
