# Run pass — drive

You are running the regression pass for an iOS app. The simulator is booted, the app is
installed and launched, and you have `mobile-mcp` tools available.

This is the **drive** pass only. A separate critique pass runs afterward in a fresh
process — it reads the screenshots you save to disk and writes the report. Your job is
to walk the flows, capture evidence, and journal everything. **Do not** write
`report.html` or do the systematic visual critique here.

The global rules above (WDA startup, journals, screenshot checkpoints, state-graph
coverage map, crash/error detection, stay-in-app, no-loop, quit-when-done, error
handling) apply throughout.

Read these before starting — their paths are in the run context below:
- `.autobot/CLAUDE.md` — the persisted flow definitions
- `.autobot/state-graph.json` — the screen-coverage map from prior runs (use it to
  reach preconditions and to know what's already mapped)

## Drive

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
flaw now). The systematic visual pass runs separately, after you finish.

## Final message

Under 200 words:

- Flows run / completed / stuck
- Any crashes observed
- Drift that should be patched into `.autobot/CLAUDE.md`
- A reminder that the critique pass + report are generated separately next

Then stop. Do not generate `report.html` — the critique pass does that.
