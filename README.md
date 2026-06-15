# autobot - find bugs in your IOS App + test it for you

Visual-first iOS QA driven by Claude Code + mobile-mcp.

Point it at an iOS app, it discovers the key flows, runs them on the simulator, screenshots every step, and produces an HTML report that flags anything a common-sense user would side-eye (truncated text, misaligned elements, ugly empty states, confusing copy, broken layouts).

This repo ships **two testers** that share the same philosophy (the CLI is plumbing; Claude does the thinking), each with its own one-line installer:

| Tester | Tests | Drives via | Lives in | CLI |
|---|---|---|---|---|
| **autobot** | iOS apps | mobile-mcp → iOS Simulator | repo root | `autobot` |
| **webbot** | web apps | Playwright MCP → Chromium | [`web/`](web/) | `webbot` |

## Installation

**iOS tester (autobot)** — run in a terminal:
```
curl -fsSL https://raw.githubusercontent.com/Tej-Sharma/autobot-ios-tester/development/install.sh | bash
```

**Web tester (webbot)** — run in a terminal:
```
curl -fsSL https://raw.githubusercontent.com/Tej-Sharma/autobot-ios-tester/development/web/install.sh | bash
```

The two installers are independent — install either or both. autobot clones into `~/.autobot`; webbot clones into `~/.webbot` and runs out of this repo's `web/` subfolder. See [`web/README.md`](web/README.md) for webbot details.

Then open Claude Code:
- `test my ios app using the autobot skill`
- `test my web app using the webbot skill`

## Status

v1 prototype. Single-machine, simulator-only, one app per project directory.

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│  autobot init <app>     ← discover flows, save to CLAUDE.md │
│  autobot run            ← re-run flows, produce HTML report │
│  autobot heal           ← repair flow when UI drifts        │
└──────────────────────────────────────────────────────────────┘
            │
            ▼
   Claude Code (subprocess)
            │
            │ MCP
            ▼
      mobile-mcp ──→ iOS Simulator (simctl)
```

Two passes per run:

1. **Drive** — Claude executes each flow step-by-step via mobile-mcp, taking a screenshot after every action.
2. **Critique** — Each screenshot is re-fed to Claude with a UX rubric. Issues get annotated. Clean shots get a green check.

The split matters: driving is expensive and stateful; critique is cheap, stateless, and parallelizable. Re-run critique with a different rubric without re-driving.

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
    ├── CLAUDE.md             ← persisted flows + rubric (the source of truth)
    ├── .mcp.json             ← mobile-mcp config
    ├── config.json           ← app path, build settings, sim device
    └── reports/
        └── 2026-05-27-1430/  ← per-run screenshots + report.html
```

## CI (v2 plan)

Local-first for now. CI plan documented in `CLAUDE.md` (GitHub Actions on `macos-14` runner with Xcode 16 + iOS Simulator).
