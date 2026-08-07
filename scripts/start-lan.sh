#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_pid=""
frontend_pid=""

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || ((node_major < 20)); then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    set +u
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
    nvm use 20 >/dev/null
    set -u
  fi
fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || ((node_major < 20)); then
  printf 'Node.js 20 or newer is required. Install it with: nvm install 20\n' >&2
  exit 1
fi
node_binary="$(command -v node)"

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$frontend_pid" ]]; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  if [[ -n "$backend_pid" ]]; then
    pkill -TERM -P "$backend_pid" 2>/dev/null || true
    kill "$backend_pid" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for port in 8000 5173; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    printf 'Port %s is already in use. Stop the existing service first.\n' "$port" >&2
    exit 1
  fi
done

interface="$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
lan_ip=""
if [[ -n "$interface" ]]; then
  lan_ip="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
fi

if [[ -n "$lan_ip" ]]; then
  printf 'LAN URL: http://%s:5173/\n' "$lan_ip"
else
  printf 'LAN URL: use this Mac local IP on port 5173\n'
fi
printf 'Press Ctrl-C to stop both services.\n'

(
  cd "$project_root/backend"
  exec "$project_root/.venv/bin/python" manage.py runserver 0.0.0.0:8000
) &
backend_pid=$!

(
  cd "$project_root/frontend"
  exec "$node_binary" ./node_modules/vite/bin/vite.js
) &
frontend_pid=$!

wait "$frontend_pid"
