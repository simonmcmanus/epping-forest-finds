#!/usr/bin/env bash
# Publishes the failing visual snapshots of one PR to the `visual-diffs` branch and writes a
# table into a marked section of the PR description. The table links each snapshot's committed
# baseline, this run's actual render and the diff. Runs in the trusted workflow_run publisher after
# every PR visual job, so a green run clears the table and removes the PR's images.
#
# Needs in the environment: PR_NUMBER, HEAD_SHA (the PR head, where the baselines live),
# HEAD_REPOSITORY (the repository containing that head, which may be a fork), and PAT
# (WEEKLY_LEDGER_PAT: a user push, so nothing here relies on GITHUB_TOKEN's no-event rule).
# Writes the section to $RUNNER_TEMP/visual-section.md for the PR-body step to read.
set -euo pipefail

work=$(mktemp -d)
section="$RUNNER_TEMP/visual-section.md"
remote="https://github.com/$GITHUB_REPOSITORY.git"
raw="https://raw.githubusercontent.com/$GITHUB_REPOSITORY"
raw_head="https://raw.githubusercontent.com/${HEAD_REPOSITORY:-$GITHUB_REPOSITORY}"

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

# One entry per snapshot and project. A retried test leaves a second folder with the same
# snapshot, so the first one found wins.
declare -A seen
while IFS= read -r actual; do
  stem=$(basename "$actual" -actual.png)
  project=$(basename "$(dirname "$actual")" | grep -oE 'desktop|mobile' | tail -n 1 || true)
  key="${project:-unknown}-$stem"
  [[ -n "${seen[$key]:-}" ]] && continue
  seen[$key]=1
  cp "$actual" "$dest/$key-actual.png"
  diff_file="${actual%-actual.png}-diff.png"
  [[ -f "$diff_file" ]] && cp "$diff_file" "$dest/$key-diff.png"
done < <(find test-results -name '*-actual.png' 2>/dev/null | sort)

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

rows=$(
  shopt -s nullglob
  vd=$(git -C "$work/w" rev-parse HEAD 2>/dev/null || true)
  for actual in "$dest"/*-actual.png; do
    key=$(basename "$actual" -actual.png)
    project=${key%%-*}
    stem=${key#*-}
    baseline="test/e2e/__screenshots__/$stem-$project-linux.png"
    if [[ -f "$baseline" ]]; then before="![baseline]($raw_head/$HEAD_SHA/$baseline)"; else before="_new_"; fi
    if [[ -f "$dest/$key-diff.png" ]]; then diff="![diff]($raw/$vd/pr-$PR_NUMBER/$key-diff.png)"; else diff="_none_"; fi
    echo "| \`$stem\` | $project | $before | ![actual]($raw/$vd/pr-$PR_NUMBER/$key-actual.png) | $diff |"
  done
)

# An empty section removes the table from the PR description.
if [[ -n "$rows" ]]; then
  {
    echo "### Failing visual snapshots"
    echo
    echo "Baseline is the committed image, Actual is this run's render, Diff highlights the changed pixels. Cleared on the next green run."
    echo
    echo "| Snapshot | Project | Baseline | Actual | Diff |"
    echo "| --- | --- | --- | --- | --- |"
    echo "$rows"
  } > "$section"
else
  : > "$section"
fi
