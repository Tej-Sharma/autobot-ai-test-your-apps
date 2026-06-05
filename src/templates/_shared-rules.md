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

## Speed — don't burn turns

- **Use `mobile_take_screenshot`, not `mobile_save_screenshot` + `Read`.** `take_screenshot` returns the image inline. Only use `save_screenshot` when you specifically want to archive a frame for the final report.
- **Don't `Read` images you just captured.** They're already in your context from the tool result.
- **Take screenshots at meaningful state changes**, not after every tap. One per "step", not one per tool call.
- **Don't use `TaskCreate` / `TaskUpdate` for your own planning here.** Hold the plan in your head.
- **Don't `ToolSearch`.** All tools you need are already loaded.

## Stay inside the target app — CRITICAL

Before every tap or action:

1. Verify the most recent screenshot still shows the target app (the bundle ID in the run context).
2. Signals you've left the target app:
   - You see a grid of app icons (iOS home screen / springboard)
   - You see a `◀ <AppName>` back-link at the top-left
   - The status bar / chrome shows a different app (Settings, App Store, Photos, Files, Device Kit, etc.)
3. If you've left the target app, **immediately call `mobile_launch_app` with the bundle ID from the run context**. Do not try to navigate back by tapping icons. Re-launching is the safest recovery.
4. Never tap on an app icon on the home screen. Never use the app switcher.

If the target app legitimately routes you into a system surface (share sheet, file picker, OAuth web view), it's OK to interact with it briefly to complete the flow — then get back to the target.

## Don't loop — hard budgets, not soft hints

### Per-step tool-call budget: **12 calls max**

Each numbered step in the flow has a hard budget of ~12 tool calls (taps, screenshots, type, swipes — everything combined). If you exceed 12 and the step still isn't done, mark it **failed** per the error rule and move on. **Do not exceed the budget by even one extra attempt.**

Roughly, a step should look like: 1 screenshot to see → 1 list_elements → 1 tap → 1 screenshot to verify → done. That's 4 calls. Even with retries it should be 6–8. 12 is the ceiling, not the target.

### Total-flow tool-call budget: **80 calls for scripted + 30 for exploration = 110 max**

The scripted phase (numbered steps in the flow file) gets ~50–80 tool calls. The optional exploratory phase (other parts of the app, edge cases) gets up to 30 more. If you exhaust the scripted budget without finishing, stop the scripted phase, write what you have, then if 30+ calls remain do exploration. If both are exhausted, write the report and exit. Don't try to "just finish" past the budget.

### Never re-do already-tested flows

Once you've completed (or failed) a step in the scripted flow, **do not run it again** in the same session — not in retry, not in "verification", not in exploration. Logout/signup/onboarding in particular are state-mutating; re-running them creates duplicate accounts and confuses the report.

### Same-action-twice rule

**If you've tapped the same coordinate (within 20px) twice during a single step — regardless of what calls happened in between — the element isn't working.** Do not tap there a third time. Pick a different element, swipe, try `mobile_press_button "ENTER"`, or fail the step.

This applies across screenshot/list/click interleavings too. Tap → screenshot → tap-same-spot → screenshot → tap-same-spot is THREE taps at the same coordinate. That's a loop. Stop.

### Bad loop patterns to avoid

- Tapping the same coordinate three times in a step
- Re-launching the app every turn
- Re-taking screenshots without changing state in between
- "Maybe one more tap will work" thinking — it won't; switch strategy or fail the step

## Quit when done

When your assigned goal is met, stop. Do not keep exploring or "double-checking" once the flow is complete. Write your summary, the final report file (if applicable), and exit.

Signs you are done:
- You've reached the expected end state of the flow
- You've completed every step in the test plan
- You hit a blocker you've documented and can't bypass

When you're done, write the summary file and terminate. Don't take "one more screenshot for good measure."

## Use common sense — you are a smart human user, not a script

You are not running a brittle test script. You are a thoughtful human who understands what apps generally look like and how they generally work. Use that.

**Interpret steps charitably.** If a step says "type a note in and press enter", do the most natural thing a human would do:
- Find the most plausible text input field for that intent (a step in a "thought capture" app means the capture field, not a profile name field)
- Type the content
- Submit via whatever the obvious submit affordance is on this screen — that might be the keyboard return key, an up-arrow / send / paper-plane button next to the field, a "Save" CTA, or a swipe-up gesture. **Try the most obvious one first.** If nothing happens, try the next most obvious one. Do not loop.

**Use the app's framing.** Each flow file describes what kind of app this is. Let that framing guide your interpretation:
- "Search" in a thought-capture app likely searches captured thoughts, not the App Store
- "Continue" in an onboarding flow likely advances; in a payment flow it likely confirms
- A pill control at top often means "tap to expand into a search input"
- An icon with a single character "M" near the field probably toggles a mode (think: "Markdown" or "Mind map" — pattern recognition)

**When the a11y tree is empty (Flutter apps often have thin trees):**
- Use the screenshot to identify what you'd tap if you were a human
- Estimate coordinates from the screenshot dimensions (`mobile_get_screen_size`)
- Confirm the tap worked by taking a follow-up screenshot and looking for a state change
- If no change, the element you guessed at probably isn't tappable — try a *different* element, not the same one again

**When unsure between two reasonable interpretations:**
- Pick the one that a typical first-time user would pick
- Document the choice in the step's summary row
- Don't ask the user mid-run; this is unattended automation

**Never invent UI that isn't there.** If you can't find a "Log out" button after looking in profile/settings, do not synthesize one or pretend it exists — flag as failed per the error rule.

## On error in a step

If a step can't be completed (button missing, screen doesn't appear, dialog blocks progress):

1. Take one screenshot showing the failure state (use `mobile_save_screenshot` here — we want this archived).
2. Append a short entry to `.autobot/reports/<run-id>/errors.md`:
   ```
   ## Step N — <step name>
   **Status**: failed
   **What happened**: <one sentence>
   **Screenshot**: <relative path>
   ```
3. Decide: can the next step still run independently?
   - **Yes** → continue with the next step. Note the dependency was broken.
   - **No** (e.g. signup failed, so onboarding can't run) → stop the flow, write the summary, exit.

Never silently skip a step. Never pretend a failed step succeeded.
