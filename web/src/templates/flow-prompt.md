# Custom flow pass

You are executing a user-authored test plan against a web app. The browser is
configured, the app is reachable at the base URL in the run context, and you have
`playwright` MCP tools.

The global rules above (journals, screenshot checkpoints, stay-on-origin, no-loop,
quit-when-done, error handling) apply throughout. Re-read them before starting and
any time you notice yourself doing something repetitive.

## Your job

1. **Read the test plan** at the path provided in the run context (`flowFile`).
2. **Execute each step in order.** Interpret natural-language steps loosely — wording
   need not match exactly. If a step says "open settings from the avatar menu", find
   the closest plausible avatar/profile control.
3. **Journal every step** in `journal.jsonl` and apply the screenshot-checkpoint rule
   (every new URL, every significant state change), filenames
   `<flow-slug>__NN_<action-slug>.png`. A step with substeps (fill three fields,
   submit) gets ONE checkpoint at its end state.
4. **Check console + network after each step**; record flaws with screenshot
   references the moment you notice them (per the global rules).
5. **Keep `.webbot/state-graph.json` current** if you reach routes it doesn't know.

## State that may persist across runs

If the test plan involves an incrementing counter (e.g. unique signup emails per
run), read and update the counter file specified in the run context. Increment by 1
after a successful step that consumed the value.

## Phase 2 — exploratory pass (after the scripted flow is done)

Once every numbered step is journaled (pass/fail/skipped), **do NOT re-run the
scripted flow** — signup/login/checkout especially; the user has seen those.

Instead, spend up to **30 tool calls** on what the scripted flow didn't cover:

- Consult `.webbot/state-graph.json` and visit the nearest `unexplored` nodes first
- Edge cases in surfaces you already touched: empty states, long inputs, rapid
  double-clicks on submit, browser back/forward through the flow you just ran (a
  classic SPA breaker), refresh mid-state
- Anything that looked off during the drive but wasn't worth stopping for

Rules: screenshot filenames `_exploration__NN_<area>.png`, journaled as flow
`"_exploration"`. Stay on origin. Keep per-area cost low — snapshot, decide, move on.
When ideas or budget run out, stop.

## Pass 3 — Critique + report

Same as a full run:

1. Walk this run's screenshots, apply `.webbot/critique-rubric.md`, append verdicts
   to `critique.jsonl`, append warn/fail findings to `flaws.jsonl` (no duplicates of
   drive-time flaws). Include the cross-screen consistency check.
2. Generate `report.html` (self-contained, dark mode, no external deps, relative
   `<img>` paths): flaws-by-severity first with inline screenshots, then the
   step-by-step timeline with verdicts and console/network counts, then exploration
   findings, footer with base URL + model.
3. Update the `reports/latest` symlink.

## Final message

Under 250 words:

- Step-by-step pass/fail summary for the scripted flow (one line each)
- Areas covered in the exploratory pass
- Top flaws found (combined, with screenshot filenames)
- Path to `report.html`

Then stop. Do not run further passes. Do not "double-check" by re-running scripted
steps.
