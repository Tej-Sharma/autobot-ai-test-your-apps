# webbot — build plan

## Design-fidelity pass — `webbot design` (2026-06-24)

Compare implemented screens vs their Figma frames; output per-screen annotated screenshot
(numbered boxes over off parts) + text list of `expected → actual` + severity.

- [x] Research: Figma Dev Mode MCP tools (`get_screenshot`/`get_variable_defs`/`get_metadata`,
      node-id addressed, local `127.0.0.1:3845/mcp`) + frontier (OverlayQA/Pixelay overlay vs
      Uiprobe property-precision; naive 2-screenshot diff fails on alignment/subtle drift)
- [x] Decision: source = connected Figma MCP (not computer-use — gives values, not just a pic)
- [x] Decision: hybrid accuracy = match frame viewport (1:1) + anchor to real
      `getBoundingClientRect` boxes + reconcile token values vs computed styles
- [x] Decision: no hand-authored map — auto-pair frames↔screens (name + visual), cache in a
      generated/correctable `design-map.json`; user only points at the Figma file
- [x] Decision: separate pass (not folded into the flow drive) — controlled state + viewport;
      reuses flow reach paths/creds. Per-repo, never global (only the MCP transport is global)
- [x] `browser.sh` — Figma block in MCP config (`with_figma`), `figma_mcp_reachable` for doctor
- [x] `claude.sh` — design paths in run context, `mcp__figma` in allowlist
- [x] `bin/webbot` — `cmd_design`, dispatch, usage, `figma_file` config key, `run_pass` seeds
      `design-diffs.jsonl` + `design/`, doctor Figma line
- [x] `design-prompt.md` — auto-pair → capture both sides → reconcile → annotated report
- [x] `critique-rubric.md` — "Design fidelity" categories; `web/CLAUDE.md` — documented
- [x] Verified: bash syntax, MCP JSON valid both modes, design-mode run context, help/doctor/
      dispatch. Doctor confirms live Figma server reachable.
- [ ] First real run vs an app with a real Figma file (manual — needs Figma desktop + app)


## v1 port from ios-tester (2026-06-11)

- [x] Research current tooling (Playwright MCP v0.0.76, playwright-cli, Chrome DevTools MCP, Stagehand/Skyvern/browser-use patterns)
- [x] Decide state architecture: disk journals over long-context (journal.jsonl + flaws.jsonl + state-graph.json, incremental appends)
- [x] `_shared-rules.md` — journals, screenshot checkpoints (every new URL / state change), stay-on-origin, hard budgets, backtrack-by-URL, console+network per step
- [x] `discover-prompt.md` — exploration + state-graph building + flow proposal
- [x] `run-prompt.md` — drive + critique + report (flaws-first report layout)
- [x] `flow-prompt.md` — custom plan + exploratory phase (unexplored-nodes-first)
- [x] `critique-rubric.md` — web rubric + cross-screen consistency section
- [x] `app-CLAUDE.md` — per-app flow definitions template
- [x] `bin/webbot` — install/init/auth/run/go/flow/doctor dispatcher
- [x] `src/lib/app.sh` — dev-server detect/start/health/stop
- [x] `src/lib/browser.sh` — Playwright MCP config (flags verified against v0.0.76), storage-state capture via codegen
- [x] `src/lib/claude.sh` — run-context composer + claude spawn (budgets, allowlist)
- [x] `src/lib/notify.sh`, `src/lib/install.sh`
- [x] Syntax-check all bash; smoke-test help/dispatch + MCP JSON generation
- [x] `~/.claude/skills/webbot/SKILL.md`
- [x] First real run: `webbot init` vs a deliberately-flawed demo site (Sonnet, $1 cap,
      headless). Caught 10/10 flaws incl. all planted ones + emergent bugs (counter
      not reactive, no persistence); journal/flaws/state-graph all written
      incrementally; flows proposed in `.webbot/CLAUDE.md`. One bug found+fixed:
      screenshots saved to cwd instead of --output-dir (see lessons.md).
- [ ] `webbot wizard` (interactive setup like autobot's) — after first real run proves the core

## Review (what was decided and why)

- **Playwright MCP over `@playwright/cli` for v1**: tool schemas are discovered at
  runtime, so prompts can't reference a wrong command vocabulary. CLI migration is a
  documented v2 token optimization (~4x cheaper per Microsoft's numbers).
- **Flat screenshot filenames** (`<flow>__NN_<slug>.png`): Playwright MCP saves into
  `--output-dir`; nested paths in the filename param are unverified, flat is safe.
- **`--save-trace` doesn't exist** in current playwright-mcp — WEBBOT_TRACE=1 now
  enables `--caps=devtools` (start/stop tracing tools) instead. Verified via --help.
- **flaws.jsonl is the single flaw store** for both drive-time and critique-pass
  findings (critique.jsonl keeps per-screenshot verdicts incl. passes).

## v2 (see CLAUDE.md for detail)

- [ ] Replay cache + `webbot heal` (Skyvern explore→cache→replay pattern)
- [ ] `@playwright/cli` engine
- [ ] Chrome DevTools MCP `--perf` mode
- [ ] Responsive viewport matrix
- [ ] CI on Linux runners
