# Audio / voice-input — TODO + everything we know (v2 engine)

> **Status: NOT implemented in the v2 engine.** The v2 drive loop does tap/type/scroll/swipe
> only. This file captures *all* the audio knowledge — install, the bugs we hit, the
> meeting-safe factors, and the integration plan — so when we add voice-input testing we
> reuse v1's already-bug-fixed machinery instead of rediscovering the traps.

## Goal & routing model

Feed synthesized speech into the **Simulator's microphone** to test voice features (voice
search, voice notes, voice assistant, audio calls). The Simulator's mic reads the **host's
default INPUT device**, so the pipeline is:

```
text ──(macOS `say`)──> .aiff ──(afplay)──> default OUTPUT ─┐
                                                            ▼  (must be looped back)
        host default INPUT = BlackHole 2ch  ──>  Simulator microphone
```

So a run must temporarily point **input → BlackHole** and play the TTS so the sim hears it.

## Installation (reuse v1; don't reinvent)

- **BlackHole 2ch** — `brew install blackhole-2ch` (virtual loopback audio driver).
- **switchaudio-osx** — `brew install switchaudio-osx` → provides `SwitchAudioSource` (CLI to
  query/set default input/output devices).
- **Multi-Output aggregate device** — created via CoreAudio (`AudioHardwareCreateAggregateDevice`)
  by `src/lib/audio-multiout.swift`. Mixes a **real output (clock master) + BlackHole**.
- One-time setup is already wrapped: **`autobot setup-audio`** (installs BlackHole +
  switchaudio-osx, creates the Multi-Output). `autobot doctor` reports whether voice testing
  is ready. v2 should call/require these, not re-implement them.

## ⚠ Bugs we hit (the critical knowledge — do NOT regress these)

### 1. Never route the default OUTPUT to BlackHole alone → SIGABRT (2026-06-23)
- **Symptom:** a clock-sensitive voice app (VPIO / `.voiceChat` / real-time, e.g. CIR) hard-
  crashes on the Simulator: `mainMixerNode → AURemoteIO::Cleanup → _ReportRPCTimeout → abort()`.
- **Cause:** BlackHole is **clockless**. As the *sole* default output, the Simulator's output
  `AURemoteIO` has no hardware clock → start/cleanup RPC times out → abort. (Input = BlackHole
  is fine; only OUTPUT-alone is the trap, and only for apps that bring up an output/duplex unit.)
- **Fix:** route output through a **stacked Multi-Output** (real device = clock master +
  BlackHole, drift-corrected). **Never BlackHole alone.** If the Multi-Output can't be created,
  **leave the output device unchanged** — do NOT fall back to BlackHole-alone.

### 2. Validation must reproduce the REAL scenario (process lesson)
- The original audio rework was "validated" only with device save/restore round-trips — never
  an actual voice flow against a real clock-sensitive app + Simulator. The plumbing tests
  passed while the real failure (the app crashing) went untested.
- **Rule:** when changing audio/device/system routing, validation must reproduce the actual
  end-to-end scenario (a voice app capturing piped audio **without crashing**), not just the
  shell wiring. A clean save/restore round-trip is necessary but nowhere near sufficient.

## Meeting-safe factors ("give control back")

Switching the host mic to BlackHole **mutes you in any live call** — so the rules are:
- **Never permanently hijack** the host mic/output. Flip devices **only for the run**.
- **Save** the pre-run input/output to a state file *outside* the managed install dir
  (`~/.local/state/autobot/audio-devices`, so an update can't wipe it mid-test).
- **Restore always — even on crash/timeout** (via an EXIT trap → `audio_exit_test_mode` /
  `audio_restore`).
- **Meeting guard:** warn (don't block) if a conferencing app is running (Zoom/Teams/Webex/
  Discord/FaceTime/Slack…). Browser calls (Google Meet) can't be auto-detected — message says so.
- **`autobot audio status`** flags the dangerous state (output = BlackHole alone) and tells you
  to `autobot audio restore`.

## Voice-flow order (from v1 `flow-prompt.md` — carry into the v2 prompt)

1. **Find the entry point** (mic icon / "Hold to talk" / "Start conversation" / waveform).
2. **Verify the app is actually listening** (screenshot → "Listening…", animated waveform,
   glowing mic, "Speak now"). **Never play audio before the app is listening** — it's discarded
   and the test falsely looks broken.
3. **Speak:** `autobot speak "the phrase"` (blocks ~1–3s).
4. **Push-to-talk:** `mobile_long_press_on_screen_at_coordinates` held long enough to cover the
   audio, or press/release around the `speak`. If continuous touch can't be released
   programmatically, log a partial-coverage gap and move on.
5. **After playback**, screenshot to verify the reaction (transcript/action/response); allow ~5s.
6. **Opt-in:** if a step doesn't mention voice, don't synthesize audio at all.
7. **If loopback isn't configured** (`speak` completes but no transcript), record a `functional`
   flaw: *"audio loopback not configured — sim mic did not receive playback"* and continue.

## Higher-quality voices
macOS Settings → Accessibility → Spoken Content → System Voice → download a Premium/Enhanced
voice (e.g. "Ava (Premium)"), then set `AUTOBOT_TTS_VOICE=Ava`. Default voice = "Samantha".

## v2 integration plan (TODO — not built)

The clean design is to **reuse v1's bug-fixed audio via a shell-out**, not reimplement it:

- [ ] **`speak` action** in the engine — when the model decides a screen needs voice input,
      it emits `{kind:'speak', text:'…'}` and the engine shells out to **`autobot speak "<text>"`**
      (which handles the Multi-Output routing + meeting-safe save/restore via the trap). The
      v2 engine inherits all the BlackHole fixes for free.
- [ ] **Prompt additions** — teach the review/drive prompt the voice-flow order above
      (find entry → verify Listening → speak → verify reaction; opt-in).
- [ ] **Push-to-talk** — add a `longPress`/hold capability (mobile_long_press) for hold-to-talk.
- [ ] **Readiness gate** — only `speak` after a listening indicator is detected.
- [ ] **Setup/guard** — require `autobot setup-audio` (or check `autobot doctor`); surface the
      meeting warning; on missing loopback, log the `functional` flaw instead of failing.
- [ ] **Validation** — test against a real clock-sensitive voice app capturing piped audio
      (per bug #2), not just save/restore round-trips.

## Source pointers (v1, reusable)
- `src/lib/audio.sh` — `audio_speak`, `audio_save`/`audio_restore`, `audio_enter_test_mode`/
  `audio_exit_test_mode`, `audio_ensure_multiout`, `audio_meeting_warning`, `audio_status`.
- `src/lib/audio-multiout.swift` — CoreAudio Multi-Output aggregate creator.
- `bin/autobot` — `autobot speak|tts|audio|setup-audio` subcommands.
- `tasks/lessons.md` — the SIGABRT + validation lessons.
