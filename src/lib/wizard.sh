#!/usr/bin/env bash
# Interactive setup wizard. Prompts user for app + flows, writes config + main flow file.
# Sourced by bin/autobot.

set -euo pipefail

# Print a heading.
_w_h() {
  echo
  echo "═══ $* ═══"
  echo
}

# Prompt for a single line. Echoes the answer.
# Args: <prompt> [default]
_w_ask() {
  local prompt="$1" default="${2:-}" answer
  if [ -n "$default" ]; then
    printf "%s [%s]: " "$prompt" "$default" >&2
  else
    printf "%s: " "$prompt" >&2
  fi
  read -r answer </dev/tty
  if [ -z "$answer" ] && [ -n "$default" ]; then
    answer="$default"
  fi
  echo "$answer"
}

# Prompt for a multiline block (terminated by an empty line). Echoes all lines.
_w_ask_block() {
  local prompt="$1" line
  echo "$prompt (one per line; blank line to finish):" >&2
  local lines=()
  while IFS= read -r line </dev/tty; do
    [ -z "$line" ] && break
    lines+=("$line")
  done
  printf '%s\n' "${lines[@]}"
}

# Yes/no. Echoes "y" or "n".
_w_yn() {
  local prompt="$1" default="${2:-n}" answer
  printf "%s [%s/%s]: " "$prompt" \
    "$( [ "$default" = y ] && echo Y || echo y )" \
    "$( [ "$default" = n ] && echo N || echo n )" >&2
  read -r answer </dev/tty
  answer="${answer:-$default}"
  case "$answer" in y|Y|yes) echo y ;; *) echo n ;; esac
}

# Detect booted simulators. Echoes lines of "<udid>|<name>|<runtime>".
wizard_list_booted_sims() {
  xcrun simctl list devices booted --json 2>/dev/null \
    | /usr/bin/python3 -c "
import json, sys
data = json.load(sys.stdin)
for runtime, devices in data.get('devices', {}).items():
    for d in devices:
        print(f\"{d['udid']}|{d['name']}|{runtime.split('.')[-1]}\")
" 2>/dev/null || true
}

# List installed user apps on a UDID. Echoes "<bundleId>|<displayName>".
wizard_list_user_apps() {
  local udid="$1"
  xcrun simctl listapps "$udid" 2>/dev/null \
    | /usr/bin/python3 -c "
import sys, re
text = sys.stdin.read()
# Each app block starts with    \"bundle.id\" =     {
# Inside we find ApplicationType and CFBundleDisplayName.
blocks = re.split(r'\n    \"', text)
for b in blocks:
    if 'ApplicationType = User' not in b: continue
    m_id = re.match(r'([^\"]+)\"', b)
    m_name = re.search(r'CFBundleDisplayName = \"?([^\";\n]+)\"?', b)
    if m_id:
        bid = m_id.group(1)
        nm = m_name.group(1).strip() if m_name else bid
        print(f'{bid}|{nm}')
" 2>/dev/null || true
}

# Detect a buildable iOS target inside a directory. Echoes the path to use.
# Search order: .xcworkspace > .xcodeproj > pubspec.yaml (Flutter) > .app
wizard_detect_app() {
  local root="$1"
  # Prefer ios subdir for Flutter projects
  if [ -f "$root/pubspec.yaml" ]; then
    echo "$root"
    return
  fi
  local ws proj app
  ws=$(find "$root" -maxdepth 4 -name "*.xcworkspace" -not -path "*/Pods/*" 2>/dev/null | head -n 1)
  [ -n "$ws" ] && echo "$ws" && return
  proj=$(find "$root" -maxdepth 4 -name "*.xcodeproj" -not -path "*/Pods/*" 2>/dev/null | head -n 1)
  [ -n "$proj" ] && echo "$proj" && return
  app=$(find "$root" -maxdepth 4 -name "*.app" -type d 2>/dev/null | head -n 1)
  [ -n "$app" ] && echo "$app" && return
  echo ""
}

# Build + install a target onto the first booted (or freshly created) simulator.
# Handles Flutter projects (pubspec.yaml), Xcode projects/workspaces, and .app bundles.
# Args: <path> <work-dir>
wizard_build_install() {
  local path="$1" work_dir="$2"
  local udid; udid=$(sim_ensure_device)
  sim_boot "$udid"

  local kind
  if [ -f "$path/pubspec.yaml" ]; then
    kind=flutter
  elif [[ "$path" == *.xcodeproj || "$path" == *.xcworkspace ]]; then
    kind=xcode
  elif [[ "$path" == *.app ]]; then
    kind=app
  else
    echo "ERR: unrecognized target: $path" >&2; return 1
  fi

  local app_bundle
  case "$kind" in
    flutter)
      if ! command -v flutter >/dev/null 2>&1; then
        echo "ERR: 'flutter' not on PATH. Install Flutter, then re-run." >&2; return 1
      fi
      echo ">> Building Flutter iOS simulator debug..." >&2
      (cd "$path" && flutter build ios --simulator --debug)
      app_bundle=$(find "$path/build/ios/iphonesimulator" -maxdepth 1 -name "*.app" -type d 2>/dev/null | head -n 1)
      ;;
    xcode)
      local scheme; scheme=$(build_resolve_scheme "$path" "$(build_detect_kind "$path")")
      echo ">> Building Xcode scheme '$scheme' for simulator..." >&2
      app_bundle=$(build_for_simulator "$path" "$scheme" "$udid" "$work_dir/.autobot/build")
      ;;
    app)
      app_bundle="$path"
      ;;
  esac

  if [ -z "${app_bundle:-}" ] || [ ! -d "$app_bundle" ]; then
    echo "ERR: could not produce/locate a .app bundle." >&2; return 1
  fi
  echo ">> Installing $app_bundle..." >&2
  sim_install "$udid" "$app_bundle"
  local bundle_id; bundle_id=$(sim_bundle_id "$app_bundle")
  sim_launch "$udid" "$bundle_id" >/dev/null
  echo ">> $bundle_id launched on $udid" >&2
}

