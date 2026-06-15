#!/usr/bin/env bash
# macOS notification + report opening. Sourced by bin/webbot.

set -euo pipefail

# Args: <title> <message>
notify_user() {
  local title="$1" message="$2"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null || true
  fi
  echo ">> $title — $message" >&2
}

# Open the report in the default browser if it exists. Args: <report-path>
notify_open_report() {
  local report="$1"
  if [ -f "$report" ]; then
    open "$report" 2>/dev/null || true
  fi
}
