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

## Packaging: electron-builder silently drops root node_modules from extraResources (2026-07-02)

**What happened:** shipped 0.1.1; production app crashed at run start with
`ERR_MODULE_NOT_FOUND: 'ai'` from `Resources/engine-mobile/explore.mjs`. The engines'
`node_modules` never made it into the bundle even though the extraResources filter was
`'**/*'` — electron-builder's `createFilter()` (app-builder-lib `util/filter.js`)
hard-rejects the root `node_modules` of any copied tree; positive filter patterns cannot
override it.

**Fix:** give each engine's `node_modules` its own extraResources entry
(`from: ../engine/node_modules → to: engine-mobile/node_modules`) so it becomes the copy
root and escapes the check.

**Rules:**
- "Notarized + boots" is not "works": the smoke test must exercise the app's real job
  (here: starting a run, which spawns the bundled engine), not just launch/quit.
- After changing what ships in a bundle, diff the bundle contents against the source tree
  (`ls Resources/<dir>`), don't trust the packager's silent success.

## Packaged app must not depend on the developer machine's toolchain (2026-07-03)

**What happened:** 0.1.5 in production failed at run start with `spawn npx ENOENT` — both
engines launched their MCP servers via `npx -y <pkg>@latest`. Dock-launched apps get a bare
PATH (no homebrew/nvm), and end users may not have node/npx at all.

**Fix:** MCP servers are now real engine dependencies (ship inside the bundled
node_modules) spawned with `process.execPath` — the same Electron-bundled node the engine
runs on. Two traps inside the fix itself:
- The MCP SDK's StdioClientTransport strips the child env to an allowlist that drops
  `ELECTRON_RUN_AS_NODE` — without passing `env: { ...process.env }`, process.execPath
  boots a second Electron APP, not node.
- Engine subprocess PATH is now hardened in runner.js (prepends /opt/homebrew/bin etc.)
  for residual shell-outs.

**Rule:** audit every spawn/exec in code that ships inside the .app: no npx, no @latest
downloads at runtime, no bare command names that assume a terminal PATH. If it runs on the
user's machine, it must resolve from inside the bundle or /usr/bin.

**Known residual:** @playwright/mcp still needs Chromium in ~/Library/Caches/ms-playwright
on first web run — needs a first-run `playwright install chromium` flow for fresh machines.

## Never write app state inside the signed .app; never ship dev fixtures (2026-07-03 audit)

Two whole-app audit findings, both "works on my machine, breaks/leaks for users":

1. **Writable state inside the bundle.** runs/ and inputs/ resolved off engineDir() =
   Resources/engine-* (inside the signed .app). That (a) fails under macOS App
   Translocation (quarantined download runs from a read-only mount), (b) is wiped on
   every auto-update (electron-updater swaps the whole .app), (c) breaks the code
   signature. Fix: engineDataDir() → app.getPath('userData') when packaged; engines read
   config via an INPUTS_DIR env override instead of join(HERE,'inputs'). Rule: the ONLY
   writable per-user location for a packaged Electron app is userData — never Resources.

2. **Dev fixtures shipped in the dmg.** engine/inputs/*.json (the developer's test-app
   configs) carried a REAL username+password for a production service and shipped in every
   public dmg (0.1.3–0.1.6). extraResources filtered runs/.state/logs but not inputs/.
   Fix: exclude inputs/. Rule: audit the actual built bundle
   (`ls Resources/.../inputs`, `find -name '*.env'`) before every release — filters that
   look complete often miss one dir, and secrets in fixtures ship silently.

Process rule: after the second production "dev-machine assumption" bug, STOP and run a
full app audit (parallel reviewers over main / engines+CLI / packaging) instead of
fixing one report at a time — they come in clusters.

## Shell strings built from model output WILL break on quoting (2026-07-07)

The v2 mobile driver typed text via `execSync("osascript -e '...keystroke \"${esc}\"'")`.
The AppleScript escaping was right; the SHELL single-quoting wasn't — the first
model-authored string containing an apostrophe ("next week's launch") terminated the
quote, execSync threw, and the whole explore run died. Model output goes through these
paths constantly; an apostrophe is not an edge case, it's Tuesday.

Rules:
1. NEVER build a shell command string around model/user text. Use
   execFileSync(cmd, [args]) — no shell, no quoting layer at all. Escape only for the
   innermost language (here: AppleScript's `\` and `"`, plus newline → `\n`).
2. Typing/interaction failures inside a driver must WARN and continue, not throw — the
   explore loop treats the world as observable; the model sees the empty field and
   adapts. Only failures that make the run meaningless (app won't launch) should throw.
3. MCP tool errors are `isError` RESULTS, not rejections — a `.catch()` around
   `callTool` catches nothing. Check `res.isError` explicitly wherever a tool failure
   must change behavior (launch verification), and expect scary-but-harmless stderr
   traces from the server process for the rest (route expected-failure calls like
   pre-launch terminate around MCP entirely: `simctl` + try/catch).

## Outreach drafts: keep subject lines per-contact and product-specific (2026-07-08)

When preparing LinkedIn/InMail drafts from QA findings, derive the subject from the
recipient's company/product, not from a generic campaign string. Use the exact requested
format (`Found bug on {company}!`) and verify the subject before filling the body, because
LinkedIn draft UIs can preserve partially filled state across tab switches.
