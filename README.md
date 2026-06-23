# autobot - automatically test your web + mobile apps

<img width="729" height="442" alt="CleanShot 2026-06-22 at 19 11 38" src="https://github.com/user-attachments/assets/aaf6d643-b548-4bfb-9dec-3877d6bb6e1a" />


Visually sees and clicks through your web + ios apps using your existing Claude Code.
Comes with smart memory and state tracking to mimic a smart QA tester stress testing your product to find bugs for you before you push to production.

Just plug it in your existing Claude Code, and AutoBot has a memory system + testing flows understanding of your app to test through it.


## Installation

**iOS tester (autobot)** — run in a terminal:
```
curl -fsSL https://raw.githubusercontent.com/Tej-Sharma/autobot-ios-tester/development/install.sh | bash
```

**Web tester (webbot)** — run in a terminal:
```
curl -fsSL https://raw.githubusercontent.com/Tej-Sharma/autobot-ios-tester/development/web/install.sh | bash
```

Then open Claude Code and give it the location of your projects:
- `test my ios app using the autobot skill`
- `test my web app using the webbot skill`

## Test Your Products before Merging PRs, Pushing to Production, or In Production

A cloud-hosted tester that is routinely fully testing your web and mobile apps to ensure none of your users are hitting bugs that will hurt your company's reputation.

📦 [Get It Here](https://autobot.it.com/)

## Status

v1 prototype. Single-machine, simulator-only, one app per project directory.

## How it works

Two passes per run:

1. **Drive** — Claude executes each flow step-by-step via mobile-mcp, journaling every step and screenshotting every new screen and significant state change.
2. **Critique** — Each saved screenshot is re-fed to Claude with a UX rubric, plus a cross-screen consistency check (fonts/colors/components drifting between screens). Issues become flaws; clean shots get a green check.

The split matters: driving is expensive and stateful; critique is cheap, stateless, and re-runnable with a different rubric without re-driving.

## The memory system: journals + a coverage map, written as the run happens

autobot deliberately does **not** rely on long context. Everything is externalized to
disk, incrementally — kill the run at any point and the record is complete up to the
last step. (This is the same journal-based system the sibling [webbot](web/) uses,
adapted for iOS.)

- **`journal.jsonl`** — the step trace: goal, action, screen before/after, screenshot
  ref, a `crashed` flag, and a verdict. One line per step, appended as it happens.
- **`flaws.jsonl`** — the flaws/errors journal: every visual flaw, broken behavior,
  crash, or stuck state, with severity and **references to the saved screenshots that
  show it**. This is what the HTML report is built from.
- **`state-graph.json`** — the app map (persists across runs): named screen nodes
  marked explored/partial/unexplored, with a recognizable *signature* and a *reach*
  tap-path each, plus action edges. Discovery and the exploratory pass always know
  what they haven't seen yet.

### The drive loop — every step writes to disk before moving on

Each numbered step runs the same tight loop. Memory is appended *as the step finishes*,
not batched at the end — so a killed or crashed run still has a complete record:

```
                         ┌──────────────────── one step ────────────────────┐
                         │                                                   │
   ┌─────────────┐       │  ① SEE          ② ACT        ③ CHECKPOINT         │
   │ state-graph │◀──────┤  list_elements   tap /        save_screenshot     │
   │   .json     │ reach  │  (a11y tree) ──▶ type /  ──▶  <flow>__NN_*.png    │
   │ (the map)   │ path   │  + screenshot    swipe       in screenshots/      │
   └─────────────┘       │                                     │             │
         ▲                │                                     ▼             │
         │ new screen?    │  ⑤ JOURNAL              ④ CRASH / ERROR CHECK     │
         │ add node +     │  append 1 line   ◀────  app on springboard?       │
         └─ edge ─────────┤  to journal.jsonl       error banner? stuck       │
                          │         │               spinner? (no console/net  │
                          │         │                on iOS — eyes only)       │
                          │         ▼                       │                  │
                          │   ┌──────────────┐              │ flaw?            │
                          │   │ journal.jsonl │             ▼                  │
                          │   └──────────────┘     ┌──────────────┐           │
                          │                         │  flaws.jsonl │           │
                          └─────────────────────────└──────┬───────┘──────────┘
                                                           │ screenshot refs
                                                           ▼
                                            critique pass → report.html
```

### Backtracking — relaunch and re-walk, because iOS has no URLs

This is the one place the web approach **doesn't** port. On the web (webbot) every
screen has a URL, so returning to a prior state is a single `navigate` call and
console/network errors are free evidence after every step. iOS has neither — so autobot
adapts:

```
   web (webbot):   browser_navigate("/settings")        ← one call, instant
   ───────────────────────────────────────────────────────────────────────
   iOS (autobot):  mobile_launch_app(bundleId)          ← relaunch …
                       │
                       ▼   then re-walk the node's stored `reach` path:
                   "launch → tap Settings tab → tap Account"
                       │         │                 │
                       ▼         ▼                 ▼
                    [Home] ──▶ [Settings] ──▶ [Account]   ← back where you were
```

- **Backtracking** = relaunch the app and re-walk a screen's stored `reach` path (or a
  known `myapp://` deep-link scheme via `mobile_open_url` if one exists). The state
  graph stores that path as the re-walk recipe — backtrack deliberately, it isn't free.
