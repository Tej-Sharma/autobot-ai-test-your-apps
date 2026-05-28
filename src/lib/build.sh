#!/usr/bin/env bash
# xcodebuild wrapper — produces a simulator .app from an Xcode project/workspace.
# Sourced by bin/autobot.

set -euo pipefail

# Detect what kind of app input the user gave us.
# Echoes one of: xcodeproj | xcworkspace | app | unknown
build_detect_kind() {
  local path="$1"
  case "$path" in
    *.xcodeproj)   echo xcodeproj ;;
    *.xcworkspace) echo xcworkspace ;;
    *.app)         echo app ;;
    *)             echo unknown ;;
  esac
}

# Pick a scheme automatically from a project/workspace.
# Override with $AUTOBOT_SCHEME.
build_resolve_scheme() {
  local path="$1" kind="$2"
  if [ -n "${AUTOBOT_SCHEME:-}" ]; then
    echo "$AUTOBOT_SCHEME"; return
  fi
  local flag
  case "$kind" in
    xcodeproj)   flag="-project" ;;
    xcworkspace) flag="-workspace" ;;
    *) echo "ERR: cannot resolve scheme for kind=$kind" >&2; exit 1 ;;
  esac
  xcodebuild "$flag" "$path" -list -json \
    | /usr/bin/python3 -c "
import json, sys
data = json.load(sys.stdin)
schemes = (data.get('project') or data.get('workspace') or {}).get('schemes', [])
print(schemes[0] if schemes else '')
"
}

# Build for simulator and echo the path to the resulting .app bundle.
# Args: <path-to-xcodeproj-or-xcworkspace> <scheme> <udid> <derived-data-dir>
build_for_simulator() {
  local path="$1" scheme="$2" udid="$3" derived="$4"
  local kind flag
  kind=$(build_detect_kind "$path")
  case "$kind" in
    xcodeproj)   flag="-project" ;;
    xcworkspace) flag="-workspace" ;;
    *) echo "ERR: build_for_simulator: unsupported kind $kind" >&2; exit 1 ;;
  esac

  mkdir -p "$derived"
  xcodebuild \
    "$flag" "$path" \
    -scheme "$scheme" \
    -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$derived" \
    -quiet \
    build

  # Find the most recent .app under Build/Products/Debug-iphonesimulator/
  local app
  app=$(find "$derived/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name "*.app" -type d \
    | head -n 1)
  if [ -z "$app" ]; then
    echo "ERR: build succeeded but no .app produced under $derived" >&2
    exit 1
  fi
  echo "$app"
}
