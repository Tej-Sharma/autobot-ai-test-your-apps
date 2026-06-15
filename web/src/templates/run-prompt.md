# Run pass — drive + critique

You are running the regression pass for a web app. The browser is configured, the app
is reachable at the base URL in the run context, and you have `playwright` MCP tools.

The global rules above (journals, screenshot checkpoints, stay-on-origin, no-loop,
quit-when-done, error handling) apply throughout.

The persisted flow definitions live at `.webbot/CLAUDE.md`. The critique rubric lives
at `.webbot/critique-rubric.md`. The app map lives at `.webbot/state-graph.json`.
Read all three before starting.

## Pass 1 — Drive

For each flow in `.webbot/CLAUDE.md`:

1. Reset to the flow's preconditions. Prefer direct navigation: the state graph and
   previous journals tell you which URL embodies the precondition. Log out / clear
   app state only when the flow demands it.
2. Execute the steps. Interpret natural-language steps charitably; wording need not
   match exactly. If the UI has drifted from what's described, take the closest
   sensible path and journal the drift (`notes` field) — drift gets surfaced in the
   report so the flow file can be patched.
3. Apply the screenshot-checkpoint rule: a shot at every new URL and every
   significant state change, saved as `<flow-slug>__NN_<action-slug>.png`,
   journaled in `journal.jsonl`.
4. Check console + network after each step; journal counts, record flaws for real
   errors (per the global rule).
5. Keep `state-graph.json` current: new routes, new edges, status upgrades.

Do not deep-critique visuals while driving — quick triage only (obvious breakage →
flaw now). The systematic visual pass comes next.

## Pass 2 — Critique

Once all flows are driven, walk every screenshot referenced in this run's
`journal.jsonl` and apply `.webbot/critique-rubric.md`:

- `Read` each PNG (this is the one place reading images is required — they're on disk).
- **Per-screenshot verdict** → append one JSON line to `critique.jsonl`
  (schema in the rubric). Every screenshot gets a line, including passes.
- **Every warn/fail finding** → also append a flaw to `flaws.jsonl`
  (type `visual`/`content`/`copy`/`a11y`, with the screenshot reference). Skip flaws
  already recorded during the drive — check existing entries first, don't duplicate.
- **Cross-screen consistency check**: after the per-shot pass, compare across
  screenshots — fonts, button styles, spacing rhythm, accent colors, header/nav
  presence. Inconsistencies between screens are flaws too (one flaw entry citing
  multiple screenshots).
- Be calibrated: in a typical app, ~10–30% of screenshots earn warn/fail. If you're
  flagging everything, you're too strict.

## Pass 3 — Report

Generate `report.html` in the run directory. A single self-contained HTML file:

- Header: app name, base URL, run timestamp, flows run, pass/warn/fail counts,
  flaw counts by severity
- **Flaws section first** (it's what the user opens the report for): grouped by
  severity, each flaw showing its summary, detail, type badge, flow/step, and its
  screenshot(s) inline (relative `<img>` paths — do NOT inline base64)
- Per-flow section: step timeline from `journal.jsonl` (step, action, URL, verdict,
  console/network counts) with checkpoint screenshots in a grid
- Drift section: any journaled drift, phrased as suggested edits to `.webbot/CLAUDE.md`
- Coverage footnote: explored vs unexplored nodes in the state graph
- Footer: run command + model

Style: clean minimal CSS, dark mode by default, no external deps.

Update `reports/latest` to symlink to this run's directory (the run context gives the
exact paths).

## Final message

Under 250 words:

- Flows run / completed / stuck
- Top 3–5 high-severity flaws (one line each, with screenshot filename)
- Console/network errors worth fixing
- Drift that should be patched into `.webbot/CLAUDE.md`
- Path to `report.html`

Then stop.
