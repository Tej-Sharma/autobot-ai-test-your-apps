# Run pass — drive + critique

You are running the regression pass for an iOS app. The simulator is booted, the app is installed and launched, and you have `mobile-mcp` tools available.

The global rules above (speed, stay-in-app, no-loop, quit-when-done, error handling) apply throughout.

The persisted flow definitions live at `.autobot/CLAUDE.md`. The critique rubric lives at `.autobot/critique-rubric.md`. Read both before starting.

## Pass 1 — Drive

For each flow in `.autobot/CLAUDE.md`:

1. Reset the app to the flow's preconditions (relaunch via `mobile_launch_app`, clear state, log out — whatever is needed).
2. Execute the steps via mobile-mcp. Interpret natural-language steps; you do not need to match wording exactly. If the UI has drifted from what's described, take the closest sensible path and note the drift in `drift.md`.
3. After each meaningful state change, save a screenshot with `mobile_save_screenshot` to `.autobot/reports/<run-id>/<flow-slug>/NN_<action-slug>.png` (zero-padded counter).
4. After the flow ends (success or stuck), write a short `summary.md` in the flow folder.

Do not critique while driving.

## Pass 2 — Critique

Once all flows have been driven, walk through every screenshot under `.autobot/reports/<run-id>/` and apply the rubric in `.autobot/critique-rubric.md`.

- Read each PNG with the Read tool (this is the one place re-reading is necessary — the originals are already on disk).
- Output one JSON object per screenshot to `.autobot/reports/<run-id>/critique.jsonl` (one line per screenshot, JSONL).
- Use the schema described in the rubric.
- Be calibrated. Aim for ~10–30% of screenshots having warn/fail verdicts in a typical app. If you're flagging everything, you're too strict.

## Pass 3 — Report

Generate `.autobot/reports/<run-id>/report.html`. A single self-contained HTML file:

- Header: app name, run timestamp, pass/warn/fail counts
- Per-flow section with screenshot grid (relative `<img>` paths to local PNGs — do NOT inline base64)
- Each card: filename, verdict badge (green/yellow/red), issue list
- Drift section: any flow drift
- Footer: run command + model

Style: clean minimal CSS, dark mode by default, no external deps.

Update `.autobot/reports/latest` to symlink to this run's directory.

## Final message

Under 250 words:
- Total flows run / completed / stuck
- Top 3–5 fail-severity issues
- Drift that should be patched into `.autobot/CLAUDE.md`
- Path to `report.html`

Then stop.
