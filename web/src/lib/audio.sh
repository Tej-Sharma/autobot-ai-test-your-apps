#!/usr/bin/env bash
# Audio I/O for feeding the browser's microphone (web apps with voice/dictation/
# getUserMedia features). macOS only; no-ops gracefully elsewhere.
#
# Pipeline (same idea as the iOS tester):
#   text ──(say)──> .aiff ──(afplay)──> current default OUTPUT
#                                              │
#                                              ▼
#       System default INPUT must be BlackHole (a loopback device) so Chromium's
#       getUserMedia reads the synthesized audio back as "microphone" input.
#
# Like the iOS tester, we DON'T permanently hijack the mic — voice runs flip the
# input to BlackHole only for their duration and ALWAYS restore it afterward.
#
# Sourced by bin/webbot.

set -euo pipefail

# --- TTS / playback ---------------------------------------------------------

# Generate audio from text via macOS `say`. Echoes the produced file path.
# Args: <phrase> [voice]   (voice defaults to WEBBOT_TTS_VOICE or "Samantha")
audio_synthesize() {
  local phrase="$1"
  local voice="${2:-${WEBBOT_TTS_VOICE:-Samantha}}"
  local out; out=$(mktemp -t webbot-tts).aiff
  say -v "$voice" -o "$out" "$phrase"
  echo "$out"
}

audio_play() {
  local file="$1"
  [ -f "$file" ] || { echo "ERR: audio file not found: $file" >&2; exit 1; }
  afplay "$file"
}

# TTS + play in one shot (used inside voice flows via `webbot speak`).
audio_speak() {
  local phrase="$1"
  local voice="${2:-${WEBBOT_TTS_VOICE:-Samantha}}"
  local file; file=$(audio_synthesize "$phrase" "$voice")
  audio_play "$file"
  rm -f "$file"
}

# --- device routing: save / switch / restore -------------------------------
# Voice runs temporarily point the system input at BlackHole and restore the user's
# devices afterward (so Zoom/Teams/Meet aren't left muted). Pre-test devices snapshot
# to a state file so a crashed run is still undoable.

audio_state_file() { echo "${WEBBOT_AUDIO_STATE:-$HOME/.local/state/webbot/audio-devices}"; }

audio_have_switch() { command -v SwitchAudioSource >/dev/null 2>&1; }
audio_current_input()  { SwitchAudioSource -c -t input  2>/dev/null || true; }
audio_current_output() { SwitchAudioSource -c -t output 2>/dev/null || true; }
audio_set_input()  { SwitchAudioSource -t input  -s "$1" >/dev/null 2>&1 || true; }
audio_set_output() { SwitchAudioSource -t output -s "$1" >/dev/null 2>&1 || true; }

# Snapshot current devices — only if not already saved, so a repeat/nested save can't
# clobber the genuine pre-test devices.
audio_save() {
  audio_have_switch || return 1
  local f; f=$(audio_state_file)
  [ -f "$f" ] && return 0
  mkdir -p "$(dirname "$f")"
  { audio_current_input; audio_current_output; } > "$f"
}

# Restore snapshotted devices and clear the snapshot. Returns 0 if it restored, 1 if
# nothing was saved (prints nothing then).
audio_restore() {
  local f; f=$(audio_state_file)
  [ -f "$f" ] || return 1
  audio_have_switch || { rm -f "$f"; return 1; }
  local in out
  in=$(sed -n '1p' "$f"); out=$(sed -n '2p' "$f")
  [ -n "$in" ]  && audio_set_input  "$in"
  [ -n "$out" ] && audio_set_output "$out"
  rm -f "$f"
  echo "audio: restored input='$in' output='$out'" >&2
  return 0
}

# Warn (don't block) if a conferencing/voice app is running — switching the mic to
# BlackHole will mute the user there. Browser calls (Google Meet) can't be detected.
audio_meeting_warning() {
  local app found=""
  for app in "zoom.us" "Microsoft Teams" "Webex" "RingCentral" "BlueJeans" "GoTo" "Discord" "FaceTime" "Slack"; do
    if pgrep -f "$app" >/dev/null 2>&1; then found="$found     - $app"$'\n'; fi
  done
  [ -z "$found" ] && return 0
  echo "⚠ audio: a conferencing/voice app appears to be running:" >&2
  printf '%s' "$found" >&2
  echo "  webbot will switch your mic to BlackHole for this test (you'll be muted to that call)," >&2
  echo "  then restore your devices automatically when it finishes. (Browser calls e.g. Google Meet" >&2
  echo "  can't be auto-detected — end/mute them first if you're in one.)" >&2
  return 0
}

