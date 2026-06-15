# webbot — project context

This is a visual-QA service for web apps — the sibling of `../ios-tester` (autobot).
It uses Claude Code (subprocess) + Playwright MCP to drive a browser through key user
flows, screenshot every meaningful state, and critique the screenshots through a UX
rubric. Same philosophy as autobot: the CLI is plumbing, Claude does the thinking.

## Architecture

Two-pass loop per run:

1. **Drive pass** — Claude executes flow goals step-by-step via Playwright MCP
   (a11y snapshots to see, element refs to act). Screenshot checkpoints at every new
   URL and every significant state change.
2. **Critique pass** — every checkpoint screenshot re-evaluated against the rubric;
   findings land in the flaws journal and the per-run HTML report.

The CLI (`bin/webbot`) is a thin bash wrapper that:
- starts the target dev server if needed (or points at a deployed URL)
- writes a temporary `.mcp.json` enabling Playwright MCP (`--isolated`,
  `--storage-state` for auth, `--output-dir` for screenshots)
- invokes `claude --print` with a prompt template + tools allowlist + budget caps
- refreshes the `reports/latest` symlink and opens the report

## The three on-disk journals (the memory system)

The driving agent holds only the current step in context; everything else is
externalized and **appended incrementally during the run** (a crash loses nothing):

| File | Scope | Purpose |
|---|---|---|
| `journal.jsonl` | per-run | step trace: goal, action, url_before/after, screenshot ref, console/network counts, verdict. URLs make any state revisitable with one `browser_navigate` — that's how backtracking works on web. |
| `flaws.jsonl` | per-run | every flaw/error/UX problem, with severity, type, and **screenshot references**. Drive-time flaws and critique-pass flaws share this file; the report is built from it. |
| `state-graph.json` | per-app (persists across runs) | the app map: route nodes with explored/partial/unexplored status, action edges. Exploration prioritizes nearest unexplored nodes (SCALE-paper pattern). |

This was a deliberate decision over relying on long context (even Opus 4.8 @ 1M):
screenshots dominate token spend (~1,600 tokens each vs ~200–800 for an a11y
snapshot), compaction is uncontrollable, and a disk journal survives crashes and lets
critique re-run without re-driving.

## v1 scope (intentional)

- Local Mac only; Chromium via Playwright MCP (`npx @playwright/mcp@latest`)
- One app per target repo; state under `<target>/.webbot/`
- Bash CLI, no compile step
- Discovery is interactive (Claude proposes flows, user confirms in `.webbot/CLAUDE.md`)
- Reports are static HTML in `.webbot/reports/`
- Auth via Playwright storage-state (`webbot auth` opens a headed browser, user logs
  in manually, cookies/localStorage saved and injected into future isolated runs)

## v2 candidates (deferred)

- **`@playwright/cli` + skills as the driving engine** instead of MCP — Microsoft's
  recommended path for coding agents, ~4x fewer tokens/session, named persistent
  sessions. v1 uses MCP because tool schemas are discovered at runtime (no command
  vocabulary to get wrong). Migrate once the prompts are stable.
- **Replay cache (Skyvern/Stagehand pattern)**: persist resolved action sequences from
  a green run keyed by DOM hash; replays run deterministic + cheap, heal from journaled
  *intent* on mismatch. `webbot heal` becomes a first-class subcommand.
- **Chrome DevTools MCP as `--perf` mode**: Lighthouse, performance traces,
  source-mapped console stacks.
- **Responsive matrix**: re-run critique checkpoints at mobile/tablet viewports.
- **CI (GitHub Actions)**: Linux runners are cheap for web (unlike the iOS tester's
  macOS requirement). Headless + `ANTHROPIC_API_KEY` auth + report as artifact + PR
  comment.
- Multi-browser (WebKit/Firefox), comparison mode vs main-branch baseline.

## Key files

- `bin/webbot` — CLI entry, subcommand dispatcher
- `src/lib/app.sh` — dev-server detect/start/health/stop
- `src/lib/browser.sh` — Playwright MCP config, storage-state capture, chromium install
- `src/lib/claude.sh` — prompt composition (+ run context) and `claude --print` spawn
- `src/templates/_shared-rules.md` — global rules: journals, screenshot checkpoints,
  stay-on-origin, hard budgets, backtrack-by-URL
- `src/templates/discover-prompt.md` — first-run exploration + state-graph building
- `src/templates/run-prompt.md` — drive + critique + report
- `src/templates/flow-prompt.md` — user-authored test plan + exploratory phase
- `src/templates/critique-rubric.md` — UX checklist (copied per-app, user-extendable)
- `src/templates/app-CLAUDE.md` — shape of the per-app flow definitions file

## Conventions

- Bash with `set -euo pipefail`; macOS bash 3.2 compatible (no readlink -f, no mapfile)
- All paths absolute when crossing process boundaries
- Screenshots: flat filenames `<flow-slug>__NN_<action-slug>.png` (Playwright MCP
  saves into `--output-dir`; journals reference `screenshots/<filename>`)
- Flow definitions: prose paragraphs in the target's `.webbot/CLAUDE.md` — not YAML,
  because Claude reads natural language better than it parses structured DSLs
- Journals: JSONL, append-only, written the moment something happens — never batched
- Critique rubric: editable markdown — users extend it per-app

## What Claude should NOT do here

- Don't replace bash plumbing with Node/TypeScript unless we hit a real limit. v1 stays thin.
- Don't add unit tests for the CLI shims yet — verify by running against a real app instead.
- Don't invent a YAML flow DSL. Natural-language flow goals are the point.
- Don't pixel-diff screenshots. LLM-as-judge, not regression.
- Don't weaken the journaling discipline in `_shared-rules.md` — incremental writes
  are the crash-safety and backtracking story.
