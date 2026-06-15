# webbot — build plan

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
