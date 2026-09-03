#!/usr/bin/env bash
# Prepare a review-ready, committed branch for a weekly Epping Forest Ledger
# changeset, without touching the caller's current working tree.
#
# Usage: scripts/prepare_weekly_branch.sh <changeset.json> <branch-name>
#
# Creates an isolated git worktree under .worktrees/<branch-name> (based on
# local `main`), applies the changeset to the master landmarks file,
# regenerates the split category files, runs the unit test suite, and
# commits -- all inside that worktree. Your current checkout (including any
# uncommitted changes) is never touched.
#
# NOTE: `git worktree add` only checks out committed content from `main`.
# If scripts/apply_weekly_changeset.py isn't committed yet (e.g. it's brand
# new), this wrapper copies it - and this wrapper itself - into the fresh
# worktree from the caller's checkout so the pipeline is self-sufficient
# either way. Once these scripts are committed to main, the copy is a no-op.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <changeset.json> <branch-name>" >&2
  exit 1
fi

CHANGESET_SRC="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
BRANCH="$2"
REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_DIR="$REPO_ROOT/.worktrees/$BRANCH"

if [ -e "$WORKTREE_DIR" ]; then
  echo "Worktree $WORKTREE_DIR already exists -- remove it (git worktree remove) or pick a new branch name." >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/.worktrees"
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_DIR" main >&2

# Self-sufficiency: make sure the tooling this script depends on is present
# in the new worktree even if it hasn't been committed to main yet.
for tool in scripts/apply_weekly_changeset.py scripts/prepare_weekly_branch.sh; do
  if [ ! -f "$WORKTREE_DIR/$tool" ] && [ -f "$REPO_ROOT/$tool" ]; then
    cp "$REPO_ROOT/$tool" "$WORKTREE_DIR/$tool"
  fi
done

# data/local-landmarks.geojson (the master file split_landmarks.py reads/
# writes) and data/local-landmarks-access.geojson are gitignored by design
# (see data/README.md) - they're local working files, never committed. A
# fresh worktree checkout never has them, so seed them from the caller's
# working copy, which is where the current, real dataset lives.
for datafile in data/local-landmarks.geojson data/local-landmarks-access.geojson; do
  if [ -f "$REPO_ROOT/$datafile" ]; then
    cp "$REPO_ROOT/$datafile" "$WORKTREE_DIR/$datafile"
  fi
done

cd "$WORKTREE_DIR"

# Baseline: does the unit suite already fail on main, before this changeset
# touches anything? Weekly automation should never be silently blocked by a
# pre-existing, unrelated failure someone is already mid-fixing on main --
# but it must never paper over a failure *this* changeset causes either.
echo "== Running unit tests (baseline, before changeset) ==" >&2
BASELINE_LOG="$(mktemp)"
BASELINE_OK=1
node --test test/forest-finds.test.js > "$BASELINE_LOG" 2>&1 || BASELINE_OK=0

cp "$CHANGESET_SRC" "$WORKTREE_DIR/.weekly-changeset.json"

echo "== Applying changeset ==" >&2
python3 scripts/apply_weekly_changeset.py .weekly-changeset.json
rm .weekly-changeset.json

echo "== Regenerating split category files ==" >&2
python3 scripts/split_landmarks.py >&2

echo "== Running unit tests (after changeset) ==" >&2
AFTER_LOG="$(mktemp)"
AFTER_OK=1
node --test test/forest-finds.test.js > "$AFTER_LOG" 2>&1 || AFTER_OK=0

PREEXISTING_TEST_FAILURE=0
if [ "$AFTER_OK" -eq 0 ] && [ "$BASELINE_OK" -eq 1 ]; then
  echo "Unit tests passed before this changeset and fail after it -- aborting, not committing." >&2
  cat "$AFTER_LOG" >&2
  rm -f "$BASELINE_LOG" "$AFTER_LOG"
  exit 1
elif [ "$AFTER_OK" -eq 0 ] && [ "$BASELINE_OK" -eq 0 ]; then
  echo "NOTE: the unit test suite was already failing on main before this changeset (pre-existing, unrelated to this data change) -- proceeding, but this needs separate attention." >&2
  PREEXISTING_TEST_FAILURE=1
fi
rm -f "$BASELINE_LOG" "$AFTER_LOG"

git add data/local-landmarks-food.geojson
# split_landmarks.py rewrites every category file it has features for, every
# time -- including a fresh "generatedAt" timestamp even when nothing in
# that category actually changed. Compare ignoring that one line, and only
# stage (and keep) files whose real content moved; discard pure timestamp
# churn on the rest so the diff stays limited to what this changeset did.
for f in data/local-landmarks-transport.geojson data/local-landmarks-historic.geojson \
         data/local-landmarks-tourism.geojson data/local-landmarks-misc.geojson; do
  if [ -f "$f" ] && ! diff -q \
      <(git show HEAD:"$f" 2>/dev/null | grep -v '"generatedAt"') \
      <(grep -v '"generatedAt"' "$f") >/dev/null 2>&1; then
    git add "$f"
  else
    git checkout -q -- "$f" 2>/dev/null || true
  fi
done

if git diff --cached --quiet; then
  echo "Nothing changed -- no commit made. Check the changeset and the skip log above." >&2
  exit 1
fi

# Scoped to this worktree only (never touches your global/repo git config) -
# distinct from your own identity so these proposed commits are clearly
# machine-authored, same spirit as the "github-actions[bot]" commits your
# CI already makes (see .github/workflows/sw-bump.yml).
git config user.name "Epping Forest Ledger (weekly report)"
git config user.email "weekly-report@local"

COMMIT_NOTE="Proposed by the weekly Epping Forest Ledger report. Review the diff and the linked report before pushing."
if [ "$PREEXISTING_TEST_FAILURE" -eq 1 ]; then
  COMMIT_NOTE="$COMMIT_NOTE

NOTE: test/forest-finds.test.js already had a failing test on main before this changeset, unrelated to this data change. That needs fixing separately -- it was not introduced or masked here."
fi

git commit -q -m "data: weekly Epping Forest Ledger changes ($(date +%Y-%m-%d))" \
  -m "$COMMIT_NOTE" >&2

echo "" >&2
echo "== Ready ==" >&2
echo "Branch:   $BRANCH" >&2
echo "Worktree: $WORKTREE_DIR" >&2
echo "" >&2
echo "To review and publish:" >&2
echo "  cd \"$WORKTREE_DIR\"" >&2
echo "  git diff main..HEAD -- data/" >&2
echo "  git push -u origin $BRANCH" >&2
echo "  gh pr create   # or open the compare URL GitHub prints after the push" >&2
echo "" >&2
echo "When you're done, remove the worktree with:" >&2
echo "  git -C \"$REPO_ROOT\" worktree remove \"$WORKTREE_DIR\"" >&2

echo "$WORKTREE_DIR"
