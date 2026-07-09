# autobot — project context

This is a visual-QA service for iOS apps. It uses Codex (subprocess) + mobile-mcp to drive an iOS simulator, screenshot every step of key user flows, then critique the screenshots through a UX rubric.

## Architecture

Two-pass loop:

1. **Drive pass** — Codex executes flow goals step-by-step via mobile-mcp. Screenshots every action.
2. **Critique pass** — Each screenshot is re-evaluated with a UX rubric. Issues flagged in a per-run HTML report.

The CLI (`bin/autobot`) is a thin bash wrapper that:
- builds + installs the target app
- boots the simulator
- writes a temporary `.mcp.json` enabling mobile-mcp
- invokes `Codex --print` with a prompt template + tools allowlist
- collects screenshots + writes the HTML report

Codex does the actual thinking. The CLI is plumbing.

## v1 scope (intentional)

- Local Mac only, simulator only
- One app per target repo (no multi-tenant)
- Bash CLI, no compile step
- Discovery is interactive (Codex proposes flows, user confirms in AGENTS.md)
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
  - Steps: checkout → cache DerivedData → `xcrun simctl boot` → `npm i -g mobile-mcp` → `Codex` login via secret → `autobot run` → upload `report.html` as artifact → post PR comment with summary
  - Gotcha: `Codex` auth in CI needs API key auth (`ANTHROPIC_API_KEY`), not OAuth
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
- `src/lib/Codex.sh` — spawn `Codex --print` with right MCP + prompt
- `src/templates/discover-prompt.md` — system prompt for discovery pass
- `src/templates/run-prompt.md` — system prompt for run+critique pass
- `src/templates/critique-rubric.md` — UX checklist used by critique pass
- `src/templates/app-AGENTS.md` — template written into `<target>/.autobot/AGENTS.md` after discovery

## v2 (`v2-engine/`) — ONE engine tree, explore is the default brain

**`v2-engine/` is the canonical v2 engine** — shared core + platform drivers:

- `v2-engine/core/` — everything platform-independent, written ONCE: the explore
  loop (`runExplore(driver, cfg)`), the exploration doctrine + prompt skeletons
  (`prompts.mjs` — platform text is injected as slots), the schema builders,
  generic state-graph ops, and the critique/annotate passes.
- `v2-engine/mobile/`, `v2-engine/web/` — the "hands": each has `driver.mjs`
  (observe/execute/recover against mobile-mcp or Playwright MCP), `prompts.mjs`
  (slot fills only), `schema.mjs` (action vocabulary + flaw types), platform
  stategraph identity/controls, plus verbatim platform files (mcp.mjs,
  interactions.mjs, report.mjs, rubric.md). Same entrypoint names in both:
  `explore.mjs` / `critique.mjs` / `annotate.mjs` / `report.mjs` — so the desktop
  app selects an engine purely by `engineDir(platform)` → `v2-engine/<platform>`.
- CLI: `cd v2-engine && npm run test-app:mobile` / `npm run test-app:web`.
- `v2-engine/parity/check.mjs` (`npm run parity`) proves output-equivalence with
  the frozen pre-split engines: byte-identical prompts across a fixture grid,
  structurally identical TURN/FLAW schemas, identical renderers/stategraph.
  Run it after ANY edit to core/prompts.mjs or the platform slot text.
- The old `v2-mobile-tester/engine/` and `v2-web-tester/engine/` dirs are FROZEN
  reference copies (they are untracked, so they're also the only backup of the
  pre-split code) — don't develop in them; edit `v2-engine/` instead.

The v2 engine has two drive brains. **Always use `explore.mjs` — for everything**:
the CLI, the desktop app, and any new surface.
`alternate-dfs-app-traversal.mjs` (formerly `drive.mjs`; deterministic frontier/DFS
walk, model only judges — still `drive.mjs` on the web side) is legacy — keep it
working but don't wire it into anything new.

`explore.mjs` is the single-brain LLM explorer: one model call per turn that judges
the previous action's outcome AND picks the next action, with the full never-pruned
memory trace (`memory.jsonl`) fed back each turn. It's what implements the intended
testing behavior: core features first, the mandatory settings↔features retest rule,
goal tracking (`goalsSoFar`/`goalsCompleted`/`areasRemaining`), and backtracking with
full memory of everything done. The web driver differs where the platform does:
ref-based clicks, `navigate(url)` as a first-class action, browser back, and
per-step console/network error signals.

