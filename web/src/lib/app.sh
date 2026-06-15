#!/usr/bin/env bash
# Target-app helpers: detect a dev command, start/stop the dev server, health checks.
# Sourced by bin/webbot.

set -euo pipefail

APP_DEV_PID=""

# Is the app already answering at this URL? (2xx/3xx/4xx all count as "alive" —
# a 404 on / still means the server is up.)
# Args: <url>
app_is_up() {
  local url="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
  [ "$code" != "000" ]
}

# Detect a dev command for a local project dir. Echoes the command, or empty.
# Args: <dir>
app_detect_dev_command() {
  local dir="$1"
  if [ -f "$dir/package.json" ]; then
    local script
    script=$(/usr/bin/python3 -c "
import json, sys
try:
    scripts = json.load(open(sys.argv[1])).get('scripts', {})
    for name in ('dev', 'start', 'serve'):
        if name in scripts:
            print(name); break
except Exception:
    pass
" "$dir/package.json" 2>/dev/null || true)
    if [ -n "$script" ]; then
      echo "npm run $script"
      return 0
    fi
  fi
  if [ -f "$dir/index.html" ]; then
    echo "npx -y serve -l 3000 ."
    return 0
  fi
  echo ""
}

# Start the dev server in the background (if the app isn't already up) and wait for
# it to answer. Logs to <run-dir>/dev-server.log. Sets APP_DEV_PID for app_stop.
# Args: <dev-command> <dev-dir> <app-url> <run-dir>
app_start() {
  local dev_command="$1" dev_dir="$2" app_url="$3" run_dir="$4"

  if app_is_up "$app_url"; then
    echo ">> App already running at $app_url — reusing it." >&2
    return 0
  fi
  if [ -z "$dev_command" ]; then
    echo "ERR: app is not reachable at $app_url and no dev command is configured." >&2
    echo "     Start the app yourself, or set dev_command in .webbot/config.json." >&2
    exit 1
  fi

  echo ">> Starting app: ($dev_dir) $dev_command" >&2
  mkdir -p "$run_dir"
  (
    cd "$dev_dir"
    # shellcheck disable=SC2086
    exec $dev_command
  ) > "$run_dir/dev-server.log" 2>&1 &
  APP_DEV_PID=$!

  local deadline=$(( $(date +%s) + 120 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if app_is_up "$app_url"; then
      echo ">> App is up at $app_url" >&2
      return 0
    fi
    if ! kill -0 "$APP_DEV_PID" 2>/dev/null; then
      echo "ERR: dev server exited early — see $run_dir/dev-server.log" >&2
      exit 1
    fi
    sleep 2
  done
  echo "ERR: app never became reachable at $app_url after 120s — see $run_dir/dev-server.log" >&2
  app_stop
  exit 1
}

# Stop the dev server we started (no-op if we didn't start one).
app_stop() {
  if [ -n "$APP_DEV_PID" ] && kill -0 "$APP_DEV_PID" 2>/dev/null; then
    # Kill the whole process group if possible — npm spawns children.
    kill "$APP_DEV_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$APP_DEV_PID" 2>/dev/null || true
  fi
  APP_DEV_PID=""
}
