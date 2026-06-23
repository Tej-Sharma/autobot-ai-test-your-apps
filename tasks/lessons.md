# Lessons

Captured after corrections from the user, or after a non-obvious choice that paid off.

## Conventions

- **Natural-language flows beat YAML DSLs** — Claude reads "tap continue, enter email, tap next" better than it parses a structured DSL with selectors. Keep flow definitions as prose in `.autobot/CLAUDE.md`.
- **Two-pass driving + critique** — driving is stateful and expensive; critique is stateless and cheap. Keep them separate so we can re-critique without re-driving.
- **No pixel diffs** — we are doing LLM-as-judge, not regression. Pixel diffs would only catch deltas vs a baseline; we want first-principles UX judgement.

## v1 architectural choices

- **Bash CLI, not Node** — orchestration is thin enough that Node would be overkill. Revisit if we need streaming UI or richer state.
- **One `.mcp.json` per target repo** — written into `.autobot/`, not the user's global Claude config. Keeps targets isolated.
- **`claude --print` with stream-json output** — gives us a usable transcript without embedding the SDK. Switch to `@anthropic-ai/claude-agent-sdk` if we need finer event control (e.g. parallel flows).

## Flutter apps must be installed as standalone builds, not `flutter run`-attached

**Symptom**: `mobile_launch_app` re-launches the target bundle and gets a black screen, then iOS sends the user back to the home screen. mobile-mcp loops trying to recover.

**Cause**: `flutter run` produces a debug build that depends on the Dart VM daemon staying attached. When mobile-mcp/simctl re-launches the bundle, the binary starts but never receives the Dart entrypoint, so it renders blank. iOS then deprioritizes it and returns to the springboard.

**Fix**: build a self-contained simulator binary first:
```bash
cd <flutter-project-root>
flutter build ios --simulator --debug
xcrun simctl install <udid> build/ios/iphonesimulator/Runner.app
```
Then `mobile_launch_app` (or `simctl launch`) works without daemon dependency.

**v2 implication**: when `build.sh` adds Flutter support, it must use `flutter build ios --simulator`, not assume the user is running `flutter run`.

## Stay-in-app guardrail required when home screen has neighbor apps

**Symptom**: Claude exited the target app and tapped on a neighboring app icon (e.g. "Device Kit"), then explored the wrong app.

**Cause**: When `mobile_launch_app` fails (see Flutter lesson above), the simulator falls back to home screen. The springboard's `list_elements_on_screen` returns all app icons indiscriminately, and Claude has no built-in concept of "stay inside the target."

**Fix**: The discovery and run prompts both contain an explicit "Stay inside the target app — CRITICAL" section: verify foreground before every tap, never tap on app icons, recover via `mobile_launch_app` with the run-context bundle ID. Do not weaken this.

**Why this can't be solved by mobile-mcp alone**: mobile-mcp is bundle-agnostic. The scoping is the prompt's job.

<!-- Add lessons here as the project evolves -->

## Audio: never route the Simulator's default OUTPUT to BlackHole alone (2026-06-23)

**Symptom**: a clock-sensitive voice app (VPIO / `.voiceChat` / real-time interpretation, e.g. CIR) hard-crashes with SIGABRT on the iOS Simulator: `mainMixerNode → AURemoteIO::Cleanup → _ReportRPCTimeout → abort()`.

**Cause**: BlackHole is a clockless virtual driver. When it's the *sole* default output, the Simulator's output `AURemoteIO` has no hardware clock and its start/cleanup RPC times out → abort. Setting `SwitchAudioSource -t output -s "BlackHole 2ch"` triggers it. (Input = BlackHole is fine; only OUTPUT-alone is the trap, and only for apps that bring up an output/duplex AURemoteIO.)

**Fix**: route output through a STACKED Multi-Output aggregate whose clock master is a REAL device + BlackHole (drift-corrected), created via CoreAudio `AudioHardwareCreateAggregateDevice` (see `src/lib/audio-multiout.swift`). Never BlackHole alone.

**Process lesson (why we shipped the bug)**: the audio rework was "validated" only with device save/restore round-trips — never an actual voice flow against a real clock-sensitive app + Simulator. Plumbing tests pass while the real failure mode (the app crashing) goes untested. **When changing audio/device/system routing, the validation must reproduce the actual end-to-end scenario (a voice app capturing piped audio without crashing), not just confirm the shell wiring.** A clean save/restore round-trip is necessary but nowhere near sufficient.
