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
   curl -fsSL https://raw.githubusercontent.com/Tej-Sharma/autobot-ai-test-your-apps/development/web/install.sh | bash
   ```
   (or `~/.webbot/web/bin/webbot install` if already cloned, or `./web/bin/webbot install`
   from a checkout). Wait for it, then continue.

2. If the current directory has `.webbot/config.json` → run `webbot run` to re-test
   (or `webbot flow <file.md>` if the user described a specific new flow — write
   their steps to a markdown file first, numbered, in natural language).

3. Otherwise → ask the user for:
   - **The app**: a URL (deployed or already-running dev server) OR a local project
     path (webbot auto-starts `npm run dev` etc.)
   - **Login needs**: if the app requires auth, get **test credentials** (email +
     password). `webbot init` prompts for these (and tester preferences) interactively
     when run in a terminal and stores them in `.webbot/config.json` (a list — multiple
     logins allowed) for reuse by every run. When you (the model) spawn webbot
     non-interactively, pass them instead via env on the init/run command:
     `WEBBOT_CRED_EMAIL`, `WEBBOT_CRED_PASSWORD` (optional `WEBBOT_CRED_LABEL`,
     `WEBBOT_PREFS`), or add them after init with `webbot creds add`. The driving agent
     types these into the app's own login form — so discovery can map the gated product
     too. (`webbot auth` is the alternative: a manual browser login captured as
     storage-state.)
   - **Tester preferences** (optional): persona, choices to make on onboarding/
     preference screens, sample-data style, areas to focus/avoid. Stored alongside
     credentials and honored every run. Pass via `WEBBOT_PREFS` when non-interactive.
   - **The core flows to test** (optional): 3–7 user flows in natural language —
     or let `webbot init` discover them

   Then run `webbot init <url-or-path>` (prefix the env vars above if you have creds).

## After running

- Read the summary webbot prints (flows run, flaw counts).
- The report is at `.webbot/reports/latest/report.html` — webbot auto-opens it.
- For specifics, the journals are machine-readable:
  - `.webbot/reports/latest/flaws.jsonl` — every flaw with severity + screenshot refs
  - `.webbot/reports/latest/journal.jsonl` — the full step trace
- Surface the top high-severity flaws to the user (one line each, with the
  screenshot filename so they can look).

## Persisting user feedback (do this every time)

The session is ephemeral — nothing said here carries to the next `webbot run`. The
durable memory is the target app's `.webbot/`. So whenever the user points anything out —
a flaw to watch for, a new flow, "do this / don't do that," a preference, a correction —
**persist it automatically. Do NOT ask for confirmation.**

Memory is per-app, keyed by the app's own directory: each project has its OWN `.webbot/`.
ALWAYS run webbot from the app's repo root; if Claude Code was launched elsewhere, `cd`
into the app dir first (or pass `--work-dir <dir>`). Never run an app from a shared/
transient folder ($HOME, scratch) — apps would collide on one `.webbot/`. For a deployed
URL with no local source, pick ONE stable folder and always return to it.

Route the feedback:
- a flow / steps / ordering → `## Critical flows` in `.webbot/CLAUDE.md` (or a flow file)
- a judging rule ("flag X", "ignore Y", brand color, tone) → `## App-specific rubric extensions`
- a quirk to expect/ignore → `## Known gotchas`
- a login / test account → `webbot creds add` (stored in `.webbot/config.json`, NOT CLAUDE.md)
- a tester preference (persona, choices, focus areas) → `webbot creds add` (preferences field)

After saving, note in one line what you stored and where, then carry on. (This mirrors
the run pass, which already writes drift back to `.webbot/CLAUDE.md`.)

## Voice / audio testing (macOS)

If a flow involves voice input (mic, dictation, speech, `getUserMedia`, audio recording):
1. Ensure BlackHole is installed: `webbot doctor` reports whether voice testing is ready;
   if not, run `webbot setup-audio` once (installs BlackHole + switchaudio-osx).
2. Do NOT switch audio devices yourself. When a flow mentions voice, webbot automatically
   routes the host mic to BlackHole for the run, grants the browser mic permission, and
   restores the user's normal mic/output afterward (even on crash/timeout), warning if a
   meeting app is running.
3. Inside flow steps, audio is triggered via Bash: `webbot speak "the phrase"`.
4. If the user says their mic is stuck after a run, `webbot audio status` shows current
   routing and `webbot audio restore` reverts it.

## Notes for the model

- The CLI does all the actual driving; do NOT drive the browser yourself with
  claude-in-chrome or other browser tools from this conversation. Spawn webbot and
  let its internal Claude subprocess do it (tighter scoping, budget caps, journals).
- Outputs live in `.webbot/` next to the user's working directory — treat it as the
  source of truth. Persistent local state (config, credentials, preferences,
  state-graph) lives there and is reused across runs; the per-run journals + report
  live under `.webbot/reports/<run-id>/` so every run gets a fresh trace.
- **Credentials + preferences are stored locally and injected into every run's
  context** automatically — you don't paste them into prompts or flow files. Manage
  them with `webbot creds [list|add|clear]`. The agent types credentials into the
  app's own forms.
- The driving agent **auto-answers onboarding/setup/preference screens** (best option
  per the stored preferences, else a sensible default — never stalls) and **fills
  inputs with realistic, app-appropriate sample data** so features are genuinely
  exercised. These behaviors are baked into the run prompts; no per-run instruction
  needed.
- Budget defaults: 15min wall-clock kill, $3 spend cap, 80 scripted + 30 exploration
  tool calls per flow.
- `WEBBOT_HEADLESS=1` for headless; default is a visible browser window.
- The flaws journal and step journal are written incrementally — even a killed run
  has a complete record up to its last step.
