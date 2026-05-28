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

# Install BlackHole + switchaudio-osx via Homebrew if missing, then set BlackHole
# as the default audio input. Output routing (System Settings > Sound > Output)
# still requires a manual Multi-Output Device — we print instructions for that.
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

  if command -v SwitchAudioSource >/dev/null 2>&1; then
    if SwitchAudioSource -a -t input 2>/dev/null | grep -q "BlackHole 2ch"; then
      echo ">> Setting BlackHole 2ch as default input..." >&2
      SwitchAudioSource -t input -s "BlackHole 2ch" >/dev/null 2>&1 || true
    else
      echo "audio: BlackHole 2ch not visible to audio system yet — a reboot or logout/login may be needed." >&2
    fi
  fi

  cat >&2 <<'EOF'

----------------------------------------------------------------
Manual step still required (one-time, ~30s):

  1. Open "Audio MIDI Setup" (Cmd-Space, type the name)
  2. Click + (bottom-left) → "Create Multi-Output Device"
  3. Check both:
       [x] BlackHole 2ch
       [x] (your speakers / headphones — so you can still hear playback)
  4. Save (no rename needed)
  5. System Settings → Sound → Output → pick that Multi-Output Device

This is needed so playback goes to BOTH BlackHole (sim hears it) AND your
speakers (you can monitor it). Input is already set to BlackHole.

Then re-run `autobot doctor` — the audio line should turn good.
----------------------------------------------------------------
EOF
  return 0
}

# Print a one-line status on whether BlackHole (or another loopback device)
# is configured as the current default input. Returns 0 if input is plausibly
# a loopback device, 1 otherwise.
audio_doctor() {
  local input_device
  input_device=$(/usr/bin/python3 - <<'PY' 2>/dev/null || true
import subprocess, re
out = subprocess.run(
    ["system_profiler", "SPAudioDataType"], capture_output=True, text=True
).stdout
# Find the device flagged as "Default Input Device: Yes"
blocks = re.split(r"\n(?=    [A-Z])", out)
for b in blocks:
    if "Default Input Device: Yes" in b:
        m = re.match(r"\s*([^\n:]+):", b)
        if m: print(m.group(1).strip()); break
PY
)
  if [ -z "$input_device" ]; then
    echo "audio: could not detect default input device"
    return 1
  fi
  case "$input_device" in
    *BlackHole*|*Loopback*|*Aggregate*|*VB-Cable*|*Soundflower*)
      echo "audio: default input is '$input_device' (looks like a loopback device — good)"
      return 0
      ;;
    *)
      echo "audio: default input is '$input_device' (NOT a loopback device — the simulator mic will read live mic, not piped audio)"
      echo "      install BlackHole and set it as the default input:"
      echo "        brew install blackhole-2ch"
      echo "        then System Settings > Sound > Input > BlackHole 2ch"
      return 1
      ;;
  esac
}