# Enter test mode: save devices, route input (and output) so the browser hears playback.
# Returns 1 if loopback isn't available.
audio_enter_test_mode() {
  audio_have_switch || { echo "audio: SwitchAudioSource not installed — run 'webbot setup-audio'." >&2; return 1; }
  if ! SwitchAudioSource -a -t input 2>/dev/null | grep -q "BlackHole 2ch"; then
    echo "audio: BlackHole not available — run 'webbot setup-audio'. Skipping audio routing." >&2
    return 1
  fi
  audio_save
  audio_set_input "BlackHole 2ch"
  local multi
  multi=$(SwitchAudioSource -a -t output 2>/dev/null | grep -i "multi-output" | head -1)
  if [ -n "$multi" ]; then
    audio_set_output "$multi"
  else
    audio_set_output "BlackHole 2ch"
    echo "audio: no Multi-Output device — routing output to BlackHole for the test (you won't hear playback)." >&2
  fi
  echo "audio: test mode ON — input→BlackHole. Devices restored when the run ends." >&2
}

audio_exit_test_mode() { audio_restore || true; }

# Human-readable current routing + test-mode / saved-state flags.
audio_status() {
  if ! audio_have_switch; then
    echo "audio: SwitchAudioSource not installed — run 'webbot setup-audio' for voice tests"
    return 1
  fi
  local in out f; in=$(audio_current_input); out=$(audio_current_output); f=$(audio_state_file)
  echo "audio input : $in"
  echo "audio output: $out"
  case "$in" in
    *BlackHole*) echo "  ⚠ INPUT is BlackHole — webbot test mode is active; other apps/meetings can't hear your mic." ;;
  esac
  if [ -f "$f" ]; then
    echo "  saved pre-test devices: input='$(sed -n 1p "$f")' output='$(sed -n 2p "$f")'"
    echo "  → run 'webbot audio restore' to revert now."
  fi
}

# Install BlackHole + switchaudio-osx via Homebrew (macOS). Does NOT permanently change
# your input — runs flip to BlackHole only for their duration and restore after.
audio_install_loopback() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "audio: BlackHole loopback is macOS-only; voice input isn't available on this OS." >&2
    return 1
  fi
  if ! command -v brew >/dev/null 2>&1; then
    echo "audio: Homebrew is required to auto-install BlackHole (https://brew.sh)." >&2
    return 1
  fi
  if ! brew list blackhole-2ch >/dev/null 2>&1; then
    echo ">> Installing BlackHole 2ch via Homebrew (sudo password may be requested)..." >&2
    brew install blackhole-2ch || { echo "audio: brew install blackhole-2ch failed." >&2; return 1; }
  else
    echo "audio: BlackHole 2ch already installed." >&2
  fi
  command -v SwitchAudioSource >/dev/null 2>&1 || { echo ">> Installing switchaudio-osx..." >&2; brew install switchaudio-osx || true; }

  if audio_have_switch && SwitchAudioSource -a -t input 2>/dev/null | grep -q "BlackHole 2ch"; then
    echo "audio: BlackHole is installed and visible — voice testing is ready." >&2
  else
    echo "audio: BlackHole installed but not yet loaded by CoreAudio. Load it with:" >&2
    echo "         sudo killall coreaudiod      # brief ~1s audio blip" >&2
    echo "       or log out and back in, then re-run 'webbot doctor'." >&2
  fi
  cat >&2 <<'EOF'

----------------------------------------------------------------
Optional (only to HEAR playback during a test): create a Multi-Output Device in
"Audio MIDI Setup" containing BlackHole 2ch + your speakers. webbot uses it if present;
without it, tests still work (output routes to BlackHole, you just won't hear playback).

Your normal mic/output are NOT changed by setup. webbot switches to BlackHole only
during a voice test and restores your devices when it finishes
(`webbot audio status` shows routing; `webbot audio restore` reverts).
----------------------------------------------------------------
EOF
  return 0
}

# Readiness check for voice testing: BlackHole installed + visible as an input device.
# Also prints current routing and flags if you're stuck in test mode. Returns 0 if ready.
audio_doctor() {
  if ! audio_have_switch; then
    echo "audio: SwitchAudioSource not installed — 'webbot setup-audio' to enable voice tests (macOS)"
    return 1
  fi
  local cur_in cur_out
  cur_in=$(audio_current_input); cur_out=$(audio_current_output)
  echo "audio: current input='$cur_in' output='$cur_out'"
  case "$cur_in" in
    *BlackHole*) echo "audio: ⚠ input is BlackHole (webbot test mode) — meetings/other apps can't hear your mic; run 'webbot audio restore'" ;;
  esac
  if SwitchAudioSource -a -t input 2>/dev/null | grep -q "BlackHole 2ch"; then
    echo "audio: BlackHole ready for voice input testing"
    return 0
  fi
  echo "audio: BlackHole not visible — run 'webbot setup-audio' (if just installed: sudo killall coreaudiod, or log out/in)"
  return 1
}
