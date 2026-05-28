#!/usr/bin/env bash
# macOS user notifications via osascript.
# Sourced by bin/autobot.

set -euo pipefail

# Show a banner. Args: <title> <message> [sound-name]
# Sound names: Glass, Ping, Pop, Hero, Funk, Submarine, etc.
notify() {
  local title="$1" message="$2" sound="${3:-Glass}"
  # Escape double quotes inside title/message for AppleScript.
  local esc_title esc_msg
  esc_title=$(printf '%s' "$title" | sed 's/"/\\"/g')
  esc_msg=$(printf '%s' "$message" | sed 's/"/\\"/g')
  osascript -e "display notification \"$esc_msg\" with title \"$esc_title\" sound name \"$sound\"" \
    >/dev/null 2>&1 || true
}

# Open a file/URL in its default handler.
notify_open() {
  local target="$1"
  if [ -e "$target" ] || [[ "$target" =~ ^https?:// ]]; then
    open "$target" >/dev/null 2>&1 || true
  fi
}