Pipeline stays: explore → critique → annotate → report. Explore writes the same run
artifacts as drive (journal/flaws/screenshots) plus `memory.jsonl`, so all downstream
stages work unchanged.

## The journal-based memory system

The drive agent does **not** rely on long context — every bit of run state is
externalized to disk incrementally, so a killed run still has a complete record up to
its last step. Three artifacts (ported from the sibling `web/` tester, adapted for iOS):

- `reports/<run>/journal.jsonl` — the step trace: goal, action, `screen_before`/
  `screen_after`, screenshot ref, `crashed` flag, verdict. One line per step.
- `reports/<run>/flaws.jsonl` — every flaw/crash/error with severity and **references
  to the saved screenshots that show it**. The HTML report is built from this file.
- `.autobot/state-graph.json` — the screen-coverage map, **persisted across runs**:
  named screen nodes (with a recognizable `signature` + a `reach` tap-path) marked
  explored/partial/unexplored, plus action edges. Discovery and the exploratory pass
  use it to know what they haven't seen yet.

iOS-specific adaptation vs. the web tester: web screens are URL-addressable, so
backtracking there is one `navigate` call. iOS screens are not — backtracking is
`mobile_launch_app` + re-walking a node's `reach` path (or a known deep-link URL
scheme). And mobile-mcp exposes no console/network, so the web's per-step
console/network check becomes **crash + visible-error detection**. The CLI seeds these
files per run via `claude_seed_run_dir` and points the agent at them via
`claude_run_context_paths` (both in `src/lib/Codex.sh`).

## docs/ — separate repo, auto-committed

`docs/` is **gitignored by this repo** and is its own standalone git repository,
pointed at `https://github.com/Constella-OS/autobot-docs.git` (private). It holds
design notes and decision trees (e.g. `figma-visual-difference.md`), not product code.

**On every change to anything under `docs/`, commit and push it to its own origin on
`main`** — don't leave it uncommitted:

```bash
cd docs && git add -A && git commit -m "<what changed>" && git push origin main
```

This is the docs repo's remote, not the autobot repo's. The parent repo never tracks
`docs/`.

## Conventions

- Bash with `set -euo pipefail`
- All paths absolute when crossing process boundaries
- Screenshots: PNG, saved flat in the run's `screenshots/` dir as `<flow-slug>__NN_<action-slug>.png`; referenced in journals as `screenshots/<name>`
- Flow definitions: prose paragraphs inside the target's `.autobot/AGENTS.md` — not YAML, because Codex reads natural language better than it parses structured DSLs
- Critique rubric: editable markdown — users can extend it per-app
- Journals: append-only JSONL, written as the run happens (never batched at the end)

## Releasing the desktop app (`v2-mobile-tester/app`)

- Bump `version` in `v2-mobile-tester/app/package.json`, then
  `cd v2-mobile-tester/app && source env_vars.sh && npm run release`
  (build → sign → notarize → publish to S3 `aicc-bucket/autobot/publish`).
- **The landing page download link auto-increments on every release.** `npm run release`
  runs `scripts/sync-landing-download-url.mjs` as its final step, which rewrites
  `autobot-landing-page/lib/constants.ts` `DOWNLOAD_URL` to the version just published
  (`Autobot-<version>-arm64.dmg`). Keep this wired — if you change the release command,
  preserve that step so the site never points at a stale build. The landing page is a
  separate repo, so after releasing, commit+push it:
  `cd ../autobot-landing-page && git add lib/constants.ts && git commit -m "release: Autobot <version>" && git push`.
- **Before every release, audit the actual built bundle** (`ls dist/mac-arm64/Autobot.app/Contents/Resources/engine/*/inputs` should be empty/absent; `find … -name '*.env'`; `Resources/engine/parity` must be absent). Dev fixtures with real credentials have leaked into the dmg before — never write app state into `Resources/` (use `app.getPath('userData')` via `engineDataDir()`).

## What Codex should NOT do here

- Don't replace bash plumbing with Node/TypeScript unless we hit a real limit. v1 stays thin.
- Don't add unit tests for the CLI shims yet — verify by running against a real app instead.
- Don't invent a YAML flow DSL. Natural-language flow goals are the point.
- Don't pixel-diff screenshots. We do LLM-as-judge, not regression.
