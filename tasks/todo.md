# autobot — v1 todo

## v1 — done

- [x] Scaffold project structure (`bin/`, `src/lib/`, `src/templates/`, `tasks/`)
- [x] Write README + project CLAUDE.md
- [x] `src/lib/sim.sh` — simctl wrappers (ensure/boot/install/launch/screenshot)
- [x] `src/lib/build.sh` — xcodebuild wrappers
- [x] `src/lib/claude.sh` — spawn `claude --print` with mobile-mcp config
- [x] `src/templates/critique-rubric.md` — UX rubric
- [x] `src/templates/discover-prompt.md` — first-time discovery system prompt
- [x] `src/templates/run-prompt.md` — drive + critique + report system prompt
- [x] `src/templates/app-CLAUDE.md` — template for target's `.autobot/CLAUDE.md`
- [x] `bin/autobot` CLI with `init`, `run`, `doctor`

## v1 — next (smoke test the CLI end-to-end)

- [ ] Pick a guinea-pig iOS app (open-source preferred — e.g. Wikipedia iOS, ProtonMail iOS, or a minimal SwiftUI sample app)
- [ ] Run `autobot doctor` — fix any missing deps
- [ ] Run `autobot init <app>` and watch Claude explore
- [ ] Inspect `.autobot/CLAUDE.md` — does the discovery output look useful?
- [ ] Refine the discovery prompt based on first-run output
- [ ] Run `autobot run` and inspect `report.html`
- [ ] Refine the run prompt + rubric based on first-run output

## v1 — known gaps (acceptable for v1)

- No flow drift auto-healing — drift is just logged, not fixed
- No parallel flow execution — flows run serially
- Critique re-reads every PNG; could batch
- No CI integration — local-only
- mobile-mcp installed lazily via `npx -y`; first run is slow

## v2 — candidates

- [ ] GitHub Actions on macos-14 runner (notes in `CLAUDE.md`)
- [ ] `.ipa` + real device support (provisioning, install via `ideviceinstaller` or `xcrun devicectl`)
- [ ] `autobot heal` subcommand — propose flow CLAUDE.md edits when UI drifts
- [ ] Baseline comparison (`autobot run --vs main`)
- [ ] Parallel flows (one sim per flow)
- [ ] Slack/PR-comment integration

## Review

After first smoke-test run, fill in:
- What worked
- What surprised us
- What to change before showing the client
