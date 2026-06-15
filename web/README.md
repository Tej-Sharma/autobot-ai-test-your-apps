# webbot — find bugs in your web app + test it for you

Visual-first web QA driven by Claude Code + Playwright MCP. The sibling of
[autobot](../ios-tester) (iOS), built on the same principles.

Point it at a web app (a URL or a local project), it discovers the key flows, drives
them in a real browser like a first-time user, screenshots **every new URL and every
significant state change**, checks the console and network after every step, and
produces an HTML report of every flaw it found — each one referencing the exact
screenshot that shows it.

## How it works

```
┌────────────────────────────────────────────────────────────────┐
│  webbot init <app>     ← discover flows + app map               │
│  webbot auth           ← capture login state (one-time, manual) │
│  webbot run            ← re-run flows, produce HTML report      │
│  webbot flow <file.md> ← run a custom natural-language plan     │
└────────────────────────────────────────────────────────────────┘
            │
            ▼
   Claude Code (subprocess)
            │ MCP
            ▼
   Playwright MCP ──→ Chromium
```

Two passes per run:

1. **Drive** — Claude executes each flow step-by-step (a11y snapshots to see, element
   refs to act), journaling every step and screenshotting every checkpoint.
2. **Critique** — every screenshot re-fed to Claude with a UX rubric, plus a
   cross-screen consistency check (fonts/colors/components drifting between pages).

The split matters: driving is expensive and stateful; critique is cheap, stateless,
and re-runnable without re-driving.

## The memory system: three journals, written as the run happens

webbot deliberately does **not** rely on long context. Everything is externalized to
disk, incrementally — kill the run at any point and the record is complete up to the
last step:

- **`journal.jsonl`** — the step trace: goal, action, URL before/after, screenshot
  ref, console-error and failed-request counts, verdict. Because every state has a
  URL, *backtracking is one `navigate` call* — no re-walking click paths.
- **`flaws.jsonl`** — the flaws/errors journal: every visual flaw, broken behavior,
  console error, or failed request, with severity and **references to the saved
  screenshots that show it**. This is what the report is built from.
- **`state-graph.json`** — the app map (persists across runs): route nodes marked
  explored/partial/unexplored, action edges between them. Exploration always knows
  what it hasn't seen yet.

## Quick start

```bash
# one-time
./bin/webbot install

# point it at your app (deployed URL, running dev server, or project dir)
cd ~/code/my-app
webbot init http://localhost:3000     # discovers flows → .webbot/CLAUDE.md
webbot auth                           # only if the app needs login
webbot run                            # drive + critique + report

open .webbot/reports/latest/report.html
```

Or run a custom plan:

```bash
cat > smoke.md <<'EOF'
1. Sign up with a fresh email
2. Create a project called "Q3 launch"
3. Invite teammate@example.com
4. Verify the project appears on the dashboard
EOF
webbot flow smoke.md
```

## What lands in `.webbot/`

```
<target-repo>/.webbot/
├── CLAUDE.md              ← discovered flows (prose, editable — the source of truth)
├── config.json            ← app URL, dev command, storage-state path
├── critique-rubric.md     ← UX rubric (extend it per-app)
├── state-graph.json       ← app map, persists across runs
├── storage-state.json     ← captured auth (gitignore this)
└── reports/
    └── 2026-06-11-143205/
        ├── journal.jsonl      ← step trace
        ├── flaws.jsonl        ← every flaw, with screenshot refs
        ├── critique.jsonl     ← per-screenshot verdicts
        ├── screenshots/       ← <flow>__NN_<action>.png
        └── report.html        ← open this
```

## Requirements

- macOS (Linux should mostly work; untested), Node.js 20+
- `claude` CLI (Claude Code) authenticated and on `PATH`

## Env knobs

| Var | Default | |
|---|---|---|
| `WEBBOT_CLAUDE_MODEL` | `claude-opus-4-8` | agent model |
| `WEBBOT_HEADLESS` | unset (headed) | `1` = headless browser |
| `WEBBOT_APP_URL` | `http://localhost:3000` | where a local project serves |
| `WEBBOT_TIMEOUT_SECONDS` | `900` | wall-clock kill |
| `WEBBOT_MAX_BUDGET_USD` | `3` | agent spend cap |
| `WEBBOT_TRACE` | unset | `1` = enable Playwright tracing tools |

## Status

v1 prototype. Single machine, Chromium only, one app per project directory.
