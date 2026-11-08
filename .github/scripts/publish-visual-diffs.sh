#!/usr/bin/env bash
# Publishes the failing visual snapshots of one PR to the `visual-diffs` branch and writes a
# table into a marked section of the PR description. The table links each snapshot's committed
# baseline, this run's actual render and the diff. Runs in the trusted workflow_run publisher after
# every PR visual job. Each report identifies its revision and includes capture failures.
#
# Needs in the environment: PR_NUMBER, HEAD_SHA (the PR head, where the baselines live),
# HEAD_REPOSITORY (the repository containing that head, which may be a fork), and PAT
# (WEEKLY_LEDGER_PAT: a user push, so nothing here relies on GITHUB_TOKEN's no-event rule).
# Writes the section to $RUNNER_TEMP/visual-section.md for the PR-body step to read.
set -euo pipefail

work=$(mktemp -d)
section="$RUNNER_TEMP/visual-section.md"
remote="https://github.com/$GITHUB_REPOSITORY.git"

if git ls-remote --exit-code --heads "$remote" visual-diffs > /dev/null 2>&1; then
  git clone --quiet --depth 1 --branch visual-diffs "$remote" "$work/w"
else
  git init --quiet "$work/w"
  git -C "$work/w" checkout --quiet --orphan visual-diffs
fi
git -C "$work/w" remote remove origin 2>/dev/null || true
git -C "$work/w" remote add origin "https://x-access-token:$PAT@github.com/$GITHUB_REPOSITORY.git"

dest="$work/w/pr-$PR_NUMBER"
rm -rf "$dest"
mkdir -p "$dest"
touch "$dest/.gitkeep"

# Render only the final-attempt evidence recorded by CI. Missing manifests produce an
# explicit unavailable status instead of retaining an older run's screenshots.
export VISUAL_DEST="$dest"
node "$RUNNER_TEMP/render-visual-section.cjs"

git -C "$work/w" add -A "pr-$PR_NUMBER"
if git -C "$work/w" diff --cached --quiet; then
  echo "No visual diff changes to publish"
else
  git -C "$work/w" \
    -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit --quiet -m "chore: visual diffs for PR #$PR_NUMBER"
  pushed=""
  for attempt in 1 2 3; do
    if git -C "$work/w" push --quiet origin HEAD:visual-diffs; then
      pushed=1
      break
    fi
    git -C "$work/w" pull --rebase --quiet origin visual-diffs
  done
  [[ -n "$pushed" ]] || { echo "Could not push visual diffs"; exit 1; }
fi

vd=$(git -C "$work/w" rev-parse HEAD)
sed -i "s/__VISUAL_SHA__/$vd/g" "$section"
