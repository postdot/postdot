#!/usr/bin/env bash
# Isolated reproduction of the dev-server SSE behaviour.
#
# Starts one API runtime and one Vite dev server on free loopback ports, signs
# up an isolated account, creates a project, and then reads the same event
# stream twice: directly against the API, and through the Vite proxy. Each read
# is timestamped so a heartbeat that never crosses the proxy is distinguishable
# from a stream that closes early.
#
# This script only observes two paths to one endpoint. It changes no transport
# code and no product behaviour, and it touches no shared path: the data
# directory, ports, and database live under this run only.
#
# Usage: scripts/sse-proxy-repro.sh [stage] [seconds]
#   stage: chunks (default, timestamped arrivals), late-event (does a real event
#          still cross the connection after it went quiet?), or user-stream (does
#          the notification stream open with nothing pending?)
set -uo pipefail

cd "$(dirname "$0")/.."

STAGE=${1:-chunks}
HOLD_SECONDS=${2:-40}
DATA_DIR=$(mktemp -d /tmp/postbot-sse-repro-XXXXXX)

free_port() {
  python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'
}
API_PORT=$(free_port)
WEB_PORT=$(free_port)
API_ORIGIN="http://127.0.0.1:${API_PORT}"
WEB_ORIGIN="http://127.0.0.1:${WEB_PORT}"

cleanup() {
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

# Secrets match the lengths the API environment schema requires.
POSTBOT_E2E_DATA_DIRECTORY="$DATA_DIR" \
DB_FILE_NAME="$DATA_DIR/postbot.sqlite" \
POSTBOT_MIGRATIONS_DIR="$PWD/packages/db/drizzle" \
NODE_ENV=test PORT="$API_PORT" \
POSTBOT_MEDIA_STORE=local POSTBOT_MEDIA_DIRECTORY="$DATA_DIR/media" \
POSTBOT_MEDIA_STORE_ID=sse-repro \
POSTBOT_MEDIA_PUBLIC_URL_SECRET=postbot-sse-repro-media-secret-value-long \
POSTBOT_PUBLISHER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
POSTBOT_PUBLISHER_ENCRYPTION_KEY_ID=sse-repro-v1 \
BETTER_AUTH_URL="$API_ORIGIN" \
BETTER_AUTH_SECRET=postbot-sse-repro-auth-secret-value-long-enough \
POSTBOT_WEB_ORIGIN="$WEB_ORIGIN" \
POSTBOT_E2E_ALLOW_ADDITIONAL_SIGNUPS=true LOG_LEVEL=warn \
  bun ./apps/api/src/index.ts >"$DATA_DIR/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 120); do curl -fsS "$API_ORIGIN/ready" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "$API_ORIGIN/ready" >/dev/null || {
  echo "api never became ready"
  tail -25 "$DATA_DIR/api.log"
  exit 1
}
echo "api ready on $API_ORIGIN"

POSTBOT_API_ORIGIN="$API_ORIGIN" NODE_ENV=test \
  bun run --cwd apps/web dev -- --host 127.0.0.1 --port "$WEB_PORT" >"$DATA_DIR/web.log" 2>&1 &
WEB_PID=$!
for _ in $(seq 1 240); do curl -fsS "$WEB_ORIGIN/" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "$WEB_ORIGIN/" >/dev/null || {
  echo "vite never became ready"
  tail -25 "$DATA_DIR/web.log"
  exit 1
}
echo "vite ready on $WEB_ORIGIN"

SUFFIX=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
curl -sS -c "$DATA_DIR/cookies" -H 'content-type: application/json' \
  -d "{\"email\":\"sse-${SUFFIX}@example.invalid\",\"password\":\"sse-repro-password-1234\",\"name\":\"SSE Repro\"}" \
  "$API_ORIGIN/api/auth/sign-up/email" -o "$DATA_DIR/signup.json" -w 'sign-up http %{http_code}\n'
curl -sS -b "$DATA_DIR/cookies" -c "$DATA_DIR/cookies" -H 'content-type: application/json' \
  -d "{\"name\":\"SSE Repro ${SUFFIX}\"}" "$API_ORIGIN/api/projects" -o "$DATA_DIR/project.json" \
  -w 'project http %{http_code}\n'
PROJECT_ID=$(python3 -c "import json;print(json.load(open('$DATA_DIR/project.json')).get('project',{}).get('id',''))")
COOKIE=$(python3 - "$DATA_DIR/cookies" <<'PY'
import sys
from http.cookiejar import MozillaCookieJar
jar = MozillaCookieJar(sys.argv[1])
jar.load(ignore_discard=True, ignore_expires=True)
print("; ".join(f"{c.name}={c.value}" for c in jar))
PY
)

if [[ -z "$PROJECT_ID" || -z "$COOKIE" ]]; then
  echo "setup incomplete: project='${PROJECT_ID}' cookie='${COOKIE}'"
  echo "sign-up body:"; cat "$DATA_DIR/signup.json" 2>/dev/null; echo
  echo "project body:"; cat "$DATA_DIR/project.json" 2>/dev/null; echo
  exit 1
fi

echo "project $PROJECT_ID"
echo "the API heartbeat interval is 15s, so a healthy stream emits ': heartbeat' about every 15s"
echo

case "$STAGE" in
  chunks)
    bun scripts/sse-proxy-chunks.ts "$API_ORIGIN" "$WEB_ORIGIN" "$PROJECT_ID" "$COOKIE" "$HOLD_SECONDS"
    ;;
  late-event)
    bun scripts/sse-proxy-late-event.ts "$API_ORIGIN" "$WEB_ORIGIN" "$PROJECT_ID" "$COOKIE" "$HOLD_SECONDS"
    ;;
  user-stream)
    bun scripts/sse-user-stream-open.ts "$API_ORIGIN" "$WEB_ORIGIN" "$COOKIE"
    ;;
  *)
    echo "unknown stage: $STAGE (expected 'chunks' or 'late-event')"
    exit 2
    ;;
esac

echo
echo "== vite log (proxy-relevant lines) =="
grep -iE "proxy|socket|hang up|aborted|reset|502" "$DATA_DIR/web.log" | tail -10 | sed 's/^/   /'
echo "== api log (stream-relevant lines) =="
grep -iE "events|stream|abort|error" "$DATA_DIR/api.log" | tail -10 | sed 's/^/   /'