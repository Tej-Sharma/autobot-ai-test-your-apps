# Visual UX critique rubric — iOS

When critiquing a screenshot, evaluate it as a thoughtful first-time user would. You
are looking for things a *sensible person would side-eye* — not pixel-level
perfection. A screenshot can be ugly and still pass; pretty and still fail.

For each screenshot, flag any of the following:

## Layout
- **Truncated text** — labels cut off, ellipses where the full text should fit
- **Overflow** — content escaping its container, text clipped at a screen edge, elements bleeding off-screen
- **Misalignment** — buttons/labels visibly off-grid, inconsistent margins between repeating cells/rows
- **Collision** — overlapping elements that shouldn't overlap (a nav bar over content, a FAB over text, keyboard covering the field being typed into)
- **Empty space** — vast unused area that feels unfinished, content jammed into one corner
- **Crowding** — elements with no breathing room
- **Safe-area / notch issues** — content under the status bar, Dynamic Island, or home indicator; controls in the unreachable top corners

## Content
- **Placeholder content** — `Lorem ipsum`, `TODO`, `{{ name }}`, `nil`, `undefined`, `null`, `NaN`, "Untitled", debug strings
- **Broken images** — missing-image placeholders, broken thumbnail icons, blank avatars
- **Default scaffolding** — template/sample data, "Hello World", default app icon, placeholder app name
- **Wrong locale** — mixed languages, untranslated keys (`home.title`)
- **Stale data** — dates from 1970, "Invalid Date", "0 results" where content should exist

## Affordance
- **Unclear primary action** — multiple buttons of equal visual weight; no obvious next step
- **Tiny tap targets** — controls too small to hit reliably (Apple HIG minimum is ~44pt)
- **Hidden interactions** — important controls below the fold with no scroll cue
- **Disabled-looking enabled elements** — gray buttons that are actually tappable, and vice versa
- **Buttons that don't look like buttons** — plain text that's secretly the only way forward

## Copy
- **Confusing labels** — jargon, ambiguous CTAs ("Submit" for what?)
- **Tone mismatch** — overly formal in a casual app, or vice versa
- **Error messages a user can't act on** — "Error -1009" or raw exception text with no recovery hint
- **Typos / grammar**

## State
- **Empty state weirdness** — "0 items" with no call to action, blank screens
- **Loading state weirdness** — spinner stuck, skeleton that never resolves, layout jumping as content lands
- **Error state weirdness** — generic "Something went wrong" with no retry, a crash back to the home screen

## Accessibility (light pass)
- **Low contrast** — light gray text on white, white on yellow
- **Tiny text** — body copy that looks under ~12pt
- **Tap targets** that appear under ~44pt

## Brand consistency (cross-screen — compare across the run's screenshots)
- **Inconsistent fonts** — multiple typefaces with no clear hierarchy across screens
- **Inconsistent colors** — accent/tint colors that drift between screens
- **Inconsistent components** — pill, rounded-rect, and square buttons across screens; two different modal/sheet styles; a nav bar that changes shape between screens

---

## Output format

For each screenshot, output a JSON line to `critique.jsonl`:

```json
{
  "file": "screenshots/signup__03_create-account.png",
  "verdict": "pass" | "warn" | "fail",
  "issues": [
    {
      "category": "layout",
      "severity": "high" | "medium" | "low",
      "description": "Email field label is truncated to 'Email addres…'",
      "where": "top of screen, under the nav bar"
    }
  ],
  "notes": "Otherwise clean. Good visual hierarchy."
}
```

- **pass** = nothing meaningful to flag
- **warn** = something a designer would want to know but doesn't block ship
- **fail** = a real user would notice and complain

Every warn/fail issue ALSO becomes a `flaws.jsonl` entry (see the global rules) unless
an equivalent flaw was already recorded during the drive — check the existing entries
first, don't duplicate.

Be specific. "Looks weird" is not useful. "The 'Continue' button is centered but the
form is left-aligned, which makes the button feel detached" is useful.

Be calibrated. If you flag everything, the report is noise. Most screens in a
well-designed app should pass.