# Main wizard. Args: <work-dir>
# Writes <work-dir>/.autobot/CLAUDE.md, .autobot/flows/main.md, .autobot/config.json.
# Echoes "<udid>|<bundleId>" on success.
wizard_run() {
  local work_dir="$1"
  mkdir -p "$work_dir/.autobot/flows"

  _w_h "Welcome to autobot — visual iOS QA via Claude Code"
  cat >&2 <<EOF
This wizard sets up an autobot config for a target iOS app.

You'll need ONE of:
  (a) a sim already booted with the app installed
  (b) a local path to an Xcode project / Flutter project / .app bundle
  (c) a GitHub URL to a public iOS project

Plus:
  - 1–2 sentence description of the app
  - 3–7 core flows to test

EOF

  # 0. Source the app: running sim, local path, or git URL?
  _w_h "Step 1 of 5 — where is the app?"
  cat >&2 <<EOF
  [1] Already running on a simulator (skip build)
  [2] Local path (Xcode project, Flutter project, or .app bundle)
  [3] GitHub URL (will git clone, build, install)

EOF
  local src; src=$(_w_ask "Source" "1")

  case "$src" in
    2)
      local app_path; app_path=$(_w_ask "Local path to app/project")
      if [ ! -e "$app_path" ]; then
        echo "ERR: path does not exist: $app_path" >&2; exit 1
      fi
      wizard_build_install "$app_path" "$work_dir" || return 1
      ;;
    3)
      local repo_url; repo_url=$(_w_ask "GitHub repo URL (https or ssh)")
      local clone_dir="$work_dir/.autobot/sources/$(basename "${repo_url%.git}")"
      if [ ! -d "$clone_dir" ]; then
        mkdir -p "$(dirname "$clone_dir")"
        git clone --depth 1 "$repo_url" "$clone_dir"
      else
        echo "  (using existing clone at $clone_dir)" >&2
      fi
      # Auto-detect the build target inside the clone.
      local detected; detected=$(wizard_detect_app "$clone_dir")
      if [ -z "$detected" ]; then
        echo "ERR: could not auto-detect an iOS build target in the cloned repo." >&2
        echo "      look for .xcodeproj/.xcworkspace/pubspec.yaml and pass the path with option 2." >&2
        exit 1
      fi
      echo "  detected: $detected" >&2
      wizard_build_install "$detected" "$work_dir" || return 1
      ;;
    *)
      # Option 1 — use whatever's running
      ;;
  esac

  # 2. Pick simulator (whichever is booted)
  _w_h "Step 2 of 5 — pick a simulator"
  local booted; booted=$(wizard_list_booted_sims)
  if [ -z "$booted" ]; then
    echo "ERR: no booted simulator detected. Boot one (Simulator.app or \`xcrun simctl boot\`) then re-run." >&2
    exit 1
  fi
  echo "Booted simulators:" >&2
  local i=1
  declare -a sim_udids sim_labels
  while IFS='|' read -r udid name runtime; do
    echo "  [$i] $name ($runtime)  — $udid" >&2
    sim_udids[$i]="$udid"
    sim_labels[$i]="$name ($runtime)"
    i=$((i + 1))
  done <<< "$booted"
  local choice; choice=$(_w_ask "Pick a simulator number" "1")
  local udid="${sim_udids[$choice]:-}"
  if [ -z "$udid" ]; then
    echo "ERR: invalid choice." >&2; exit 1
  fi
  echo "  ✓ Using ${sim_labels[$choice]}" >&2

  # 3. Pick app
  _w_h "Step 3 of 5 — pick the target app on this sim"
  local apps; apps=$(wizard_list_user_apps "$udid")
  if [ -z "$apps" ]; then
    echo "ERR: no user apps installed on this simulator. Install the target app first." >&2
    exit 1
  fi
  i=1
  declare -a app_ids app_names
  while IFS='|' read -r bid name; do
    echo "  [$i] $name  — $bid" >&2
    app_ids[$i]="$bid"
    app_names[$i]="$name"
    i=$((i + 1))
  done <<< "$apps"
  choice=$(_w_ask "Pick an app number" "1")
  local bundle_id="${app_ids[$choice]:-}"
  local app_name="${app_names[$choice]:-}"
  if [ -z "$bundle_id" ]; then
    echo "ERR: invalid choice." >&2; exit 1
  fi
  echo "  ✓ Using $app_name ($bundle_id)" >&2

  # 4. Describe the app
  _w_h "Step 4 of 5 — describe the app"
  local desc
  desc=$(_w_ask "In 1–2 sentences, what does $app_name do?")
  if [ -z "$desc" ]; then
    desc="An iOS app. (No description provided.)"
  fi

  # 5. List flows
  _w_h "Step 5 of 5 — list the core user flows to test"
  cat >&2 <<EOF
