#!/usr/bin/env bash
# Restart WebDriverAgent (+ port-forward) on the real device and wait until it serves.
# Idempotent: no-op if WDA already answers on :8100. Called by the engine when a
# screenshot fails (WDA drops mid-run), so a hiccup pauses the run instead of killing it.
set -uo pipefail
export PATH="/Users/tejas1/Documents/Code/side-projects/ios-tester/tools/shim-bin:/Users/tejas1/.hermes/node/bin:$PATH"
WDA_DIR=/Users/tejas1/Documents/Code/side-projects/ios-tester/tools/WebDriverAgent
UDID=00008140-000979662E10801C
XCTESTRUN="$WDA_DIR/build/Build/Products/WebDriverAgentRunner_iphoneos26.0-arm64.xctestrun"
up() { curl -s --max-time 4 http://localhost:8100/status | grep -q '"state" : "success"'; }

up && { echo "WDA already up"; exit 0; }
pkill -f "test-without-building" 2>/dev/null
pgrep -f "ios forward 8100" >/dev/null || ( ios forward 8100 8100 --udid="$UDID" >/tmp/ios-forward.log 2>&1 & )
( cd "$WDA_DIR" && xcodebuild test-without-building -xctestrun "$XCTESTRUN" -destination "id=$UDID" >/tmp/wda-launch.log 2>&1 & )
for _ in $(seq 1 25); do up && { echo "WDA back up"; exit 0; }; sleep 2; done
echo "WDA restart timed out" >&2; exit 1
