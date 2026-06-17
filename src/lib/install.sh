#!/usr/bin/env bash
# Dependency installers + bootstrap for `autobot install`.
# Sourced by bin/autobot.

set -euo pipefail

# Print a green check or red x with a label.
_i_status() {
  local status="$1" label="$2"
  if [ "$status" = ok ]; then
    printf "  \033[32m✓\033[0m %s\n" "$label" >&2
  elif [ "$status" = miss ]; then
    printf "  \033[33m●\033[0m %s\n" "$label" >&2
  else
    printf "  \033[31m✗\033[0m %s\n" "$label" >&2
  fi
}

# Ask y/n; default yes.
_i_yn() {
  local prompt="$1"
  printf "%s [Y/n]: " "$prompt" >&2
  local answer; read -r answer </dev/tty || answer=""
  case "${answer:-y}" in y|Y|yes|"") return 0 ;; *) return 1 ;; esac
}

# Detect Apple Silicon vs Intel for brew prefix.
install_brew_prefix() {
  if [ -x /opt/homebrew/bin/brew ]; then
    echo /opt/homebrew
  elif [ -x /usr/local/bin/brew ]; then
    echo /usr/local
  else
    echo ""
  fi
}

install_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    _i_status ok "Homebrew installed: $(brew --prefix)"
    return 0
  fi
  _i_status miss "Homebrew not installed"
  if ! _i_yn "Install Homebrew now? (requires admin password)"; then
    _i_status err "skipped — many deps will fail without brew"
    return 1
  fi
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
  # After install, brew binary may not be on PATH yet for this shell. Add it.
  local prefix; prefix=$(install_brew_prefix)
  if [ -n "$prefix" ]; then
    eval "$("$prefix/bin/brew" shellenv)"
  fi
  command -v brew >/dev/null 2>&1 || return 1
  _i_status ok "Homebrew installed"
}

install_node() {
  if command -v node >/dev/null 2>&1 && command -v npx >/dev/null 2>&1; then
    _i_status ok "Node $(node -v) + npx"
    return 0
  fi
  _i_status miss "Node.js not installed"
  if command -v brew >/dev/null 2>&1; then
    brew install node
    _i_status ok "Node $(node -v)"
  else
    _i_status err "brew missing — cannot auto-install Node. See nodejs.org."
    return 1
  fi
}

install_xcode_clt() {
  # Command-line tools — minimal. Different from full Xcode.app.
  if xcode-select -p >/dev/null 2>&1; then
    _i_status ok "Xcode Command Line Tools at $(xcode-select -p)"
  else
    _i_status miss "Xcode Command Line Tools not installed"
    if _i_yn "Trigger CLT install dialog? (opens an Apple GUI prompt)"; then
      xcode-select --install || true
      echo "  → finish the GUI install, then re-run \`autobot install\`." >&2
      return 1
    else
      return 1
    fi
  fi
}

install_xcode_app_check() {
  # Full Xcode is needed for xcodebuild against an iOS simulator. The CLT alone
  # does NOT include iOS simulator runtimes. Check if Xcode.app is present.
  if [ -d "/Applications/Xcode.app" ] || mdfind "kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'" 2>/dev/null | grep -q Xcode.app; then
    _i_status ok "Xcode.app installed"
  else
    _i_status miss "Xcode.app not installed (required for iOS simulator)"
    echo "  → install Xcode from the App Store (free, ~15GB), then:" >&2
    echo "    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
    echo "    open -a Xcode  # accept license, install iOS platform" >&2
    return 1
  fi
}

install_ios_simulator_runtime() {
  if xcrun simctl list runtimes available 2>/dev/null | grep -q iOS; then
    local latest; latest=$(xcrun simctl list runtimes available 2>/dev/null | grep "iOS " | tail -n 1)
    _i_status ok "iOS Simulator runtime: $latest"
  else
    _i_status miss "No iOS Simulator runtime"
    echo "  → in Xcode: Settings → Platforms → iOS → Get" >&2
    return 1
  fi
}

install_blackhole() {
  if command -v brew >/dev/null 2>&1 && brew list blackhole-2ch >/dev/null 2>&1; then
    _i_status ok "BlackHole 2ch installed"
    return 0
  fi
  _i_status miss "BlackHole 2ch not installed (needed for voice-input tests)"
  if ! _i_yn "Install BlackHole 2ch via brew? (audio loopback driver)"; then
    return 1
  fi
  brew install blackhole-2ch
  _i_status ok "BlackHole 2ch installed"
}

install_switchaudio() {
  if command -v SwitchAudioSource >/dev/null 2>&1; then
    _i_status ok "SwitchAudioSource (audio device CLI)"
    return 0
  fi
  _i_status miss "switchaudio-osx not installed"
  brew install switchaudio-osx >/dev/null 2>&1 || true
  command -v SwitchAudioSource >/dev/null 2>&1 && _i_status ok "switchaudio-osx installed"
}

# Symlink the autobot binary onto PATH. Prefer /usr/local/bin (system) if writable;
# fall back to ~/.local/bin with a PATH-hint message.
install_path_symlink() {
  local autobot_bin="$1"
  local installed_at=""

  # Try /usr/local/bin first (no sudo if writable).
  if [ -w /usr/local/bin ] 2>/dev/null; then
    ln -sf "$autobot_bin" /usr/local/bin/autobot
    installed_at=/usr/local/bin/autobot
  elif [ -d /usr/local/bin ] && _i_yn "Symlink to /usr/local/bin/autobot? (sudo)"; then
    sudo ln -sf "$autobot_bin" /usr/local/bin/autobot
    installed_at=/usr/local/bin/autobot
  else
    mkdir -p "$HOME/.local/bin"
    ln -sf "$autobot_bin" "$HOME/.local/bin/autobot"
    installed_at="$HOME/.local/bin/autobot"
    case ":$PATH:" in
      *":$HOME/.local/bin:"*) ;;
      *)
        cat >&2 <<EOF

  Note: $HOME/.local/bin is not on your PATH. Add this to your shell rc:
    export PATH="\$HOME/.local/bin:\$PATH"

