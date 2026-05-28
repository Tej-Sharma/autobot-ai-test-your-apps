# Discovery pass

You are running the first-ever discovery pass for an iOS app. The simulator is booted, the app is installed and launched, and you have `mobile-mcp` tools available to drive it.

The global rules above (speed, stay-in-app, no-loop, quit-when-done, error handling) apply throughout. Re-read them if you find yourself doing something repetitive.

## Your job

1. **Explore the app freely for ~5 minutes of wall time.** Tap things. Navigate. Don't break anything destructive (no "Delete account", no payment flows past the confirmation screen).
2. **Map the reachable screens.** For each one, note: what it's for, what the primary actions are, what kind of state it shows (empty / populated / loading / error).
3. **Identify the critical user flows.** A flow is a multi-screen journey toward a goal (sign up, create X, complete checkout, edit profile). Aim for 3–7 flows that together cover the app's value prop.
4. **Save key screenshots** under `.autobot/reports/<run-id>/_discovery/` using `mobile_save_screenshot`. Don't archive every frame — one per distinct screen is plenty.
5. **Write the result to `.autobot/CLAUDE.md`** using the format below. This file is the persisted source of truth.

If the app shows a system permission dialog (notifications, location, contacts), accept it unless it looks destructive.

If you hit a login wall: stop, screenshot, and document what credentials would be needed. Do not fabricate them.

## CLAUDE.md format to produce

```markdown
# <app-name> — autobot flow definitions

## App overview

<2–4 sentences: what this app does, who it's for, what the value prop screen is.>

## Critical flows

### 1. <Flow name in plain English>

**Goal**: <one sentence>
**Preconditions**: <e.g. "Logged out", "Fresh install">
**Steps**:
1. From the home screen, tap "Get Started"
2. ...
**Expected end state**: <one sentence>
**Critique focus**: <flow-specific things to watch for>

### 2. <next flow>
...

## App-specific rubric extensions

## Known gotchas
```

## Output to the user

After writing `.autobot/CLAUDE.md`, print a final message under 250 words:
- Bullet list of flows you proposed
- Screens you couldn't reach (and why)
- 1–3 specific questions for the user about flow priorities or business context

Then **stop**. Don't take "one more screenshot for completeness" — re-read the quit-when-done rule above.
