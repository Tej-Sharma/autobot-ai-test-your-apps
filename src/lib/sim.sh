#!/usr/bin/env bash
# simctl wrappers — boot, install, launch, shutdown iOS Simulator devices.
# Sourced by bin/autobot.

set -euo pipefail

# Device selection knobs (both optional):
#   AUTOBOT_SIM_DEVICE  pin a device name (e.g. "iPhone 16 Pro"); empty => auto-detect
#   AUTOBOT_SIM_OS      pin a runtime substring (e.g. "18-1");      empty => any / latest
: "${AUTOBOT_SIM_DEVICE:=}"
: "${AUTOBOT_SIM_OS:=}"

# Echo the UDID of a simulator to use. Preference order:
#   1. an already-booted device (use whatever the user is running)
#   2. any available device — iPhones first, newest iOS runtime
#   3. create one on the latest runtime with the newest iPhone device type
# AUTOBOT_SIM_DEVICE, when set, pins the device name at every stage; AUTOBOT_SIM_OS
# optionally pins the runtime. Exits non-zero only if no runtime exists to create on.
sim_ensure_device() {
  local udid
  udid=$(xcrun simctl list devices available --json 2>/dev/null \
    | AUTOBOT_SIM_DEVICE="${AUTOBOT_SIM_DEVICE:-}" AUTOBOT_SIM_OS="${AUTOBOT_SIM_OS:-}" /usr/bin/python3 -c '
import json, sys, os, re
want = os.environ.get("AUTOBOT_SIM_DEVICE", "").strip()
want_os = os.environ.get("AUTOBOT_SIM_OS", "").strip()
data = json.load(sys.stdin)

def ver(rt):
    m = re.search(r"iOS-(\d+)-(\d+)", rt)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)

def model(name):
    m = re.match(r"iPhone (\d+)", name)
    return int(m.group(1)) if m else -1

cands = []  # (booted, is_iphone, runtime_version, model_number, udid)
for rt, devices in data.get("devices", {}).items():
    if "iOS" not in rt:
        continue
    if want_os and want_os not in rt:
        continue
    v = ver(rt)
    for d in devices:
        if not d.get("isAvailable", False):
            continue
        name = d.get("name", "")
        if want and name != want:
            continue
        booted = 1 if d.get("state") == "Booted" else 0
        iphone = 1 if name.startswith("iPhone") else 0
        cands.append((booted, iphone, v, model(name), d["udid"]))

if cands:
    cands.sort(key=lambda c: (c[0], c[1], c[2], c[3]))
    print(cands[-1][4])
' 2>/dev/null || true)

  if [ -n "$udid" ]; then
    echo "$udid"; return 0
  fi

  # Nothing usable exists — create a device on the latest iOS runtime.
  local runtime device_type
  runtime=$(xcrun simctl list runtimes available --json 2>/dev/null \
    | AUTOBOT_SIM_OS="${AUTOBOT_SIM_OS:-}" /usr/bin/python3 -c '
import json, sys, os
want_os = os.environ.get("AUTOBOT_SIM_OS", "").strip()
data = json.load(sys.stdin)
ios = [r for r in data.get("runtimes", [])
       if r.get("platform") == "iOS" and r.get("isAvailable")
       and (not want_os or want_os in r.get("identifier", ""))]
ios.sort(key=lambda r: [int(x) for x in r.get("version", "0").split(".") if x.isdigit()])
print(ios[-1]["identifier"] if ios else "")
')
  device_type=$(xcrun simctl list devicetypes --json 2>/dev/null \
    | AUTOBOT_SIM_DEVICE="${AUTOBOT_SIM_DEVICE:-}" /usr/bin/python3 -c '
import json, sys, os, re
want = os.environ.get("AUTOBOT_SIM_DEVICE", "").strip()
data = json.load(sys.stdin)
dts = data.get("devicetypes", [])
if want:
    for d in dts:
        if d.get("name") == want:
            print(d["identifier"]); sys.exit(0)
best = None  # (number, plain_first, identifier) — newest plain iPhone wins
for d in dts:
    m = re.match(r"iPhone (\d+)(e)?( Pro Max| Pro| Plus| mini)?$", d.get("name", ""))
    if not m:
        continue
    cand = (int(m.group(1)), 1 if (not m.group(2) and not m.group(3)) else 0, d["identifier"])
    if best is None or cand[:2] > best[:2]:
        best = cand
print(best[2] if best else "")
')
  if [ -z "$runtime" ] || [ -z "$device_type" ]; then
    echo "ERR: no iOS simulator available and none could be created." >&2
    echo "     install a runtime: Xcode > Settings > Platforms > iOS > Get" >&2
    exit 1
  fi
  local create_name="${AUTOBOT_SIM_DEVICE:-autobot-sim}"
  udid=$(xcrun simctl create "$create_name" "$device_type" "$runtime")
  echo "$udid"
}

sim_boot() {
  local udid="$1"
  local state
  state=$(xcrun simctl list devices --json \
    | AUTOBOT_UDID="$udid" /usr/bin/python3 -c "
import json, sys, os
udid = os.environ['AUTOBOT_UDID']
data = json.load(sys.stdin)
for runtime, devices in data['devices'].items():
    for d in devices:
        if d['udid'] == udid:
            print(d['state']); sys.exit(0)
print('Unknown')
" 2>/dev/null || echo Unknown)
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
