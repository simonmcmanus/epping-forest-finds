#!/usr/bin/env bash
# Bootstrap for a fresh Claude Code (web/remote) session.
#
# Registered as a SessionStart hook in .claude/settings.json. Safe to run by hand.
# Everything here is idempotent and must stay quiet on the happy path -- the output
# is prepended to the session, so noise here is noise in every conversation.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0

[ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1

# The remote image ships a Chromium that may not match the build @playwright/test
# pins, which fails every e2e spec with "Executable doesn't exist". Point Playwright
# at the one that is actually installed. Screenshot diffs under a mismatched build
# are environmental -- never regenerate the committed snapshots from them
# (see "BDD browser tests" in spec/agents.md).
if [ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ]; then
  for candidate in /opt/pw-browsers/chromium-*/chrome-linux/chrome; do
    [ -x "$candidate" ] && echo "PLAYWRIGHT_CHROMIUM_EXECUTABLE=$candidate" && break
  done
fi
