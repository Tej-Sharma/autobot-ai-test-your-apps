# Run pass — drive + critique

You are running the regression pass for an iOS app. The simulator is booted, the app is
installed and launched, and you have `mobile-mcp` tools available.

The global rules above (WDA startup, journals, screenshot checkpoints, state-graph
coverage map, crash/error detection, stay-in-app, no-loop, quit-when-done, error
handling) apply throughout.

Read these before starting — their paths are in the run context below:
- `.autobot/CLAUDE.md` — the persisted flow definitions
- `.autobot/critique-rubric.md` — the critique rubric
- `.autobot/state-graph.json` — the screen-coverage map from prior runs (use it to
  reach preconditions and to know what's already mapped)

## Pass 1 — Drive

For each flow in `.autobot/CLAUDE.md`:

1. Reset to the flow's preconditions. Per the backtracking rule, that means
   relaunching (`mobile_launch_app`) and walking the shortest known `reach` path from
   the state graph — not a magic jump. Log out / clear state only when the flow
   demands it.
2. Execute the steps. Interpret natural-language steps charitably; wording need not
   match exactly. If the UI has drifted from what's described, take the closest
   sensible path and journal the drift in the step's `notes` — drift gets surfaced in
   the report so the flow file can be patched.
3. Apply the screenshot-checkpoint rule: a saved shot at every new screen and every
   significant state change, named `<flow-slug>__NN_<action-slug>.png` in the run's
   `screenshots/` dir, with a matching `journal.jsonl` line.
4. Run crash/visible-error detection after each step; set `crashed` in the journal
   line and record flaws for real errors (per the global rule).
5. Keep `.autobot/state-graph.json` current: new screens become nodes (with a
   `signature` and `reach` path), new transitions become edges, statuses upgrade as
   you explore.

Do not deep-critique visuals while driving — quick triage only (obvious breakage →
flaw now). The systematic visual pass comes next.

## Pass 2 — Critique

Once all flows are driven, walk every screenshot referenced in this run's
`journal.jsonl` and apply `.autobot/critique-rubric.md`:

- `Read` each PNG (this is the one place reading images is required — they're on disk).
- **Per-screenshot verdict** → append one JSON line to `critique.jsonl` (schema in the
  rubric). Every screenshot gets a line, including passes.
- **Every warn/fail finding** → also append a flaw to `flaws.jsonl` (with the
  screenshot reference). Skip flaws already recorded during the drive — check existing
  entries first, don't duplicate.
- **Cross-screen consistency check**: after the per-shot pass, compare across
  screenshots — fonts, button styles, spacing rhythm, accent colors, nav-bar presence.
  Inconsistencies between screens are flaws too (one flaw citing multiple screenshots).
- Be calibrated: in a typical app, ~10–30% of screenshots earn warn/fail. If you're
  flagging everything, you're too strict.

## Pass 3 — Report

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

- Flows run / completed / stuck
- Top 3–5 high-severity flaws (one line each, with screenshot filename)
- Any crashes observed
- Drift that should be patched into `.autobot/CLAUDE.md`
- Path to `report.html`

Then stop.
