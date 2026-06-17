# Global rules — applies to every autobot pass

These rules apply to discovery, flow execution, and run passes alike. They override any contradictory instinct.

## WebDriverAgent startup — wait, don't loop

The simulator is driven through **WebDriverAgent (WDA)**. On a fresh simulator the
**first** interactive call (`mobile_take_screenshot`, `mobile_list_elements_on_screen`,
taps, typing) can fail while WDA cold-starts — you'll see errors like
`timed out waiting for WebDriverAgent to be ready` or a connection refusal. This is
normal startup, **not** a sign the app crashed or that you left the app.

When you hit a WDA/connection error:

1. **Do NOT relaunch the app.** Relaunching does not start WDA any faster, and the
   open→exit→reopen cycle is the single worst-looking failure mode for the user.
2. **Wait, then retry the _same_ call.** Run `sleep 8` via Bash, then re-issue the
   exact tool call that failed. Repeat up to ~10 times (≈90s total). WDA cold-start
   can legitimately take 1–2 minutes the first time.
3. `mobile_save_screenshot` uses `simctl` and works **without** WDA — you may use it
   to confirm the app is still on screen while you wait. Seeing the app there is
   expected; keep waiting for WDA, don't relaunch.
4. These WDA-warmup retries **do not count** against the per-step tool-call budget.

Only once a WDA-backed call (e.g. `mobile_take_screenshot` or
`mobile_list_elements_on_screen`) succeeds should you begin executing flow steps.

## How you see vs. how you record

You have two ways to look at the screen — use the right one for the right job:

- **To decide what to do next, default to `mobile_list_elements_on_screen`** (the
  accessibility tree). It's cheaper than an image and gives you element labels/coords
  to act on. Pair it with `mobile_take_screenshot` (returns the image inline) when you
  need to *see* layout the a11y tree can't convey.
- **To record evidence for the critique pass, use `mobile_save_screenshot`** — it
  writes a PNG to disk (and works even before WDA is warm). The saved PNGs are the
  entire input to the critique pass; an action with no saved checkpoint is invisible
  to it.
- **Don't `Read` images you just captured.** `take_screenshot` already returned the
  image inline; the critique pass reads the saved files later. Re-reading wastes turns.
- **Don't use `TaskCreate` / `TaskUpdate` for your own planning.** Hold the plan in
  your head; the journals (below) are your external memory.
- **Don't `ToolSearch`.** All tools you need are already loaded.

**When the a11y tree is empty (Flutter apps often have thin trees):** fall back to the
screenshot — identify what a human would tap, estimate coordinates from
`mobile_get_screen_size`, tap, then take a follow-up screenshot to confirm a state
change. No change → the thing you guessed at probably isn't tappable; try a
*different* element, not the same one again.

## Screenshot checkpoints — EVERY new screen, every significant state change

Saved screenshots are the evidence trail the critique pass and the report are built
from. The rule:

**ALWAYS save a screenshot (`mobile_save_screenshot`) when:**
1. **You reach a screen you haven't captured in this state** — a new tab, a pushed
   detail view, a presented modal/sheet, an onboarding step. A screen can be re-shot
   if its state meaningfully changed (empty list → populated list, error appeared).
2. **An action causes a significant state update on the same screen** — form
   submitted, item created/edited/deleted, segment/tab switched, major content swap,
   error banner appeared, transcript landed after a voice command.

**Do NOT screenshot** after every tap, scroll, or keystroke. Filling three fields then
submitting = one checkpoint (after submit), not four.

Save into the run's `screenshots/` directory (the absolute path is in the run
context). Name them `<flow-slug>__NN_<action-slug>.png` — zero-padded counter, flat
filenames (no subdirectories). In the journals, reference them as
`screenshots/<filename>`. Example:

```
mobile_save_screenshot  ->  <run-dir>/screenshots/signup__03_create-account.png
```

Every saved screenshot must have a matching `journal.jsonl` line (below). An
unjournaled screenshot is useless to the critique pass.

At each checkpoint, give the screen one quick common-sense glance: if something is
obviously broken (error text, blank where content should be, raw template strings, a
crash to the home screen), record a flaw immediately. Deep visual critique happens
later — don't stall the drive studying pixels.

## The journals — write as you go, never batch at the end

All run state lives on disk, written incrementally. If you crash or hit a budget, the
record must already be complete up to the last step. **Append after every step, not
at the end of the flow.** Append with Bash (`cat >> file <<'EOF' … EOF` or
`echo '…' >> file`) — never rewrite the whole file.

### 1. `journal.jsonl` — the step trace (append one line per step)

```json
{"ts":"2026-06-16T14:32:01Z","flow":"signup","step":3,"goal":"submit the signup form","action":"tap 'Create account'","screen_before":"Signup","screen_after":"Onboarding 1","new_screen":true,"screenshot":"screenshots/signup__03_create-account.png","crashed":false,"verdict":"ok","notes":""}
```

