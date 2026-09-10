#!/usr/bin/env bash
# API-269 report-download memory benchmark.
# Usage: run.sh [instances] [days] [mem_mb]   (defaults: 2000 365 256)

set -uo pipefail

INSTANCES="${1:-2000}"
DAYS="${2:-365}"
MEM_MB="${3:-256}"
PORT="${PORT:-3999}"

HERE="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$(cd "$HERE/../.." && pwd)/apps/api"
APP_JS="$API_DIR/dist/app.js"
FASTIFY_CLI="$(cd "$API_DIR" && node -e 'process.stdout.write(require.resolve("fastify-cli/cli.js"))' 2>/dev/null)"

TMP="$(mktemp -d -t airgap-bench)"
DB_PATH="$TMP/database.sqlite"
REPORT="$TMP/report.json"
LOG="$TMP/server.log"
BASE_URL="http://127.0.0.1:$PORT"

export N8N_MONITORING_WRITE_TOKEN="bench-write-token"
export N8N_MONITORING_READ_TOKEN="bench-read-token"
export N8N_DB_PATH="$DB_PATH"

SERVER_PID=""
cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
die() { echo "ERROR: $*" >&2; exit 1; }

start_server() {
  : > "$LOG"
  local args=()
  [ -n "${1:-}" ] && args+=("--max-old-space-size=$1")
  ( cd "$API_DIR" && exec node ${args[@]+"${args[@]}"} "$FASTIFY_CLI" start -l warn -a 127.0.0.1 -p "$PORT" "$APP_JS" ) \
    >>"$LOG" 2>&1 &
  SERVER_PID=$!
}
wait_health() {
  for _ in $(seq 1 120); do
    curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1 && return 0
    kill -0 "$SERVER_PID" 2>/dev/null || return 1
    sleep 0.5
  done
  return 1
}
stop_server() { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""; }

command -v python3 >/dev/null || die "python3 required"

echo "==> building api…"
( cd "$API_DIR" && pnpm build ) >"$TMP/build.log" 2>&1 || { cat "$TMP/build.log" >&2; die "build failed"; }

start_server ""
wait_health || { cat "$LOG" >&2; die "server did not boot for migration"; }
stop_server

echo "==> seeding $INSTANCES instances × $DAYS days → $DB_PATH"
python3 "$HERE/seed.py" "$DB_PATH" "$INSTANCES" "$DAYS" || die "seeding failed"

echo "==> downloading report (heap cap ${MEM_MB} MB)…"
start_server "$MEM_MB"
wait_health || { cat "$LOG" >&2; die "server did not boot under the cap"; }

peak_kb=0
( while kill -0 "$SERVER_PID" 2>/dev/null; do
    cur=$(ps -o rss= -p "$SERVER_PID" 2>/dev/null | tr -d ' ')
    [ -n "$cur" ] && [ "$cur" -gt "$peak_kb" ] && peak_kb=$cur && echo "$peak_kb" > "$TMP/peak"
    sleep 0.2
  done ) &
sampler=$!

started=$(date +%s)
http=$(curl -sS -o "$REPORT" -w '%{http_code}' -H "Authorization: Bearer $N8N_MONITORING_READ_TOKEN" "$BASE_URL/api/v1/report")
curl_rc=$?
elapsed=$(( $(date +%s) - started ))

kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null
peak_mb=$(( ($(cat "$TMP/peak" 2>/dev/null || echo 0)) / 1024 ))

alive=1; kill -0 "$SERVER_PID" 2>/dev/null || alive=0
oom=0; grep -qiE "out of memory|heap limit|Allocation failed" "$LOG" && oom=1
bytes=$( [ -f "$REPORT" ] && wc -c < "$REPORT" | tr -d ' ' || echo 0 )
report_mb=$(( bytes / 1024 / 1024 ))

echo
echo "  instances × days : ${INSTANCES} × ${DAYS}"
echo "  heap cap         : ${MEM_MB} MB"
echo "  peak RSS         : ${peak_mb} MB"
echo "  downloaded       : ${report_mb} MB in ${elapsed}s"
if [ "$oom" = "1" ]; then
  echo "  RESULT: ✗ OOM CRASH"
  grep -iE "out of memory|heap limit|Allocation failed" "$LOG" | tail -1 | sed 's/^/    /'
  stop_server; exit 1
elif [ "$alive" = "0" ]; then
  echo "  RESULT: ✗ SERVER CRASH (non-OOM)"
  tail -3 "$LOG" | sed 's/^/    /'
  stop_server; exit 1
elif [ "$http" = "200" ] && [ "$curl_rc" = "0" ] && [ "$bytes" -gt 0 ] && tail -c 4 "$REPORT" | grep -q "]}}"; then
  echo "  RESULT: ✓ OK"
  stop_server; exit 0
else
  echo "  RESULT: ? inconclusive (http=$http rc=$curl_rc)"
  stop_server; exit 2
fi
