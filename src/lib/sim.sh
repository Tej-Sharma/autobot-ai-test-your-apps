#!/usr/bin/env bash
# simctl wrappers — boot, install, launch, shutdown iOS Simulator devices.
# Sourced by bin/autobot.

set -euo pipefail

# Default device — overridden by .autobot/config.json if present.
: "${AUTOBOT_SIM_DEVICE:=iPhone 15}"
: "${AUTOBOT_SIM_OS:=}"   # empty => latest available

# Print UDID of the device matching $AUTOBOT_SIM_DEVICE (+ optional $AUTOBOT_SIM_OS).
# Creates one if it doesn't exist.
sim_ensure_device() {
  local name="$AUTOBOT_SIM_DEVICE"
  local udid
  udid=$(xcrun simctl list devices available --json \
    | /usr/bin/python3 -c "
import json, sys, os
name = os.environ['AUTOBOT_SIM_DEVICE']
want_os = os.environ.get('AUTOBOT_SIM_OS', '')
data = json.load(sys.stdin)
for runtime, devices in data['devices'].items():
    if want_os and want_os not in runtime:
        continue
    for d in devices:
        if d.get('name') == name and d.get('isAvailable', False):
            print(d['udid']); sys.exit(0)
" 2>/dev/null || true)

  if [ -z "$udid" ]; then
    # Create a new device on the latest iOS runtime.
    local runtime device_type
    runtime=$(xcrun simctl list runtimes available --json \
      | /usr/bin/python3 -c "
import json, sys
data = json.load(sys.stdin)
ios = [r for r in data['runtimes'] if r['platform'] == 'iOS' and r.get('isAvailable')]
ios.sort(key=lambda r: r['version'], reverse=True)
print(ios[0]['identifier'] if ios else '')
")
    device_type=$(xcrun simctl list devicetypes --json \
      | /usr/bin/python3 -c "
import json, sys, os
name = os.environ['AUTOBOT_SIM_DEVICE']
data = json.load(sys.stdin)
for d in data['devicetypes']:
    if d.get('name') == name:
        print(d['identifier']); sys.exit(0)
")
    if [ -z "$runtime" ] || [ -z "$device_type" ]; then
      echo "ERR: could not resolve runtime/device for '$name'" >&2
      exit 1
    fi
    udid=$(xcrun simctl create "$name" "$device_type" "$runtime")
  fi
  echo "$udid"
}

sim_boot() {
  local udid="$1"
  local state
  state=$(xcrun simctl list devices --json \
    | /usr/bin/python3 -c "
import json, sys, os
udid = os.environ['AUTOBOT_UDID']
data = json.load(sys.stdin)
for runtime, devices in data['devices'].items():
    for d in devices:
        if d['udid'] == udid:
            print(d['state']); sys.exit(0)
print('Unknown')
" AUTOBOT_UDID="$udid" 2>/dev/null || echo Unknown)
  if [ "$state" != "Booted" ]; then
    xcrun simctl boot "$udid"
  fi
  # Open Simulator.app so the user can watch.
  open -a Simulator --args -CurrentDeviceUDID "$udid" 2>/dev/null || true
  # Wait until ready.
  xcrun simctl bootstatus "$udid" -b >/dev/null
}

sim_install() {
  local udid="$1" app_path="$2"
  xcrun simctl install "$udid" "$app_path"
}

sim_launch() {
  local udid="$1" bundle_id="$2"
  xcrun simctl launch "$udid" "$bundle_id"
}

# Read CFBundleIdentifier from an .app bundle's Info.plist.
sim_bundle_id() {
  local app_path="$1"
  /usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$app_path/Info.plist"
}

sim_shutdown() {
  local udid="$1"
  xcrun simctl shutdown "$udid" 2>/dev/null || true
}

sim_screenshot() {
  local udid="$1" out="$2"
  xcrun simctl io "$udid" screenshot "$out"
}
