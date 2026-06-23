#!/usr/bin/env bash
# Audio I/O for feeding simulator mic input.
#
# Pipeline:
#   text  ──(say)──>  .aiff file  ──(afplay)──>  current default output
#                                                       │
#                                                       ▼
#               System default INPUT must be BlackHole (or another loopback
#               device) so the simulator's microphone reads the audio back.
#
# Sourced by bin/autobot.

set -euo pipefail

# Generate audio from text using macOS `say`. Echoes the produced file path.
# Args: <phrase> [voice]   (voice defaults to "Samantha", a good English voice)
audio_synthesize() {
  local phrase="$1"
  local voice="${2:-Samantha}"
  local out; out=$(mktemp -t autobot-tts).aiff
  say -v "$voice" -o "$out" "$phrase"
  echo "$out"
}

# Play an audio file via afplay (blocks until done).
audio_play() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "ERR: audio file not found: $file" >&2; exit 1
  fi
  afplay "$file"
}

# TTS + play in one shot. Common case.
audio_speak() {
  local phrase="$1"
  local voice="${2:-Samantha}"
  local file; file=$(audio_synthesize "$phrase" "$voice")
  audio_play "$file"
  rm -f "$file"
}

# ─────────────────────────────────────────────────────────────────────────────
# Device routing: save / switch / restore.
#
# The iOS Simulator mic reads the host's DEFAULT INPUT device. To feed it audio we
# must temporarily point that at BlackHole — but doing so globally and permanently
# is what breaks Zoom/Teams/Meet (your mic goes silent to everyone else). So autobot
# only flips devices around a run and ALWAYS restores them afterward. The pre-test
# devices are snapshotted to a small state file so a crashed run can still be undone.
# ─────────────────────────────────────────────────────────────────────────────

# Where the pre-test device snapshot lives (system-global, outside the managed
# ~/.autobot install dir so an update can't wipe it mid-test).
audio_state_file() { echo "${AUTOBOT_AUDIO_STATE:-$HOME/.local/state/autobot/audio-devices}"; }

audio_have_switch() { command -v SwitchAudioSource >/dev/null 2>&1; }
audio_current_input()  { SwitchAudioSource -c -t input  2>/dev/null || true; }
audio_current_output() { SwitchAudioSource -c -t output 2>/dev/null || true; }
audio_set_input()  { SwitchAudioSource -t input  -s "$1" >/dev/null 2>&1 || true; }
audio_set_output() { SwitchAudioSource -t output -s "$1" >/dev/null 2>&1 || true; }

# Snapshot the current input+output devices — but only if we haven't already, so a
# repeat/nested save can never clobber the genuine pre-test devices.
audio_save() {
  audio_have_switch || return 1
  local f; f=$(audio_state_file)
  [ -f "$f" ] && return 0
  mkdir -p "$(dirname "$f")"
  { audio_current_input; audio_current_output; } > "$f"
}

# Restore the snapshotted devices and clear the snapshot.
# Returns 0 if it restored something, 1 if there was nothing saved (prints nothing then).
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
# BlackHole will mute you in that call. Google Meet runs in the browser and can't be
# reliably detected, so it's mentioned in the message.
audio_meeting_warning() {
  local app found=""
  for app in "zoom.us" "Microsoft Teams" "Webex" "RingCentral" "BlueJeans" "GoTo" "Discord" "FaceTime" "Slack"; do
    if pgrep -f "$app" >/dev/null 2>&1; then found="$found     - $app"$'\n'; fi
  done
  [ -z "$found" ] && return 0
  echo "⚠ audio: a conferencing/voice app appears to be running:" >&2
  printf '%s' "$found" >&2
  echo "  autobot will switch your mic to BlackHole for this test (you'll be muted to that call)," >&2
  echo "  then restore your devices automatically when it finishes. (Browser calls e.g. Google Meet" >&2
  echo "  can't be auto-detected — end/mute them first if you're in one.)" >&2
  return 0
}

# Enter test mode: save devices, route input (and output) so the sim hears playback.
# Prefers a Multi-Output device (so you can still monitor); else routes output straight
# to BlackHole (sim hears it, you won't). Returns 1 if loopback isn't available.
audio_enter_test_mode() {
  audio_have_switch || { echo "audio: SwitchAudioSource not installed — run 'autobot setup-audio'." >&2; return 1; }
  if ! SwitchAudioSource -a -t input 2>/dev/null | grep -q "BlackHole 2ch"; then
    echo "audio: BlackHole not available — run 'autobot setup-audio'. Skipping audio routing." >&2
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
  echo "audio: test mode ON — input→BlackHole. Devices will be restored when the run ends." >&2
}

