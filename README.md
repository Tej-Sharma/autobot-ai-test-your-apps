# autobot - automatically test your web + mobile apps

<img width="729" height="442" alt="CleanShot 2026-06-22 at 19 11 38" src="https://github.com/user-attachments/assets/aaf6d643-b548-4bfb-9dec-3877d6bb6e1a" />

Point it at your iOS app or your web app. It drives the simulator or a real
browser like a human tester would — tapping around, filling forms, trying the
things a QA person tries — and comes back with an **HTML report** of every bug
it hit, screenshot attached.

- **Finds real bugs**, not lint warnings: typos, broken flows, dead placeholders, crashes.
- **Never forgets a screen.** A coverage map persists across runs, so it knows what it hasn't tried yet.
- **Grounded, not vibes.** Every flaw and every "flow completed" claim is logged with the exact screenshot that proves it.
- **One brain, two hands.** The same exploration loop drives both platforms — only the "hands" (mobile-mcp vs. Playwright) differ.

## Get started (60 seconds)

**iOS tester (autobot):**
```bash
curl -fsSL https://raw.githubusercontent.com/Tej-Sharma/autobot-ai-test-your-apps/development/install.sh | bash
```

**Web tester (webbot):**
```bash
curl -fsSL https://raw.githubusercontent.com/Tej-Sharma/autobot-ai-test-your-apps/development/web/install.sh | bash
```

Then, in Claude Code:
```
test my ios app using the autobot skill
test my web app using the webbot skill
```

