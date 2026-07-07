# Critique pass — evaluate + report

You are the **critique** pass for an iOS app regression run. A separate drive pass has
already finished: it walked the flows, saved screenshots to disk, and wrote the
journals. You are a **fresh process** — you did not drive the app and have no simulator
access. Everything you need is on disk (paths in the run context above).

You have no `mobile-mcp` and no simulator. Work entirely from the saved files:
`journal.jsonl` (the step trace), `flaws.jsonl` (flaws recorded during the drive),
`screenshots/` (the PNG evidence), `.autobot/state-graph.json` (coverage map), and
`.autobot/critique-rubric.md` (the rubric).

Start by reading `.autobot/critique-rubric.md` and the run's `journal.jsonl` so you know
which screenshots this run produced and what each step was trying to do.

## Pass 1 — Critique

Walk every screenshot referenced in this run's `journal.jsonl` and apply the rubric:

- `Read` each PNG from the run's `screenshots/` dir (they're on disk — reading them is
  the whole point of this pass).
- **Per-screenshot verdict** → append one JSON line to `critique.jsonl` (schema in the
  rubric). Every screenshot gets a line, including passes.
- **Every warn/fail finding** → also append a flaw to `flaws.jsonl`. Each flaw line:

  ```json
  {"id":"F-007","ts":"2026-06-16T14:40:00Z","flow":"signup","step":3,"type":"visual","severity":"medium","summary":"Button label is clipped","detail":"The 'Create account' label is truncated to 'Create acc…' at this width.","screen":"Signup","screenshots":["screenshots/signup__03_create-account.png"],"status":"open"}
  ```

  - `type`: `visual` | `content` | `functional` | `crash` | `performance` | `a11y` | `copy`
  - `severity`: `high` | `medium` | `low`
  - `screenshots`: at least one saved screenshot showing the flaw.
  - **Skip flaws already in `flaws.jsonl`** from the drive pass — read the existing
    entries first and don't duplicate. Continue the `id` numbering from the highest
    `F-NNN` already present.

- **Cross-screen consistency check**: after the per-shot pass, compare across
  screenshots — fonts, button styles, spacing rhythm, accent colors, nav-bar presence.
  Inconsistencies between screens are flaws too (one flaw citing multiple screenshots).
- Be calibrated: in a typical app, ~10–30% of screenshots earn warn/fail. If you're
  flagging everything, you're too strict.

## Pass 2 — Report

Generate `report.html` in the run directory (path in run context). A single
self-contained HTML file:

- Header: app name, bundle ID, run timestamp, flows run, pass/warn/fail counts, flaw
  counts by severity
- **Flaws section first** (it's what the user opens the report for): grouped by
  severity, each flaw showing its summary, detail, type badge, flow/step, and its
  screenshot(s) inline (relative `<img src="screenshots/…">` paths — do NOT inline base64)
- Per-flow section: the step timeline from `journal.jsonl` (step, action,
  screen_before→screen_after, verdict, crashed flag) with checkpoint screenshots in a grid
- Drift section: any journaled drift, phrased as suggested edits to `.autobot/CLAUDE.md`
- Coverage footnote: explored vs unexplored nodes in `.autobot/state-graph.json`
- Footer: run command + model

Style: clean minimal CSS, dark mode by default, no external deps.

Update `.autobot/reports/latest` to symlink to this run's directory (exact paths in the
run context).

## Final message

Under 250 words:

- Flows run / completed / stuck (from `journal.jsonl`)
- Top 3–5 high-severity flaws (one line each, with screenshot filename)
- Any crashes observed
- Drift that should be patched into `.autobot/CLAUDE.md`
- Path to `report.html`

Then stop.
