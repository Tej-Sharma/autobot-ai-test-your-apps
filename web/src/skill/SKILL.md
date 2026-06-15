---
name: webbot
description: |
  Run autonomous visual UI tests on a web app via a real browser. Use this skill
  when the user asks to "test my web app", "run browser QA", "find visual bugs on
  my site", "auto-test my Next.js/React/Vue app", or describes a multi-step user
  flow they want validated end-to-end (signup, onboarding, checkout, etc).
  Drives Chromium via Playwright MCP, screenshots every new URL and significant
  state change, journals every step and flaw to disk, and produces an HTML report
  where every flaw references the screenshot that shows it.
---

# webbot — web visual QA via Claude Code

When the user asks for visual/UI testing of a web app, run webbot.

## Decide which subcommand

1. If `webbot` is not on PATH (`command -v webbot` fails) → tell the user to run:
   ```
   curl -fsSL https://raw.githubusercontent.com/Tej-Sharma/autobot-ios-tester/development/web/install.sh | bash
   ```
   (or `~/.webbot/web/bin/webbot install` if already cloned, or `./web/bin/webbot install`
   from a checkout). Wait for it, then continue.

2. If the current directory has `.webbot/config.json` → run `webbot run` to re-test
   (or `webbot flow <file.md>` if the user described a specific new flow — write
   their steps to a markdown file first, numbered, in natural language).

3. Otherwise → ask the user for:
   - **The app**: a URL (deployed or already-running dev server) OR a local project
     path (webbot auto-starts `npm run dev` etc.)
   - **Login needs**: if the app requires auth, run `webbot auth` after init — a
     browser opens, the user logs in manually, state is saved for all future runs
   - **The core flows to test** (optional): 3–7 user flows in natural language —
     or let `webbot init` discover them

   Then run `webbot init <url-or-path>`.

## After running

- Read the summary webbot prints (flows run, flaw counts).
- The report is at `.webbot/reports/latest/report.html` — webbot auto-opens it.
- For specifics, the journals are machine-readable:
  - `.webbot/reports/latest/flaws.jsonl` — every flaw with severity + screenshot refs
  - `.webbot/reports/latest/journal.jsonl` — the full step trace
- Surface the top high-severity flaws to the user (one line each, with the
  screenshot filename so they can look).

## Notes for the model

- The CLI does all the actual driving; do NOT drive the browser yourself with
  claude-in-chrome or other browser tools from this conversation. Spawn webbot and
  let its internal Claude subprocess do it (tighter scoping, budget caps, journals).
- Outputs live in `.webbot/` next to the user's working directory — treat it as the
  source of truth.
- Budget defaults: 15min wall-clock kill, $3 spend cap, 80 scripted + 30 exploration
  tool calls per flow.
- `WEBBOT_HEADLESS=1` for headless; default is a visible browser window.
- The flaws journal and step journal are written incrementally — even a killed run
  has a complete record up to its last step.
