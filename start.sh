#!/usr/bin/env bash
# Bring the whole demo up: keep the Mac awake, start the server, and (optionally)
# open a Cloudflare quick tunnel pointed at the player port.
#
#   ./start.sh            # server + tunnel (recommended for a live demo)
#   ./start.sh --no-tunnel  # server only (LAN / localhost)
set -euo pipefail
cd "$(dirname "$0")"

PLAYER_PORT="${PLAYER_PORT:-8000}"
ADMIN_PORT="${ADMIN_PORT:-8766}"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# 1) Server — caffeinate keeps macOS awake so a long demo never drops.
caffeinate -i node server/server.js &

sleep 1
echo ""
echo "  Player : http://localhost:${PLAYER_PORT}   (share the tunnel URL with players)"
echo "  Admin  : http://localhost:${ADMIN_PORT}    (this machine only)"
echo ""

# 2) Tunnel (player port only — admin is never exposed).
if [[ "${1:-}" != "--no-tunnel" ]]; then
  if command -v cloudflared >/dev/null 2>&1; then
    echo "  Starting Cloudflare quick tunnel → port ${PLAYER_PORT} …"
    echo "  (Grab the printed *.trycloudflare.com URL and share it. Keep this window open.)"
    echo ""
    caffeinate -i cloudflared tunnel --url "http://localhost:${PLAYER_PORT}"
  else
    echo "  cloudflared not found — install with: brew install cloudflared"
    wait
  fi
else
  wait
fi