📦 Prefer a hosted, always-on tester instead of running it locally? [Get it here](https://autobot.it.com/)

---

## See it in action

Real output from a run against a fitness-tracker app (planted bugs, used for validation):

```text
$ npm run test-app:mobile

explore: google/gemini-3.5-flash · FitTrack (ai.beemo.fittrack)

step 0  [Welcome/Login Screen]  → tap 'Log In'
   Landed on the FitTrack welcome screen with an email/password form and a Log In CTA.
   flaw F-001 [low content] Spelling mistake in welcome message

step 4  [Home Dashboard]  → tap 'Start Workout'
   ✓ flow FL-001 done: "Start a workout, exercise, finish it, and verify on Home
     Dashboard" (steps 4–8)
   flaw F-002 [medium content] Placeholder 'TODO: load workouts' visible in UI
   flaw F-003 [low copy] Spelling mistake: 'Caloires'

================ EXPLORE SUMMARY ================
steps: 12/40   flaws: 3   screen: Home Dashboard
coverage: 9/14 controls across 6 screens   UNTRIED: Settings (2)
flows completed: "Start a workout, exercise, finish it, and verify on Home Dashboard" (5 steps)
run: v2-engine/mobile/runs/ai.beemo.fittrack/2026-07-07T15-54-59-053Z
================================================
```

Every one of those lines is backed by a saved screenshot and a JSON record on disk —
nothing here is a description written after the fact.

---

## What it does

| Capability | What it means |
|---|---|
| **Single-brain explore loop** | One model call per turn both *judges what just happened* and *picks the next action* — not a separate "planner" and "actor" |
| **Never-pruned memory** | Every prior step (action, expectation, result, reasoning) is fed back into every future turn — no lossy summarization |
| **Coverage map, not vibes** | A deterministic state graph tracks every screen and control seen, so the tester knows what's still untried and won't quit early |
| **Flow tracking** | The model *declares* a completed user journey ("signed up → onboarded → saw dashboard"); code *enforces* the rules (no overlaps, no padding a flow to hit a minimum) |
| **Grounded flaws** | Every bug is logged with severity, a bounding box, and the screenshot that shows it — the HTML report is built directly from this file, nothing is re-summarized |
| **Design QA (gated)** | When a Figma link is configured, screens are matched to design frames and checked against the frame's real element data — never a raw pixel diff |
| **One core, two drivers** | The loop, memory format, and report pipeline are identical for iOS and web; only the platform "hands" differ |

---

## How it works

```
                    ┌─────────────────────────────────────────────┐
                    │        core/explore.mjs  (one brain)         │
                    │                                               │
   memory.jsonl ───▶│  every turn: judge last action + pick next   │◀─── state-graph.json
   (never pruned)   │  1 model call, full screenshot in the prompt │     (coverage map,
                    │                                               │      persists across runs)
                    └───────────────────┬───────────────────────────┘
                                        │ driver contract
                       ┌────────────────┴────────────────┐
                       ▼                                  ▼
              mobile/driver.mjs                    web/driver.mjs
              (mobile-mcp → simulator)        (Playwright MCP → browser)
              tap / type / swipe /            click / type / navigate(url) /
              relaunch app to backtrack        browser back is free
                       │                                  │
                       └────────────────┬─────────────────┘
                                        ▼
                    journal.jsonl · flaws.jsonl · flows.jsonl
                                        │
                                        ▼
                     critique pass → design pass (optional) → report.html
```

Everything platform-specific — how to observe a screen, how to execute a tap vs.
a click, how to recover from a crash, how to backtrack — is isolated behind a
driver contract in `mobile/driver.mjs` / `web/driver.mjs`. The exploration
doctrine, prompts, memory format, and reporting all live once in `core/` and are
shared byte-for-byte between platforms.

## The memory system: everything written to disk as it happens

Nothing relies on long context. Every artifact is appended incrementally — kill
the run mid-way and the record up to the last step is still complete:

- **`journal.jsonl`** — the step trace: screen, action, expectation, result, screenshot ref, crash flag.
- **`memory.jsonl`** — the full reasoning trace fed back into the model every turn (the "never-pruned memory").
- **`flaws.jsonl`** — every bug found, deduped, with severity and the screenshot(s) that prove it. The HTML report is built from this file.
- **`flows.jsonl`** — completed user journeys the model declared and the code validated (no overlapping, no padding to hit a minimum length).
- **`state-graph.json`** — the coverage map, **persisted across runs**: every screen seen, its controls, and which ones were actually tried.

## Platform differences (same core, different hands)

| | iOS (autobot) | Web (webbot) |
|---|---|---|
| Driver | mobile-mcp → iOS Simulator | Playwright MCP → real browser |
| Actions | tap, type, swipe, relaunch, speak | click, type, navigate(url), back |
| Backtracking | relaunch the app + re-walk a screen's saved tap-path (no URLs on iOS) | `navigate(url)` — one call, instant |
| Error signal | crash + visible-error detection (no console/network on native) | crash + console errors + failed network requests |

---

## Prerequisites

**iOS:**
- macOS with Xcode + command-line tools
- An iPhone simulator runtime installed
- Node.js 20+ (mobile-mcp runs via `npx`)
- `claude` CLI (Claude Code) authenticated and on `PATH`

**Web:**
- Node.js 20+ (Playwright MCP runs via `npx`)
- `claude` CLI (Claude Code) authenticated and on `PATH`

## Developing against the engine directly

The exploration engine (what actually powers both testers) is a standalone Node
project — useful if you're iterating on the loop itself rather than going
through the CLI or Claude Code:

```bash
cd v2-engine
npm install
npm run setup:web            # one-time: installs the Chromium build Playwright uses

npm run test-app:mobile      # explore → critique → design → annotate → report, iOS
npm run test-app:web         # same pipeline, web

# or run one stage at a time:
npm run explore:mobile
npm run critique:mobile
npm run report:mobile

npm run parity               # proves core/ + both drivers stay output-identical
```

## Project layout

```
ios-tester/
├── v2-engine/                 ← the shared explore/critique/report engine
│   ├── core/                   explore loop, prompts, schemas, state graph — written once
│   ├── mobile/                 iOS driver (mobile-mcp) + platform files
│   └── web/                    web driver (Playwright MCP) + platform files
├── bin/autobot                ← iOS CLI entry (bash) — installs, boots the sim, invokes Claude Code
├── web/bin/webbot              ← web CLI entry (bash), same shape as bin/autobot
├── src/{lib,templates}         ← simctl/xcodebuild helpers, prompt templates (iOS CLI)
├── web/src/{lib,templates}     ← Playwright MCP plumbing, prompt templates (web CLI)
└── install.sh / web/install.sh ← curl-target installers
```

A run against a target app writes a `runs/<bundle-or-target>/<timestamp>/` folder
containing `journal.jsonl`, `flaws.jsonl`, `flows.jsonl`, `memory.jsonl`,
`state-graph.json`, `screenshots/`, and `report.html` — open the last one.

## Status

v2 engine (`v2-engine/`) is the actively developed core, already validated
against apps with planted bugs. The bash CLIs (`bin/autobot`, `web/bin/webbot`)
are the current install path for Claude Code users; a hosted version is at
[autobot.it.com](https://autobot.it.com/).
