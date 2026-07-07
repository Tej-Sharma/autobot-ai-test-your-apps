# v2 drive engine — design

Production drive engine: Gemini 3.5 Flash on a custom Vercel AI SDK loop, driving
mobile-mcp, with the journal-based memory system + **fork/backtrack exploration**.

> **CURRENT STATE (deferred backtracking):** `alternate-dfs-app-traversal.mjs` (the
> legacy drive pass, formerly `drive.mjs`) runs a **linear forward
> explorer** — it walks the app step by step (using mock credentials from
> `inputs/<bundle>.json` to pass login gates), exercising untried features and journaling
> everything. No frontier / no relaunch-to-backtrack yet. The DFS + backtrack frontier
> described below is the planned upgrade once linear coverage is solid.

## Loop = DFS over the screen graph with an explicit backtrack frontier

iOS screens are not URL-addressable, so revisiting a fork means **relaunch + re-walk a tap
path**. The engine externalizes all state to disk every step (a killed run keeps a complete
record) and explores like this:

1. **Observe** the current screen: screenshot (vision) + a11y element list. Compute a
   deterministic `signature` from the a11y labels → screen identity. The model names the
   screen, lists the **branch-worthy** actionable options, flags flaws, and reports
   `leftApp`/`deadEnd`.
2. **Fork = a screen with >1 untried branch-worthy option.** Record the node + its options
   in `state-graph.json`. Push every *untried* option onto the **frontier** as a task
   `{reach: [actions from launch to here], action}`. Then take one (DFS goes deep).
3. **Backtrack** = pop the frontier. If the popped task's `reach` matches where we
   physically are (common in DFS — children share the parent's path), just take the action.
   Otherwise **relaunch + re-walk `reach`** to get back to that fork, then take the untried
   action. (Deep-link via `mobile_open_url` if the app exposes a scheme — faster.)
4. Repeat until the frontier is empty or budget runs out. The frontier + state-graph
   **persist across runs**, so a later run resumes still-unexplored branches.

"If an option appears that hasn't been tried yet → add a backtrack point" is exactly
step 2: every newly-discovered untried option becomes a frontier task. The model gets a
compact state-graph + frontier summary each step (full context, lean tokens) so it never
re-tries a tried branch and recognizes new forks.

## Data structures

- `journal.jsonl` — append one line per step: `{ts, branch, step, screen_before, action,
  screen_after, new_screen, screenshot, crashed, verdict, notes}`.
- `flaws.jsonl` — append the moment a flaw/crash is seen: `{id, ts, step, type, severity,
  summary, detail, screen, screenshots, status}`.
- `state-graph.json` (persisted across runs):
  ```jsonc
  {
    "nodes": { "<signature>": { "name", "signature", "status": "explored|partial|unexplored",
                                "reach": [actions], "actions": { "<label>": { "to", "tried" } } } },
    "frontier": [ { "id", "reach": [actions], "action": {label,kind,x,y,text}, "expectSig", "discoveredAtStep" } ],
    "visited": [ "<sig>::<label>" ],   // tried (screen,action) pairs — never repeat
    "nextFlawId", "nextBranchId"
  }
  ```

## Control is deterministic; the model only analyzes

The frontier/backtrack/re-walk is plain code (deterministic, debuggable). The LLM only:
name the screen, pick branch-worthy options (by a11y element index → exact coords; vision
x,y fallback when the tree is thin), flag flaws, and judge dead-end/leftApp. This keeps the
exploration reproducible and the LLM's job narrow.

## Tapping + robustness (carried from the spike)

- **a11y-first tapping** (tap by element label → exact coords); vision-estimated coords
  only when the tree is thin. Gemini 3.5 Flash everywhere (it out-grounded Claude in the A/B).
- **Launch-readiness poll** — wait up to 10s for first content (≥3 a11y elements) before driving.
- **Crash detection** — model reports `leftApp`; engine records a crash flaw + relaunches +
  backtracks.
- **Loop guard** — never push/execute a `(signature::label)` already in `visited`; cap
  branch depth and global step budget; on re-walk drift (screen signature ≠ expected),
  record a flow-drift flaw and abandon that task.

## Roadmap (what's built vs future)

Built: Tier 1 (critique pass + report, backtrack frontier, signup mode, stable identity) +
cause/effect perception (before/after images, tree-diff, action sequence, screen trail) +
Tier 2 #5 scrolling, #6 modals/alerts/permission dialogs, #7 general form-fill, and #15
in-app navigation backtracking (back/tabs/forward; relaunch only as fallback).

Future:
- **#8 cross-run persistence / resume** — persist the screen map + frontier to `.autobot/`
  and resume unexplored branches on the next run (currently fresh per run).
- **#9 exhaustive onboarding-fork coverage** — signup mode drives one path through
  onboarding; extend the frontier to span onboarding so every goal/experience branch is
  covered.
- **Tier 3** — wire into `bin/autobot` (`AUTOBOT_DRIVE_ENGINE`), a discovery pass that
  auto-writes `inputs.json`, framework detection/routing in the engine, hardening (retries,
  token budget, coordinate normalization, `simctl erase` state reset), and a verdict +
  baseline-diff report mode.

## Budgets

`GLOBAL_STEPS` (total actions), `MAX_DEPTH` (per-branch depth before forced backtrack),
`LAUNCH_WAIT` (readiness cap, 10s). All env-overridable.
