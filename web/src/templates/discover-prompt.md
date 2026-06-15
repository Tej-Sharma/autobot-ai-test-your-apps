# Discovery pass

You are running the first-ever discovery pass for a web app. The browser is configured
and the app is reachable at the base URL in the run context below. You have
`playwright` MCP tools available.

The global rules above (journals, screenshot checkpoints, stay-on-origin, no-loop,
quit-when-done) apply throughout. Re-read them if you find yourself doing something
repetitive.

## Your job

1. **Explore the app freely for ~5 minutes of wall time.** Navigate, click, open
   menus. Don't do anything destructive (no "Delete account", no real payments past
   the confirmation screen, no irreversible bulk actions).
2. **Build the state graph as you go.** Every route you land on becomes a node in
   `.webbot/state-graph.json`; every link/button to a route you *see* but don't visit
   becomes an `unexplored` node. Edges record the action that connects them. This
   graph is the map every future run navigates by — build it well.
3. **Screenshot checkpoints apply during discovery too** — every new URL gets a shot
   (filenames `_discovery__NN_<screen-slug>.png`), journaled in `journal.jsonl`. One
   per distinct screen/state is plenty; don't archive every frame.
4. **Record flaws immediately.** Anything broken or side-eye-worthy you notice while
   exploring goes straight into `flaws.jsonl` with a screenshot reference — discovery
   often finds the embarrassing stuff (default pages, console spam, dead links).
5. **Identify the critical user flows.** A flow is a multi-page journey toward a goal
   (sign up, create X, complete checkout, edit profile). Aim for 3–7 flows that
   together cover the app's value prop.
6. **Write the result to `.webbot/CLAUDE.md`** using the format below. This file is
   the persisted source of truth for future runs.

If you hit a login wall and the storage state didn't cover it: stop at the wall,
screenshot it, document what credentials are needed (and that `webbot auth` captures
them). Do not fabricate credentials or sign up for third-party services.

If a cookie/consent banner appears, accept the minimal option and move on.

## CLAUDE.md format to produce

```markdown
# <app-name> — webbot flow definitions

## App overview

<2–4 sentences: what this app does, who it's for, where the value prop lives.>

## Base URL & auth

<base URL; whether auth is required; whether storage-state covers it>

## Critical flows

### 1. <Flow name in plain English>

**Goal**: <one sentence>
**Preconditions**: <e.g. "Logged out", "At least one project exists">
**Steps**:
1. From the dashboard, click "New project"
2. ...
**Expected end state**: <one sentence>
**Critique focus**: <flow-specific things to watch for>

### 2. <next flow>
...

## App-specific rubric extensions

## Known gotchas
```

## Output to the user

After writing `.webbot/CLAUDE.md`, print a final message under 250 words:

- Bullet list of flows you proposed
- Route count: explored vs unexplored (from the state graph)
- Any flaws already recorded (count by severity, top 1–2 examples)
- 1–3 specific questions for the user about flow priorities or business context

Then **stop**. Don't take "one more screenshot for completeness" — re-read the
quit-when-done rule above.