# Leave test mode (alias for restore, used by traps / 'audio off').
audio_exit_test_mode() { audio_restore || true; }

# Human-readable current routing + test-mode / saved-state flags.
audio_status() {
  if ! audio_have_switch; then
    echo "audio: SwitchAudioSource not installed — run 'autobot setup-audio' for voice tests"
    return 1
  fi
  local in out f; in=$(audio_current_input); out=$(audio_current_output); f=$(audio_state_file)
  echo "audio input : $in"
  echo "audio output: $out"
  case "$in" in
    *BlackHole*) echo "  ⚠ INPUT is BlackHole — autobot test mode is active; other apps/meetings can't hear your mic." ;;
  esac
  if [ -f "$f" ]; then
    echo "  saved pre-test devices: input='$(sed -n 1p "$f")' output='$(sed -n 2p "$f")'"
    echo "  → run 'autobot audio restore' to revert now."
  fi
}

# Install BlackHole + switchaudio-osx via Homebrew if missing. Does NOT permanently
# change your input — runs flip to BlackHole only for their duration and restore after.
# A Multi-Output device (for monitoring playback) stays optional.
# Returns 0 on success, 1 if anything failed.
audio_install_loopback() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "audio: Homebrew is required to auto-install BlackHole." >&2
    echo "       install brew first: https://brew.sh, then re-run." >&2
    return 1
  fi

  if ! brew list blackhole-2ch >/dev/null 2>&1; then
    echo ">> Installing BlackHole 2ch via Homebrew (sudo password may be requested)..." >&2
    if ! brew install blackhole-2ch; then
      echo "audio: brew install blackhole-2ch failed." >&2
      return 1
    fi
  else
    echo "audio: BlackHole 2ch already installed." >&2
  fi

  if ! command -v SwitchAudioSource >/dev/null 2>&1; then
    echo ">> Installing switchaudio-osx (for programmatic audio device switching)..." >&2
    brew install switchaudio-osx || true
  fi

  if audio_have_switch && SwitchAudioSource -a -t input 2>/dev/null | grep -q "BlackHole 2ch"; then
    echo "audio: BlackHole is installed and visible — voice testing is ready." >&2
  else
    echo "audio: BlackHole installed but not yet loaded by CoreAudio. Load it with:" >&2
    echo "         sudo killall coreaudiod      # brief ~1s audio blip" >&2
    echo "       or just log out and back in, then re-run 'autobot doctor'." >&2
  fi

  cat >&2 <<'EOF'

----------------------------------------------------------------
Optional (only if you want to HEAR playback during a test):
  1. Open "Audio MIDI Setup" (Cmd-Space, type the name)
  2. Click + (bottom-left) → "Create Multi-Output Device"
  3. Check both: [x] BlackHole 2ch   [x] your speakers/headphones
  4. Save (no rename needed)

autobot will use that Multi-Output device automatically if it exists. Without it,
tests still work — output just routes to BlackHole and you won't hear playback.

Your normal mic/output are NOT changed by setup. autobot switches to BlackHole only
during a voice test and restores your devices when it finishes
(`autobot audio status` shows current routing; `autobot audio restore` reverts).
----------------------------------------------------------------
EOF
  return 0
}

# Readiness check for voice testing: BlackHole installed + visible as an input device.
# Also prints current routing and flags if you're currently stuck in test mode (#7).
# Returns 0 if voice testing is ready, 1 otherwise.
audio_doctor() {
  if ! audio_have_switch; then
    echo "audio: SwitchAudioSource not installed — run 'autobot setup-audio' for voice tests"
    return 1
  fi
  local cur_in cur_out
  cur_in=$(audio_current_input); cur_out=$(audio_current_output)
  echo "audio: current input='$cur_in' output='$cur_out'"
  case "$cur_in" in
    *BlackHole*) echo "audio: ⚠ input is BlackHole (autobot test mode) — meetings/other apps can't hear your mic; run 'autobot audio restore'" ;;
  esac
  if SwitchAudioSource -a -t input 2>/dev/null | grep -q "BlackHole 2ch"; then
    local multi; multi=$(SwitchAudioSource -a -t output 2>/dev/null | grep -i "multi-output" | head -1)
    if [ -n "$multi" ]; then
      echo "audio: BlackHole ready; Multi-Output '$multi' present (you'll hear playback during tests) — good"
    else
      echo "audio: BlackHole ready (no Multi-Output device — tests route output to BlackHole; you won't hear playback)"
    fi
    return 0
  fi
  echo "audio: BlackHole not visible as an input device — run 'autobot setup-audio'"
  echo "      (if just installed, load the driver: sudo killall coreaudiod, or log out/in)"
  return 1
}
