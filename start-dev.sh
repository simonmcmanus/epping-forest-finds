#!/usr/bin/env zsh
set -euo pipefail

cd "$(dirname "$0")"

server_pid=""

cleanup() {
  if [[ -n "${server_pid}" ]]; then
    kill "${server_pid}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8080 already in use; reusing existing server."
else
  echo "Starting local app server on http://localhost:8080 ..."
  node server.js &
  server_pid="$!"
  sleep 1
fi

echo "Starting Cloudflare tunnel..."
cloudflared tunnel --url http://localhost:8080 --logfile .cloudflared-tunnel.log
