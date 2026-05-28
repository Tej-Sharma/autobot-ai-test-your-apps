# autobot — project context

This is a visual-QA service for iOS apps. It uses Claude Code (subprocess) + mobile-mcp to drive an iOS simulator, screenshot every step of key user flows, then critique the screenshots through a UX rubric.

## Architecture

Two-pass loop:

1. **Drive pass** — Claude executes flow goals step-by-step via mobile-mcp. Screenshots every action.
2. **Critique pass** — Each screenshot is re-evaluated with a UX rubric. Issues flagged in a per-run HTML report.

The CLI (`bin/autobot`) is a thin bash wrapper that:
- builds + installs the target app
- boots the simulator
- writes a temporary `.mcp.json` enabling mobile-mcp
- invokes `claude --print` with a prompt template + tools allowlist
- collects screenshots + writes the HTML report

Claude does the actual thinking. The CLI is plumbing.

## v1 scope (intentional)

- Local Mac only, simulator only
- One app per target repo (no multi-tenant)
- Bash CLI, no compile step
- Discovery is interactive (Claude proposes flows, user confirms in CLAUDE.md)
- Reports are static HTML in `.autobot/reports/`

## Audio input (feeding the simulator's mic)

iOS Simulator uses the host Mac's default audio input as the device microphone. To pipe synthesized audio into the simulator, we route playback through a virtual audio device that's also the system input:

1. Install BlackHole: `brew install blackhole-2ch`
2. Audio MIDI Setup app → create a Multi-Output Device that includes BlackHole 2ch + your real output (so you can still hear playback while testing).
3. System Settings → Sound → **Output**: the Multi-Output Device.
4. System Settings → Sound → **Input**: BlackHole 2ch.

Verify with `autobot doctor` (the audio line should report a loopback device).

Then any flow step can use:
- `autobot speak "phrase"` — TTS + play in one shot
- `autobot tts "phrase" out.aiff` — TTS to a file (e.g. archive in the run report)

`autobot speak` works without BlackHole — but the simulator won't hear it; it'll just play through your speakers.

For higher-quality voices: macOS Settings → Accessibility → Spoken Content → System Voice → download a "Premium" / "Enhanced" voice (e.g. "Ava (Premium)"), then `autobot tts "..." with AUTOBOT_TTS_VOICE=Ava`.

## v2 candidates (deferred)

- **Flutter project support**: detect `pubspec.yaml` at the input path → build via `flutter build ios --simulator --debug` → install the `.app` produced under `build/ios/iphonesimulator/Runner.app`. Smoke-test target Constella lives at `/Users/tejas1/Documents/Constella Codebases/mobile` (Flutter, bundle `ai.beemo.constella`, `CFBundleExecutable = Runner`). Flutter apps expose a thin iOS a11y tree — mobile-mcp's Visual Sense will be exercised heavily. Note this for the critique pass: a11y tree calls may return little, fall back to screenshots.
- **GitHub Actions macOS runner**: `macos-14` or `macos-15` images come with Xcode and iOS simulators preinstalled. Sketch:
  - Trigger: `pull_request` on relevant paths
  - Steps: checkout → cache DerivedData → `xcrun simctl boot` → `npm i -g mobile-mcp` → `claude` login via secret → `autobot run` → upload `report.html` as artifact → post PR comment with summary
  - Gotcha: `claude` auth in CI needs API key auth (`ANTHROPIC_API_KEY`), not OAuth
  - Gotcha: mobile-mcp requires `appium` for some platforms — pin versions in `package.json` to avoid runner drift
  - Cost: macOS runners are ~10x Linux. Expect 3-5 min/run; gate on `paths:` filter
- Real-device support (`.ipa` install, code-signing)
- Flow drift auto-healing (when a button rename breaks the flow, propose the fix)
- Parallel flow execution (one sim per flow, fan out)
- Comparison mode: diff a PR run vs the main-branch baseline

## Key files

- `bin/autobot` — CLI entry, subcommand dispatcher
- `src/lib/sim.sh` — `simctl` wrappers (boot, install, launch, shutdown)
- `src/lib/build.sh` — `xcodebuild` for `.xcodeproj` / `.xcworkspace`
- `src/lib/claude.sh` — spawn `claude --print` with right MCP + prompt
- `src/templates/discover-prompt.md` — system prompt for discovery pass
- `src/templates/run-prompt.md` — system prompt for run+critique pass
- `src/templates/critique-rubric.md` — UX checklist used by critique pass
- `src/templates/app-CLAUDE.md` — template written into `<target>/.autobot/CLAUDE.md` after discovery

## Conventions

- Bash with `set -euo pipefail`
- All paths absolute when crossing process boundaries
- Screenshots: PNG, named `NN_<action-slug>.png` in flow-specific dirs
- Flow definitions: prose paragraphs inside the target's `.autobot/CLAUDE.md` — not YAML, because Claude reads natural language better than it parses structured DSLs
- Critique rubric: editable markdown — users can extend it per-app

## What Claude should NOT do here

- Don't replace bash plumbing with Node/TypeScript unless we hit a real limit. v1 stays thin.
- Don't add unit tests for the CLI shims yet — verify by running against a real app instead.
- Don't invent a YAML flow DSL. Natural-language flow goals are the point.
- Don't pixel-diff screenshots. We do LLM-as-judge, not regression.
