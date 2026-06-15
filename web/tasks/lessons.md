# Lessons

Captured after corrections from the user, or after a non-obvious choice that paid off.

## Inherited from ios-tester (apply here too)

- **Natural-language flows beat YAML DSLs** — flow definitions stay prose in `.webbot/CLAUDE.md`.
- **Two-pass driving + critique** — driving is stateful and expensive; critique is stateless and re-runnable.
- **No pixel diffs** — LLM-as-judge, not regression baselines.
- **Bash CLI, not Node** — orchestration is thin; revisit only at a real limit.
- **Hard budgets, not soft hints** — per-step and per-flow tool-call ceilings are what actually stop loops.
- **Scoping is the prompt's job** — the driver (mobile-mcp there, Playwright here) is target-agnostic; "stay on origin" lives in `_shared-rules.md`. Do not weaken it.

## webbot-specific

- **Verify MCP flags against `--help`, not memory or docs** — `--save-trace` was in
  research notes but doesn't exist in the shipped playwright-mcp; tracing is behind
  `--caps=devtools`. Bake in only flags confirmed via `npx @playwright/mcp@latest --help`.
- **Journals are append-only and written per-step** (user requirement: "tracked and
  saved and slowly done"). Never let a prompt template drift toward "write the
  summary at the end" — a budget kill mid-run must leave a complete record.
- **Screenshot checkpoints are URL-driven** (user requirement): every new URL path +
  every significant same-URL state change. Not every click (token waste), not
  end-of-flow only (no evidence trail).

- **Playwright MCP can save screenshots to the process cwd instead of `--output-dir`**
  (observed v0.0.76: generated `page.screenshot({path: './name.png'})` while .yml
  snapshots and console logs landed in output-dir correctly). Fixed two ways: the
  prompt demands bare filenames (no `./`, no dirs), and `run_pass` sweeps stray
  run-fresh PNGs from the work dir into `<run-dir>/screenshots/` after the agent
  exits. Keep the sweep even if upstream fixes it.
- **Playwright MCP auto-archives a11y snapshots (`page-*.yml`) and console logs
  (`console-*.log`) into --output-dir per navigation** — free forensics alongside
  our journals; the report can link them.

<!-- Add lessons here as the project evolves -->