- `verdict`: `ok` | `stuck` | `failed` | `skipped`
- `screen_before` / `screen_after`: the screen names as they appear in
  `state-graph.json` (a short human label like "Settings" or "Note detail").
  `new_screen`: true the first time you land on a screen this run.
- `screenshot`: null if the step wasn't a checkpoint.
- `crashed`: true if the app fell back to the home screen / had to be relaunched
  during this step (always also a high `crash` flaw — see crash detection below).

### 2. `flaws.jsonl` — the flaws/errors journal (append the moment you notice one)

Every flaw, bug, broken behavior, or UX problem goes here — one line each, **with
screenshot references**:

```json
{"id":"F-003","ts":"2026-06-16T14:32:05Z","flow":"signup","step":3,"type":"functional","severity":"high","summary":"Tapping 'Create account' does nothing","detail":"Button shows a pressed state but no navigation, no spinner, no error after ~8s. The form appears stuck.","screen":"Signup","screenshots":["screenshots/signup__03_create-account.png"],"status":"open"}
```

- `type`: `visual` | `content` | `functional` | `crash` | `performance` | `a11y` | `copy`
- `severity`: `high` (a user would complain) | `medium` (a designer would flag) | `low` (polish)
- `screenshots`: at least one saved screenshot showing the flaw. If you notice a flaw
  and have no checkpoint shot of it, save one now and reference it.
- IDs are sequential per run (F-001, F-002, …). Check the file's last line if unsure.

Flaws found while driving AND flaws found in the critique pass both go in this same
file. It is the single source of truth the report is built from.

### 3. `state-graph.json` — the screen-coverage map (persists ACROSS runs)

Lives at `.autobot/state-graph.json` (NOT per-run — it accumulates a map of the app
over time). It is a **coverage map**, not a router: it tracks which screens exist and
which you've actually explored, so discovery and the exploratory pass always know
what's left to see.

```json
{
  "nodes": [
    {"name": "Home", "signature": "bottom tab bar; large '+' FAB; 'Recents' header", "status": "explored", "reach": "launch", "notes": "empty + populated states seen"},
    {"name": "Settings", "signature": "grouped list; 'Account', 'Notifications' rows", "status": "unexplored", "reach": "launch → tap gear top-right", "notes": "gear seen on Home, never opened"}
  ],
  "edges": [
    {"from": "Home", "action": "tap '+' FAB", "to": "New note"}
  ]
}
```

- `name`: short human label. `signature`: a couple of distinctive on-screen cues so a
  future run can recognize the screen (iOS screens have no URL — the signature is how
  you identify one).
- `reach`: the tap-path from a fresh launch that gets you here (see backtracking).
- `status`: `unexplored` | `partial` | `explored`.
- When you see a control leading to a screen you don't visit, add that screen as an
  `unexplored` node — it's the to-do list for future exploration.
- Update it when you learn something new (new screen, new edge, status change) via
  Read + Write — updates are occasional, so read-modify-write is fine here.

## Backtracking on iOS — relaunch and re-walk, there is no "navigate"

Unlike the web, iOS screens are **not URL-addressable** — you cannot jump straight to
a prior screen. To return to an earlier state:

1. **Prefer a deep link if one is known.** If `state-graph.json` records a URL-scheme
   deep link for the target screen (e.g. `myapp://settings`), use `mobile_open_url` —
   that's the closest thing to the web's one-shot navigate. Most apps don't expose
   these; don't invent one.
2. **Otherwise relaunch and re-walk the shortest known path.** `mobile_launch_app`
   with the bundle ID, then follow the target node's `reach` path from the state
   graph (e.g. "tap Settings tab → tap Account"). This is more expensive than the
   web's navigate — so backtrack deliberately, only when a flow genuinely needs to
   return to an earlier state, not casually.
3. Account state usually survives a relaunch (you stay logged in), so relaunch lands
   you in the app, not at a login wall.

This is why each node stores a `reach` path: it is your re-walk recipe, not a router.

## Crash & visible-error detection — your free evidence on iOS

mobile-mcp gives you no console log or network trace for a native iOS app, so the
errors you can catch are the ones a human would *see*. After each step, before writing
its journal line, check:

1. **Did the app crash?** If the screen is now the iOS home screen / springboard (a
   grid of app icons) and you didn't navigate there on purpose, the app crashed. Save
   a screenshot, set `crashed: true` in the journal line, record a **high** `crash`
   flaw, then relaunch per the stay-in-app rule.
2. **Visible error states.** Error alerts/banners, "Something went wrong", raw error
   codes (`Error -1009`), blank screens where content was expected. Each is at least a
   `medium` flaw, even if the app didn't crash — silent failures are the worst bugs.
3. **Stuck states.** A spinner still spinning after ~10s, or content that two
   `sleep`+retry cycles never produced, is a `performance`/`functional` flaw — journal
   it and move on, don't keep waiting.

Correlate, don't dump: tie each error to the step that caused it in the journal/flaw.

## Stay inside the target app — CRITICAL

Before every tap or action:

1. Verify the most recent screenshot still shows the target app (the bundle ID in the run context).
2. Signals you've left the target app:
   - You see a grid of app icons (iOS home screen / springboard)
   - You see a `◀ <AppName>` back-link at the top-left
   - The status bar / chrome shows a different app (Settings, App Store, Photos, Files, Device Kit, etc.)
3. If you've left the target app, **immediately call `mobile_launch_app` with the bundle ID from the run context**. Do not try to navigate back by tapping icons. Re-launching is the safest recovery. (If the exit was an unexpected crash, also record the `crash` flaw per the rule above.)
4. Never tap on an app icon on the home screen. Never use the app switcher.

If the target app legitimately routes you into a system surface (share sheet, file picker, OAuth web view), it's OK to interact with it briefly to complete the flow — then get back to the target.

## Don't loop — hard budgets, not soft hints

### Per-step tool-call budget: **12 calls max**

Each numbered step has a hard budget of ~12 tool calls (taps, screenshots, list, type,
swipes, journal appends — everything combined). A clean step is: list_elements/screenshot
to see → act → screenshot to verify → crash/error check → journal append. That's ~5.
With a retry, 7–8. **12 is the ceiling, not the target.** Past 12, mark the step
`failed` in the journal, record a flaw if it's the app's fault, and move on.

### Total-flow tool-call budget: **80 calls scripted + 30 exploration = 110 max**

The scripted phase (numbered steps) gets ~50–80 calls. The optional exploratory phase
gets up to 30 more. If the scripted budget runs out, stop the scripted phase, journal
what you have, then do exploration only if 30+ calls remain. When both are exhausted,
write the report and exit. Don't "just finish" past the budget.

### Never re-do already-tested flows

Once you've completed (or failed) a step in the scripted flow, **do not run it again**
in the same session — not in retry, not in "verification", not in exploration.
Logout/signup/onboarding in particular are state-mutating; re-running them creates
duplicate accounts and confuses the report.

### Same-action-twice rule

**If you've tapped the same coordinate (within 20px) twice during a single step —
regardless of what calls happened in between — the element isn't working.** Do not tap
there a third time. Pick a different element, swipe, try `mobile_press_button "ENTER"`,
or fail the step. This applies across screenshot/list/tap interleavings too:
tap → screenshot → tap-same-spot → screenshot → tap-same-spot is THREE taps at one
coordinate. That's a loop. Stop.

### Bad loop patterns to avoid

- Tapping the same coordinate three times in a step
- Re-launching the app every turn (relaunch is for recovery/backtracking, not a tic)
- Re-taking screenshots without changing state in between
- "Maybe one more tap will work" thinking — it won't; switch strategy or fail the step

## Quit when done

When your assigned goal is met, stop. Don't keep exploring or "double-checking" once
the flow is complete. Write the final artifacts, print the final message, exit.

Signs you are done:
- Every flow step is journaled (pass or fail)
- You hit a blocker you've documented and can't bypass
- The budget is exhausted

Don't take "one more screenshot for good measure."

## Use common sense — you are a smart human user, not a script

You are not running a brittle test script. You are a thoughtful first-time user who
understands what apps generally look like and how they generally work. Use that.

**Interpret steps charitably.** If a step says "type a note in and press enter", do the
most natural thing a human would do:
- Find the most plausible text input for that intent (a step in a "thought capture"
  app means the capture field, not a profile name field)
- Type the content
- Submit via whatever the obvious submit affordance is on this screen — the keyboard
  return key, an up-arrow / send / paper-plane button, a "Save" CTA, or a swipe-up
  gesture. **Try the most obvious one first.** If nothing happens, try the next most
  obvious. Do not loop.

**Use the app's framing.** Each flow file describes what kind of app this is. Let that
guide interpretation: "Search" in a thought-capture app searches captured thoughts, not
the App Store; "Continue" in onboarding advances, in a payment flow it confirms; a `+`
button usually creates the app's core object.

**When unsure between two reasonable interpretations:** pick what a typical first-time
user would do, note the choice in the journal line, keep going. This is unattended
automation — never ask the user mid-run.

**Never invent UI that isn't there.** If there's no "Log out" anywhere in profile or
settings, don't pretend — journal the step as failed and record a `functional` flaw
("no visible logout affordance").

## On error in a step

If a step can't be completed (control missing, screen doesn't appear, dialog blocks
progress, app crashes):

1. Save one screenshot of the failure state (this one IS worth archiving).
2. Append the step's `journal.jsonl` line with `verdict: "failed"` and a one-sentence
   `notes`.
3. Append a flaw to `flaws.jsonl` if the failure is the app's fault (as opposed to a
   wrong guess by you — be honest about which it is), with the screenshot reference.
4. Decide: can the next step still run independently?
   - **Yes** → continue; note the broken dependency in the journal.
   - **No** (signup failed, so onboarding can't run) → end the flow, journal the
     remaining steps as `skipped`, move to the next flow (or exit if this is a custom
     single flow).

Never silently skip a step. Never pretend a failed step succeeded.
