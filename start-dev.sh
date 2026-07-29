#!/usr/bin/env zsh
set -euo pipefail

cd "$(dirname "$0")"

server_pid=""
tunnel_pid=""

cleanup() {
  [[ -n "${tunnel_pid}" ]] && kill "${tunnel_pid}" >/dev/null 2>&1 || true
  [[ -n "${server_pid}" ]] && kill "${server_pid}" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

if ! lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  node server.js >/dev/null 2>&1 &
  server_pid="$!"
  sleep 1
fi

: > .cloudflared-tunnel.log
cloudflared tunnel --url http://localhost:8080 --logfile .cloudflared-tunnel.log >/dev/null 2>&1 &
tunnel_pid="$!"

while kill -0 "${tunnel_pid}" 2>/dev/null; do
  url=$(grep -o 'https://[^ ]*\.trycloudflare\.com' .cloudflared-tunnel.log 2>/dev/null | head -1) || true
  if [[ -n "$url" ]]; then
    echo "$url"
    break
  fi
  sleep 0.3
done

wait "${tunnel_pid}"
