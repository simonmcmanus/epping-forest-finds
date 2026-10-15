// Netlify `[build] ignore` command (see netlify.toml).
// Exit 0 skips the build, exit 1 lets it proceed.
//
// Production app/data merges are intentionally skipped here. The matching
// cache-version workflow commits the release marker and then explicitly calls
// Netlify's build hook, so production deploys contain both the feature and its
// cache invalidation without a redundant, earlier Git-triggered build.
if (process.env.CONTEXT === "production") {
  skipProductionCacheMergeBuild();
} else if (process.env.PULL_REQUEST !== "true") {
  // Not a PR build (for example, a non-production branch deploy) — always build.
  process.exitCode = 1;
} else {
  // GitHub Copilot's coding agent opens a draft PR the moment it starts an
// issue and only flips it to "ready for review" once it has finished
// pushing real changes. Skipping Deploy Previews while a PR is still draft
// avoids building/publishing a preview from that empty starting commit.
  // No top-level await: this file runs as plain CommonJS under `node
  // netlify/ignore-draft-pr.js`. Node keeps the process alive until the
  // fetch below settles, so it's safe to fire-and-forget here.
  checkPullRequest();
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

async function checkPullRequest() {
  const token = process.env.GITHUB_TOKEN;
  const repoUrl = process.env.REPOSITORY_URL;
  const prNumber = process.env.REVIEW_ID;
  const match = repoUrl && repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);

  if (!token || !match || !prNumber) {
    console.warn(
      "netlify/ignore-draft-pr.js: missing GITHUB_TOKEN, REPOSITORY_URL, or REVIEW_ID — building anyway"
    );
    process.exitCode = 1;
    return;
  }

  const [, owner, repo] = match;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!res.ok) {
      console.warn(
        `netlify/ignore-draft-pr.js: GitHub API returned ${res.status} — building anyway`
      );
      process.exitCode = 1;
      return;
    }

    const pr = await res.json();
    if (pr.draft) {
      console.log(`netlify/ignore-draft-pr.js: PR #${prNumber} is a draft — skipping build`);
      process.exitCode = 0;
    } else {
      console.log(`netlify/ignore-draft-pr.js: PR #${prNumber} is ready for review — building`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.warn(`netlify/ignore-draft-pr.js: ${err.message} — building anyway`);
    process.exitCode = 1;
  }
}
