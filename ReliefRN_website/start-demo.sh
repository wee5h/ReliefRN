#!/usr/bin/env bash
# ReliefRN website + live Foundry agents: one-command local demo (macOS / Linux).
#
#   ./start-demo.sh            live Foundry agents
#   ./start-demo.sh --check    sign in and test each agent once, then exit
#   ./start-demo.sh --mock     fake agent replies (no Azure), to try the UI
#
# Needs Python 3.10+ and Node.js 22.13+. See RUN-LOCALLY.md.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
BRIDGE="$ROOT/agent-bridge"
VENV_PY="$BRIDGE/.venv/bin/python"
HEALTH="http://127.0.0.1:8765/health"
MODE=live
for a in "$@"; do
  case "$a" in
    --mock) MODE=mock ;;
    --check) MODE=check ;;
    *) echo "Unknown option $a"; exit 2 ;;
  esac
done

step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1"; exit 1; }
health() { curl -fsS --max-time 3 "$HEALTH" 2>/dev/null || true; }

step "1/4  Python"
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'; then PY="$c"; break; fi
done
[ -n "$PY" ] || fail "Python 3.10 or newer is required: https://www.python.org/downloads/"
[ -x "$VENV_PY" ] || { echo "Creating agent-bridge/.venv ..."; "$PY" -m venv "$BRIDGE/.venv"; }
HASH="$("$VENV_PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$BRIDGE/requirements.txt")"
MARK="$BRIDGE/.venv/.requirements.sha256"
if [ ! -f "$MARK" ] || [ "$(cat "$MARK")" != "$HASH" ]; then
  echo "Installing the Azure SDK for the agent bridge ..."
  "$VENV_PY" -m pip install --quiet --disable-pip-version-check -r "$BRIDGE/requirements.txt" || fail "pip install failed."
  echo "$HASH" > "$MARK"
fi
echo "Python OK ($("$VENV_PY" --version))"

if [ "$MODE" = check ]; then
  step "Checking the live agents (sign-in, then one test message to each)"
  cd "$BRIDGE" && exec "$VENV_PY" bridge.py --check
fi

step "2/4  Node.js"
command -v node >/dev/null 2>&1 || fail "Node.js 22.13 or newer is required: https://nodejs.org"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || fail "Node.js $(node --version) is too old. Install 22.13 or newer."
if command -v pnpm >/dev/null 2>&1 && pnpm --version | grep -q '^11\.'; then PNPM=(pnpm); else PNPM=(npx --yes pnpm@11.25.0); fi
if [ ! -f "$ROOT/node_modules/vinext/dist/cli.js" ]; then
  echo "Installing the ReliefRN website dependencies (first run only, about a minute) ..."
  "${PNPM[@]}" install --frozen-lockfile || fail "pnpm install failed."
fi
echo "Node OK ($(node --version))"

step "3/4  Agent bridge (connects the ReliefRN website to the Foundry agents)"
BRIDGE_PID=""
cleanup() { [ -n "$BRIDGE_PID" ] && kill "$BRIDGE_PID" 2>/dev/null && echo "Agent bridge stopped."; }
trap cleanup EXIT INT TERM
H="$(health)"
if [ -n "$H" ]; then
  echo "An agent bridge is already running. Reusing it."
else
  FLAG=""; [ "$MODE" = mock ] && FLAG="--mock"
  ( cd "$BRIDGE" && exec "$VENV_PY" bridge.py $FLAG ) > "$BRIDGE/bridge.log" 2>&1 &
  BRIDGE_PID=$!
  echo "Started (log: agent-bridge/bridge.log). If a Microsoft sign-in page opens, sign in there."
  echo "Waiting for sign-in to finish (up to 3 minutes) ..."
  for _ in $(seq 180); do sleep 1; H="$(health)"; [ -n "$H" ] && break; kill -0 "$BRIDGE_PID" 2>/dev/null || break; done
fi
if [ -z "$H" ]; then
  echo "The bridge did not start. See agent-bridge/bridge.log:"; tail -n 20 "$BRIDGE/bridge.log" || true
elif echo "$H" | grep -q '"ok": true'; then
  echo "$H" | grep -q '"mode": "mock"' && echo "MOCK agents (fake replies) ready." || echo "Live Foundry agents ready."
else
  echo "Not signed in to Azure. The ReliefRN website will run in guided mode. See RUN-LOCALLY.md, 'Sign-in'."
fi

step "4/4  ReliefRN website"
echo "Open http://localhost:5173 once it says Local. Press Ctrl+C to stop everything."
# The local Cloudflare runtime sometimes dies while starting, with
# "Error: internal error; reference = ..." (a transient error inside the
# Cloudflare Vite plugin). The next start almost always works, so retry.
attempt=1
while :; do
  started=$(date +%s)
  node scripts/run-framework.mjs dev || true
  [ $(( $(date +%s) - started )) -gt 90 ] && break  # it ran, then was stopped
  [ "$attempt" -ge 6 ] && break
  attempt=$((attempt + 1))
  printf '\n\033[33mThe website stopped while starting (a known, temporary local-runtime error). Retrying (%s/6) ...\033[0m\n' "$attempt"
  sleep 2
done