List the user flows you want autobot to test. One flow per line.
Examples:
  Sign up as a new user and complete onboarding
  Capture a thought, search for it, ask the assistant about it
  Edit profile, change avatar, save
Press enter on an empty line when done.

EOF
  local flows_raw; flows_raw=$(_w_ask_block "Flows to test")
  if [ -z "$flows_raw" ]; then
    echo "ERR: at least one flow is required." >&2; exit 1
  fi

  # Write config
  cat > "$work_dir/.autobot/config.json" <<EOF
{
  "mode": "wizard",
  "udid": "$udid",
  "bundleId": "$bundle_id",
  "appName": "$(echo "$app_name" | sed 's/"/\\"/g')",
  "mainFlow": ".autobot/flows/main.md"
}
EOF

  # Write main flow file
  local flow_file="$work_dir/.autobot/flows/main.md"
  {
    echo "# $app_name — main flow"
    echo
    echo "## About the app"
    echo
    echo "$desc"
    echo
    echo "**Bundle**: \`$bundle_id\`"
    echo
    echo "## Counter"
    echo
    echo "**Counter file**: \`main.counter\` (next to this file). For any step that needs a unique-per-run value (signup email, etc.), use \`automationtest{N}@g.com\` where N is read from the counter; increment after a successful step that consumed it."
    echo
    echo "## Steps"
    echo
    local n=1
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      echo "### $n. $line"
      echo
      echo "(Interpret naturally — use common sense.)"
      echo
      n=$((n + 1))
    done <<< "$flows_raw"
    echo "## On any step error"
    echo
    echo "Follow the global error rule: save screenshot, append to errors.md, continue if next step is independent, else stop."
  } > "$flow_file"

  # Seed counter
  if [ ! -f "$work_dir/.autobot/flows/main.counter" ]; then
    echo "1" > "$work_dir/.autobot/flows/main.counter"
  fi

  _w_h "Setup complete"
  echo "Config:    $work_dir/.autobot/config.json" >&2
  echo "Flow file: $flow_file" >&2
  echo >&2
  echo "Edit the flow file to refine steps, then run:" >&2
  echo "  autobot go" >&2
  echo >&2

  echo "$udid|$bundle_id"
}