- **Error detection** = crash + visible-error detection (app fell back to the home
  screen, an error alert/banner, a spinner that never resolves), since mobile-mcp
  exposes no console or network trace for a native app.

## Supported app inputs

| Input | Status |
|---|---|
| Xcode project (`.xcodeproj`) | ✅ v1 |
| Xcode workspace (`.xcworkspace`) | ✅ v1 |
| Pre-built `.app` bundle (simulator slice) | ✅ v1 |
| `.ipa` (real device) | v2 |
| TestFlight build | v2 |

Simulator-only in v1. Real device support is v2.

## Requirements

- macOS with Xcode + command-line tools
- Node.js 20+ (mobile-mcp runs via `npx`)
- `claude` CLI (Claude Code) authenticated and on `PATH`
- An iPhone simulator runtime installed

## Quick start

```bash
# Discover flows for a target app
./bin/autobot init /path/to/MyApp.xcodeproj

# After discovery, autobot writes:
#   ./.autobot/CLAUDE.md             ← discovered flows + critique rubric
#   ./.autobot/reports/<timestamp>/  ← discovery screenshots

# Re-run flows on the current build (e.g. after a PR)
./bin/autobot run

# Open the report
open ./.autobot/reports/latest/report.html
```

## Project layout

```
ios-tester/
├── bin/autobot              ← iOS CLI entry (bash)
├── src/
│   ├── lib/                  ← simctl, xcodebuild, claude spawn helpers
│   └── templates/            ← prompt + config templates
├── tasks/                    ← todo.md, lessons.md
├── examples/                 ← sample .autobot/ outputs
├── install.sh               ← iOS tester installer (curl target)
└── web/                     ← webbot: the web-app tester (self-contained)
    ├── bin/webbot            ← web CLI entry (bash)
    ├── src/{lib,templates}   ← Playwright MCP plumbing + prompts
    └── install.sh            ← web tester installer (separate curl target)
```

In a target app's repo, `autobot init` creates:

```
<target-repo>/
└── .autobot/
    ├── CLAUDE.md             ← discovered flows (prose, editable — the source of truth)
    ├── critique-rubric.md    ← UX rubric (extend it per-app)
    ├── .mcp.json             ← mobile-mcp config
    ├── config.json           ← app path, build settings, sim device
    ├── state-graph.json      ← screen-coverage map, persists across runs
    └── reports/
        └── 2026-05-27-1430/
            ├── journal.jsonl     ← step trace
            ├── flaws.jsonl       ← every flaw, with screenshot refs
            ├── critique.jsonl    ← per-screenshot verdicts
            ├── screenshots/      ← <flow>__NN_<action>.png
            └── report.html       ← open this
```

## CI (v2 plan)

Local-first for now. CI plan documented in `CLAUDE.md` (GitHub Actions on `macos-14` runner with Xcode 16 + iOS Simulator).
