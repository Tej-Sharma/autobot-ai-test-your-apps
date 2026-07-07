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

## Design-fidelity pass (`webbot design`)

A third pass, alongside drive + UX-critique, that compares each implemented screen against
its **Figma frame** and reports where the build drifts from the design — per screen, an
annotated implementation screenshot with **numbered boxes over the off parts** plus a
text list mapping each number to `expected → actual` + severity.

- **Source = the connected Figma MCP, not computer-use.** Wired into the run's `.mcp.json`
  as a `figma` http server (the Figma desktop Dev Mode server at `127.0.0.1:3845/mcp` by
  default; override with `WEBBOT_FIGMA_MCP_URL`). It gives the rendered frame
  (`get_screenshot`), exact tokens (`get_variable_defs`: hex/spacing/type), and layer
  geometry (`get_metadata`: x/y/w/h) — so the comparison cites real values, not eyeballs.
- **No hand-authored mapping.** The pass auto-pairs Figma frames to discovered screens by
  name + visual match (using `state-graph.json`), then caches the result in a generated,
  user-correctable `.webbot/design-map.json`. The user only points at the Figma file
  (`webbot design <figma-link>`, or the `figma_file` config key, or the open desktop
  selection).
- **Accuracy method = hybrid.** Capture the implementation at the frame's exact viewport
  (1:1 alignment), anchor every finding to a real element box
  (`getBoundingClientRect`), and reconcile **values** (Figma tokens vs live computed
  styles) — not a picture-vs-picture diff (which misaligns and misses subtle drift).
- **Per-repo, never global.** Only the Figma MCP *transport* is machine-level; the
  `figma_file` binding, the `design-map.json` pairing, and the per-run diffs all live under
  the target's `.webbot/`, exactly like `state-graph.json` and the flows.

Prerequisite: the Figma desktop app open with its Dev Mode MCP server enabled
(Shift-D → "Enable desktop MCP server"), or a reachable `WEBBOT_FIGMA_MCP_URL`.
`webbot doctor` reports reachability (informational — only this pass needs it).

New artifacts: `.webbot/design-map.json` (per-app, generated pairing) and, per run,
`reports/<run>/design-diffs.jsonl` + `design/*.png` (Figma renders) +
`design-report.html`. The design pass is driven by `src/templates/design-prompt.md`; the
deviation categories live in the "Design fidelity" section of `critique-rubric.md`.

## v1 scope (intentional)

- Local Mac only; Chromium via Playwright MCP (`npx @playwright/mcp@latest`)
- One app per target repo; state under `<target>/.webbot/`
- Bash CLI, no compile step
- Discovery is interactive (Claude proposes flows, user confirms in `.webbot/CLAUDE.md`)
- Reports are static HTML in `.webbot/reports/`
- Auth, two ways:
  - **Stored test credentials** (default): `webbot init` prompts for a list of logins
    + tester preferences (or seed via `WEBBOT_CRED_EMAIL`/`WEBBOT_CRED_PASSWORD`/
    `WEBBOT_PREFS`); `webbot creds [add|list|clear]` manages them. They persist in
    `.webbot/config.json` and are injected into every run's context (`config_auth_block`
    in `src/lib/setup.sh` → `claude_write_run_context`). The driving agent types them
    into the app's own login form, so discovery can map the gated product too.
  - **Storage-state** (`webbot auth`): opens a headed browser, user logs in manually,
    cookies/localStorage saved and injected into future isolated runs.

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
- `src/lib/setup.sh` — interactive prompts (tty, autobot-wizard idiom) + persistent
  credential list / tester preferences in config.json + `config_auth_block` for the
  run context
- `src/templates/_shared-rules.md` — global rules: journals, screenshot checkpoints,
  stay-on-origin, hard budgets, backtrack-by-URL
- `src/templates/discover-prompt.md` — first-run exploration + state-graph building
- `src/templates/run-prompt.md` — drive + critique + report
- `src/templates/flow-prompt.md` — user-authored test plan + exploratory phase
- `src/templates/design-prompt.md` — design-fidelity pass: auto-pair, capture both sides,
  reconcile values, annotated `design-report.html`
- `src/templates/critique-rubric.md` — UX checklist + "Design fidelity" categories
  (copied per-app, user-extendable)
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
- Persistent vs per-run state: config, credentials, preferences, and `state-graph.json`
  persist in `.webbot/` across runs; journals + report are per-run under
  `.webbot/reports/<run-id>/` so each run starts a fresh trace
- The driving agent (per `_shared-rules.md`) auto-answers onboarding/setup/preference
  screens (best per stored preferences, else a sensible default — never stalls) and
  fills inputs with realistic, app-appropriate sample data; tester preferences from
  config steer persona/choices/data style

## What Claude should NOT do here

- Don't replace bash plumbing with Node/TypeScript unless we hit a real limit. v1 stays thin.
- Don't add unit tests for the CLI shims yet — verify by running against a real app instead.
- Don't invent a YAML flow DSL. Natural-language flow goals are the point.
- Don't pixel-diff screenshots. LLM-as-judge, not regression.
- Don't weaken the journaling discipline in `_shared-rules.md` — incremental writes
  are the crash-safety and backtracking story.