EOF
        ;;
    esac
  fi
  _i_status ok "Symlinked: $installed_at"
}

# Write the Claude Code skill file so chat can invoke autobot.
install_claude_skill() {
  local autobot_home="$1"
  local skill_dir="$HOME/.claude/skills/autobot"
  mkdir -p "$skill_dir"

  cat > "$skill_dir/SKILL.md" <<EOF
---
name: autobot
description: |
  Run autonomous visual UI tests on an iOS app via the iPhone Simulator. Use this
  skill when the user asks to "test my iOS app", "run UI QA", "find visual bugs",
  "screenshot test my app", "auto-test my flutter app", or describes a multi-step
  user flow they want validated end-to-end (signup, onboarding, checkout, etc).
  Drives the simulator via mobile-mcp, captures screenshots per step, and produces
  an HTML report flagging UX issues a common-sense user would side-eye.
---

# autobot — iOS visual QA via Claude Code

When the user asks for visual UI testing of an iOS app, run autobot.

## Decide which subcommand

1. If \`autobot\` is not on PATH (\`command -v autobot\` fails) → tell the user to run:
   \`\`\`
   $autobot_home/bin/autobot install
   \`\`\`
   Wait for it to finish, then continue.

2. If the current directory has \`.autobot/config.json\` → run \`autobot go\` to re-test.

3. Otherwise → ask the user for:
   - **The app**: a GitHub URL to clone, OR a local path to an Xcode project / Flutter project / .app bundle, OR "already running on the simulator"
   - **The core flows to test**: 3–7 user flows in natural language

   Then either run \`autobot wizard\` (interactive — pipes the answers in) or build a flow file directly and run \`autobot flow <udid> <bundle> <flow-file.md>\`.

## After running

- Read the summary that autobot prints (pass/warn/fail counts).
- The report HTML is at \`.autobot/reports/latest/report.html\` — autobot auto-opens it.
- For specifics, the journals are machine-readable:
  - \`.autobot/reports/latest/flaws.jsonl\` — every flaw with severity + screenshot refs
  - \`.autobot/reports/latest/journal.jsonl\` — the full step trace
- Surface the top high-severity flaws to the user (one line each, with the screenshot filename).

## Voice / audio testing

If the user's flow involves voice input (mic, dictation, voice assistant, audio call):
1. Verify audio loopback is set up: \`autobot doctor\` should report a loopback input device.
2. If not, run \`autobot setup-audio\` first (installs BlackHole + sets up routing).
3. Inside flow steps, audio is triggered via Bash: \`autobot speak "the phrase"\`.

## Available subcommands

- \`autobot install\` — one-shot install of all deps
- \`autobot wizard\` — interactive setup (sim + app + flows) then run
- \`autobot go\` — re-run the saved main flow + notify on completion
- \`autobot flow <udid> <bundle> <file.md>\` — run a specific flow
- \`autobot doctor\` — verify environment
- \`autobot setup-audio\` — install + configure BlackHole audio routing
- \`autobot speak <phrase>\` — TTS+play (used inside flows)

## Notes for the model

- The CLI does all the actual driving; do NOT call mobile-mcp tools yourself from this conversation. Spawn autobot and let its internal Claude subprocess do the driving (it has tighter scoping and budget caps).
- Outputs and reports go in \`.autobot/\` next to the user's working directory. Treat that as the source of truth.
- Budget defaults: 10min wall-clock kill, \$2 spend cap, 80 scripted + 30 exploration tool calls.
EOF
  _i_status ok "Skill installed: $skill_dir/SKILL.md"
}

# Run all install steps in order. Echoes a summary.
install_all() {
  local autobot_home="$1"
  local autobot_bin="$autobot_home/bin/autobot"
  echo
  echo "═══ autobot install ═══"
  echo
  echo "This will install autobot and its dependencies on this Mac." >&2
  echo "You'll be prompted before anything irreversible." >&2
  echo

  local soft_failures=0

  echo "[1/8] Homebrew"
  install_homebrew || soft_failures=$((soft_failures+1))

  echo "[2/8] Node.js"
  install_node || soft_failures=$((soft_failures+1))

  echo "[3/8] Xcode Command Line Tools"
  install_xcode_clt || soft_failures=$((soft_failures+1))

  echo "[4/8] Xcode.app"
  install_xcode_app_check || soft_failures=$((soft_failures+1))

  echo "[5/8] iOS Simulator runtime"
  install_ios_simulator_runtime || soft_failures=$((soft_failures+1))

  echo "[6/8] Audio loopback (optional — for voice tests)"
  install_blackhole || soft_failures=$((soft_failures+1))
  install_switchaudio || true

  echo "[7/8] PATH symlink"
  install_path_symlink "$autobot_bin"

  echo "[8/8] Claude Code skill"
  install_claude_skill "$autobot_home"

  echo
  if [ "$soft_failures" -eq 0 ]; then
    echo "✓ All set. Try one of:"
    echo "    autobot wizard     # interactive setup"
    echo "    autobot doctor     # re-verify environment"
    echo
    echo "Or in any Claude Code chat:"
    echo '    "test my iOS app"  # the skill will trigger autobot'
  else
    echo "⚠ Installed with $soft_failures gap(s). Re-run \`autobot install\` after addressing them above."
  fi
  echo
}
